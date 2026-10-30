import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/schema.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function startAttempt(req: AuthenticatedRequest, res: Response) {
  try {
    const { assessmentId, forceNew } = req.body;
    const user = req.user!;

    if (!assessmentId) {
      return res.status(400).json({ error: 'Assessment ID is required' });
    }

    const assessment: any = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment.status !== 'active') {
      return res.status(400).json({ error: 'This assessment is currently inactive' });
    }

    if (forceNew) {
      // Mark any prior in-progress attempt as timed_out so a fresh one starts
      db.prepare(`
        UPDATE attempts 
        SET status = 'timed_out', submittedAt = ? 
        WHERE assessmentId = ? AND studentId = ? AND status = 'in_progress'
      `).run(new Date().toISOString(), assessmentId, user.id);
    }

    // Check if an in-progress attempt already exists for this student
    const existingAttempt: any = !forceNew ? db.prepare(`
      SELECT * FROM attempts 
      WHERE assessmentId = ? AND studentId = ? AND status = 'in_progress'
      ORDER BY startedAt DESC LIMIT 1
    `).get(assessmentId, user.id) : null;

    if (existingAttempt) {
      // Calculate elapsed time
      const startTime = new Date(existingAttempt.startedAt).getTime();
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const totalSeconds = assessment.durationMinutes * 60;
      const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

      // If time has expired, submit it automatically
      if (remainingSeconds <= 0) {
        return internalScoreAttempt(existingAttempt.id, 'timed_out', res);
      }

      const answers = db.prepare('SELECT questionId, selectedOption FROM answers WHERE attemptId = ?').all(existingAttempt.id);

      return res.json({
        message: 'Resuming existing attempt',
        attempt: existingAttempt,
        remainingSeconds,
        savedAnswers: answers
      });
    }

    // Create a new attempt
    const attemptId = `attempt-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO attempts (id, studentId, assessmentId, startedAt, status, score, totalPossibleScore, percentage, violationCount)
      VALUES (?, ?, ?, ?, 'in_progress', 0, ?, 0, 0)
    `).run(attemptId, user.id, assessmentId, now, assessment.totalMarks);

    return res.status(201).json({
      message: 'Assessment attempt started',
      attempt: {
        id: attemptId,
        studentId: user.id,
        assessmentId,
        startedAt: now,
        status: 'in_progress',
        durationMinutes: assessment.durationMinutes
      },
      remainingSeconds: assessment.durationMinutes * 60,
      savedAnswers: []
    });
  } catch (err: any) {
    console.error('Start attempt error:', err);
    return res.status(500).json({ error: 'Failed to start attempt' });
  }
}

export function getAttemptById(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const user = req.user!;

    const attempt: any = db.prepare(`
      SELECT att.*, a.title as assessmentTitle, a.durationMinutes, a.totalMarks, a.passMarks, a.policy, u.name as studentName, u.email as studentEmail
      FROM attempts att
      JOIN assessments a ON a.id = att.assessmentId
      JOIN users u ON u.id = att.studentId
      WHERE att.id = ?
    `).get(id);

    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    // Authorization: student can only view their own attempt; admin can view any
    if (user.role === 'student' && attempt.studentId !== user.id) {
      return res.status(403).json({ error: 'Access denied to this attempt' });
    }

    // Calculate time remaining if in_progress
    let remainingSeconds = 0;
    if (attempt.status === 'in_progress') {
      const startTime = new Date(attempt.startedAt).getTime();
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const totalSeconds = attempt.durationMinutes * 60;
      remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

      if (remainingSeconds <= 0 && user.role !== 'admin') {
        return internalScoreAttempt(attempt.id, 'timed_out', res);
      }
    }

    // Get answers
    const answers = db.prepare(`
      SELECT questionId, selectedOption, isCorrect, answeredAt
      FROM answers
      WHERE attemptId = ?
    `).all(id);

    // Get proctoring events
    const events = db.prepare(`
      SELECT * FROM proctoring_events
      WHERE attemptId = ?
      ORDER BY timestamp DESC
    `).all(id);

    return res.json({
      attempt: {
        ...attempt,
        policy: JSON.parse(attempt.policy || '{}')
      },
      remainingSeconds,
      answers,
      events
    });
  } catch (err: any) {
    console.error('Get attempt error:', err);
    return res.status(500).json({ error: 'Failed to retrieve attempt' });
  }
}

