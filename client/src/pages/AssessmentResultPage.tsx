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
        if (!scoreData && assessment.userAttemptId) {
          const attRes = await attemptsAPI.getById(assessment.userAttemptId);
          setScoreData(attRes.attempt);
          if (attRes.answers) {
            const map = new Map<string, number>();
            attRes.answers.forEach((a: any) => map.set(a.questionId, a.selectedOption));
            setSavedAnswers(map);
          }
        }

        const qRes = await questionsAPI.getByAssessment(assessment.id);
        setQuestions(qRes.questions);

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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-white text-black">
      
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b-2 border-black">
        <button
          onClick={onBack}
          className="text-xs font-bold uppercase tracking-[0.12em] text-black hover:text-[#c90000] flex items-center gap-1.5 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Student Dashboard
        </button>

        {onRetake && (
          <button
            onClick={onRetake}
            className="px-4 py-2 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retake Assessment</span>
          </button>
        )}
      </div>

      {/* Main Scorecard Banner (12-Column Swiss Grid) */}
      <div className="border-2 border-black bg-white p-6 sm:p-10 mb-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div className="lg:col-span-8">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[11px] px-2.5 py-1 font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${
                isPassed ? 'bg-black text-white' : 'bg-black text-white'
              }`}>
                <span className={`w-2 h-2 ${isPassed ? 'bg-white' : 'bg-[#c90000]'}`}></span>
                {isPassed ? 'Assessment Cleared' : 'Assessment Failed'}
              </span>
              <span className="text-[11px] font-mono text-neutral-600 uppercase font-bold tracking-[0.12em]">
                Authoritative Server Evaluation
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold text-black uppercase tracking-tighter leading-[0.95] mb-2">
              {assessment.title}
            </h1>
            <p className="text-xs text-neutral-600 font-medium">
              Candidate answers scored authoritatively against official database solution keys.
            </p>
          </div>

          {/* Big Score Box */}
          <div className="lg:col-span-4 border-2 border-black bg-[#f0f0f0] p-6 text-center">
            <div className="text-[11px] text-neutral-600 uppercase font-bold tracking-[0.12em]">Final Score</div>
            <div className="text-6xl sm:text-7xl font-black text-black tracking-tighter leading-none my-1">
              {percentage}%
            </div>
            <div className="text-xs font-mono font-bold text-black border-t-2 border-black pt-2 mt-2">
              {score} / {totalPossible} Marks
            </div>
          </div>

        </div>
      </div>

      {/* Question Review Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b-2 border-black pb-3">
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-black flex items-center gap-2">
            <span className="w-2 h-2 bg-black inline-block"></span>
            <span>02 / OFFICIAL ANSWER EVALUATION & TECHNICAL EXPLANATIONS</span>
          </div>
          <span className="text-xs font-mono font-bold text-black">
            {questions.length} Questions Evaluated
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-xs font-bold uppercase tracking-[0.12em] border-2 border-black bg-[#f0f0f0]">
            <div className="w-6 h-6 border-2 border-black border-t-transparent animate-spin mx-auto mb-3"></div>
            Loading official review data...
          </div>
        ) : (
          <div className="space-y-5">
            {questions.map((q, idx) => {
              const studentChoice = savedAnswers.get(q.id);
              const isCorrect = studentChoice !== undefined && studentChoice === q.correctAnswer;
              const isExpanded = expandedExplanation === q.id;

              return (
                <div
                  key={q.id}
                  className="border-2 border-black bg-white p-6"
                >
                  <div className="flex items-start justify-between gap-4 mb-4 border-b-2 border-black pb-3">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-black text-white">
                        Q{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                      </span>
                      <span className="text-xs px-2 py-0.5 font-bold uppercase tracking-[0.12em] bg-[#f0f0f0] border-2 border-black text-black">
                        {q.category}
                      </span>
                    </div>

                    {/* Correctness Chip */}
                    {studentChoice === undefined ? (
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] px-2.5 py-0.5 border-2 border-black bg-[#f0f0f0] text-black">
                        Unattempted
                      </span>
                    ) : isCorrect ? (
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] px-2.5 py-0.5 bg-black text-white flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Correct (+5)
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold uppercase tracking-[0.12em] px-2.5 py-0.5 border-2 border-[#c90000] bg-[#f0f0f0] text-black flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-[#c90000]"></span> Incorrect (0)
                      </span>
                    )}
                  </div>

                  <p className="text-base font-bold text-black mb-5 leading-snug">
                    {q.questionText}
                  </p>

                  {/* Options List */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                    {q.options.map((opt, optIdx) => {
                      const isCandidateChoice = studentChoice === optIdx;
                      const isCorrectChoice = q.correctAnswer === optIdx;

                      let style = 'bg-white border-2 border-black text-black';
                      if (isCorrectChoice) {
                        style = 'bg-black text-white border-2 border-black font-bold';
                      } else if (isCandidateChoice && !isCorrectChoice) {
                        style = 'bg-[#f0f0f0] border-2 border-[#c90000] text-black line-through';
                      }

                      return (
                        <div
                          key={optIdx}
                          className={`p-3 text-xs flex items-center justify-between ${style}`}
                        >
                          <div className="flex items-center space-x-2.5">
                            <span className={`w-5 h-5 flex items-center justify-center font-bold text-[11px] border ${
                              isCorrectChoice ? 'border-white bg-black text-white' : 'border-black bg-[#f0f0f0] text-black'
                            }`}>
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <span>{opt}</span>
                          </div>
                          {isCorrectChoice && <CheckCircle2 className="w-4 h-4 text-white shrink-0" />}
                          {isCandidateChoice && !isCorrectChoice && <span className="w-2 h-2 bg-[#c90000] shrink-0" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Technical Explanation Toggle */}
                  {q.explanation && (
                    <div className="border-t-2 border-black pt-3">
                      <button
                        onClick={() => setExpandedExplanation(isExpanded ? null : q.id)}
                        className="text-xs font-bold uppercase tracking-[0.12em] text-black hover:text-[#c90000] underline flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>{isExpanded ? '[-] Hide Solution Breakdown' : '[+] View Solution Breakdown'}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 p-4 bg-[#f0f0f0] border-2 border-black text-xs text-black leading-relaxed">
                          <strong className="block mb-1.5 uppercase tracking-[0.12em] font-bold">Official Technical Breakdown:</strong>
                          <p>{q.explanation}</p>
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
      <div className="mt-10 pt-6 border-t-2 border-black flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-5 py-2.5 bg-black hover:bg-neutral-800 text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
        >
          Return to Dashboard
        </button>

        {onRetake && (
          <button
            onClick={onRetake}
            className="px-5 py-2.5 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
          >
            Retake Test
          </button>
        )}
      </div>

    </div>
  );
};
