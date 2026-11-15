// C0VIBE hosted mode (fork-only file; docs in C0X docs/sow/videohub/SEAMS.md).
// When a host app runs the hub for one user it sets VIDEOHUB_HOSTED=1 and usually VIDEOHUB_SOCKET and VIDEOHUB_TOKEN.
// Then the hub listens on a private socket instead of a TCP port, refuses requests without the token, and keeps the
// settings that decide what code may run or which files may be read under the host's control.
// Without VIDEOHUB_HOSTED nothing here changes how VideoHub behaves.
import fs from 'node:fs';
import path from 'node:path';

export const HOSTED = process.env.VIDEOHUB_HOSTED === '1';
export const SOCKET = process.env.VIDEOHUB_SOCKET || '';
const TOKEN = process.env.VIDEOHUB_TOKEN || '';

// Settings only the host may change: which folders are read, whether command jobs need approval, which studio
// engine code is imported, where outputs go.
const LOCKED_KEYS = ['roots', 'studioDir', 'outputsDir', 'port'];

// Environment names a film's render settings may not set: they change how programs load code.
const DENY_EXACT = new Set(['PATH', 'HOME', 'SHELL', 'BASH_ENV', 'ENV', 'ZDOTDIR', 'PROMPT_COMMAND', 'IFS', 'TMPDIR', 'COMSPEC', 'PATHEXT']);
const DENY_PREFIX = ['NODE_', 'NPM_', 'LD_', 'DYLD_', 'ELECTRON_', 'VIDEOHUB_', 'PYTHON', 'PERL', 'RUBY', 'GIT_', 'SSH_', 'PUPPETEER_', 'CHROME_'];
const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export function tokenRefused(req, token = TOKEN) {
  if (!token) return null;
  return req.headers['x-videohub-token'] === token ? null : 'token';
}

export function hostedConfigPatch(patch, hosted = HOSTED) {
  if (!hosted || !patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...patch };
  for (const key of LOCKED_KEYS) delete out[key];
  if (out.render && typeof out.render === 'object') {
    const { confirmCommands, ...render } = out.render;
    out.render = render;
  }
  return out;
}

export function hostedEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env || {})) {
    const k = String(key);
    if (!NAME.test(k) || DENY_EXACT.has(k) || DENY_PREFIX.some(p => k.startsWith(p))) continue;
    out[k] = String(value);
  }
  return out;
}

function inside(file, dir) {
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const rel = path.relative(real(dir), real(file));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertScriptInside(filmDir, script) {
  if (!script) return;
  const file = path.resolve(filmDir, script);
  if (!inside(file, filmDir)) throw Object.assign(new Error('In C0VIBE a render script must be inside the film folder: ' + script), { code: 400 });
}

export function hostedCopyTo(dir, outputsDir) {
  if (!outputsDir || inside(dir, outputsDir)) return dir;
  throw Object.assign(new Error('In C0VIBE a render copy goes inside the outputs folder: ' + outputsDir), { code: 400 });
}

// The hub refuses to start on a socket path another process still holds; a stale file from a crash is removed.
function prepareSocket(socket) {
  if (!socket || process.platform === 'win32') return;
  try { if (fs.statSync(socket).isSocket()) fs.unlinkSync(socket); } catch { }
}

// A hosted hub never falls back to a TCP port: without its socket it does not start (C0ray finding, 2026-11-15).
export function hostedStartRefusal(hosted = HOSTED, socket = SOCKET) {
  return hosted && !socket ? 'VideoHub hosted mode needs VIDEOHUB_SOCKET; it does not listen on a TCP port.' : null;
}

// Custom command jobs run a command line through the system shell. A hosted hub refuses them; render scripts inside
// the film folder still run (C0ray finding, 2026-11-15).
export function hostedCommandRefusal(hosted = HOSTED) {
  return hosted ? Object.assign(new Error('In C0VIBE, custom command renders are switched off. Use the film\'s render script.'), { code: 403 }) : null;
}

// jobs.js reads these through globalThis so its in-memory tests (which strip imports) keep running unchanged.
if (HOSTED) {
  const refusal = hostedStartRefusal();
  if (refusal) { console.error(refusal); process.exit(2); }
  prepareSocket(SOCKET);
  globalThis.c0Hosted = { env: hostedEnv, script: assertScriptInside, copyTo: hostedCopyTo, command: hostedCommandRefusal };
}