export function saveAnswer(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const { questionId, selectedOption } = req.body;
    const user = req.user!;

    if (!questionId || selectedOption === undefined) {
      return res.status(400).json({ error: 'questionId and selectedOption are required' });
    }

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.studentId !== user.id) {
      return res.status(403).json({ error: 'Unauthorized attempt access' });
    }

    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: `Cannot save answers for an attempt that is ${attempt.status}` });
    }

    // Check time remaining
    const assessment: any = db.prepare('SELECT durationMinutes FROM assessments WHERE id = ?').get(attempt.assessmentId);
    const startTime = new Date(attempt.startedAt).getTime();
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    if (elapsedSeconds > assessment.durationMinutes * 60) {
      return internalScoreAttempt(attemptId as string, 'timed_out', res);
    }

    // Upsert answer
    const answerId = `ans-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO answers (id, attemptId, questionId, selectedOption, isCorrect, answeredAt)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(attemptId, questionId) DO UPDATE SET
        selectedOption = excluded.selectedOption,
        answeredAt = excluded.answeredAt
    `).run(answerId, attemptId, questionId, parseInt(selectedOption, 10), now);

    return res.json({
      message: 'Answer autosaved successfully',
      questionId,
      selectedOption: parseInt(selectedOption, 10),
      savedAt: now
    });
  } catch (err: any) {
    console.error('Save answer error:', err);
    return res.status(500).json({ error: 'Failed to save answer' });
  }
}

export function submitAttempt(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const user = req.user!;

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.studentId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized submission' });
    }

    if (attempt.status === 'submitted' || attempt.status === 'flagged') {
      return res.json({
        message: `Assessment has already been finalized (${attempt.status})`,
        status: attempt.status,
        score: attempt.score,
        totalPossibleScore: attempt.totalPossibleScore,
        percentage: attempt.percentage,
        correctCount: 0,
        totalQuestions: 0,
        submittedAt: attempt.submittedAt
      });
    }

    return internalScoreAttempt(attemptId as string, 'submitted', res);
  } catch (err: any) {
    console.error('Submit attempt error:', err);
    return res.status(500).json({ error: 'Failed to submit assessment' });
  }
}

// Server-side authoritative grading calculation
function calculateAndSaveScore(attemptId: string, targetStatus: 'submitted' | 'timed_out') {
  const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  const assessment: any = db.prepare('SELECT * FROM assessments WHERE id = ?').get(attempt.assessmentId);
  const questions: any[] = db.prepare('SELECT id, correctAnswer FROM questions WHERE assessmentId = ?').all(attempt.assessmentId);
  const studentAnswers: any[] = db.prepare('SELECT questionId, selectedOption FROM answers WHERE attemptId = ?').all(attemptId);

  const answerMap = new Map<string, number>();
  studentAnswers.forEach(a => answerMap.set(a.questionId, a.selectedOption));

  let correctCount = 0;
  const updateAnswerStmt = db.prepare('UPDATE answers SET isCorrect = ? WHERE attemptId = ? AND questionId = ?');

  const updateBatch = db.transaction(() => {
    questions.forEach(q => {
      const selected = answerMap.get(q.id);
      const isCorrect = selected !== undefined && selected === q.correctAnswer ? 1 : 0;
      if (isCorrect) correctCount++;
      if (selected !== undefined) {
        updateAnswerStmt.run(isCorrect, attemptId, q.id);
      }
    });
  });
  updateBatch();

  const totalQuestions = questions.length;
  const marksPerQuestion = totalQuestions > 0 ? (assessment.totalMarks / totalQuestions) : 0;
  const finalScore = Math.round((correctCount * marksPerQuestion) * 100) / 100;
  const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 10000) / 100 : 0;
  const submittedAt = new Date().toISOString();

  db.prepare(`
    UPDATE attempts
    SET status = ?, submittedAt = ?, score = ?, totalPossibleScore = ?, percentage = ?
    WHERE id = ?
  `).run(targetStatus, submittedAt, finalScore, assessment.totalMarks, percentage, attemptId);

  return {
    status: targetStatus,
    score: finalScore,
    totalPossibleScore: assessment.totalMarks,
    percentage,
    correctCount,
    totalQuestions,
    submittedAt
  };
}

