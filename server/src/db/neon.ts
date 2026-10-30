import { Pool, neonConfig } from '@neondatabase/serverless';
import { CONFIG } from '../config.js';
import bcrypt from 'bcryptjs';
import { SEED_QUESTIONS } from './seed.js';

let neonPool: Pool | null = null;

export function getNeonPool(): Pool | null {
  const databaseUrl = process.env.DATABASE_URL || CONFIG.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
    return null;
  }

  if (!neonPool) {
    try {
      neonPool = new Pool({ connectionString: databaseUrl });
      console.log('[Neon Postgres] Initialized Neon connection pool');
    } catch (err: any) {
      console.error('[Neon Postgres] Failed to initialize connection pool:', err.message);
      return null;
    }
  }

  return neonPool;
}

export async function testNeonConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const pool = getNeonPool();
  if (!pool) {
    return { ok: false, error: 'DATABASE_URL is not configured or not a valid PostgreSQL connection string' };
  }

  try {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT version();');
      return { ok: true, version: res.rows[0]?.version };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function initNeonDatabase(): Promise<boolean> {
  const pool = getNeonPool();
  if (!pool) {
    console.warn('[Neon Postgres] Cannot initialize schema: No valid DATABASE_URL found');
    return false;
  }

  console.log('[Neon Postgres] Initializing Lakebase PostgreSQL tables on Neon...');

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      "passwordHash" VARCHAR(255) NOT NULL,
      role VARCHAR(32) NOT NULL,
      otp VARCHAR(32),
      "otpExpiry" VARCHAR(64),
      "createdAt" VARCHAR(64) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id VARCHAR(64) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      "durationMinutes" INTEGER NOT NULL,
      status VARCHAR(32) NOT NULL,
      "totalMarks" INTEGER NOT NULL DEFAULT 100,
      "passMarks" INTEGER NOT NULL DEFAULT 40,
      policy TEXT NOT NULL,
      "createdAt" VARCHAR(64) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id VARCHAR(64) PRIMARY KEY,
      "assessmentId" VARCHAR(64) NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      "questionText" TEXT NOT NULL,
      options TEXT NOT NULL,
      "correctAnswer" INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      category VARCHAR(128) NOT NULL DEFAULT 'General',
      "orderIndex" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id VARCHAR(64) PRIMARY KEY,
      "studentId" VARCHAR(64) NOT NULL REFERENCES users(id),
      "assessmentId" VARCHAR(64) NOT NULL REFERENCES assessments(id),
      "startedAt" VARCHAR(64) NOT NULL,
      "submittedAt" VARCHAR(64),
      status VARCHAR(32) NOT NULL,
      score NUMERIC DEFAULT 0,
      "totalPossibleScore" NUMERIC DEFAULT 0,
      percentage NUMERIC DEFAULT 0,
      "violationCount" INTEGER DEFAULT 0,
      "flaggedReason" TEXT,
      "offlinePackageGeneratedAt" VARCHAR(64),
      "lastSyncAt" VARCHAR(64),
      "syncStatus" VARCHAR(32) DEFAULT 'online',
      "pendingSyncCount" INTEGER DEFAULT 0,
      "clientReportedStatus" VARCHAR(32) DEFAULT 'online',
      "offlineDurationSeconds" INTEGER DEFAULT 0,
      "policySnapshot" TEXT
    );

    CREATE TABLE IF NOT EXISTS answers (
      id VARCHAR(64) PRIMARY KEY,
      "attemptId" VARCHAR(64) NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      "questionId" VARCHAR(64) NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      "selectedOption" INTEGER,
      "isCorrect" INTEGER DEFAULT 0,
      "answeredAt" VARCHAR(64) NOT NULL,
      "clientAnsweredAt" VARCHAR(64),
      "syncVersion" INTEGER DEFAULT 1,
      "localSequenceNumber" INTEGER DEFAULT 0,
      CONSTRAINT uq_attempt_question UNIQUE("attemptId", "questionId")
    );

    CREATE TABLE IF NOT EXISTS proctoring_events (
      id VARCHAR(64) PRIMARY KEY,
      "attemptId" VARCHAR(64) NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      "eventType" VARCHAR(64) NOT NULL,
      timestamp VARCHAR(64) NOT NULL,
      duration INTEGER DEFAULT 0,
      severity VARCHAR(32) NOT NULL,
      details TEXT NOT NULL,
      "detectionSource" VARCHAR(64) NOT NULL DEFAULT 'webcam_cv',
      "reviewStatus" VARCHAR(32) NOT NULL,
      "reviewedBy" VARCHAR(64),
      "reviewedAt" VARCHAR(64),
      "reviewNotes" TEXT,
      "localSequenceNumber" INTEGER DEFAULT 0,
      "isOfflineEvent" INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS answer_change_events (
      id VARCHAR(64) PRIMARY KEY,
      "attemptId" VARCHAR(64) NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      "questionId" VARCHAR(64) NOT NULL,
      "previousOption" INTEGER,
      "selectedOption" INTEGER NOT NULL,
      "localSequenceNumber" INTEGER NOT NULL,
      timestamp VARCHAR(64) NOT NULL,
      "syncedAt" VARCHAR(64)
    );

    CREATE INDEX IF NOT EXISTS idx_neon_questions_assessment ON questions("assessmentId");
    CREATE INDEX IF NOT EXISTS idx_neon_attempts_student ON attempts("studentId");
    CREATE INDEX IF NOT EXISTS idx_neon_attempts_assessment ON attempts("assessmentId");
    CREATE INDEX IF NOT EXISTS idx_neon_answers_attempt ON answers("attemptId");
    CREATE INDEX IF NOT EXISTS idx_neon_events_attempt ON proctoring_events("attemptId");
    CREATE INDEX IF NOT EXISTS idx_neon_events_severity ON proctoring_events(severity);
  `;

  const client = await pool.connect();
  try {
    await client.query(schemaSql);
    console.log('[Neon Postgres] All tables, relationships, and indices successfully provisioned in Neon!');
    return true;
  } catch (err: any) {
    console.error('[Neon Postgres] Schema initialization error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function seedNeonDatabase(): Promise<boolean> {
  const pool = getNeonPool();
  if (!pool) return false;

  await initNeonDatabase();

  const client = await pool.connect();
  try {
    console.log('[Neon Postgres] Checking if seed users exist in Neon...');
    const userCheck = await client.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(userCheck.rows[0].count, 10) > 0) {
      console.log('[Neon Postgres] Neon database already contains data. Skipping duplicate seed.');
      return true;
    }

    const adminHash = await bcrypt.hash('Admin@123', 10);
    const studentHash = await bcrypt.hash('Student@123', 10);
    const now = new Date().toISOString();

    await client.query(
      `INSERT INTO users (id, name, email, "passwordHash", role, "createdAt") VALUES 
       ($1, $2, $3, $4, $5, $6),
       ($7, $8, $9, $10, $11, $12)`,
      [
        'usr-admin-001', 'Institutional Administrator', 'admin@wuelev8.com', adminHash, 'admin', now,
        'usr-student-001', 'Alex Mercer', 'student@wuelev8.com', studentHash, 'student', now
      ]
    );

    const promptEngAssessmentId = 'asm-prompt-eng-001';
    const policyPromptEng = JSON.stringify({
      faceDetection: true,
      audioDetection: true,
      tabSwitchingPolicy: 'allow_monitored',
      externalResourceAccess: 'allowed',
      aiUsage: 'monitored',
      permittedExternalDomains: ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'google.com'],
      offlineExaminationCapable: true,
      minBandwidthKbps: 50
    });

    await client.query(
      `INSERT INTO assessments (id, title, description, "durationMinutes", status, "totalMarks", "passMarks", policy, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        promptEngAssessmentId,
        'AI & Prompt Engineering Technical Assessment (GenAI Assisted)',
        'Evaluate candidates on modern generative AI usage, prompt design, and decomposition.',
        30,
        'active',
        100,
        50,
        policyPromptEng,
        now
      ]
    );

    console.log('[Neon Postgres] Successfully seeded initial admin, student, and assessment into Neon!');
    return true;
  } catch (err: any) {
    console.error('[Neon Postgres] Seeding error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
