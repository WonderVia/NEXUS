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

    if (attempt.status === 'submitted') {
      return res.status(400).json({ error: 'Assessment has already been submitted' });
    }

    return internalScoreAttempt(attemptId as string, 'submitted', res);
  } catch (err: any) {
    console.error('Submit attempt error:', err);
    return res.status(500).json({ error: 'Failed to submit assessment' });
  }
}

// Server-side authoritative grading
function internalScoreAttempt(attemptId: string, targetStatus: 'submitted' | 'timed_out', res: Response) {
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

  return res.json({
    message: targetStatus === 'timed_out' ? 'Assessment time expired and auto-submitted' : 'Assessment submitted successfully',
    status: targetStatus,
    score: finalScore,
    totalPossibleScore: assessment.totalMarks,
    percentage,
    correctCount,
    totalQuestions,
    submittedAt
  });
}
