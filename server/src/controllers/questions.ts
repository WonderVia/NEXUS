import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/schema.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function getQuestionsByAssessment(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const user = req.user!;

    // Check if assessment exists
    const assessment = db.prepare('SELECT id FROM assessments WHERE id = ?').get(id);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (user.role === 'admin') {
      const questions: any[] = db.prepare(`
        SELECT id, assessmentId, questionText, options, correctAnswer, explanation, category, orderIndex
        FROM questions
        WHERE assessmentId = ?
        ORDER BY orderIndex ASC
      `).all(id);

      return res.json({
        questions: questions.map(q => ({
          ...q,
          options: JSON.parse(q.options)
        }))
      });
    }

    // Check if student has already submitted an attempt
    const submittedAttempt: any = db.prepare(`
      SELECT id, status FROM attempts 
      WHERE assessmentId = ? AND studentId = ? AND status IN ('submitted', 'timed_out', 'flagged')
      ORDER BY startedAt DESC LIMIT 1
    `).get(id, user.id);

    // If submitted, student is reviewing their completed test: allow viewing explanations & answers
    if (submittedAttempt) {
      const questions: any[] = db.prepare(`
        SELECT id, assessmentId, questionText, options, correctAnswer, explanation, category, orderIndex
        FROM questions
        WHERE assessmentId = ?
        ORDER BY orderIndex ASC
      `).all(id);

      return res.json({
        questions: questions.map(q => ({
          ...q,
          options: JSON.parse(q.options)
        })),
        isReviewMode: true
      });
    }

    // Active test taking: NEVER expose correctAnswer or explanation to student!
    const questions: any[] = db.prepare(`
      SELECT id, assessmentId, questionText, options, category, orderIndex
      FROM questions
      WHERE assessmentId = ?
      ORDER BY orderIndex ASC
    `).all(id);

    return res.json({
      questions: questions.map(q => ({
        ...q,
        options: JSON.parse(q.options)
      })),
      isReviewMode: false
    });
  } catch (err: any) {
    console.error('Get questions error:', err);
    return res.status(500).json({ error: 'Failed to retrieve questions' });
  }
}

export function createQuestion(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: assessmentId } = req.params;
    const { questionText, options, correctAnswer, explanation, category = 'General', orderIndex } = req.body;

    if (!questionText || !options || !Array.isArray(options) || options.length < 2 || correctAnswer === undefined) {
      return res.status(400).json({ error: 'Question text, at least 2 options, and correct answer index are required' });
    }

    const qId = `q-${uuidv4().slice(0, 8)}`;
    const nextOrder = orderIndex !== undefined ? orderIndex : (
      (db.prepare('SELECT MAX(orderIndex) as maxOrder FROM questions WHERE assessmentId = ?').get(assessmentId) as any)?.maxOrder || 0
    ) + 1;

    db.prepare(`
      INSERT INTO questions (id, assessmentId, questionText, options, correctAnswer, explanation, category, orderIndex)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      qId,
      assessmentId,
      questionText.trim(),
      JSON.stringify(options),
      parseInt(correctAnswer, 10),
      (explanation || '').trim(),
      category.trim(),
      nextOrder
    );

    return res.status(201).json({
      message: 'Question added successfully',
      question: {
        id: qId,
        assessmentId,
        questionText,
        options,
        correctAnswer: parseInt(correctAnswer, 10),
        explanation,
        category,
        orderIndex: nextOrder
      }
    });
  } catch (err: any) {
    console.error('Create question error:', err);
    return res.status(500).json({ error: 'Failed to create question' });
  }
}

export function updateQuestion(req: AuthenticatedRequest, res: Response) {
  try {
    const { questionId } = req.params;
    const { questionText, options, correctAnswer, explanation, category, orderIndex } = req.body;

    const existing: any = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
    if (!existing) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const updatedText = questionText !== undefined ? questionText.trim() : existing.questionText;
    const updatedOptions = options !== undefined ? JSON.stringify(options) : existing.options;
    const updatedCorrect = correctAnswer !== undefined ? parseInt(correctAnswer, 10) : existing.correctAnswer;
    const updatedExplanation = explanation !== undefined ? explanation.trim() : existing.explanation;
    const updatedCategory = category !== undefined ? category.trim() : existing.category;
    const updatedOrder = orderIndex !== undefined ? parseInt(orderIndex, 10) : existing.orderIndex;

    db.prepare(`
      UPDATE questions
      SET questionText = ?, options = ?, correctAnswer = ?, explanation = ?, category = ?, orderIndex = ?
      WHERE id = ?
    `).run(updatedText, updatedOptions, updatedCorrect, updatedExplanation, updatedCategory, updatedOrder, questionId);

    return res.json({
      message: 'Question updated successfully',
      question: {
        id: questionId,
        assessmentId: existing.assessmentId,
        questionText: updatedText,
        options: JSON.parse(updatedOptions),
        correctAnswer: updatedCorrect,
        explanation: updatedExplanation,
        category: updatedCategory,
        orderIndex: updatedOrder
      }
    });
  } catch (err: any) {
    console.error('Update question error:', err);
    return res.status(500).json({ error: 'Failed to update question' });
  }
}

export function deleteQuestion(req: AuthenticatedRequest, res: Response) {
  try {
    const { questionId } = req.params;
    const result = db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    return res.json({ message: 'Question deleted successfully' });
  } catch (err: any) {
    console.error('Delete question error:', err);
    return res.status(500).json({ error: 'Failed to delete question' });
  }
}
