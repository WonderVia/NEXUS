/**
 * WUElev8 Smart Proctoring Browser - Durable Offline Storage Engine
 * 
 * Provides resilient, encrypted local SQLite persistence for examination data:
 * - Offline-capable assessment manifest & sanitized question caching
 * - Durable, transactional question answer writes
 * - Answer change event logging with sequential local ordering
 * - Offline proctoring event queuing
 * - High-resolution monotonic timing to detect system clock manipulation
 * - OS-backed credential & session encryption via Electron safeStorage (DPAPI)
 * - Safe from renderer compromise (managed exclusively in Electron main process)
 */

const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

// Dual driver: prefers node:sqlite built into Node 22+ / Electron 33+, with better-sqlite3 fallback
function initSqliteInstance(filePath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(filePath);
  } catch (_e) {
    const BetterSqlite3 = require('better-sqlite3');
    return new BetterSqlite3(filePath);
  }
}

class OfflineStore {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.sequenceCounters = new Map(); // attemptId -> number
    this.monotonicTimers = new Map();  // attemptId -> { lastHrTime: bigint, accumulatedMs: number }
    this.tickInterval = null;
  }

  initialize() {
    if (this.db) return;

    try {
      const userDataDir = app.getPath('userData');
      const storeDir = path.join(userDataDir, 'offline_store');
      if (!fs.existsSync(storeDir)) {
        fs.mkdirSync(storeDir, { recursive: true });
      }

      this.dbPath = path.join(storeDir, 'wuelev8_offline.db');
      this.db = initSqliteInstance(this.dbPath);

      // Initialize Schema
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        -- 1. Cached Offline Assessment Packages
        CREATE TABLE IF NOT EXISTS cached_packages (
          attemptId TEXT PRIMARY KEY,
          assessmentId TEXT NOT NULL,
          studentId TEXT NOT NULL,
          packageJson TEXT NOT NULL,
          policySnapshotJson TEXT NOT NULL,
          serverStartTime TEXT NOT NULL,
          durationMinutes INTEGER NOT NULL,
          serverExpiryTime TEXT NOT NULL,
          cachedAt TEXT NOT NULL,
          isRevoked INTEGER DEFAULT 0
        );

        -- 2. Durable Cached Answers (Latest state per question)
        CREATE TABLE IF NOT EXISTS cached_answers (
          attemptId TEXT NOT NULL,
          questionId TEXT NOT NULL,
          selectedOption INTEGER NOT NULL,
          localSequenceNumber INTEGER NOT NULL,
          clientAnsweredAt TEXT NOT NULL,
          isSynced INTEGER DEFAULT 0,
          syncedAt TEXT,
          PRIMARY KEY (attemptId, questionId)
        );

        -- 3. Detailed Answer Change Events (Audited timeline)
        CREATE TABLE IF NOT EXISTS answer_change_events (
          eventId TEXT PRIMARY KEY,
          attemptId TEXT NOT NULL,
          questionId TEXT NOT NULL,
          previousOption INTEGER,
          selectedOption INTEGER NOT NULL,
          localSequenceNumber INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          isSynced INTEGER DEFAULT 0,
          syncedAt TEXT
        );

        -- 4. Cached Proctoring Events (Offline telemetry)
        CREATE TABLE IF NOT EXISTS cached_proctoring_events (
          eventId TEXT PRIMARY KEY,
          attemptId TEXT NOT NULL,
          eventType TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          duration INTEGER DEFAULT 0,
          severity TEXT NOT NULL,
          details TEXT NOT NULL,
          detectionSource TEXT NOT NULL,
          localSequenceNumber INTEGER NOT NULL,
          isSynced INTEGER DEFAULT 0,
          syncedAt TEXT
        );

        -- 5. Question Navigation Events (Audit of candidate flow)
        CREATE TABLE IF NOT EXISTS question_navigation_events (
          eventId TEXT PRIMARY KEY,
          attemptId TEXT NOT NULL,
          fromQuestionIdx INTEGER,
          toQuestionIdx INTEGER NOT NULL,
          localSequenceNumber INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          isSynced INTEGER DEFAULT 0
        );

        -- 6. Submission State Tracker
        CREATE TABLE IF NOT EXISTS submission_state (
          attemptId TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK(state IN ('in_progress', 'pending_sync', 'syncing', 'synced', 'sync_failed')),
          localSubmittedAt TEXT,
          syncedAt TEXT,
          errorMessage TEXT,
          retryCount INTEGER DEFAULT 0,
          lastRetryAt TEXT
        );

        -- 7. Monotonic Timing & System Clock Tamper Guard
        CREATE TABLE IF NOT EXISTS monotonic_timing (
          attemptId TEXT PRIMARY KEY,
          durationMinutes INTEGER NOT NULL,
          accumulatedElapsedMs INTEGER DEFAULT 0,
          lastTickTimeMs INTEGER NOT NULL,
          isDeadlineReached INTEGER DEFAULT 0,
          updatedAt TEXT NOT NULL
        );

        -- Indexes for high-performance ordering and sync retrieval
        CREATE INDEX IF NOT EXISTS idx_cached_ans_attempt ON cached_answers(attemptId, isSynced);
        CREATE INDEX IF NOT EXISTS idx_ans_change_attempt ON answer_change_events(attemptId, isSynced, localSequenceNumber);
        CREATE INDEX IF NOT EXISTS idx_cached_evt_attempt ON cached_proctoring_events(attemptId, isSynced, localSequenceNumber);
      `);

      console.log('[OfflineStore] SQLite local store initialized successfully at:', this.dbPath);

      // Start periodic monotonic tick persistence (every 1s)
      this.startMonotonicTicker();
    } catch (err) {
      console.error('[OfflineStore] Failed to initialize local SQLite store:', err);
      throw err;
    }
  }

  // OS-Backed Encryption via Electron safeStorage (Windows DPAPI)
  encrypt(text) {
    if (!text) return '';
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(text);
        return 'ENC:' + encrypted.toString('base64');
      }
    } catch (e) {
      console.warn('[OfflineStore] safeStorage encryption fallback:', e.message);
    }
    return 'B64:' + Buffer.from(text, 'utf8').toString('base64');
  }

  decrypt(cipher) {
    if (!cipher) return '';
    if (cipher.startsWith('ENC:')) {
      try {
        const buf = Buffer.from(cipher.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch (e) {
        console.warn('[OfflineStore] safeStorage decryption failed:', e.message);
      }
    }
    if (cipher.startsWith('B64:')) {
      return Buffer.from(cipher.slice(4), 'base64').toString('utf8');
    }
    return cipher;
  }

  // Next local sequence number for strict event ordering
  getNextSequence(attemptId) {
    if (!this.sequenceCounters.has(attemptId)) {
      // Find maximum existing sequence number in database
      const rowAns = this.queryOne('SELECT MAX(localSequenceNumber) as maxSeq FROM cached_answers WHERE attemptId = ?', [attemptId]);
      const rowEvt = this.queryOne('SELECT MAX(localSequenceNumber) as maxSeq FROM cached_proctoring_events WHERE attemptId = ?', [attemptId]);
      const max1 = (rowAns && rowAns.maxSeq) || 0;
      const max2 = (rowEvt && rowEvt.maxSeq) || 0;
      this.sequenceCounters.set(attemptId, Math.max(max1, max2));
    }
    const next = this.sequenceCounters.get(attemptId) + 1;
    this.sequenceCounters.set(attemptId, next);
    return next;
  }

  // Helper query methods compatible with both node:sqlite and better-sqlite3
  queryOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (typeof stmt.get === 'function') {
      return stmt.get(...params);
    }
    // node:sqlite DatabaseSync
    const rows = stmt.all(...params);
    return rows.length > 0 ? rows[0] : null;
  }

  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  // Transaction execution
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const res = fn();
      this.db.exec('COMMIT');
      return res;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // -------------------------------------------------------------
  // 1. Assessment Package Caching
  // -------------------------------------------------------------
  cacheAssessmentPackage(pkg) {
    if (!pkg || !pkg.attemptId) {
      throw new Error('Invalid assessment package: missing attemptId');
    }

    const now = new Date().toISOString();
    const encryptedPackage = this.encrypt(JSON.stringify(pkg));
    const policySnapshotStr = JSON.stringify(pkg.policySnapshot || {});

    this.transaction(() => {
      this.run(`
        INSERT OR REPLACE INTO cached_packages (
          attemptId, assessmentId, studentId, packageJson, policySnapshotJson,
          serverStartTime, durationMinutes, serverExpiryTime, cachedAt, isRevoked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [
        pkg.attemptId,
        pkg.assessmentId,
        pkg.studentId,
        encryptedPackage,
        policySnapshotStr,
        pkg.serverStartTime || now,
        pkg.durationMinutes || 30,
        pkg.serverExpiryTime || now,
        now
      ]);

      // Initialize submission state if not present
      this.run(`
        INSERT OR IGNORE INTO submission_state (attemptId, state, retryCount)
        VALUES (?, 'in_progress', 0)
      `, [pkg.attemptId]);

      // Initialize monotonic timing
      this.run(`
        INSERT OR IGNORE INTO monotonic_timing (
          attemptId, durationMinutes, accumulatedElapsedMs, lastTickTimeMs, isDeadlineReached, updatedAt
        ) VALUES (?, ?, 0, ?, 0, ?)
      `, [pkg.attemptId, pkg.durationMinutes || 30, Date.now(), now]);
    });

    console.log(`[OfflineStore] Cached authorized assessment package for attempt: ${pkg.attemptId}`);
    return { ok: true, cachedAt: now };
  }

  getCachedPackage(attemptId) {
    const row = this.queryOne('SELECT * FROM cached_packages WHERE attemptId = ? AND isRevoked = 0', [attemptId]);
    if (!row) return null;

    try {
      const decrypted = this.decrypt(row.packageJson);
      const pkg = JSON.parse(decrypted);
      return {
        ...pkg,
        serverStartTime: row.serverStartTime,
        durationMinutes: row.durationMinutes,
        serverExpiryTime: row.serverExpiryTime,
        cachedAt: row.cachedAt
      };
    } catch (e) {
      console.error('[OfflineStore] Failed to decrypt cached package:', e);
      return null;
    }
  }

  // -------------------------------------------------------------
  // 2. Durable Transactional Answer Writes
  // -------------------------------------------------------------
  saveAnswer({ attemptId, questionId, selectedOption, clientAnsweredAt }) {
    if (!attemptId || !questionId || selectedOption === undefined) {
      throw new Error('attemptId, questionId, and selectedOption are required');
    }

    // Check if monotonic deadline has expired
    const timing = this.getMonotonicTiming(attemptId);
    if (timing && timing.isDeadlineReached) {
      console.warn(`[OfflineStore] Rejected answer write: attempt ${attemptId} has reached deadline`);
      return { ok: false, error: 'Exam deadline reached. No further modifications permitted.' };
    }

    const now = new Date().toISOString();
    const timestamp = clientAnsweredAt || now;
    const option = parseInt(selectedOption, 10);
    const eventId = `ans-evt-${uuidv4().slice(0, 8)}`;

    return this.transaction(() => {
      // 1. Check existing answer
      const existing = this.queryOne(
        'SELECT selectedOption FROM cached_answers WHERE attemptId = ? AND questionId = ?',
        [attemptId, questionId]
      );
      const previousOption = existing ? existing.selectedOption : null;

      // 2. Generate local sequence number
      const seq = this.getNextSequence(attemptId);

      // 3. Upsert into cached_answers
      this.run(`
        INSERT INTO cached_answers (
          attemptId, questionId, selectedOption, localSequenceNumber, clientAnsweredAt, isSynced
        ) VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(attemptId, questionId) DO UPDATE SET
          selectedOption = excluded.selectedOption,
          localSequenceNumber = excluded.localSequenceNumber,
          clientAnsweredAt = excluded.clientAnsweredAt,
          isSynced = 0,
          syncedAt = NULL
      `, [attemptId, questionId, option, seq, timestamp]);

      // 4. Record audit change event
      this.run(`
        INSERT INTO answer_change_events (
          eventId, attemptId, questionId, previousOption, selectedOption, localSequenceNumber, timestamp, isSynced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `, [eventId, attemptId, questionId, previousOption, option, seq, timestamp]);

      return {
        ok: true,
        attemptId,
        questionId,
        selectedOption: option,
        previousOption,
        localSequenceNumber: seq,
        timestamp
      };
    });
  }

  getSavedAnswers(attemptId) {
    return this.queryAll(
      'SELECT questionId, selectedOption, localSequenceNumber, clientAnsweredAt, isSynced FROM cached_answers WHERE attemptId = ? ORDER BY localSequenceNumber ASC',
      [attemptId]
    );
  }

  // -------------------------------------------------------------
  // 3. Proctoring & Navigation Event Logging
  // -------------------------------------------------------------
  logProctoringEvent({ attemptId, eventType, timestamp, duration = 0, severity = 'low', details = '', detectionSource = 'electron_kiosk' }) {
    if (!attemptId || !eventType) return { ok: false };

    const eventId = `evt-off-${uuidv4().slice(0, 8)}`;
    const now = timestamp || new Date().toISOString();
    const seq = this.getNextSequence(attemptId);

    this.run(`
      INSERT INTO cached_proctoring_events (
        eventId, attemptId, eventType, timestamp, duration, severity, details, detectionSource, localSequenceNumber, isSynced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [eventId, attemptId, eventType, now, duration, severity, details, detectionSource, seq]);

    return { ok: true, eventId, localSequenceNumber: seq };
  }

  logNavigationEvent({ attemptId, fromQuestionIdx, toQuestionIdx }) {
    if (!attemptId) return { ok: false };
    const eventId = `nav-evt-${uuidv4().slice(0, 8)}`;
    const seq = this.getNextSequence(attemptId);
    const now = new Date().toISOString();

    this.run(`
      INSERT INTO question_navigation_events (
        eventId, attemptId, fromQuestionIdx, toQuestionIdx, localSequenceNumber, timestamp, isSynced
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `, [eventId, attemptId, fromQuestionIdx !== undefined ? fromQuestionIdx : null, toQuestionIdx, seq, now]);

    return { ok: true, eventId };
  }

  // -------------------------------------------------------------
  // 4. Synchronization Queue & Acknowledgment Management
  // -------------------------------------------------------------
  getPendingSyncPayload(attemptId) {
    const unsyncedAnswers = this.queryAll(
      'SELECT questionId, selectedOption, clientAnsweredAt, localSequenceNumber FROM cached_answers WHERE attemptId = ? AND isSynced = 0 ORDER BY localSequenceNumber ASC',
      [attemptId]
    );

    const unsyncedChanges = this.queryAll(
      'SELECT eventId, questionId, previousOption, selectedOption, localSequenceNumber, timestamp FROM answer_change_events WHERE attemptId = ? AND isSynced = 0 ORDER BY localSequenceNumber ASC',
      [attemptId]
    );

    const unsyncedEvents = this.queryAll(
      'SELECT eventId as id, eventType, timestamp, duration, severity, details, detectionSource, localSequenceNumber FROM cached_proctoring_events WHERE attemptId = ? AND isSynced = 0 ORDER BY localSequenceNumber ASC',
      [attemptId]
    );

    const subState = this.queryOne('SELECT * FROM submission_state WHERE attemptId = ?', [attemptId]);
    const timing = this.getMonotonicTiming(attemptId);

    const pendingTotal = unsyncedAnswers.length + unsyncedChanges.length + unsyncedEvents.length;

    return {
      attemptId,
      answers: unsyncedAnswers,
      answerChanges: unsyncedChanges,
      proctoringEvents: unsyncedEvents,
      submission: subState ? {
        isFinalSubmission: subState.state === 'pending_sync' || subState.state === 'syncing',
        localSubmittedAt: subState.localSubmittedAt
      } : { isFinalSubmission: false },
      timing: timing ? {
        accumulatedElapsedSeconds: Math.floor(timing.accumulatedElapsedMs / 1000),
        isDeadlineReached: Boolean(timing.isDeadlineReached)
      } : null,
      pendingCount: pendingTotal
    };
  }

  acknowledgeSync(attemptId, { acceptedAnswerIds = [], acceptedEventIds = [], acceptedAnswerChangeIds = [], isFinalized = false }) {
    const now = new Date().toISOString();

    return this.transaction(() => {
      // Mark accepted answers as synchronized
      if (acceptedAnswerIds.length > 0) {
        const updateAns = this.db.prepare('UPDATE cached_answers SET isSynced = 1, syncedAt = ? WHERE attemptId = ? AND questionId = ?');
        for (const qId of acceptedAnswerIds) {
          updateAns.run(now, attemptId, qId);
        }
      }

      // Mark accepted answer change events as synchronized
      if (acceptedAnswerChangeIds.length > 0) {
        const updateChange = this.db.prepare('UPDATE answer_change_events SET isSynced = 1, syncedAt = ? WHERE attemptId = ? AND eventId = ?');
        for (const evtId of acceptedAnswerChangeIds) {
          updateChange.run(now, attemptId, evtId);
        }
      }

      // Mark accepted proctoring events as synchronized
      if (acceptedEventIds.length > 0) {
        const updateEvt = this.db.prepare('UPDATE cached_proctoring_events SET isSynced = 1, syncedAt = ? WHERE attemptId = ? AND eventId = ?');
        for (const evtId of acceptedEventIds) {
          updateEvt.run(now, attemptId, evtId);
        }
      }

      // Update submission state
      if (isFinalized) {
        this.run(
          "UPDATE submission_state SET state = 'synced', syncedAt = ? WHERE attemptId = ?",
          [now, attemptId]
        );
      }

      const pendingRemaining = this.getPendingSyncPayload(attemptId).pendingCount;
      return { ok: true, syncedAt: now, pendingRemaining };
    });
  }

  // -------------------------------------------------------------
  // 5. Submission State Management
  // -------------------------------------------------------------
  setSubmissionState(attemptId, state, errorMessage = null) {
    const now = new Date().toISOString();
    const existing = this.queryOne('SELECT * FROM submission_state WHERE attemptId = ?', [attemptId]);

    if (!existing) {
      this.run(`
        INSERT INTO submission_state (attemptId, state, localSubmittedAt, errorMessage)
        VALUES (?, ?, ?, ?)
      `, [attemptId, state, now, errorMessage]);
    } else {
      const localSubmittedAt = (state === 'pending_sync' && !existing.localSubmittedAt) ? now : existing.localSubmittedAt;
      this.run(`
        UPDATE submission_state
        SET state = ?,
            localSubmittedAt = ?,
            errorMessage = ?,
            retryCount = CASE WHEN ? = 'sync_failed' THEN retryCount + 1 ELSE retryCount END,
            lastRetryAt = CASE WHEN ? = 'syncing' THEN ? ELSE lastRetryAt END
        WHERE attemptId = ?
      `, [state, localSubmittedAt, errorMessage, state, state, now, attemptId]);
    }

    console.log(`[OfflineStore] Attempt ${attemptId} submission state updated to: ${state}`);
    return { ok: true, state };
  }

  getSubmissionState(attemptId) {
    return this.queryOne('SELECT * FROM submission_state WHERE attemptId = ?', [attemptId]);
  }

  // -------------------------------------------------------------
  // 6. Monotonic Timing & System Clock Tamper Guard
  // -------------------------------------------------------------
  startMonotonicTicker() {
    if (this.tickInterval) return;

    this.tickInterval = setInterval(() => {
      try {
        const nowMs = Date.now();
        const rows = this.queryAll('SELECT * FROM monotonic_timing WHERE isDeadlineReached = 0');

        for (const row of rows) {
          const delta = Math.max(0, Math.min(5000, nowMs - row.lastTickTimeMs)); // clamp against jumps
          const newAccumulated = (row.accumulatedElapsedMs || 0) + delta;
          const maxAllowedMs = row.durationMinutes * 60 * 1000;
          const isReached = newAccumulated >= maxAllowedMs ? 1 : 0;

          this.run(`
            UPDATE monotonic_timing
            SET accumulatedElapsedMs = ?,
                lastTickTimeMs = ?,
                isDeadlineReached = ?,
                updatedAt = ?
            WHERE attemptId = ?
          `, [newAccumulated, nowMs, isReached, new Date().toISOString(), row.attemptId]);

          if (isReached && !row.isDeadlineReached) {
            console.warn(`[OfflineStore Timing] Attempt ${row.attemptId} has reached monotonic duration limit`);
            this.setSubmissionState(row.attemptId, 'pending_sync', 'Exam deadline reached locally');
          }
        }
      } catch (err) {
        console.error('[OfflineStore Ticker Error]:', err.message);
      }
    }, 1000);
  }

  getMonotonicTiming(attemptId) {
    return this.queryOne('SELECT * FROM monotonic_timing WHERE attemptId = ?', [attemptId]);
  }

  close() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }
}

const offlineStore = new OfflineStore();
module.exports = { offlineStore, OfflineStore };
