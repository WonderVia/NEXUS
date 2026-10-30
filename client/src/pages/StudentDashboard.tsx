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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-white text-black">
      
      {/* 12-Column Swiss Candidate Header Section */}
      <div className="border-2 border-black bg-white p-6 sm:p-8 mb-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          <div className="lg:col-span-8">
            <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-black mb-3 flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#c90000] inline-block"></span>
              <span>01 / CANDIDATE IDENTITY & VERIFICATION RECORD</span>
            </div>
            
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tighter uppercase leading-[0.95] text-black mb-3">
              {user?.name}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-800">
              <span className="font-mono bg-[#f0f0f0] border-2 border-black px-2.5 py-1 font-bold">
                ID: {user?.id}
              </span>
              <span className="font-mono bg-[#f0f0f0] border-2 border-black px-2.5 py-1 font-bold">
                {user?.email}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black text-white text-[11px] font-bold uppercase tracking-[0.12em]">
                <ShieldCheck className="w-3.5 h-3.5" /> VERIFIED CANDIDATE
              </span>
            </div>
          </div>

          <div className="lg:col-span-4 flex lg:justify-end items-center">
            <button
              onClick={fetchAssessments}
              className="px-4 py-2.5 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-2 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Status</span>
            </button>
          </div>

        </div>
      </div>

      {/* Main Section Header with Index Rail */}
      <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-6">
        <div>
          <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-black flex items-center gap-2">
            <span className="w-2 h-2 bg-black inline-block"></span>
            <span>02 / AVAILABLE ASSESSMENTS MATRIX</span>
          </div>
          <p className="text-xs text-neutral-600 mt-1 font-medium">
            Select an assessment to initialize the pre-flight proctoring verification check.
          </p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 bg-[#f0f0f0] border-2 border-[#c90000] flex items-center justify-between text-xs text-black">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 bg-[#c90000] inline-block"></span>
            <span className="font-bold">{error}</span>
          </div>
          <button onClick={fetchAssessments} className="text-xs uppercase tracking-[0.12em] underline font-bold hover:text-[#c90000]">
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((n) => (
            <div key={n} className="border-2 border-black p-6 bg-[#f0f0f0]">
              <div className="h-6 bg-neutral-300 w-2/3 mb-4"></div>
              <div className="h-4 bg-neutral-300 w-full mb-2"></div>
              <div className="h-4 bg-neutral-300 w-4/5 mb-6"></div>
              <div className="h-10 bg-neutral-300"></div>
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
                className="border-2 border-black bg-white p-6 flex flex-col justify-between"
              >
                <div>
                  {/* Top Badges */}
                  <div className="flex items-center justify-between gap-2 mb-4 border-b-2 border-black pb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-black text-white">
                        WUElev8
                      </span>
                      {assessment.policy.aiUsage === 'allowed' ? (
                        <span className="text-[11px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-[#f0f0f0] border-2 border-black text-black">
                          AI Allowed (Monitored)
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-black text-white flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-[#c90000] inline-block"></span>
                          AI Prohibited
                        </span>
                      )}
                    </div>

                    {/* Attempt Status Badge */}
                    {isCompleted ? (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] border-2 border-black bg-[#f0f0f0] text-black">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Completed ({scorePct}%)
                      </span>
                    ) : isInProgress ? (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] bg-black text-white">
                        <Clock className="w-3.5 h-3.5 mr-1" /> In Progress
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] border-2 border-black bg-white text-black">
                        Ready to Start
                      </span>
                    )}
                  </div>

                  <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight text-black mb-2 uppercase leading-tight">
                    {assessment.title}
                  </h3>
                  <p className="text-xs text-neutral-700 line-clamp-2 mb-5 leading-relaxed">
                    {assessment.description}
                  </p>

                  {/* Assessment Ruled Specs Matrix */}
                  <div className="grid grid-cols-3 border-2 border-black bg-[#f0f0f0] divide-x-2 divide-black mb-6 text-center">
                    <div className="p-2.5">
                      <div className="text-[10px] text-neutral-600 uppercase font-bold tracking-[0.12em]">Questions</div>
                      <div className="text-base font-extrabold text-black mt-0.5">
                        {assessment.questionCount || 20}
                      </div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[10px] text-neutral-600 uppercase font-bold tracking-[0.12em]">Duration</div>
                      <div className="text-base font-extrabold text-black mt-0.5">
                        {assessment.durationMinutes} Mins
                      </div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[10px] text-neutral-600 uppercase font-bold tracking-[0.12em]">Pass Mark</div>
                      <div className="text-base font-extrabold text-black mt-0.5">
                        {assessment.passMarks}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-4 border-t-2 border-black flex flex-wrap items-center justify-between gap-3">
                  <button
                    onClick={() => setSelectedPolicyModal(assessment)}
                    className="text-xs font-bold text-black uppercase tracking-[0.12em] underline hover:text-[#c90000] flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" /> View Proctoring Rules
                  </button>

                  {isCompleted ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelectAssessment(assessment, 'review')}
                        className="px-3.5 py-2 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </button>
                      <button
                        onClick={() => onSelectAssessment(assessment, 'take', true)}
                        className="px-3.5 py-2 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retake Test</span>
                      </button>
                    </div>
                  ) : isInProgress ? (
                    <button
                      onClick={() => onSelectAssessment(assessment, 'take')}
                      className="px-4 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-2 transition cursor-pointer"
                    >
                      <span>Resume Assessment</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onSelectAssessment(assessment, 'take')}
                      className="px-5 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-2 transition cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-lg bg-white border-2 border-black p-6 sm:p-8">
            <div className="flex items-center space-x-3 mb-4 border-b-2 border-black pb-3">
              <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">Proctoring Guidelines</h3>
                <p className="text-xs text-neutral-600 font-mono">{selectedPolicyModal.title}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-black my-4 bg-[#f0f0f0] p-4 border-2 border-black divide-y-2 divide-black">
              <div className="pt-2 first:pt-0">
                <div className="font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-1.5">
                  <span className={`w-2 h-2 ${selectedPolicyModal.policy.aiUsage === 'allowed' ? 'bg-black' : 'bg-[#c90000]'}`} />
                  AI Usage Policy
                </div>
                <p className="text-neutral-800">
                  {selectedPolicyModal.policy.aiUsage === 'allowed'
                    ? 'AI usage is permitted for this assessment. Supported tools (ChatGPT, Claude) can be accessed. Candidate prompt formulations are recorded for evaluation.'
                    : 'AI tools are strictly PROHIBITED for this assessment. Any attempt to access AI platforms will trigger violation flags.'}
                </p>
              </div>

              <div className="pt-3">
                <div className="font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-black" />
                  Tab Switching Policy: {(selectedPolicyModal.policy.tabSwitchingPolicy || 'warn').toUpperCase()}
                </div>
                <p className="text-neutral-800">
                  {selectedPolicyModal.policy.tabSwitchingPolicy === 'restrict'
                    ? 'Leaving the exam window is restricted and recorded as a violation.'
                    : 'Switching tabs will trigger alert warnings.'}
                </p>
              </div>

              <div className="pt-3">
                <div className="font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-black" />
                  Webcam Computer Vision
                </div>
                <p className="text-neutral-800">
                  Live computer vision continuously verifies your face presence. Ensure adequate ambient lighting and clear camera view.
                </p>
              </div>

              <div className="pt-3">
                <div className="font-bold uppercase tracking-[0.12em] mb-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-[#c90000]" />
                  Violation Handling: {(selectedPolicyModal.policy.violationHandling || 'warn').replace('_', ' ').toUpperCase()}
                </div>
                <p className="text-neutral-800">
                  {selectedPolicyModal.policy.violationHandling === 'terminate'
                    ? 'Reaching maximum permitted violations will automatically submit the exam and record an infraction.'
                    : 'Violations are recorded in the candidate audit timeline for admin review.'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setSelectedPolicyModal(null)}
              className="w-full py-3 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
            >
              Understood & Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
