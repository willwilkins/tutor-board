// Tutor Board server: serves the web app, relays strokes between
// everyone connected, and saves the board to data/board.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'board.json');
const PORT = Number(process.env.PORT) || 3000;

// ---------- board state ----------

function loadBoard() {
  try {
    const b = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(b.pages) && b.pages.length) return b;
  } catch { /* no saved board yet */ }
  return { pages: [{ id: 'page-1', name: 'Page 1', strokes: [] }] };
}

const board = loadBoard();
const strokeIndex = new Map(); // stroke id -> stroke
for (const p of board.pages) for (const s of p.strokes) strokeIndex.set(s.id, s);

const findPage = (id) => board.pages.find((p) => p.id === id);

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
function saveNow() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board));
  fs.renameSync(tmp, DATA_FILE);
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

// Applies a message to the board. Returns true if it should be relayed.
function apply(m) {
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
    default:
      return false;
  }
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.resolve(PUBLIC, '.' + (urlPath === '/' ? '/index.html' : urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }
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
});

// ---------- realtime ----------

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(data);
}
const sendPresence = () => broadcast({ type: 'presence', count: wss.clients.size });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', board }));
  sendPresence();
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg && apply(msg)) {
      broadcast(msg, ws);
      scheduleSave();
    }
  });
  ws.on('close', sendPresence);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tutor Board running at http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
}
