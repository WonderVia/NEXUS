const { app, BrowserWindow, ipcMain, screen, Menu, session } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const { NavigationPolicy } = require('./navigation-policy');
const { WebMonitor } = require('./monitoring');
const { offlineStore } = require('./offline-store');

// Application metadata
app.setName('WUElev8 Smart Proctoring Browser');

// Optimize Chromium network service and GPU process stability on Windows
app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Standard modern Chrome User-Agent to avoid bot/automation blocks (Cloudflare Turnstile, ChatGPT, etc.)
const STANDARD_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Prevent disruptive fatal dialog popups in production
process.on('uncaughtException', (err) => {
  console.error('[Electron Main Process Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Electron Main Process Unhandled Rejection]:', reason);
});

let mainWindow = null;
let isExamMode = false;
let blurStartTime = null;
let foregroundMonitorInterval = null;
let lastForegroundApp = '';
let lastHeartbeatTime = Date.now();
let lastProcessCheckOk = true;

// Backend and environment configuration
const BACKEND_URL = process.env.PROCTOR_API_URL || process.env.API_URL || 'http://localhost:5000';
const FRONTEND_DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const navigationPolicy = new NavigationPolicy();
const webMonitor = new WebMonitor({ backendUrl: BACKEND_URL });

// Known suspicious application patterns for Windows foreground auditing
const SUSPICIOUS_APP_PATTERNS = [
  { pattern: /chrome|msedge|brave|firefox|opera|vivaldi|arc/i, label: 'External Browser' },
  { pattern: /chatgpt/i, label: 'ChatGPT Desktop App' },
  { pattern: /claude/i, label: 'Claude App' },
  { pattern: /slack|discord|teams|zoom|skype/i, label: 'Communication App' },
  { pattern: /notepad|wordpad|winword|excel|onenote/i, label: 'Notes / Document App' },
  { pattern: /whatsapp|telegram/i, label: 'Messaging App' },
  { pattern: /cmd|powershell|wt|terminal|bash/i, label: 'Command Terminal' }
];

// Resolve PowerShell script path (handles unpacked asar in production packages)
function getForegroundScriptPath() {
  const unpackedPath = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'get-foreground-window.ps1');
  if (fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }
  return path.join(__dirname, 'get-foreground-window.ps1');
}

function getForegroundApp() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve(null);
    }
    const scriptPath = getForegroundScriptPath();
    if (!fs.existsSync(scriptPath)) {
      return resolve(null);
    }
    execFile('powershell.exe', [
      '-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath
    ], { timeout: 2500 }, (err, stdout) => {
      if (err || !stdout) {
        lastProcessCheckOk = false;
        return resolve(null);
      }
      lastProcessCheckOk = true;
      try {
        const data = JSON.parse(stdout.trim());
        resolve(data);
      } catch {
        resolve(null);
      }
    });
  });
}

function classifyApp(processName, windowTitle) {
  const combined = `${processName} ${windowTitle}`.toLowerCase();
  for (const { pattern, label } of SUSPICIOUS_APP_PATTERNS) {
    if (pattern.test(combined)) {
      return label;
    }
  }
  return null;
}

