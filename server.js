// Tutor Board server: serves the web app, keeps one board per lesson,
// relays strokes between everyone on the same board, and saves each board
// to data/boards/<id>.json.
//
// It listens on two ports:
// - The main port (3000) is for the tutor's own computer and for students on
//   the same Wi-Fi. Only requests from this computer count as the tutor.
// - The student port (3001) is open to this computer only, and the Cloudflare
//   tunnel forwards to it. It serves the board page, its files and the live
//   connection, nothing else. Tunnel traffic reaches us from this computer,
//   so it needs its own port to be told apart from the tutor.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { startTunnel } from './tunnel.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const PORT = Number(process.env.PORT) || 3000;
const STUDENT_PORT = Number(process.env.STUDENT_PORT) || PORT + 1;

// Largest message the server accepts from a browser. The biggest real one is
// a whole stroke in one 'stroke:add' (undo/redo): about 25 bytes per pen
// sample, so a minute of non-stop writing at 240 Hz is about 350 KB. app.js
// splits strokes longer than 10,000 samples (about 250 KB) into several
// messages, so nothing real comes near this.
const MAX_MESSAGE = 2 * 1024 * 1024;

fs.mkdirSync(BOARDS_DIR, { recursive: true });

// ---------- boards on disk ----------

// Board ids are random and too long to guess (72 bits), so a board's link
// is the key to it (SPEC R32).
const newBoardId = () => crypto.randomBytes(9).toString('base64url');
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const boardFile = (id) => path.join(BOARDS_DIR, id + '.json');

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function cleanTitle(t) {
  // eslint-disable-next-line no-control-regex
  return String(t ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'Untitled board';
}

function writeBoard(b) {
  const tmp = boardFile(b.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(b));
  fs.renameSync(tmp, boardFile(b.id));
}

const summary = (b) => ({
  id: b.id,
  title: b.title,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
  pageCount: b.pages.length,
});

// Summaries of every board, for the board list.
const boardList = new Map();

// The prototype stored a single board in data/board.json. Turn it into a
// normal board so nothing drawn before is lost.
function migrateLegacyBoard() {
  const legacy = path.join(DATA_DIR, 'board.json');
  if (!fs.existsSync(legacy)) return;
  try {
    const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    const st = fs.statSync(legacy);
    const created = st.birthtimeMs || st.mtimeMs;
    writeBoard({
      id: newBoardId(),
      title: `${localDate(new Date(created))}_First board`,
      createdAt: created,
      updatedAt: st.mtimeMs,
      pages: Array.isArray(old.pages) && old.pages.length ? old.pages : [newPage()],
    });
    fs.renameSync(legacy, legacy + '.migrated');
    console.log('Moved the old single board into data/boards/.');
  } catch (err) {
    console.error('Could not migrate data/board.json:', err.message);
  }
}

function scanBoards() {
  for (const f of fs.readdirSync(BOARDS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const b = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, f), 'utf8'));
      if (b.id && Array.isArray(b.pages)) boardList.set(b.id, summary(b));
    } catch { /* skip unreadable file */ }
  }
}

const newPage = () => ({ id: 'page-1', name: 'Page 1', strokes: [] });

function createBoard(title) {
  const now = Date.now();
  const b = { id: newBoardId(), title: cleanTitle(title), createdAt: now, updatedAt: now, pages: [newPage()] };
  writeBoard(b);
  boardList.set(b.id, summary(b));
  return b;
}

// ---------- open boards (in memory while someone is connected) ----------

const openBoards = new Map(); // id -> { board, strokeIndex, clients, saveTimer, dirtySince }

// Loads a board for live editing (the id must already match ID_RE). Throws if
// the file can't be read; the error's code is 'ENOENT' if there's no such board.
function openBoard(id) {
  if (openBoards.has(id)) return openBoards.get(id);
  const board = JSON.parse(fs.readFileSync(boardFile(id), 'utf8'));
  if (!Array.isArray(board.pages)) throw new Error('the file has no pages');
  const strokeIndex = new Map();
  for (const p of board.pages) for (const s of p.strokes) strokeIndex.set(s.id, s);
  const ob = { board, strokeIndex, clients: new Set(), saveTimer: null, dirtySince: null };
  openBoards.set(id, ob);
  return ob;
}

