import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Assessment } from '../types';
import { assessmentsAPI } from '../services/api';
import { 
  BookOpen, Clock, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, 
  HelpCircle, Award, FileText, ChevronRight, RefreshCw, Eye
} from 'lucide-react';

interface StudentDashboardProps {
  onSelectAssessment: (assessment: Assessment, mode: 'take' | 'review', forceNew?: boolean) => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ onSelectAssessment }) => {
  const { user } = useAuth();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPolicyModal, setSelectedPolicyModal] = useState<Assessment | null>(null);

  const fetchAssessments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await assessmentsAPI.list();
      setAssessments(data.assessments);
    } catch (err: any) {
      setError(err.message || 'Failed to load assessments');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssessments();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* Student Welcome & Profile Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900/50 border border-slate-800 p-6 sm:p-8 mb-8 backdrop-blur-xl shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-blue-500/25">
              {user?.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Welcome back, {user?.name}
                </h1>
                <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Verified Candidate
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Candidate ID: <span className="font-mono text-slate-300">{user?.id}</span> • {user?.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAssessments}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700/80 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Status</span>
            </button>
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
      </div>

      {/* Main Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" /> Available Assessments
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Select an assessment to begin the pre-flight proctoring verification check.
          </p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-between text-sm text-red-300">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={fetchAssessments} className="text-xs underline font-semibold hover:text-white">Retry</button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((n) => (
            <div key={n} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 animate-pulse">
              <div className="h-5 bg-slate-800 rounded w-2/3 mb-4"></div>
              <div className="h-4 bg-slate-800 rounded w-full mb-2"></div>
              <div className="h-4 bg-slate-800 rounded w-4/5 mb-6"></div>
              <div className="h-10 bg-slate-800 rounded-xl"></div>
            </div>
          ))}
        </div>
      )}

      {/* Assessments Grid */}
      {!isLoading && assessments.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {assessments.map((assessment) => {
            const hasAttempt = Boolean(assessment.userAttemptId);
            const isCompleted = assessment.userAttemptStatus === 'submitted' || assessment.userAttemptStatus === 'timed_out';
            const isInProgress = assessment.userAttemptStatus === 'in_progress';
            const scorePct = assessment.userPercentage ?? 0;
            const isPassed = scorePct >= assessment.passMarks;

            return (
              <div
                key={assessment.id}
                className="bg-slate-900/70 border border-slate-800/90 hover:border-slate-700/80 rounded-2xl p-6 transition shadow-lg flex flex-col justify-between"
              >
                <div>
                  {/* Top Badges */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      National Hackathon MVP
                    </span>

                    {/* Attempt Status Badge */}
                    {isCompleted ? (
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        isPassed 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Completed ({scorePct}%)
                      </span>
                    ) : isInProgress ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                        <Clock className="w-3.5 h-3.5 mr-1" /> In Progress
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        Ready to Start
                      </span>
                    )}
                  </div>

                  <h3 className="text-lg font-bold text-white mb-2 leading-snug">
                    {assessment.title}
                  </h3>
                  <p className="text-xs text-slate-400 line-clamp-2 mb-5">
                    {assessment.description}
                  </p>

                  {/* Assessment Info Pill Bar */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 mb-6 text-center">
                    <div>
                      <div className="text-[11px] text-slate-500 uppercase font-semibold">Questions</div>
                      <div className="text-sm font-bold text-slate-200 mt-0.5 flex items-center justify-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        {assessment.questionCount || 20}
                      </div>
                    </div>
                    <div className="border-x border-slate-800">
                      <div className="text-[11px] text-slate-500 uppercase font-semibold">Duration</div>
                      <div className="text-sm font-bold text-slate-200 mt-0.5 flex items-center justify-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-indigo-400" />
                        {assessment.durationMinutes} Mins
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 uppercase font-semibold">Pass Mark</div>
                      <div className="text-sm font-bold text-slate-200 mt-0.5 flex items-center justify-center gap-1">
                        <Award className="w-3.5 h-3.5 text-emerald-400" />
                        {assessment.passMarks}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                  <button
                    onClick={() => setSelectedPolicyModal(assessment)}
                    className="text-xs text-slate-400 hover:text-blue-400 flex items-center gap-1 transition"
                  >
                    <HelpCircle className="w-3.5 h-3.5" /> View Proctoring Rules
                  </button>

                  {isCompleted ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelectAssessment(assessment, 'review')}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700/80 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </button>
                      <button
                        onClick={() => onSelectAssessment(assessment, 'take', true)}
                        className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retake Test</span>
                      </button>
                    </div>
                  ) : isInProgress ? (
                    <button
                      onClick={() => onSelectAssessment(assessment, 'take')}
                      className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition"
                    >
                      <span>Resume Assessment</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onSelectAssessment(assessment, 'take')}
                      className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition"
                    >
                      <span>Start Assessment</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Proctoring Policy Modal */}
      {selectedPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Assessment Proctoring Guidelines</h3>
                <p className="text-xs text-slate-400">{selectedPolicyModal.title}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-300 my-4 bg-slate-950/70 p-4 rounded-2xl border border-slate-800">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Webcam Verification:</strong> Live computer vision continuously verifies your face presence. Ensure good lighting.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Window Focus:</strong> Switching tabs, minimizing the browser, or opening background applications will trigger automated focus-loss audit logs.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Fullscreen Mode:</strong> The assessment runs strictly in locked fullscreen. Exiting fullscreen logs a security event.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Explainable Audit:</strong> Technical signals are recorded for manual human review; no candidate is disqualified arbitrarily.</span>
              </div>
            </div>

            <button
              onClick={() => setSelectedPolicyModal(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
            >
              Understood & Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
