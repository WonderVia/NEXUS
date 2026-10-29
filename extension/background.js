/**
 * WUElev8 Proctor Companion - Background Service Worker
 * 
 * Monitors browser activity during active assessments:
 * - Detects visits to ChatGPT, Claude, Bing, Google Search, Gemini, Perplexity
 * - Reports tab activations, URL visits, and prompt submissions to proctoring backend
 * - Syncs automatically with backend active session state
 * - Tracks time spent on external AI/search resources
 */

const BACKEND_URL = 'http://localhost:5000';
const MONITORED_DOMAINS = [
  { pattern: /chatgpt\.com|openai\.com/i, label: 'ChatGPT (OpenAI)' },
  { pattern: /claude\.ai|anthropic\.com/i, label: 'Claude (Anthropic)' },
  { pattern: /gemini\.google\.com/i, label: 'Google Gemini' },
  { pattern: /bing\.com\/search/i, label: 'Bing Search' },
  { pattern: /google\.com\/search/i, label: 'Google Search' },
  { pattern: /perplexity\.ai/i, label: 'Perplexity AI' },
  { pattern: /copilot\.microsoft\.com/i, label: 'Microsoft Copilot' },
  { pattern: /character\.ai/i, label: 'Character.AI' },
];

let activeAssessmentToken = null;
let activeAttemptId = null;
let activeSessionData = null;
let tabVisitTimestamps = {}; // tabId -> { url, startTime, label }

