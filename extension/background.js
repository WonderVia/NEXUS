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

function isAiDomain(url) {
  return /chatgpt\.com|openai\.com|claude\.ai|anthropic\.com|gemini\.google\.com|perplexity\.ai|copilot\.microsoft\.com/i.test(url);
}

function isPermittedDomain(url, permittedWebsites) {
  if (!url || !permittedWebsites || !Array.isArray(permittedWebsites) || permittedWebsites.length === 0) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return permittedWebsites.some(site => {
      const clean = site.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
      return hostname === clean || hostname.endsWith(`.${clean}`);
    });
  } catch {
    return false;
  }
}

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
    if (message.policy) {
      activeSessionData = {
        ...(activeSessionData || {}),
        attemptId: message.attemptId,
        policy: message.policy
      };
    }
    console.log('[Proctor Extension] Assessment activated explicitly:', activeAttemptId, 'Policy:', message.policy);
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
      session: activeSessionData,
      policy: activeSessionData?.policy || null
    });
    return true;
  }

  if (message.type === 'GET_POLICY') {
    sendResponse({
      policy: activeSessionData?.policy || null
    });
    return true;
  }

  if (message.type === 'CONTENT_QUERY_DETECTED') {
    const policy = activeSessionData?.policy || {};
    const aiUsage = policy.aiUsage || 'prohibited';
    const aiPromptMonitoring = policy.aiPromptMonitoring || 'disabled';

    console.log(`[WUElev8 Background] Received prompt on ${message.platform}. AI Usage: ${aiUsage}, Monitoring: ${aiPromptMonitoring}`);

    if (aiUsage === 'allowed') {
      if (aiPromptMonitoring === 'disabled') {
        console.log('[WUElev8 Background] AI prompt monitoring disabled for this assessment.');
        sendResponse({ success: true, ignored: true });
        return true;
      }

      // Scenario A: AI is allowed, prompt monitoring enabled
      reportViolation({
        eventType: 'ai_query_submitted',
        severity: 'low',
        details: `${message.platform} prompt submitted: "${message.query}"`,
        duration: 0,
        detectionSource: 'browser_extension',
        url: message.url,
        prompt: message.query
      }).then(result => {
        sendResponse({ success: true, saved: !!result, result, isAllowed: true });
      }).catch(err => {
        console.error('[WUElev8 Background] Error reporting prompt:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    } else {
      // Scenario B: AI is prohibited
      reportViolation({
        eventType: 'ai_query_submitted',
        severity: 'critical',
        details: `Prohibited ${message.platform} prompt attempted: "${message.query}"`,
        duration: 0,
        detectionSource: 'browser_extension',
        url: message.url,
        prompt: message.query
      }).then(result => {
        sendResponse({ success: true, saved: !!result, result, isViolation: true });
      }).catch(err => {
        console.error('[WUElev8 Background] Error reporting prohibited prompt:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  }

  if (message.type === 'CONTENT_RESPONSE_DETECTED') {
    const policy = activeSessionData?.policy || {};
    const aiUsage = policy.aiUsage || 'prohibited';
    const aiPromptMonitoring = policy.aiPromptMonitoring || 'disabled';

    if (aiUsage === 'allowed' && aiPromptMonitoring === 'disabled') {
      sendResponse({ success: true, ignored: true });
      return true;
    }

    reportViolation({
      eventType: 'ai_response_received',
      severity: aiUsage === 'allowed' ? 'low' : 'high',
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
    const policy = activeSessionData?.policy || {};
    const extAccess = policy.externalResourceAccess || 'restricted';
    const isPermitted = extAccess === 'allowed' || isPermittedDomain(message.url, policy.permittedWebsites);

    reportViolation({
      eventType: 'search_query_submitted',
      severity: isPermitted ? 'low' : 'medium',
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

// Process monitored tab navigation with assessment-specific policy
function handleMonitoredNavigation(tabId, url) {
  const matchedDomain = getMonitoredDomain(url);
  if (!matchedDomain) return;

  const now = Date.now();
  tabVisitTimestamps[tabId] = { url, startTime: now, label: matchedDomain };

  const policy = activeSessionData?.policy || {};
  const isAI = isAiDomain(url);
  const aiUsage = policy.aiUsage || 'prohibited';
  const extAccess = policy.externalResourceAccess || 'restricted';
  const permitted = policy.permittedWebsites || [];
  const isPermittedExt = extAccess === 'allowed' || isPermittedDomain(url, permitted);

  if (isAI) {
    if (aiUsage === 'prohibited') {
      reportViolation({
        eventType: 'external_site_visit',
        severity: 'critical',
        details: `Candidate attempted to access prohibited AI tool: ${matchedDomain}.`,
        duration: 0,
        detectionSource: 'browser_extension',
        url
      });

      try {
        chrome.notifications?.create({
          type: 'basic',
          iconUrl: 'icon128.png',
          title: 'WUElev8 Assessment Shield — AI Prohibited',
          message: `Access to ${matchedDomain} is PROHIBITED for this assessment. Activity has been flagged.`,
          priority: 2
        });
      } catch {}
    } else {
      // Scenario A: AI usage is allowed!
      reportViolation({
        eventType: 'external_site_visit',
        severity: 'low',
        details: `Candidate navigated to approved AI resource: ${matchedDomain}.`,
        duration: 0,
        detectionSource: 'browser_extension',
        url
      });
    }
  } else {
    // Non-AI external site
    if (!isPermittedExt) {
      reportViolation({
        eventType: 'external_site_visit',
        severity: 'high',
        details: `Candidate accessed restricted external site: ${matchedDomain}.`,
        duration: 0,
        detectionSource: 'browser_extension',
        url
      });

      try {
        chrome.notifications?.create({
          type: 'basic',
          iconUrl: 'icon128.png',
          title: 'WUElev8 Assessment Shield — Policy Alert',
          message: `Access to ${matchedDomain} is restricted by exam policy.`,
          priority: 1
        });
      } catch {}
    } else {
      reportViolation({
        eventType: 'external_site_visit',
        severity: 'low',
        details: `Candidate navigated to permitted external resource: ${matchedDomain}.`,
        duration: 0,
        detectionSource: 'browser_extension',
        url
      });
    }
  }
}

// Monitor tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  handleMonitoredNavigation(tabId, tab.url);
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
        handleMonitoredNavigation(tabId, tab.url);
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
