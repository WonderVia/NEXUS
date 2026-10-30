import React, { useState, useEffect, useMemo } from 'react';
import { Assessment, Attempt, ProctoringEvent, Question, User, AnalyticsSummary } from '../types';
import { analyticsAPI, assessmentsAPI, questionsAPI, proctoringAPI, attemptsAPI } from '../services/api';
import { 
  BarChart3, Users, BookOpen, ShieldAlert, Download, CheckCircle2, 
  XCircle, Clock, Search, Filter, RefreshCw, Plus, 
  Trash2, Eye, Check, Sliders, Bot,
  ArrowUpRight, ArrowDownLeft, Sparkles, Send, Globe,
  Activity, ShieldCheck, ShieldX, Terminal, ExternalLink, AlertOctagon,
  AlertTriangle, ChevronDown, ChevronUp, Award, HelpCircle, Layers, FileText
} from 'lucide-react';
import { evaluatePrompt, aggregatePromptAnalytics, PromptEvaluationResult } from '../utils/promptEvaluator';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'analytics' | 'attempts' | 'events' | 'prompts' | 'assessments' | 'students'>('analytics');
  
  // Data states
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [allEvents, setAllEvents] = useState<ProctoringEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter states
  const [statusFilter, setStatusFilter] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Events & Prompts Tab Filter states
  const [eventFilterAssessment, setEventFilterAssessment] = useState('');
  const [eventFilterType, setEventFilterType] = useState('');
  const [eventFilterSeverity, setEventFilterSeverity] = useState('');
  const [eventFilterSource, setEventFilterSource] = useState('');
  const [eventFilterStatus, setEventFilterStatus] = useState('');
  const [promptSearchQuery, setPromptSearchQuery] = useState('');
  const [promptQualityFilter, setPromptQualityFilter] = useState<'all' | 'exemplary' | 'good' | 'moderate' | 'poor' | 'direct_answer'>('all');
  const [expandedPromptRubricId, setExpandedPromptRubricId] = useState<string | null>(null);
  const [showJudgingGuideModal, setShowJudgingGuideModal] = useState(false);

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
  const [newPermittedDomain, setNewPermittedDomain] = useState('');

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
      const [anData, attData, assData, stData, evData] = await Promise.all([
        analyticsAPI.getAnalytics(),
        analyticsAPI.getAllAttempts(),
        assessmentsAPI.list(),
        analyticsAPI.getStudents(),
        analyticsAPI.getAllEvents()
      ]);
      setAnalytics(anData);
      setAttempts(attData.attempts);
      setAssessments(assData.assessments);
      setStudents(stData.students);
      setAllEvents(evData.events || []);
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
      setNewQuestionText('');
      setNewOptions(['', '', '', '']);
      setNewExplanation('');
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

  // Filtered AI Prompts List with Evaluation & Judging Rubric
  const evaluatedAiPrompts = useMemo(() => {
    return allEvents
      .filter(ev => 
        ev.eventType === 'ai_query_submitted' || 
        ev.eventType === 'ai_response_received' ||
        (ev.details && (
          ev.details.toLowerCase().includes('prompt') || 
          ev.details.toLowerCase().includes('chatgpt') || 
          ev.details.toLowerCase().includes('claude') ||
          ev.details.toLowerCase().includes('gemini') ||
          ev.details.toLowerCase().includes('perplexity')
        ))
      )
      .map(ev => {
        const analysis: PromptEvaluationResult = ev.promptAnalysis || evaluatePrompt(ev.details || '');
        return {
          ...ev,
          promptAnalysis: analysis
        };
      });
  }, [allEvents]);

  const promptAnalytics = useMemo(() => {
    return aggregatePromptAnalytics(evaluatedAiPrompts);
  }, [evaluatedAiPrompts]);

  const filteredAiPrompts = useMemo(() => {
    return evaluatedAiPrompts.filter(ev => {
      if (eventFilterAssessment && (ev as any).assessmentId !== eventFilterAssessment) return false;

      const analysis: PromptEvaluationResult = ev.promptAnalysis;
      if (promptQualityFilter === 'exemplary' && analysis.tier !== 'EXEMPLARY') return false;
      if (promptQualityFilter === 'good' && analysis.tier !== 'GOOD') return false;
      if (promptQualityFilter === 'moderate' && analysis.tier !== 'MODERATE') return false;
      if (promptQualityFilter === 'poor' && analysis.tier !== 'POOR_DIRECT_ANSWER' && analysis.tier !== 'LAZY_INPUT') return false;
      if (promptQualityFilter === 'direct_answer' && !analysis.isDirectAnswerSeeking) return false;

      if (promptSearchQuery) {
        const q = promptSearchQuery.toLowerCase();
        const matchText = (ev.details || '').toLowerCase();
        const matchClean = (analysis.cleanPrompt || '').toLowerCase();
        const matchStudent = ((ev.studentName || '') + (ev.studentEmail || '')).toLowerCase();
        const matchVerdict = (analysis.verdict || '').toLowerCase();
        const matchTechnique = (analysis.detectedTechniques || []).some((t: string) => t.toLowerCase().includes(q));
        const matchAnti = (analysis.detectedAntiPatterns || []).some((t: string) => t.toLowerCase().includes(q));
        return matchText.includes(q) || matchClean.includes(q) || matchStudent.includes(q) || matchVerdict.includes(q) || matchTechnique || matchAnti;
      }
      return true;
    });
  }, [evaluatedAiPrompts, eventFilterAssessment, promptQualityFilter, promptSearchQuery]);

  // Filtered Real-Time Proctoring & Security Events
  const filteredEvents = allEvents.filter(ev => {
    if (eventFilterAssessment && (ev as any).assessmentId !== eventFilterAssessment) return false;
    if (eventFilterType && ev.eventType !== eventFilterType) return false;
    if (eventFilterSeverity && ev.severity !== eventFilterSeverity) return false;
    if (eventFilterSource && ev.detectionSource !== eventFilterSource) return false;
    if (eventFilterStatus && ev.reviewStatus !== eventFilterStatus) return false;
    return true;
  });

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-white text-black font-swiss">
      
      {/* 12-Column Swiss Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b-2 border-black mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 bg-[#c90000] inline-block"></span>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-black">
              01 / OPERATIONS & AUDIT CONTROL CONSOLE
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-black uppercase tracking-tighter leading-[0.95]">
            Assessment Operations & Auditing
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Export Results CSV */}
          <a
            href={analyticsAPI.getExportUrl('results')}
            download
            className="px-3.5 py-2 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Scores (CSV)</span>
          </a>

          {/* Export Events CSV */}
          <a
            href={analyticsAPI.getExportUrl('events')}
            download
            className="px-3.5 py-2 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Events (CSV)</span>
          </a>

          <button
            onClick={loadAllData}
            title="Refresh System"
            className="p-2 bg-black hover:bg-neutral-800 text-white border-2 border-black transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b-2 border-black mb-8 overflow-x-auto bg-[#f0f0f0] pt-2 px-2 gap-2">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'analytics'
              ? 'bg-black text-white border-b-0'
              : 'bg-white text-black hover:bg-[#f0f0f0] border-transparent'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Assessment Analytics
        </button>

        <button
          onClick={() => setActiveTab('attempts')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'attempts'
              ? 'bg-black text-white border-b-0'
              : 'bg-white text-black hover:bg-[#f0f0f0] border-transparent'
          }`}
        >
          <ShieldAlert className="w-4 h-4" /> Proctoring Attempts ({attempts.length})
        </button>

        <button
          onClick={() => setActiveTab('events')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'events'
              ? 'bg-black text-white border-b-0'
              : 'bg-white text-black hover:bg-[#f0f0f0] border-transparent'
          }`}
        >
          <Activity className="w-4 h-4" /> Security & Audit Trail ({allEvents.length})
        </button>

        <button
          onClick={() => setActiveTab('prompts')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'prompts'
              ? 'bg-black text-white border-b-0'
              : 'bg-white text-black hover:bg-[#f0f0f0] border-transparent'
          }`}
        >
          <Bot className="w-4 h-4" /> AI Prompt History & Quality ({evaluatedAiPrompts.length})
        </button>

        <button
          onClick={() => setActiveTab('assessments')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'assessments'
              ? 'bg-black text-white border-b-0'
              : 'bg-white text-black hover:bg-[#f0f0f0] border-transparent'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Security Settings & Tests ({assessments.length})
        </button>

        <button
          onClick={() => setActiveTab('students')}
          className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'students'
              ? 'bg-black text-white border-b-0'
              : 'bg-white text-black hover:bg-[#f0f0f0] border-transparent'
          }`}
        >
          <Users className="w-4 h-4" /> Candidate Directory ({students.length})
        </button>
      </div>

      {/* TAB 1: ANALYTICS */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-8">
          {/* 5 Real Metric Cards in Ruled Matrix */}
          <div className="border-2 border-black bg-[#f0f0f0] grid grid-cols-2 lg:grid-cols-5 divide-y-2 lg:divide-y-0 lg:divide-x-2 divide-black">
            <div className="p-5 bg-white">
              <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-[0.12em]">Total Attempts</div>
              <div className="text-3xl font-black text-black mt-1 leading-none">{analytics.totalAttempts}</div>
              <div className="text-[10px] text-neutral-500 font-mono mt-1">{analytics.totalStudents} Registered Students</div>
            </div>

            <div className="p-5 bg-white">
              <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-[0.12em]">Completed</div>
              <div className="text-3xl font-black text-black mt-1 leading-none">{analytics.completedAttempts}</div>
              <div className="text-[10px] text-neutral-500 font-mono mt-1">{analytics.completionRate}% Completion Rate</div>
            </div>

            <div className="p-5 bg-white">
              <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-[0.12em]">Average Score</div>
              <div className="text-3xl font-black text-black mt-1 leading-none">{analytics.averageScore}%</div>
              <div className="text-[10px] text-neutral-500 font-mono mt-1">Authoritative Key Graded</div>
            </div>

            <div className="p-5 bg-white">
              <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-[0.12em]">Flagged Sessions</div>
              <div className="text-3xl font-black text-[#c90000] mt-1 leading-none">{analytics.flaggedSessions}</div>
              <div className="text-[10px] text-neutral-500 font-mono mt-1">Violations Limit Exceeded</div>
            </div>

            <div className="p-5 bg-white col-span-2 lg:col-span-1">
              <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-[0.12em]">Active Tests</div>
              <div className="text-3xl font-black text-black mt-1 leading-none">{analytics.totalAssessments}</div>
              <div className="text-[10px] text-neutral-500 font-mono mt-1">Scenario A & B Ready</div>
            </div>
          </div>

          {/* Violations Breakdown Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border-2 border-black bg-white p-6">
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-black mb-4 border-b-2 border-black pb-2 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-black" />
                <span>Observed Violations by Category</span>
              </div>
              
              {analytics.violationsByType.length === 0 ? (
                <p className="text-xs text-neutral-500 py-6 text-center font-mono">No proctoring violations recorded yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {analytics.violationsByType.map((v) => (
                    <div key={v.eventType} className="p-3 bg-[#f0f0f0] border-2 border-black flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-black uppercase tracking-tight">
                          {v.eventType.replace(/_/g, ' ')}
                        </div>
                        <div className="text-[10px] text-neutral-600 uppercase font-mono">Severity: {v.severity}</div>
                      </div>
                      <span className="font-mono text-sm font-extrabold text-black px-2.5 py-0.5 bg-white border border-black">
                        {v.count} Events
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-2 border-black bg-white p-6">
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-black mb-4 border-b-2 border-black pb-2 flex items-center gap-2">
                <Filter className="w-4 h-4 text-black" />
                <span>Severity Distribution Matrix</span>
              </div>

              {analytics.severityBreakdown.length === 0 ? (
                <p className="text-xs text-neutral-500 py-6 text-center font-mono">No incident data available.</p>
              ) : (
                <div className="space-y-2.5">
                  {analytics.severityBreakdown.map((s) => (
                    <div key={s.severity} className="p-3 bg-[#f0f0f0] border-2 border-black flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 ${s.severity === 'critical' ? 'bg-[#c90000]' : 'bg-black'}`}></span>
                        <span className="text-xs font-bold text-black uppercase tracking-[0.12em]">{s.severity}</span>
                      </div>
                      <span className="font-mono text-xs font-bold text-black">
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
          <div className="flex flex-col sm:flex-row gap-3 bg-[#f0f0f0] p-4 border-2 border-black">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search candidate by name, email, or test..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border-2 border-black pl-9 pr-4 py-2 text-xs text-black placeholder-neutral-400 focus:outline-none focus:ring-0 focus:border-black font-sans"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border-2 border-black px-3 py-2 text-xs text-black focus:outline-none font-bold uppercase tracking-[0.12em]"
            >
              <option value="">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="in_progress">In Progress</option>
              <option value="timed_out">Timed Out</option>
              <option value="flagged">Flagged</option>
            </select>

            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-black px-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                className="w-4 h-4 border-2 border-black bg-white text-black"
              />
              <span>Flagged Violations Only</span>
            </label>
          </div>

          {/* Attempts Table */}
          <div className="border-2 border-black bg-white overflow-x-auto">
            <table className="w-full text-left text-xs text-black">
              <thead className="bg-black text-white uppercase text-[10px] tracking-[0.12em] border-b-2 border-black">
                <tr>
                  <th className="p-3.5">Candidate</th>
                  <th className="p-3.5">Assessment</th>
                  <th className="p-3.5">Score</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Sync State</th>
                  <th className="p-3.5">Violations</th>
                  <th className="p-3.5">Date / Time</th>
                  <th className="p-3.5 text-right">Audit Trail</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black">
                {filteredAttempts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-neutral-500 font-mono">
                      No matching assessment attempts found.
                    </td>
                  </tr>
                ) : (
                  filteredAttempts.map((att) => {
                    const isFlagged = att.status === 'flagged' || (att.violationCount && att.violationCount >= 3);

                    return (
                      <tr key={att.id} className="hover:bg-[#f0f0f0] transition">
                        <td className="p-3.5">
                          <div className="font-bold text-black uppercase tracking-tight">{att.studentName}</div>
                          <div className="text-[10px] text-neutral-600 font-mono">{att.studentEmail}</div>
                        </td>
                        <td className="p-3.5 max-w-xs truncate font-medium">
                          {att.assessmentTitle}
                        </td>
                        <td className="p-3.5">
                          <span className="font-mono font-black text-black text-sm">
                            {att.percentage !== null && att.percentage !== undefined ? `${att.percentage}%` : '—'}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] border border-black bg-[#f0f0f0] text-black">
                            {att.status}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="flex flex-col gap-0.5">
                            <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.10em] border w-fit ${
                              att.syncStatus === 'synced'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-400'
                                : att.syncStatus === 'pending'
                                ? 'bg-amber-50 text-amber-800 border-amber-400'
                                : att.syncStatus === 'failed' || att.syncStatus === 'conflict'
                                ? 'bg-red-50 text-red-800 border-red-400'
                                : 'bg-[#f0f0f0] text-neutral-700 border-neutral-300'
                            }`}>
                              {att.syncStatus || 'synced'}
                              {att.pendingSyncCount && att.pendingSyncCount > 0 ? ` (${att.pendingSyncCount})` : ''}
                            </span>
                            {att.lastSyncAt && (
                              <span className="text-[9px] text-neutral-500 font-mono">
                                {new Date(att.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3.5">
                          <span className={`font-mono font-bold px-2 py-0.5 text-[11px] ${
                            isFlagged
                              ? 'bg-[#c90000] text-white font-black'
                              : 'text-black'
                          }`}>
                            {att.violationCount || 0} Events
                          </span>
                        </td>
                        <td className="p-3.5 text-[11px] text-neutral-600 font-mono">
                          {new Date(att.startedAt).toLocaleString()}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => openAttemptAudit(att)}
                            className="px-3 py-1.5 bg-black hover:bg-neutral-800 text-white border-2 border-black font-bold uppercase tracking-[0.12em] transition cursor-pointer flex items-center gap-1.5 ml-auto text-[11px]"
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

      {/* TAB: LIVE SECURITY & PROCTORING AUDIT TRAIL */}
      {activeTab === 'events' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-[#f0f0f0] p-4 border-2 border-black text-xs font-bold uppercase tracking-[0.10em]">
            <div>
              <label className="block text-[10px] text-neutral-600 mb-1">Assessment:</label>
              <select
                value={eventFilterAssessment}
                onChange={(e) => setEventFilterAssessment(e.target.value)}
                className="w-full bg-white border-2 border-black px-2 py-1.5 text-xs text-black focus:outline-none"
              >
                <option value="">All Assessments</option>
                {assessments.map(a => (
                  <option key={a.id} value={a.id}>{a.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-neutral-600 mb-1">Event Type:</label>
              <select
                value={eventFilterType}
                onChange={(e) => setEventFilterType(e.target.value)}
                className="w-full bg-white border-2 border-black px-2 py-1.5 text-xs text-black focus:outline-none"
              >
                <option value="">All Event Types</option>
                <option value="incognito_browser_detected">Incognito Browser Detected</option>
                <option value="external_browser_detected">External Browser Detected</option>
                <option value="unauthorized_navigation">Unauthorized Navigation</option>
                <option value="ai_query_submitted">AI Prompt Captured</option>
                <option value="tab_switch">Tab Switch / Blur</option>
                <option value="focus_loss">Focus Loss</option>
                <option value="fullscreen_exit">Fullscreen Exit Attempt</option>
                <option value="face_missing">Face Missing (CV)</option>
                <option value="multiple_faces">Multiple Faces (CV)</option>
                <option value="exam_exit_attempt">Exit / Close Attempt</option>
                <option value="window_minimized">Window Minimized</option>
                <option value="external_app_detected">External App Detected</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-neutral-600 mb-1">Severity:</label>
              <select
                value={eventFilterSeverity}
                onChange={(e) => setEventFilterSeverity(e.target.value)}
                className="w-full bg-white border-2 border-black px-2 py-1.5 text-xs text-black focus:outline-none"
              >
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low (Permitted)</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-neutral-600 mb-1">Detection Source:</label>
              <select
                value={eventFilterSource}
                onChange={(e) => setEventFilterSource(e.target.value)}
                className="w-full bg-white border-2 border-black px-2 py-1.5 text-xs text-black focus:outline-none"
              >
                <option value="">All Sources</option>
                <option value="windows_monitor">Windows OS Monitor</option>
                <option value="electron_browser">Lockdown Browser Shell</option>
                <option value="browser_navigation">Navigation Policy</option>
                <option value="browser_extension">Chrome Companion</option>
                <option value="webcam_cv">Webcam CV Tracker</option>
                <option value="electron_kiosk">Electron Kiosk Core</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-neutral-600 mb-1">Review Status:</label>
              <select
                value={eventFilterStatus}
                onChange={(e) => setEventFilterStatus(e.target.value)}
                className="w-full bg-white border-2 border-black px-2 py-1.5 text-xs text-black focus:outline-none"
              >
                <option value="">All Review Statuses</option>
                <option value="pending">Pending Review</option>
                <option value="violation_confirmed">Violation Confirmed</option>
                <option value="dismissed">Dismissed (False Alarm)</option>
                <option value="reviewed">Reviewed (Permitted)</option>
              </select>
            </div>
          </div>

          {/* Audit Events Table */}
          <div className="border-2 border-black bg-white overflow-x-auto">
            <table className="w-full text-left text-xs text-black">
              <thead className="bg-black text-white uppercase text-[10px] tracking-[0.12em] border-b-2 border-black">
                <tr>
                  <th className="p-3.5">Timestamp</th>
                  <th className="p-3.5">Candidate / Assessment</th>
                  <th className="p-3.5">Event Type & Severity</th>
                  <th className="p-3.5">Source</th>
                  <th className="p-3.5">Audited Facts & Evidence</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black">
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-neutral-500 font-mono">
                      No proctoring events match the configured filters.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((ev) => {
                    const isCritical = ev.severity === 'critical';
                    const isHigh = ev.severity === 'high';

                    return (
                      <tr key={ev.id} className="hover:bg-[#f0f0f0] transition">
                        <td className="p-3.5 font-mono text-[11px] text-neutral-600 whitespace-nowrap">
                          {new Date(ev.timestamp).toLocaleString()}
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-black uppercase tracking-tight">{ev.studentName || 'Candidate'}</div>
                          <div className="text-[10px] text-neutral-600 font-mono">{ev.assessmentTitle || ev.studentEmail}</div>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] border ${
                              isCritical ? 'bg-[#c90000] text-white border-[#c90000]' :
                              isHigh ? 'bg-black text-white border-black' :
                              ev.severity === 'medium' ? 'bg-[#f0f0f0] border-neutral-600 text-black' :
                              'bg-white border-black text-black'
                            }`}>
                              {ev.eventType.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] font-mono text-neutral-500 uppercase">
                              [{ev.severity}]
                            </span>
                          </div>
                        </td>
                        <td className="p-3.5">
                          <span className="text-[10px] font-mono bg-[#f0f0f0] px-2 py-0.5 border border-black uppercase">
                            {ev.detectionSource}
                          </span>
                        </td>
                        <td className="p-3.5 max-w-md">
                          <p className="text-xs font-mono text-neutral-900 break-words leading-relaxed">
                            {ev.details}
                          </p>
                        </td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] border ${
                            ev.reviewStatus === 'violation_confirmed' ? 'bg-[#c90000] text-white border-[#c90000]' :
                            ev.reviewStatus === 'dismissed' ? 'bg-neutral-200 text-neutral-700 border-neutral-400' :
                            ev.reviewStatus === 'reviewed' ? 'bg-black text-white border-black' :
                            'bg-amber-100 text-amber-900 border-amber-400'
                          }`}>
                            {ev.reviewStatus.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="p-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleReviewEvent(ev.id, 'violation_confirmed')}
                              className="px-2 py-1 bg-[#c90000] hover:bg-red-800 text-white text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
                              title="Confirm as verified violation"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => handleReviewEvent(ev.id, 'dismissed')}
                              className="px-2 py-1 bg-white hover:bg-black hover:text-white text-black border border-black text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
                              title="Dismiss as false positive"
                            >
                              Dismiss
                            </button>
                            <button
                              onClick={() => handleReviewEvent(ev.id, 'reviewed')}
                              className="px-2 py-1 bg-black hover:bg-neutral-800 text-white text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
                              title="Mark as reviewed permitted activity"
                            >
                              Mark OK
                            </button>
                          </div>
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

      {/* TAB: AI PROMPT HISTORY & INTERACTION AUDIT WITH QUALITY EVALUATION */}
      {activeTab === 'prompts' && (
        <div className="space-y-6">
          {/* Header & Controls */}
          <div className="bg-[#f0f0f0] p-5 border-2 border-black flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-black" />
                <h3 className="font-extrabold text-base uppercase tracking-tight text-black">
                  AI Prompt Intelligence & Quality Evaluation Matrix
                </h3>
              </div>
              <p className="text-xs text-neutral-600 font-mono mt-1">
                Automated heuristic evaluation judging Good Prompts (Problem Decomposition & Prompt Engineering) vs Bad Prompts (Direct Answer Seeking & Lazy MCQ Copying)
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowJudgingGuideModal(true)}
                className="bg-black hover:bg-neutral-800 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center gap-2"
              >
                <HelpCircle className="w-3.5 h-3.5" /> Judging Rubric & Guide
              </button>

              <select
                value={eventFilterAssessment}
                onChange={(e) => setEventFilterAssessment(e.target.value)}
                className="bg-white border-2 border-black px-3 py-1.5 text-xs text-black focus:outline-none"
              >
                <option value="">All Assessments</option>
                {assessments.map(a => (
                  <option key={a.id} value={a.id}>{a.title}</option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Search prompt, technique, candidate..."
                value={promptSearchQuery}
                onChange={(e) => setPromptSearchQuery(e.target.value)}
                className="bg-white border-2 border-black px-3 py-1.5 text-xs text-black placeholder-neutral-400 focus:outline-none w-64"
              />
            </div>
          </div>

          {/* Prompt Analytics Ruled Matrix (4 KPI Cards) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-2 border-black bg-white divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-black">
            {/* KPI 1: Average Quality Score */}
            <div className="p-5 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600 block mb-1">
                  Average Prompt Quality
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-black font-mono">
                    {promptAnalytics.averageQualityScore}
                  </span>
                  <span className="text-sm font-bold text-neutral-500 font-mono">/ 100</span>
                </div>
              </div>
              <div className="mt-3">
                <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] border ${
                  promptAnalytics.averageQualityScore >= 75 ? 'bg-emerald-600 text-white border-emerald-600' :
                  promptAnalytics.averageQualityScore >= 55 ? 'bg-green-700 text-white border-green-700' :
                  promptAnalytics.averageQualityScore >= 40 ? 'bg-amber-600 text-white border-amber-600' :
                  'bg-[#c90000] text-white border-[#c90000]'
                }`}>
                  {promptAnalytics.averageQualityScore >= 75 ? 'Exemplary Engineering' :
                   promptAnalytics.averageQualityScore >= 55 ? 'Competent Formulation' :
                   promptAnalytics.averageQualityScore >= 40 ? 'Moderate Concept Inquiries' : 'Needs Significant Training'}
                </span>
                <p className="text-[10px] font-mono text-neutral-500 mt-1">Across {promptAnalytics.totalPromptsAnalyzed} total recorded submissions</p>
              </div>
            </div>

            {/* KPI 2: Direct Answer Seeking (Cheating Flag) */}
            <div className="p-5 flex flex-col justify-between bg-white">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600 block mb-1">
                  Direct Answer Seeking Rate
                </span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-extrabold font-mono ${promptAnalytics.directAnswerSeekingCount > 0 ? 'text-[#c90000]' : 'text-black'}`}>
                    {promptAnalytics.directAnswerSeekingPercentage}%
                  </span>
                  <span className="text-xs font-bold text-neutral-500">
                    ({promptAnalytics.directAnswerSeekingCount} of {promptAnalytics.totalPromptsAnalyzed})
                  </span>
                </div>
              </div>
              <div className="mt-3">
                {promptAnalytics.directAnswerSeekingCount > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] bg-[#c90000] text-white">
                    <AlertTriangle className="w-3 h-3" /> Cheat Pattern Detected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] bg-black text-white">
                    <Check className="w-3 h-3" /> Zero Answer Solicitation
                  </span>
                )}
                <p className="text-[10px] font-mono text-neutral-500 mt-1">Direct exam option / solution queries</p>
              </div>
            </div>

            {/* KPI 3: Quality Breakdown */}
            <div className="p-5 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600 block mb-2">
                  Quality Tier Distribution
                </span>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-600"></span> Exemplary (80-100)
                    </span>
                    <span className="font-bold text-black">{promptAnalytics.qualityBreakdown.exemplary}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-green-700 font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-600"></span> Good (65-79)
                    </span>
                    <span className="font-bold text-black">{promptAnalytics.qualityBreakdown.good}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-amber-700 font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span> Moderate (45-64)
                    </span>
                    <span className="font-bold text-black">{promptAnalytics.qualityBreakdown.moderate}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#c90000] font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#c90000]"></span> Bad / Direct Answer
                    </span>
                    <span className="font-bold text-black">{promptAnalytics.qualityBreakdown.poorDirectAnswer + promptAnalytics.qualityBreakdown.lazyInput}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* KPI 4: Top Prompting Techniques */}
            <div className="p-5 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600 block mb-2">
                  Prompting Techniques Detected
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[#f0f0f0] border border-black text-black">
                    Role Persona: {promptAnalytics.techniqueFrequency['Role Assignment / Persona'] || 0}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[#f0f0f0] border border-black text-black">
                    Step-by-Step: {promptAnalytics.techniqueFrequency['Chain of Thought / Step-by-Step'] || 0}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[#f0f0f0] border border-black text-black">
                    Format Spec: {promptAnalytics.techniqueFrequency['Structured Format Specification'] || 0}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[#f0f0f0] border border-black text-black">
                    Anti-Cheat Boundary: {promptAnalytics.techniqueFrequency['Negative Boundary / Anti-Cheating Constraint'] || 0}
                  </span>
                </div>
              </div>
              <p className="text-[10px] font-mono text-neutral-500 mt-2">Active prompt design heuristics detected</p>
            </div>
          </div>

          {/* Quick Filter Buttons */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-600 shrink-0">Filter By Quality:</span>
            <button
              onClick={() => setPromptQualityFilter('all')}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer shrink-0 ${
                promptQualityFilter === 'all' ? 'bg-black text-white' : 'bg-white text-black hover:bg-[#f0f0f0]'
              }`}
            >
              All Prompts ({evaluatedAiPrompts.length})
            </button>
            <button
              onClick={() => setPromptQualityFilter('exemplary')}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer shrink-0 ${
                promptQualityFilter === 'exemplary' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-800 hover:bg-emerald-50'
              }`}
            >
              🌟 Exemplary ({promptAnalytics.qualityBreakdown.exemplary})
            </button>
            <button
              onClick={() => setPromptQualityFilter('good')}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer shrink-0 ${
                promptQualityFilter === 'good' ? 'bg-green-700 text-white border-green-700' : 'bg-white text-green-800 hover:bg-green-50'
              }`}
            >
              ✅ Good ({promptAnalytics.qualityBreakdown.good})
            </button>
            <button
              onClick={() => setPromptQualityFilter('moderate')}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer shrink-0 ${
                promptQualityFilter === 'moderate' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-800 hover:bg-amber-50'
              }`}
            >
              💡 Moderate ({promptAnalytics.qualityBreakdown.moderate})
            </button>
            <button
              onClick={() => setPromptQualityFilter('direct_answer')}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] border-2 border-[#c90000] transition cursor-pointer shrink-0 ${
                promptQualityFilter === 'direct_answer' ? 'bg-[#c90000] text-white' : 'bg-white text-[#c90000] hover:bg-red-50'
              }`}
            >
              ⚠️ Direct Answer Seekers ({promptAnalytics.directAnswerSeekingCount})
            </button>
          </div>

          {/* Prompts Cards / Ruled Table */}
          <div className="border-2 border-black bg-white overflow-hidden divide-y-2 divide-black">
            {filteredAiPrompts.length === 0 ? (
              <div className="text-center py-16 text-black">
                <Bot className="w-10 h-10 mx-auto mb-3 text-neutral-400" />
                <p className="text-sm font-bold uppercase tracking-[0.12em]">No prompts match the selected criteria</p>
                <p className="text-xs text-neutral-600 font-mono mt-1">
                  Adjust your search or filter settings to view recorded AI interactions
                </p>
              </div>
            ) : (
              filteredAiPrompts.map((promptEv) => {
                const isViolation = promptEv.severity === 'critical' || promptEv.severity === 'high';
                const analysis: PromptEvaluationResult = promptEv.promptAnalysis;
                const isExpanded = expandedPromptRubricId === promptEv.id;

                return (
                  <div key={promptEv.id} className="p-6 hover:bg-[#fafafa] transition">
                    {/* Header Row: Candidate Info & Quality Badges */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b-2 border-neutral-200 mb-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-extrabold text-sm uppercase tracking-tight text-black">
                          {promptEv.studentName || 'Candidate'}
                        </span>
                        <span className="text-neutral-400 font-mono text-xs">•</span>
                        <span className="text-xs font-mono text-neutral-600">
                          {promptEv.studentEmail}
                        </span>
                        <span className="text-neutral-400 font-mono text-xs">•</span>
                        <span className="text-xs font-bold text-black uppercase bg-[#f0f0f0] px-2 py-0.5 border border-black">
                          {promptEv.assessmentTitle}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Quality Tier Badge */}
                        <span className={`px-2.5 py-1 text-xs font-extrabold uppercase tracking-[0.12em] border flex items-center gap-1.5 ${
                          analysis.tier === 'EXEMPLARY' ? 'bg-emerald-600 text-white border-emerald-600' :
                          analysis.tier === 'GOOD' ? 'bg-green-700 text-white border-green-700' :
                          analysis.tier === 'MODERATE' ? 'bg-amber-600 text-white border-amber-600' :
                          analysis.isDirectAnswerSeeking ? 'bg-[#c90000] text-white border-[#c90000] animate-pulse' :
                          'bg-neutral-800 text-white border-neutral-800'
                        }`}>
                          {analysis.tier === 'EXEMPLARY' && <Sparkles className="w-3.5 h-3.5" />}
                          {analysis.tier === 'GOOD' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {analysis.tier === 'MODERATE' && <HelpCircle className="w-3.5 h-3.5" />}
                          {analysis.isDirectAnswerSeeking && <AlertTriangle className="w-3.5 h-3.5" />}
                          {analysis.ratingLabel} • {analysis.qualityScore}/100
                        </span>

                        <span className="text-xs font-mono text-neutral-500">
                          {new Date(promptEv.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {/* Verdict Banner */}
                    <div className={`p-3.5 border-2 mb-3 ${
                      analysis.isDirectAnswerSeeking 
                        ? 'bg-red-50 border-[#c90000] text-[#c90000]' :
                      analysis.tier === 'EXEMPLARY'
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-950' :
                      analysis.tier === 'GOOD'
                        ? 'bg-green-50 border-green-600 text-green-950' :
                      analysis.tier === 'MODERATE'
                        ? 'bg-amber-50 border-amber-500 text-amber-950' :
                        'bg-[#f0f0f0] border-black text-black'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        {analysis.isDirectAnswerSeeking ? (
                          <AlertTriangle className="w-4 h-4 text-[#c90000] shrink-0 mt-0.5" />
                        ) : analysis.tier === 'EXEMPLARY' ? (
                          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <Bot className="w-4 h-4 text-black shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="font-extrabold text-xs uppercase tracking-tight block">
                            Institutional Verdict: {analysis.verdict}
                          </span>
                          <p className="text-[11px] font-mono mt-0.5 leading-relaxed opacity-90">
                            {analysis.summaryReason}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Clean Extracted Prompt Box */}
                    <div className="bg-[#f0f0f0] border-2 border-black p-4 my-2">
                      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-600 mb-1.5 flex items-center justify-between">
                        <span>Extracted Candidate Prompt:</span>
                        <div className="flex items-center gap-2">
                          <span className="text-black bg-white px-2 py-0.5 border border-black">
                            Source: {promptEv.detectionSource}
                          </span>
                          <span className="text-black bg-white px-2 py-0.5 border border-black font-mono">
                            {analysis.cleanPrompt.length} chars • {analysis.cleanPrompt.split(/\s+/).filter(Boolean).length} words
                          </span>
                        </div>
                      </div>
                      <blockquote className="text-xs font-mono font-bold text-black leading-relaxed whitespace-pre-wrap bg-white p-3 border border-neutral-300">
                        {analysis.cleanPrompt || promptEv.details}
                      </blockquote>
                    </div>

                    {/* Techniques & Anti-Patterns Pills */}
                    <div className="flex items-center gap-2 flex-wrap my-2.5">
                      {/* Positive Techniques */}
                      {analysis.detectedTechniques.map((tech, idx) => (
                        <span key={idx} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] bg-emerald-100 text-emerald-900 border border-emerald-400">
                          + {tech}
                        </span>
                      ))}

                      {/* Negative Anti-Patterns */}
                      {analysis.detectedAntiPatterns.map((anti, idx) => (
                        <span key={idx} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] bg-red-100 text-[#c90000] border border-red-300 font-extrabold">
                          - {anti}
                        </span>
                      ))}
                    </div>

                    {/* Expandable Rubric Scorecard Drawer */}
                    {isExpanded && (
                      <div className="mt-4 p-4 border-2 border-black bg-white space-y-4">
                        <div className="flex items-center justify-between border-b-2 border-black pb-2">
                          <h4 className="font-extrabold text-xs uppercase tracking-[0.12em] text-black flex items-center gap-2">
                            <Sliders className="w-3.5 h-3.5" />
                            Judging Rubric Breakdown & Scorecard
                          </h4>
                          <span className="text-xs font-mono font-bold text-black">
                            Composite Score: {analysis.qualityScore} / 100
                          </span>
                        </div>

                        {/* 4 Dimension Progress Matrix */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] mb-1">
                              <span>1. Critical Thinking vs Answer Seeking</span>
                              <span className="font-mono">{analysis.criteriaScores.criticalThinkingVsAnswerSeeking} / 30</span>
                            </div>
                            <div className="w-full bg-[#f0f0f0] h-2.5 border border-black overflow-hidden">
                              <div
                                className={`h-full ${analysis.isDirectAnswerSeeking ? 'bg-[#c90000]' : 'bg-black'}`}
                                style={{ width: `${(analysis.criteriaScores.criticalThinkingVsAnswerSeeking / 30) * 100}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-neutral-600 mt-0.5">Penalized heavily for direct MCQ option solicitation.</p>
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] mb-1">
                              <span>2. Context & Problem Framing</span>
                              <span className="font-mono">{analysis.criteriaScores.contextAndFraming} / 25</span>
                            </div>
                            <div className="w-full bg-[#f0f0f0] h-2.5 border border-black overflow-hidden">
                              <div
                                className="h-full bg-black"
                                style={{ width: `${(analysis.criteriaScores.contextAndFraming / 25) * 100}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-neutral-600 mt-0.5">Substantive depth, background, technical CS vocabulary.</p>
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] mb-1">
                              <span>3. Prompt Engineering Techniques</span>
                              <span className="font-mono">{analysis.criteriaScores.promptEngineeringTechniques} / 25</span>
                            </div>
                            <div className="w-full bg-[#f0f0f0] h-2.5 border border-black overflow-hidden">
                              <div
                                className="h-full bg-black"
                                style={{ width: `${(analysis.criteriaScores.promptEngineeringTechniques / 25) * 100}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-neutral-600 mt-0.5">Role persona, Chain-of-Thought, step-by-step reasoning.</p>
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] mb-1">
                              <span>4. Constraint Specification & Format</span>
                              <span className="font-mono">{analysis.criteriaScores.constraintSpecification} / 20</span>
                            </div>
                            <div className="w-full bg-[#f0f0f0] h-2.5 border border-black overflow-hidden">
                              <div
                                className="h-full bg-black"
                                style={{ width: `${(analysis.criteriaScores.constraintSpecification / 20) * 100}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-mono text-neutral-600 mt-0.5">Output structuring (table, markdown, anti-cheating bounds).</p>
                          </div>
                        </div>

                        {/* Strengths & Weaknesses */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-neutral-200">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800 block mb-1">
                              Identified Strengths:
                            </span>
                            {analysis.strengths.length === 0 ? (
                              <p className="text-[11px] font-mono text-neutral-500">None detected</p>
                            ) : (
                              <ul className="text-[11px] font-mono text-neutral-700 list-disc list-inside space-y-0.5">
                                {analysis.strengths.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#c90000] block mb-1">
                              Identified Weaknesses / Anti-Patterns:
                            </span>
                            {analysis.weaknesses.length === 0 ? (
                              <p className="text-[11px] font-mono text-neutral-500">None detected</p>
                            ) : (
                              <ul className="text-[11px] font-mono text-neutral-700 list-disc list-inside space-y-0.5">
                                {analysis.weaknesses.map((w, idx) => (
                                  <li key={idx} className="text-[#c90000] font-bold">{w}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        {/* Recommendation */}
                        <div className="bg-[#f0f0f0] p-3 border border-black text-xs font-mono">
                          <span className="font-bold text-black uppercase">Institutional Evaluator Recommendation: </span>
                          <span className="text-neutral-800">{analysis.recommendation}</span>
                        </div>
                      </div>
                    )}

                    {/* Footer Row: Event ID & Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] font-mono text-neutral-600 pt-3 border-t border-neutral-200 gap-2">
                      <div className="flex items-center gap-3">
                        <span>Event ID: {promptEv.id}</span>
                        <span>•</span>
                        <button
                          onClick={() => setExpandedPromptRubricId(isExpanded ? null : promptEv.id)}
                          className="font-bold text-black hover:underline cursor-pointer flex items-center gap-1 uppercase"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? 'Hide Rubric Scorecard' : 'View Rubric Scorecard'}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span>Review: {promptEv.reviewStatus}</span>
                        <button
                          onClick={() => handleReviewEvent(promptEv.id, 'reviewed')}
                          className="px-2.5 py-1 bg-black text-white hover:bg-neutral-800 text-[10px] font-bold uppercase tracking-[0.12em] cursor-pointer"
                        >
                          Mark Evaluated
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ASSESSMENTS & QUESTIONS */}
      {activeTab === 'assessments' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {assessments.map((a) => (
              <div key={a.id} className="border-2 border-black bg-white p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3 border-b-2 border-black pb-2">
                    <span className="text-[10px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-black text-white">
                      Duration: {a.durationMinutes} Mins
                    </span>
                    <span className="text-xs text-neutral-600 font-mono font-bold">{a.questionCount || 0} Questions</span>
                  </div>

                  <h3 className="text-xl font-extrabold uppercase tracking-tight text-black mb-2">{a.title}</h3>
                  <p className="text-xs text-neutral-700 line-clamp-2 mb-4 leading-relaxed">{a.description}</p>

                  {/* Security Policy Summary Ruled Matrix */}
                  <div className="grid grid-cols-2 border-2 border-black bg-[#f0f0f0] divide-x-2 divide-y-2 divide-black text-[11px] mb-6">
                    <div className="p-2.5 flex items-center justify-between">
                      <span className="text-neutral-600 font-bold uppercase tracking-[0.12em]">AI Usage:</span>
                      <span className={`font-bold px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                        a.policy.aiUsage === 'allowed'
                          ? 'bg-black text-white'
                          : 'bg-[#c90000] text-white'
                      }`}>
                        {a.policy.aiUsage === 'allowed' ? 'Allowed' : 'Prohibited'}
                      </span>
                    </div>

                    <div className="p-2.5 flex items-center justify-between">
                      <span className="text-neutral-600 font-bold uppercase tracking-[0.12em]">Prompts:</span>
                      <span className="font-bold px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] border border-black bg-white">
                        {a.policy.aiPromptMonitoring === 'enabled' ? 'Monitored' : 'Disabled'}
                      </span>
                    </div>

                    <div className="p-2.5 flex items-center justify-between">
                      <span className="text-neutral-600 font-bold uppercase tracking-[0.12em]">Tabs:</span>
                      <span className="font-bold px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] border border-black bg-white">
                        {(a.policy.tabSwitchingPolicy || 'warn').toUpperCase()}
                      </span>
                    </div>

                    <div className="p-2.5 flex items-center justify-between">
                      <span className="text-neutral-600 font-bold uppercase tracking-[0.12em]">Action:</span>
                      <span className={`font-bold px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                        a.policy.violationHandling === 'terminate'
                          ? 'bg-[#c90000] text-white'
                          : 'bg-black text-white'
                      }`}>
                        {(a.policy.violationHandling || 'warn').replace('_', ' ').toUpperCase()}
                      </span>
                    </div>

                    <div className="p-2.5 flex items-center justify-between col-span-2 border-t-2 border-black bg-white">
                      <span className="text-neutral-600 font-bold uppercase tracking-[0.12em]">Offline Examination:</span>
                      <span className={`font-bold px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] border ${
                        a.policy.allowOfflineMode
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-500'
                          : 'bg-neutral-100 text-neutral-700 border-neutral-400'
                      }`}>
                        {a.policy.allowOfflineMode ? 'Offline Enabled (Durable Store)' : 'Online Continuous Only'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t-2 border-black flex items-center justify-between gap-3">
                  <button
                    onClick={() => {
                      setEditingPolicyAssessment(a);
                      setPolicyForm({
                        durationMinutes: a.durationMinutes,
                        policy: {
                          ...a.policy,
                          aiUsage: a.policy.aiUsage || 'prohibited',
                          aiPromptMonitoring: a.policy.aiPromptMonitoring || 'disabled',
                          tabSwitchingPolicy: a.policy.tabSwitchingPolicy || 'warn',
                          externalResourceAccess: a.policy.externalResourceAccess || 'restricted',
                          permittedWebsites: Array.isArray(a.policy.permittedWebsites) ? a.policy.permittedWebsites : [],
                          violationHandling: a.policy.violationHandling || 'warn',
                          allowOfflineMode: Boolean(a.policy.allowOfflineMode),
                          connectivityPolicy: a.policy.connectivityPolicy || 'require_continuous'
                        }
                      });
                    }}
                    className="px-3.5 py-2 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5" /> Configure Policy
                  </button>

                  <button
                    onClick={() => openQuestionsManager(a)}
                    className="px-4 py-2 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
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
        <div className="border-2 border-black bg-white overflow-x-auto">
          <table className="w-full text-left text-xs text-black">
            <thead className="bg-black text-white uppercase text-[10px] tracking-[0.12em] border-b-2 border-black">
              <tr>
                <th className="p-3.5">Candidate Name</th>
                <th className="p-3.5">Email</th>
                <th className="p-3.5">Account ID</th>
                <th className="p-3.5">Registered Date</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black">
              {students.map((st) => (
                <tr key={st.id} className="hover:bg-[#f0f0f0]">
                  <td className="p-3.5 font-bold uppercase tracking-tight">{st.name}</td>
                  <td className="p-3.5 font-mono text-neutral-700">{st.email}</td>
                  <td className="p-3.5 font-mono text-[11px] text-neutral-600">{st.id}</td>
                  <td className="p-3.5 text-neutral-600 font-mono">{st.createdAt ? new Date(st.createdAt).toLocaleDateString() : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: Individual Student Assessment Timeline & Review */}
      {selectedAttemptAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-3xl bg-white border-2 border-black p-6 sm:p-8 max-h-[90vh] flex flex-col">
            
            <div className="flex items-center justify-between pb-4 border-b-2 border-black">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600 mb-1">
                  AUDIT STREAM INSPECTION
                </div>
                <h3 className="font-extrabold text-black text-lg uppercase tracking-tight flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-black" />
                  Candidate: {selectedAttemptAudit.attempt.studentName}
                </h3>
                <p className="text-xs text-neutral-600 font-mono mt-0.5">
                  ID: {selectedAttemptAudit.attempt.id} • Score: {selectedAttemptAudit.attempt.percentage ?? 'N/A'}% • Status: {selectedAttemptAudit.attempt.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedAttemptAudit(null)}
                className="p-1 border-2 border-black hover:bg-black hover:text-white transition cursor-pointer font-bold text-sm px-2.5"
              >
                ✕
              </button>
            </div>

            {/* Summary Statistics Strip */}
            <div className="py-3 px-4 my-3 bg-[#f0f0f0] border-2 border-black flex items-center justify-between text-xs font-bold uppercase tracking-[0.12em]">
              <div className="flex items-center space-x-6">
                <div>
                  <span className="text-neutral-600">Events: </span>
                  <span className="text-black">{selectedAttemptAudit.events.length}</span>
                </div>
                <div>
                  <span className="text-neutral-600">AI Interceptions: </span>
                  <span className="text-black">
                    {selectedAttemptAudit.events.filter(e => e.eventType === 'ai_query_submitted' || e.eventType === 'ai_response_received' || e.eventType === 'search_query_submitted' || e.detectionSource === 'browser_extension').length}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-600">Tab Switches: </span>
                  <span className="text-black">
                    {selectedAttemptAudit.events.filter(e => e.eventType === 'external_site_visit' || e.eventType === 'tab_switch' || e.eventType === 'external_app_detected').length}
                  </span>
                </div>
              </div>
              <span className="text-[10px] text-neutral-600 font-mono">
                Real-Time Authoritative Log
              </span>
            </div>

            {/* Candidate AI Prompting Profile (if prompts recorded in this attempt) */}
            {(() => {
              const attemptPrompts = selectedAttemptAudit.events.filter(e => 
                e.eventType === 'ai_query_submitted' || 
                (e.details && (e.details.toLowerCase().includes('prompt') || e.details.toLowerCase().includes('chatgpt') || e.details.toLowerCase().includes('claude')))
              );
              if (attemptPrompts.length === 0) return null;
              const aggregate = aggregatePromptAnalytics(attemptPrompts);
              const persona = Object.values(aggregate.candidatePersonas)[0]?.persona || 'Mixed Explorer';
              return (
                <div className="p-3 my-2 border-2 border-black bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Bot className="w-5 h-5 text-black shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold uppercase tracking-tight text-black">Candidate AI Prompting Profile:</span>
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] border ${
                          persona === 'Strategic Prompt Engineer' ? 'bg-emerald-600 text-white border-emerald-600' :
                          persona === 'Thoughtful Inquirer' ? 'bg-green-700 text-white border-green-700' :
                          persona.includes('Cheating') ? 'bg-[#c90000] text-white border-[#c90000]' :
                          'bg-amber-600 text-white border-amber-600'
                        }`}>
                          {persona}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-neutral-600 mt-0.5">
                        Avg Quality Score: <strong className="text-black">{aggregate.averageQualityScore}/100</strong> • Direct Answer Requests: <strong className={aggregate.directAnswerSeekingCount > 0 ? "text-[#c90000]" : "text-black"}>{aggregate.directAnswerSeekingCount} of {aggregate.totalPromptsAnalyzed}</strong>
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-neutral-500 uppercase bg-[#f0f0f0] px-2 py-1 border border-black">
                    Institutional Rubric Assessed
                  </span>
                </div>
              );
            })()}

            {/* Timeline Stream */}
            <div className="flex-1 overflow-y-auto py-2 space-y-2.5 divide-y-2 divide-black">
              {selectedAttemptAudit.events.length === 0 ? (
                <div className="p-8 text-center text-xs font-bold uppercase tracking-[0.12em] bg-[#f0f0f0] border-2 border-black">
                  <CheckCircle2 className="w-8 h-8 text-black mx-auto mb-2" />
                  Clean Session: No anomalous proctoring events or focus loss recorded.
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
                    const isProhibitedAI = (isAIQuery || (isExternalSwitch && ev.details.toLowerCase().includes('ai'))) && (ev.severity === 'critical' || ev.details.toLowerCase().includes('prohibited'));
                    const isAllowedAI = isAIQuery && !isProhibitedAI;

                    return (
                      <div 
                        key={ev.id} 
                        className={`p-3.5 border-2 pt-3 first:pt-3.5 transition-none ${
                          isProhibitedAI ? 'bg-[#f0f0f0] border-[#c90000]' :
                          isAllowedAI ? 'bg-[#f0f0f0] border-black' :
                          isAIResponse ? 'bg-white border-black' :
                          'bg-white border-neutral-300'
                        } flex items-start justify-between gap-4`}
                      >
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-black bg-[#f0f0f0] px-2 py-0.5 border border-black">
                              {timeStr}
                            </span>

                            {isProhibitedAI && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-[#c90000] px-2.5 py-0.5 uppercase tracking-[0.12em]">
                                <ShieldAlert className="w-3 h-3" /> Prohibited AI Action (Violation)
                              </span>
                            )}

                            {isAllowedAI && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-black px-2.5 py-0.5 uppercase tracking-[0.12em]">
                                <Send className="w-3 h-3" /> AI Prompt (Audited & Permitted)
                              </span>
                            )}

                            {isAIResponse && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-black bg-[#f0f0f0] border border-black px-2.5 py-0.5 uppercase tracking-[0.12em]">
                                <Sparkles className="w-3 h-3" /> AI Response Received
                              </span>
                            )}

                            {isSearchQuery && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-black bg-[#f0f0f0] border border-black px-2.5 py-0.5 uppercase tracking-[0.12em]">
                                <Search className="w-3 h-3" /> Search Query
                              </span>
                            )}

                            {isReturn && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-black bg-[#f0f0f0] border border-black px-2.5 py-0.5 uppercase tracking-[0.12em]">
                                <ArrowDownLeft className="w-3 h-3" /> Returned to Assessment
                              </span>
                            )}

                            {isExternalSwitch && !isProhibitedAI && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-black bg-[#f0f0f0] border border-black px-2.5 py-0.5 uppercase tracking-[0.12em]">
                                <ArrowUpRight className="w-3 h-3" /> External Navigation
                              </span>
                            )}

                            {!isAIQuery && !isAIResponse && !isSearchQuery && !isReturn && !isExternalSwitch && !isProhibitedAI && (
                              <span className="text-[10px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-black text-white">
                                {ev.severity} • {ev.eventType.replace(/_/g, ' ')}
                              </span>
                            )}

                            <span className="text-[10px] text-neutral-600 font-mono">
                              Source: {ev.detectionSource.replace(/_/g, ' ')}
                            </span>
                          </div>

                          {/* Event Text / Telemetry Content */}
                          <div className="text-xs font-medium text-black leading-relaxed mt-1">
                            {ev.details}
                          </div>

                          {/* Evaluated Prompt Details Card if AI Query */}
                          {isAIQuery && (() => {
                            const evalResult = ev.promptAnalysis || evaluatePrompt(ev.details || '');
                            return (
                              <div className={`mt-2 p-3 border-2 text-xs font-mono ${
                                evalResult.isDirectAnswerSeeking ? 'bg-red-50 border-[#c90000]' :
                                evalResult.tier === 'EXEMPLARY' ? 'bg-emerald-50 border-emerald-600' :
                                evalResult.tier === 'GOOD' ? 'bg-green-50 border-green-600' :
                                'bg-[#f0f0f0] border-black'
                              }`}>
                                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                                  <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white ${
                                    evalResult.isDirectAnswerSeeking ? 'bg-[#c90000]' :
                                    evalResult.tier === 'EXEMPLARY' ? 'bg-emerald-600' :
                                    evalResult.tier === 'GOOD' ? 'bg-green-700' :
                                    evalResult.tier === 'MODERATE' ? 'bg-amber-600' : 'bg-black'
                                  }`}>
                                    {evalResult.ratingLabel} • {evalResult.qualityScore}/100
                                  </span>
                                  <span className="text-[10px] font-bold text-neutral-600 uppercase">
                                    {evalResult.isDirectAnswerSeeking ? '⚠️ Answer Seeking Solicitation' : 'Structured Prompt Engineering'}
                                  </span>
                                </div>
                                <p className="text-[11px] font-bold text-neutral-900 leading-snug">
                                  Verdict: {evalResult.verdict}
                                </p>
                                {evalResult.detectedTechniques.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {evalResult.detectedTechniques.map((t: string, i: number) => (
                                      <span key={i} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-white border border-emerald-300 text-emerald-800">
                                        + {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {evalResult.detectedAntiPatterns.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {evalResult.detectedAntiPatterns.map((a: string, i: number) => (
                                      <span key={i} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-white border border-red-300 text-[#c90000]">
                                        - {a}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {ev.duration > 0 && (
                            <div className="text-[10px] text-neutral-600 font-mono">
                              Duration recorded: {(ev.duration / 1000).toFixed(1)}s
                            </div>
                          )}
                        </div>

                        {/* Review Actions */}
                        <div className="shrink-0 flex items-center space-x-1.5 pt-0.5">
                          {ev.reviewStatus === 'reviewed' ? (
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white bg-black px-2 py-1">
                              Reviewed
                            </span>
                          ) : ev.reviewStatus === 'violation_confirmed' ? (
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white bg-[#c90000] px-2 py-1">
                              Flagged
                            </span>
                          ) : (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleReviewEvent(ev.id, 'reviewed')}
                                className="px-2 py-1 bg-white hover:bg-black hover:text-white text-black border border-black text-[10px] font-bold uppercase tracking-[0.12em] transition cursor-pointer"
                              >
                                Review
                              </button>
                              <button
                                onClick={() => handleReviewEvent(ev.id, 'violation_confirmed')}
                                className="px-2 py-1 bg-[#c90000] hover:bg-black text-white text-[10px] font-bold uppercase tracking-[0.12em] transition cursor-pointer"
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

            <div className="pt-4 border-t-2 border-black text-right mt-2">
              <button
                onClick={() => setSelectedAttemptAudit(null)}
                className="px-5 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Close Audit Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Questions Management Modal */}
      {selectedAssessmentForQuestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-4xl bg-white border-2 border-black p-6 sm:p-8 max-h-[90vh] flex flex-col">
            
            <div className="flex items-center justify-between pb-4 border-b-2 border-black">
              <div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">
                  Question Bank: {selectedAssessmentForQuestions.title}
                </h3>
                <p className="text-xs text-neutral-600 font-mono">{questionsList.length} Questions Configured</p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowQuestionModal(true)}
                  className="px-3.5 py-2 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Question
                </button>
                <button
                  onClick={() => setSelectedAssessmentForQuestions(null)}
                  className="p-1 border-2 border-black hover:bg-black hover:text-white transition cursor-pointer font-bold text-sm px-2.5"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Questions list */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {questionsList.map((q, idx) => (
                <div key={q.id} className="p-4 bg-[#f0f0f0] border-2 border-black">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <span className="text-xs font-bold uppercase tracking-[0.12em] bg-black text-white px-2 py-0.5">
                      Q{idx + 1} ({q.category})
                    </span>
                    <button
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="p-1 text-black hover:text-[#c90000] transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs font-bold text-black mb-2">{q.questionText}</p>
                  
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-800 font-medium">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className={q.correctAnswer === oIdx ? 'text-black font-extrabold flex items-center gap-1' : ''}>
                        <span>{String.fromCharCode(65 + oIdx)}. {opt}</span>
                        {q.correctAnswer === oIdx && <span className="text-[10px] bg-black text-white px-1.5 py-0.2">CORRECT</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t-2 border-black text-right">
              <button
                onClick={() => setSelectedAssessmentForQuestions(null)}
                className="px-5 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Close Question Manager
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Question Form */}
      {showQuestionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-xl bg-white border-2 border-black p-6 sm:p-8">
            <h3 className="font-extrabold text-black text-base uppercase tracking-tight mb-4 border-b-2 border-black pb-2">
              Add Multiple Choice Question
            </h3>

            <form onSubmit={handleAddQuestion} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Question Text</label>
                <textarea
                  required
                  rows={3}
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="Enter problem statement..."
                  className="w-full bg-white border-2 border-black p-3 text-black focus:outline-none font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {newOptions.map((opt, oIdx) => (
                  <div key={oIdx}>
                    <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">
                      Option {String.fromCharCode(65 + oIdx)}
                    </label>
                    <input
                      type="text"
                      required
                      value={opt}
                      onChange={(e) => {
                        const copy = [...newOptions];
                        copy[oIdx] = e.target.value;
                        setNewOptions(copy);
                      }}
                      className="w-full bg-white border-2 border-black px-3 py-2 text-black focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Correct Answer</label>
                  <select
                    value={newCorrectAnswer}
                    onChange={(e) => setNewCorrectAnswer(parseInt(e.target.value, 10))}
                    className="w-full bg-white border-2 border-black px-3 py-2 text-black focus:outline-none font-bold uppercase tracking-[0.12em]"
                  >
                    <option value={0}>Option A</option>
                    <option value={1}>Option B</option>
                    <option value={2}>Option C</option>
                    <option value={3}>Option D</option>
                  </select>
                </div>

                <div>
                  <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Category / Domain</label>
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-white border-2 border-black px-3 py-2 text-black focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Official Solution Breakdown</label>
                <textarea
                  rows={2}
                  value={newExplanation}
                  onChange={(e) => setNewExplanation(e.target.value)}
                  placeholder="Explain why the answer is correct for candidate review..."
                  className="w-full bg-white border-2 border-black p-3 text-black focus:outline-none font-sans"
                />
              </div>

              <div className="flex space-x-3 pt-3 border-t-2 border-black">
                <button
                  type="button"
                  onClick={() => setShowQuestionModal(false)}
                  className="flex-1 py-3 bg-white hover:bg-[#f0f0f0] text-black border-2 border-black font-bold uppercase tracking-[0.12em] text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-black hover:bg-neutral-800 text-white border-2 border-black font-bold uppercase tracking-[0.12em] text-xs transition cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white border-2 border-black p-6 sm:p-8 my-8">
            <div className="flex items-center justify-between mb-4 border-b-2 border-black pb-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600">
                  SECURITY DIRECTIVE EDITOR
                </div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">
                  Assessment Security & Policy Controls
                </h3>
                <p className="text-xs text-neutral-600 font-mono">{editingPolicyAssessment.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPolicyAssessment(null)}
                className="p-1 border-2 border-black hover:bg-black hover:text-white transition cursor-pointer font-bold text-sm px-2.5"
              >
                ✕
              </button>
            </div>

            {/* Quick Scenario Presets */}
            <div className="mb-5 p-3.5 bg-[#f0f0f0] border-2 border-black">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-black block mb-2">
                One-Click Scenario Presets:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setPolicyForm({
                      ...policyForm,
                      policy: {
                        ...policyForm.policy,
                        aiUsage: 'allowed',
                        aiPromptMonitoring: 'enabled',
                        tabSwitchingPolicy: 'warn',
                        externalResourceAccess: 'allowed',
                        permittedWebsites: ['chatgpt.com', 'openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'],
                        violationHandling: 'record_only',
                        requireFullscreen: false,
                        autoSubmitOnCriticalViolations: false,
                        allowOfflineMode: true,
                        connectivityPolicy: 'allow_offline'
                      }
                    });
                  }}
                  className="p-3 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-left text-xs transition cursor-pointer flex flex-col justify-between"
                >
                  <div className="font-extrabold uppercase tracking-tight flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Scenario A: Prompt Engineering
                  </div>
                  <div className="text-[10px] text-neutral-600 font-mono mt-1">AI Allowed • Offline Ready • Record Only</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPolicyForm({
                      ...policyForm,
                      policy: {
                        ...policyForm.policy,
                        aiUsage: 'prohibited',
                        aiPromptMonitoring: 'disabled',
                        tabSwitchingPolicy: 'restrict',
                        externalResourceAccess: 'restricted',
                        permittedWebsites: [],
                        violationHandling: 'terminate',
                        requireFullscreen: true,
                        autoSubmitOnCriticalViolations: true,
                        allowOfflineMode: false,
                        connectivityPolicy: 'require_continuous'
                      }
                    });
                  }}
                  className="p-3 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-left text-xs transition cursor-pointer flex flex-col justify-between"
                >
                  <div className="font-extrabold uppercase tracking-tight flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-[#c90000]" /> Scenario B: DSA / Strict Coding
                  </div>
                  <div className="text-[10px] text-neutral-600 font-mono mt-1">AI Prohibited • Continuous Online • Strict Kiosk</div>
                </button>
              </div>
            </div>

            <div className="space-y-4 text-xs max-h-[55vh] overflow-y-auto pr-1">
              {/* SECTION: Assessment Security Settings */}
              <div className="p-4 bg-white border-2 border-black space-y-4">
                <div className="font-bold text-black text-xs uppercase tracking-[0.12em] border-b-2 border-black pb-2 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-black" />
                  <span>Configured Security Parameters</span>
                </div>

                {/* 1. AI Usage */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">1. AI Usage Policy</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Access to ChatGPT, Claude, etc.</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, aiUsage: 'allowed' }
                      })}
                      className={`py-2.5 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center justify-center gap-2 ${
                        policyForm.policy.aiUsage === 'allowed'
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" /> Allowed
                    </button>
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, aiUsage: 'prohibited' }
                      })}
                      className={`py-2.5 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center justify-center gap-2 ${
                        policyForm.policy.aiUsage === 'prohibited'
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" /> Prohibited
                    </button>
                  </div>
                </div>

                {/* 2. AI Prompt Monitoring */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">2. AI Prompt Monitoring</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Interception & audit log recording</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, aiPromptMonitoring: 'enabled' }
                      })}
                      className={`py-2.5 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center justify-center gap-2 ${
                        policyForm.policy.aiPromptMonitoring === 'enabled'
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" /> Enabled (Capture Prompts)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, aiPromptMonitoring: 'disabled' }
                      })}
                      className={`py-2.5 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer flex items-center justify-center gap-2 ${
                        policyForm.policy.aiPromptMonitoring === 'disabled'
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      Disabled
                    </button>
                  </div>
                </div>

                {/* 3. Tab Switching Policy */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">3. Tab Switching Policy</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Window blur & focus handling</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'allowed', label: 'Allowed', desc: 'No penalty' },
                      { key: 'warn', label: 'Warn', desc: 'Alert student' },
                      { key: 'restrict', label: 'Restrict', desc: 'Strict violation' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPolicyForm({
                          ...policyForm,
                          policy: { ...policyForm.policy, tabSwitchingPolicy: opt.key }
                        })}
                        className={`py-2 px-2 font-bold uppercase tracking-[0.12em] border-2 border-black text-center transition cursor-pointer ${
                          policyForm.policy.tabSwitchingPolicy === opt.key
                            ? 'bg-black text-white'
                            : 'bg-white text-black hover:bg-[#f0f0f0]'
                        }`}
                      >
                        <div className="text-xs">{opt.label}</div>
                        <div className="text-[9px] opacity-70 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. External Resource Access & Permitted Websites */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">4. External Resource Access</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Web navigation boundary</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, externalResourceAccess: 'allowed' }
                      })}
                      className={`py-2 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer ${
                        policyForm.policy.externalResourceAccess === 'allowed'
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      Allowed (Open Web)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, externalResourceAccess: 'restricted' }
                      })}
                      className={`py-2 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black transition cursor-pointer ${
                        policyForm.policy.externalResourceAccess === 'restricted'
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      Restricted (Allowlist Only)
                    </button>
                  </div>

                  {/* Permitted Websites List Manager */}
                  <div className="p-3 bg-[#f0f0f0] border-2 border-black">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600 block mb-1.5">
                      Configurable Permitted Websites / Allowlist:
                    </span>
                    
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="e.g. docs.python.org, chatgpt.com"
                        value={newPermittedDomain}
                        onChange={(e) => setNewPermittedDomain(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (newPermittedDomain.trim()) {
                              const site = newPermittedDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
                              const current = Array.isArray(policyForm.policy.permittedWebsites) ? policyForm.policy.permittedWebsites : [];
                              if (!current.includes(site)) {
                                setPolicyForm({
                                  ...policyForm,
                                  policy: { ...policyForm.policy, permittedWebsites: [...current, site] }
                                });
                              }
                              setNewPermittedDomain('');
                            }
                          }
                        }}
                        className="flex-1 bg-white border-2 border-black px-2.5 py-1.5 text-xs text-black focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newPermittedDomain.trim()) {
                            const site = newPermittedDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
                            const current = Array.isArray(policyForm.policy.permittedWebsites) ? policyForm.policy.permittedWebsites : [];
                            if (!current.includes(site)) {
                              setPolicyForm({
                                ...policyForm,
                                policy: { ...policyForm.policy, permittedWebsites: [...current, site] }
                              });
                            }
                            setNewPermittedDomain('');
                          }
                        }}
                        className="px-3 py-1.5 bg-black hover:bg-neutral-800 text-white font-bold uppercase tracking-[0.12em] border-2 border-black text-xs cursor-pointer"
                      >
                        Add
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {Array.isArray(policyForm.policy.permittedWebsites) && policyForm.policy.permittedWebsites.length > 0 ? (
                        policyForm.policy.permittedWebsites.map((site: string, idx: number) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-black text-black text-[11px] font-mono font-bold"
                          >
                            <Globe className="w-3 h-3 text-black" />
                            {site}
                            <button
                              type="button"
                              onClick={() => {
                                setPolicyForm({
                                  ...policyForm,
                                  policy: {
                                    ...policyForm.policy,
                                    permittedWebsites: policyForm.policy.permittedWebsites.filter((_: any, i: number) => i !== idx)
                                  }
                                });
                              }}
                              className="text-black hover:text-[#c90000] ml-1 font-bold cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-neutral-500 font-mono italic">No external domains permitted (strict kiosk).</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 5. Leaving the Examination Policy */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">5. Leaving the Examination Mode</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Focus loss & window boundary rules</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'monitor', label: 'Monitor Only', desc: 'Record departures' },
                      { key: 'warn', label: 'Warn on Blur', desc: 'Display strike alerts' },
                      { key: 'strict', label: 'Strict Lockdown', desc: 'Strict kiosk controls' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPolicyForm({
                          ...policyForm,
                          policy: { ...policyForm.policy, leavingExamPolicy: opt.key }
                        })}
                        className={`py-2 px-2 font-bold uppercase tracking-[0.12em] border-2 border-black text-center transition cursor-pointer ${
                          (policyForm.policy.leavingExamPolicy || 'warn') === opt.key
                            ? 'bg-black text-white'
                            : 'bg-white text-black hover:bg-[#f0f0f0]'
                        }`}
                      >
                        <div className="text-xs">{opt.label}</div>
                        <div className="text-[9px] opacity-70 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 6. Violation Handling */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">6. Violation Handling Policy</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Infraction policy actions</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'record_only', label: 'Record Only', desc: 'Audit log only' },
                      { key: 'warn', label: 'Warn Candidate', desc: 'Display alerts' },
                      { key: 'terminate', label: 'Terminate', desc: 'Auto-submit on limit' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPolicyForm({
                          ...policyForm,
                          policy: { ...policyForm.policy, violationHandling: opt.key }
                        })}
                        className={`py-2 px-2 font-bold uppercase tracking-[0.12em] border-2 border-black text-center transition cursor-pointer ${
                          policyForm.policy.violationHandling === opt.key
                            ? 'bg-black text-white'
                            : 'bg-white text-black hover:bg-[#f0f0f0]'
                        }`}
                      >
                        <div className="text-xs">{opt.label}</div>
                        <div className="text-[9px] opacity-70 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 7. Violation Thresholds */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">7. Violation Thresholds (Escalation Limits)</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Allowed count before termination</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 bg-[#f0f0f0] p-3 border-2 border-black">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-neutral-700 mb-1">Max Minor Violations (Advisories)</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={policyForm.policy.maxMinorViolations || 3}
                        onChange={(e) => setPolicyForm({
                          ...policyForm,
                          policy: { ...policyForm.policy, maxMinorViolations: parseInt(e.target.value, 10) }
                        })}
                        className="w-full bg-white border border-black px-2.5 py-1 text-xs text-black"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-neutral-700 mb-1">Max Total Violations (Termination)</label>
                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={policyForm.policy.maxTotalViolations || 6}
                        onChange={(e) => setPolicyForm({
                          ...policyForm,
                          policy: { ...policyForm.policy, maxTotalViolations: parseInt(e.target.value, 10) }
                        })}
                        className="w-full bg-white border border-black px-2.5 py-1 text-xs text-black"
                      />
                    </div>
                  </div>
                </div>

                {/* 8. Offline Examination & Network Resilience */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-black font-bold uppercase tracking-[0.12em]">8. Offline Examination Mode</label>
                    <span className="text-[10px] text-neutral-600 font-mono">Durable local persistence & batch sync</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, allowOfflineMode: false, connectivityPolicy: 'require_continuous' }
                      })}
                      className={`py-2 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black text-center transition cursor-pointer ${
                        !policyForm.policy.allowOfflineMode
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      <div className="text-xs">Disabled (Default)</div>
                      <div className="text-[9px] opacity-70 mt-0.5">Continuous live connection required</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, allowOfflineMode: true, connectivityPolicy: 'allow_offline' }
                      })}
                      className={`py-2 px-3 font-bold uppercase tracking-[0.12em] border-2 border-black text-center transition cursor-pointer ${
                        policyForm.policy.allowOfflineMode
                          ? 'bg-black text-white'
                          : 'bg-white text-black hover:bg-[#f0f0f0]'
                      }`}
                    >
                      <div className="text-xs">Enabled (Resilient)</div>
                      <div className="text-[9px] opacity-70 mt-0.5">Permits offline answering & late sync</div>
                    </button>
                  </div>
                  <div className="p-2.5 bg-[#f0f0f0] border-2 border-black text-[10px] text-neutral-600 leading-normal">
                    When enabled, an authorized encrypted snapshot is persisted to the candidate's workstation via the Electron secure store. Candidates can answer without network connectivity and synchronize pending answers and audit telemetry once reconnected.
                  </div>
                </div>
              </div>

              {/* General Session Rules */}
              <div className="p-4 bg-[#f0f0f0] border-2 border-black space-y-3">
                <span className="font-bold text-black text-xs uppercase tracking-[0.12em] block border-b-2 border-black pb-2">
                  Session & Computer Vision Rules
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Duration (Minutes)</label>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={policyForm.durationMinutes}
                      onChange={(e) => setPolicyForm({ ...policyForm, durationMinutes: parseInt(e.target.value, 10) })}
                      className="w-full bg-white border-2 border-black px-3 py-2 text-black focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Max Total Violations</label>
                    <input
                      type="number"
                      min={2}
                      max={20}
                      value={policyForm.policy.maxTotalViolations || 5}
                      onChange={(e) => setPolicyForm({
                        ...policyForm,
                        policy: { ...policyForm.policy, maxTotalViolations: parseInt(e.target.value, 10) }
                      })}
                      className="w-full bg-white border-2 border-black px-3 py-2 text-black focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-black font-bold uppercase tracking-[0.12em] mb-1">Face Absence Timeout (Seconds)</label>
                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={policyForm.policy.faceAbsenceTimeoutSec || 7}
                    onChange={(e) => setPolicyForm({
                      ...policyForm,
                      policy: { ...policyForm.policy, faceAbsenceTimeoutSec: parseInt(e.target.value, 10) }
                    })}
                    className="w-full bg-white border-2 border-black px-3 py-2 text-black focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex space-x-3 pt-4 border-t-2 border-black mt-5">
              <button
                type="button"
                onClick={() => setEditingPolicyAssessment(null)}
                className="flex-1 py-3 bg-white hover:bg-[#f0f0f0] text-black border-2 border-black font-bold uppercase tracking-[0.12em] text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePolicy}
                className="flex-1 py-3 bg-black hover:bg-neutral-800 text-white border-2 border-black font-bold uppercase tracking-[0.12em] text-xs transition cursor-pointer"
              >
                Save & Enforce Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: AI Prompt Judging Rubric & Guide */}
      {showJudgingGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-4xl bg-white border-2 border-black p-6 sm:p-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b-2 border-black">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-black" />
                <h3 className="font-extrabold text-base uppercase tracking-tight text-black">
                  WUElev8 AI Prompt Evaluation Matrix & Judging Criteria
                </h3>
              </div>
              <button
                onClick={() => setShowJudgingGuideModal(false)}
                className="p-1 hover:bg-[#f0f0f0] border border-black cursor-pointer font-bold text-xs"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-6">
              {/* Introduction */}
              <div className="bg-[#f0f0f0] p-4 border-2 border-black">
                <h4 className="font-extrabold text-xs uppercase tracking-[0.12em] text-black mb-1">
                  How WUElev8 Distinguishes "Good Prompts" vs "Bad Prompts"
                </h4>
                <p className="text-xs font-mono text-neutral-700 leading-relaxed">
                  In assessments where AI assistance is permitted, candidates must demonstrate authentic intellectual competence through **Problem Decomposition** and **Prompt Engineering**, rather than treating the AI as an unassisted cheat sheet.
                </p>
              </div>

              {/* 4 Judging Dimensions */}
              <div>
                <h4 className="font-extrabold text-xs uppercase tracking-[0.12em] text-black mb-3 flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  The 4 Core Evaluation Dimensions (100 Point Rubric)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border-2 border-black p-4 bg-white">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs uppercase tracking-tight text-black">1. Critical Thinking vs Answer Seeking</span>
                      <span className="text-xs font-mono font-bold bg-black text-white px-2 py-0.5">30 Pts</span>
                    </div>
                    <p className="text-xs text-neutral-600 font-mono mb-2">
                      Evaluates whether the candidate explores concepts/mechanisms vs seeking raw answers.
                    </p>
                    <ul className="text-[11px] font-mono space-y-1">
                      <li className="text-emerald-800 font-bold">+ High Score: Explores why an approach fails, asks for theoretical derivations.</li>
                      <li className="text-[#c90000] font-bold">- Heavy Penalty: Asks "What is the answer", "Which option (A/B/C/D) is right", or pastes raw MCQs.</li>
                    </ul>
                  </div>

                  <div className="border-2 border-black p-4 bg-white">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs uppercase tracking-tight text-black">2. Context & Problem Framing</span>
                      <span className="text-xs font-mono font-bold bg-black text-white px-2 py-0.5">25 Pts</span>
                    </div>
                    <p className="text-xs text-neutral-600 font-mono mb-2">
                      Evaluates depth, technical vocabulary, and clarity of the input scenario.
                    </p>
                    <ul className="text-[11px] font-mono space-y-1">
                      <li className="text-emerald-800 font-bold">+ High Score: Detailed background, precise CS domain vocabulary, specific constraints.</li>
                      <li className="text-[#c90000] font-bold">- Heavy Penalty: Single words ("hi", "ans pls"), vague prompts with &lt;15 characters.</li>
                    </ul>
                  </div>

                  <div className="border-2 border-black p-4 bg-white">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs uppercase tracking-tight text-black">3. Prompt Engineering Techniques</span>
                      <span className="text-xs font-mono font-bold bg-black text-white px-2 py-0.5">25 Pts</span>
                    </div>
                    <p className="text-xs text-neutral-600 font-mono mb-2">
                      Detects advanced heuristics used by proficient prompt engineers.
                    </p>
                    <ul className="text-[11px] font-mono space-y-1">
                      <li className="text-emerald-800 font-bold">+ Role Prompting: "Act as a Senior Database Architect..."</li>
                      <li className="text-emerald-800 font-bold">+ Chain-of-Thought: "Explain step-by-step before concluding..."</li>
                      <li className="text-emerald-800 font-bold">+ Anti-Cheating Boundary: "Do not give direct answer, guide me..."</li>
                    </ul>
                  </div>

                  <div className="border-2 border-black p-4 bg-white">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs uppercase tracking-tight text-black">4. Constraint Specification & Format</span>
                      <span className="text-xs font-mono font-bold bg-black text-white px-2 py-0.5">20 Pts</span>
                    </div>
                    <p className="text-xs text-neutral-600 font-mono mb-2">
                      Evaluates if the candidate enforces structured output formats and bounds.
                    </p>
                    <ul className="text-[11px] font-mono space-y-1">
                      <li className="text-emerald-800 font-bold">+ Format constraints: Markdown tables, bulleted lists, JSON, pseudocode.</li>
                      <li className="text-emerald-800 font-bold">+ Complexity boundaries: "O(1) space complexity", "edge cases".</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Side-by-Side Comparison: Good Prompt vs Bad Prompt */}
              <div>
                <h4 className="font-extrabold text-xs uppercase tracking-[0.12em] text-black mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Side-by-Side Comparison: Good Prompt vs Bad Prompt
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bad Prompt Card */}
                  <div className="border-2 border-[#c90000] p-4 bg-red-50/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-extrabold uppercase tracking-tight text-[#c90000] flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> ⚠️ Bad Prompt (Direct Answer Seeking)
                      </span>
                      <span className="text-xs font-bold font-mono bg-[#c90000] text-white px-2 py-0.5">
                        Score: 18 / 100
                      </span>
                    </div>
                    <blockquote className="text-xs font-mono p-3 bg-white border border-red-300 text-black mb-2 whitespace-pre-wrap">
                      "Which option is correct for question 3: (A) Semaphore (B) Mutex (C) Monitor (D) Spinlock? Give me the answer."
                    </blockquote>
                    <p className="text-[11px] font-mono text-[#c90000]">
                      <strong>Why it failed:</strong> Solicits direct exam option letters without intellectual inquiry. Raw MCQ copy-pasting detected. Flagged as cheating.
                    </p>
                  </div>

                  {/* Good Prompt Card */}
                  <div className="border-2 border-emerald-600 p-4 bg-emerald-50/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-extrabold uppercase tracking-tight text-emerald-900 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-emerald-600" /> 🌟 Good Prompt (Exemplary Engineering)
                      </span>
                      <span className="text-xs font-bold font-mono bg-emerald-600 text-white px-2 py-0.5">
                        Score: 94 / 100
                      </span>
                    </div>
                    <blockquote className="text-xs font-mono p-3 bg-white border border-emerald-300 text-black mb-2 whitespace-pre-wrap">
                      "Act as a Senior Systems Architect. In a multithreaded queue, why can calling signal() before updating shared state trigger race conditions? Explain the mechanism step-by-step in a markdown table. Do not reveal direct exam answers."
                    </blockquote>
                    <p className="text-[11px] font-mono text-emerald-900">
                      <strong>Why it succeeded:</strong> Clear role definition, explicit step-by-step reasoning constraint, markdown table format, and negative anti-cheating boundary.
                    </p>
                  </div>
                </div>
              </div>

              {/* Score Tiers */}
              <div className="border-2 border-black p-4 bg-white">
                <h4 className="font-extrabold text-xs uppercase tracking-[0.12em] text-black mb-2">
                  Institutional Scoring Tiers
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="p-2 border border-emerald-500 bg-emerald-50">
                    <strong className="text-emerald-900 block font-bold">80 - 100: Exemplary</strong>
                    <span className="text-[10px] text-emerald-700">Top prompt engineering marks</span>
                  </div>
                  <div className="p-2 border border-green-500 bg-green-50">
                    <strong className="text-green-900 block font-bold">65 - 79: Good Quality</strong>
                    <span className="text-[10px] text-green-700">Strong decomposition</span>
                  </div>
                  <div className="p-2 border border-amber-500 bg-amber-50">
                    <strong className="text-amber-900 block font-bold">45 - 64: Moderate</strong>
                    <span className="text-[10px] text-amber-700">Basic conceptual query</span>
                  </div>
                  <div className="p-2 border border-red-500 bg-red-50">
                    <strong className="text-[#c90000] block font-bold">&lt; 45: Direct Answer</strong>
                    <span className="text-[10px] text-red-700">Flagged cheating pattern</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t-2 border-black text-right mt-2">
              <button
                onClick={() => setShowJudgingGuideModal(false)}
                className="px-5 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Close Judging Guide
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
