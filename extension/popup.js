// WUElev8 Proctor Companion - Popup Script
(async () => {
  const statusBadge = document.getElementById('status-badge');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statusSub = document.getElementById('status-sub');
  const attemptIdEl = document.getElementById('attempt-id');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

    if (response && response.active) {
      statusBadge.className = 'status-badge active';
      statusDot.className = 'status-dot active';
      statusText.textContent = '🔴 LIVE Monitoring Active';
      statusSub.textContent = 'All external AI & search activity is being logged';
      if (response.attemptId) {
        attemptIdEl.textContent = `Session: ${response.attemptId.substring(0, 24)}...`;
      }
    } else {
      statusText.textContent = 'Not Monitoring';
      statusSub.textContent = 'No active assessment session detected';
    }
  } catch (e) {
    statusText.textContent = 'Extension Loading...';
    statusSub.textContent = e.message;
  }
})();
