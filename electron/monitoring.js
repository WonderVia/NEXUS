/**
 * Smart Browser In-App Web Activity & AI Prompt Monitoring Engine
 * 
 * Migrates and integrates the Chrome Extension Companion's monitoring logic
 * directly into the Electron desktop application.
 * 
 * Capabilities:
 * - Detects visits to ChatGPT, Claude, Gemini, Perplexity, Google Search, Bing.
 * - Injects prompt & search interception into monitored WebContents.
 * - Extracts submitted queries from textareas, contenteditable divs, and URL parameters.
 * - Delivers real events to the proctoring backend (/api/proctor/extension-event).
 * - Tracks dwell duration on external resources.
 * - Reuses the exact database schema and admin audit trail.
 */

const MONITORED_DOMAINS = [
  { pattern: /chatgpt\.com|openai\.com/i, label: 'ChatGPT (OpenAI)' },
  { pattern: /claude\.ai|anthropic\.com/i, label: 'Claude (Anthropic)' },
  { pattern: /gemini\.google\.com/i, label: 'Google Gemini' },
  { pattern: /bing\.com\/search/i, label: 'Bing Search' },
  { pattern: /google\.[a-z.]+\/search/i, label: 'Google Search' },
  { pattern: /perplexity\.ai/i, label: 'Perplexity AI' },
  { pattern: /copilot\.microsoft\.com/i, label: 'Microsoft Copilot' },
];

class WebMonitor {
  constructor(options = {}) {
    this.backendUrl = options.backendUrl || process.env.PROCTOR_API_URL || 'http://localhost:5000';
    this.activeAttemptId = null;
    this.activeToken = null;
    this.visitTimestamps = new Map(); // webContentsId -> { url, startTime, label }
    this.eventListeners = new Set();
  }

  setSession(attemptId, token) {
    this.activeAttemptId = attemptId;
    this.activeToken = token;
    console.log(`[WebMonitor] Synchronized active session: Attempt=${attemptId}`);
  }

  clearSession() {
    this.activeAttemptId = null;
    this.activeToken = null;
    this.visitTimestamps.clear();
  }

  onEvent(callback) {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  notifyListeners(event) {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[WebMonitor] Listener notification error:', err);
      }
    }
  }

  classifyUrl(url) {
    for (const domain of MONITORED_DOMAINS) {
      if (domain.pattern.test(url)) {
        return domain.label;
      }
    }
    return null;
  }

  async reportViolation(payload) {
    const body = {
      attemptId: payload.attemptId || this.activeAttemptId || undefined,
      eventType: payload.eventType || 'external_site_visit',
      details: payload.details,
      url: payload.url,
      severity: payload.severity || 'high',
      prompt: payload.prompt
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.activeToken) {
        headers['Authorization'] = `Bearer ${this.activeToken}`;
      }

      const res = await fetch(`${this.backendUrl}/api/proctor/extension-event`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`[WebMonitor] Event persisted to backend: ID=${data.eventId}, Attempt=${data.attemptId}`);
        this.notifyListeners({ ...body, eventId: data.eventId, persisted: true });
        return data;
      } else {
        const text = await res.text();
        console.warn(`[WebMonitor] Backend returned status ${res.status}: ${text}`);
      }
    } catch (err) {
      console.warn(`[WebMonitor] Delivery failed, queueing/logging locally: ${err.message}`);
      this.notifyListeners({ ...body, persisted: false, error: err.message });
    }
    return null;
  }

  /**
   * Injects prompt & search monitoring into an Electron WebContents instance.
   */
  attachToWebContents(webContents) {
    webContents.on('did-finish-load', async () => {
      const currentUrl = webContents.getURL();
      const label = this.classifyUrl(currentUrl);

      if (label) {
        console.log(`[WebMonitor] Monitored web resource loaded in Electron: ${label} (${currentUrl})`);
        this.visitTimestamps.set(webContents.id, { url: currentUrl, startTime: Date.now(), label });

        // Report visit
        await this.reportViolation({
          eventType: 'external_site_visit',
          severity: 'medium',
          details: `Candidate loaded monitored resource: ${label}.`,
          url: currentUrl
        });

        // Inject DOM content monitoring script
        this.injectContentScript(webContents, label);
      }
    });

    webContents.on('destroyed', () => {
      const record = this.visitTimestamps.get(webContents.id);
      if (record) {
        const duration = Date.now() - record.startTime;
        if (duration > 3000) {
          this.reportViolation({
            eventType: 'external_site_duration',
            severity: 'medium',
            details: `Candidate spent ${(duration / 1000).toFixed(1)}s on prohibited resource: ${record.label}.`,
            duration,
            url: record.url
          });
        }
        this.visitTimestamps.delete(webContents.id);
      }
    });
  }

  injectContentScript(webContents, platformLabel) {
    const injectionScript = `
      (function() {
        if (window.__wuelev8_proctor_installed) return;
        window.__wuelev8_proctor_installed = true;

        const platform = ${JSON.stringify(platformLabel)};
        let lastReported = '';

        function extractSearchQuery() {
          try {
            const url = new URL(window.location.href);
            const q = url.searchParams.get('q') || url.searchParams.get('query');
            if (q && q.trim().length > 0 && q !== lastReported) {
              lastReported = q;
              window.__wuelev8_report_prompt?.({
                platform,
                type: 'search_query_submitted',
                query: q.trim(),
                url: window.location.href
              });
            }
          } catch {}
        }

        extractSearchQuery();

        // Listen for user keyboard submissions
        window.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            setTimeout(() => {
              const active = document.activeElement;
              const text = active ? (active.value || active.innerText || active.textContent || '') : '';
              if (text && text.trim().length > 0 && text.trim() !== lastReported) {
                lastReported = text.trim();
                window.__wuelev8_report_prompt?.({
                  platform,
                  type: 'ai_query_submitted',
                  query: text.trim(),
                  url: window.location.href
                });
              }
            }, 50);
          }
        }, true);
      })();
    `;

    webContents.executeJavaScript(injectionScript).catch(err => {
      console.warn('[WebMonitor] Script injection failed:', err.message);
    });
  }
}

module.exports = { WebMonitor, MONITORED_DOMAINS };

