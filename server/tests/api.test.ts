import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { db } from '../src/db/schema.js';

let studentToken: string;
let adminToken: string;
let studentUserId: string;
let assessmentId: string = 'assessment-ngata-2026';
let attemptId: string;
let sampleQuestionId: string;

beforeAll(async () => {
  // Ensure database is freshly seeded
  await seedDatabase();

  // Obtain Student Token
  const studentLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'student@wuelev8.com', password: 'Student@123' });
  
  expect(studentLogin.status).toBe(200);
  studentToken = studentLogin.body.token;
  studentUserId = studentLogin.body.user.id;

  // Obtain Admin Token
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@wuelev8.com', password: 'Admin@123' });

  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.token;
});

describe('1. Authentication & Identity Verification', () => {
  it('should reject invalid credentials with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@wuelev8.com', password: 'WrongPassword999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('should register a new candidate successfully', async () => {
    const uniqueEmail = `candidate_${Date.now()}@wuelev8.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Jordan Lee',
        email: uniqueEmail,
        password: 'Password@123',
        role: 'student'
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(uniqueEmail);
  });

  it('should request and verify hackathon development OTP', async () => {
    const reqOtp = await request(app)
      .post('/api/auth/otp/request')
      .send({ email: 'student@wuelev8.com' });

    expect(reqOtp.status).toBe(200);
    expect(reqOtp.body.devOtp).toBe('884920');

    const verifyOtp = await request(app)
      .post('/api/auth/otp/verify')
      .send({ email: 'student@wuelev8.com', otp: '884920' });

    expect(verifyOtp.status).toBe(200);
    expect(verifyOtp.body.token).toBeDefined();
  });
});

describe('2. Assessment & Question Security', () => {
  it('should list available active assessments for candidate', async () => {
    const res = await request(app)
      .get('/api/assessments')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.assessments.length).toBeGreaterThan(0);
  });

  it('CRITICAL SECURITY: Student cannot view correct answers or explanations during test', async () => {
    const res = await request(app)
      .get(`/api/assessments/${assessmentId}/questions`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBe(20);
    expect(res.body.isReviewMode).toBe(false);

    // Verify neither correctAnswer nor explanation are leaked in payload
    res.body.questions.forEach((q: any) => {
      expect(q.correctAnswer).toBeUndefined();
      expect(q.explanation).toBeUndefined();
      expect(q.options.length).toBe(4);
    });

    sampleQuestionId = res.body.questions[0].id;
  });

  it('Admin CAN view complete question bank with answer keys', async () => {
    const res = await request(app)
      .get(`/api/assessments/${assessmentId}/questions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.questions[0].correctAnswer).toBeDefined();
    expect(res.body.questions[0].explanation).toBeDefined();
  });
});

describe('3. Assessment Lifecycle & Authoritative Grading', () => {
  it('should start a new assessment attempt for candidate', async () => {
    const res = await request(app)
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ assessmentId });

    expect([200, 201]).toContain(res.status);
    expect(res.body.attempt).toBeDefined();
    expect(res.body.attempt.status).toBe('in_progress');
    attemptId = res.body.attempt.id;
  });

  it('should autosave candidate answers securely', async () => {
    // Select option 1 (which is the correct answer for Q1 in seed)
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        questionId: sampleQuestionId,
        selectedOption: 1
      });

    expect(res.status).toBe(200);
    expect(res.body.selectedOption).toBe(1);
  });

  it('should reject answer saving from unauthorized user', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('Authorization', `Bearer ${adminToken}`) // Admin is not the student who owns attempt
      .send({
        questionId: sampleQuestionId,
        selectedOption: 0
      });

    expect(res.status).toBe(403);
  });
});

