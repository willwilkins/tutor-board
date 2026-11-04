// Student links over the internet (SPEC R29, R31): starts a free Cloudflare
// "quick tunnel" to the student port and reads its address
// (https://<name>.trycloudflare.com) from cloudflared's log output.
// No Cloudflare account is needed. Each start gives a new address.
//
// cloudflared is a separate program (Windows: winget install --id
// Cloudflare.cloudflared). If it's missing or fails, sharing is off and the
// app carries on as normal. Its full output goes to data/cloudflared.log.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// api.trycloudflare.com appears in error messages; it's not a tunnel address.
const URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 60_000;

// Looks on the PATH, then where winget installs it (a terminal opened before
// the install doesn't see the new PATH yet). CLOUDFLARED=<path> overrides.
function findCloudflared() {
  if (process.env.CLOUDFLARED) return fs.existsSync(process.env.CLOUDFLARED) ? process.env.CLOUDFLARED : null;
  const win = process.platform === 'win32';
  const exe = win ? 'cloudflared.exe' : 'cloudflared';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (win) {
    const env = process.env;
    dirs.push(
      path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links'),
      path.join(env['ProgramFiles(x86)'] || '', 'cloudflared'),
      path.join(env.ProgramFiles || '', 'cloudflared'),
    );
  }
  for (const dir of dirs) {
    const file = path.join(dir, exe);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// onChange receives { status: 'starting' | 'on' | 'off', url, reason }.
// Returns { stop() }, which ends the tunnel.
export function startTunnel({ port, logFile, onChange }) {
  const off = (reason) => onChange({ status: 'off', url: null, reason });
  if (/^(off|0|false|no)$/i.test(process.env.TUNNEL || '')) {
    off('it is turned off (TUNNEL=off)');
    return { stop() {} };
  }
  const cmd = findCloudflared();
  if (!cmd) {
    off('cloudflared is not installed (winget install --id Cloudflare.cloudflared, then restart)');
    return { stop() {} };
  }

  const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
  // A .js stand-in for cloudflared runs with Node (used for testing).
  const [file, argv] = /\.m?js$/i.test(cmd) ? [process.execPath, [cmd, ...args]] : [cmd, args];

  let log = null;
  try {
    log = fs.createWriteStream(logFile);
    log.on('error', () => { log = null; });
  } catch { /* no log, no problem */ }

  let child;
  let done = false; // stopped, or failed
  let url = null;
  let timer = null;
  const recent = [];

  function fail(reason) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    if (recent.length) console.log('Last lines from cloudflared:\n  ' + recent.join('\n  '));
    off(`${reason}. Details in data/cloudflared.log`);
  }

  function onLine(line) {
    log?.write(line + '\n');
    if (!line.trim()) return;
    recent.push(line.trim());
    if (recent.length > 8) recent.shift();
    const m = !url && line.match(URL_RE);
    if (m) {
      url = m[0].toLowerCase();
      clearTimeout(timer);
      onChange({ status: 'on', url, reason: null });
    }
  }

  onChange({ status: 'starting', url: null, reason: null });
  try {
    child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    off(`cloudflared could not start (${err.message})`);
    return { stop() {} };
  }
  // cloudflared logs to stderr; read both, line by line.
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) onLine(line);
    });
  }
  child.on('error', (err) => fail(`cloudflared could not start (${err.message})`));
  child.on('exit', (code) => fail(`cloudflared stopped (exit code ${code})`));
  timer = setTimeout(() => fail('cloudflared gave no address within 60 seconds'), START_TIMEOUT_MS);

  return {
    stop() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      log?.end();
    },
  };
}
