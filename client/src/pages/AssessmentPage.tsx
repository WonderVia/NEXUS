import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Assessment, Attempt, Question, ProctoringEvent } from '../types';
import { attemptsAPI, questionsAPI, proctoringAPI } from '../services/api';
import { offlineSyncManager, OfflineSyncState } from '../services/offlineSync';
import { analyzeWebcamFrame } from '../services/faceDetection';
import { useTheme } from '../context/ThemeContext';
import { 
  Clock, ShieldAlert, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, 
  Bookmark, Send, Camera, Eye, AlertOctagon, Lock, X, Monitor, Wifi, ExternalLink,
  Activity, Sun, Moon, ArrowLeft, ArrowRight, RotateCw, Home, Plus, Globe,
  Bot, ShieldCheck, ShieldX, Terminal, Sparkles, AlertCircle, RefreshCw, Database
} from 'lucide-react';

interface AssessmentPageProps {
  assessment: Assessment;
  forceNew?: boolean;
  onFinish: (result: any) => void;
  onExit: () => void;
}

interface ExternalActivityEvent {
  id: string;
  type: 'external_app' | 'focus_loss' | 'browser_extension' | 'prompt_captured' | 'security_lockdown';
  label: string;
  details: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  duration?: number;
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  isExamTab?: boolean;
  isAiTab?: boolean;
  status: 'allowed' | 'blocked' | 'loading';
  blockedReason?: string;
  isAi?: boolean;
}