function internalScoreAttempt(attemptId: string, targetStatus: 'submitted' | 'timed_out', res: Response) {
  const result = calculateAndSaveScore(attemptId, targetStatus);
  return res.json({
    message: targetStatus === 'timed_out' ? 'Assessment time expired and auto-submitted' : 'Assessment submitted successfully',
    ...result
  });
}

// -------------------------------------------------------------
// Offline Examination Mode: Authorization & Assessment Package
// -------------------------------------------------------------
export function getOfflinePackage(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const user = req.user!;

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.studentId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized attempt access' });
    }

    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: `Cannot download offline package for attempt that is ${attempt.status}` });
    }

    const assessment: any = db.prepare('SELECT * FROM assessments WHERE id = ?').get(attempt.assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    const policy = JSON.parse(assessment.policy || '{}');

    // Policy check: Offline mode is disabled by default unless explicitly allowed
    if (policy.allowOfflineMode === false || policy.connectivityPolicy === 'require_continuous') {
      return res.status(403).json({
        error: 'Offline Mode is disabled for this assessment by administrative policy. Continuous connectivity is required.',
        policy: {
          allowOfflineMode: false,
          connectivityPolicy: policy.connectivityPolicy || 'require_continuous'
        }
      });
    }

    // Authoritative timing verification
    const startTimeMs = new Date(attempt.startedAt).getTime();
    const durationSeconds = assessment.durationMinutes * 60;
    const elapsedSeconds = Math.floor((Date.now() - startTimeMs) / 1000);
    const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);

    if (remainingSeconds <= 0) {
      return internalScoreAttempt(attempt.id, 'timed_out', res);
    }

    const serverExpiryTime = new Date(startTimeMs + durationSeconds * 1000).toISOString();
    const now = new Date().toISOString();

    // Query sanitized questions: NEVER send correctAnswer or explanation to student!
    const questions: any[] = db.prepare(`
      SELECT id, assessmentId, questionText, options, category, orderIndex
      FROM questions
      WHERE assessmentId = ?
      ORDER BY orderIndex ASC
    `).all(assessment.id).map((q: any) => ({
      ...q,
      options: JSON.parse(q.options)
    }));

    const savedAnswers = db.prepare(`
      SELECT questionId, selectedOption, clientAnsweredAt, localSequenceNumber
      FROM answers
      WHERE attemptId = ?
    `).all(attempt.id);

    // Save snapshot of policy and record offline package authorization
    db.prepare(`
      UPDATE attempts
      SET offlinePackageGeneratedAt = ?,
          policySnapshot = COALESCE(policySnapshot, ?),
          syncStatus = 'synced',
          lastSyncAt = ?
      WHERE id = ?
    `).run(now, assessment.policy, now, attempt.id);

    return res.json({
      ok: true,
      package: {
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        attemptId: attempt.id,
        studentId: user.id,
        studentName: user.name,
        questions,
        savedAnswers,
        policySnapshot: policy,
        serverStartTime: attempt.startedAt,
        durationMinutes: assessment.durationMinutes,
        serverExpiryTime,
        remainingSeconds,
        permittedDomains: policy.permittedWebsites || [],
        sessionExpiry: serverExpiryTime,
        generatedAt: now,
        version: '1.0'
      }
    });
  } catch (err: any) {
    console.error('Get offline package error:', err);
    return res.status(500).json({ error: 'Failed to generate offline assessment package' });
  }
}

