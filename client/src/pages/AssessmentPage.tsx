import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Assessment, Attempt, Question, ProctoringEvent } from '../types';
import { attemptsAPI, questionsAPI, proctoringAPI } from '../services/api';
import { analyzeWebcamFrame } from '../services/faceDetection';
import { 
  Clock, ShieldAlert, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, 
  Bookmark, Send, Camera, Eye, AlertOctagon, Lock, X, Monitor, Wifi, ExternalLink,
  Activity
} from 'lucide-react';

interface AssessmentPageProps {
  assessment: Assessment;
  forceNew?: boolean;
  onFinish: (result: any) => void;
  onExit: () => void;
}

interface ExternalActivityEvent {
  id: string;
  type: 'external_app' | 'focus_loss' | 'browser_extension';
  label: string;
  details: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  duration?: number;
}

export const AssessmentPage: React.FC<AssessmentPageProps> = ({ assessment, forceNew, onFinish, onExit }) => {
  // Assessment State
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Map<string, number>>(new Map());
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(new Set());
  
  // Real External Activity Tracking (auto-logged, no manual input)
  const [activeTab, setActiveTab] = useState<'exam' | 'activity'>('exam');
  const [externalActivityLog, setExternalActivityLog] = useState<ExternalActivityEvent[]>([]);
  const [blockedNavigationNotice, setBlockedNavigationNotice] = useState<{ url: string; message?: string } | null>(null);

  // Timer State
  const [remainingSeconds, setRemainingSeconds] = useState(assessment.durationMinutes * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Proctoring & CV State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [proctorStatus, setProctorStatus] = useState<'normal' | 'no_face' | 'multiple_faces' | 'looking_away'>('normal');
  const [faceConfidence, setFaceConfidence] = useState<number>(1);
  const [activeViolationModal, setActiveViolationModal] = useState<{
    title: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  } | null>(null);
  const [violationCount, setViolationCount] = useState<number>(0);
  const [savingStatus, setSavingStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  // Tracking references for debounced proctoring events
  const faceAbsenceStartRef = useRef<number | null>(null);
  const faceMissingLoggedRef = useRef<boolean>(false);
  const multipleFacesLoggedRef = useRef<boolean>(false);
  const blurStartRef = useRef<number | null>(null);
  const attemptIdRef = useRef<string | null>(null);

  // Add to local activity feed (audited in background without disrupting the student)
  const addActivityEvent = useCallback((event: Omit<ExternalActivityEvent, 'id'>) => {
    const newEvent: ExternalActivityEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
    };
    setExternalActivityLog(prev => [newEvent, ...prev].slice(0, 50)); // Keep last 50
  }, []);

  // Initialize Assessment and Questions
  useEffect(() => {
    async function init() {
      try {
        // Start or resume attempt
        const startRes = await attemptsAPI.start(assessment.id, forceNew);
        setAttempt(startRes.attempt);
        attemptIdRef.current = startRes.attempt.id;
        setRemainingSeconds(startRes.remainingSeconds);

        // Preload saved answers if resuming
        if (startRes.savedAnswers && startRes.savedAnswers.length > 0) {
          const map = new Map<string, number>();
          startRes.savedAnswers.forEach(a => map.set(a.questionId, a.selectedOption));
          setAnswers(map);
        }

        // Fetch questions
        const qRes = await questionsAPI.getByAssessment(assessment.id);
        setQuestions(qRes.questions);

        // Enable Exam Security Mode in Electron and sync session info
        if (window.electronAPI) {
          await window.electronAPI.setExamMode(true);
          await window.electronAPI.setFullscreen(true);
          const token = localStorage.getItem('proctor_auth_token');
          await window.electronAPI.setActiveSessionInfo?.({ attemptId: startRes.attempt.id, token: token || undefined });
        }

        // Notify Chrome / Edge extension companion if installed
        try {
          const wChrome = (window as any).chrome;
          if (wChrome?.runtime?.sendMessage) {
            const token = localStorage.getItem('proctor_auth_token');
            wChrome.runtime.sendMessage({
              type: 'SET_ASSESSMENT_ACTIVE',
              token,
              attemptId: startRes.attempt.id
            }, () => {
              if (wChrome.runtime?.lastError) { /* ignore if extension not listening */ }
            });
          }
        } catch {
          // Extension communication optional
        }
      } catch (err: any) {
        console.error('Failed to initialize assessment:', err);
        alert(err.message || 'Error starting assessment');
        onExit();
      }
    }
    init();

    return () => {
      if (window.electronAPI) {
        window.electronAPI.setExamMode(false);
        window.electronAPI.setActiveSessionInfo?.({});
      }
      try {
        const wChrome = (window as any).chrome;
        if (wChrome?.runtime?.sendMessage) {
          wChrome.runtime.sendMessage({ type: 'CLEAR_ASSESSMENT' }, () => {
            if (wChrome.runtime?.lastError) { /* ignore */ }
          });
        }
      } catch {}
    };
  }, [assessment.id]);

  // Log a proctoring event to backend
  const logProctorViolation = useCallback(async (
    eventType: string, 
    severity: 'low' | 'medium' | 'high' | 'critical', 
    details: string, 
    duration: number = 0,
    source: string = 'webcam_cv'
  ) => {
    const currentAttemptId = attemptIdRef.current;
    if (!currentAttemptId) return;

    try {
      const res = await proctoringAPI.logEvent(currentAttemptId, {
        eventType,
        severity,
        details,
        duration,
        detectionSource: source
      });

      setViolationCount(res.currentViolationCount);

      // Only trigger notification modal for prolonged critical camera face absence, never for tab switches or external activity
      if (eventType === 'face_missing' && severity === 'critical') {
        setActiveViolationModal({
          title: `Proctoring Alert: ${eventType.replace(/_/g, ' ').toUpperCase()}`,
          message: details,
          severity
        });
      }
    } catch (e) {
      console.warn('Failed to log proctoring violation:', e);
    }
  }, []);

  // Initialize Webcam for corner proctoring PIP
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cvTimer: any;

    async function startWebcam() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, frameRate: { ideal: 15 } },
          audio: false
        });
        setWebcamStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }

        // Computer Vision Real-time detection loop (every 700ms)
        cvTimer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          const result = await analyzeWebcamFrame(videoRef.current);
          setProctorStatus(result.status);
          setFaceConfidence(result.confidence);

          // 1. Face Missing Detection & Prolonged Absence
          if (result.status === 'no_face') {
            if (!faceAbsenceStartRef.current) {
              faceAbsenceStartRef.current = Date.now();
            } else {
              const absenceDurationSec = (Date.now() - faceAbsenceStartRef.current) / 1000;
              const threshold = assessment.policy.faceAbsenceTimeoutSec || 6;

              if (absenceDurationSec >= threshold && !faceMissingLoggedRef.current) {
                faceMissingLoggedRef.current = true;
                const details = `Candidate face not visible in camera feed for >${Math.round(absenceDurationSec)} seconds.`;
                logProctorViolation('face_missing', 'high', details, Math.round(absenceDurationSec * 1000));
                addActivityEvent({ type: 'focus_loss', label: 'Face Missing', details, severity: 'high', timestamp: new Date(), duration: Math.round(absenceDurationSec * 1000) });
              }
            }
          } else {
            faceAbsenceStartRef.current = null;
            faceMissingLoggedRef.current = false;
          }

          // 2. Multiple Faces Detection
          if (result.status === 'multiple_faces') {
            if (!multipleFacesLoggedRef.current) {
              multipleFacesLoggedRef.current = true;
              const details = `Multiple individuals (${result.faceCount} faces) observed in candidate assessment environment.`;
              logProctorViolation('multiple_faces', 'critical', details);
              addActivityEvent({ type: 'focus_loss', label: 'Multiple Faces', details, severity: 'critical', timestamp: new Date() });
            }
          } else {
            multipleFacesLoggedRef.current = false;
          }

        }, 700);

      } catch (err) {
        console.warn('Webcam start failed:', err);
        logProctorViolation('system_anomaly', 'high', 'Candidate webcam feed unavailable during active assessment.');
      }
    }

    startWebcam();

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      clearInterval(cvTimer);
    };
  }, [logProctorViolation, assessment.policy]);

  // Window Focus, Blur, and Fullscreen Event Listeners + External App Detection
  useEffect(() => {
    // Window Blur (lost focus / switched away)
    const handleBlur = () => {
      blurStartRef.current = Date.now();
      logProctorViolation('tab_switch', 'low', 'Student switched away from assessment.', 0, 'browser_focus');
      addActivityEvent({
        type: 'focus_loss',
        label: 'Switched Away',
        details: 'Student switched away from assessment.',
        severity: 'low',
        timestamp: new Date()
      });
    };

    // Window Focus (regained focus / returned to assessment)
    const handleFocus = () => {
      if (blurStartRef.current) {
        const duration = Date.now() - blurStartRef.current;
        if (duration > 1000) { // More than 1 second away
          const details = `Student returned to assessment (Duration away: ${(duration / 1000).toFixed(1)}s).`;
          logProctorViolation(
            'assessment_return',
            'low',
            details,
            duration,
            'browser_focus'
          );
          addActivityEvent({
            type: 'focus_loss',
            label: 'Returned to Assessment',
            details,
            severity: 'low',
            timestamp: new Date(),
            duration
          });
        }
        blurStartRef.current = null;
      }
    };

    // Fullscreen exit attempt
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && assessment.policy.requireFullscreen) {
        const details = 'Candidate exited fullscreen exam mode.';
        logProctorViolation('fullscreen_exit', 'medium', details, 0, 'browser_focus');
        addActivityEvent({ type: 'focus_loss', label: 'Fullscreen Exit', details, severity: 'medium', timestamp: new Date() });
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Electron specific listeners if available
    let cleanupElectronBlur: (() => void) | undefined;
    let cleanupElectronFocus: (() => void) | undefined;
    let cleanupElectronFs: (() => void) | undefined;
    let cleanupElectronShortcut: (() => void) | undefined;
    let cleanupExternalApp: (() => void) | undefined;
    let cleanupElectronNav: (() => void) | undefined;
    let cleanupElectronMonitor: (() => void) | undefined;

    if (window.electronAPI) {
      cleanupElectronBlur = window.electronAPI.onWindowBlur((data) => {
        blurStartRef.current = data.timestamp;
        logProctorViolation('tab_switch', 'low', 'Student switched away from assessment.', 0, 'electron_kiosk');
        addActivityEvent({
          type: 'focus_loss',
          label: 'Switched Away',
          details: 'Student switched away from desktop assessment.',
          severity: 'low',
          timestamp: new Date(data.timestamp)
        });
      });

      cleanupElectronFocus = window.electronAPI.onWindowFocus((data) => {
        if (data.duration > 1000) {
          const details = `Student returned to assessment (Duration away: ${(data.duration / 1000).toFixed(1)}s).`;
          logProctorViolation('assessment_return', 'low', details, data.duration, 'electron_kiosk');
          addActivityEvent({
            type: 'focus_loss',
            label: 'Returned to Assessment',
            details,
            severity: 'low',
            timestamp: new Date(),
            duration: data.duration
          });
        }
      });

      cleanupElectronFs = window.electronAPI.onFullscreenExitAttempt(() => {
        const details = 'Attempted exit from locked assessment fullscreen.';
        logProctorViolation('fullscreen_exit', 'medium', details, 0, 'electron_kiosk');
        addActivityEvent({ type: 'focus_loss', label: 'Fullscreen Exit Attempt', details, severity: 'medium', timestamp: new Date() });
      });

      cleanupElectronShortcut = window.electronAPI.onBlockedShortcut((data) => {
        const details = `Restricted hotkey or system command intercepted: ${data.key || data.action || 'Unknown'}.`;
        logProctorViolation('restricted_key', 'medium', details, 0, 'keyboard_monitor');
      });

      // Navigation Policy: Intercept and display blocked external navigation attempts
      if (window.electronAPI.onNavigationBlocked) {
        cleanupElectronNav = window.electronAPI.onNavigationBlocked((data) => {
          const details = `External navigation blocked by exam policy: ${data.url}`;
          setBlockedNavigationNotice({ url: data.url, message: data.message });
          logProctorViolation('external_site_visit', 'high', details, 0, 'browser_navigation');
          addActivityEvent({
            type: 'focus_loss',
            label: 'Navigation Blocked',
            details,
            severity: 'high',
            timestamp: new Date(data.timestamp)
          });
          setTimeout(() => setBlockedNavigationNotice(null), 8000);
        });
      }

      // External App Detection (Windows foreground process monitoring)
      cleanupExternalApp = window.electronAPI.onExternalAppDetected((data) => {
        const details = `External ${data.category} detected: "${data.processName}" - ${data.windowTitle || 'No title'}`;
        logProctorViolation('external_app_detected', 'high', details, 0, 'electron_kiosk');
        addActivityEvent({
          type: 'external_app',
          label: data.category,
          details,
          severity: 'high',
          timestamp: new Date(data.timestamp)
        });
      });

      // In-App Web Activity & AI Prompt Monitoring
      if (window.electronAPI.onMonitoringEvent) {
        cleanupElectronMonitor = window.electronAPI.onMonitoringEvent((data) => {
          const isAI = (data.details || '').toLowerCase().includes('chatgpt') || 
                       (data.details || '').toLowerCase().includes('claude') || 
                       (data.details || '').toLowerCase().includes('prompt');
          addActivityEvent({
            type: 'browser_extension',
            label: isAI ? 'AI Platform / External Prompt' : 'External Web Activity',
            details: data.details || `Activity detected on ${data.url}`,
            severity: data.severity || 'high',
            timestamp: new Date()
          });
        });
      }
    }

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (cleanupElectronBlur) cleanupElectronBlur();
      if (cleanupElectronFocus) cleanupElectronFocus();
      if (cleanupElectronFs) cleanupElectronFs();
      if (cleanupElectronShortcut) cleanupElectronShortcut();
      if (cleanupElectronNav) cleanupElectronNav();
      if (cleanupExternalApp) cleanupExternalApp();
      if (cleanupElectronMonitor) cleanupElectronMonitor();
    };
  }, [logProctorViolation, addActivityEvent, assessment.policy]);

  // Sync proctoring events from backend to capture extension alerts and external events in real-time
  const knownEventIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!attempt?.id) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await proctoringAPI.getEvents(attempt.id);
        if (res && res.events) {
          let hasNewEvents = false;
          res.events.forEach(ev => {
            if (!knownEventIdsRef.current.has(ev.id)) {
              knownEventIdsRef.current.add(ev.id);
              hasNewEvents = true;

              // If event originated from extension or background monitor, display in activity feed
              if (ev.detectionSource === 'browser_extension' || ev.detectionSource === 'electron_kiosk') {
                const isAI = ev.details.toLowerCase().includes('chatgpt') || 
                             ev.details.toLowerCase().includes('claude') || 
                             ev.details.toLowerCase().includes('prompt');
                
                addActivityEvent({
                  type: 'browser_extension',
                  label: isAI ? 'AI Platform / External Prompt' : 'External Web Activity',
                  details: ev.details,
                  severity: ev.severity as any,
                  timestamp: new Date(ev.timestamp)
                });
              }
            }
          });

          if (hasNewEvents) {
            setViolationCount(res.events.length);
          }
        }
      } catch {
        // Silent catch for background polling
      }
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [attempt?.id, addActivityEvent]);

  // Countdown Timer Interval
  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleFinalSubmit(); // Auto-submit when time expires!
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Format timer MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Select Option and Autosave
  const handleSelectOption = async (optionIdx: number) => {
    if (!questions[currentIdx] || !attempt) return;
    const qId = questions[currentIdx].id;

    // Optimistically update local answer map
    const newAnswers = new Map(answers);
    newAnswers.set(qId, optionIdx);
    setAnswers(newAnswers);

    // Autosave to backend
    setSavingStatus('saving');
    try {
      await attemptsAPI.saveAnswer(attempt.id, qId, optionIdx);
      setSavingStatus('saved');
    } catch (e) {
      console.warn('Autosave answer error:', e);
      setSavingStatus('error');
    }
  };

  // Toggle Mark for Review
  const toggleMarkForReview = () => {
    if (!questions[currentIdx]) return;
    const qId = questions[currentIdx].id;
    const newSet = new Set(markedForReview);
    if (newSet.has(qId)) {
      newSet.delete(qId);
    } else {
      newSet.add(qId);
    }
    setMarkedForReview(newSet);
  };

  // Final Test Submission
  const handleFinalSubmit = async () => {
    if (!attempt || isSubmitting) return;
    setIsSubmitting(true);
    setShowSubmitModal(false);

    try {
      const result = await attemptsAPI.submit(attempt.id);
      onFinish(result);
    } catch (err: any) {
      alert(err.message || 'Submission failed');
      setIsSubmitting(false);
    }
  };

  const currentQuestion = questions[currentIdx];
  const selectedOption = currentQuestion ? answers.get(currentQuestion.id) : undefined;
  const isMarked = currentQuestion ? markedForReview.has(currentQuestion.id) : false;
  const answeredCount = answers.size;
  const isTimeCritical = remainingSeconds < 300; // Under 5 minutes

  if (!attempt || questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#070b14] text-white">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm font-semibold">Configuring assessment environment & proctoring sensors...</p>
        </div>
      </div>
    );
  }

  const severityColor = (severity: string) => {
    switch(severity) {
      case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'high': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'medium': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      default: return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    }
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col select-none">
      
      {/* Controlled Navigation: Blocked External Navigation Notice Banner */}
      {blockedNavigationNotice && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 px-4 py-2.5 text-xs text-amber-200 sticky top-0 z-50 animate-fade-in backdrop-blur-md">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 flex-wrap">
              <span className="flex items-center gap-1 font-bold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                <AlertTriangle className="w-3.5 h-3.5" /> Exam Policy Restriction
              </span>
              <span>{blockedNavigationNotice.message || 'External navigation is restricted.'}</span>
              <span className="font-mono text-amber-100 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/30 text-[11px] truncate max-w-md">
                {blockedNavigationNotice.url}
              </span>
              <span className="text-amber-400/80 text-[11px]">
                (Logged for proctor review • Exam continues normally)
              </span>
            </div>
            <button
              onClick={() => setBlockedNavigationNotice(null)}
              className="text-amber-400 hover:text-white p-1 rounded hover:bg-amber-500/20 transition shrink-0"
              title="Dismiss notice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-4 sm:px-6 py-3 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white leading-tight">{assessment.title}</h2>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span>Question {currentIdx + 1} of {questions.length}</span>
                <span>•</span>
                <span className={savingStatus === 'saving' ? 'text-amber-400' : 'text-emerald-400'}>
                  {savingStatus === 'saving' ? 'Saving answer...' : 'All answers saved'}
                </span>
              </div>
            </div>
          </div>

          {/* Center Timer */}
          <div className={`flex items-center space-x-2 px-4 py-1.5 rounded-full border font-mono font-bold text-sm ${
            isTimeCritical 
              ? 'bg-red-500/10 border-red-500/30 text-red-400 animate-pulse' 
              : 'bg-slate-950 border-slate-800 text-slate-200'
          }`}>
            <Clock className="w-4 h-4" />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          {/* Submit Action */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowSubmitModal(true)}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Assessment</span>
            </button>
          </div>

        </div>
      </header>

      {/* Tab Bar: Exam Paper | Activity Log */}
      <div className="bg-[#0a0f1d] border-b border-slate-800 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveTab('exam')}
              className={`py-2 px-4 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-t-2 ${
                activeTab === 'exam'
                  ? 'bg-slate-900 border-blue-500 text-white'
                  : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lock className="w-3.5 h-3.5 text-blue-400" />
              <span>Assessment Paper</span>
            </button>

            <button
              onClick={() => setActiveTab('activity')}
              className={`py-2 px-4 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-t-2 ${
                activeTab === 'activity'
                  ? 'bg-slate-900 border-amber-500 text-amber-300'
                  : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>Proctoring Activity</span>
              {externalActivityLog.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                  {externalActivityLog.length}
                </span>
              )}
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <ShieldAlert className="w-3.5 h-3.5 text-blue-400" />
            <span>Continuous AI Proctoring Active</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>
        </div>
      </div>


      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left / Center Area */}
        <div className="lg:col-span-8 space-y-6">
          {activeTab === 'exam' ? (
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
              
              {/* Question Meta Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
                <div className="flex items-center space-x-2">
                  <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    Question {currentIdx + 1}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-slate-800 text-slate-300">
                    {currentQuestion.category}
                  </span>
                </div>

                <button
                  onClick={toggleMarkForReview}
                  className={`text-xs px-3 py-1.5 rounded-xl border flex items-center gap-1.5 font-semibold transition ${
                    isMarked
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${isMarked ? 'fill-purple-400' : ''}`} />
                  <span>{isMarked ? 'Marked for Review' : 'Mark for Review'}</span>
                </button>
              </div>

              {/* Question Text */}
              <p className="text-base sm:text-lg font-medium text-white leading-relaxed mb-8">
                {currentQuestion.questionText}
              </p>

              {/* MCQ 4 Options */}
              <div className="space-y-3 mb-8">
                {currentQuestion.options.map((optText, optIdx) => {
                  const isSelected = selectedOption === optIdx;
                  const letter = String.fromCharCode(65 + optIdx); // A, B, C, D

                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleSelectOption(optIdx)}
                      className={`w-full text-left p-4 rounded-xl border transition flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-600/15 border-blue-500/80 text-white shadow-md shadow-blue-500/10'
                          : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 text-slate-300 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center space-x-3.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {letter}
                        </div>
                        <span className="text-sm font-medium leading-snug">{optText}</span>
                      </div>

                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-700 bg-slate-900'
                      }`}>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Bottom Nav Controls */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1 transition"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>

                <button
                  disabled={currentIdx === questions.length - 1}
                  onClick={() => setCurrentIdx(prev => Math.min(questions.length - 1, prev + 1))}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1 transition"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>

            </div>
          ) : (
            /* Automatic External Activity Monitor */
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
              
              {/* Header */}
              <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                    <Monitor className="w-4.5 h-4.5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Proctoring Activity Log</h3>
                    <p className="text-[11px] text-slate-400">Automatically captured violations & focus events</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('exam')}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to Exam
                </button>
              </div>

              {/* Detection Legend */}
              <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <div className="w-2 h-2 rounded-full bg-red-400"></div>
                  <span>Critical Violation</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                  <span>High Severity</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                  <span>Medium Severity</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Wifi className="w-3 h-3 text-blue-400" />
                  <span>Chrome Extension events auto-detected</span>
                </div>
              </div>

              {/* Extension Integration Notice */}
              <div className="mx-5 mt-4 p-3.5 bg-blue-500/5 border border-blue-500/20 rounded-xl flex items-start gap-2.5">
                <ExternalLink className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-blue-200">
                  <strong className="text-blue-100">Chrome Extension Active:</strong> Install the <strong>WUElev8 Proctor Companion</strong> extension in Chrome/Edge. It will automatically detect and report ChatGPT, Claude, and Google Search visits to this log without any student input.
                </div>
              </div>

              {/* Activity Event List */}
              <div className="p-5 space-y-3 max-h-96 overflow-y-auto">
                {externalActivityLog.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-semibold text-slate-400">No suspicious activity detected</p>
                    <p className="text-xs mt-1 text-slate-500">All proctoring events will appear here automatically</p>
                  </div>
                ) : (
                  externalActivityLog.map(event => (
                    <div
                      key={event.id}
                      className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 ${severityColor(event.severity)}`}
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-sm">{event.label}</span>
                          <span className="text-[10px] opacity-70 font-mono shrink-0">
                            {event.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="opacity-80 leading-relaxed break-words">{event.details}</p>
                        {event.duration && event.duration > 0 && (
                          <span className="mt-1 inline-block px-2 py-0.5 rounded bg-black/20 font-mono text-[10px]">
                            Duration: {(event.duration / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="px-5 pb-4">
                <p className="text-[10px] text-slate-500 text-center">
                  All events are automatically logged with timestamps and reported to the administrator. This log is read-only.
                </p>
              </div>
            </div>
          )}
        </div>


        {/* Right Sidebar: Proctor PIP & Navigation Grid (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Live Proctoring Corner PIP */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-white">
                <Camera className="w-3.5 h-3.5 text-blue-400" />
                <span>Live AI Proctor Feed</span>
              </div>

              {/* Status Chip */}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 ${
                proctorStatus === 'normal'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : proctorStatus === 'looking_away'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  : 'bg-red-500/15 text-red-400 border border-red-500/40 animate-pulse'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  proctorStatus === 'normal' ? 'bg-emerald-400' : proctorStatus === 'looking_away' ? 'bg-amber-400' : 'bg-red-400'
                }`}></span>
                {proctorStatus === 'normal' ? 'Verified' : proctorStatus === 'looking_away' ? 'Gaze Away' : 'Face Missing'}
              </span>
            </div>

            {/* Video Preview */}
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-slate-300 font-mono">
                Conf: {Math.round(faceConfidence * 100)}%
              </div>
            </div>

            {/* Policy Violations counter */}
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
              <span className="flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Observed Events:
              </span>
              <span className={`font-mono font-bold ${violationCount > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                {violationCount} / {assessment.policy.maxTotalViolations || 6}
              </span>
            </div>
          </div>

          {/* Question Navigation Palette */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Question Palette</h3>
              <span className="text-xs text-slate-400 font-mono">{answeredCount} / {questions.length} Solved</span>
            </div>

            {/* Grid of question tiles */}
            <div className="grid grid-cols-5 gap-2 mb-4">
              {questions.map((q, idx) => {
                const isCurrent = currentIdx === idx;
                const isAns = answers.has(q.id);
                const isRev = markedForReview.has(q.id);

                let bgClass = 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700';
                if (isAns && !isRev) bgClass = 'bg-emerald-600 text-white border-emerald-500';
                if (isRev) bgClass = 'bg-purple-600 text-white border-purple-500';

                return (
                  <button
                    key={q.id}
                    onClick={() => { setCurrentIdx(idx); setActiveTab('exam'); }}
                    className={`h-9 rounded-xl font-mono text-xs font-bold border transition relative ${bgClass} ${
                      isCurrent ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105 z-10' : ''
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 border-t border-slate-800 pt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                <span>Answered</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-700"></div>
                <span>Unanswered</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-purple-500"></div>
                <span>Marked for Review</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full ring-2 ring-blue-400 bg-transparent"></div>
                <span>Current</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Violation Alert Modal (Non-punitive warning) */}
      {activeViolationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <AlertOctagon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">{activeViolationModal.title}</h3>
                <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                  Audited Incident Recorded
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-4 rounded-xl border border-slate-800 my-4">
              {activeViolationModal.message}
            </p>

            <p className="text-[11px] text-slate-400 mb-6">
              Please maintain your camera view and stay inside the assessment window. These signals are logged for administrator review.
            </p>

            <button
              onClick={() => setActiveViolationModal(null)}
              className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold rounded-xl text-xs transition"
            >
              I Acknowledge & Return to Assessment
            </button>
          </div>
        </div>
      )}

      {/* Final Submission Confirmation Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Send className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Submit Assessment?</h3>
                <p className="text-xs text-slate-400">Review your answered questions</p>
              </div>
            </div>

            <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800 space-y-2 mb-6 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Total Questions:</span>
                <strong className="text-white">{questions.length}</strong>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Answered:</span>
                <strong className="text-emerald-400">{answeredCount}</strong>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Unanswered:</span>
                <strong className="text-amber-400">{questions.length - answeredCount}</strong>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Marked for Review:</span>
                <strong className="text-purple-400">{markedForReview.size}</strong>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Proctoring Events:</span>
                <strong className="text-amber-400">{violationCount}</strong>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                disabled={isSubmitting}
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition"
              >
                Continue Assessment
              </button>
              <button
                disabled={isSubmitting}
                onClick={handleFinalSubmit}
                className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs transition disabled:opacity-50"
              >
                {isSubmitting ? 'Scoring Answers...' : 'Confirm Submission'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
