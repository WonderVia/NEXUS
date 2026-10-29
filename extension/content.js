/**
 * WUElev8 Proctor Companion - Robust Content Script
 * 
 * Injected into ChatGPT, Claude, Google Search, Bing, Gemini, and Perplexity.
 * Captures submitted prompts and queries via multi-layer synchronous event interception,
 * continuous keystroke buffering, and observable assistant response detection.
 */

(function () {
  'use strict';

  const PLATFORM_CONFIG = {
    'chatgpt.com': {
      label: 'ChatGPT',
      querySelectors: [
        '#prompt-textarea',
        'div[id="prompt-textarea"]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea',
        '[data-placeholder]'
      ],
      assistantSelectors: [
        'div[data-message-author-role="assistant"]',
        'article[data-testid*="conversation-turn"] .markdown',
        '.agent-turn .markdown',
        'div.markdown'
      ],
      stopSelectors: [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop"]',
        '.result-streaming'
      ]
    },
    'openai.com': {
      label: 'ChatGPT',
      querySelectors: [
        '#prompt-textarea',
        'div[contenteditable="true"]',
        'textarea'
      ],
      assistantSelectors: ['div[data-message-author-role="assistant"]'],
      stopSelectors: ['button[data-testid="stop-button"]']
    },
    'claude.ai': {
      label: 'Claude',
      querySelectors: [
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea',
        '[data-placeholder]'
      ],
      assistantSelectors: [
        '.font-claude-message',
        'div[data-is-streaming="false"]',
        '.standard-markdown',
        '[data-test-render-count]'
      ],
      stopSelectors: [
        'button[aria-label*="Stop"]',
        'div[data-is-streaming="true"]'
      ]
    },
    'google.': {
      label: 'Google Search',
      isSearchEngine: true,
      querySelectors: ['input[name="q"]', 'textarea[name="q"]', '#APjFqb', '[aria-label="Search"]']
    },
    'bing.com': {
      label: 'Bing Search',
      isSearchEngine: true,
      querySelectors: ['input[name="q"]', '#sb_form_q']
    },
    'perplexity.ai': {
      label: 'Perplexity AI',
      querySelectors: ['textarea[placeholder*="Ask"]', 'textarea', 'div[contenteditable="true"]'],
      assistantSelectors: ['.prose', '.markdown'],
      stopSelectors: ['button[aria-label*="Stop"]']
    },
    'gemini.google.com': {
      label: 'Google Gemini',
      querySelectors: ['div[contenteditable="true"]', 'textarea', 'div[role="textbox"]'],
      assistantSelectors: ['.model-response-text', '.response-content'],
      stopSelectors: ['button[aria-label*="Stop"]']
    }
  };

  const hostname = window.location.hostname.replace('www.', '');
  const entry = Object.entries(PLATFORM_CONFIG).find(([key]) => hostname.includes(key));
  if (!entry) return;

  const [, platformConfig] = entry;
  console.log(`[WUElev8 Proctor] Content script initialized on: ${platformConfig.label} (${hostname})`);

  let livePromptDraft = '';
  let lastReportedPrompt = '';
  let lastReportedTimestamp = 0;
  let isObservingResponse = false;
  let responseObserver = null;
  let responseTimeout = null;

  // Extract text content from any DOM element (handles input, textarea, contenteditable, nested p)
  function extractElementText(el) {
    if (!el) return '';

    // Direct input or textarea
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value || '';
    }

    // Contenteditable or role=textbox
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('role') === 'textbox') {
      return el.innerText || el.textContent || '';
    }

    // Check if element is a child inside an editable container (e.g. <p> inside #prompt-textarea)
    const editableAncestor = el.closest?.('#prompt-textarea, [contenteditable="true"], [role="textbox"], textarea, input');
    if (editableAncestor) {
      if (editableAncestor.tagName === 'INPUT' || editableAncestor.tagName === 'TEXTAREA') {
        return editableAncestor.value || '';
      }
      return editableAncestor.innerText || editableAncestor.textContent || '';
    }

    return '';
  }

  // Scan known selectors for any current prompt text
  function findCurrentPromptOnPage() {
    for (const sel of platformConfig.querySelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = extractElementText(el);
          if (text && text.trim().length > 0) {
            return text.trim();
          }
        }
      } catch {}
    }

    // Check current active element
    if (document.activeElement) {
      const activeText = extractElementText(document.activeElement);
      if (activeText && activeText.trim().length > 0) {
        return activeText.trim();
      }
    }

    return '';
  }

  // Layer 1: Continuous Live Keystroke Tracking (keeps livePromptDraft updated on every input)
  function updateLiveDraft(e) {
    const text = extractElementText(e.target) || findCurrentPromptOnPage();
    if (text && text.trim().length > 0) {
      livePromptDraft = text.trim();
    }
  }

  document.addEventListener('input', updateLiveDraft, true);
  document.addEventListener('keyup', updateLiveDraft, true);
  document.addEventListener('compositionend', updateLiveDraft, true);

  // Layer 2: Send Button Interception
  function isSendButtonTarget(target) {
    if (!target) return false;
    const btn = target.closest?.('button, [role="button"], [data-testid*="send"], [aria-label*="Send"], [aria-label*="send"], input[type="submit"]');
    if (!btn) return false;

    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();

    // Ignore voice buttons, stop buttons, attach buttons
    if (aria.includes('stop') || testId.includes('stop')) return false;
    if (aria.includes('voice') || testId.includes('voice')) return false;
    if (aria.includes('attach') || testId.includes('attach')) return false;

    if (aria.includes('send') || testId.includes('send') || testId.includes('submit')) return true;

    // Button containing an arrow or SVG inside prompt/form container
    if (btn.querySelector('svg') && (btn.closest('form') || btn.closest('[class*="composer"], [class*="input"], [class*="prompt"]'))) {
      return true;
    }

    return false;
  }

  function handleSendButtonAction(e) {
    if (isSendButtonTarget(e.target)) {
      // SYNCHRONOUS CAPTURE before click clears input
      const prompt = findCurrentPromptOnPage() || extractElementText(document.activeElement) || livePromptDraft;
      if (prompt && prompt.length >= 1) {
        console.log(`[WUElev8 Proctor] Send button action detected. Captured prompt length: ${prompt.length}`);
        submitPrompt(prompt);
        livePromptDraft = '';
      }
    }
  }

  // Capture on pointerdown and mousedown (which fire BEFORE input clear)
  document.addEventListener('pointerdown', handleSendButtonAction, true);
  document.addEventListener('mousedown', handleSendButtonAction, true);

  // Layer 3: Synchronous Enter Keydown Interception
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // SYNCHRONOUS CAPTURE: Read immediately in the capture phase before ChatGPT's keydown handler wipes the DOM
      const targetText = extractElementText(e.target);
      const activeText = extractElementText(document.activeElement);
      const domText = findCurrentPromptOnPage();
      const prompt = targetText || activeText || domText || livePromptDraft;

      if (prompt && prompt.trim().length >= 1) {
        console.log(`[WUElev8 Proctor] Enter key pressed. Captured prompt length: ${prompt.trim().length}`);
        submitPrompt(prompt.trim());
        livePromptDraft = '';
      }
    }
  }, true);

  // Layer 4: Form Submit Event (Google Search / Bing)
  document.addEventListener('submit', (e) => {
    const formText = extractElementText(e.target) || findCurrentPromptOnPage() || livePromptDraft;
    if (formText && formText.trim().length >= 1) {
      console.log(`[WUElev8 Proctor] Form submit event detected. Query length: ${formText.trim().length}`);
      submitPrompt(formText.trim(), platformConfig.isSearchEngine);
      livePromptDraft = '';
    }
  }, true);

  // Layer 5: URL-Based Search Engine Query Extraction (Google / Bing results pages)
  function checkUrlSearchQuery() {
    if (platformConfig.isSearchEngine) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const q = urlParams.get('q');
        if (q && q.trim().length >= 1 && q.trim() !== lastReportedPrompt) {
          console.log(`[WUElev8 Proctor] Search query detected from URL parameters. Length: ${q.trim().length}`);
          submitPrompt(q.trim(), true);
        }
      } catch {}
    }
  }

  // Submit Prompt to Background Service Worker
  function submitPrompt(promptText, isSearch = false) {
    if (!promptText || typeof promptText !== 'string') return;
    const cleaned = promptText.trim();
    if (cleaned.length === 0) return;

    // Deduplication within 3 seconds
    const now = Date.now();
    if (cleaned === lastReportedPrompt && (now - lastReportedTimestamp) < 3000) {
      console.log('[WUElev8 Proctor] Duplicate prompt within 3s ignored');
      return;
    }

    lastReportedPrompt = cleaned;
    lastReportedTimestamp = now;

    console.log(`[WUElev8 Proctor] Forwarding ${isSearch ? 'Search Query' : 'AI Prompt'} (${cleaned.length} chars) to background worker`);

    try {
      chrome.runtime.sendMessage({
        type: isSearch ? 'CONTENT_SEARCH_QUERY' : 'CONTENT_QUERY_DETECTED',
        platform: platformConfig.label,
        query: cleaned.substring(0, 2000),
        url: window.location.href,
        timestamp: new Date().toISOString()
      }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[WUElev8 Proctor] Extension communication warning:', chrome.runtime.lastError.message);
        } else {
          console.log('[WUElev8 Proctor] Background confirmed prompt delivery:', res);
        }
      });
    } catch (err) {
      console.error('[WUElev8 Proctor] Failed to send prompt to extension:', err);
    }

    // Show non-blocking indicator
    showSubtleNotification(platformConfig.label, cleaned);

    // If AI platform, monitor for observable response
    if (platformConfig.assistantSelectors) {
      startResponseMonitoring();
    }
  }

  // Layer 6: Observable AI Response Completion Detection
  function startResponseMonitoring() {
    if (isObservingResponse) return;
    isObservingResponse = true;
    clearTimeout(responseTimeout);
    if (responseObserver) responseObserver.disconnect();

    const startTime = Date.now();

    responseObserver = new MutationObserver(() => {
      if (!isObservingResponse) return;

      // Check if site is still actively streaming (stop button visible)
      let isStreaming = false;
      if (platformConfig.stopSelectors) {
        for (const sel of platformConfig.stopSelectors) {
          if (document.querySelector(sel)) {
            isStreaming = true;
            break;
          }
        }
      }

      // If stop button disappeared and at least 3 seconds have passed
      if (!isStreaming && (Date.now() - startTime) > 3000) {
        extractObservableResponse();
      }
    });

    responseObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Fallback: check after 10 seconds regardless
    responseTimeout = setTimeout(() => {
      if (isObservingResponse) {
        extractObservableResponse();
      }
    }, 10000);
  }

  function extractObservableResponse() {
    if (!isObservingResponse) return;

    for (const sel of platformConfig.assistantSelectors) {
      const responses = document.querySelectorAll(sel);
      if (responses.length > 0) {
        const last = responses[responses.length - 1];
        const text = (last.innerText || last.textContent || '').trim();

        if (text.length > 15) {
          isObservingResponse = false;
          if (responseObserver) responseObserver.disconnect();
          clearTimeout(responseTimeout);

          const snippet = text.substring(0, 250).replace(/\s+/g, ' ');
          console.log(`[WUElev8 Proctor] Observable AI response detected. Snippet length: ${snippet.length}`);

          try {
            chrome.runtime.sendMessage({
              type: 'CONTENT_RESPONSE_DETECTED',
              platform: platformConfig.label,
              responseSnippet: snippet,
              url: window.location.href,
              timestamp: new Date().toISOString()
            });
          } catch {}
          return;
        }
      }
    }
  }

  // Non-intrusive micro toast (does not block student)
  function showSubtleNotification(platform, query) {
    const existing = document.getElementById('wuelev8-proctor-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'wuelev8-proctor-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #6366f1;
      border-radius: 12px;
      padding: 10px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;

    const preview = query.length > 40 ? query.substring(0, 40) + '...' : query;
    toast.innerHTML = `
      <span style="font-size:16px;">🛡️</span>
      <div>
        <strong style="color:#a5b4fc;">WUElev8 Assessment Shield:</strong>
        <span style="color:#cbd5e1;"> ${platform} prompt captured: "${preview}"</span>
      </div>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350);
    }, 3500);
  }

  // Initial URL query check
  checkUrlSearchQuery();

  // Watch for dynamic URL transitions in SPAs
  let lastHref = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      checkUrlSearchQuery();
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

})();