// Each browser tab numbers its messages and keeps them until the server says
// they're saved to disk (an 'ack'). After a dropped connection or a server
// restart, the tab sends again whatever wasn't confirmed, so no ink is lost.
// Per board and tab: the last message number applied, and the last saved.
const clientSeqs = new Map(); // boardId -> Map<clientId, { applied, saved }>

function seqsFor(boardId, clientId) {
  let byClient = clientSeqs.get(boardId);
  if (!byClient) clientSeqs.set(boardId, (byClient = new Map()));
  let e = byClient.get(clientId);
  if (!e) byClient.set(clientId, (e = { applied: 0, saved: 0 }));
  return e;
}

// Save after a 500 ms pause in changes, but never wait more than 2 s, so tabs
// get their acks even during non-stop writing.
function scheduleSave(ob) {
  const now = Date.now();
  ob.dirtySince ??= now;
  clearTimeout(ob.saveTimer);
  const wait = Math.max(0, Math.min(500, ob.dirtySince + 2000 - now));
  ob.saveTimer = setTimeout(() => saveNow(ob), wait);
}

function saveNow(ob) {
  clearTimeout(ob.saveTimer);
  ob.saveTimer = null;
  ob.dirtySince = null;
  try {
    writeBoard(ob.board);
  } catch (err) {
    // Not confirmed, so the tabs keep their copies. Try again shortly.
    console.error(`Could not save board ${ob.board.id}:`, err.message);
    ob.saveTimer = setTimeout(() => saveNow(ob), 5000);
    return;
  }
  const byClient = clientSeqs.get(ob.board.id);
  if (!byClient) return;
  for (const e of byClient.values()) e.saved = e.applied;
  for (const ws of ob.clients) sendAck(ws);
}

function sendAck(ws) {
  const { saved } = ws.seqs;
  if (saved > ws.acked && ws.readyState === 1) {
    ws.acked = saved;
    ws.send(JSON.stringify({ type: 'ack', seq: saved }));
  }
}

const MAX_ID = 64;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isPoints = (a) =>
  Array.isArray(a) && a.length % 3 === 0 && a.every((n) => typeof n === 'number' && Number.isFinite(n));

function cleanStroke(s) {
  if (!s || !isId(s.id) || !isId(s.pageId) || !isPoints(s.points)) return null;
  return {
    id: s.id,
    pageId: s.pageId,
    color: String(s.color).slice(0, 32),
    size: Math.min(64, Math.max(0.5, Number(s.size) || 3)),
    points: s.points,
  };
}

