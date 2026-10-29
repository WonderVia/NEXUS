import React, { useState, useEffect } from 'react';
import { Assessment, Attempt, ProctoringEvent, Question, User, AnalyticsSummary } from '../types';
import { analyticsAPI, assessmentsAPI, questionsAPI, proctoringAPI, attemptsAPI } from '../services/api';
import { 
  BarChart3, Users, BookOpen, ShieldAlert, Download, CheckCircle2, 
  XCircle, AlertTriangle, Clock, Search, Filter, RefreshCw, Plus, 
  Trash2, Edit3, Eye, FileText, Check, ChevronRight, Sliders, Bot,
  ArrowUpRight, ArrowDownLeft, Sparkles, Send, Globe, MessageSquare
} from 'lucide-react';


export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'analytics' | 'attempts' | 'assessments' | 'students'>('analytics');
  
  // Data states
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter states
  const [statusFilter, setStatusFilter] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [selectedAttemptAudit, setSelectedAttemptAudit] = useState<{
    attempt: Attempt;
    events: ProctoringEvent[];
  } | null>(null);
  const [isAuditingLoading, setIsAuditingLoading] = useState(false);

  const [selectedAssessmentForQuestions, setSelectedAssessmentForQuestions] = useState<Assessment | null>(null);
  const [questionsList, setQuestionsList] = useState<Question[]>([]);
  const [isQuestionsLoading, setIsQuestionsLoading] = useState(false);

  // Policy Editor Modal
  const [editingPolicyAssessment, setEditingPolicyAssessment] = useState<Assessment | null>(null);
  const [policyForm, setPolicyForm] = useState<any>(null);

  // Question Form Modal
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newOptions, setNewOptions] = useState(['', '', '', '']);
  const [newCorrectAnswer, setNewCorrectAnswer] = useState(0);
  const [newCategory, setNewCategory] = useState('Computer Science');
  const [newExplanation, setNewExplanation] = useState('');

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [anData, attData, assData, stData] = await Promise.all([
        analyticsAPI.getAnalytics(),
        analyticsAPI.getAllAttempts(),
        assessmentsAPI.list(),
        analyticsAPI.getStudents()
      ]);
      setAnalytics(anData);
      setAttempts(attData.attempts);
      setAssessments(assData.assessments);
      setStudents(stData.students);
    } catch (err) {
      console.error('Failed to load admin dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Open Attempt Audit Timeline Modal
  const openAttemptAudit = async (attempt: Attempt) => {
    setIsAuditingLoading(true);
    try {
      const res = await attemptsAPI.getById(attempt.id);
      setSelectedAttemptAudit({
        attempt: res.attempt,
        events: res.events || []
      });
    } catch (err) {
      alert('Failed to load attempt audit trail');
    } finally {
      setIsAuditingLoading(false);
    }
  };

  // Mark event as reviewed
  const handleReviewEvent = async (eventId: string, reviewStatus: 'reviewed' | 'dismissed' | 'violation_confirmed') => {
    try {
      await proctoringAPI.reviewEvent(eventId, { reviewStatus, reviewNotes: `Updated via Admin Console` });
      if (selectedAttemptAudit) {
        setSelectedAttemptAudit({
          ...selectedAttemptAudit,
          events: selectedAttemptAudit.events.map(ev => 
            ev.id === eventId ? { ...ev, reviewStatus } : ev
          )
        });
      }
    } catch (err) {
      alert('Failed to update event review status');
    }
  };

  // Open Questions Manager for an assessment
  const openQuestionsManager = async (assessment: Assessment) => {
    setSelectedAssessmentForQuestions(assessment);
    setIsQuestionsLoading(true);
    try {
      const res = await questionsAPI.getByAssessment(assessment.id);
      setQuestionsList(res.questions);
    } catch (e) {
      alert('Failed to load questions');
    } finally {
      setIsQuestionsLoading(false);
    }
  };

  // Handle Question Creation
  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssessmentForQuestions) return;

    try {
      await questionsAPI.create(selectedAssessmentForQuestions.id, {
        questionText: newQuestionText,
        options: newOptions,
        correctAnswer: newCorrectAnswer,
        category: newCategory,
        explanation: newExplanation
      });
      setShowQuestionModal(false);
      // Reset form
      setNewQuestionText('');
      setNewOptions(['', '', '', '']);
      setNewExplanation('');
      // Reload questions
      openQuestionsManager(selectedAssessmentForQuestions);
    } catch (err: any) {
      alert(err.message || 'Failed to add question');
    }
  };

  // Handle Question Delete
  const handleDeleteQuestion = async (qId: string) => {
    if (!confirm('Are you sure you want to remove this question?')) return;
    try {
      await questionsAPI.delete(qId);
      if (selectedAssessmentForQuestions) {
        openQuestionsManager(selectedAssessmentForQuestions);
      }
    } catch (err) {
      alert('Failed to delete question');
    }
  };

  // Save Policy Changes
  const handleSavePolicy = async () => {
    if (!editingPolicyAssessment || !policyForm) return;
    try {
      await assessmentsAPI.update(editingPolicyAssessment.id, {
        durationMinutes: policyForm.durationMinutes,
        policy: policyForm.policy
      });
      setEditingPolicyAssessment(null);
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to update assessment policy');
    }
  };

  // Filtered attempts
  const filteredAttempts = attempts.filter(att => {
    const matchesStatus = !statusFilter || att.status === statusFilter;
    const matchesFlag = !flaggedOnly || (att.status === 'flagged' || (att.violationCount && att.violationCount >= 3));
    const matchesSearch = !searchQuery || (
      (att.studentName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (att.studentEmail?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (att.assessmentTitle?.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    return matchesStatus && matchesFlag && matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-800 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
              Admin & Proctor Console
            </span>
            <span className="text-xs text-slate-400">• WUElev8 Assessment Suite</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Assessment Operations & Auditing
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Export Results CSV */}
          <a
            href={analyticsAPI.getExportUrl('results')}
            download
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>Export Scores (CSV)</span>
          </a>

          {/* Export Events CSV */}
          <a
            href={analyticsAPI.getExportUrl('events')}
            download
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Export Events (CSV)</span>
          </a>

          <button
            onClick={loadAllData}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 mb-8 overflow-x-auto">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-2 ${
            activeTab === 'analytics'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Assessment Analytics
        </button>

        <button
          onClick={() => setActiveTab('attempts')}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-2 ${
            activeTab === 'attempts'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <ShieldAlert className="w-4 h-4" /> Proctoring Attempts & Audit ({attempts.length})
        </button>

        <button
          onClick={() => setActiveTab('assessments')}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-2 ${
            activeTab === 'assessments'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Assessments & Questions ({assessments.length})
        </button>

        <button
          onClick={() => setActiveTab('students')}
          className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center gap-2 ${
            activeTab === 'students'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" /> Candidates Directory ({students.length})
        </button>
      </div>

      {/* TAB 1: ANALYTICS */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-8">
          {/* 5 Real Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Attempts</div>
              <div className="text-2xl font-black text-white mt-1">{analytics.totalAttempts}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{analytics.totalStudents} Registered Students</div>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Completed</div>
              <div className="text-2xl font-black text-emerald-400 mt-1">{analytics.completedAttempts}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{analytics.completionRate}% Completion Rate</div>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Average Score</div>
              <div className="text-2xl font-black text-blue-400 mt-1">{analytics.averageScore}%</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Authoritative Backend Graded</div>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Flagged Sessions</div>
              <div className="text-2xl font-black text-amber-400 mt-1">{analytics.flaggedSessions}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Proctoring Violations &gt;3</div>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl col-span-2 lg:col-span-1">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Tests</div>
              <div className="text-2xl font-black text-purple-400 mt-1">{analytics.totalAssessments}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">NGATA 2026 Live</div>
            </div>
          </div>

          {/* Violations Breakdown Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Observed Proctoring Violations by Category
              </h3>
              
              {analytics.violationsByType.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No proctoring violations recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.violationsByType.map((v) => (
                    <div key={v.eventType} className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-slate-200 capitalize">
                          {v.eventType.replace('_', ' ')}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase">Severity: {v.severity}</div>
                      </div>
                      <span className="font-mono text-sm font-extrabold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10">
                        {v.count} Events
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Filter className="w-4 h-4 text-purple-400" />
                Proctoring Severity Distribution
              </h3>

              {analytics.severityBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No incident data available.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.severityBreakdown.map((s) => (
                    <div key={s.severity} className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${
                          s.severity === 'critical' ? 'bg-red-500' : s.severity === 'high' ? 'bg-orange-500' : s.severity === 'medium' ? 'bg-amber-400' : 'bg-blue-400'
                        }`}></span>
                        <span className="text-xs font-bold text-slate-200 capitalize">{s.severity}</span>
                      </div>
                      <span className="font-mono text-xs font-bold text-slate-300">
                        {s.count} Incidents
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ATTEMPTS & AUDIT TIMELINE */}
      {activeTab === 'attempts' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row gap-3 bg-slate-900/70 p-4 rounded-2xl border border-slate-800">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search candidate by name, email, or test..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="in_progress">In Progress</option>
              <option value="timed_out">Timed Out</option>
              <option value="flagged">Flagged</option>
            </select>

            <label className="flex items-center gap-2 text-xs text-slate-300 px-2 cursor-pointer">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-purple-600"
              />
              <span>Flagged / High Violations Only</span>
            </label>
          </div>

          {/* Attempts Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-4">Candidate</th>
                  <th className="p-4">Assessment</th>
                  <th className="p-4">Score</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Violations</th>
                  <th className="p-4">Date / Time</th>
                  <th className="p-4 text-right">Audit Trail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredAttempts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No matching assessment attempts found.
                    </td>
                  </tr>
                ) : (
                  filteredAttempts.map((att) => {
                    const isFlagged = att.status === 'flagged' || (att.violationCount && att.violationCount >= 3);

                    return (
                      <tr key={att.id} className="hover:bg-slate-800/30 transition">
                        <td className="p-4">
                          <div className="font-bold text-white">{att.studentName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{att.studentEmail}</div>
                        </td>
                        <td className="p-4 max-w-xs truncate">
                          {att.assessmentTitle}
                        </td>
                        <td className="p-4">
                          <span className="font-mono font-bold text-white text-sm">
                            {att.percentage !== null && att.percentage !== undefined ? `${att.percentage}%` : '—'}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            att.status === 'submitted'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : att.status === 'in_progress'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {att.status}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                            isFlagged
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20 font-black'
                              : 'text-slate-300'
                          }`}>
                            {att.violationCount || 0} Events
                          </span>
                        </td>
                        <td className="p-4 text-[11px] text-slate-400 font-mono">
                          {new Date(att.startedAt).toLocaleString()}
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => openAttemptAudit(att)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-purple-600 hover:text-white text-purple-300 border border-slate-700 hover:border-purple-500 rounded-xl font-semibold transition flex items-center gap-1.5 ml-auto text-[11px]"
                          >
                            <Eye className="w-3.5 h-3.5" /> Review Timeline
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ASSESSMENTS & QUESTIONS */}
      {activeTab === 'assessments' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {assessments.map((a) => (
              <div key={a.id} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      Duration: {a.durationMinutes} Mins
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{a.questionCount || 0} Questions</span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-2">{a.title}</h3>
                  <p className="text-xs text-slate-400 line-clamp-2 mb-4">{a.description}</p>
                </div>

                <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setEditingPolicyAssessment(a);
                      setPolicyForm({
                        durationMinutes: a.durationMinutes,
                        policy: a.policy
                      });
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <Sliders className="w-3.5 h-3.5 text-blue-400" /> Configure Policy
                  </button>

                  <button
                    onClick={() => openQuestionsManager(a)}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-purple-500/20"
                  >
                    <BookOpen className="w-3.5 h-3.5" /> Manage Questions
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: STUDENTS DIRECTORY */}
      {activeTab === 'students' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4">Candidate Name</th>
                <th className="p-4">Email</th>
                <th className="p-4">Account ID</th>
                <th className="p-4">Registered Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {students.map((st) => (
                <tr key={st.id} className="hover:bg-slate-800/30">
                  <td className="p-4 font-bold text-white">{st.name}</td>
                  <td className="p-4 font-mono text-slate-300">{st.email}</td>
                  <td className="p-4 font-mono text-[11px] text-slate-400">{st.id}</td>
                  <td className="p-4 text-slate-400">{st.createdAt ? new Date(st.createdAt).toLocaleDateString() : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: Individual Student Assessment Timeline & Review */}
      {selectedAttemptAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-3xl p-6 max-h-[85vh] flex flex-col shadow-2xl">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  Proctoring Audit Timeline: {selectedAttemptAudit.attempt.studentName}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Attempt: {selectedAttemptAudit.attempt.id} • Score: {selectedAttemptAudit.attempt.percentage ?? 'N/A'}% • Status: {selectedAttemptAudit.attempt.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedAttemptAudit(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {/* Summary Statistics Pill Strip */}
            <div className="py-3 px-4 my-2 bg-slate-950/60 rounded-2xl border border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-6">
                <div>
                  <span className="text-slate-400">Total Audited Events: </span>
                  <span className="font-bold text-white">{selectedAttemptAudit.events.length}</span>
                </div>
                <div>
                  <span className="text-slate-400">AI / Search Interceptions: </span>
                  <span className="font-bold text-purple-400">
                    {selectedAttemptAudit.events.filter(e => e.eventType === 'ai_query_submitted' || e.eventType === 'ai_response_received' || e.eventType === 'search_query_submitted' || e.detectionSource === 'browser_extension').length}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">External Tab / App Switches: </span>
                  <span className="font-bold text-amber-400">
                    {selectedAttemptAudit.events.filter(e => e.eventType === 'external_site_visit' || e.eventType === 'tab_switch' || e.eventType === 'external_app_detected').length}
                  </span>
                </div>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                Chronological Audit Stream (Real-Time)
              </span>
            </div>

            {/* Timeline Stream */}
            <div className="flex-1 overflow-y-auto py-2 space-y-2.5">
              {selectedAttemptAudit.events.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  Clean Session: No anomalous proctoring events or focus loss recorded for this candidate.
                </div>
              ) : (
                [...selectedAttemptAudit.events]
                  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                  .map((ev) => {
                    const timeStr = new Date(ev.timestamp).toLocaleTimeString();
                    const isAIQuery = ev.eventType === 'ai_query_submitted';
                    const isAIResponse = ev.eventType === 'ai_response_received';
                    const isSearchQuery = ev.eventType === 'search_query_submitted';
                    const isReturn = ev.eventType === 'assessment_return';
                    const isExternalSwitch = ev.eventType === 'external_site_visit' || ev.eventType === 'tab_switch' || ev.eventType === 'external_app_detected';

                    return (
                      <div 
                        key={ev.id} 
                        className={`p-3.5 rounded-2xl border transition-all ${
                          isAIQuery ? 'bg-purple-950/30 border-purple-500/40' :
                          isAIResponse ? 'bg-cyan-950/30 border-cyan-500/40' :
                          isSearchQuery ? 'bg-blue-950/30 border-blue-500/40' :
                          isReturn ? 'bg-emerald-950/30 border-emerald-500/40' :
                          isExternalSwitch ? 'bg-amber-950/30 border-amber-500/40' :
                          'bg-slate-950/70 border-slate-800'
                        } flex items-start justify-between gap-4`}
                      >
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-slate-300 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-700">
                              {timeStr}
                            </span>

                            {isAIQuery && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full">
                                <Send className="w-3 h-3" /> AI Prompt Submitted
                              </span>
                            )}

                            {isAIResponse && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-300 bg-cyan-500/20 px-2.5 py-0.5 rounded-full">
                                <Sparkles className="w-3 h-3" /> AI Response Received
                              </span>
                            )}

                            {isSearchQuery && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-300 bg-blue-500/20 px-2.5 py-0.5 rounded-full">
                                <Search className="w-3 h-3" /> Search Query
                              </span>
                            )}

                            {isReturn && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-500/20 px-2.5 py-0.5 rounded-full">
                                <ArrowDownLeft className="w-3 h-3" /> Returned to Assessment
                              </span>
                            )}

                            {isExternalSwitch && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-500/20 px-2.5 py-0.5 rounded-full">
                                <ArrowUpRight className="w-3 h-3" /> External Navigation
                              </span>
                            )}

                            {!isAIQuery && !isAIResponse && !isSearchQuery && !isReturn && !isExternalSwitch && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                ev.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                                ev.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                ev.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-blue-500/20 text-blue-400'
                              }`}>
                                {ev.severity} • {ev.eventType.replace(/_/g, ' ')}
                              </span>
                            )}

                            <span className="text-[10px] text-slate-500 font-mono">
                              Source: {ev.detectionSource.replace(/_/g, ' ')}
                            </span>
                          </div>

                          {/* Event Text / Telemetry Content */}
                          <div className={`text-xs font-medium leading-relaxed ${
                            isAIQuery ? 'text-purple-100 font-semibold pl-2 border-l-2 border-purple-500' :
                            isAIResponse ? 'text-cyan-100 pl-2 border-l-2 border-cyan-500 font-sans' :
                            isSearchQuery ? 'text-blue-100 pl-2 border-l-2 border-blue-500' :
                            isReturn ? 'text-emerald-300 font-semibold' :
                            isExternalSwitch ? 'text-amber-200 font-semibold' :
                            'text-slate-300'
                          }`}>
                            {ev.details}
                          </div>

                          {ev.duration > 0 && (
                            <div className="text-[10px] text-slate-500 font-mono">
                              Duration recorded: {(ev.duration / 1000).toFixed(1)}s
                            </div>
                          )}
                        </div>

                        {/* Review Actions */}
                        <div className="shrink-0 flex items-center space-x-1 pt-0.5">
                          {ev.reviewStatus === 'reviewed' ? (
                            <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                              Reviewed
                            </span>
                          ) : ev.reviewStatus === 'violation_confirmed' ? (
                            <span className="text-[11px] font-semibold text-red-400 bg-red-500/10 px-2.5 py-1 rounded-lg">
                              Flagged
                            </span>
                          ) : (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleReviewEvent(ev.id, 'reviewed')}
                                className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded text-[10px] font-semibold transition"
                              >
                                Mark Reviewed
                              </button>
                              <button
                                onClick={() => handleReviewEvent(ev.id, 'violation_confirmed')}
                                className="px-2 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded text-[10px] font-semibold transition"
                              >
                                Flag
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            <div className="pt-4 border-t border-slate-800 text-right">
              <button
                onClick={() => setSelectedAttemptAudit(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
              >
                Close Audit Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Questions Management Modal */}
      {selectedAssessmentForQuestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-3xl p-6 max-h-[85vh] flex flex-col shadow-2xl">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base">
                  Question Bank: {selectedAssessmentForQuestions.title}
                </h3>
                <p className="text-xs text-slate-400">{questionsList.length} Questions Configured</p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowQuestionModal(true)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Add New Question
                </button>
                <button
                  onClick={() => setSelectedAssessmentForQuestions(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Questions list */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {questionsList.map((q, idx) => (
                <div key={q.id} className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <span className="text-xs font-bold text-blue-400">
                      Q{idx + 1} ({q.category})
                    </span>
                    <button
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="p-1 text-slate-400 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs font-medium text-white mb-2">{q.questionText}</p>
                  
                  <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className={q.correctAnswer === oIdx ? 'text-emerald-400 font-bold' : ''}>
                        {String.fromCharCode(65 + oIdx)}. {opt} {q.correctAnswer === oIdx ? '✓ (Correct)' : ''}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-800 text-right">
              <button
                onClick={() => setSelectedAssessmentForQuestions(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
              >
                Close Manager
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Question Form */}
      {showQuestionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl">
            <h3 className="font-bold text-white text-base mb-4">Add Multiple Choice Question</h3>

            <form onSubmit={handleAddQuestion} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Question Text</label>
                <textarea
                  required
                  rows={3}
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="Enter problem statement..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {newOptions.map((opt, oIdx) => (
                  <div key={oIdx}>
                    <label className="block text-slate-300 font-medium mb-1">Option {String.fromCharCode(65 + oIdx)}</label>
                    <input
                      type="text"
                      required
                      value={opt}
                      onChange={(e) => {
                        const copy = [...newOptions];
                        copy[oIdx] = e.target.value;
                        setNewOptions(copy);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Correct Answer</label>
                  <select
                    value={newCorrectAnswer}
                    onChange={(e) => setNewCorrectAnswer(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value={0}>Option A</option>
                    <option value={1}>Option B</option>
                    <option value={2}>Option C</option>
                    <option value={3}>Option D</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Category / Domain</label>
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Detailed Technical Explanation</label>
                <textarea
                  rows={2}
                  value={newExplanation}
                  onChange={(e) => setNewExplanation(e.target.value)}
                  placeholder="Explain why the answer is correct for candidate review..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowQuestionModal(false)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl"
                >
                  Save Question
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Policy Configuration Editor */}
      {editingPolicyAssessment && policyForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl">
            <h3 className="font-bold text-white text-base mb-1">Assessment & Proctoring Policy</h3>
            <p className="text-xs text-slate-400 mb-4">{editingPolicyAssessment.title}</p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Assessment Duration (Minutes)</label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={policyForm.durationMinutes}
                  onChange={(e) => setPolicyForm({ ...policyForm, durationMinutes: parseInt(e.target.value, 10) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Face Absence Timeout (Seconds before warning)</label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={policyForm.policy.faceAbsenceTimeoutSec || 7}
                  onChange={(e) => setPolicyForm({
                    ...policyForm,
                    policy: { ...policyForm.policy, faceAbsenceTimeoutSec: parseInt(e.target.value, 10) }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Max Total Violations Allowed Before Action</label>
                <input
                  type="number"
                  min={2}
                  max={15}
                  value={policyForm.policy.maxTotalViolations || 6}
                  onChange={(e) => setPolicyForm({
                    ...policyForm,
                    policy: { ...policyForm.policy, maxTotalViolations: parseInt(e.target.value, 10) }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.policy.autoSubmitOnCriticalViolations || false}
                    onChange={(e) => setPolicyForm({
                      ...policyForm,
                      policy: { ...policyForm.policy, autoSubmitOnCriticalViolations: e.target.checked }
                    })}
                    className="rounded border-slate-700 bg-slate-950 text-blue-600"
                  />
                  <span className="text-slate-300">Auto-submit assessment if critical violation limit reached</span>
                </label>
              </div>

              <div className="flex space-x-2 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingPolicyAssessment(null)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePolicy}
                  className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl"
                >
                  Save Policy Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
