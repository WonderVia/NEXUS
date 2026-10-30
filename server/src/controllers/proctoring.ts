import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/schema.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

function isAiRelated(eventType: string, url?: string, details?: string): boolean {
  if (['ai_query_submitted', 'ai_response_received'].includes(eventType)) return true;
  const combined = `${url || ''} ${details || ''}`.toLowerCase();
  return /chatgpt|openai|claude|anthropic|gemini\.google|perplexity|copilot\.microsoft/.test(combined);
}

function isDomainPermitted(url: string, permittedWebsites: string[]): boolean {
  if (!url || !permittedWebsites || permittedWebsites.length === 0) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return permittedWebsites.some(site => {
      const clean = site.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
      return hostname === clean || hostname.endsWith(`.${clean}`);
    });
  } catch {
    return false;
  }
}

export function logProctoringEvent(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: attemptId } = req.params;
    const { eventType, duration = 0, severity = 'low', details, detectionSource = 'webcam_cv', url } = req.body;
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

    // Check assessment policy
    const assessment: any = db.prepare('SELECT policy FROM assessments WHERE id = ?').get(attempt.assessmentId);
    const policy = JSON.parse(assessment?.policy || '{}');

    // Tab switching policy enforcement
    const isTabSwitch = eventType === 'tab_switch' || eventType === 'focus_loss';
    let isViolation = true;
    let actualSeverity = severity;

    if (isTabSwitch) {
      const tabPolicy = policy.tabSwitchingPolicy || 'warn';
      if (tabPolicy === 'allowed') {
        isViolation = false;
        actualSeverity = 'low';
      } else if (tabPolicy === 'warn') {
        actualSeverity = 'medium';
      } else if (tabPolicy === 'restrict') {
        actualSeverity = 'high';
      }
    }

    // Return to assessment is informational, never a violation
    if (eventType === 'assessment_return') {
      isViolation = false;
      actualSeverity = 'low';
    }

    const eventId = `evt-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    // Insert proctoring event
    db.prepare(`
      INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(eventId, attemptId, eventType, now, parseInt(duration, 10) || 0, actualSeverity, details, detectionSource);

    // Violation count evaluation
    let newCount = attempt.violationCount || 0;
    if (isViolation) {
      newCount += 1;
    }

    const violationHandling = policy.violationHandling || 'warn';
    let warningLevel: 'none' | 'warning' | 'critical' = 'none';
    let shouldAutoSubmit = false;

    if (violationHandling === 'record_only') {
      warningLevel = 'none';
      shouldAutoSubmit = false;
    } else if (violationHandling === 'warn') {
      if (actualSeverity === 'high' || actualSeverity === 'critical' || newCount >= (policy.maxMinorViolations || 3)) {
        warningLevel = 'warning';
      }
      if (newCount >= (policy.maxTotalViolations || 6)) {
        warningLevel = 'critical';
      }
    } else if (violationHandling === 'terminate') {
      if (actualSeverity === 'high' || actualSeverity === 'critical') {
        warningLevel = 'critical';
      } else {
        warningLevel = 'warning';
      }
      if (newCount >= (policy.maxTotalViolations || 5)) {
        shouldAutoSubmit = true;
        warningLevel = 'critical';
        db.prepare(`
          UPDATE attempts
          SET status = 'flagged', submittedAt = ?, violationCount = ?,
              flaggedReason = 'Terminated: Exceeded maximum permitted proctoring violations'
          WHERE id = ?
        `).run(now, newCount, attemptId);
      }
    }

    if (!shouldAutoSubmit) {
      db.prepare(`
        UPDATE attempts
        SET violationCount = ?,
            flaggedReason = CASE WHEN ? = 'critical' THEN 'Exceeded maximum permitted proctoring violations' ELSE flaggedReason END
        WHERE id = ?
      `).run(newCount, warningLevel, attemptId);
    }

    return res.status(201).json({
      message: 'Proctoring event logged',
      event: {
        id: eventId,
        attemptId,
        eventType,
        timestamp: now,
        duration,
        severity: actualSeverity,
        details,
        detectionSource,
        isViolation
      },
      currentViolationCount: newCount,
      warningLevel,
      shouldAutoSubmit,
      policyNotice: isViolation ? `Violation logged (${newCount}/${policy.maxTotalViolations || 6})` : 'Activity recorded (Allowed by policy)'
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
             a.id as assessmentId, a.title as assessmentTitle, a.durationMinutes, a.policy
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

    const parsedPolicy = JSON.parse(activeAttempt.policy || '{}');

    return res.json({
      active: true,
      session: {
        ...activeAttempt,
        policy: parsedPolicy
      }
    });
  } catch (err: any) {
    console.error('Get active session error:', err);
    return res.status(500).json({ error: 'Failed to query active session' });
  }
}