// Applies a message from a browser to the board. Returns a clean copy to send
// on to everyone else, or null if it changed nothing. Only known fields are
// copied, so odd extras in a message never reach other people or the file.
function apply(ob, m) {
  const { board, strokeIndex } = ob;
  const findPage = (id) => board.pages.find((p) => p.id === id);
  switch (m.type) {
    case 'stroke:start':
    case 'stroke:add': {
      const s = cleanStroke(m.stroke);
      const page = s && findPage(s.pageId);
      if (!page || strokeIndex.has(s.id)) return null;
      page.strokes.push(s);
      strokeIndex.set(s.id, s);
      return { type: m.type, stroke: s };
    }
    case 'stroke:points': {
      const s = strokeIndex.get(m.id);
      if (!s || !isPoints(m.points)) return null;
      // `at` is where these points start in the stroke. Points sent again
      // after reconnecting may overlap what we have; keep only the new ones.
      const have = s.points.length;
      const at = Number.isSafeInteger(m.at) ? m.at : have;
      if (at > have || at % 3 !== 0) return null;
      const fresh = m.points.slice(have - at);
      if (!fresh.length) return null;
      for (const n of fresh) s.points.push(n);
      return { type: 'stroke:points', id: s.id, pageId: s.pageId, at: have, points: fresh };
    }
    case 'stroke:pressure': {
      // The pen pressed harder on a point already sent (a pen held still,
      // such as a light dot). Pressure only goes up, so a repeat is harmless.
      const s = strokeIndex.get(m.id);
      const at = m.at;
      if (!s || !Number.isSafeInteger(at) || at < 0 || at % 3 !== 0 || at + 2 >= s.points.length) return null;
      if (typeof m.pressure !== 'number' || !Number.isFinite(m.pressure) || m.pressure <= s.points[at + 2]) return null;
      s.points[at + 2] = m.pressure;
      return { type: 'stroke:pressure', id: s.id, pageId: s.pageId, at, pressure: m.pressure };
    }
    case 'stroke:end': {
      const s = strokeIndex.get(m.id);
      return s ? { type: 'stroke:end', id: s.id, pageId: s.pageId } : null;
    }
    case 'stroke:delete': {
      const page = findPage(m.pageId);
      if (!page || !Array.isArray(m.ids)) return null;
      const ids = new Set(m.ids.filter(isId));
      const removed = [];
      page.strokes = page.strokes.filter((s) => {
        if (!ids.has(s.id)) return true;
        removed.push(s.id);
        return false;
      });
      if (!removed.length) return null;
      for (const id of removed) strokeIndex.delete(id);
      return { type: 'stroke:delete', pageId: page.id, ids: removed };
    }
    case 'page:add': {
      if (!m.page || !isId(m.page.id) || findPage(m.page.id)) return null;
      const page = { id: m.page.id, name: String(m.page.name || 'Page').slice(0, 80), strokes: [] };
      board.pages.push(page);
      return { type: 'page:add', page };
    }
    case 'page:rename': {
      const page = findPage(m.id);
      if (!page) return null;
      page.name = String(m.name || page.name).slice(0, 80);
      return { type: 'page:rename', id: page.id, name: page.name };
    }
    case 'page:delete': {
      const page = findPage(m.id);
      if (!page || board.pages.length <= 1) return null;
      for (const s of page.strokes) strokeIndex.delete(s.id);
      board.pages = board.pages.filter((p) => p !== page);
      return { type: 'page:delete', id: page.id };
    }
    case 'board:rename': {
      board.title = cleanTitle(m.title);
      return { type: 'board:rename', title: board.title };
    }
    default:
      return null;
  }
}

// ---------- who is the tutor ----------

// True if the address belongs to this computer: loopback, or one of its own
// network addresses (the tutor opening the Wi-Fi address on this computer).
function isThisComputer(addr) {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  if (a === '::1' || a.startsWith('127.')) return true;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.address === a) return true;
  }
  return false;
}

// The address typed in the browser must name this computer directly
// (localhost, an IP address or the computer's name). This stops a web page on
// some other site from pointing its own domain at this computer ("DNS
// rebinding") to read the board list through the tutor's browser.
function hostIsDirect(host) {
  let name;
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(name)) return true;
  const me = os.hostname().toLowerCase();
  return name === me || name === `${me}.local`;
}

function isTutor(req, viaStudentPort) {
  if (viaStudentPort) return false;
  // Cloudflare adds these headers. If a tunnel is ever pointed at the main
  // port by mistake, its visitors still count as students.
  if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) return false;
  return isThisComputer(req.socket.remoteAddress) && hostIsDirect(req.headers.host);
}

// ---------- HTTP: API + static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// The only files a student can load: the ones board.html uses.
const BOARD_FILES = new Set(['app.js', 'net.js', 'render.js', 'style.css']);

