const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

// Remove ELECTRON_RUN_AS_NODE to ensure Electron launches the full GUI runtime
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const rootDir = path.resolve(__dirname, '..');

const proc = spawn(electron, ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  env
});

proc.on('close', (code) => {
  process.exit(code || 0);
});

proc.on('error', (err) => {
  console.error('[Electron Launch Error]:', err);
  process.exit(1);
});
