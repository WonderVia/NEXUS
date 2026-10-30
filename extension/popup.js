// WUElev8 Proctor Companion - Popup Script
(async () => {
  const statusBadge = document.getElementById('status-badge');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statusSub = document.getElementById('status-sub');
  const attemptIdEl = document.getElementById('attempt-id');
  const policyCard = document.getElementById('policy-card');
  const assessmentTitleEl = document.getElementById('assessment-title');
  const policyAiUsage = document.getElementById('policy-ai-usage');
  const policyPromptMon = document.getElementById('policy-prompt-mon');
  const policyTabPolicy = document.getElementById('policy-tab-policy');
  const policyViolationHandling = document.getElementById('policy-violation-handling');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

    if (response && response.active) {
      statusBadge.className = 'status-badge active';
      statusDot.className = 'status-dot active';
      statusText.textContent = '🟢 Active Proctoring Enforced';
      statusSub.textContent = 'Enforcing assessment-specific security policy';
      if (response.attemptId) {
        attemptIdEl.textContent = `Attempt: ${response.attemptId}`;
      }

      const policy = response.policy || response.session?.policy;
      if (policy && policyCard) {
        policyCard.style.display = 'block';
        if (response.session?.assessmentTitle) {
          assessmentTitleEl.textContent = response.session.assessmentTitle;
        }

        const isAiAllowed = policy.aiUsage === 'allowed';
        policyAiUsage.textContent = isAiAllowed ? 'ALLOWED' : 'PROHIBITED';
        policyAiUsage.style.color = isAiAllowed ? '#4ade80' : '#f87171';

        const isPromptMon = policy.aiPromptMonitoring === 'enabled';
        policyPromptMon.textContent = isPromptMon ? 'ENABLED' : 'DISABLED';
        policyPromptMon.style.color = isPromptMon ? '#c084fc' : '#94a3b8';

        const tabPolicy = (policy.tabSwitchingPolicy || 'warn').toUpperCase();
        policyTabPolicy.textContent = tabPolicy;
        policyTabPolicy.style.color = tabPolicy === 'RESTRICT' ? '#f87171' : (tabPolicy === 'WARN' ? '#fbbf24' : '#60a5fa');

        const violationAction = (policy.violationHandling || 'warn').replace('_', ' ').toUpperCase();
        policyViolationHandling.textContent = violationAction;
        policyViolationHandling.style.color = violationAction.includes('TERMINATE') ? '#f87171' : '#fbbf24';
      }
    } else {
      statusText.textContent = 'Not Monitoring';
      statusSub.textContent = 'No active assessment session detected';
      if (policyCard) policyCard.style.display = 'none';
    }
  } catch (e) {
    statusText.textContent = 'Extension Loading...';
    statusSub.textContent = e.message;
  }
})();
