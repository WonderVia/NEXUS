import { Response } from 'express';
import { db } from '../db/schema.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export function getAdminAnalytics(req: AuthenticatedRequest, res: Response) {
  try {
    const totalAttemptsRow: any = db.prepare('SELECT COUNT(*) as count FROM attempts').get();
    const completedAttemptsRow: any = db.prepare("SELECT COUNT(*) as count FROM attempts WHERE status IN ('submitted', 'timed_out')").get();
    const flaggedAttemptsRow: any = db.prepare("SELECT COUNT(*) as count FROM attempts WHERE status = 'flagged' OR violationCount >= 3").get();
    const avgScoreRow: any = db.prepare("SELECT AVG(percentage) as avgScore FROM attempts WHERE status IN ('submitted', 'timed_out')").get();
    const totalStudentsRow: any = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get();
    const totalAssessmentsRow: any = db.prepare('SELECT COUNT(*) as count FROM assessments').get();

    // Violation breakdown by event type
    const violationsByType: any[] = db.prepare(`
      SELECT eventType, COUNT(*) as count, severity
      FROM proctoring_events
      GROUP BY eventType
      ORDER BY count DESC
    `).all();

    // Severity breakdown
    const severityBreakdown: any[] = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM proctoring_events
      GROUP BY severity
    `).all();

    const totalAttempts = totalAttemptsRow?.count || 0;
    const completedAttempts = completedAttemptsRow?.count || 0;
    const completionRate = totalAttempts > 0 ? Math.round((completedAttempts / totalAttempts) * 100) : 0;
    const averageScore = avgScoreRow?.avgScore ? Math.round(avgScoreRow.avgScore * 10) / 10 : 0;

    return res.json({
      totalAttempts,
      completedAttempts,
      completionRate,
      flaggedSessions: flaggedAttemptsRow?.count || 0,
      averageScore,
      totalStudents: totalStudentsRow?.count || 0,
      totalAssessments: totalAssessmentsRow?.count || 0,
      violationsByType,
      severityBreakdown
    });
  } catch (err: any) {
    console.error('Admin analytics error:', err);
    return res.status(500).json({ error: 'Failed to retrieve analytics' });
  }
}

export function getAllAttempts(req: AuthenticatedRequest, res: Response) {
  try {
    const { assessmentId, status, flaggedOnly } = req.query;

    let query = `
      SELECT att.*, 
        u.name as studentName, 
        u.email as studentEmail, 
        a.title as assessmentTitle,
        a.durationMinutes,
        a.policy as assessmentPolicy,
        (SELECT COUNT(*) FROM proctoring_events pe WHERE pe.attemptId = att.id) as totalEventsLogged,
        (SELECT COUNT(*) FROM proctoring_events pe WHERE pe.attemptId = att.id AND pe.reviewStatus = 'pending') as pendingReviews
      FROM attempts att
      JOIN users u ON u.id = att.studentId
      JOIN assessments a ON a.id = att.assessmentId
      WHERE 1=1
    `;
    const params: any[] = [];

    if (assessmentId) {
      query += ' AND att.assessmentId = ?';
      params.push(assessmentId);
    }
    if (status) {
      query += ' AND att.status = ?';
      params.push(status);
    }
    if (flaggedOnly === 'true') {
      query += " AND (att.status = 'flagged' OR att.violationCount >= 3)";
    }

    query += ' ORDER BY att.startedAt DESC';

    const attempts = db.prepare(query).all(...params);
    return res.json({ attempts });
  } catch (err: any) {
    console.error('Get all attempts error:', err);
    return res.status(500).json({ error: 'Failed to retrieve attempts' });
  }
}

export function exportDataCsv(req: AuthenticatedRequest, res: Response) {
  try {
    const { type = 'results', assessmentId } = req.query;

    if (type === 'events') {
      let query = `
        SELECT pe.id, pe.attemptId, u.name as studentName, u.email as studentEmail, 
               a.title as assessmentTitle, pe.eventType, pe.severity, pe.duration, 
               pe.timestamp, pe.detectionSource, pe.reviewStatus, pe.details
        FROM proctoring_events pe
        JOIN attempts att ON att.id = pe.attemptId
        JOIN users u ON u.id = att.studentId
        JOIN assessments a ON a.id = att.assessmentId
      `;
      const params: any[] = [];
      if (assessmentId) {
        query += ' WHERE att.assessmentId = ?';
        params.push(assessmentId);
      }
      query += ' ORDER BY pe.timestamp DESC';

      const rows: any[] = db.prepare(query).all(...params);

      // Construct CSV
      const headers = ['Event ID', 'Attempt ID', 'Student Name', 'Student Email', 'Assessment', 'Event Type', 'Severity', 'Duration (ms)', 'Timestamp', 'Source', 'Review Status', 'Details'];
      const csvRows = [headers.join(',')];

      rows.forEach(r => {
        csvRows.push([
          `"${r.id}"`,
          `"${r.attemptId}"`,
          `"${(r.studentName || '').replace(/"/g, '""')}"`,
          `"${r.studentEmail}"`,
          `"${(r.assessmentTitle || '').replace(/"/g, '""')}"`,
          `"${r.eventType}"`,
          `"${r.severity}"`,
          r.duration || 0,
          `"${r.timestamp}"`,
          `"${r.detectionSource}"`,
          `"${r.reviewStatus}"`,
          `"${(r.details || '').replace(/"/g, '""')}"`
        ].join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="proctoring_events_${Date.now()}.csv"`);
      return res.send(csvRows.join('\r\n'));
    }

    // Default: Results export
    let query = `
      SELECT att.id, u.name as studentName, u.email as studentEmail, a.title as assessmentTitle,
             att.status, att.score, att.totalPossibleScore, att.percentage, att.violationCount,
             att.startedAt, att.submittedAt
      FROM attempts att
      JOIN users u ON u.id = att.studentId
      JOIN assessments a ON a.id = att.assessmentId
    `;
    const params: any[] = [];
    if (assessmentId) {
      query += ' WHERE att.assessmentId = ?';
      params.push(assessmentId);
    }
    query += ' ORDER BY att.startedAt DESC';

    const rows: any[] = db.prepare(query).all(...params);

    const headers = ['Attempt ID', 'Student Name', 'Student Email', 'Assessment', 'Status', 'Score', 'Total Marks', 'Percentage (%)', 'Violations', 'Started At', 'Submitted At'];
    const csvRows = [headers.join(',')];

    rows.forEach(r => {
      csvRows.push([
        `"${r.id}"`,
        `"${(r.studentName || '').replace(/"/g, '""')}"`,
        `"${r.studentEmail}"`,
        `"${(r.assessmentTitle || '').replace(/"/g, '""')}"`,
        `"${r.status}"`,
        r.score || 0,
        r.totalPossibleScore || 100,
        r.percentage || 0,
        r.violationCount || 0,
        `"${r.startedAt}"`,
        `"${r.submittedAt || ''}"`
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="assessment_results_${Date.now()}.csv"`);
    return res.send(csvRows.join('\r\n'));
  } catch (err: any) {
    console.error('Export CSV error:', err);
    return res.status(500).json({ error: 'Failed to export CSV' });
  }
}

export function getAllProctoringEvents(req: AuthenticatedRequest, res: Response) {
  try {
    const { assessmentId, eventType, severity, source, reviewStatus, isAi } = req.query;

    let query = `
      SELECT pe.*, 
             u.name as studentName, 
             u.email as studentEmail, 
             a.title as assessmentTitle,
             a.id as assessmentId
      FROM proctoring_events pe
      JOIN attempts att ON att.id = pe.attemptId
      JOIN users u ON u.id = att.studentId
      JOIN assessments a ON a.id = att.assessmentId
      WHERE 1=1
    `;
    const params: any[] = [];

    if (assessmentId) {
      query += ' AND a.id = ?';
      params.push(assessmentId);
    }
    if (eventType) {
      query += ' AND pe.eventType = ?';
      params.push(eventType);
    }
    if (severity) {
      query += ' AND pe.severity = ?';
      params.push(severity);
    }
    if (source) {
      query += ' AND pe.detectionSource = ?';
      params.push(source);
    }
    if (reviewStatus) {
      query += ' AND pe.reviewStatus = ?';
      params.push(reviewStatus);
    }
    if (isAi === 'true') {
      query += " AND (pe.eventType IN ('ai_query_submitted', 'ai_response_received') OR pe.details LIKE '%AI prompt%' OR pe.details LIKE '%ChatGPT%' OR pe.details LIKE '%Claude%' OR pe.details LIKE '%Gemini%')";
    }

    query += ' ORDER BY pe.timestamp DESC LIMIT 300';

    const events = db.prepare(query).all(...params);
    return res.json({ events });
  } catch (err: any) {
    console.error('Get all events error:', err);
    return res.status(500).json({ error: 'Failed to retrieve proctoring events' });
  }
}
