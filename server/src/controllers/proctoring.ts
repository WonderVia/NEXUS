import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/schema.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function logProctoringEvent(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const { eventType, duration = 0, severity = 'low', details, detectionSource = 'webcam_cv' } = req.body;
    const user = req.user!;

    if (!eventType || !details) {
      return res.status(400).json({ error: 'eventType and details are required' });
    }

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.studentId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to log events for this attempt' });
    }

    const eventId = `evt-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    // Insert proctoring event
    db.prepare(`
      INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(eventId, attemptId, eventType, now, parseInt(duration, 10) || 0, severity, details, detectionSource);

    // Increment violation count on attempt
    const newCount = (attempt.violationCount || 0) + 1;
    
    // Check assessment policy
    const assessment: any = db.prepare('SELECT policy FROM assessments WHERE id = ?').get(attempt.assessmentId);
    const policy = JSON.parse(assessment?.policy || '{}');
    
    // Tab switching and external website visits are audited and recorded, never forcibly closing the test
    const shouldAutoSubmit = false;
    let warningLevel: 'none' | 'warning' | 'critical' = 'none';

    if (severity === 'high' || severity === 'critical' || newCount >= (policy.maxMinorViolations || 3)) {
      warningLevel = 'warning';
    }

    if (newCount >= (policy.maxTotalViolations || 6)) {
      warningLevel = 'critical';
    }

    db.prepare(`
      UPDATE attempts
      SET violationCount = ?,
          flaggedReason = CASE WHEN ? = 'critical' THEN 'Exceeded maximum permitted proctoring violations' ELSE flaggedReason END
      WHERE id = ?
    `).run(newCount, warningLevel, attemptId);

    return res.status(201).json({
      message: 'Proctoring event logged',
      event: {
        id: eventId,
        attemptId,
        eventType,
        timestamp: now,
        duration,
        severity,
        details,
        detectionSource
      },
      currentViolationCount: newCount,
      warningLevel,
      shouldAutoSubmit,
      policyNotice: `Violation logged (${newCount}/${policy.maxTotalViolations || 6})`
    });
  } catch (err: any) {
    console.error('Log proctoring event error:', err);
    return res.status(500).json({ error: 'Failed to log proctoring event' });
  }
}

export function getAttemptEvents(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const { severity, eventType, reviewStatus } = req.query;

    let query = 'SELECT * FROM proctoring_events WHERE attemptId = ?';
    const params: any[] = [attemptId];

    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    if (eventType) {
      query += ' AND eventType = ?';
      params.push(eventType);
    }
    if (reviewStatus) {
      query += ' AND reviewStatus = ?';
      params.push(reviewStatus);
    }

    query += ' ORDER BY timestamp DESC';

    const events = db.prepare(query).all(...params);
    return res.json({ events });
  } catch (err: any) {
    console.error('Get attempt events error:', err);
    return res.status(500).json({ error: 'Failed to retrieve events' });
  }
}

export function reviewProctoringEvent(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const { reviewStatus, reviewNotes } = req.body;
    const admin = req.user!;

    if (!reviewStatus || !['pending', 'reviewed', 'dismissed', 'violation_confirmed'].includes(reviewStatus)) {
      return res.status(400).json({ error: 'Valid reviewStatus is required' });
    }

    const event: any = db.prepare('SELECT * FROM proctoring_events WHERE id = ?').get(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE proctoring_events
      SET reviewStatus = ?, reviewedBy = ?, reviewedAt = ?, reviewNotes = ?
      WHERE id = ?
    `).run(reviewStatus, admin.name, now, (reviewNotes || '').trim(), id);

    return res.json({
      message: 'Event review updated',
      event: {
        id,
        reviewStatus,
        reviewedBy: admin.name,
        reviewedAt: now,
        reviewNotes
      }
    });
  } catch (err: any) {
    console.error('Review event error:', err);
    return res.status(500).json({ error: 'Failed to update review status' });
  }
}

// Endpoint for Chrome/Edge Extension to check if an assessment is active
export function getActiveProctorSession(_req: any, res: Response) {
  try {
    const activeAttempt: any = db.prepare(`
      SELECT att.id as attemptId, att.startedAt, att.violationCount,
             u.id as studentId, u.name as studentName, u.email as studentEmail,
             a.id as assessmentId, a.title as assessmentTitle, a.durationMinutes
      FROM attempts att
      JOIN users u ON u.id = att.studentId
      JOIN assessments a ON a.id = att.assessmentId
      WHERE att.status = 'in_progress'
      ORDER BY att.startedAt DESC
      LIMIT 1
    `).get();

    if (!activeAttempt) {
      return res.json({ active: false, message: 'No active assessment in progress' });
    }

    return res.json({
      active: true,
      session: activeAttempt
    });
  } catch (err: any) {
    console.error('Get active session error:', err);
    return res.status(500).json({ error: 'Failed to query active session' });
  }
}

// Endpoint for Chrome/Edge Extension to automatically report prohibited website visits and prompts
export function logExtensionEvent(req: any, res: Response) {
  try {
    const { attemptId: providedAttemptId, eventType = 'prohibited_website', details, url, severity = 'critical', prompt } = req.body;

    let targetAttemptId = providedAttemptId;

    // If attemptId not supplied, auto-attach to the currently active attempt
    if (!targetAttemptId) {
      const active: any = db.prepare("SELECT id FROM attempts WHERE status = 'in_progress' ORDER BY startedAt DESC LIMIT 1").get();
      if (active) {
        targetAttemptId = active.id;
      } else {
        // Fallback to most recent attempt if active session just transitioned
        const recent: any = db.prepare("SELECT id FROM attempts ORDER BY startedAt DESC LIMIT 1").get();
        if (recent) {
          targetAttemptId = recent.id;
        }
      }
    }

    if (!targetAttemptId) {
      return res.status(404).json({ error: 'No assessment attempt found to associate this violation' });
    }

    const attempt: any = db.prepare('SELECT * FROM attempts WHERE id = ?').get(targetAttemptId);
    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    const eventId = `evt-ext-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();
    const eventDetails = details || (prompt ? `AI prompt submitted: "${prompt}"` : `Visited prohibited domain ${url || 'AI platform'}`);

    db.prepare(`
      INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
      VALUES (?, ?, ?, ?, 0, ?, ?, 'browser_extension', 'pending')
    `).run(eventId, targetAttemptId, eventType, now, severity, eventDetails);

    const newViolationCount = (attempt.violationCount || 0) + 1;

    db.prepare(`
      UPDATE attempts
      SET violationCount = ?,
          flaggedReason = 'Prohibited external website visited during active exam'
      WHERE id = ?
    `).run(newViolationCount, targetAttemptId);

    console.warn(`[Extension Alert Logged] Attempt ${targetAttemptId} -> ${eventDetails}`);

    return res.status(201).json({
      success: true,
      eventId,
      attemptId: targetAttemptId,
      violationCount: newViolationCount,
      eventDetails
    });
  } catch (err: any) {
    console.error('Log extension event error:', err);
    return res.status(500).json({ error: 'Failed to record extension event' });
  }
}