function startForegroundMonitoring() {
  if (foregroundMonitorInterval) return;

  foregroundMonitorInterval = setInterval(async () => {
    if (!isExamMode || !mainWindow || mainWindow.isDestroyed()) return;

    const appInfo = await getForegroundApp();
    if (!appInfo) return;

    const appKey = `${appInfo.ProcessName}:${appInfo.ProcessId}:${appInfo.WindowTitle}`;
    if (appKey === lastForegroundApp) return;

    lastForegroundApp = appKey;

    // Skip our own Electron proctor application
    const procLower = (appInfo.ProcessName || '').toLowerCase();
    if (procLower === 'electron' || procLower.includes('wuelev8') || procLower.includes('smart-proctoring')) {
      return;
    }

    // Only audit when main examination browser window is not focused
    if (!mainWindow.isFocused()) {
      const now = Date.now();
      const windowTitle = (appInfo.WindowTitle || '').substring(0, 160);

      if (appInfo.IsBrowser) {
        if (appInfo.IsIncognito) {
          console.warn(`[Proctor Incognito Alert] ${appInfo.ProcessName} in Incognito/InPrivate focused: "${windowTitle}"`);
          const eventPayload = {
            processName: appInfo.ProcessName,
            windowTitle,
            isIncognito: true,
            evidence: appInfo.IncognitoEvidence || 'Private browsing signature detected',
            timestamp: now
          };

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proctor:incognito-detected', eventPayload);
          }

          webMonitor.reportViolation({
            eventType: 'incognito_browser_detected',
            severity: 'critical',
            details: `External browser in Incognito/InPrivate mode detected: ${appInfo.ProcessName} ("${windowTitle}"). ${eventPayload.evidence}`,
            url: `browser://${appInfo.ProcessName}/incognito`
          });
        } else {
          console.warn(`[Proctor External Browser Alert] ${appInfo.ProcessName} focused: "${windowTitle}"`);
          const eventPayload = {
            processName: appInfo.ProcessName,
            windowTitle,
            isIncognito: false,
            timestamp: now
          };

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proctor:external-browser-detected', eventPayload);
          }

          webMonitor.reportViolation({
            eventType: 'external_browser_detected',
            severity: 'high',
            details: `External browser window focused: ${appInfo.ProcessName} ("${windowTitle}")`,
            url: `browser://${appInfo.ProcessName}`
          });
        }
      } else {
        const category = appInfo.Category || classifyApp(appInfo.ProcessName, windowTitle) || 'External Application';
        console.log(`[Proctor External App] Detected: ${appInfo.ProcessName} (${category}) - "${windowTitle}"`);
        
        const eventPayload = {
          processName: appInfo.ProcessName,
          windowTitle,
          category,
          timestamp: now
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('proctor:external-app-detected', eventPayload);
        }

        webMonitor.reportViolation({
          eventType: 'external_app_detected',
          severity: 'high',
          details: `External ${category} focused: "${appInfo.ProcessName}" (${windowTitle})`,
          url: `app://${appInfo.ProcessName}`
        });
      }
    }
  }, 1800);
}

function stopForegroundMonitoring() {
  if (foregroundMonitorInterval) {
    clearInterval(foregroundMonitorInterval);
    foregroundMonitorInterval = null;
  }
}

