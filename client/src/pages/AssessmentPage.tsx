import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Assessment, Attempt, Question, ProctoringEvent } from '../types';
import { attemptsAPI, questionsAPI, proctoringAPI } from '../services/api';
import { analyzeWebcamFrame } from '../services/faceDetection';
import { useTheme } from '../context/ThemeContext';
import { 
  Clock, ShieldAlert, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, 
  Bookmark, Send, Camera, Eye, AlertOctagon, Lock, X, Monitor, Wifi, ExternalLink,
  Activity, Sun, Moon
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
  const { theme, toggleTheme } = useTheme();
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
          await window.electronAPI.setExamPolicy?.({
            ...assessment.policy,
            permittedExternalDomains: assessment.policy.permittedWebsites
          });
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
              attemptId: startRes.attempt.id,
              policy: assessment.policy
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

      if (res.shouldAutoSubmit) {
        setActiveViolationModal({
          title: 'ASSESSMENT TERMINATED',
          message: 'This assessment has been automatically terminated due to repeated proctoring violations exceeding policy thresholds.',
          severity: 'critical'
        });
        setTimeout(() => {
          handleFinalSubmit();
        }, 3000);
        return;
      }

      const handling = assessment.policy.violationHandling || 'warn';
      const tabPolicy = assessment.policy.tabSwitchingPolicy || 'warn';

      if (handling !== 'record_only') {
        if (eventType === 'tab_switch') {
          if (tabPolicy === 'warn') {
            setActiveViolationModal({
              title: 'Tab Switching Warning',
              message: 'Window focus was lost. Tab switching is monitored for this assessment. Please keep focus on this exam window.',
              severity: 'medium'
            });
          } else if (tabPolicy === 'restrict') {
            setActiveViolationModal({
              title: 'Security Violation: Tab Switch Restricted',
              message: `Tab switching is strictly restricted for this assessment! Incident recorded (${res.currentViolationCount}/${assessment.policy.maxTotalViolations || 5}). Repeated infractions will terminate the exam.`,
              severity: 'high'
            });
          }
        } else if (eventType === 'face_missing' && severity === 'critical') {
          setActiveViolationModal({
            title: `Proctoring Alert: ${eventType.replace(/_/g, ' ').toUpperCase()}`,
            message: details,
            severity
          });
        }
      }
    } catch (e) {
      console.warn('Failed to log proctoring violation:', e);
    }
  }, [assessment.policy]);

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
      const tabPolicy = assessment.policy.tabSwitchingPolicy || 'warn';
      const severity = tabPolicy === 'restrict' ? 'high' : (tabPolicy === 'warn' ? 'medium' : 'low');
      const details = `Student switched away from assessment (Tab Policy: ${tabPolicy.toUpperCase()}).`;
      
      logProctorViolation('tab_switch', severity, details, 0, 'browser_focus');
      addActivityEvent({
        type: 'focus_loss',
        label: tabPolicy === 'restrict' ? 'Restricted Tab Switch' : (tabPolicy === 'warn' ? 'Tab Switch Alert' : 'Focus Shift'),
        details,
        severity,
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
        const tabPolicy = assessment.policy.tabSwitchingPolicy || 'warn';
        const severity = tabPolicy === 'restrict' ? 'high' : (tabPolicy === 'warn' ? 'medium' : 'low');
        const details = `Student switched away from desktop assessment (Tab Policy: ${tabPolicy.toUpperCase()}).`;
        
        logProctorViolation('tab_switch', severity, details, 0, 'electron_kiosk');
        addActivityEvent({
          type: 'focus_loss',
          label: tabPolicy === 'restrict' ? 'Restricted Desktop Switch' : 'Focus Shift',
          details,
          severity,
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
      <div className="min-h-screen flex items-center justify-center bg-white text-black font-swiss">
        <div className="text-center border-2 border-black p-8 bg-[#f0f0f0]">
          <div className="w-8 h-8 border-2 border-black border-t-transparent animate-spin mx-auto mb-4"></div>
          <p className="text-xs font-bold uppercase tracking-[0.12em]">Configuring assessment runtime & proctoring sensors...</p>
        </div>
      </div>
    );
  }

  const severityColor = (severity: string) => {
    switch(severity) {
      case 'critical': return 'text-black bg-[#f0f0f0] border-2 border-[#c90000]';
      case 'high': return 'text-black bg-[#f0f0f0] border-2 border-black';
      case 'medium': return 'text-black bg-[#f0f0f0] border-2 border-neutral-600';
      default: return 'text-black bg-white border-2 border-black';
    }
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col select-none font-swiss">
      
      {/* Controlled Navigation: Blocked External Navigation Notice Banner */}
      {blockedNavigationNotice && (
        <div className="bg-[#f0f0f0] border-b-2 border-[#c90000] px-4 py-2.5 text-xs text-black sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 flex-wrap">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-[0.12em] bg-black text-white px-2 py-0.5 text-[11px]">
                <span className="w-2 h-2 bg-[#c90000] inline-block"></span>
                Policy Restriction
              </span>
              <span className="font-semibold">{blockedNavigationNotice.message || 'External navigation is restricted.'}</span>
              <span className="font-mono text-black bg-white px-2 py-0.5 border-2 border-black text-[11px] truncate max-w-md">
                {blockedNavigationNotice.url}
              </span>
              <span className="text-neutral-600 text-[11px] font-mono">
                [Audited for evaluation • Session active]
              </span>
            </div>
            <button
              onClick={() => setBlockedNavigationNotice(null)}
              className="text-black hover:text-[#c90000] p-1 border border-black hover:bg-black hover:text-white transition shrink-0 cursor-pointer"
              title="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="bg-white border-b-2 border-black px-4 sm:px-6 py-3.5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          
          <div className="flex items-center space-x-3.5">
            <div className="w-8 h-8 bg-black flex items-center justify-center text-white border-2 border-black">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-extrabold text-sm text-black uppercase tracking-tight leading-tight">{assessment.title}</h2>
              <div className="flex items-center gap-2 text-[11px] text-neutral-600 font-mono">
                <span>QUESTION {currentIdx + 1} OF {questions.length}</span>
                <span>•</span>
                <span className={savingStatus === 'saving' ? 'text-[#c90000] font-bold' : 'text-black font-bold'}>
                  {savingStatus === 'saving' ? 'SAVING...' : 'SAVED'}
                </span>
              </div>
            </div>
          </div>

          {/* Assessment Security Badges */}
          <div className="hidden md:flex items-center gap-2">
            {assessment.policy.aiUsage === 'allowed' ? (
              <span className="text-[11px] px-2.5 py-1 font-bold uppercase tracking-[0.12em] bg-[#f0f0f0] border-2 border-black text-black flex items-center gap-1.5">
                <span className="w-2 h-2 bg-black inline-block"></span>
                AI Allowed ({assessment.policy.aiPromptMonitoring === 'enabled' ? 'Prompts Monitored' : 'Audit Off'})
              </span>
            ) : (
              <span className="text-[11px] px-2.5 py-1 font-bold uppercase tracking-[0.12em] bg-black text-white flex items-center gap-1.5">
                <span className="w-2 h-2 bg-[#c90000] inline-block"></span>
                AI Prohibited • Tabs {(assessment.policy.tabSwitchingPolicy || 'warn').toUpperCase()}
              </span>
            )}
          </div>

          {/* Center Timer */}
          <div className={`flex items-center space-x-2 px-3.5 py-1 border-2 font-mono font-black text-sm uppercase ${
            isTimeCritical 
              ? 'bg-[#f0f0f0] border-[#c90000] text-[#c90000]' 
              : 'bg-[#f0f0f0] border-black text-black'
          }`}>
            <Clock className="w-4 h-4" />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          {/* Controls: Theme & Submit Action */}
          <div className="flex items-center space-x-2.5">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Screen Mode'}
              className="p-2 text-black bg-white hover:bg-black hover:text-white border-2 border-black transition cursor-pointer flex items-center gap-1.5"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-black" />
                  <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.12em]">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-black" />
                  <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.12em]">Dark</span>
                </>
              )}
            </button>

            <button
              onClick={() => setShowSubmitModal(true)}
              disabled={isSubmitting}
              className="px-4 py-2 bg-black hover:bg-neutral-800 text-white font-bold border-2 border-black text-xs uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Assessment</span>
            </button>
          </div>

        </div>
      </header>

      {/* Tab Bar: Exam Paper | Activity Log */}
      <div className="bg-[#f0f0f0] border-b-2 border-black px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex space-x-2 pt-2">
            <button
              onClick={() => setActiveTab('exam')}
              className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] transition flex items-center gap-2 border-2 border-black cursor-pointer ${
                activeTab === 'exam'
                  ? 'bg-white text-black border-b-0'
                  : 'bg-[#f0f0f0] text-neutral-600 hover:text-black border-transparent'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Assessment Paper</span>
            </button>

            <button
              onClick={() => setActiveTab('activity')}
              className={`py-2 px-4 text-xs font-bold uppercase tracking-[0.12em] transition flex items-center gap-2 border-2 border-black cursor-pointer ${
                activeTab === 'activity'
                  ? 'bg-white text-black border-b-0'
                  : 'bg-[#f0f0f0] text-neutral-600 hover:text-black border-transparent'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Proctoring Activity</span>
              {externalActivityLog.length > 0 && (
                <span className="px-1.5 py-0.2 bg-black text-white text-[10px] font-mono">
                  {externalActivityLog.length}
                </span>
              )}
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-[11px] text-black font-bold uppercase tracking-[0.12em]">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Continuous Proctoring Active</span>
            <span className="w-2 h-2 bg-black inline-block"></span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left / Center Area */}
        <div className="lg:col-span-8 space-y-6">
          {activeTab === 'exam' ? (
            <div className="border-2 border-black bg-white p-6 sm:p-8">
              
              {/* Question Meta Header */}
              <div className="flex items-center justify-between pb-4 border-b-2 border-black mb-6">
                <div className="flex items-center space-x-2">
                  <span className="text-xs px-2.5 py-1 font-bold uppercase tracking-[0.12em] bg-black text-white">
                    QUESTION {currentIdx + 1 < 10 ? `0${currentIdx + 1}` : currentIdx + 1}
                  </span>
                  <span className="text-xs px-2.5 py-1 font-bold uppercase tracking-[0.12em] bg-[#f0f0f0] border-2 border-black text-black">
                    {currentQuestion.category}
                  </span>
                </div>

                <button
                  onClick={toggleMarkForReview}
                  className={`text-xs px-3 py-1.5 border-2 border-black flex items-center gap-1.5 font-bold uppercase tracking-[0.12em] transition cursor-pointer ${
                    isMarked
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-[#f0f0f0]'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${isMarked ? 'fill-white' : ''}`} />
                  <span>{isMarked ? 'Marked for Review' : 'Mark for Review'}</span>
                </button>
              </div>

              {/* Question Text */}
              <p className="text-lg sm:text-xl font-bold text-black leading-snug mb-8">
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
                      className={`w-full text-left p-4 border-2 border-black transition cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-black text-white font-bold'
                          : 'bg-white hover:bg-[#f0f0f0] text-black'
                      }`}
                    >
                      <div className="flex items-center space-x-3.5">
                        <div className={`w-7 h-7 border-2 border-current flex items-center justify-center font-bold text-xs shrink-0 ${
                          isSelected ? 'bg-black text-white' : 'bg-[#f0f0f0] text-black'
                        }`}>
                          {letter}
                        </div>
                        <span className="text-sm font-medium leading-snug">{optText}</span>
                      </div>

                      <div className={`w-5 h-5 border-2 border-current flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-white text-black' : 'bg-transparent'
                      }`}>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-black" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Bottom Nav Controls */}
              <div className="flex items-center justify-between pt-5 border-t-2 border-black">
                <button
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
                  className="px-5 py-2.5 bg-white hover:bg-[#f0f0f0] disabled:opacity-30 disabled:cursor-not-allowed text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>

                <button
                  disabled={currentIdx === questions.length - 1}
                  onClick={() => setCurrentIdx(prev => Math.min(questions.length - 1, prev + 1))}
                  className="px-6 py-2.5 bg-black hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>

            </div>
          ) : (
            /* Automatic External Activity Monitor */
            <div className="border-2 border-black bg-white overflow-hidden">
              
              {/* Header */}
              <div className="bg-[#f0f0f0] px-5 py-4 border-b-2 border-black flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                    <Monitor className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm uppercase tracking-tight text-black">Proctoring Activity Log</h3>
                    <p className="text-[11px] text-neutral-600 font-mono">AUTOMATIC SENSOR & NAVIGATION RECORD</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('exam')}
                  className="px-3.5 py-1.5 bg-white hover:bg-black hover:text-white text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to Exam
                </button>
              </div>

              {/* Detection Legend */}
              <div className="px-5 py-3 border-b-2 border-black bg-white flex flex-wrap gap-4 text-[11px] font-bold uppercase tracking-[0.12em]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-[#c90000]"></span>
                  <span>Critical Violation</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-black"></span>
                  <span>High / Medium Severity</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-neutral-400"></span>
                  <span>Companion Auto-Captured</span>
                </div>
              </div>

              {/* Extension Integration Notice */}
              <div className="mx-5 mt-4 p-3.5 bg-[#f0f0f0] border-2 border-black text-xs text-black leading-relaxed">
                <strong className="block mb-1 uppercase tracking-[0.12em] font-bold">Companion Extension Status:</strong>
                The WUElev8 companion monitors authorized AI interactions and restricts unauthorized platform access according to this assessment's active policy.
              </div>

              {/* Activity Event List */}
              <div className="p-5 space-y-3 max-h-96 overflow-y-auto divide-y-2 divide-black">
                {externalActivityLog.length === 0 ? (
                  <div className="text-center py-12 text-black">
                    <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-neutral-400" />
                    <p className="text-xs font-bold uppercase tracking-[0.12em]">No violations detected</p>
                    <p className="text-[11px] text-neutral-600 font-mono mt-1">All audit events will stream here</p>
                  </div>
                ) : (
                  externalActivityLog.map(event => (
                    <div
                      key={event.id}
                      className={`p-3.5 text-xs flex items-start gap-3 pt-3 first:pt-0 ${severityColor(event.severity)}`}
                    >
                      <span className={`w-2 h-2 shrink-0 mt-1 ${event.severity === 'critical' ? 'bg-[#c90000]' : 'bg-black'}`}></span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-xs uppercase tracking-[0.12em]">{event.label}</span>
                          <span className="text-[10px] font-mono text-neutral-600 shrink-0">
                            {event.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-neutral-800 leading-relaxed break-words">{event.details}</p>
                        {event.duration && event.duration > 0 && (
                          <span className="mt-1 inline-block px-2 py-0.5 bg-black text-white font-mono text-[10px]">
                            Duration: {(event.duration / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="px-5 pb-4 border-t-2 border-black pt-3 bg-[#f0f0f0]">
                <p className="text-[10px] text-neutral-600 uppercase font-mono text-center">
                  All events are authoritatively logged with timestamps. Read-only timeline.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Proctor PIP & Navigation Grid (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Live Proctoring Corner PIP */}
          <div className="border-2 border-black bg-white p-4">
            <div className="flex items-center justify-between mb-3 border-b-2 border-black pb-2">
              <div className="flex items-center space-x-1.5 text-xs font-bold uppercase tracking-[0.12em] text-black">
                <Camera className="w-3.5 h-3.5 text-black" />
                <span>AI PROCTOR FEED</span>
              </div>

              {/* Status Chip */}
              <span className={`text-[10px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${
                proctorStatus === 'normal'
                  ? 'bg-black text-white'
                  : 'bg-[#f0f0f0] border-2 border-black text-black'
              }`}>
                <span className={`w-1.5 h-1.5 ${
                  proctorStatus === 'normal' ? 'bg-white' : 'bg-[#c90000]'
                }`}></span>
                {proctorStatus === 'normal' ? 'Verified' : proctorStatus === 'looking_away' ? 'Gaze Away' : 'Face Missing'}
              </span>
            </div>

            {/* Video Preview (Rectangular Crop) */}
            <div className="relative aspect-video bg-black overflow-hidden border-2 border-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
              <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black text-white text-[10px] font-mono">
                CONF: {Math.round(faceConfidence * 100)}%
              </div>
            </div>

            {/* Policy Violations counter */}
            <div className="mt-3 flex items-center justify-between text-xs text-black bg-[#f0f0f0] p-2.5 border-2 border-black">
              <span className="font-bold uppercase tracking-[0.12em] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-black" /> Observed Events:
              </span>
              <span className="font-mono font-black text-sm">
                {violationCount} / {assessment.policy.maxTotalViolations || 6}
              </span>
            </div>
          </div>

          {/* Question Navigation Palette */}
          <div className="border-2 border-black bg-white p-5">
            <div className="flex items-center justify-between mb-4 border-b-2 border-black pb-2">
              <h3 className="text-xs font-bold text-black uppercase tracking-[0.12em]">Question Palette</h3>
              <span className="text-xs text-black font-mono font-bold">{answeredCount} / {questions.length} Solved</span>
            </div>

            {/* Grid of question tiles (Rectangular) */}
            <div className="grid grid-cols-5 gap-2 mb-4">
              {questions.map((q, idx) => {
                const isCurrent = currentIdx === idx;
                const isAns = answers.has(q.id);
                const isRev = markedForReview.has(q.id);

                let bgClass = 'bg-white text-black border-2 border-black hover:bg-[#f0f0f0]';
                if (isAns && !isRev) bgClass = 'bg-black text-white border-2 border-black';
                if (isRev) bgClass = 'bg-[#f0f0f0] text-black border-2 border-[#c90000]';

                return (
                  <button
                    key={q.id}
                    onClick={() => { setCurrentIdx(idx); setActiveTab('exam'); }}
                    className={`h-9 font-mono text-xs font-bold border-2 transition cursor-pointer ${bgClass} ${
                      isCurrent ? 'outline-2 outline-black outline-offset-2' : ''
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-black border-t-2 border-black pt-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-black"></span>
                <span>Answered</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-white border border-black"></span>
                <span>Unanswered</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#f0f0f0] border border-[#c90000]"></span>
                <span>Marked</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 outline-2 outline-black"></span>
                <span>Current</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Violation Alert Modal (Non-punitive warning) */}
      {activeViolationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-white border-2 border-[#c90000] p-6 sm:p-8">
            <div className="flex items-center space-x-3 mb-3 border-b-2 border-black pb-3">
              <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                <AlertOctagon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">{activeViolationModal.title}</h3>
                <span className="text-[11px] font-bold text-[#c90000] uppercase tracking-[0.12em]">
                  Audited Incident Recorded
                </span>
              </div>
            </div>

            <p className="text-xs text-black leading-relaxed bg-[#f0f0f0] p-4 border-2 border-black my-4">
              {activeViolationModal.message}
            </p>

            <p className="text-[11px] text-neutral-600 uppercase font-mono mb-6">
              Please maintain your camera view and stay inside the assessment window. Recorded in admin timeline.
            </p>

            <button
              onClick={() => setActiveViolationModal(null)}
              className="w-full py-3 bg-black hover:bg-neutral-800 text-white font-bold border-2 border-black text-xs uppercase tracking-[0.12em] transition cursor-pointer"
            >
              I Acknowledge & Return to Assessment
            </button>
          </div>
        </div>
      )}

      {/* Final Submission Confirmation Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-white border-2 border-black p-6 sm:p-8">
            <div className="flex items-center space-x-3 mb-4 border-b-2 border-black pb-3">
              <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                <Send className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">Submit Assessment?</h3>
                <p className="text-xs text-neutral-600 font-mono">Review questions summary before submitting</p>
              </div>
            </div>

            <div className="bg-[#f0f0f0] p-4 border-2 border-black space-y-2 mb-6 text-xs divide-y divide-neutral-300">
              <div className="flex justify-between text-black font-bold uppercase tracking-[0.12em] pt-1 first:pt-0">
                <span>Total Questions:</span>
                <span>{questions.length}</span>
              </div>
              <div className="flex justify-between text-black font-bold uppercase tracking-[0.12em] pt-1">
                <span>Answered:</span>
                <span>{answeredCount}</span>
              </div>
              <div className="flex justify-between text-black font-bold uppercase tracking-[0.12em] pt-1">
                <span>Unanswered:</span>
                <span>{questions.length - answeredCount}</span>
              </div>
              <div className="flex justify-between text-black font-bold uppercase tracking-[0.12em] pt-1">
                <span>Marked for Review:</span>
                <span>{markedForReview.size}</span>
              </div>
              <div className="flex justify-between text-black font-bold uppercase tracking-[0.12em] pt-1">
                <span>Proctoring Events:</span>
                <span>{violationCount}</span>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                disabled={isSubmitting}
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 py-3 bg-white hover:bg-[#f0f0f0] text-black border-2 border-black font-bold text-xs uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Continue Assessment
              </button>
              <button
                disabled={isSubmitting}
                onClick={handleFinalSubmit}
                className="flex-1 py-3 bg-black hover:bg-neutral-800 text-white border-2 border-black font-bold text-xs uppercase tracking-[0.12em] transition disabled:opacity-50 cursor-pointer"
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