export const AssessmentPage: React.FC<AssessmentPageProps> = ({ assessment, forceNew, onFinish, onExit }) => {
  const { theme, toggleTheme } = useTheme();

  // Assessment & Exam State
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Map<string, number>>(new Map());
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(new Set());

  // Browser Architecture State
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([
    {
      id: 'tab-exam',
      title: 'Examination Assessment',
      url: 'wuelev8://examination-session',
      isExamTab: true,
      status: 'allowed'
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-exam');
  const [urlInput, setUrlInput] = useState<string>('wuelev8://examination-session');
  const [browserHistory, setBrowserHistory] = useState<string[]>(['wuelev8://examination-session']);
  const [historyIdx, setHistoryIdx] = useState<number>(0);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);

  // Webview Reference for In-App Browser Controls
  const webviewRef = useRef<any>(null);

  // Activity Log & Lockdown State
  const [activeTabMode, setActiveTabMode] = useState<'browser' | 'activity'>('browser');
  const [externalActivityLog, setExternalActivityLog] = useState<ExternalActivityEvent[]>([]);
  const [blockedNavigationNotice, setBlockedNavigationNotice] = useState<{ url: string; message?: string } | null>(null);

  // Timer & Heartbeat State
  const [remainingSeconds, setRemainingSeconds] = useState(assessment.durationMinutes * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [heartbeatOk, setHeartbeatOk] = useState<boolean>(true);

  // Offline Examination & Synchronization State
  const [offlineState, setOfflineState] = useState<OfflineSyncState>(offlineSyncManager.getState());
  const [offlineSubmittedNotice, setOfflineSubmittedNotice] = useState<string | null>(null);

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

  // Tracking references for debounced events
  const faceAbsenceStartRef = useRef<number | null>(null);
  const faceMissingLoggedRef = useRef<boolean>(false);
  const multipleFacesLoggedRef = useRef<boolean>(false);
  const blurStartRef = useRef<number | null>(null);
  const attemptIdRef = useRef<string | null>(null);

  const addActivityEvent = useCallback((event: Omit<ExternalActivityEvent, 'id'>) => {
    const newEvent: ExternalActivityEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
    };
    setExternalActivityLog(prev => [newEvent, ...prev].slice(0, 60));
  }, []);

  // Subscribe to Offline Synchronization State
  useEffect(() => {
    const unsub = offlineSyncManager.subscribe(setOfflineState);
    return unsub;
  }, []);

  // Initialize Assessment and Questions & Setup Approved Tabs
  useEffect(() => {
    async function init() {
      try {
        const startRes = await attemptsAPI.start(assessment.id, forceNew);
        setAttempt(startRes.attempt);
        attemptIdRef.current = startRes.attempt.id;
        setRemainingSeconds(startRes.remainingSeconds);

        const currentAnswersMap = new Map<string, number>();
        if (startRes.savedAnswers && startRes.savedAnswers.length > 0) {
          startRes.savedAnswers.forEach(a => currentAnswersMap.set(a.questionId, a.selectedOption));
        }

        // Initialize Offline Mode & Pre-cache Package if policy permits
        const isOfflineAllowed = Boolean(assessment.policy?.allowOfflineMode);
        let cachedPkg = null;
        if (isOfflineAllowed) {
          try {
            const pkgRes = await attemptsAPI.getOfflinePackage(startRes.attempt.id);
            if (pkgRes?.package) {
              cachedPkg = pkgRes.package;
            }
          } catch (pkgErr) {
            console.warn('[AssessmentPage] Could not fetch remote offline package, checking local store:', pkgErr);
          }
        }

        // Start offline sync manager with attempt context
        await offlineSyncManager.start(startRes.attempt.id, isOfflineAllowed, cachedPkg || undefined);

        // Check if there are locally persisted answers in SQLite (e.g. from app restart or previous offline work)
        if (window.electronAPI?.offline?.getSavedAnswers) {
          try {
            const localAnswers = await window.electronAPI.offline.getSavedAnswers(startRes.attempt.id);
            if (localAnswers && localAnswers.length > 0) {
              localAnswers.forEach(la => {
                if (!currentAnswersMap.has(la.questionId)) {
                  currentAnswersMap.set(la.questionId, la.selectedOption);
                }
              });
            }
          } catch (err) {
            console.warn('[AssessmentPage] Error loading local answers:', err);
          }
        }
        setAnswers(currentAnswersMap);

        const qRes = await questionsAPI.getByAssessment(assessment.id);
        setQuestions(qRes.questions);

        // Configure Initial Browser Tabs according to Policy
        const initialTabs: BrowserTab[] = [
          {
            id: 'tab-exam',
            title: 'Examination Assessment',
            url: 'wuelev8://examination-session',
            isExamTab: true,
            status: 'allowed'
          }
        ];

        setBrowserTabs(initialTabs);

        // Enable Exam Security Mode in Electron
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

        // Notify Chrome / Edge extension companion if active
        try {
          const wChrome = (window as any).chrome;
          if (wChrome?.runtime?.sendMessage) {
            const token = localStorage.getItem('proctor_auth_token');
            wChrome.runtime.sendMessage({
              type: 'SET_ASSESSMENT_ACTIVE',
              token,
              attemptId: startRes.attempt.id,
              policy: assessment.policy
            }, () => {});
          }
        } catch {}

      } catch (err: any) {
        console.error('Failed to initialize assessment:', err);
        alert(err.message || 'Error starting assessment');
        onExit();
      }
    }

    init();

    return () => {
      offlineSyncManager.stop();
      if (window.electronAPI) {
        window.electronAPI.setExamMode(false);
        window.electronAPI.setActiveSessionInfo?.({});
      }
      try {
        const wChrome = (window as any).chrome;
        if (wChrome?.runtime?.sendMessage) {
          wChrome.runtime.sendMessage({ type: 'CLEAR_ASSESSMENT' }, () => {});
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
    source: string = 'webcam_cv',
    promptText?: string,
    url?: string
  ) => {
    const currentAttemptId = attemptIdRef.current;
    if (!currentAttemptId) return;

    // Durably log proctoring event locally for offline persistence and sync
    offlineSyncManager.logProctoringEventDurable({
      eventType,
      severity,
      details,
      detectionSource: source,
      timestamp: new Date().toISOString()
    }).catch(() => {});

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
          message: 'This examination has been terminated in accordance with the institutional policy due to repeated security infractions.',
          severity: 'critical'
        });
        setTimeout(() => {
          handleFinalSubmit();
        }, 3200);
        return;
      }

      const handling = assessment.policy.violationHandling || 'warn';
      const tabPolicy = assessment.policy.tabSwitchingPolicy || 'warn';

      if (handling !== 'record_only') {
        if (eventType === 'tab_switch') {
          if (tabPolicy === 'warn') {
            setActiveViolationModal({
              title: 'Tab Switch Advisory',
              message: 'Window focus was lost. External tab switching is monitored for this assessment. Please maintain focus on the exam browser.',
              severity: 'medium'
            });
          } else if (tabPolicy === 'restrict') {
            setActiveViolationModal({
              title: 'Security Infraction: Tab Switch Restricted',
              message: `Tab switching is prohibited for this assessment! Incident recorded (${res.currentViolationCount}/${assessment.policy.maxTotalViolations || 5}). Continued infractions will escalate to exam termination.`,
              severity: 'high'
            });
          }
        }
      }
    } catch (e) {
      console.warn('Event logging error:', e);
    }
  }, [assessment.policy]);

  // Heartbeat Poller for Tamper Resistance & Backend Health
  useEffect(() => {
    const heartbeatTimer = setInterval(async () => {
      if (window.electronAPI?.heartbeat) {
        try {
          const status = await window.electronAPI.heartbeat({
            attemptId: attemptIdRef.current,
            timestamp: Date.now()
          });
          setHeartbeatOk(Boolean(status?.backendHealthy));
        } catch {
          setHeartbeatOk(false);
        }
      }
    }, 4500);

    return () => clearInterval(heartbeatTimer);
  }, []);

  // WebCam CV Face & Gaze Tracking
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cvTimer: any = null;

    async function startWebcam() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 15 } },
          audio: false
        });
        setWebcamStream(stream);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        cvTimer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          const result = await analyzeWebcamFrame(videoRef.current);
          setProctorStatus(result.status);
          setFaceConfidence(result.confidence);

          if (result.status === 'no_face') {
            if (!faceAbsenceStartRef.current) {
              faceAbsenceStartRef.current = Date.now();
            } else {
              const absenceDurationSec = (Date.now() - faceAbsenceStartRef.current) / 1000;
              const threshold = assessment.policy.faceAbsenceTimeoutSec || 6;

              if (absenceDurationSec >= threshold && !faceMissingLoggedRef.current) {
                faceMissingLoggedRef.current = true;
                const details = `Candidate face not detected in proctor camera feed for >${Math.round(absenceDurationSec)} seconds.`;
                logProctorViolation('face_missing', 'high', details, Math.round(absenceDurationSec * 1000));
                addActivityEvent({ type: 'focus_loss', label: 'Face Missing', details, severity: 'high', timestamp: new Date(), duration: Math.round(absenceDurationSec * 1000) });
              }
            }
          } else {
            faceAbsenceStartRef.current = null;
            faceMissingLoggedRef.current = false;
          }

          if (result.status === 'multiple_faces') {
            if (!multipleFacesLoggedRef.current) {
              multipleFacesLoggedRef.current = true;
              const details = `Multiple individuals (${result.faceCount} faces) detected in candidate environment.`;
              logProctorViolation('multiple_faces', 'critical', details);
              addActivityEvent({ type: 'focus_loss', label: 'Multiple Faces', details, severity: 'critical', timestamp: new Date() });
            }
          } else {
            multipleFacesLoggedRef.current = false;
          }
        }, 750);

      } catch (err) {
        console.warn('Webcam start failed:', err);
        logProctorViolation('system_anomaly', 'high', 'Candidate webcam feed unavailable during active assessment.');
      }
    }

    startWebcam();

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      clearInterval(cvTimer);
    };
  }, [logProctorViolation, assessment.policy]);

  // Window Focus, Blur, Fullscreen & Windows-Level Lockdown Listeners
  useEffect(() => {
    const handleBlur = () => {
      blurStartRef.current = Date.now();
      const tabPolicy = assessment.policy.tabSwitchingPolicy || 'warn';
      const severity = tabPolicy === 'restrict' ? 'high' : (tabPolicy === 'warn' ? 'medium' : 'low');
      const details = `Student switched focus away from exam browser (Tab Policy: ${tabPolicy.toUpperCase()}).`;
      
      logProctorViolation('tab_switch', severity, details, 0, 'browser_focus');
      addActivityEvent({
        type: 'focus_loss',
        label: tabPolicy === 'restrict' ? 'Restricted Focus Loss' : 'Focus Shift',
        details,
        severity,
        timestamp: new Date()
      });
    };

    const handleFocus = () => {
      if (blurStartRef.current) {
        const duration = Date.now() - blurStartRef.current;
        if (duration > 1000) {
          const details = `Student returned to exam browser after ${(duration / 1000).toFixed(1)}s away.`;
          logProctorViolation('assessment_return', 'low', details, duration, 'browser_focus');
          addActivityEvent({
            type: 'focus_loss',
            label: 'Returned to Exam Browser',
            details,
            severity: 'low',
            timestamp: new Date(),
            duration
          });
        }
        blurStartRef.current = null;
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && assessment.policy.requireFullscreen) {
        const details = 'Candidate exited fullscreen mode.';
        logProctorViolation('fullscreen_exit', 'medium', details, 0, 'browser_focus');
        addActivityEvent({ type: 'focus_loss', label: 'Fullscreen Exit', details, severity: 'medium', timestamp: new Date() });
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    let cleanups: (() => void)[] = [];

    if (window.electronAPI) {
      // 1. External Browser Detected (Chrome/Edge outside WUElev8)
      if (window.electronAPI.onExternalBrowserDetected) {
        cleanups.push(window.electronAPI.onExternalBrowserDetected((data) => {
          const details = `External browser window focused: ${data.processName} ("${data.windowTitle || 'No title'}")`;
          logProctorViolation('external_browser_detected', 'high', details, 0, 'windows_monitor');
          addActivityEvent({
            type: 'security_lockdown',
            label: 'External Browser Detected',
            details,
            severity: 'high',
            timestamp: new Date(data.timestamp)
          });
          setActiveViolationModal({
            title: 'EXTERNAL BROWSER DETECTED',
            message: `External browser window (${data.processName}) focused during strict assessment mode. Opening external browsers violates assessment policy.`,
            severity: 'high'
          });
        }));
      }

      // 2. Incognito / Private Browser Detected
      if (window.electronAPI.onIncognitoDetected) {
        cleanups.push(window.electronAPI.onIncognitoDetected((data) => {
          const details = `Chrome Incognito / InPrivate window focused: ${data.processName} ("${data.windowTitle || 'Incognito'}"). Evidence: ${data.evidence}`;
          logProctorViolation('incognito_browser_detected', 'critical', details, 0, 'windows_monitor');
          addActivityEvent({
            type: 'security_lockdown',
            label: 'Incognito Browser Detected',
            details,
            severity: 'critical',
            timestamp: new Date(data.timestamp)
          });
          setActiveViolationModal({
            title: 'CRITICAL: INCOGNITO WINDOW DETECTED',
            message: `A Chrome Incognito / Private browsing window was detected (${data.processName}: "${data.windowTitle}"). External private browsing is strictly prohibited during the assessment!`,
            severity: 'critical'
          });
        }));
      }

      // 3. Close Attempt Prevented
      if (window.electronAPI.onCloseAttempt) {
        cleanups.push(window.electronAPI.onCloseAttempt((data) => {
          const details = 'Candidate attempted to close examination window during active lockdown.';
          logProctorViolation('exam_exit_attempt', 'critical', details, 0, 'electron_kiosk');
          addActivityEvent({ type: 'security_lockdown', label: 'Close Attempt Prevented', details, severity: 'critical', timestamp: new Date(data.timestamp) });
          setActiveViolationModal({
            title: 'ACTION RESTRICTED: EXAM LOCKDOWN',
            message: 'You cannot close the WUElev8 Lockdown Browser while an examination is currently in progress. Use the Submit button to finalize.',
            severity: 'high'
          });
        }));
      }

      // 4. Minimize Attempt Prevented
      if (window.electronAPI.onMinimizeAttempt) {
        cleanups.push(window.electronAPI.onMinimizeAttempt((data) => {
          const details = 'Candidate attempted to minimize the examination window.';
          logProctorViolation('window_minimized', 'high', details, 0, 'electron_kiosk');
          addActivityEvent({ type: 'security_lockdown', label: 'Window Minimized', details, severity: 'high', timestamp: new Date(data.timestamp) });
        }));
      }

      // 5. Blocked Shortcut
      cleanups.push(window.electronAPI.onBlockedShortcut((data) => {
        const details = `Restricted hotkey or system command intercepted: ${data.key || 'Unknown'}.`;
        logProctorViolation('restricted_key', 'medium', details, 0, 'keyboard_monitor');
      }));

      // 6. Navigation Blocked by Policy
      if (window.electronAPI.onNavigationBlocked) {
        cleanups.push(window.electronAPI.onNavigationBlocked((data) => {
          const details = `Navigation blocked by policy: ${data.url}. (${data.message})`;
          setBlockedNavigationNotice({ url: data.url, message: data.message });
          logProctorViolation('unauthorized_navigation', 'high', details, 0, 'browser_navigation');
          addActivityEvent({
            type: 'security_lockdown',
            label: 'Navigation Blocked',
            details,
            severity: 'high',
            timestamp: new Date(data.timestamp)
          });
          setTimeout(() => setBlockedNavigationNotice(null), 8000);
        }));
      }

      // 7. General External App Detected
      cleanups.push(window.electronAPI.onExternalAppDetected((data) => {
        const details = `External ${data.category} detected: "${data.processName}" - ${data.windowTitle || 'No title'}`;
        logProctorViolation('external_app_detected', 'high', details, 0, 'windows_monitor');
        addActivityEvent({
          type: 'external_app',
          label: data.category,
          details,
          severity: 'high',
          timestamp: new Date(data.timestamp)
        });
      }));

      // 8. In-App Web Activity & AI Prompt Monitoring
      if (window.electronAPI.onMonitoringEvent) {
        cleanups.push(window.electronAPI.onMonitoringEvent((data) => {
          const isAI = data.eventType === 'ai_query_submitted' || (data.details || '').toLowerCase().includes('prompt');
          addActivityEvent({
            type: isAI ? 'prompt_captured' : 'browser_extension',
            label: isAI ? 'AI Prompt Captured' : 'Monitored Activity',
            details: data.details || `Activity on ${data.url}`,
            severity: data.severity || 'low',
            timestamp: new Date()
          });
        }));
      }
    }

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      cleanups.forEach(c => c());
    };
  }, [logProctorViolation, addActivityEvent, assessment.policy]);

  // Sync proctoring events from backend for live audit timeline
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

              if (ev.detectionSource === 'browser_extension' || ev.detectionSource === 'electron_browser') {
                const isAI = ev.eventType === 'ai_query_submitted' || ev.details.toLowerCase().includes('prompt');
                addActivityEvent({
                  type: isAI ? 'prompt_captured' : 'browser_extension',
                  label: isAI ? 'AI Prompt Captured' : 'External Web Activity',
                  details: ev.details,
                  severity: ev.severity as any,
                  timestamp: new Date(ev.timestamp)
                });
              }
            }
          });

          if (hasNewEvents) {
            setViolationCount(res.events.filter(e => e.severity === 'high' || e.severity === 'critical').length);
          }
        }
      } catch {}
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [attempt?.id, addActivityEvent]);

  // Countdown Timer with Monotonic System Clock Tamper Guard
  useEffect(() => {
    let tickCount = 0;
    const timer = setInterval(async () => {
      tickCount++;

      // Every 3 seconds, synchronize with Electron's monotonic timing guard
      if (tickCount % 3 === 0 && attemptIdRef.current && window.electronAPI?.offline?.getMonotonicTiming) {
        try {
          const timing = await window.electronAPI.offline.getMonotonicTiming(attemptIdRef.current);
          if (timing && typeof timing.remainingSeconds === 'number') {
            setRemainingSeconds(timing.remainingSeconds);
            if (timing.isExpired) {
              clearInterval(timer);
              handleFinalSubmit();
              return;
            }
          }
        } catch {}
      }

      setRemainingSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleFinalSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Option selection with Durable Local SQLite Persistence
  const handleSelectOption = async (optionIdx: number) => {
    if (!questions[currentIdx] || !attempt) return;
    const qId = questions[currentIdx].id;
    const previousOption = answers.get(qId);

    const newAnswers = new Map(answers);
    newAnswers.set(qId, optionIdx);
    setAnswers(newAnswers);

    setSavingStatus('saving');
    try {
      // 1. Transactionally persist to local SQLite store first
      await offlineSyncManager.saveAnswerDurable(qId, optionIdx, previousOption);

      // 2. If online, also send to server
      if (offlineState.isOnline) {
        await attemptsAPI.saveAnswer(attempt.id, qId, optionIdx);
      }
      setSavingStatus('saved');
    } catch {
      // If offline, local persistence guarantees answer will not be lost
      setSavingStatus(offlineState.isOnline ? 'error' : 'saved');
    }
  };

  const handleNavigateQuestion = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= questions.length) return;
    offlineSyncManager.logNavigationDurable(
      currentIdx,
      newIdx,
      newIdx > currentIdx ? 'next' : 'prev'
    );
    setCurrentIdx(newIdx);
  };

  const toggleMarkForReview = () => {
    if (!questions[currentIdx]) return;
    const qId = questions[currentIdx].id;
    const newSet = new Set(markedForReview);
    if (newSet.has(qId)) newSet.delete(qId);
    else newSet.add(qId);
    setMarkedForReview(newSet);
  };

  const handleFinalSubmit = async () => {
    if (!attempt || isSubmitting) return;
    setIsSubmitting(true);
    setShowSubmitModal(false);

    try {
      // 1. If currently connected, prioritize online submission
      const isActuallyOnline = offlineState.isOnline || (typeof navigator !== 'undefined' && navigator.onLine);
      if (isActuallyOnline) {
        offlineSyncManager.setOnline(true);
        try {
          const syncRes = await offlineSyncManager.syncNow(true);
          if (syncRes && syncRes.isFinalized) {
            if (window.electronAPI?.offline?.setSubmissionState) {
              await window.electronAPI.offline.setSubmissionState(attempt.id, 'submitted');
            }
            setIsSubmitting(false);
            onFinish(syncRes);
            return;
          }
        } catch {}

        try {
          const directRes = await attemptsAPI.submit(attempt.id);
          if (window.electronAPI?.offline?.setSubmissionState) {
            await window.electronAPI.offline.setSubmissionState(attempt.id, 'submitted');
          }
          setIsSubmitting(false);
          onFinish(directRes);
          return;
        } catch (apiErr: any) {
          console.warn('[AssessmentPage] Direct submission error:', apiErr.message);
          if (apiErr.message?.includes('already') || apiErr.message?.includes('finalized') || apiErr.message?.includes('flagged')) {
            try {
              const latest = await attemptsAPI.getById(attempt.id);
              if (window.electronAPI?.offline?.setSubmissionState) {
                await window.electronAPI.offline.setSubmissionState(attempt.id, 'submitted');
              }
              setIsSubmitting(false);
              onFinish(latest.attempt);
              return;
            } catch {}
          }
        }
      }

      // 2. If genuinely offline, save durable local state
      const res = await offlineSyncManager.submitDurable(false, 'candidate_submitted');
      if (res.synced && res.result) {
        onFinish(res.result);
      } else {
        // Saved safely offline! Notify student
        setOfflineSubmittedNotice(res.message);
      }
      setIsSubmitting(false);
    } catch (err: any) {
      alert(err.message || 'Submission failed');
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------
  // Browser UI Navigation & Tab Control Handlers
  // -------------------------------------------------------------
  const handleSwitchTab = (tab: BrowserTab) => {
    // If tab switching policy is strict and switching to an external tab
    if (assessment.policy.tabSwitchingPolicy === 'restrict' && !tab.isExamTab && assessment.policy.aiUsage === 'prohibited') {
      logProctorViolation('tab_switch', 'high', `Candidate attempted tab switch to ${tab.url} against strict restriction policy.`, 0, 'electron_browser');
      setActiveViolationModal({
        title: 'TAB SWITCHING PROHIBITED',
        message: 'External tab switching is strictly prohibited for this assessment by administrative policy.',
        severity: 'high'
      });
      return;
    }

    setActiveTabId(tab.id);
    setUrlInput(tab.url);
    setActiveTabMode('browser');
  };

  // Webview Lifecycle Listeners
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onDidNavigate = (e: any) => {
      if (e.url) {
        setUrlInput(e.url);
        setBrowserTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: e.url } : t));
      }
    };

    const onTitleUpdated = (e: any) => {
      if (e.title) {
        setBrowserTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, title: e.title } : t));
      }
    };

    const onStartLoading = () => setIsNavigating(true);
    const onStopLoading = () => setIsNavigating(false);

    try {
      wv.addEventListener('did-navigate', onDidNavigate);
      wv.addEventListener('did-navigate-in-page', onDidNavigate);
      wv.addEventListener('page-title-updated', onTitleUpdated);
      wv.addEventListener('did-start-loading', onStartLoading);
      wv.addEventListener('did-stop-loading', onStopLoading);
    } catch {}

    return () => {
      try {
        wv.removeEventListener('did-navigate', onDidNavigate);
        wv.removeEventListener('did-navigate-in-page', onDidNavigate);
        wv.removeEventListener('page-title-updated', onTitleUpdated);
        wv.removeEventListener('did-start-loading', onStartLoading);
        wv.removeEventListener('did-stop-loading', onStopLoading);
      } catch {}
    };
  }, [activeTabId]);

  const handleBack = () => {
    if (webviewRef.current && typeof webviewRef.current.goBack === 'function') {
      try {
        if (webviewRef.current.canGoBack()) webviewRef.current.goBack();
      } catch {}
    } else if (historyIdx > 0) {
      setHistoryIdx(prev => prev - 1);
      handleNavigateUrl(browserHistory[historyIdx - 1]);
    }
  };

  const handleForward = () => {
    if (webviewRef.current && typeof webviewRef.current.goForward === 'function') {
      try {
        if (webviewRef.current.canGoForward()) webviewRef.current.goForward();
      } catch {}
    } else if (historyIdx < browserHistory.length - 1) {
      setHistoryIdx(prev => prev + 1);
      handleNavigateUrl(browserHistory[historyIdx + 1]);
    }
  };

  const handleReload = () => {
    if (webviewRef.current && typeof webviewRef.current.reload === 'function') {
      try {
        webviewRef.current.reload();
      } catch {}
    } else {
      handleNavigateUrl(urlInput);
    }
  };

  const handleHome = () => {
    setActiveTabId('tab-exam');
    setUrlInput('wuelev8://examination-session');
  };

  const handleNavigateUrl = async (targetUrl: string) => {
    if (!targetUrl || !targetUrl.trim()) return;
    const raw = targetUrl.trim();

    if (raw === 'wuelev8://examination-session') {
      setActiveTabId('tab-exam');
      setUrlInput(raw);
      return;
    }

    // Determine if candidate typed a search query or a website domain
    const isSearchQuery = raw.includes(' ') || 
      (!raw.includes('.') && !raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('localhost'));

    let url = raw;
    if (isSearchQuery) {
      url = `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    setIsNavigating(true);
    let evaluation: { allowed: boolean; message?: string; reason?: string; isAi?: boolean } = { allowed: true, message: '', reason: '', isAi: false };

    if (window.electronAPI?.evaluateUrl) {
      evaluation = await window.electronAPI.evaluateUrl(url);
    } else {
      // Fallback renderer evaluation
      const isAI = /chatgpt|openai|claude|gemini|perplexity|copilot/i.test(url);
      if (isAI && assessment.policy.aiUsage === 'prohibited') {
        evaluation = {
          allowed: false,
          isAi: true,
          reason: 'prohibited_ai_tool',
          message: 'AI usage is prohibited for this assessment by administrative policy.'
        };
      }
    }

    setIsNavigating(false);

    let title = isSearchQuery ? `Search: ${raw}` : 'Web Resource';
    try {
      const parsed = new URL(url);
      title = parsed.hostname.replace(/^www\./, '');
      const queryParam = parsed.searchParams.get('q');
      if (queryParam) {
        title = `Google: ${queryParam}`;
      }
    } catch {}

    // Update active tab if not exam tab, else open new tab
    const existingActiveTab = browserTabs.find(t => t.id === activeTabId && !t.isExamTab);
    if (existingActiveTab) {
      existingActiveTab.url = url;
      existingActiveTab.title = title;
      existingActiveTab.status = evaluation.allowed ? 'allowed' : 'blocked';
      existingActiveTab.blockedReason = evaluation.message;
      existingActiveTab.isAi = evaluation.isAi;
      existingActiveTab.isAiTab = evaluation.isAi;
      setBrowserTabs([...browserTabs]);
      setUrlInput(url);
    } else {
      const newTab: BrowserTab = {
        id: `tab-user-${Date.now()}`,
        title,
        url,
        isAiTab: evaluation.isAi,
        status: evaluation.allowed ? 'allowed' : 'blocked',
        blockedReason: evaluation.message,
        isAi: evaluation.isAi
      };

      setBrowserTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setUrlInput(url);
    }

    // Auto-record violation or passive search/browsing telemetry
    if (!evaluation.allowed) {
      const details = `Candidate attempted navigation to unauthorized URL: ${url}. (${evaluation.message})`;
      logProctorViolation('unauthorized_navigation', 'high', details, 0, 'browser_navigation');
      addActivityEvent({
        type: 'security_lockdown',
        label: 'Navigation Blocked',
        details,
        severity: 'high',
        timestamp: new Date()
      });
    } else {
      logProctorViolation(
        isSearchQuery ? 'search_query_submitted' : 'external_site_visit',
        'low',
        isSearchQuery ? `Search query: "${raw}" on Google` : `Candidate navigated to web resource: ${url}`,
        0,
        'electron_browser',
        isSearchQuery ? raw : undefined,
        url
      );
    }
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (tabId === 'tab-exam') return; // Cannot close exam tab!
    const filtered = browserTabs.filter(t => t.id !== tabId);
    setBrowserTabs(filtered);
    if (activeTabId === tabId) {
      setActiveTabId('tab-exam');
      setUrlInput('wuelev8://examination-session');
    }
  };

  const currentQuestion = questions[currentIdx];
  const selectedOption = currentQuestion ? answers.get(currentQuestion.id) : undefined;
  const isMarked = currentQuestion ? markedForReview.has(currentQuestion.id) : false;
  const answeredCount = answers.size;
  const isTimeCritical = remainingSeconds < 300;
  const activeTab = browserTabs.find(t => t.id === activeTabId) || browserTabs[0];

  if (!attempt || questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-black font-swiss">
        <div className="text-center border-2 border-black p-8 bg-[#f0f0f0]">
          <div className="w-8 h-8 border-2 border-black border-t-transparent animate-spin mx-auto mb-4"></div>
          <p className="text-xs font-bold uppercase tracking-[0.12em]">Configuring examination lockdown browser...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col select-none font-swiss">

      {/* 1. PERSISTENT EXAMINATION STATUS RAIL */}
      <div className="bg-black text-white px-4 py-2 border-b-2 border-black flex items-center justify-between gap-4 text-[11px] font-mono font-bold uppercase tracking-wider z-50">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-white bg-neutral-900 px-2 py-0.5 border border-neutral-700">
            <Lock className="w-3.5 h-3.5 text-[#c90000]" />
            WUELEV8 SECURE LOCKDOWN BROWSER
          </span>
          <span className="hidden sm:inline text-neutral-400">|</span>
          <span className="flex items-center gap-1.5 text-neutral-200">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            PROCTORING ACTIVE
          </span>
          <span className="hidden md:inline text-neutral-400">|</span>
          <span className="hidden md:inline text-neutral-300 truncate max-w-xs">{assessment.title}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* AI Policy Badge */}
          {assessment.policy.aiUsage === 'allowed' ? (
            <span className="bg-neutral-800 text-white px-2 py-0.5 border border-neutral-700 flex items-center gap-1">
              <Bot className="w-3 h-3 text-sky-400" /> AI PERMITTED (MONITORED)
            </span>
          ) : (
            <span className="bg-[#c90000] text-white px-2 py-0.5 flex items-center gap-1">
              <ShieldX className="w-3 h-3 text-white" /> AI PROHIBITED
            </span>
          )}

          {/* Offline Sync & Connectivity Status Indicator */}
          {offlineState.isOnline ? (
            offlineState.syncStatus === 'syncing' ? (
              <span className="bg-sky-950 text-sky-300 px-2 py-0.5 border border-sky-600 flex items-center gap-1.5 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                SYNCING ({offlineState.pendingCount})
              </span>
            ) : offlineState.pendingCount > 0 ? (
              <button
                onClick={() => offlineSyncManager.scheduleSync(0)}
                className="bg-amber-950 text-amber-300 hover:bg-amber-900 px-2 py-0.5 border border-amber-600 flex items-center gap-1.5 cursor-pointer"
                title="Click to force immediate sync"
              >
                <Database className="w-3 h-3 text-amber-400" />
                PENDING ({offlineState.pendingCount})
              </button>
            ) : offlineState.syncStatus === 'failed' ? (
              <button
                onClick={() => offlineSyncManager.scheduleSync(0)}
                className="bg-red-950 text-red-300 hover:bg-red-900 px-2 py-0.5 border border-red-600 flex items-center gap-1.5 cursor-pointer"
                title="Sync retry failed - click to retry"
              >
                <AlertCircle className="w-3 h-3 text-red-400" />
                SYNC ERROR - RETRY
              </button>
            ) : (
              <span className="bg-neutral-900 text-emerald-400 px-2 py-0.5 border border-neutral-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ALL SYNCED
              </span>
            )
          ) : (
            assessment.policy.connectivityPolicy === 'require_continuous' ? (
              <span className="bg-[#c90000] text-white px-2 py-0.5 border border-red-300 flex items-center gap-1.5 animate-pulse">
                <AlertTriangle className="w-3 h-3 text-white" />
                OFFLINE - DISCONNECTION ALERT
              </span>
            ) : (
              <span className="bg-amber-950 text-amber-300 px-2 py-0.5 border border-amber-600 flex items-center gap-1.5">
                <Database className="w-3 h-3 text-amber-400" />
                OFFLINE MODE (SAVED LOCALLY)
              </span>
            )
          )}

          {/* Heartbeat Status */}
          <span className={`px-2 py-0.5 border flex items-center gap-1 ${heartbeatOk ? 'border-neutral-700 text-neutral-300' : 'border-[#c90000] text-[#c90000] bg-neutral-950'}`}>
            <Wifi className="w-3 h-3" /> {heartbeatOk ? 'HEARTBEAT 100%' : 'HEARTBEAT DEGRADED'}
          </span>

          {/* Violations Count */}
          <span className={`px-2 py-0.5 border font-bold ${violationCount > 0 ? 'bg-[#c90000] text-white border-[#c90000]' : 'border-neutral-700 text-neutral-300'}`}>
            VIOLATIONS: {violationCount}/{assessment.policy.maxTotalViolations || 6}
          </span>
        </div>
      </div>

      {/* 2. BROWSER TAB BAR */}
      <div className="bg-[#f0f0f0] border-b-2 border-black px-4 pt-2 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {browserTabs.map(tab => {
            const isActive = activeTabId === tab.id && activeTabMode === 'browser';
            return (
              <div
                key={tab.id}
                onClick={() => handleSwitchTab(tab)}
                className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.10em] border-2 border-black cursor-pointer transition select-none shrink-0 ${
                  isActive
                    ? 'bg-white text-black border-b-white z-10 translate-y-[2px]'
                    : 'bg-[#e5e5e5] text-neutral-700 hover:bg-neutral-200 border-b-black'
                }`}
              >
                {tab.isExamTab ? (
                  <Lock className="w-3.5 h-3.5 text-black" />
                ) : tab.isAiTab ? (
                  <Bot className="w-3.5 h-3.5 text-black" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-black" />
                )}

                <span className="truncate max-w-[140px] sm:max-w-[200px]">{tab.title}</span>

                {tab.status === 'blocked' && (
                  <span className="w-2 h-2 bg-[#c90000] rounded-full" title="Blocked by Policy"></span>
                )}

                {!tab.isExamTab && (
                  <button
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    className="p-0.5 hover:bg-black hover:text-white rounded transition ml-1"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* New Tab Button (Opens Google Search) */}
          <button
            onClick={() => {
              const newId = `tab-${Date.now()}`;
              setBrowserTabs(prev => [...prev, {
                id: newId,
                title: 'Google Search',
                url: 'https://www.google.com',
                status: 'allowed'
              }]);
              setActiveTabId(newId);
              setUrlInput('https://www.google.com');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.10em] border-2 border-black bg-white hover:bg-black hover:text-white transition cursor-pointer shrink-0"
            title="Open a new Google Search or web navigation tab"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Tab</span>
          </button>
        </div>

        {/* Proctoring Activity Log Toggle Button */}
        <div className="flex items-center gap-2 pb-1 shrink-0">
          <button
            onClick={() => setActiveTabMode(prev => prev === 'activity' ? 'browser' : 'activity')}
            className={`px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] border-2 border-black flex items-center gap-1.5 transition cursor-pointer ${
              activeTabMode === 'activity' ? 'bg-black text-white' : 'bg-white text-black hover:bg-[#f0f0f0]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Audit Stream</span>
            {externalActivityLog.length > 0 && (
              <span className="bg-[#c90000] text-white text-[10px] px-1 font-mono">
                {externalActivityLog.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 3. BROWSER NAVIGATION CONTROL STRIP */}
      <div className="bg-white border-b-2 border-black px-4 py-2 flex items-center gap-3">
        {/* Navigation Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleBack}
            className="p-1.5 border-2 border-black text-black hover:bg-black hover:text-white transition cursor-pointer"
            title="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleForward}
            className="p-1.5 border-2 border-black text-black hover:bg-black hover:text-white transition cursor-pointer"
            title="Forward"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReload}
            className="p-1.5 border-2 border-black text-black hover:bg-black hover:text-white transition cursor-pointer"
            title="Reload"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isNavigating ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleHome}
            className="p-1.5 border-2 border-black text-black hover:bg-black hover:text-white transition cursor-pointer"
            title="Home / Exam Paper"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Address Bar */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleNavigateUrl(urlInput); }}
          className="flex-1 flex items-center border-2 border-black bg-[#f0f0f0] px-3 py-1"
        >
          {activeTab.isExamTab ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 uppercase tracking-wider shrink-0 mr-2">
              <ShieldCheck className="w-3.5 h-3.5" /> Secure Exam Origin
            </span>
          ) : activeTab.status === 'blocked' ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-[#c90000] uppercase tracking-wider shrink-0 mr-2">
              <ShieldX className="w-3.5 h-3.5" /> Prohibited Resource
            </span>
          ) : activeTab.isAiTab ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-sky-700 uppercase tracking-wider shrink-0 mr-2">
              <Bot className="w-3.5 h-3.5" /> Approved AI Tool (Monitored)
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-bold text-neutral-700 uppercase tracking-wider shrink-0 mr-2">
              <Globe className="w-3.5 h-3.5" /> Google / Web
            </span>
          )}

          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={activeTab.isExamTab}
            placeholder="Search Google or enter web URL (e.g. google.com, quicksort in python)..."
            className="flex-1 bg-transparent text-xs font-mono font-medium text-black focus:outline-none"
          />

          {!activeTab.isExamTab && (
            <button
              type="submit"
              className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 bg-black text-white hover:bg-neutral-800 transition cursor-pointer"
            >
              Search / Go
            </button>
          )}
        </form>

        {/* Right Side Controls: Timer & Submit */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center space-x-2 px-3 py-1 border-2 font-mono font-black text-xs uppercase ${
            isTimeCritical ? 'bg-[#f0f0f0] border-[#c90000] text-[#c90000]' : 'bg-[#f0f0f0] border-black text-black'
          }`}>
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          <button
            onClick={toggleTheme}
            className="p-1.5 text-black bg-white hover:bg-black hover:text-white border-2 border-black transition cursor-pointer"
            title="Toggle Dark Screen Mode"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 bg-black hover:bg-neutral-800 text-white font-bold border-2 border-black text-xs uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
          >
            <Send className="w-3 h-3" />
            <span>Submit</span>
          </button>
        </div>
      </div>

      {/* 4. BLOCKED NAVIGATION ALERT BANNER (If Triggered) */}
      {blockedNavigationNotice && (
        <div className="bg-[#f0f0f0] border-b-2 border-[#c90000] px-4 py-2.5 text-xs text-black">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 flex-wrap">
              <span className="font-bold uppercase tracking-[0.12em] bg-black text-white px-2 py-0.5 text-[11px] flex items-center gap-1.5">
                <span className="w-2 h-2 bg-[#c90000]"></span>
                Policy Restriction
              </span>
              <span className="font-semibold">{blockedNavigationNotice.message || 'Navigation restricted.'}</span>
              <span className="font-mono bg-white px-2 py-0.5 border border-black text-[11px]">
                {blockedNavigationNotice.url}
              </span>
              <span className="text-neutral-600 font-mono text-[11px]">
                [Violation recorded in institutional audit log]
              </span>
            </div>
            <button
              onClick={() => setBlockedNavigationNotice(null)}
              className="p-1 border border-black hover:bg-black hover:text-white transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 4a. CONTINUOUS CONNECTIVITY VIOLATION WARNING BANNER */}
      {!offlineState.isOnline && assessment.policy?.connectivityPolicy === 'require_continuous' && (
        <div className="bg-[#fef2f2] border-b-2 border-[#c90000] px-4 py-2.5 text-xs text-black">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 flex-wrap">
              <span className="font-bold uppercase tracking-[0.12em] bg-[#c90000] text-white px-2 py-0.5 text-[11px] flex items-center gap-1.5 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                Connectivity Policy Violation
              </span>
              <span className="font-bold text-[#c90000]">
                Continuous Internet Connection Required:
              </span>
              <span className="font-medium text-neutral-800">
                This assessment policy strictly requires an active internet connection. Offline answers cannot be credited. Reconnect to your network immediately to prevent automatic termination.
              </span>
            </div>
            <button
              onClick={() => offlineSyncManager.scheduleSync(0)}
              className="px-2.5 py-1 bg-black text-white hover:bg-neutral-800 font-bold text-[11px] uppercase tracking-wider transition cursor-pointer"
            >
              Test Connection
            </button>
          </div>
        </div>
      )}

      {/* 4b. OFFLINE MODE ACTIVE INFORMATIONAL BANNER */}
      {!offlineState.isOnline && assessment.policy?.connectivityPolicy !== 'require_continuous' && (
        <div className="bg-[#fffbeb] border-b-2 border-amber-600 px-4 py-2 text-xs text-black">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 flex-wrap">
              <span className="font-bold uppercase tracking-[0.12em] bg-amber-600 text-white px-2 py-0.5 text-[11px] flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" />
                Offline Mode Active
              </span>
              <span className="font-medium text-amber-950">
                Network connection is currently unavailable. All answers and proctoring events are durably persisted to your device's encrypted local storage. You may continue answering uninterrupted.
              </span>
            </div>
            <span className="text-[11px] font-mono text-amber-900 font-bold">
              Pending Sync: {offlineState.pendingCount}
            </span>
          </div>
        </div>
      )}

      {/* 5. MAIN VIEWPORT: EXAMINATION CONTENT vs PERMITTED BROWSER VIEW */}
      <div className="flex-1 w-full p-4 sm:p-6 overflow-y-auto">
        {activeTabMode === 'activity' ? (
          /* Real-Time Proctoring Audit Stream */
          <div className="max-w-5xl mx-auto border-2 border-black bg-white">
            <div className="bg-[#f0f0f0] px-5 py-4 border-b-2 border-black flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm uppercase tracking-tight text-black">Live Examination Audit Stream</h3>
                  <p className="text-[11px] text-neutral-600 font-mono">CONTINUOUS FOREGROUND, BROWSER & CV SENSOR MONITORING</p>
                </div>
              </div>
              <button
                onClick={() => setActiveTabMode('browser')}
                className="px-3 py-1.5 bg-black text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Return to Browser View
              </button>
            </div>

            <div className="p-5 space-y-3 max-h-[600px] overflow-y-auto divide-y-2 divide-black">
              {externalActivityLog.length === 0 ? (
                <div className="text-center py-12 text-black">
                  <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-neutral-400" />
                  <p className="text-xs font-bold uppercase tracking-[0.12em]">No security infractions detected</p>
                  <p className="text-[11px] text-neutral-600 font-mono mt-1">All foreground, tab, and AI interactions will stream here in real time</p>
                </div>
              ) : (
                externalActivityLog.map(event => (
                  <div
                    key={event.id}
                    className={`p-3.5 text-xs flex items-start gap-3 pt-3 first:pt-0 ${
                      event.severity === 'critical' ? 'bg-[#f0f0f0] border-2 border-[#c90000]' :
                      event.severity === 'high' ? 'bg-[#f0f0f0] border-2 border-black' : 'bg-white'
                    }`}
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
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : activeTab.isExamTab ? (
          /* TAB 1: EXAMINATION ASSESSMENT INTERFACE */
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Question & Options */}
            <div className="lg:col-span-8 border-2 border-black bg-white p-6 sm:p-8">
              <div className="flex items-center justify-between pb-4 border-b-2 border-black mb-6">
                <div className="flex items-center space-x-2">
                  <span className="text-xs px-2.5 py-1 font-bold uppercase tracking-[0.12em] bg-black text-white">
                    QUESTION {currentIdx + 1 < 10 ? `0${currentIdx + 1}` : currentIdx + 1} OF {questions.length}
                  </span>
                  <span className="text-xs px-2.5 py-1 font-bold uppercase tracking-[0.12em] bg-[#f0f0f0] border-2 border-black text-black">
                    {currentQuestion.category}
                  </span>
                </div>

                <button
                  onClick={toggleMarkForReview}
                  className={`text-xs px-3 py-1.5 border-2 border-black flex items-center gap-1.5 font-bold uppercase tracking-[0.12em] transition cursor-pointer ${
                    isMarked ? 'bg-black text-white' : 'bg-white text-black hover:bg-[#f0f0f0]'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${isMarked ? 'fill-white' : ''}`} />
                  <span>{isMarked ? 'Marked for Review' : 'Mark for Review'}</span>
                </button>
              </div>

              <p className="text-lg sm:text-xl font-bold text-black leading-snug mb-8">
                {currentQuestion.questionText}
              </p>

              <div className="space-y-3 mb-8">
                {currentQuestion.options.map((optText, optIdx) => {
                  const isSelected = selectedOption === optIdx;
                  const letter = String.fromCharCode(65 + optIdx);

                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleSelectOption(optIdx)}
                      className={`w-full text-left p-4 border-2 border-black transition cursor-pointer flex items-center justify-between ${
                        isSelected ? 'bg-black text-white font-bold' : 'bg-white hover:bg-[#f0f0f0] text-black'
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

              <div className="flex items-center justify-between pt-5 border-t-2 border-black">
                <button
                  disabled={currentIdx === 0}
                  onClick={() => handleNavigateQuestion(Math.max(0, currentIdx - 1))}
                  className="px-5 py-2.5 bg-white hover:bg-[#f0f0f0] disabled:opacity-30 disabled:cursor-not-allowed text-black border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>

                <button
                  disabled={currentIdx === questions.length - 1}
                  onClick={() => handleNavigateQuestion(Math.min(questions.length - 1, currentIdx + 1))}
                  className="px-6 py-2.5 bg-black hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed text-white border-2 border-black text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 transition cursor-pointer"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Right Column: AI Proctor PIP Feed & Question Palette */}
            <div className="lg:col-span-4 space-y-6">
              <div className="border-2 border-black bg-white p-4">
                <div className="flex items-center justify-between mb-3 border-b-2 border-black pb-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold uppercase tracking-[0.12em] text-black">
                    <Camera className="w-3.5 h-3.5 text-black" />
                    <span>AI PROCTOR CV</span>
                  </div>

                  <span className={`text-[10px] px-2 py-0.5 font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${
                    proctorStatus === 'normal' ? 'bg-black text-white' : 'bg-[#f0f0f0] border-2 border-black text-black'
                  }`}>
                    <span className={`w-1.5 h-1.5 ${proctorStatus === 'normal' ? 'bg-white' : 'bg-[#c90000]'}`}></span>
                    {proctorStatus === 'normal' ? 'Verified' : proctorStatus === 'looking_away' ? 'Gaze Away' : 'Face Missing'}
                  </span>
                </div>

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

                <div className="mt-3 flex items-center justify-between text-xs text-black bg-[#f0f0f0] p-2.5 border-2 border-black">
                  <span className="font-bold uppercase tracking-[0.12em] flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-black" /> Infractions:
                  </span>
                  <span className="font-mono font-black text-sm">
                    {violationCount} / {assessment.policy.maxTotalViolations || 6}
                  </span>
                </div>
              </div>

              <div className="border-2 border-black bg-white p-5">
                <div className="flex items-center justify-between mb-4 border-b-2 border-black pb-2">
                  <h3 className="text-xs font-bold text-black uppercase tracking-[0.12em]">Question Palette</h3>
                  <span className="text-xs text-black font-mono font-bold">{answeredCount} / {questions.length} Answered</span>
                </div>

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
                        onClick={() => handleNavigateQuestion(idx)}
                        className={`h-9 font-mono text-xs font-bold border-2 transition cursor-pointer ${bgClass} ${
                          isCurrent ? 'outline-2 outline-black outline-offset-2' : ''
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

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
        ) : activeTab.status === 'blocked' ? (
          /* ACCESS DENIED: INSTITUTIONAL POLICY RESTRICTION SCREEN */
          <div className="max-w-3xl mx-auto border-4 border-[#c90000] bg-white p-8 sm:p-12 text-black">
            <div className="flex items-center gap-3 pb-4 border-b-2 border-black mb-6">
              <div className="w-10 h-10 bg-[#c90000] text-white flex items-center justify-center font-bold">
                <AlertOctagon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold uppercase tracking-tight">Navigation Prohibited</h2>
                <span className="text-xs font-mono font-bold text-[#c90000] uppercase tracking-wider">
                  WUELEV8 EXAMINATION POLICY ENFORCEMENT
                </span>
              </div>
            </div>

            <div className="bg-[#f0f0f0] p-6 border-2 border-black space-y-3 font-mono text-xs mb-8">
              <p><strong className="uppercase">Target URL:</strong> {activeTab.url}</p>
              <p><strong className="uppercase">Assessment Rule:</strong> {activeTab.blockedReason || 'Unauthorized external resource'}</p>
              <p><strong className="uppercase">Audit Status:</strong> Security event recorded in proctor audit log</p>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setActiveTabId('tab-exam');
                  setUrlInput('wuelev8://examination-session');
                }}
                className="px-6 py-3 bg-black hover:bg-neutral-800 text-white font-bold text-xs uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Return to Examination Paper
              </button>
            </div>
          </div>
        ) : (
          /* PERMITTED WEB RESOURCE OR GOOGLE / AI FULL-WIDTH BROWSER VIEW */
          <div className="w-full border-2 border-black bg-white flex flex-col h-[calc(100vh-175px)] overflow-hidden">
            
            {/* Top Browser Tab Info & Passive Monitoring Indicator */}
            <div className="bg-[#f0f0f0] border-b-2 border-black px-4 py-1.5 flex items-center justify-between text-xs font-mono text-neutral-800 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="w-3.5 h-3.5 text-black shrink-0" />
                <span className="truncate font-bold text-black max-w-xl">
                  {activeTab.url}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {activeTab.isAiTab ? (
                  <span className="bg-sky-100 text-sky-900 border border-sky-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-sky-600" /> AI Tool Active (Prompts Monitored)
                  </span>
                ) : (
                  <span className="bg-emerald-50 text-emerald-900 border border-emerald-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Web Monitored
                  </span>
                )}
                <span className="text-[11px] text-neutral-500 uppercase font-bold">
                  Isolation: Sandboxed
                </span>
              </div>
            </div>

            {/* Full-Width Browser Viewport */}
            <div className="flex-1 w-full h-full relative bg-white overflow-hidden">
              {window.electronAPI?.isElectron ? (
                <webview
                  ref={webviewRef}
                  src={activeTab.url}
                  className="w-full h-full border-none"
                  partition="persist:exam_workspace"
                  allowpopups={true}
                  useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                  webpreferences="contextIsolation=yes, nodeIntegration=no, webSecurity=yes"
                />
              ) : (
                <iframe
                  src={activeTab.url}
                  title={activeTab.title}
                  className="w-full h-full border-none"
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                />
              )}
            </div>

          </div>
        )}
      </div>

      {/* 6. VIOLATION ADVISORY MODAL */}
      {activeViolationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
          <div className="w-full max-w-md bg-white border-4 border-[#c90000] p-6 sm:p-8">
            <div className="flex items-center space-x-3 mb-3 border-b-2 border-black pb-3">
              <div className="w-8 h-8 bg-[#c90000] flex items-center justify-center text-white">
                <AlertOctagon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">{activeViolationModal.title}</h3>
                <span className="text-[11px] font-bold text-[#c90000] uppercase tracking-[0.12em]">
                  Proctoring Event Recorded
                </span>
              </div>
            </div>

            <p className="text-xs text-black leading-relaxed bg-[#f0f0f0] p-4 border-2 border-black my-4">
              {activeViolationModal.message}
            </p>

            <button
              onClick={() => setActiveViolationModal(null)}
              className="w-full py-3 bg-black hover:bg-neutral-800 text-white font-bold border-2 border-black text-xs uppercase tracking-[0.12em] transition cursor-pointer"
            >
              Acknowledge & Return to Exam Browser
            </button>
          </div>
        </div>
      )}

      {/* 7. FINAL SUBMISSION CONFIRMATION MODAL */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-white border-2 border-black p-6 sm:p-8">
            <div className="flex items-center space-x-3 mb-4 border-b-2 border-black pb-3">
              <div className="w-8 h-8 bg-black flex items-center justify-center text-white">
                <Send className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-extrabold text-black text-base uppercase tracking-tight">Submit Assessment?</h3>
                <p className="text-xs text-neutral-600 font-mono">Review answers summary before finalizing</p>
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
                <span>Recorded Infractions:</span>
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
                {isSubmitting ? 'Submitting...' : 'Confirm Submission'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. OFFLINE SUBMISSION SAFEGUARD MODAL */}
      {offlineSubmittedNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-lg bg-white border-4 border-black p-6 sm:p-8">
            <div className="flex items-center space-x-3 mb-4 border-b-2 border-black pb-3">
              <div className="w-10 h-10 bg-black flex items-center justify-center text-white">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-extrabold text-black text-lg uppercase tracking-tight">Assessment Completed & Saved</h3>
                <span className="text-xs font-mono font-bold text-neutral-600">DURABLE LOCAL ENCRYPTED PERSISTENCE</span>
              </div>
            </div>

            <div className="bg-[#f0f0f0] p-4 border-2 border-black space-y-3 mb-6 text-xs text-neutral-800">
              <p className="font-semibold text-black">
                {offlineSubmittedNotice}
              </p>
              <div className="border-t border-neutral-300 pt-2 flex items-center justify-between font-mono text-[11px]">
                <span>Status:</span>
                <span className="font-bold text-amber-700 uppercase">Awaiting Network Reconnection</span>
              </div>
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span>Pending Items:</span>
                <span className="font-bold">{offlineState.pendingCount} records</span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Do not clear your browser cache or uninstall the application. Once this computer connects to the internet, WUElev8 will automatically synchronize all records with the assessment server.
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={async () => {
                  try {
                    offlineSyncManager.setOnline(true);
                    let res = await offlineSyncManager.syncNow(true);
                    if (!res || !res.isFinalized) {
                      const directRes = await attemptsAPI.submit(attempt.id);
                      if (directRes) {
                        res = { isFinalized: true, ...directRes };
                      }
                    }
                    if (res && res.isFinalized) {
                      setOfflineSubmittedNotice(null);
                      onFinish(res);
                      return;
                    }
                  } catch (err: any) {
                    try {
                      const latest = await attemptsAPI.getById(attempt.id);
                      if (latest?.attempt?.status === 'submitted' || latest?.attempt?.status === 'flagged') {
                        setOfflineSubmittedNotice(null);
                        onFinish(latest.attempt);
                        return;
                      }
                    } catch {}
                    alert('Synchronization notice: ' + (err.message || 'Server check in progress'));
                  }
                }}
                className="flex-1 py-3 bg-black hover:bg-neutral-800 text-white border-2 border-black font-bold text-xs uppercase tracking-[0.12em] flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${offlineState.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                <span>Retry Sync Now</span>
              </button>
              <button
                onClick={onExit}
                className="flex-1 py-3 bg-white hover:bg-[#f0f0f0] text-black border-2 border-black font-bold text-xs uppercase tracking-[0.12em] transition cursor-pointer"
              >
                Exit to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
