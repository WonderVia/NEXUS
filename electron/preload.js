const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, tightly scoped APIs to the renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  
  // Window State Management & Lockdown
  setFullscreen: (fullscreen) => {
    if (typeof fullscreen !== 'boolean') return Promise.resolve(false);
    return ipcRenderer.invoke('window:set-fullscreen', fullscreen);
  },
  getFullscreen: () => ipcRenderer.invoke('window:get-fullscreen'),
  setKiosk: (kiosk) => {
    if (typeof kiosk !== 'boolean') return Promise.resolve(false);
    return ipcRenderer.invoke('window:set-kiosk', kiosk);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),

  // Security, Hardware & Health Info
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  getAppConfig: () => ipcRenderer.invoke('system:get-app-config'),
  checkBackendHealth: () => ipcRenderer.invoke('system:check-backend-health'),
  heartbeat: (clientState) => ipcRenderer.invoke('system:heartbeat', clientState),

  // Examination Mode & Policy Lifecycle
  setExamMode: (active) => {
    if (typeof active !== 'boolean') return Promise.resolve(false);
    return ipcRenderer.invoke('security:set-exam-mode', active);
  },
  setExamPolicy: (policy) => {
    if (!policy || typeof policy !== 'object') return Promise.resolve(false);
    return ipcRenderer.invoke('security:set-exam-policy', policy);
  },
  setActiveSessionInfo: (sessionInfo) => {
    if (!sessionInfo || typeof sessionInfo !== 'object') return Promise.resolve(false);
    return ipcRenderer.invoke('proctor:set-session-info', sessionInfo);
  },

  // Controlled Browser Navigation Engine
  evaluateUrl: (url) => {
    if (typeof url !== 'string') return Promise.resolve({ allowed: false, reason: 'invalid_url' });
    return ipcRenderer.invoke('browser:evaluate-url', url);
  },

  // Event Listeners from Main Process (with clean unsubscribe functions)
  onWindowBlur: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('window:blur', subscription);
    return () => ipcRenderer.removeListener('window:blur', subscription);
  },

  onWindowFocus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('window:focus', subscription);
    return () => ipcRenderer.removeListener('window:focus', subscription);
  },

  onFullscreenExitAttempt: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('security:fullscreen-exit-attempt', subscription);
    return () => ipcRenderer.removeListener('security:fullscreen-exit-attempt', subscription);
  },

  onBlockedShortcut: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('security:blocked-shortcut', subscription);
    return () => ipcRenderer.removeListener('security:blocked-shortcut', subscription);
  },

  onNavigationBlocked: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('security:navigation-blocked', subscription);
    return () => ipcRenderer.removeListener('security:navigation-blocked', subscription);
  },

  onCloseAttempt: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('security:close-attempt', subscription);
    return () => ipcRenderer.removeListener('security:close-attempt', subscription);
  },

  onMinimizeAttempt: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('security:minimize-attempt', subscription);
    return () => ipcRenderer.removeListener('security:minimize-attempt', subscription);
  },

  // Windows-Level External App & Incognito Auditing
  onExternalAppDetected: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('proctor:external-app-detected', subscription);
    return () => ipcRenderer.removeListener('proctor:external-app-detected', subscription);
  },

  onExternalBrowserDetected: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('proctor:external-browser-detected', subscription);
    return () => ipcRenderer.removeListener('proctor:external-browser-detected', subscription);
  },

  onIncognitoDetected: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('proctor:incognito-detected', subscription);
    return () => ipcRenderer.removeListener('proctor:incognito-detected', subscription);
  },

  onMonitoringInterrupted: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('proctor:monitoring-interrupted', subscription);
    return () => ipcRenderer.removeListener('proctor:monitoring-interrupted', subscription);
  },

  // Integrated Web Activity & Prompt Interceptions
  onMonitoringEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('proctor:monitoring-event', subscription);
    return () => ipcRenderer.removeListener('proctor:monitoring-event', subscription);
  }
});