// Endpoint for Chrome/Edge Extension to automatically report website visits and prompts
export function logExtensionEvent(req: any, res: Response) {
  try {
    const { attemptId: providedAttemptId, eventType = 'prohibited_website', details, url, severity = 'high', prompt } = req.body;

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

    // Inspect assessment policy
    const assessment: any = db.prepare('SELECT policy FROM assessments WHERE id = ?').get(attempt.assessmentId);
    const policy = JSON.parse(assessment?.policy || '{}');

    const isAI = isAiRelated(eventType, url, details);
    const aiUsage = policy.aiUsage || 'prohibited';
    const aiPromptMonitoring = policy.aiPromptMonitoring || 'disabled';
    const externalResourceAccess = policy.externalResourceAccess || 'restricted';
    const permittedWebsites = Array.isArray(policy.permittedWebsites) ? policy.permittedWebsites : [];
    const violationHandling = policy.violationHandling || 'warn';

    const eventId = `evt-ext-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    // SCENARIO 1: AI-Related Event
    if (isAI) {
      if (aiUsage === 'allowed') {
        // If AI prompt monitoring is disabled, skip recording
        if (aiPromptMonitoring === 'disabled') {
          return res.json({
            success: true,
            ignored: true,
            message: 'AI prompt monitoring is disabled for this assessment'
          });
        }

        // Scenario A: AI usage is allowed and prompt monitoring is enabled!
        // Capture interaction for admin review WITHOUT treating it as a violation.
        const eventDetails = details || (prompt ? `AI prompt: "${prompt}"` : `Candidate visited ${url || 'AI platform'} (AI Permitted)`);
        
        db.prepare(`
          INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
          VALUES (?, ?, ?, ?, 0, 'low', ?, 'browser_extension', 'reviewed')
        `).run(eventId, targetAttemptId, eventType, now, eventDetails);

        return res.status(201).json({
          success: true,
          eventId,
          attemptId: targetAttemptId,
          violationCount: attempt.violationCount || 0,
          isViolation: false,
          eventDetails,
          notice: 'AI prompt recorded for evaluation (AI usage is permitted)'
        });
      }

      // Scenario B: AI usage is prohibited!
      // Treat as a high/critical violation
      const eventDetails = details || (prompt ? `Prohibited AI prompt attempted: "${prompt}"` : `Visited prohibited AI tool: ${url || 'AI platform'}`);
      const actualSeverity = 'critical';

      db.prepare(`
        INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
        VALUES (?, ?, ?, ?, 0, ?, ?, 'browser_extension', 'pending')
      `).run(eventId, targetAttemptId, eventType, now, actualSeverity, eventDetails);

      const newViolationCount = (attempt.violationCount || 0) + 1;
      let shouldAutoSubmit = false;

      if (violationHandling === 'terminate' && newViolationCount >= (policy.maxTotalViolations || 5)) {
        shouldAutoSubmit = true;
        db.prepare(`
          UPDATE attempts
          SET status = 'flagged', submittedAt = ?, violationCount = ?,
              flaggedReason = 'Terminated: Prohibited AI usage limit exceeded'
          WHERE id = ?
        `).run(now, newViolationCount, targetAttemptId);
      } else {
        db.prepare(`
          UPDATE attempts
          SET violationCount = ?,
              flaggedReason = 'Prohibited AI tool accessed during active exam'
          WHERE id = ?
        `).run(newViolationCount, targetAttemptId);
      }

      console.warn(`[Extension Alert Logged - Violation] Attempt ${targetAttemptId} -> ${eventDetails}`);

      return res.status(201).json({
        success: true,
        eventId,
        attemptId: targetAttemptId,
        violationCount: newViolationCount,
        isViolation: true,
        shouldAutoSubmit,
        eventDetails
      });
    }

    // SCENARIO 2: Non-AI External Navigation or Search
    const isPermitted = externalResourceAccess === 'allowed' || isDomainPermitted(url, permittedWebsites);
    const eventDetails = details || (prompt ? `Search query: "${prompt}"` : `External site visited: ${url}`);
    
    if (isPermitted) {
      db.prepare(`
        INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
        VALUES (?, ?, ?, ?, 0, 'low', ?, 'browser_extension', 'reviewed')
      `).run(eventId, targetAttemptId, eventType, now, eventDetails);

      return res.status(201).json({
        success: true,
        eventId,
        attemptId: targetAttemptId,
        violationCount: attempt.violationCount || 0,
        isViolation: false,
        eventDetails
      });
    }

    // Unapproved external resource visited
    db.prepare(`
      INSERT INTO proctoring_events (id, attemptId, eventType, timestamp, duration, severity, details, detectionSource, reviewStatus)
      VALUES (?, ?, ?, ?, 0, ?, ?, 'browser_extension', 'pending')
    `).run(eventId, targetAttemptId, eventType, now, severity, eventDetails);

    const newViolationCount = (attempt.violationCount || 0) + 1;
    let shouldAutoSubmit = false;

    if (violationHandling === 'terminate' && newViolationCount >= (policy.maxTotalViolations || 5)) {
      shouldAutoSubmit = true;
      db.prepare(`
        UPDATE attempts
        SET status = 'flagged', submittedAt = ?, violationCount = ?,
            flaggedReason = 'Terminated: Unauthorized external resources access limit exceeded'
        WHERE id = ?
      `).run(now, newViolationCount, targetAttemptId);
    } else {
      db.prepare(`
        UPDATE attempts
        SET violationCount = ?,
            flaggedReason = 'Unauthorized external website visited during active exam'
        WHERE id = ?
      `).run(newViolationCount, targetAttemptId);
    }

    console.warn(`[Extension Alert Logged] Attempt ${targetAttemptId} -> ${eventDetails}`);

    return res.status(201).json({
      success: true,
      eventId,
      attemptId: targetAttemptId,
      violationCount: newViolationCount,
      isViolation: true,
      shouldAutoSubmit,
      eventDetails
    });
  } catch (err: any) {
    console.error('Log extension event error:', err);
    return res.status(500).json({ error: 'Failed to record extension event' });
  }
}