// -------------------------------------------------------------
// Offline Examination Mode: Batch Synchronization
// -------------------------------------------------------------
export function syncAttemptBatch(req: AuthenticatedRequest, res: Response) {
  try {
    const attemptId = req.params.id as string;
    const user = req.user!;
    const {
      answers = [],
      answerChanges = [],
      proctoringEvents = [],
      submission,
      submissionState,
      clientReportedStatus = 'online',
      offlineDurationSeconds = 0,
      pendingCount = 0
    } = req.body;

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.studentId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized attempt access' });
    }

    const assessment: any = db.prepare('SELECT * FROM assessments WHERE id = ?').get(attempt.assessmentId);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Explicit conflict handling:
    // If the attempt has already been finalized or revoked on the server, reject conflicting submissions
    if (attempt.status === 'submitted' || attempt.status === 'flagged') {
      const isSubmitting =
        submission?.isFinalSubmission ||
        submissionState?.state === 'pending_sync' ||
        submissionState?.state === 'submitted' ||
        clientReportedStatus === 'submitted';

      if (isSubmitting) {
        const nowIso = new Date().toISOString();
        return res.json({
          ok: true,
          success: true,
          attemptId,
          acceptedAnswerIds: [],
          acceptedEventIds: [],
          acceptedAnswerChangeIds: [],
          status: attempt.status,
          attemptStatus: attempt.status,
          clientReportedStatus: 'submitted',
          serverTimestamp: nowIso,
          syncedAt: nowIso,
          syncTimestamp: nowIso,
          isFinalized: true,
          score: attempt.score,
          percentage: attempt.percentage,
          finalizedAt: attempt.submittedAt,
          message: `Attempt was already finalized on server (${attempt.status}).`
        });
      }

      return res.status(409).json({
        error: `Attempt is already finalized (${attempt.status}). Conflicting offline modifications rejected.`,
        attemptStatus: attempt.status,
        acceptedAnswerIds: [],
        acceptedEventIds: [],
        finalizedAt: attempt.submittedAt,
        score: attempt.score
      });
    }

    // Check timing & deadline (with 120s grace period for synchronization latency)
    const startTimeMs = new Date(attempt.startedAt).getTime();
    const durationSeconds = assessment.durationMinutes * 60;
    const graceWindowSeconds = 120;
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const isPastDeadline = nowMs > (startTimeMs + (durationSeconds + graceWindowSeconds) * 1000);

    const acceptedAnswerIds: string[] = [];
    const acceptedEventIds: string[] = [];
    const acceptedAnswerChangeIds: string[] = [];

    // Query valid question IDs for this assessment
    const validQuestions: any[] = db.prepare('SELECT id FROM questions WHERE assessmentId = ?').all(assessment.id);
    const validQuestionSet = new Set(validQuestions.map(q => q.id));

    // Atomic transaction for all answers, audit logs, and proctoring records
    const executeBatch = db.transaction(() => {
      // 1. Process Answers
      const upsertAnswerStmt = db.prepare(`
        INSERT INTO answers (id, attemptId, questionId, selectedOption, isCorrect, answeredAt, clientAnsweredAt, localSequenceNumber)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(attemptId, questionId) DO UPDATE SET
          selectedOption = excluded.selectedOption,
          answeredAt = excluded.answeredAt,
          clientAnsweredAt = excluded.clientAnsweredAt,
          localSequenceNumber = excluded.localSequenceNumber
        WHERE excluded.localSequenceNumber >= COALESCE(answers.localSequenceNumber, 0)
      `);

      for (const ans of answers) {
        if (!ans.questionId || ans.selectedOption === undefined) continue;
        if (!validQuestionSet.has(ans.questionId)) continue; // ignore invalid questions

        const answerId = `ans-${uuidv4().slice(0, 8)}`;
        const clientTimestamp = ans.clientAnsweredAt || now;
        const seq = typeof ans.localSequenceNumber === 'number' ? ans.localSequenceNumber : 0;
        const opt = parseInt(ans.selectedOption, 10);

        upsertAnswerStmt.run(answerId, attemptId, ans.questionId, opt, now, clientTimestamp, seq);
        acceptedAnswerIds.push(ans.questionId);
      }

      // 2. Process Answer Change Events (Auditing & Timeline)
      const insertChangeStmt = db.prepare(`
        INSERT OR IGNORE INTO answer_change_events (id, attemptId, questionId, previousOption, selectedOption, localSequenceNumber, timestamp, syncedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const change of answerChanges) {
        const selected = change.selectedOption !== undefined ? change.selectedOption : change.newOption;
        if (!change.eventId || !change.questionId || selected === undefined) continue;
        const seq = typeof change.localSequenceNumber === 'number' ? change.localSequenceNumber : 0;
        insertChangeStmt.run(
          change.eventId,
          attemptId,
          change.questionId,
          change.previousOption !== undefined ? change.previousOption : null,
          parseInt(selected, 10),
          seq,
          change.timestamp || change.clientTimestamp || now,
          now
        );
        acceptedAnswerChangeIds.push(change.eventId);
      }

      // 3. Process Proctoring Events
      const insertEventStmt = db.prepare(`
        INSERT OR IGNORE INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus, localSequenceNumber, isOfflineEvent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1)
      `);

      for (const evt of proctoringEvents) {
        const eventId = evt.eventId || evt.id;
        if (!eventId || !evt.eventType) continue;
        const seq = typeof evt.localSequenceNumber === 'number' ? evt.localSequenceNumber : 0;
        insertEventStmt.run(
          eventId,
          attemptId,
          evt.eventType,
          evt.timestamp || now,
          evt.duration || 0,
          evt.severity || 'low',
          evt.details || 'Offline proctoring event recorded',
          evt.detectionSource || 'electron_browser',
          seq
        );
        acceptedEventIds.push(eventId);
      }

      // 4. Update attempt synchronization metadata
      db.prepare(`
        UPDATE attempts
        SET lastSyncAt = ?,
            syncStatus = 'synced',
            pendingSyncCount = ?,
            clientReportedStatus = ?,
            offlineDurationSeconds = COALESCE(offlineDurationSeconds, 0) + ?
        WHERE id = ?
      `).run(now, pendingCount, clientReportedStatus, Math.max(0, offlineDurationSeconds), attemptId);
    });

    executeBatch();

    // 5. Final Submission or Deadline Auto-submit
    let finalStatus: string = attempt.status;
    let scoreResult: any = null;

    const shouldFinalize =
      submission?.isFinalSubmission ||
      submissionState?.state === 'pending_sync' ||
      submissionState?.state === 'submitted' ||
      clientReportedStatus === 'submitted';

    if (shouldFinalize) {
      scoreResult = calculateAndSaveScore(attemptId as string, 'submitted');
      finalStatus = 'submitted';
    } else if (isPastDeadline && attempt.status === 'in_progress') {
      scoreResult = calculateAndSaveScore(attemptId as string, 'timed_out');
      finalStatus = 'timed_out';
    }

    return res.json({
      ok: true,
      success: true,
      attemptId,
      acceptedAnswerIds,
      acceptedEventIds,
      acceptedAnswerChangeIds,
      status: finalStatus,
      attemptStatus: finalStatus,
      clientReportedStatus,
      serverTimestamp: now,
      syncedAt: now,
      syncTimestamp: now,
      isFinalized: finalStatus !== 'in_progress',
      score: scoreResult ? scoreResult.score : attempt.score,
      percentage: scoreResult ? scoreResult.percentage : attempt.percentage
    });
  } catch (err: any) {
    console.error('Sync attempt batch error:', err);
    return res.status(500).json({ error: 'Failed to synchronize assessment data' });
  }
}

// -------------------------------------------------------------
// Offline Examination Mode: Synchronization Status Check
// -------------------------------------------------------------
export function getAttemptSyncStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const user = req.user!;

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.studentId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized attempt access' });
    }

    return res.json({
      attemptId: attempt.id,
      status: attempt.status,
      lastSyncAt: attempt.lastSyncAt,
      syncStatus: attempt.syncStatus || 'online',
      pendingSyncCount: attempt.pendingSyncCount || 0,
      clientReportedStatus: attempt.clientReportedStatus || 'online',
      score: attempt.score,
      percentage: attempt.percentage,
      submittedAt: attempt.submittedAt,
      isFinalized: attempt.status === 'submitted' || attempt.status === 'timed_out' || attempt.status === 'flagged'
    });
  } catch (err: any) {
    console.error('Get sync status error:', err);
    return res.status(500).json({ error: 'Failed to retrieve sync status' });
  }
}
