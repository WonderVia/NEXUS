import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import type { Assessment, Question } from '../types';
import { questionsAPI, attemptsAPI } from '../services/api';
import { 
  Award, CheckCircle2, XCircle, ArrowLeft, BookOpen, Clock, 
  ShieldCheck, HelpCircle, ChevronDown, ChevronUp, FileText, RefreshCw 
} from 'lucide-react';

interface AssessmentResultPageProps {
  assessment: Assessment;
  resultData?: any;
  onBack: () => void;
  onRetake?: () => void;
}

export const AssessmentResultPage: React.FC<AssessmentResultPageProps> = ({ assessment, resultData, onBack, onRetake }) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [savedAnswers, setSavedAnswers] = useState<Map<string, number>>(new Map());
  const [scoreData, setScoreData] = useState<any>(resultData || null);
  const [isLoading, setIsLoading] = useState(!resultData);
  const [expandedExplanation, setExpandedExplanation] = useState<string | null>(null);

  useEffect(() => {
    async function loadResults() {
      try {
        // If not passed in props, fetch latest attempt for this assessment
        if (!scoreData && assessment.userAttemptId) {
          const attRes = await attemptsAPI.getById(assessment.userAttemptId);
          setScoreData(attRes.attempt);
          if (attRes.answers) {
            const map = new Map<string, number>();
            attRes.answers.forEach((a: any) => map.set(a.questionId, a.selectedOption));
            setSavedAnswers(map);
          }
        }

        // Fetch questions in review mode (includes correct answers & explanations!)
        const qRes = await questionsAPI.getByAssessment(assessment.id);
        setQuestions(qRes.questions);

        // Fire festive confetti if score >= 40%
        const finalPct = resultData?.percentage ?? assessment.userPercentage ?? 0;
        if (finalPct >= assessment.passMarks) {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 }
          });
        }
      } catch (err) {
        console.warn('Failed to load full review data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadResults();
  }, [assessment.id, assessment.userAttemptId]);

  const percentage = scoreData?.percentage ?? assessment.userPercentage ?? 0;
  const score = scoreData?.score ?? assessment.userScore ?? 0;
  const totalPossible = scoreData?.totalPossibleScore ?? assessment.totalMarks;
  const isPassed = percentage >= assessment.passMarks;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Student Dashboard
        </button>

        {onRetake && (
          <button
            onClick={onRetake}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-500/20 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retake Assessment</span>
          </button>
        )}
      </div>

      {/* Main Scorecard Banner */}
      <div className={`relative overflow-hidden rounded-3xl border p-8 mb-8 backdrop-blur-xl shadow-2xl ${
        isPassed
          ? 'bg-gradient-to-tr from-emerald-950/60 via-slate-900/80 to-blue-950/40 border-emerald-500/30'
          : 'bg-gradient-to-tr from-amber-950/40 via-slate-900/80 to-slate-900/80 border-amber-500/30'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                isPassed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {isPassed ? 'Assessment Cleared' : 'Assessment Completed'}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Authoritative Backend Scored
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {assessment.title}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Test answers evaluated securely against official database answer keys.
            </p>
          </div>

          {/* Big Score Circle */}
          <div className="flex items-center space-x-4 bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl shrink-0">
            <div className="text-right">
              <div className="text-[11px] text-slate-400 uppercase font-bold">Your Score</div>
              <div className="text-3xl font-black text-white">{percentage}%</div>
              <div className="text-[11px] text-slate-400 font-mono">{score} / {totalPossible} Marks</div>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-lg ${
              isPassed ? 'bg-emerald-600 shadow-emerald-500/25' : 'bg-amber-600 shadow-amber-500/25'
            }`}>
              <Award className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Question Review Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            Comprehensive Question Review & Explanations
          </h2>
          <span className="text-xs text-slate-400">
            {questions.length} Questions Evaluated
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            Loading answer explanations...
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map((q, idx) => {
              const studentChoice = savedAnswers.get(q.id);
              const isCorrect = studentChoice !== undefined && studentChoice === q.correctAnswer;
              const isExpanded = expandedExplanation === q.id;

              return (
                <div
                  key={q.id}
                  className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-md"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-slate-800 text-slate-300">
                        Q{idx + 1}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-500/10 text-blue-400">
                        {q.category}
                      </span>
                    </div>

                    {/* Correctness Chip */}
                    {studentChoice === undefined ? (
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400">
                        Unattempted
                      </span>
                    ) : isCorrect ? (
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Correct (+5)
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Incorrect (0)
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-white mb-4 leading-relaxed">
                    {q.questionText}
                  </p>

                  {/* Options List */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                    {q.options.map((opt, optIdx) => {
                      const isCandidateChoice = studentChoice === optIdx;
                      const isCorrectChoice = q.correctAnswer === optIdx;

                      let style = 'bg-slate-950/40 border-slate-800/80 text-slate-400';
                      if (isCorrectChoice) {
                        style = 'bg-emerald-950/30 border-emerald-500/60 text-emerald-300 font-semibold';
                      } else if (isCandidateChoice && !isCorrectChoice) {
                        style = 'bg-red-950/30 border-red-500/60 text-red-300 line-through';
                      }

                      return (
                        <div
                          key={optIdx}
                          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${style}`}
                        >
                          <div className="flex items-center space-x-2">
                            <span className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center font-bold text-[10px]">
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <span>{opt}</span>
                          </div>
                          {isCorrectChoice && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                          {isCandidateChoice && !isCorrectChoice && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Explanation Toggle */}
                  {q.explanation && (
                    <div className="border-t border-slate-800/80 pt-3">
                      <button
                        onClick={() => setExpandedExplanation(isExpanded ? null : q.id)}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold transition"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>{isExpanded ? 'Hide Technical Explanation' : 'View Technical Explanation'}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-2.5 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 leading-relaxed animate-in fade-in duration-150">
                          <strong className="text-blue-300 block mb-1">Official Solution Breakdown:</strong>
                          {q.explanation}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Actions Bar */}
      <div className="mt-10 pt-6 border-t border-slate-800/80 flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-semibold flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>

        {onRetake && (
          <button
            onClick={onRetake}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-500/25 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retake Assessment</span>
          </button>
        )}
      </div>

    </div>
  );
};
