import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/schema.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function listAssessments(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.user!;
    
    if (user.role === 'admin') {
      const assessments: any[] = db.prepare(`
        SELECT a.*, 
          (SELECT COUNT(*) FROM questions q WHERE q.assessmentId = a.id) as questionCount,
          (SELECT COUNT(*) FROM attempts at WHERE at.assessmentId = a.id) as attemptCount
        FROM assessments a
        ORDER BY a.createdAt DESC
      `).all();

      return res.json({
        assessments: assessments.map(a => ({
          ...a,
          policy: JSON.parse(a.policy || '{}')
        }))
      });
    }

    // For student: only active assessments + their personal attempt state
    const assessments: any[] = db.prepare(`
      SELECT a.id, a.title, a.description, a.durationMinutes, a.status, a.totalMarks, a.passMarks, a.policy, a.createdAt,
        (SELECT COUNT(*) FROM questions q WHERE q.assessmentId = a.id) as questionCount,
        att.id as userAttemptId,
        att.status as userAttemptStatus,
        att.score as userScore,
        att.percentage as userPercentage,
        att.submittedAt as userSubmittedAt
      FROM assessments a
      LEFT JOIN attempts att ON att.id = (
        SELECT id FROM attempts 
        WHERE assessmentId = a.id AND studentId = ? 
        ORDER BY startedAt DESC LIMIT 1
      )
      WHERE a.status = 'active'
      ORDER BY a.createdAt DESC
    `).all(user.id);

    return res.json({
      assessments: assessments.map(a => ({
        ...a,
        policy: JSON.parse(a.policy || '{}')
      }))
    });
  } catch (err: any) {
    console.error('List assessments error:', err);
    return res.status(500).json({ error: 'Failed to retrieve assessments' });
  }
}

export function getAssessmentById(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const user = req.user!;

    const assessment: any = db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM questions q WHERE q.assessmentId = a.id) as questionCount
      FROM assessments a
      WHERE a.id = ?
    `).get(id);

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    let userAttempt = null;
    if (user.role === 'student') {
      userAttempt = db.prepare(`
        SELECT id, startedAt, submittedAt, status, score, percentage, violationCount
        FROM attempts
        WHERE assessmentId = ? AND studentId = ?
        ORDER BY startedAt DESC
        LIMIT 1
      `).get(id, user.id);
    }

    return res.json({
      assessment: {
        ...assessment,
        policy: JSON.parse(assessment.policy || '{}')
      },
      userAttempt
    });
  } catch (err: any) {
    console.error('Get assessment error:', err);
    return res.status(500).json({ error: 'Failed to retrieve assessment' });
  }
}

export function createAssessment(req: AuthenticatedRequest, res: Response) {
  try {
    const { title, description, durationMinutes, totalMarks = 100, passMarks = 40, policy } = req.body;

    if (!title || !description || !durationMinutes) {
      return res.status(400).json({ error: 'Title, description, and duration are required' });
    }

    const id = `assessment-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();
    const defaultPolicy = {
      maxMinorViolations: 3,
      maxTotalViolations: 6,
      faceAbsenceTimeoutSec: 7,
      focusLossAllowanceSec: 4,
      requireFullscreen: true,
      requireWebcam: true,
      requireMicrophone: false,
      autoSubmitOnCriticalViolations: false,
      aiUsage: 'prohibited',
      aiPromptMonitoring: 'disabled',
      tabSwitchingPolicy: 'warn',
      externalResourceAccess: 'restricted',
      permittedWebsites: [],
      violationHandling: 'warn'
    };

    const finalPolicyObj = { ...defaultPolicy, ...(policy || {}) };
    if (!Array.isArray(finalPolicyObj.permittedWebsites)) {
      finalPolicyObj.permittedWebsites = [];
    }
    const finalPolicy = JSON.stringify(finalPolicyObj);

    db.prepare(`
      INSERT INTO assessments (id, title, description, durationMinutes, status, totalMarks, passMarks, policy, createdAt)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(id, title.trim(), description.trim(), parseInt(durationMinutes, 10), totalMarks, passMarks, finalPolicy, now);

    return res.status(201).json({
      message: 'Assessment created successfully',
      assessment: {
        id,
        title,
        description,
        durationMinutes,
        status: 'active',
        policy: JSON.parse(finalPolicy),
        createdAt: now
      }
    });
  } catch (err: any) {
    console.error('Create assessment error:', err);
    return res.status(500).json({ error: 'Failed to create assessment' });
  }
}

export function updateAssessment(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const { title, description, durationMinutes, status, totalMarks, passMarks, policy } = req.body;

    const existing: any = db.prepare('SELECT * FROM assessments WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    const updatedTitle = title !== undefined ? title.trim() : existing.title;
    const updatedDesc = description !== undefined ? description.trim() : existing.description;
    const updatedDuration = durationMinutes !== undefined ? parseInt(durationMinutes, 10) : existing.durationMinutes;
    const updatedStatus = status !== undefined ? status : existing.status;
    const updatedTotal = totalMarks !== undefined ? parseInt(totalMarks, 10) : existing.totalMarks;
    const updatedPass = passMarks !== undefined ? parseInt(passMarks, 10) : existing.passMarks;
    
    let updatedPolicy = existing.policy;
    if (policy !== undefined) {
      const existingPolicyObj = JSON.parse(existing.policy || '{}');
      const mergedPolicy = { ...existingPolicyObj, ...policy };
      if (!Array.isArray(mergedPolicy.permittedWebsites)) {
        mergedPolicy.permittedWebsites = [];
      }
      updatedPolicy = JSON.stringify(mergedPolicy);
    }

    db.prepare(`
      UPDATE assessments
      SET title = ?, description = ?, durationMinutes = ?, status = ?, totalMarks = ?, passMarks = ?, policy = ?
      WHERE id = ?
    `).run(updatedTitle, updatedDesc, updatedDuration, updatedStatus, updatedTotal, updatedPass, updatedPolicy, id);

    return res.json({
      message: 'Assessment updated successfully',
      assessment: {
        id,
        title: updatedTitle,
        description: updatedDesc,
        durationMinutes: updatedDuration,
        status: updatedStatus,
        policy: JSON.parse(updatedPolicy)
      }
    });
  } catch (err: any) {
    console.error('Update assessment error:', err);
    return res.status(500).json({ error: 'Failed to update assessment' });
  }
}
