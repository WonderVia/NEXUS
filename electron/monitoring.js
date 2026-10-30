/**
 * Smart Browser In-App Web Activity & AI Prompt Monitoring Engine
 * 
 * Capabilities:
 * - Detects visits to ChatGPT, Claude, Gemini, Perplexity, Google Search, Bing.
 * - Injects prompt & search interception into monitored WebContents.
 * - Extracts submitted queries from textareas, contenteditable divs, and URL parameters.
 * - Captures prompt submissions securely via isolated console-message IPC bridge.
 * - Delivers real events to the proctoring backend (/api/proctor/extension-event).
 * - Tracks dwell duration on external resources.
 * - Reuses the exact database schema and admin audit trail.
 */

const MONITORED_DOMAINS = [
  { pattern: /chatgpt\.com|openai\.com/i, label: 'ChatGPT (OpenAI)' },
  { pattern: /claude\.ai|anthropic\.com/i, label: 'Claude (Anthropic)' },
  { pattern: /gemini\.google\.com/i, label: 'Google Gemini' },
  { pattern: /bing\.com/i, label: 'Bing' },
  { pattern: /google\.[a-z.]+/i, label: 'Google' },
  { pattern: /perplexity\.ai/i, label: 'Perplexity AI' },
  { pattern: /copilot\.microsoft\.com/i, label: 'Microsoft Copilot' },
  { pattern: /poe\.com/i, label: 'Poe AI' },
  { pattern: /v0\.dev/i, label: 'v0 by Vercel' }
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
    if (!url) return null;
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
        console.log(`[WebMonitor] Event persisted to backend: ID=${data.eventId}, Attempt=${data.attemptId}, isViolation=${data.isViolation}`);
        this.notifyListeners({ ...body, eventId: data.eventId, isViolation: data.isViolation, persisted: true });
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
    // Intercept console message bridge for prompt extraction
    webContents.on('console-message', (event, level, message) => {
      if (typeof message === 'string' && message.startsWith('__WUELEV8_EVENT__:')) {
        try {
          const raw = message.substring('__WUELEV8_EVENT__:'.length);
          const data = JSON.parse(raw);
          console.log(`[WebMonitor Captured] ${data.type} on ${data.platform}: "${data.query}"`);

          const isAi = data.type === 'ai_query_submitted' || /chatgpt|claude|gemini|perplexity|copilot|poe/i.test(data.platform);
          
          this.reportViolation({
            eventType: isAi ? 'ai_query_submitted' : 'search_query_submitted',
            severity: isAi ? 'medium' : 'low',
            details: isAi 
              ? `AI prompt submitted to ${data.platform}: "${data.query}"` 
              : `Search query submitted to ${data.platform}: "${data.query}"`,
            prompt: data.query,
            url: data.url
          });
        } catch (err) {
          console.warn('[WebMonitor] Failed to parse bridge event:', err.message);
        }
      }
    });

    webContents.on('did-finish-load', async () => {
      const currentUrl = webContents.getURL();
      const label = this.classifyUrl(currentUrl);

      if (label) {
        console.log(`[WebMonitor] Monitored web resource loaded: ${label} (${currentUrl})`);
        this.visitTimestamps.set(webContents.id, { url: currentUrl, startTime: Date.now(), label });

        // Report initial visit
        await this.reportViolation({
          eventType: 'external_site_visit',
          severity: 'medium',
          details: `Candidate loaded monitored resource: ${label} (${currentUrl}).`,
          url: currentUrl
        });

        // Inject DOM content monitoring script
        this.injectContentScript(webContents, label);
      }
    });

    webContents.on('did-navigate-in-page', async (_event, inPageUrl) => {
      const label = this.classifyUrl(inPageUrl);
      if (label) {
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
            details: `Candidate spent ${(duration / 1000).toFixed(1)}s on monitored resource: ${record.label}.`,
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
        const platform = ${JSON.stringify(platformLabel)};
        let lastReported = '';

        function emitEvent(query, type) {
          if (!query || query.trim().length === 0 || query.trim() === lastReported) return;
          lastReported = query.trim();
          try {
            console.log('__WUELEV8_EVENT__:' + JSON.stringify({
              platform,
              type: type || 'ai_query_submitted',
              query: query.trim(),
              url: window.location.href,
              timestamp: Date.now()
            }));
          } catch {}
        }

        function extractSearchQuery() {
          try {
            const url = new URL(window.location.href);
            const q = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('p');
            if (q) {
              emitEvent(q, 'search_query_submitted');
            }
          } catch {}
        }

        extractSearchQuery();

        if (window.__wuelev8_proctor_installed) return;
        window.__wuelev8_proctor_installed = true;

        // Listen for keyboard Enter submissions
        window.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            setTimeout(() => {
              const active = document.activeElement;
              const text = active ? (active.value || active.innerText || active.textContent || '') : '';
              if (text && text.trim().length > 0) {
                const isAi = /chatgpt|claude|gemini|perplexity|copilot|poe|v0/i.test(platform);
                emitEvent(text, isAi ? 'ai_query_submitted' : 'search_query_submitted');
              }
            }, 60);
          }
        }, true);

        // Listen for form submissions
        window.addEventListener('submit', (e) => {
          const form = e.target;
          if (form) {
            const input = form.querySelector('input[type="text"], input[type="search"], textarea, input:not([type])');
            if (input && input.value) {
              const isAi = /chatgpt|claude|gemini|perplexity|copilot|poe|v0/i.test(platform);
              emitEvent(input.value, isAi ? 'ai_query_submitted' : 'search_query_submitted');
            }
          }
        }, true);

        // Listen for send button clicks
        window.addEventListener('click', (e) => {
          const btn = e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null;
          if (btn) {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
            const textContent = (btn.textContent || '').toLowerCase();
            if (aria.includes('send') || aria.includes('submit') || testid.includes('send') || testid.includes('submit') || textContent.includes('search')) {
              setTimeout(() => {
                const inputs = document.querySelectorAll('textarea, input[type="text"], input[type="search"], div[contenteditable="true"], div[role="textbox"]');
                for (const input of inputs) {
                  const text = input.value || input.innerText || input.textContent || '';
                  if (text && text.trim().length > 0) {
                    const isAi = /chatgpt|claude|gemini|perplexity|copilot|poe|v0/i.test(platform);
                    emitEvent(text, isAi ? 'ai_query_submitted' : 'search_query_submitted');
                    break;
                  }
                }
              }, 60);
            }
          }
        }, true);
      })();
    `;

    webContents.executeJavaScript(injectionScript).catch(() => {});
  }
}

module.exports = { WebMonitor, MONITORED_DOMAINS };
