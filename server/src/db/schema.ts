import path from 'path';

import fs from 'fs';

const DB_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const dbPath = path.join(DB_DIR, 'proctor.db');

function createDatabaseInstance(filePath: string): any {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    return new BetterSqlite3(filePath);
  } catch (_err) {
    // Fallback to Node.js built-in node:sqlite for Node versions where better-sqlite3 native binary is not available
    const { DatabaseSync } = require('node:sqlite');
    const syncDb = new DatabaseSync(filePath);

    return {
      exec(sql: string) {
        return syncDb.exec(sql);
      },
      pragma(pragmaStr: string) {
        return syncDb.exec(`PRAGMA ${pragmaStr}`);
      },
      prepare(sql: string) {
        const stmt = syncDb.prepare(sql);
        return {
          get(...params: any[]) {
            return stmt.get(...params);
          },
          all(...params: any[]) {
            return stmt.all(...params);
          },
          run(...params: any[]) {
            return stmt.run(...params);
          }
        };
      },
      transaction(fn: (...args: any[]) => any) {
        return (...args: any[]) => {
          syncDb.exec('BEGIN IMMEDIATE');
          try {
            const res = fn(...args);
            syncDb.exec('COMMIT');
            return res;
          } catch (error) {
            syncDb.exec('ROLLBACK');
            throw error;
          }
        };
      }
    };
  }
}

export const db = createDatabaseInstance(dbPath);

// Enable foreign keys and WAL mode for high performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'admin')),
      otp TEXT,
      otpExpiry TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      durationMinutes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'archived')),
      totalMarks INTEGER NOT NULL DEFAULT 100,
      passMarks INTEGER NOT NULL DEFAULT 40,
      policy TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      assessmentId TEXT NOT NULL,
      questionText TEXT NOT NULL,
      options TEXT NOT NULL,
      correctAnswer INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      orderIndex INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (assessmentId) REFERENCES assessments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      studentId TEXT NOT NULL,
      assessmentId TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      submittedAt TEXT,
      status TEXT NOT NULL CHECK(status IN ('in_progress', 'submitted', 'timed_out', 'flagged')),
      score REAL DEFAULT 0,
      totalPossibleScore REAL DEFAULT 0,
      percentage REAL DEFAULT 0,
      violationCount INTEGER DEFAULT 0,
      flaggedReason TEXT,
      FOREIGN KEY (studentId) REFERENCES users(id),
      FOREIGN KEY (assessmentId) REFERENCES assessments(id)
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      attemptId TEXT NOT NULL,
      questionId TEXT NOT NULL,
      selectedOption INTEGER,
      isCorrect INTEGER DEFAULT 0,
      answeredAt TEXT NOT NULL,
      FOREIGN KEY (attemptId) REFERENCES attempts(id) ON DELETE CASCADE,
      FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE CASCADE,
      UNIQUE(attemptId, questionId)
    );

    CREATE TABLE IF NOT EXISTS proctoring_events (
      id TEXT PRIMARY KEY,
      attemptId TEXT NOT NULL,
      eventType TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      details TEXT NOT NULL,
      detectionSource TEXT NOT NULL DEFAULT 'webcam_cv',
      reviewStatus TEXT NOT NULL CHECK(reviewStatus IN ('pending', 'reviewed', 'dismissed', 'violation_confirmed')),
      reviewedBy TEXT,
      reviewedAt TEXT,
      reviewNotes TEXT,
      FOREIGN KEY (attemptId) REFERENCES attempts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_questions_assessmentId ON questions(assessmentId);
    CREATE INDEX IF NOT EXISTS idx_attempts_studentId ON attempts(studentId);
    CREATE INDEX IF NOT EXISTS idx_attempts_assessmentId ON attempts(assessmentId);
    CREATE INDEX IF NOT EXISTS idx_answers_attemptId ON answers(attemptId);
    CREATE INDEX IF NOT EXISTS idx_events_attemptId ON proctoring_events(attemptId);
    CREATE INDEX IF NOT EXISTS idx_events_severity ON proctoring_events(severity);
  `);

  console.log('Database initialized successfully at:', dbPath);
}