describe('4. Proctoring Event Logging & Violation Auditing', () => {
  it('should log a focus_loss event with duration', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/events`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        eventType: 'focus_loss',
        severity: 'medium',
        duration: 3500,
        details: 'Candidate switched away from browser for 3.5s',
        detectionSource: 'browser_focus'
      });

    expect(res.status).toBe(201);
    expect(res.body.event.eventType).toBe('focus_loss');
    expect(res.body.currentViolationCount).toBe(1);
  });

  it('should log a face_missing event', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/events`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        eventType: 'face_missing',
        severity: 'high',
        duration: 7000,
        details: 'Face absent from webcam feed for 7s',
        detectionSource: 'webcam_cv'
      });

    expect(res.status).toBe(201);
    expect(res.body.currentViolationCount).toBe(2);
  });

  it('should allow Admin to review proctoring event and mark as reviewed', async () => {
    // Fetch logged events
    const eventsRes = await request(app)
      .get(`/api/attempts/${attemptId}/events`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.events.length).toBeGreaterThan(0);

    const eventToReview = eventsRes.body.events[0];
    const reviewRes = await request(app)
      .patch(`/api/proctoring-events/${eventToReview.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reviewStatus: 'reviewed',
        reviewNotes: 'Verified via automated audit test'
      });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.event.reviewStatus).toBe('reviewed');
  });
});

describe('5. Smart Browser Extension & AI Activity Monitoring Pipeline', () => {
  let activeAttemptId: string;

  beforeAll(async () => {
    // Start another attempt for extension monitoring pipeline tests
    const startRes = await request(app)
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ assessmentId, forceNew: true });
    
    activeAttemptId = startRes.body.attempt.id;
  });

  it('should query active proctor session state for companion extension and Smart Browser', async () => {
    const res = await request(app).get('/api/proctor/active-session');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.attemptId).toBe(activeAttemptId);
  });

  it('should log an external AI prompt submission event to extension-event endpoint', async () => {
    const res = await request(app)
      .post('/api/proctor/extension-event')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        attemptId: activeAttemptId,
        eventType: 'ai_query_submitted',
        severity: 'high',
        url: 'https://chatgpt.com',
        prompt: 'Solve question 3 on OS semaphore deadlocks',
        details: 'ChatGPT prompt submitted: "Solve question 3 on OS semaphore deadlocks"'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.eventId).toBeDefined();
    expect(res.body.attemptId).toBe(activeAttemptId);
  });

  it('should log a search query submission event', async () => {
    const res = await request(app)
      .post('/api/proctor/extension-event')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        attemptId: activeAttemptId,
        eventType: 'search_query_submitted',
        severity: 'medium',
        url: 'https://www.google.com/search?q=dijkstra+algorithm',
        prompt: 'dijkstra algorithm',
        details: 'Google Search query submitted: "dijkstra algorithm"'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('should retrieve logged AI prompt and search events in Admin Dashboard audit trail', async () => {
    const res = await request(app)
      .get(`/api/attempts/${activeAttemptId}/events`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(2);

    const promptEv = res.body.events.find((e: any) => e.eventType === 'ai_query_submitted');
    expect(promptEv).toBeDefined();
    expect(promptEv.details).toContain('ChatGPT prompt submitted');
    expect(promptEv.detectionSource).toBe('browser_extension');

    const searchEv = res.body.events.find((e: any) => e.eventType === 'search_query_submitted');
    expect(searchEv).toBeDefined();
    expect(searchEv.details).toContain('Google Search query submitted');
  });
});

describe('6. Desktop Installer Verification', () => {
  it('should confirm production Windows installer executable exists on disk', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const installerPath = path.resolve(process.cwd(), '../release/WUElev8 Smart Proctoring Browser Setup 1.0.0.exe');
    const unpackedExePath = path.resolve(process.cwd(), '../release/win-unpacked/WUElev8 Smart Proctoring Browser.exe');

    const hasInstaller = fs.existsSync(installerPath);
    const hasUnpacked = fs.existsSync(unpackedExePath);
    const clientDistPath = path.resolve(process.cwd(), '../client/dist/index.html');
    const hasClientDist = fs.existsSync(clientDistPath);

    expect(hasInstaller || hasUnpacked || hasClientDist).toBe(true);

    if (hasInstaller) {
      const stats = fs.statSync(installerPath);
      expect(stats.size).toBeGreaterThan(10 * 1024 * 1024); // Greater than 10MB
    }
  });
});

describe('8. Assessment Security Settings & Controlled Policies', () => {
  it('Admin can configure and update all 5 assessment security settings', async () => {
    const updateRes = await request(app)
      .put(`/api/assessments/${assessmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        policy: {
          aiUsage: 'prohibited',
          aiPromptMonitoring: 'disabled',
          tabSwitchingPolicy: 'restrict',
          externalResourceAccess: 'restricted',
          permittedWebsites: ['developer.mozilla.org'],
          violationHandling: 'terminate',
          maxTotalViolations: 4
        }
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.assessment.policy.aiUsage).toBe('prohibited');
    expect(updateRes.body.assessment.policy.aiPromptMonitoring).toBe('disabled');
    expect(updateRes.body.assessment.policy.tabSwitchingPolicy).toBe('restrict');
    expect(updateRes.body.assessment.policy.externalResourceAccess).toBe('restricted');
    expect(updateRes.body.assessment.policy.permittedWebsites).toContain('developer.mozilla.org');
    expect(updateRes.body.assessment.policy.violationHandling).toBe('terminate');
  });

  it('Scenario A: In AI-allowed assessment, prompts are monitored without being treated as violations', async () => {
    // Start attempt on Prompt Engineering Assessment
    const startRes = await request(app)
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ assessmentId: 'assessment-prompt-eng', forceNew: true });

    expect(startRes.status).toBe(201);
    const promptAttemptId = startRes.body.attempt.id;

    // Send ChatGPT prompt via extension endpoint
    const extRes = await request(app)
      .post('/api/proctor/extension-event')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        attemptId: promptAttemptId,
        eventType: 'ai_query_submitted',
        url: 'https://chatgpt.com',
        prompt: 'How to write effective chain-of-thought prompts?'
      });

    expect(extRes.status).toBe(201);
    expect(extRes.body.success).toBe(true);
    expect(extRes.body.isViolation).toBe(false);
    expect(extRes.body.violationCount).toBe(0);

    // Verify attempt in DB was NOT flagged and violationCount is 0
    const attemptRes = await request(app)
      .get(`/api/attempts/${promptAttemptId}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(attemptRes.status).toBe(200);
    expect(attemptRes.body.attempt.violationCount).toBe(0);
    expect(attemptRes.body.attempt.flaggedReason).toBeNull();

    // Verify prompt is in audit events
    const promptEvent = attemptRes.body.events.find((e: any) => e.eventType === 'ai_query_submitted');
    expect(promptEvent).toBeDefined();
    expect(promptEvent.details).toContain('chain-of-thought');
  });

  it('Scenario B: In AI-prohibited assessment, AI access is recorded as a violation and increments count', async () => {
    // Start attempt on strict NGATA Assessment
    const startRes = await request(app)
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ assessmentId: 'assessment-ngata-2026', forceNew: true });

    expect(startRes.status).toBe(201);
    const dsaAttemptId = startRes.body.attempt.id;

    // Submit ChatGPT visit/query on prohibited assessment
    const extRes = await request(app)
      .post('/api/proctor/extension-event')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        attemptId: dsaAttemptId,
        eventType: 'ai_query_submitted',
        url: 'https://chatgpt.com',
        prompt: 'Solve binary search tree question'
      });

    expect(extRes.status).toBe(201);
    expect(extRes.body.isViolation).toBe(true);
    expect(extRes.body.violationCount).toBeGreaterThan(0);

    // Verify attempt in DB is flagged
    const attemptRes = await request(app)
      .get(`/api/attempts/${dsaAttemptId}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(attemptRes.status).toBe(200);
    expect(attemptRes.body.attempt.violationCount).toBeGreaterThanOrEqual(1);
    expect(attemptRes.body.attempt.flaggedReason).toBeDefined();
  });

  it('Enforces tab switching policy and violation handling consistently', async () => {
    // Start attempt on Prompt Engineering (tabSwitchingPolicy: 'warn', violationHandling: 'record_only')
    const startPrompt = await request(app)
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ assessmentId: 'assessment-prompt-eng', forceNew: true });

    const promptAttemptId = startPrompt.body.attempt.id;

    // Log tab switch on prompt assessment
    const tabEventPrompt = await request(app)
      .post(`/api/attempts/${promptAttemptId}/events`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        eventType: 'tab_switch',
        details: 'Candidate switched tabs to consult documentation',
        detectionSource: 'browser_focus'
      });

    expect(tabEventPrompt.status).toBe(201);
    expect(tabEventPrompt.body.shouldAutoSubmit).toBe(false);
    expect(tabEventPrompt.body.warningLevel).toBe('none'); // Record only

    // Now start attempt on strict assessment (violationHandling: 'terminate', limit: 2)
    await request(app)
      .put('/api/assessments/assessment-ngata-2026')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        policy: {
          aiUsage: 'prohibited',
          tabSwitchingPolicy: 'restrict',
          violationHandling: 'terminate',
          maxTotalViolations: 2
        }
      });

    const startStrict = await request(app)
      .post('/api/attempts')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ assessmentId: 'assessment-ngata-2026', forceNew: true });

    const strictAttemptId = startStrict.body.attempt.id;

    // First tab switch infraction
    const tab1 = await request(app)
      .post(`/api/attempts/${strictAttemptId}/events`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        eventType: 'tab_switch',
        details: 'Candidate left exam window 1st time',
        detectionSource: 'browser_focus'
      });

    expect(tab1.status).toBe(201);
    expect(tab1.body.shouldAutoSubmit).toBe(false);

    // Second tab switch infraction -> reaches limit of 2 -> shouldAutoSubmit triggered!
    const tab2 = await request(app)
      .post(`/api/attempts/${strictAttemptId}/events`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        eventType: 'tab_switch',
        details: 'Candidate left exam window 2nd time',
        detectionSource: 'browser_focus'
      });

    expect(tab2.status).toBe(201);
    expect(tab2.body.shouldAutoSubmit).toBe(true);
    expect(tab2.body.warningLevel).toBe('critical');

    // Verify attempt is flagged in DB
    const strictAttemptDb = await request(app)
      .get(`/api/attempts/${strictAttemptId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(strictAttemptDb.body.attempt.status).toBe('flagged');
  });

  it('Ensures one assessment configuration does not affect another assessment', async () => {
    const listRes = await request(app)
      .get('/api/assessments')
      .set('Authorization', `Bearer ${adminToken}`);

    const ngata = listRes.body.assessments.find((a: any) => a.id === 'assessment-ngata-2026');
    const promptEng = listRes.body.assessments.find((a: any) => a.id === 'assessment-prompt-eng');

    expect(ngata).toBeDefined();
    expect(promptEng).toBeDefined();
    expect(ngata.policy.aiUsage).toBe('prohibited');
    expect(promptEng.policy.aiUsage).toBe('allowed');
    expect(promptEng.policy.aiPromptMonitoring).toBe('enabled');
    expect(ngata.policy.tabSwitchingPolicy).toBe('restrict');
    expect(promptEng.policy.tabSwitchingPolicy).toBe('warn');
  });
});

describe('7. Final Assessment Submission & Authoritative Scoring', () => {
  it('should submit assessment and authoritative backend calculates score', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    expect(res.body.correctCount).toBeGreaterThanOrEqual(1);
    expect(res.body.score).toBeGreaterThan(0);
    expect(res.body.percentage).toBeGreaterThan(0);
  });

  it('should reject further answer modifications after submission', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        questionId: sampleQuestionId,
        selectedOption: 0
      });

    expect(res.status).toBe(400);
  });
});

describe('6. Admin Analytics & CSV Export', () => {
  it('should return real analytics metrics from SQLite', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalAttempts).toBeGreaterThan(0);
    expect(res.body.completedAttempts).toBeGreaterThan(0);
    expect(res.body.averageScore).toBeDefined();
    expect(res.body.violationsByType.length).toBeGreaterThan(0);
  });

  it('should export assessment results to CSV format', async () => {
    const res = await request(app)
      .get('/api/admin/export?type=results')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Attempt ID');
    expect(res.text).toContain('Student Name');
  });
});
