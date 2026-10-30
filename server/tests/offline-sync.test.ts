import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { db } from '../src/db/schema.js';

let studentToken: string;
let studentUserId: string;
let otherStudentToken: string;
let otherStudentUserId: string;
let adminToken: string;

const offlineAssessmentId = 'assessment-prompt-eng'; // allowOfflineMode: true
const onlineOnlyAssessmentId = 'assessment-ngata-2026';    // allowOfflineMode: false

beforeAll(async () => {
  await seedDatabase();

  // 1. Login primary student
  const studentLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'student@wuelev8.com', password: 'Student@123' });
  expect(studentLogin.status).toBe(200);
  studentToken = studentLogin.body.token;
  studentUserId = studentLogin.body.user.id;

  // 2. Register secondary student for access-control tests
  const uniqueEmail = `student_alt_${Date.now()}@wuelev8.com`;
  const otherLogin = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alex Rivera', email: uniqueEmail, password: 'Password@123', role: 'student' });
  expect(otherLogin.status).toBe(201);
  otherStudentToken = otherLogin.body.token;
  otherStudentUserId = otherLogin.body.user.id;

  // 3. Login admin
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@wuelev8.com', password: 'Admin@123' });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.token;
});

describe('Offline Examination Mode & Batch Synchronization', () => {

  describe('1. Offline Package Authorization & Sanitization', () => {
    let offlineAttemptId: string;
    let onlineOnlyAttemptId: string;

    it('should start an offline-capable attempt successfully', async () => {
      const res = await request(app)
        .post('/api/attempts')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ assessmentId: offlineAssessmentId, forceNew: true });

      expect(res.status).toBe(201);
      expect(res.body.attempt).toBeDefined();
      offlineAttemptId = res.body.attempt.id;
    });

    it('should deliver a sanitized offline assessment package without answer leaks', async () => {
      const res = await request(app)
        .post(`/api/attempts/${offlineAttemptId}/offline-package`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const pkg = res.body.package;
      expect(pkg).toBeDefined();
      expect(pkg.assessmentId).toBe(offlineAssessmentId);
      expect(pkg.attemptId).toBe(offlineAttemptId);
      expect(pkg.studentId).toBe(studentUserId);
      expect(pkg.policySnapshot).toBeDefined();
      expect(pkg.policySnapshot.allowOfflineMode).toBe(true);
      expect(Array.isArray(pkg.questions)).toBe(true);
      expect(pkg.questions.length).toBeGreaterThan(0);

      // CRITICAL SECURITY ASSERTION: No correctAnswer or explanation leaked!
      for (const q of pkg.questions) {
        expect(q.correctAnswer).toBeUndefined();
        expect(q.explanation).toBeUndefined();
        expect(q.options).toBeDefined();
        expect(q.questionText).toBeDefined();
      }
    });

    it('should reject offline package generation when policy prohibits offline mode', async () => {
      // Start online-only attempt
      const startRes = await request(app)
        .post('/api/attempts')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ assessmentId: onlineOnlyAssessmentId, forceNew: true });

      expect(startRes.status).toBe(201);
      onlineOnlyAttemptId = startRes.body.attempt.id;

      // Request offline package
      const res = await request(app)
        .post(`/api/attempts/${onlineOnlyAttemptId}/offline-package`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Offline Mode is disabled');
    });

    it('should prevent candidate from downloading another candidate\'s package', async () => {
      const res = await request(app)
        .post(`/api/attempts/${offlineAttemptId}/offline-package`)
        .set('Authorization', `Bearer ${otherStudentToken}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  describe('2. Batch Synchronization & Transaction Integrity', () => {
    let syncAttemptId: string;
    let questions: any[];

    beforeAll(async () => {
      const startRes = await request(app)
        .post('/api/attempts')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ assessmentId: offlineAssessmentId, forceNew: true });
      syncAttemptId = startRes.body.attempt.id;

      const qRes = await request(app)
        .get(`/api/assessments/${offlineAssessmentId}/questions`)
        .set('Authorization', `Bearer ${studentToken}`);
      questions = qRes.body.questions;
    });

    it('should accept and synchronize answers in batch', async () => {
      const q1 = questions[0];
      const q2 = questions[1];

      const syncPayload = {
        answers: [
          {
            questionId: q1.id,
            selectedOption: 1,
            clientAnsweredAt: new Date().toISOString(),
            localSequenceNumber: 1
          },
          {
            questionId: q2.id,
            selectedOption: 0,
            clientAnsweredAt: new Date().toISOString(),
            localSequenceNumber: 2
          }
        ],
        answerChanges: [
          {
            eventId: `evt-chg-${Date.now()}-1`,
            questionId: q1.id,
            previousOption: -1,
            newOption: 1,
            clientTimestamp: new Date().toISOString(),
            localSequenceNumber: 1
          }
        ],
        proctoringEvents: [
          {
            eventId: `evt-proc-${Date.now()}-1`,
            eventType: 'tab_switch',
            severity: 'low',
            details: 'Tab switch recorded while offline',
            detectionSource: 'electron_browser',
            timestamp: new Date().toISOString(),
            localSequenceNumber: 1
          }
        ],
        clientReportedStatus: 'in_progress'
      };

      const res = await request(app)
        .post(`/api/attempts/${syncAttemptId}/sync`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(syncPayload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.acceptedAnswerIds).toHaveLength(2);
      expect(res.body.acceptedAnswerChangeIds).toHaveLength(1);
      expect(res.body.acceptedEventIds).toHaveLength(1);
      expect(res.body.isFinalized).toBe(false);
    });

    it('should be completely idempotent when same sync payload is submitted multiple times', async () => {
      const q1 = questions[0];
      const eventId = `evt-dup-${Date.now()}`;

      const duplicatePayload = {
        answers: [
          {
            questionId: q1.id,
            selectedOption: 2,
            clientAnsweredAt: new Date().toISOString(),
            localSequenceNumber: 3
          }
        ],
        answerChanges: [
          {
            eventId: `evt-chg-${eventId}`,
            questionId: q1.id,
            previousOption: 1,
            newOption: 2,
            clientTimestamp: new Date().toISOString(),
            localSequenceNumber: 2
          }
        ],
        proctoringEvents: [
          {
            eventId: `evt-proc-${eventId}`,
            eventType: 'focus_loss',
            severity: 'low',
            details: 'Offline window blur test',
            detectionSource: 'browser_focus',
            timestamp: new Date().toISOString(),
            localSequenceNumber: 2
          }
        ]
      };

      // First submission
      const res1 = await request(app)
        .post(`/api/attempts/${syncAttemptId}/sync`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(duplicatePayload);
      expect(res1.status).toBe(200);
      expect(res1.body.acceptedAnswerIds).toContain(q1.id);

      // Immediate retry of identical payload (e.g. network ACK dropped)
      const res2 = await request(app)
        .post(`/api/attempts/${syncAttemptId}/sync`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(duplicatePayload);

      expect(res2.status).toBe(200);
      expect(res2.body.ok).toBe(true);
      expect(res2.body.acceptedAnswerIds).toContain(q1.id);
    });

    it('should report sync status correctly via /sync-status', async () => {
      const res = await request(app)
        .get(`/api/attempts/${syncAttemptId}/sync-status`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.attemptId).toBe(syncAttemptId);
      expect(res.body.syncStatus).toBe('synced');
      expect(res.body.lastSyncAt).toBeDefined();
    });

    it('should finalize attempt and compute score when submitted in batch sync', async () => {
      // Prompt Engineering Q1 correctAnswer is 1 (Few-Shot Prompting)
      const q1 = questions[0];

      const finalizePayload = {
        answers: [
          {
            questionId: q1.id,
            selectedOption: 1, // Correct answer
            clientAnsweredAt: new Date().toISOString(),
            localSequenceNumber: 4
          }
        ],
        submissionState: {
          state: 'pending_sync',
          submittedAt: new Date().toISOString(),
          reason: 'Candidate completed exam offline'
        },
        clientReportedStatus: 'submitted'
      };

      const res = await request(app)
        .post(`/api/attempts/${syncAttemptId}/sync`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(finalizePayload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.isFinalized).toBe(true);
      expect(res.body.status).toBe('submitted');
      expect(res.body.score).toBeGreaterThan(0);
    });

    it('should reject new answer writes with 409 conflict after attempt is finalized', async () => {
      const q3 = questions[2];
      const conflictPayload = {
        answers: [
          {
            questionId: q3.id,
            selectedOption: 0,
            clientAnsweredAt: new Date().toISOString()
          }
        ]
      };

      const res = await request(app)
        .post(`/api/attempts/${syncAttemptId}/sync`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(conflictPayload);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('finalized');
    });
  });

  describe('3. Admin Policy Configuration & Analytics Visibility', () => {
    it('should include sync metadata in admin analytics all-attempts query', async () => {
      const res = await request(app)
        .get('/api/admin/attempts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.attempts).toBeDefined();
      const att = res.body.attempts.find((a: any) => a.assessmentId === offlineAssessmentId);
      expect(att).toBeDefined();
      expect(att.syncStatus).toBeDefined();
    });

    it('should allow admin to update assessment offline policy', async () => {
      const res = await request(app)
        .put(`/api/assessments/${offlineAssessmentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          policy: {
            allowOfflineMode: true,
            connectivityPolicy: 'allow_offline',
            maxTotalViolations: 8
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.assessment.policy.allowOfflineMode).toBe(true);
    });
  });
});