// Check backend for active assessment session
async function checkActiveSession() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/proctor/active-session`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.active && data.session) {
      activeAttemptId = data.session.attemptId;
      activeSessionData = data.session;
      // Update badge
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    } else {
      activeAttemptId = null;
      activeSessionData = null;
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Backend may be momentarily starting
  }
}

// Initial check & periodic sync every 3 seconds
checkActiveSession();
setInterval(checkActiveSession, 3000);

// Unified message handler
function handleIncomingMessage(message, sender, sendResponse) {
  if (message.type === 'SET_ASSESSMENT_ACTIVE') {
    activeAssessmentToken = message.token || null;
    activeAttemptId = message.attemptId;
    console.log('[Proctor Extension] Assessment activated explicitly:', activeAttemptId);
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    sendResponse({ success: true, activeAttemptId });
    return true;
  }

  if (message.type === 'CLEAR_ASSESSMENT') {
    activeAssessmentToken = null;
    activeAttemptId = null;
    activeSessionData = null;
    tabVisitTimestamps = {};
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({
      active: !!activeAttemptId,
      attemptId: activeAttemptId,
      session: activeSessionData
    });
    return true;
  }

  if (message.type === 'CONTENT_QUERY_DETECTED') {
    console.log(`[WUElev8 Background] Received prompt on ${message.platform}. Query length: ${(message.query || '').length}`);
    reportViolation({
      eventType: 'ai_query_submitted',
      severity: 'high',
      details: `${message.platform} prompt submitted: "${message.query}"`,
      duration: 0,
      detectionSource: 'browser_extension',
      url: message.url,
      prompt: message.query
    }).then(result => {
      sendResponse({ success: true, saved: !!result, result });
    }).catch(err => {
      console.error('[WUElev8 Background] Error reporting prompt:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'CONTENT_RESPONSE_DETECTED') {
    console.log(`[WUElev8 Background] Received observable response on ${message.platform}. Snippet length: ${(message.responseSnippet || '').length}`);
    reportViolation({
      eventType: 'ai_response_received',
      severity: 'medium',
      details: `${message.platform} response received: "${message.responseSnippet}"`,
      duration: 0,
      detectionSource: 'browser_extension',
      url: message.url
    }).then(result => {
      sendResponse({ success: true, saved: !!result });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'CONTENT_SEARCH_QUERY') {
    console.log(`[WUElev8 Background] Received search query on ${message.platform}. Query length: ${(message.query || '').length}`);
    reportViolation({
      eventType: 'search_query_submitted',
      severity: 'medium',
      details: `${message.platform} query submitted: "${message.query}"`,
      duration: 0,
      detectionSource: 'browser_extension',
      url: message.url,
      prompt: message.query
    }).then(result => {
      sendResponse({ success: true, saved: !!result });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  return true;
}

// Listen for internal extension messages (content script, popup)
chrome.runtime.onMessage.addListener(handleIncomingMessage);

// Listen for external messages (from localhost web application)
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener(handleIncomingMessage);
}

// Monitor tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const matchedDomain = getMonitoredDomain(tab.url);
  if (matchedDomain) {
    const now = Date.now();
    tabVisitTimestamps[tabId] = { url: tab.url, startTime: now, label: matchedDomain };

    reportViolation({
      eventType: 'external_site_visit',
      severity: 'medium',
      details: `Student switched to ${matchedDomain}.`,
      duration: 0,
      detectionSource: 'browser_extension',
      url: tab.url
    });
  }
});

// Monitor when tabs are activated (switched to)
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;

    const matchedDomain = getMonitoredDomain(tab.url);
    if (matchedDomain) {
      const existing = tabVisitTimestamps[tabId];
      if (!existing || (Date.now() - existing.startTime) > 5000) {
        tabVisitTimestamps[tabId] = { url: tab.url, startTime: Date.now(), label: matchedDomain };
        reportViolation({
          eventType: 'external_site_visit',
          severity: 'medium',
          details: `Student switched to ${matchedDomain}.`,
          duration: 0,
          detectionSource: 'browser_extension',
          url: tab.url
        });
      }
    }
  } catch {
    // Tab may have closed
  }
});

// Track time spent on monitored sites when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabVisitTimestamps[tabId]) {
    const { startTime, label, url } = tabVisitTimestamps[tabId];
    const duration = Date.now() - startTime;

    if (duration > 3000) {
      reportViolation({
        eventType: 'external_site_duration',
        severity: 'medium',
        details: `Candidate spent ${(duration / 1000).toFixed(1)}s on prohibited resource: ${label}. URL: ${sanitizeUrl(url)}`,
        duration: duration,
        detectionSource: 'browser_extension',
        url: url
      });
    }

    delete tabVisitTimestamps[tabId];
  }
});

function getMonitoredDomain(url) {
  for (const domain of MONITORED_DOMAINS) {
    if (domain.pattern.test(url)) {
      return domain.label;
    }
  }
  return null;
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.substring(0, 80);
  } catch {
    return url.substring(0, 100);
  }
}

async function reportViolation(payload) {
  const body = {
    attemptId: activeAttemptId || undefined,
    eventType: payload.eventType || 'external_site_visit',
    details: payload.details,
    url: payload.url,
    severity: payload.severity || 'high',
    prompt: payload.prompt
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (activeAssessmentToken) {
      headers['Authorization'] = `Bearer ${activeAssessmentToken}`;
    }

    // Report directly to dedicated extension event endpoint
    const res = await fetch(`${BACKEND_URL}/api/proctor/extension-event`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.attemptId) {
        activeAttemptId = data.attemptId;
      }
      console.log(`[WUElev8 Background] Event successfully saved to backend (ID: ${data.eventId}, Attempt: ${data.attemptId})`);
      return data;
    } else {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
  } catch (err) {
    // If backend is unreachable, queue locally in chrome.storage
    const pending = await getPendingReports();
    pending.push({ ...body, ts: Date.now() });
    await chrome.storage.local.set({ pendingReports: pending });
    console.warn('[WUElev8 Background] Queued event locally:', err.message);
    return null;
  }
}

async function getPendingReports() {
  const data = await chrome.storage.local.get('pendingReports');
  return data.pendingReports || [];
}

// Flush pending reports periodically
setInterval(async () => {
  const pending = await getPendingReports();
  if (pending.length === 0) return;

  const sent = [];
  for (const report of pending) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/proctor/extension-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      });
      if (res.ok) {
        sent.push(report);
      }
    } catch {
      break;
    }
  }

  if (sent.length > 0) {
    const remaining = pending.filter(r => !sent.includes(r));
    await chrome.storage.local.set({ pendingReports: remaining });
    console.log(`[Proctor Extension] Flushed ${sent.length} queued violation reports.`);
  }
}, 15000);