const STUDENT_HOME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tutor Board</title><link rel="stylesheet" href="/style.css"></head>
<body class="home"><main class="home-main"><h1>Tutor Board</h1>
<p>To join a lesson, open the board link your tutor sent you.</p></main></body></html>`;

const BASE_HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  // Board links are keys; never pass them on to another site.
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, type, body) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type });
  res.end(body);
}
const sendText = (res, status, text) => send(res, status, 'text/plain; charset=utf-8', text);
const sendJson = (res, status, data) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) tooLarge = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Too large'), { status: 413 }));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('Bad JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Files are only served if they appear in the public folder's listing, so a
// request can never name a path outside it (or a Windows device name).
function serveFile(res, name) {
  fs.readFile(path.join(PUBLIC, name), (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    send(res, 200, MIME[path.extname(name)] || 'application/octet-stream', data);
  });
}

// The board page, marked with who is looking at it. Tutor-only controls are
// hidden for students; the server checks the role again for anything that
// matters, so changing this mark in the browser unlocks nothing.
function serveBoardPage(res, tutor) {
  fs.readFile(path.join(PUBLIC, 'board.html'), 'utf8', (err, html) => {
    if (err) return sendText(res, 500, 'Server error');
    const role = tutor ? 'tutor' : 'student';
    send(res, 200, MIME['.html'], html.replace('<body class="board">', `<body class="board" data-role="${role}">`));
  });
}

function handleBoardsApi(req, res) {
  if (req.method === 'GET') {
    const list = [...boardList.values()].sort((a, b) => b.createdAt - a.createdAt);
    return sendJson(res, 200, list);
  }
  if (req.method !== 'POST') return sendText(res, 405, 'Method not allowed');
  // Requiring JSON means another website can't create boards through the
  // tutor's browser (the browser would have to ask permission first).
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
    return sendJson(res, 415, { error: 'Expected JSON' });
  }
  readJson(req)
    .then((body) => sendJson(res, 201, summary(createBoard(body?.title))))
    .catch((err) => sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' }));
}

function handleRequest(req, res, viaStudentPort) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  const tutor = isTutor(req, viaStudentPort);

  if (/^\/b\/[A-Za-z0-9_-]+\/?$/.test(urlPath)) return serveBoardPage(res, tutor);

  if (tutor) {
    if (urlPath === '/api/boards') return handleBoardsApi(req, res);
    if (urlPath === '/') return serveFile(res, 'home.html');
  } else if (urlPath === '/') {
    return send(res, 200, MIME['.html'], STUDENT_HOME);
  }

  const name = urlPath.slice(1);
  const allowed = tutor ? fs.readdirSync(PUBLIC).includes(name) : BOARD_FILES.has(name);
  if (!allowed) return sendText(res, 404, 'Not found');
  serveFile(res, name);
}

function requestHandler(viaStudentPort) {
  return (req, res) => {
    try {
      handleRequest(req, res, viaStudentPort);
    } catch (err) {
      console.error('Request failed:', req.url, err);
      if (!res.headersSent) sendText(res, 500, 'Server error');
      else res.end();
    }
  };
}

// ---------- realtime ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
const CLIENT_RE = /^[a-z0-9]{6,32}$/;

// Tutor connections get told about the student link (see tunnel.js).
const tutorSockets = new Set();
let share = { status: 'starting', url: null, reason: null };
const shareMessage = () => JSON.stringify({ type: 'share', ...share });

function setShare(next) {
  share = next;
  const data = shareMessage();
  for (const ws of tutorSockets) if (ws.readyState === 1) ws.send(data);
}

function broadcast(ob, msg, except) {
  const data = JSON.stringify(msg);
  for (const c of ob.clients) if (c !== except && c.readyState === 1) c.send(data);
}
const sendPresence = (ob) => broadcast(ob, { type: 'presence', count: ob.clients.size });

function handleUpgrade(req, socket, head, viaStudentPort) {
  try {
    socket.on('error', () => {}); // a client vanishing mid-handshake is not our problem
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    const tutor = isTutor(req, viaStudentPort);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url.searchParams, tutor));
  } catch (err) {
    console.error('Connection refused:', err.message);
    socket.destroy();
  }
}

function onConnection(ws, params, tutor) {
  // Bad frames and oversized messages: ws reports them here and closes the
  // connection. Without a listener the error would stop the server.
  ws.on('error', (err) => console.warn('Connection closed:', err.message));

  const id = params.get('board') || '';
  if (!ID_RE.test(id)) return refuse(ws, id, tutor, 'bad ID', true);
  let ob;
  try {
    ob = openBoard(id);
  } catch (err) {
    if (err.code === 'ENOENT') return refuse(ws, id, tutor, 'no file', true);
    return refuse(ws, id, tutor, `read error (${err.message})`, false);
  }

  const clientId = CLIENT_RE.test(params.get('client') || '') ? params.get('client') : newBoardId().toLowerCase();
  ws.seqs = seqsFor(ob.board.id, clientId);
  ws.acked = ws.seqs.saved;
  ob.clients.add(ws);
  if (tutor) tutorSockets.add(ws);

  // `ack`: the last message from this tab that is safely saved. The tab sends
  // anything after that again.
  ws.send(JSON.stringify({ type: 'init', board: ob.board, ack: ws.seqs.saved }));
  if (tutor) ws.send(shareMessage());
  sendPresence(ob);

  ws.on('message', (data) => {
    try {
      handleMessage(ob, ws, data);
    } catch (err) {
      console.error('Message ignored:', err.message);
    }
  });

  ws.on('close', () => {
    ob.clients.delete(ws);
    tutorSockets.delete(ws);
    sendPresence(ob);
    if (ob.clients.size === 0) {
      saveNow(ob);
      openBoards.delete(ob.board.id);
    }
  });
}

// Turns a connection away and says why on the console, so a board link that
// "doesn't work" can be looked into. Only a board that really doesn't exist
// gets 4404, which makes the page say the link is bad and stop trying. Any
// other problem (such as a file that can't be read right now) gets 1011, and
// the page keeps retrying as it does when offline.
function refuse(ws, id, tutor, reason, missing) {
  // The id comes from the browser: cut it short and quote it, so it can't mess up the log.
  const shown = JSON.stringify(id.length > 60 ? id.slice(0, 60) + '...' : id);
  const who = tutor ? 'tutor' : 'student';
  console.warn(`Board ${shown} refused (${who}): ${reason}${missing ? '' : '; the page will retry'}`);
  ws.close(missing ? 4404 : 1011, missing ? 'Board not found' : 'Could not open board');
}

function handleMessage(ob, ws, data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  const e = ws.seqs;
  const seq = Number.isSafeInteger(msg.seq) && msg.seq > 0 ? msg.seq : 0;

  // A message already applied (sent again after reconnecting) is skipped.
  const out = seq && seq <= e.applied ? null : apply(ob, msg);
  if (seq > e.applied) e.applied = seq;

  if (out) {
    broadcast(ob, out, ws);
    ob.board.updatedAt = Date.now();
    boardList.set(ob.board.id, summary(ob.board));
    scheduleSave(ob);
  } else if (!ob.saveTimer) {
    // Nothing waiting to be saved, so everything applied is already on disk.
    e.saved = e.applied;
    sendAck(ws);
  }
}

// ---------- start ----------

migrateLegacyBoard();
scanBoards();

const mainServer = http.createServer(requestHandler(false));
const studentServer = http.createServer(requestHandler(true));
mainServer.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, false));
studentServer.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, true));

let tunnel = null;

mainServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is Tutor Board already running?`);
  else console.error(err);
  process.exit(1);
});