async function checkBackendHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    if (res.ok) {
      const data = await res.json();
      return { healthy: true, data };
    }
    return { healthy: false, status: res.status };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#ffffff',
    title: 'WUElev8 Smart Proctoring Browser',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      webviewTag: true,
      allowRunningInsecureContent: false
    }
  });

  // Remove default menu for distraction-free assessment environment
  Menu.setApplicationMenu(null);

  // Hook monitoring events to renderer
  webMonitor.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proctor:monitoring-event', event);
    }
  });

  // Attach web monitoring for any web content loaded
  webMonitor.attachToWebContents(mainWindow.webContents);

  // CONTROLLED NAVIGATION: Handle attempts to open new windows or popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[Navigation Policy] Window open attempt intercepted: ${url}`);
    const evaluation = navigationPolicy.evaluateNavigation(url);

    if (!evaluation.allowed) {
      console.warn(`[Navigation Policy Alert] Blocked window open to: ${url}. Reason: ${evaluation.reason}`);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('security:navigation-blocked', {
          url,
          reason: evaluation.reason,
          isAi: evaluation.isAi,
          message: evaluation.message || 'Popups and external windows are blocked by exam policy.',
          timestamp: Date.now()
        });
      }

      if (isExamMode) {
        webMonitor.reportViolation({
          eventType: evaluation.isAi ? 'ai_query_submitted' : 'unauthorized_navigation',
          severity: 'high',
          details: `Blocked attempt to open external window: ${url}. (${evaluation.message})`,
          url
        });
      }

      return { action: 'deny' };
    }

    return { action: 'deny' }; // Keep everything inside main window
  });

  // CONTROLLED NAVIGATION: Enforce exam navigation allowlist
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const evaluation = navigationPolicy.evaluateNavigation(navigationUrl);

    if (!evaluation.allowed) {
      event.preventDefault();
      console.warn(`[Navigation Policy Alert] Blocked navigation attempt to: ${navigationUrl}. Reason: ${evaluation.reason}`);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('security:navigation-blocked', {
          url: navigationUrl,
          reason: evaluation.reason,
          isAi: evaluation.isAi,
          message: evaluation.message || 'External navigation is restricted by institutional policy.',
          timestamp: Date.now()
        });
      }

      if (isExamMode) {
        webMonitor.reportViolation({
          eventType: 'unauthorized_navigation',
          severity: 'high',
          details: `Candidate attempted navigation to unapproved URL: ${navigationUrl}. (${evaluation.message})`,
          url: navigationUrl
        });
      }
    }
  });

  // Window Focus and Blur Proctoring Monitoring
  mainWindow.on('blur', () => {
    blurStartTime = Date.now();
    console.log(`[Proctor] Window lost focus at ${new Date(blurStartTime).toISOString()}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:blur', { timestamp: blurStartTime });
    }
    if (isExamMode) {
      startForegroundMonitoring();
      webMonitor.reportViolation({
        eventType: 'focus_loss',
        severity: 'medium',
        details: 'Examination window lost focus (candidate navigated away or switched windows).'
      });
    }
  });

  mainWindow.on('focus', () => {
    const focusTime = Date.now();
    const duration = blurStartTime ? (focusTime - blurStartTime) : 0;
    console.log(`[Proctor] Window regained focus. Away duration: ${duration}ms`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:focus', { timestamp: focusTime, duration });
    }
    if (isExamMode && duration > 2000) {
      webMonitor.reportViolation({
        eventType: 'assessment_return',
        severity: 'low',
        details: `Candidate returned to examination window after ${(duration / 1000).toFixed(1)}s away.`
      });
    }
    blurStartTime = null;
    lastForegroundApp = '';
  });

  // Fullscreen Exit Detection during Exam Mode
  mainWindow.on('leave-full-screen', () => {
    if (isExamMode) {
      console.warn(`[Proctor Warning] Candidate left fullscreen during active exam!`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('security:fullscreen-exit-attempt', { timestamp: Date.now() });
      }
      webMonitor.reportViolation({
        eventType: 'fullscreen_exit',
        severity: 'high',
        details: 'Candidate exited fullscreen mode during active assessment session.'
      });
    }
  });

  // Lockdown Close & Minimize Interceptions
  mainWindow.on('close', (event) => {
    if (isExamMode) {
      event.preventDefault();
      console.warn('[Security] Candidate attempted to close exam window while exam mode is active!');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('security:close-attempt', { timestamp: Date.now() });
      }
      webMonitor.reportViolation({
        eventType: 'exam_exit_attempt',
        severity: 'critical',
        details: 'Candidate attempted to close or terminate the examination window while lockdown mode was active.'
      });
    }
  });

  mainWindow.on('minimize', () => {
    if (isExamMode) {
      console.warn('[Security] Exam window was minimized!');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('security:minimize-attempt', { timestamp: Date.now() });
      }
      webMonitor.reportViolation({
        eventType: 'window_minimized',
        severity: 'high',
        details: 'Examination browser was minimized during active examination session.'
      });
    }
  });

  // Restricted System Hotkeys & DevTools Interception
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isExamMode) return;

    // Block F12 (DevTools)
    if (input.key === 'F12') {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'F12' });
      return;
    }

    // Block Ctrl+Shift+I / Cmd+Option+I / Ctrl+Shift+J / Ctrl+Shift+C (Inspect Element)
    if ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: `Ctrl+Shift+${input.key.toUpperCase()}` });
      return;
    }

    // Block Ctrl+R or F5 (Page Refresh)
    if (((input.control || input.meta) && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'Refresh' });
      return;
    }

    // Block Ctrl+W (Close Window), Ctrl+Q (Quit)
    if ((input.control || input.meta) && ['w', 'q'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: `Ctrl+${input.key.toUpperCase()}` });
      return;
    }

    // Block Ctrl+P (Print), Ctrl+S (Save Page)
    if ((input.control || input.meta) && ['p', 's'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: `Ctrl+${input.key.toUpperCase()}` });
      return;
    }

    // Block Ctrl+N (New Window), Ctrl+T (New Tab outside UI)
    if ((input.control || input.meta) && ['n', 't'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: `Ctrl+${input.key.toUpperCase()}` });
      return;
    }

    // Intercept Alt+Tab
    if (input.alt && input.key === 'Tab') {
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'Alt+Tab' });
    }
  });

  // Production vs Development Entry Loading
  const localDistPath = path.join(__dirname, '../client/dist/index.html');
  const packagedDistPath = path.join(app.getAppPath(), 'client/dist/index.html');

  const resolvedDistPath = fs.existsSync(packagedDistPath) ? packagedDistPath : localDistPath;

  if (app.isPackaged) {
    console.log(`[Electron] Loading packaged bundle: ${resolvedDistPath}`);
    mainWindow.loadFile(resolvedDistPath);
  } else {
    // In development: connect to live Vite dev server if running, otherwise load local dist
    console.log(`[Electron] Development mode: Loading ${FRONTEND_DEV_URL}`);
    mainWindow.loadURL(FRONTEND_DEV_URL).catch((err) => {
      console.log(`[Electron] Dev server connection failed (${err.message}), falling back to local bundle: ${resolvedDistPath}`);
      if (fs.existsSync(resolvedDistPath)) {
        mainWindow.loadFile(resolvedDistPath);
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1000);

  mainWindow.on('closed', () => {
    stopForegroundMonitoring();
    webMonitor.clearSession();
    mainWindow = null;
  });
}

// -------------------------------------------------------------
// IPC Handlers with Strict Origin & Parameter Validation
// -------------------------------------------------------------

function validateSender(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

ipcMain.handle('window:set-fullscreen', (event, fullscreen) => {
  if (!validateSender(event)) return false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(Boolean(fullscreen));
    return mainWindow.isFullScreen();
  }
  return false;
});

ipcMain.handle('window:get-fullscreen', (event) => {
  if (!validateSender(event)) return false;
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('window:set-kiosk', (event, kiosk) => {
  if (!validateSender(event)) return false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setKiosk(Boolean(kiosk));
    return mainWindow.isKiosk();
  }
  return false;
});

ipcMain.handle('security:set-exam-mode', (event, active) => {
  if (!validateSender(event)) return false;
  isExamMode = Boolean(active);
  navigationPolicy.setExamActive(isExamMode);
  console.log(`[Security Mode] Exam mode set to: ${isExamMode}`);

  if (isExamMode) {
    startForegroundMonitoring();
  } else {
    stopForegroundMonitoring();
    webMonitor.clearSession();
  }
  return isExamMode;
});

ipcMain.handle('security:set-exam-policy', (event, policy) => {
  if (!validateSender(event)) return false;
  navigationPolicy.setExamActive(isExamMode, policy);
  return true;
});

ipcMain.handle('proctor:set-session-info', (event, sessionInfo) => {
  if (!validateSender(event)) return false;
  if (sessionInfo?.attemptId) {
    webMonitor.setSession(sessionInfo.attemptId, sessionInfo.token || null);
  } else {
    webMonitor.clearSession();
  }
  return true;
});

ipcMain.handle('browser:evaluate-url', (event, url) => {
  if (!validateSender(event)) return { allowed: false, reason: 'unauthorized_sender' };
  return navigationPolicy.evaluateNavigation(url);
});

let wasBackendHealthy = true;

ipcMain.handle('system:heartbeat', async (event, clientState) => {
  if (!validateSender(event)) return { ok: false };
  lastHeartbeatTime = Date.now();
  const backendHealth = await checkBackendHealth();

  if (wasBackendHealthy !== backendHealth.healthy) {
    wasBackendHealthy = backendHealth.healthy;
    console.log(`[Connectivity State] Backend status changed: healthy=${wasBackendHealthy}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('offline:connectivity-changed', {
        isOnline: wasBackendHealthy,
        timestamp: Date.now()
      });
    }
  }

  return {
    ok: true,
    backendHealthy: backendHealth.healthy,
    foregroundMonitorActive: Boolean(foregroundMonitorInterval),
    processCheckOk: lastProcessCheckOk,
    isExamMode,
    timestamp: lastHeartbeatTime
  };
});

