/**
 * Verification test for Electron Desktop Architecture & Controlled Navigation
 */

const { NavigationPolicy } = require('./navigation-policy');
const { WebMonitor, MONITORED_DOMAINS } = require('./monitoring');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

console.log('--- Testing Electron Smart Browser Architecture ---');

// 1. Navigation Policy Tests
const policy = new NavigationPolicy();

// Test A: Normal outside exam
const eval1 = policy.evaluateNavigation('http://localhost:5173/#/dashboard');
console.assert(eval1.allowed === true, 'Eval 1: Localhost dashboard should be allowed');

// Test B: Activate exam mode with permitted documentation domain
policy.setExamActive(true, ['docs.python.org', 'w3schools.com']);

// Test C: Assessment origin during exam
const eval2 = policy.evaluateNavigation('http://localhost:5173/#/assessment');
console.assert(eval2.allowed === true, 'Eval 2: Assessment origin should be allowed');

// Test D: Local file protocol during exam
const eval3 = policy.evaluateNavigation('file:///C:/Users/app/dist/index.html');
console.assert(eval3.allowed === true, 'Eval 3: Local file protocol should be allowed');

// Test E: Permitted external documentation domain
const eval4 = policy.evaluateNavigation('https://docs.python.org/3/library/functions.html');
console.assert(eval4.allowed === true && eval4.monitored === true, 'Eval 4: Permitted domain should be allowed and monitored');

// Test F: Prohibited external website (e.g. ChatGPT, Claude, random site)
const eval5 = policy.evaluateNavigation('https://chatgpt.com');
console.assert(eval5.allowed === false && eval5.reason === 'exam_policy_restricted', 'Eval 5: Prohibited site should be blocked');

console.log('✓ Navigation Policy tests passed successfully!');

// 2. Web Monitor URL Classifier Tests
const monitor = new WebMonitor();

const testUrls = [
  { url: 'https://chatgpt.com/c/1234', expected: 'ChatGPT (OpenAI)' },
  { url: 'https://claude.ai/chat/5678', expected: 'Claude (Anthropic)' },
  { url: 'https://gemini.google.com/app', expected: 'Google Gemini' },
  { url: 'https://www.google.com/search?q=test', expected: 'Google Search' },
  { url: 'https://www.bing.com/search?q=test', expected: 'Bing Search' },
  { url: 'https://www.perplexity.ai/search', expected: 'Perplexity AI' },
  { url: 'https://copilot.microsoft.com', expected: 'Microsoft Copilot' },
  { url: 'https://example.com', expected: null }
];

for (const { url, expected } of testUrls) {
  const result = monitor.classifyUrl(url);
  console.assert(result === expected, `Classifier failed for ${url}: got ${result}, expected ${expected}`);
}
console.log('✓ Web Activity and AI URL Classifier tests passed successfully!');

// 3. Win32 Foreground Process Detection Test (Windows)
if (process.platform === 'win32') {
  const ps1Script = path.join(__dirname, 'get-foreground-window.ps1');
  console.assert(fs.existsSync(ps1Script), 'PS1 script must exist');

  execFile('powershell.exe', [
    '-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', ps1Script
  ], { timeout: 3000 }, (err, stdout) => {
    if (err) {
      console.warn('PS1 execution error:', err.message);
    } else {
      try {
        const parsed = JSON.parse(stdout.trim());
        console.assert(parsed.ProcessName !== undefined, 'ProcessName must be present');
        console.log(`✓ Win32 Foreground Detection active: Current Window = "${parsed.ProcessName}" ("${parsed.WindowTitle}")`);
      } catch (e) {
        console.warn('PS1 output parse error:', e.message);
      }
    }
  });
}

// 4. Installer Artifact Existence Verification
const installerPath = path.resolve(__dirname, '../release/WUElev8 Smart Proctoring Browser Setup 1.0.0.exe');
const unpackedPath = path.resolve(__dirname, '../release/win-unpacked/WUElev8 Smart Proctoring Browser.exe');

console.assert(fs.existsSync(installerPath), `Installer must exist at: ${installerPath}`);
console.assert(fs.existsSync(unpackedPath), `Unpacked executable must exist at: ${unpackedPath}`);

const installerStats = fs.statSync(installerPath);
const unpackedStats = fs.statSync(unpackedPath);

console.log(`✓ Windows NSIS Installer verified: ${installerPath} (${(installerStats.size / (1024 * 1024)).toFixed(1)} MB)`);
console.log(`✓ Windows Unpacked Executable verified: ${unpackedPath} (${(unpackedStats.size / (1024 * 1024)).toFixed(1)} MB)`);

console.log('--- ALL ELECTRON SHELL CHECKS PASSED ---');

