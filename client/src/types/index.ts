export interface User {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin';
  createdAt?: string;
}

export interface ProctoringPolicy {
  maxMinorViolations: number;
  maxTotalViolations: number;
  faceAbsenceTimeoutSec: number;
  focusLossAllowanceSec: number;
  requireFullscreen: boolean;
  requireWebcam: boolean;
  requireMicrophone: boolean;
  autoSubmitOnCriticalViolations: boolean;

  // Assessment Security Settings (Admin Configurable)
  aiUsage?: 'allowed' | 'prohibited';
  aiPromptMonitoring?: 'enabled' | 'disabled';
  tabSwitchingPolicy?: 'allowed' | 'warn' | 'restrict';
  externalResourceAccess?: 'allowed' | 'restricted';
  permittedWebsites?: string[];
  violationHandling?: 'record_only' | 'warn' | 'terminate';
  leavingExamPolicy?: 'monitor' | 'warn' | 'strict';

  // Offline Mode & Connectivity Policy
  allowOfflineMode?: boolean;
  connectivityPolicy?: 'allow_offline' | 'require_continuous';
}

export interface Assessment {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  status: 'draft' | 'active' | 'archived';
  totalMarks: number;
  passMarks: number;
  policy: ProctoringPolicy;
  questionCount?: number;
  attemptCount?: number;
  createdAt?: string;
  userAttemptId?: string;
  userAttemptStatus?: 'in_progress' | 'submitted' | 'timed_out' | 'flagged';
  userScore?: number;
  userPercentage?: number;
  userSubmittedAt?: string;
}

export interface Question {
  id: string;
  assessmentId: string;
  questionText: string;
  options: string[];
  correctAnswer?: number;
  explanation?: string;
  category: string;
  orderIndex: number;
}

export interface Attempt {
  id: string;
  studentId: string;
  studentName?: string;
  studentEmail?: string;
  assessmentId: string;
  assessmentTitle?: string;
  durationMinutes?: number;
  startedAt: string;
  submittedAt?: string;
  status: 'in_progress' | 'submitted' | 'timed_out' | 'flagged';
  score: number;
  totalPossibleScore: number;
  percentage: number;
  violationCount: number;
  flaggedReason?: string;
  totalEventsLogged?: number;
  pendingReviews?: number;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed' | 'conflict';
  lastSyncAt?: string;
  pendingSyncCount?: number;
  clientReportedStatus?: string;
  offlinePackageGeneratedAt?: string;
  offlineDurationSeconds?: number;
  policySnapshot?: any;
}

export interface Answer {
  questionId: string;
  selectedOption: number;
  isCorrect?: number;
  answeredAt?: string;
  clientAnsweredAt?: string;
  localSequenceNumber?: number;
  syncVersion?: number;
}

export interface OfflineAssessmentPackage {
  assessmentId: string;
  attemptId: string;
  studentId: string;
  studentName?: string;
  title: string;
  description: string;
  durationMinutes: number;
  serverStartedAt: string;
  serverExpiresAt: string;
  generatedAt: string;
  policySnapshot: ProctoringPolicy;
  permittedExternalDomains: string[];
  questions: Question[];
  syncStatus: string;
}

export interface OfflineSyncStatus {
  attemptId: string;
  status: string;
  syncStatus: string;
  lastSyncAt: string | null;
  pendingSyncCount: number;
  isFinalized: boolean;
  score: number;
  percentage: number;
}

export interface ProctoringEvent {
  id: string;
  attemptId: string;
  eventType: 
    | 'face_missing' 
    | 'multiple_faces' 
    | 'focus_loss' 
    | 'fullscreen_exit' 
    | 'tab_switch' 
    | 'devtools_opened' 
    | 'restricted_key' 
    | 'mic_activity' 
    | 'system_anomaly' 
    | 'external_site_visit' 
    | 'ai_query_submitted' 
    | 'ai_response_received' 
    | 'search_query_submitted' 
    | 'external_site_duration' 
    | 'external_app_detected' 
    | 'assessment_return'
    | 'external_browser_detected'
    | 'incognito_browser_detected'
    | 'unauthorized_navigation'
    | 'monitoring_interrupted'
    | 'exam_terminated'
    | 'exam_exit_attempt'
    | 'window_minimized';
  timestamp: string;
  duration: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  detectionSource: 'webcam_cv' | 'browser_focus' | 'electron_kiosk' | 'keyboard_monitor' | 'browser_extension' | 'browser_navigation' | 'windows_monitor' | 'electron_browser';
  reviewStatus: 'pending' | 'reviewed' | 'dismissed' | 'violation_confirmed';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  studentName?: string;
  studentEmail?: string;
  assessmentTitle?: string;
  promptAnalysis?: any;
}

export interface AnalyticsSummary {
  totalAttempts: number;
  completedAttempts: number;
  completionRate: number;
  flaggedSessions: number;
  averageScore: number;
  totalStudents: number;
  totalAssessments: number;
  violationsByType: { eventType: string; count: number; severity: string }[];
  severityBreakdown: { severity: string; count: number }[];
}