ipcMain.handle('system:get-info', (event) => {
  if (!validateSender(event)) return null;
  const displays = screen.getAllDisplays();
  return {
    platform: process.platform,
    displayCount: displays.length,
    displays: displays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      isPrimary: d.id === screen.getPrimaryDisplay().id
    })),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  };
});

ipcMain.handle('system:get-app-config', (event) => {
  if (!validateSender(event)) return null;
  return {
    appName: 'WUElev8 Smart Proctoring Browser',
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    backendUrl: BACKEND_URL,
    frontendDevUrl: FRONTEND_DEV_URL,
    platform: process.platform
  };
});

ipcMain.handle('system:check-backend-health', async (event) => {
  if (!validateSender(event)) return { healthy: false };
  return await checkBackendHealth();
});

// -------------------------------------------------------------
// Offline Examination Store IPC Handlers
// -------------------------------------------------------------
ipcMain.handle('offline:is-available', (event) => {
  if (!validateSender(event)) return false;
  return Boolean(offlineStore && offlineStore.db);
});

ipcMain.handle('offline:cache-package', (event, pkg) => {
  if (!validateSender(event)) return { ok: false, error: 'Unauthorized sender' };
  try {
    return offlineStore.cacheAssessmentPackage(pkg);
  } catch (err) {
    console.error('[IPC offline:cache-package]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('offline:get-package', (event, attemptId) => {
  if (!validateSender(event)) return null;
  try {
    return offlineStore.getCachedPackage(attemptId);
  } catch (err) {
    console.error('[IPC offline:get-package]', err);
    return null;
  }
});

ipcMain.handle('offline:save-answer', (event, payload) => {
  if (!validateSender(event)) return { ok: false, error: 'Unauthorized sender' };
  try {
    return offlineStore.saveAnswer(payload);
  } catch (err) {
    console.error('[IPC offline:save-answer]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('offline:get-answers', (event, attemptId) => {
  if (!validateSender(event)) return [];
  try {
    return offlineStore.getSavedAnswers(attemptId);
  } catch (err) {
    console.error('[IPC offline:get-answers]', err);
    return [];
  }
});

ipcMain.handle('offline:log-event', (event, payload) => {
  if (!validateSender(event)) return { ok: false };
  try {
    return offlineStore.logProctoringEvent(payload);
  } catch (err) {
    console.error('[IPC offline:log-event]', err);
    return { ok: false };
  }
});

ipcMain.handle('offline:log-nav', (event, payload) => {
  if (!validateSender(event)) return { ok: false };
  try {
    return offlineStore.logNavigationEvent(payload);
  } catch (err) {
    console.error('[IPC offline:log-nav]', err);
    return { ok: false };
  }
});

ipcMain.handle('offline:get-pending-sync', (event, attemptId) => {
  if (!validateSender(event)) return null;
  try {
    return offlineStore.getPendingSyncPayload(attemptId);
  } catch (err) {
    console.error('[IPC offline:get-pending-sync]', err);
    return null;
  }
});

ipcMain.handle('offline:ack-sync', (event, { attemptId, ack }) => {
  if (!validateSender(event)) return { ok: false };
  try {
    return offlineStore.acknowledgeSync(attemptId, ack || {});
  } catch (err) {
    console.error('[IPC offline:ack-sync]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('offline:set-submission-state', (event, { attemptId, state, errorMessage }) => {
  if (!validateSender(event)) return { ok: false };
  try {
    return offlineStore.setSubmissionState(attemptId, state, errorMessage);
  } catch (err) {
    console.error('[IPC offline:set-submission-state]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('offline:get-submission-state', (event, attemptId) => {
  if (!validateSender(event)) return null;
  try {
    return offlineStore.getSubmissionState(attemptId);
  } catch (err) {
    console.error('[IPC offline:get-submission-state]', err);
    return null;
  }
});

ipcMain.handle('offline:get-monotonic-timing', (event, attemptId) => {
  if (!validateSender(event)) return null;
  try {
    return offlineStore.getMonotonicTiming(attemptId);
  } catch (err) {
    console.error('[IPC offline:get-monotonic-timing]', err);
    return null;
  }
});

ipcMain.on('window:minimize', (event) => {
  if (!validateSender(event)) return;
  if (mainWindow && !mainWindow.isDestroyed() && !isExamMode) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:close', (event) => {
  if (!validateSender(event)) return;
  if (mainWindow && !mainWindow.isDestroyed() && !isExamMode) {
    mainWindow.close();
  }
});

// Ensure single instance to prevent GPU cache lock conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // App Lifecycle
  app.whenReady().then(() => {
    // Initialize durable offline SQLite store
    try {
      offlineStore.initialize();
    } catch (e) {
      console.warn('[Electron] Failed to initialize offlineStore:', e.message);
    }
    // Set standard modern Chrome user agent without Electron/WUElev8 signature
    // This allows modern web apps (ChatGPT, Claude, Google, etc.) to connect cleanly without Turnstile/Cloudflare bot blocks
    try {
      session.defaultSession.setUserAgent(STANDARD_CHROME_UA);
      const examSession = session.fromPartition('persist:exam_workspace');
      examSession.setUserAgent(STANDARD_CHROME_UA);

      const headerFilter = { urls: ['*://*/*'] };
      const stripFrameHeaders = (details, callback) => {
        // Strip frame-blocking headers for frames to allow permitted resources inside lockdown browser
        // Leave API/WebSocket headers untouched to prevent chunked/SSE transfer corruption
        if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
          const responseHeaders = Object.assign({}, details.responseHeaders);
          delete responseHeaders['x-frame-options'];
          delete responseHeaders['X-Frame-Options'];
          delete responseHeaders['content-security-policy'];
          delete responseHeaders['Content-Security-Policy'];
          return callback({ responseHeaders });
        }
        callback({ responseHeaders: details.responseHeaders });
      };

      session.defaultSession.webRequest.onHeadersReceived(headerFilter, stripFrameHeaders);
      examSession.webRequest.onHeadersReceived(headerFilter, stripFrameHeaders);

      // Grant clipboard and media permissions for exam workspace partition
      examSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
    } catch (e) {
      console.warn('[Electron] Failed to configure web sessions:', e.message);
    }

    // Automatically monitor and protect any webview instances created in renderer
    app.on('web-contents-created', (_event, contents) => {
      if (contents.getType() === 'webview') {
        console.log(`[Electron Webview] New WebContents instance created: ${contents.id}`);

        try {
          contents.setUserAgent(STANDARD_CHROME_UA);
        } catch {}

        // Inject stealth script on webview to ensure navigator.webdriver is undefined and window.chrome is present
        const stealthScript = `
          try {
            Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined,
              configurable: true
            });
            if (!window.chrome) {
              window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
              };
            }
            if (!navigator.plugins || navigator.plugins.length === 0) {
              Object.defineProperty(navigator, 'plugins', {
                get: () => [
                  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' }
                ]
              });
            }
            if (!navigator.languages || navigator.languages.length === 0) {
              Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
              });
            }
          } catch (e) {}
        `;

        contents.on('did-start-loading', () => {
          contents.executeJavaScript(stealthScript).catch(() => {});
        });

        contents.on('dom-ready', () => {
          contents.executeJavaScript(stealthScript).catch(() => {});
        });

        // Attach passive proctoring web & prompt monitor
        webMonitor.attachToWebContents(contents);

        // Enforce URL navigation policy on the webview safely
        contents.on('will-navigate', (e, navUrl) => {
          try {
            const evalResult = navigationPolicy.evaluateNavigation(navUrl);
            if (!evalResult.allowed) {
              e.preventDefault();
              console.warn(`[Webview Policy Alert] Blocked navigation inside webview to: ${navUrl}`);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('security:navigation-blocked', {
                  url: navUrl,
                  reason: evalResult.reason,
                  isAi: evalResult.isAi,
                  message: evalResult.message
                });
              }
            }
          } catch (err) {
            console.error('[Webview Navigation Error]:', err.message);
          }
        });

        // Intercept new window / popup attempts inside the webview safely
        contents.setWindowOpenHandler(({ url }) => {
          try {
            if (!url || url === 'about:blank') {
              return { action: 'allow' };
            }
            const evalResult = navigationPolicy.evaluateNavigation(url);
            if (!evalResult.allowed) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('security:navigation-blocked', {
                  url,
                  reason: evalResult.reason,
                  message: evalResult.message
                });
              }
              return { action: 'deny' };
            }
            contents.loadURL(url);
            return { action: 'deny' };
          } catch (err) {
            console.error('[Webview Window Open Error]:', err.message);
            return { action: 'deny' };
          }
        });
      }
    });

    createWindow();
  });
}

app.on('window-all-closed', () => {
  stopForegroundMonitoring();
  webMonitor.clearSession();
  try {
    offlineStore.close();
  } catch {}
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
