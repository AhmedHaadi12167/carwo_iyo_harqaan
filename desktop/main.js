/**
 * Tailor System — desktop shell for POS machines.
 *
 * One click on the icon:
 *   1. starts the backend API (port 5000)
 *   2. starts the frontend web server (port 3000)
 *   3. opens the app window
 * PostgreSQL runs separately as a Windows service (installed once).
 *
 * Both servers listen on 0.0.0.0, so tailors' phones on the same WiFi
 * still connect to http://<pos-ip>:3000 while the .exe is open.
 */
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let backend = null;
let frontend = null;
let win = null;

// In the installed app, bundled files live in resources/; in development they
// sit next to this folder.
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const BACKEND_DIR = app.isPackaged ? path.join(RES, 'backend') : path.join(RES, 'backend');
const FRONTEND_DIR = app.isPackaged ? path.join(RES, 'frontend') : path.join(RES, 'frontend', '.next', 'standalone');

// Run a JS file using Electron's own Node runtime — the POS machine
// does NOT need Node.js installed.
function runNode(script, cwd, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv },
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  return child;
}

// Wait until an HTTP endpoint answers (server finished booting)
function waitFor(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, () => resolve()).on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`Timeout waiting for ${url}`));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function boot() {
  backend = runNode(path.join(BACKEND_DIR, 'src', 'server.js'), BACKEND_DIR);
  frontend = runNode(path.join(FRONTEND_DIR, 'server.js'), FRONTEND_DIR, {
    PORT: '3000',
    HOSTNAME: '0.0.0.0', // keep LAN access for the tailors' phones
  });

  win = new BrowserWindow({
    width: 1366,
    height: 800,
    autoHideMenuBar: true,
    show: false,
    title: 'Tailor System',
    backgroundColor: '#eef0f3',
  });
  win.maximize();

  try {
    await waitFor('http://127.0.0.1:5000/api/health');
    await waitFor('http://127.0.0.1:3000');
    await win.loadURL('http://localhost:3000');
    win.show();
  } catch (err) {
    dialog.showErrorBox(
      'Tailor System could not start',
      'The system did not start in time.\n\n' +
      'Most common cause: PostgreSQL is not running or the database password in ' +
      'resources\\backend\\.env is wrong.\n\nDetails: ' + err.message
    );
    app.quit();
  }
}

function shutdown() {
  try { backend?.kill(); } catch {}
  try { frontend?.kill(); } catch {}
}

app.whenReady().then(boot);
app.on('window-all-closed', () => { shutdown(); app.quit(); });
app.on('before-quit', shutdown);