// Window Electron API Declarations
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any;
    }
  }

  interface Window {
    electronAPI?: {
      isElectron: boolean;
      setFullscreen: (fullscreen: boolean) => Promise<boolean>;
      getFullscreen: () => Promise<boolean>;
      setKiosk: (kiosk: boolean) => Promise<boolean>;
      minimize: () => void;
      close: () => void;
      getSystemInfo: () => Promise<{
        platform: string;
        displayCount: number;
        displays: any[];
        electronVersion: string;
        nodeVersion: string;
      }>;
      getAppConfig?: () => Promise<{
        appName: string;
        version: string;
        isPackaged: boolean;
        backendUrl: string;
        frontendDevUrl: string;
        platform: string;
      }>;
      checkBackendHealth?: () => Promise<{
        healthy: boolean;
        data?: any;
        error?: string;
      }>;
      heartbeat?: (clientState?: any) => Promise<{
        ok: boolean;
        backendHealthy?: boolean;
        foregroundMonitorActive?: boolean;
        processCheckOk?: boolean;
        isExamMode?: boolean;
        timestamp?: number;
      }>;
      setExamMode: (active: boolean) => Promise<boolean>;
      setExamPolicy?: (policy: {
        permittedExternalDomains?: string[];
        aiUsage?: 'allowed' | 'prohibited';
        externalResourceAccess?: 'allowed' | 'restricted';
        tabSwitchingPolicy?: 'allowed' | 'warn' | 'restrict';
        violationHandling?: 'record_only' | 'warn' | 'terminate';
        leavingExamPolicy?: 'monitor' | 'warn' | 'strict';
      }) => Promise<boolean>;
      setActiveSessionInfo?: (sessionInfo: { attemptId?: string; token?: string }) => Promise<boolean>;
      evaluateUrl?: (url: string) => Promise<{
        allowed: boolean;
        reason?: string;
        message?: string;
        isAi?: boolean;
      }>;
      onWindowBlur: (callback: (data: { timestamp: number }) => void) => () => void;
      onWindowFocus: (callback: (data: { timestamp: number; duration: number }) => void) => () => void;
      onFullscreenExitAttempt: (callback: (data: { timestamp: number }) => void) => () => void;
      onBlockedShortcut: (callback: (data: { key?: string; action?: string; url?: string }) => void) => () => void;
      onNavigationBlocked?: (callback: (data: { url: string; reason: string; message: string; timestamp: number }) => void) => () => void;
      onCloseAttempt?: (callback: (data: { timestamp: number }) => void) => () => void;
      onMinimizeAttempt?: (callback: (data: { timestamp: number }) => void) => () => void;
      onExternalAppDetected: (callback: (data: { processName: string; windowTitle: string; category: string; timestamp: number }) => void) => () => void;
      onExternalBrowserDetected?: (callback: (data: { processName: string; windowTitle: string; isIncognito: boolean; timestamp: number }) => void) => () => void;
      onIncognitoDetected?: (callback: (data: { processName: string; windowTitle: string; isIncognito: boolean; evidence: string; timestamp: number }) => void) => () => void;
      onMonitoringInterrupted?: (callback: (data: { reason: string; timestamp: number }) => void) => () => void;
      onMonitoringEvent?: (callback: (data: any) => void) => () => void;
      offline?: {
        isAvailable: () => Promise<boolean>;
        cacheAssessmentPackage: (pkg: any) => Promise<{ ok: boolean; cachedAt?: string; error?: string }>;
        getCachedPackage: (attemptId: string) => Promise<any | null>;
        saveAnswer: (payload: {
          attemptId: string;
          questionId: string;
          selectedOption: number;
          clientAnsweredAt?: string;
          previousOption?: number;
          reason?: string;
        }) => Promise<{ ok: boolean; localSeq?: number; error?: string }>;
        getSavedAnswers: (attemptId: string) => Promise<any[]>;
        logProctoringEvent: (payload: {
          attemptId: string;
          eventType: string;
          severity?: string;
          details?: string;
          detectionSource?: string;
          timestamp?: string;
        }) => Promise<{ ok: boolean; eventId?: string; error?: string }>;
        logNavigationEvent: (payload: {
          attemptId: string;
          fromQuestionIndex: number;
          toQuestionIndex: number;
          direction?: string;
          timestamp?: string;
        }) => Promise<{ ok: boolean; error?: string }>;
        getPendingSyncPayload: (attemptId: string) => Promise<{
          attemptId: string;
          answers: any[];
          answerChanges: any[];
          proctoringEvents: any[];
          navigationEvents: any[];
          submissionState: any;
          monotonicTiming: any;
        } | null>;
        acknowledgeSync: (attemptId: string, ack: {
          acceptedAnswerIds?: string[];
          acceptedEventIds?: string[];
          acceptedAnswerChangeIds?: string[];
          finalized?: boolean;
          syncTimestamp?: string;
        }) => Promise<{ ok: boolean; remainingPendingCount?: number; error?: string }>;
        setSubmissionState: (attemptId: string, state: 'not_submitted' | 'pending_sync' | 'submitted' | 'failed', errorMessage?: string) => Promise<{ ok: boolean }>;
        getSubmissionState: (attemptId: string) => Promise<{ state: string; submittedAt?: string; errorMessage?: string } | null>;
        getMonotonicTiming: (attemptId: string) => Promise<{
          serverStartedAt: string;
          durationMinutes: number;
          elapsedSeconds: number;
          remainingSeconds: number;
          isExpired: boolean;
        } | null>;
        onConnectivityChanged: (callback: (data: { online: boolean; timestamp: number }) => void) => () => void;
      };
    };
  }
}
