import { Assessment, Attempt, ProctoringEvent, Question, User, AnalyticsSummary } from '../types';

// Dynamic API Base resolution across Vite dev, Express served, Electron file://, and remote deployments
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const envUrl = (import.meta as any).env?.VITE_API_URL;
    if (envUrl) return envUrl;
    if (window.location.protocol === 'file:') {
      return 'http://localhost:5000/api';
    }
  }
  return '/api';
}

export const API_BASE = getApiBase();

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('proctor_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP error! Status: ${response.status}`);
  }

  return data as T;
}

// In-Memory & LocalStorage Resilient Event Queue for connectivity resilience
interface QueuedEventPayload {
  attemptId: string;
  payload: {
    eventType: string;
    duration?: number;
    severity?: string;
    details: string;
    detectionSource?: string;
  };
  queuedAt: number;
}

const EVENT_QUEUE_KEY = 'wuelev8_proctor_pending_events';

function getPendingEventQueue(): QueuedEventPayload[] {
  try {
    const raw = localStorage.getItem(EVENT_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePendingEventQueue(queue: QueuedEventPayload[]): void {
  try {
    localStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('Failed to save pending event queue:', e);
  }
}

// Periodic auto-flush for pending events
if (typeof window !== 'undefined') {
  setInterval(async () => {
    const queue = getPendingEventQueue();
    if (queue.length === 0) return;

    const remaining: QueuedEventPayload[] = [];
    for (const item of queue) {
      try {
        await request(`/attempts/${item.attemptId}/events`, {
          method: 'POST',
          body: JSON.stringify({
            ...item.payload,
            details: `${item.payload.details} (Queued delivery retry)`
          })
        });
        console.log(`[Proctor Queue] Successfully flushed offline event for attempt ${item.attemptId}: ${item.payload.eventType}`);
      } catch {
        // Still unreachable, retain in queue
        remaining.push(item);
      }
    }
    savePendingEventQueue(remaining);
  }, 5000);
}

// Authentication API
export const authAPI = {
  login: (credentials: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    }),

  register: (payload: { name: string; email: string; password: string; role?: string }) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  requestOtp: (email: string) =>
    request<{ message: string; devOtp: string; hint: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email })
    }),

  verifyOtp: (payload: { email: string; otp: string }) =>
    request<{ token: string; user: User }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  getMe: () => request<{ user: User }>('/auth/me')
};

// Assessments API
export const assessmentsAPI = {
  list: () => request<{ assessments: Assessment[] }>('/assessments'),

  getById: (id: string) => request<{ assessment: Assessment; userAttempt: Attempt | null }>(`/assessments/${id}`),

  create: (payload: Partial<Assessment>) =>
    request<{ assessment: Assessment }>('/assessments', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  update: (id: string, payload: Partial<Assessment>) =>
    request<{ assessment: Assessment }>(`/assessments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    })
};

// Questions API
export const questionsAPI = {
  getByAssessment: (assessmentId: string) =>
    request<{ questions: Question[]; isReviewMode?: boolean }>(`/assessments/${assessmentId}/questions`),

  create: (assessmentId: string, payload: Partial<Question>) =>
    request<{ question: Question }>(`/assessments/${assessmentId}/questions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  update: (questionId: string, payload: Partial<Question>) =>
    request<{ question: Question }>(`/questions/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),

  delete: (questionId: string) =>
    request<{ message: string }>(`/questions/${questionId}`, {
      method: 'DELETE'
    })
};

// Attempts API
export const attemptsAPI = {
  start: (assessmentId: string, forceNew?: boolean) =>
    request<{ attempt: Attempt; remainingSeconds: number; savedAnswers: { questionId: string; selectedOption: number }[] }>('/attempts', {
      method: 'POST',
      body: JSON.stringify({ assessmentId, forceNew })
    }),

  getById: (id: string) =>
    request<{ attempt: Attempt; remainingSeconds: number; answers: { questionId: string; selectedOption: number }[]; events: ProctoringEvent[] }>(`/attempts/${id}`),

  saveAnswer: (attemptId: string, questionId: string, selectedOption: number) =>
    request<{ message: string; savedAt: string }>(`/attempts/${attemptId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ questionId, selectedOption })
    }),

  submit: (attemptId: string) =>
    request<{
      message: string;
      status: string;
      score: number;
      totalPossibleScore: number;
      percentage: number;
      correctCount: number;
      totalQuestions: number;
      submittedAt: string;
    }>(`/attempts/${attemptId}/submit`, {
      method: 'POST'
    })
};

// Proctoring API
export const proctoringAPI = {
  logEvent: async (attemptId: string, payload: {
    eventType: string;
    duration?: number;
    severity?: string;
    details: string;
    detectionSource?: string;
  }) => {
    try {
      const res = await request<{
        message: string;
        event: ProctoringEvent;
        currentViolationCount: number;
        warningLevel: 'none' | 'warning' | 'critical';
        shouldAutoSubmit: boolean;
        policyNotice: string;
      }>(`/attempts/${attemptId}/events`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return { ...res, persisted: true, queued: false };
    } catch (err: any) {
      console.warn(`[Proctor API] Network event transmission failed, queueing locally: ${err.message}`);
      const queue = getPendingEventQueue();
      queue.push({ attemptId, payload, queuedAt: Date.now() });
      savePendingEventQueue(queue);
      return {
        message: 'Event queued locally due to network connectivity failure',
        event: {
          id: `queued-${Date.now()}`,
          attemptId,
          eventType: payload.eventType,
          timestamp: new Date().toISOString(),
          duration: payload.duration || 0,
          severity: (payload.severity || 'low') as any,
          details: payload.details,
          detectionSource: payload.detectionSource || 'client_cv',
          reviewStatus: 'pending' as const
        },
        currentViolationCount: 0,
        warningLevel: 'none' as const,
        shouldAutoSubmit: false,
        policyNotice: 'Event cached offline - auto retry enabled',
        persisted: false,
        queued: true
      };
    }
  },

  getEvents: (attemptId: string, filters?: { severity?: string; eventType?: string; reviewStatus?: string }) => {
    const query = new URLSearchParams(filters as any).toString();
    return request<{ events: ProctoringEvent[] }>(`/attempts/${attemptId}/events${query ? `?${query}` : ''}`);
  },

  reviewEvent: (eventId: string, payload: { reviewStatus: string; reviewNotes?: string }) =>
    request<{ message: string; event: ProctoringEvent }>(`/proctoring-events/${eventId}/review`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
};

// Analytics API
export const analyticsAPI = {
  getAnalytics: () => request<AnalyticsSummary>('/admin/analytics'),

  getAllAttempts: (filters?: { assessmentId?: string; status?: string; flaggedOnly?: string }) => {
    const query = new URLSearchParams(filters as any).toString();
    return request<{ attempts: Attempt[] }>(`/admin/attempts${query ? `?${query}` : ''}`);
  },

  getStudents: () => request<{ students: User[] }>('/admin/students'),

  getExportUrl: (type: 'results' | 'events', assessmentId?: string) => {
    const token = localStorage.getItem('proctor_auth_token');
    return `/api/admin/export?type=${type}${assessmentId ? `&assessmentId=${assessmentId}` : ''}&token=${token}`;
  }
};
