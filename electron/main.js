const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const { NavigationPolicy } = require('./navigation-policy');
const { WebMonitor } = require('./monitoring');

// Application metadata
app.setName('WUElev8 Smart Proctoring Browser');

// Optimize Chromium network service and GPU process stability on Windows
app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox');

let mainWindow = null;
let isExamMode = false;
let blurStartTime = null;
let foregroundMonitorInterval = null;
let lastForegroundApp = '';

// Backend and environment configuration
const BACKEND_URL = process.env.PROCTOR_API_URL || process.env.API_URL || 'http://localhost:5000';
const FRONTEND_DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

const navigationPolicy = new NavigationPolicy();
const webMonitor = new WebMonitor({ backendUrl: BACKEND_URL });

// Known suspicious application patterns for Windows foreground auditing
const SUSPICIOUS_APP_PATTERNS = [
  { pattern: /chrome|msedge|brave|firefox|opera/i, label: 'Web Browser' },
  { pattern: /chatgpt/i, label: 'ChatGPT Desktop App' },
  { pattern: /claude/i, label: 'Claude App' },
  { pattern: /slack|discord|teams|zoom|skype/i, label: 'Communication App' },
  { pattern: /notepad|wordpad|winword|excel|onenote/i, label: 'Notes / Document App' },
  { pattern: /whatsapp|telegram/i, label: 'Messaging App' },
  { pattern: /cmd|powershell|wt|terminal/i, label: 'Command Terminal' }
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
    ], { timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
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

    const appKey = `${appInfo.ProcessName}:${appInfo.ProcessId}`;
    if (appKey === lastForegroundApp) return;

    lastForegroundApp = appKey;

    // Skip our own Electron proctor application
    const procLower = (appInfo.ProcessName || '').toLowerCase();
    if (procLower === 'electron' || procLower.includes('wuelev8') || procLower.includes('smart-proctoring')) {
      return;
    }

    const category = classifyApp(appInfo.ProcessName, appInfo.WindowTitle || '');
    
    if (category && !mainWindow.isFocused()) {
      console.log(`[Proctor External App] Detected: ${appInfo.ProcessName} (${category}) - "${appInfo.WindowTitle}"`);
      
      const eventPayload = {
        processName: appInfo.ProcessName,
        windowTitle: (appInfo.WindowTitle || '').substring(0, 140),
        category,
        timestamp: Date.now()
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proctor:external-app-detected', eventPayload);
      }

      // Automatically report to backend proctoring pipeline
      webMonitor.reportViolation({
        eventType: 'external_app_detected',
        severity: 'high',
        details: `External ${category} focused: "${appInfo.ProcessName}" (${eventPayload.windowTitle})`,
        url: `app://${appInfo.ProcessName}`
      });
    }
  }, 2000);
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
    backgroundColor: '#070b14',
    title: 'WUElev8 Smart Proctoring Browser',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
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
          message: evaluation.message || 'Popups and external windows are blocked by exam policy.',
          timestamp: Date.now()
        });
      }

      if (isExamMode) {
        webMonitor.reportViolation({
          eventType: 'external_site_visit',
          severity: 'high',
          details: `Blocked attempt to open external window: ${url}`,
          url
        });
      }

      return { action: 'deny' };
    }

    return { action: 'deny' }; // Even if allowed origin, keep everything inside main window
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
          message: evaluation.message || 'External navigation is restricted by institutional policy.',
          timestamp: Date.now()
        });
      }

      if (isExamMode) {
        webMonitor.reportViolation({
          eventType: 'external_site_visit',
          severity: 'high',
          details: `Candidate attempted navigation to unapproved external URL: ${navigationUrl}`,
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
    }
  });

  mainWindow.on('focus', () => {
    const focusTime = Date.now();
    const duration = blurStartTime ? (focusTime - blurStartTime) : 0;
    console.log(`[Proctor] Window regained focus. Away duration: ${duration}ms`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:focus', { timestamp: focusTime, duration });
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

    // Block Ctrl+Shift+I / Cmd+Option+I (Inspect Element)
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'Ctrl+Shift+I' });
      return;
    }

    // Block Ctrl+R or F5 (Page Refresh)
    if (((input.control || input.meta) && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'Refresh' });
      return;
    }

    // Block Ctrl+W (Close Window)
    if ((input.control || input.meta) && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'Ctrl+W' });
      return;
    }

    // Block Ctrl+P (Print)
    if ((input.control || input.meta) && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      mainWindow.webContents.send('security:blocked-shortcut', { key: 'Ctrl+P' });
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

  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) {
    if (fs.existsSync(resolvedDistPath)) {
      console.log(`[Electron] Loading production frontend bundle: ${resolvedDistPath}`);
      mainWindow.loadFile(resolvedDistPath);
    } else {
      console.log(`[Electron] Client dist not found locally, falling back to: ${FRONTEND_DEV_URL}`);
      mainWindow.loadURL(FRONTEND_DEV_URL).catch(() => {
        mainWindow.loadFile(resolvedDistPath);
      });
    }
  } else {
    console.log(`[Electron] Development mode: Loading Vite dev server at ${FRONTEND_DEV_URL}`);
    mainWindow.loadURL(FRONTEND_DEV_URL).catch(() => {
      if (fs.existsSync(resolvedDistPath)) {
        mainWindow.loadFile(resolvedDistPath);
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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

  if (!isExamMode) {
    stopForegroundMonitoring();
    webMonitor.clearSession();
  }
  return isExamMode;
});

ipcMain.handle('security:set-exam-policy', (event, policy) => {
  if (!validateSender(event)) return false;
  const permitted = Array.isArray(policy?.permittedExternalDomains) ? policy.permittedExternalDomains : [];
  navigationPolicy.setExamActive(isExamMode, permitted);
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
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
  stopForegroundMonitoring();
  webMonitor.clearSession();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
