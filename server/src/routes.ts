import { Router } from 'express';
import { register, login, requestOtp, verifyOtp, getCurrentUser, getAllStudents } from './controllers/auth.js';
import { listAssessments, getAssessmentById, createAssessment, updateAssessment } from './controllers/assessments.js';
import { getQuestionsByAssessment, createQuestion, updateQuestion, deleteQuestion } from './controllers/questions.js';
import { startAttempt, getAttemptById, saveAnswer, submitAttempt, getOfflinePackage, syncAttemptBatch, getAttemptSyncStatus } from './controllers/attempts.js';
import { logProctoringEvent, getAttemptEvents, reviewProctoringEvent, getActiveProctorSession, logExtensionEvent } from './controllers/proctoring.js';
import { getAdminAnalytics, getAllAttempts, exportDataCsv, getAllProctoringEvents, getPromptEvaluationSummary } from './controllers/analytics.js';
import { authenticate, requireRole } from './middleware/auth.js';

const router = Router();

// --- Auth Routes ---
router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/logout', (_req, res) => res.json({ message: 'Logged out successfully' }));
router.post('/auth/otp/request', requestOtp);
router.post('/auth/otp/verify', verifyOtp);
router.get('/auth/me', authenticate, getCurrentUser);

// --- Assessment Routes ---
router.get('/assessments', authenticate, listAssessments);
router.get('/assessments/:id', authenticate, getAssessmentById);
router.post('/assessments', authenticate, requireRole(['admin']), createAssessment);
router.put('/assessments/:id', authenticate, requireRole(['admin']), updateAssessment);

// --- Question Routes ---
router.get('/assessments/:id/questions', authenticate, getQuestionsByAssessment);
router.post('/assessments/:id/questions', authenticate, requireRole(['admin']), createQuestion);
router.put('/questions/:questionId', authenticate, requireRole(['admin']), updateQuestion);
router.delete('/questions/:questionId', authenticate, requireRole(['admin']), deleteQuestion);

// --- Attempt Routes ---
router.post('/attempts', authenticate, startAttempt);
router.get('/attempts/:id', authenticate, getAttemptById);
router.post('/attempts/:id/answers', authenticate, saveAnswer);
router.post('/attempts/:id/submit', authenticate, submitAttempt);
router.get('/attempts/:id/package', authenticate, getOfflinePackage);
router.post('/attempts/:id/offline-package', authenticate, getOfflinePackage);
router.post('/attempts/:id/sync', authenticate, syncAttemptBatch);
router.get('/attempts/:id/sync-status', authenticate, getAttemptSyncStatus);

// --- Proctoring Routes ---
router.post('/attempts/:id/events', authenticate, logProctoringEvent);
router.get('/attempts/:id/events', authenticate, getAttemptEvents);
router.patch('/proctoring-events/:id/review', authenticate, requireRole(['admin']), reviewProctoringEvent);

// --- Chrome/Edge Extension Proctoring Endpoints ---
router.get('/proctor/active-session', getActiveProctorSession);
router.post('/proctor/extension-event', logExtensionEvent);

// --- Admin Analytics & Management Routes ---
router.get('/admin/analytics', authenticate, requireRole(['admin']), getAdminAnalytics);
router.get('/admin/attempts', authenticate, requireRole(['admin']), getAllAttempts);
router.get('/admin/events', authenticate, requireRole(['admin']), getAllProctoringEvents);
router.get('/admin/prompt-analytics', authenticate, requireRole(['admin']), getPromptEvaluationSummary);
router.get('/admin/export', authenticate, requireRole(['admin']), exportDataCsv);
router.get('/admin/students', authenticate, requireRole(['admin']), getAllStudents);

export default router;