studentServer.on('error', (err) => {
  console.error(`Student port ${STUDENT_PORT}: ${err.message}`);
  setShare({ status: 'off', url: null, reason: `the student port (${STUDENT_PORT}) is in use` });
});

// Everyone on the same Wi-Fi can reach the main port (SPEC R28).
mainServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Tutor Board running at http://localhost:${PORT}`);
  // The student port is for this computer only: the tunnel reaches it here.
  studentServer.listen(STUDENT_PORT, '127.0.0.1', () => {
    tunnel = startTunnel({ port: STUDENT_PORT, logFile: path.join(DATA_DIR, 'cloudflared.log'), onChange: onShareChange });
  });
});

function onShareChange(next) {
  setShare(next);
  if (next.status === 'starting') console.log('Sharing: starting a Cloudflare tunnel for student links...');
  else if (next.status === 'on') console.log(`Sharing: student links use ${next.url} (give it about 30 seconds to start working)`);
  else console.log(`Sharing is off: ${next.reason}.`);
}

// Last resort (SPEC R34): a bug in handling one request or message is logged
// and the server keeps running, so it can never end a lesson.
process.on('uncaughtException', (err) => console.error('Unexpected error (still running):', err));
process.on('unhandledRejection', (err) => console.error('Unexpected error (still running):', err));

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const ob of openBoards.values()) saveNow(ob);
  tunnel?.stop();
  process.exit(0);
}
// SIGHUP: the terminal window was closed. SIGBREAK: Ctrl+Break on Windows.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, shutdown);
process.on('exit', () => tunnel?.stop());
