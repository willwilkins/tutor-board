// Tutor Board server: serves the web app, keeps one board per lesson,
// relays strokes between everyone on the same board, and saves each board
// to data/boards/<id>.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const PORT = Number(process.env.PORT) || 3000;

fs.mkdirSync(BOARDS_DIR, { recursive: true });

// ---------- boards on disk ----------

// Board ids are random and hard to guess, so a board's link can later double
// as its access key when sharing with a student.
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

const openBoards = new Map(); // id -> { board, strokeIndex, clients, saveTimer }

function openBoard(id) {
  if (openBoards.has(id)) return openBoards.get(id);
  if (!ID_RE.test(id) || !fs.existsSync(boardFile(id))) return null;
  const board = JSON.parse(fs.readFileSync(boardFile(id), 'utf8'));
  const strokeIndex = new Map();
  for (const p of board.pages) for (const s of p.strokes) strokeIndex.set(s.id, s);
  const ob = { board, strokeIndex, clients: new Set(), saveTimer: null };
  openBoards.set(id, ob);
  return ob;
}

function scheduleSave(ob) {
  clearTimeout(ob.saveTimer);
  ob.saveTimer = setTimeout(() => saveNow(ob), 500);
}
function saveNow(ob) {
  clearTimeout(ob.saveTimer);
  ob.saveTimer = null;
  writeBoard(ob.board);
}

const isNumArray = (a) => Array.isArray(a) && a.every((n) => typeof n === 'number' && Number.isFinite(n));

function cleanStroke(s) {
  if (!s || typeof s.id !== 'string' || !isNumArray(s.points)) return null;
  return {
    id: s.id,
    pageId: String(s.pageId),
    color: String(s.color).slice(0, 32),
    size: Number(s.size) || 3,
    points: s.points,
  };
}

// Applies a message to a board. Returns true if it should be relayed.
function apply(ob, m) {
  const { board, strokeIndex } = ob;
  const findPage = (id) => board.pages.find((p) => p.id === id);
  switch (m.type) {
    case 'stroke:start':
    case 'stroke:add': {
      const s = cleanStroke(m.stroke);
      const page = s && findPage(s.pageId);
      if (!page || strokeIndex.has(s.id)) return false;
      page.strokes.push(s);
      strokeIndex.set(s.id, s);
      m.stroke = s;
      return true;
    }
    case 'stroke:points': {
      const s = strokeIndex.get(m.id);
      if (!s || !isNumArray(m.points)) return false;
      for (const n of m.points) s.points.push(n);
      return true;
    }
    case 'stroke:end':
      return strokeIndex.has(m.id);
    case 'stroke:delete': {
      const page = findPage(m.pageId);
      if (!page || !Array.isArray(m.ids)) return false;
      const ids = new Set(m.ids);
      page.strokes = page.strokes.filter((s) => !ids.has(s.id));
      for (const id of ids) strokeIndex.delete(id);
      return true;
    }
    case 'page:add': {
      if (!m.page || typeof m.page.id !== 'string' || findPage(m.page.id)) return false;
      m.page = { id: m.page.id, name: String(m.page.name || 'Page').slice(0, 80), strokes: [] };
      board.pages.push(m.page);
      return true;
    }
    case 'page:rename': {
      const page = findPage(m.id);
      if (!page) return false;
      page.name = String(m.name || page.name).slice(0, 80);
      m.name = page.name;
      return true;
    }
    case 'page:delete': {
      const page = findPage(m.id);
      if (!page || board.pages.length <= 1) return false;
      for (const s of page.strokes) strokeIndex.delete(s.id);
      board.pages = board.pages.filter((p) => p !== page);
      return true;
    }
    case 'board:rename': {
      board.title = cleanTitle(m.title);
      m.title = board.title;
      return true;
    }
    default:
      return false;
  }
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

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > limit) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (urlPath === '/api/boards') {
    if (req.method === 'GET') {
      const list = [...boardList.values()].sort((a, b) => b.createdAt - a.createdAt);
      sendJson(res, 200, list);
    } else if (req.method === 'POST') {
      try {
        const body = await readJson(req);
        const b = createBoard(body.title);
        sendJson(res, 201, summary(b));
      } catch {
        sendJson(res, 400, { error: 'Bad request' });
      }
    } else {
      res.writeHead(405).end();
    }
    return;
  }

  if (urlPath === '/') return serveFile(res, path.join(PUBLIC, 'home.html'));
  if (/^\/b\/[^/]+\/?$/.test(urlPath)) return serveFile(res, path.join(PUBLIC, 'board.html'));

  const file = path.resolve(PUBLIC, '.' + urlPath);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  serveFile(res, file);
});

// ---------- realtime ----------

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(ob, msg, except) {
  const data = JSON.stringify(msg);
  for (const c of ob.clients) if (c !== except && c.readyState === 1) c.send(data);
}
const sendPresence = (ob) => broadcast(ob, { type: 'presence', count: ob.clients.size });

wss.on('connection', (ws, req) => {
  const id = new URL(req.url, 'http://x').searchParams.get('board') || '';
  let ob;
  try {
    ob = openBoard(id);
  } catch {
    ob = null;
  }
  if (!ob) {
    ws.close(4404, 'Board not found');
    return;
  }

  ob.clients.add(ws);
  ws.send(JSON.stringify({ type: 'init', board: ob.board }));
  sendPresence(ob);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg && apply(ob, msg)) {
      broadcast(ob, msg, ws);
      ob.board.updatedAt = Date.now();
      boardList.set(ob.board.id, summary(ob.board));
      scheduleSave(ob);
    }
  });

  ws.on('close', () => {
    ob.clients.delete(ws);
    sendPresence(ob);
    if (ob.clients.size === 0) {
      saveNow(ob);
      openBoards.delete(ob.board.id);
    }
  });
});

// ---------- start ----------

migrateLegacyBoard();
scanBoards();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tutor Board running at http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const ob of openBoards.values()) saveNow(ob);
    process.exit(0);
  });
}
