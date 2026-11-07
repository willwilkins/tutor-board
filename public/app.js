import { drawSegment, drawTail, drawStroke, widthAt, dotWidth, hitStroke, strokeBounds, maxHalfWidth, pageBounds } from './render.js';
import { connect } from './net.js';

// ---------- canvases ----------
// "ink" holds finished + in-progress strokes. It is opaque and "desynchronized",
// which lets the browser show new ink without waiting for the next compositor frame.
// "overlay" sits on top for throwaway drawing: the stroke tip, predicted points
// and the eraser circle. It also receives all pointer input.
const ink = document.getElementById('ink');
const overlay = document.getElementById('overlay');
const ictx = ink.getContext('2d', { alpha: false, desynchronized: true });
const octx = overlay.getContext('2d', { desynchronized: true });
let dpr = window.devicePixelRatio || 1;

// ---------- state ----------
const COLORS = ['#1d1d1f', '#1f5fd1', '#d62d2d', '#1f9d55', '#e67e00', '#7b3fd1'];
const SIZES = [1.5, 3, 6, 12];
const ERASER_RADIUS = 10; // screen px
const MIN_ZOOM = 0.1, MAX_ZOOM = 8;
// Longest run of points in one message (10,000 samples, about 250 KB), so
// even a very long stroke never hits the server's message size limit.
const CHUNK = 30000;
const isTutor = document.body.dataset.role === 'tutor';

const board = { title: '', pages: [] };
const strokes = new Map(); // id -> stroke
let pageId = null;
const views = new Map(); // pageId -> { x, y, z } (screen = world * z + offset)
const tool = { mode: 'pen', color: COLORS[0], size: SIZES[1] };
const undoStack = [];
const redoStack = [];

// This tab's id: prefixes our stroke ids, and lets the server track which of
// our messages it has saved. (getRandomValues also works over plain http.)
const clientId = Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('');
let idCounter = 0;
const newId = () => `${clientId}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

const currentPage = () => board.pages.find((p) => p.id === pageId);
function view() {
  let v = views.get(pageId);
  if (!v) views.set(pageId, (v = { x: 0, y: 0, z: 1 }));
  return v;
}
const toWorldX = (cx, v) => (cx - v.x) / v.z;
const toWorldY = (cy, v) => (cy - v.y) / v.z;
const round = (n, d) => Math.round(n * d) / d;

// ---------- network ----------
const boardId = decodeURIComponent(location.pathname.match(/^\/b\/([^/]+)/)?.[1] ?? '');

let online = false;

const net = connect({
  boardId,
  clientId,
  onMessage: handleMessage,
  onStatus: (status) => {
    online = status === 'online';
    document.getElementById('conn').classList.toggle('online', online);
    if (status === 'offline') document.getElementById('peers').textContent = 'offline – reconnecting (your ink is kept)';
    if (status === 'notfound') {
      const n = document.getElementById('notice');
      n.innerHTML = isTutor
        ? '<p>This board doesn\'t exist. Check the link, or <a href="/">go to all boards</a>.</p>'
        : '<p>This board link doesn\'t work. Ask your tutor for a new one.</p>';
      n.hidden = false;
    }
  },
});

// Ink kept while offline only lives in this tab until it's sent, so warn
// before the tab is closed then.
window.addEventListener('beforeunload', (e) => {
  if (!online && net.unsent) e.preventDefault();
});

function handleMessage(m) {
  switch (m.type) {
    case 'init':
      loadBoard(m.board);
      break;
    case 'share':
      setShare(m);
      break;
    case 'presence':
      document.getElementById('peers').textContent =
        m.count === 1 ? 'only you connected' : `${m.count} connected`;
      break;
    case 'stroke:start':
    case 'stroke:add': {
      const s = m.stroke;
      if (!addStrokeLocal(s)) break;
      if (s.pageId === pageId) {
        if (m.type === 'stroke:add') drawStroke(ictx, s);
        else for (let k = 1; k < s.points.length / 3; k++) drawSegment(ictx, s, k);
      }
      break;
    }
    case 'stroke:points': {
      const s = strokes.get(m.id);
      if (!s) break;
      const n0 = s.points.length / 3;
      for (const n of m.points) s.points.push(n);
      if (s.pageId === pageId) {
        const n1 = s.points.length / 3;
        for (let k = Math.max(1, n0); k < n1; k++) drawSegment(ictx, s, k);
      }
      break;
    }
    case 'stroke:pressure': {
      // The pen pressed harder on a point it had already sent. It arrives
      // before the ink that uses it is drawn here, so there's nothing to redraw.
      const s = strokes.get(m.id);
      const i = m.at + 2;
      if (s && i < s.points.length && m.pressure > s.points[i]) s.points[i] = m.pressure;
      break;
    }
    case 'stroke:end': {
      const s = strokes.get(m.id);
      if (s && s.pageId === pageId) drawTail(ictx, s);
      break;
    }
    case 'stroke:delete':
      removeStrokesLocal(m.pageId, m.ids);
      if (m.pageId === pageId) requestRedraw();
      break;
    case 'page:add':
      board.pages.push(m.page);
      renderPages();
      break;
    case 'page:rename': {
      const p = board.pages.find((x) => x.id === m.id);
      if (p) p.name = m.name;
      renderPages();
      break;
    }
    case 'page:delete':
      deletePageLocal(m.id);
      break;
    case 'board:rename':
      setBoardTitle(m.title);
      break;
  }
}

// The server sends the whole board on every (re)connect. Take it, then put
// back our own changes it hasn't saved yet: ink drawn while offline, or sent
// just before the connection dropped. net.js sends those again right after.
function loadBoard(serverBoard) {
  const before = new Map(strokes); // what is on screen now
  const ours = (s) => s.id.startsWith(clientId + '-');
  setBoardTitle(serverBoard.title);
  board.pages = serverBoard.pages;
  strokes.clear();
  for (const p of board.pages) {
    // For our own strokes, keep the copy drawn here: it has every point,
    // including any the server hasn't got yet (and the stroke being drawn).
    p.strokes = p.strokes.map((s) => (ours(s) && before.get(s.id)) || s);
    for (const s of p.strokes) strokes.set(s.id, s);
  }
  for (const m of net.pending()) {
    switch (m.type) {
      case 'stroke:start':
      case 'stroke:add': {
        // Only if it's still on screen here (not erased since).
        const s = before.get(m.stroke.id);
        if (s) addStrokeLocal(s);
        break;
      }
      case 'stroke:delete':
        removeStrokesLocal(m.pageId, m.ids);
        break;
      case 'page:add':
        if (!board.pages.some((p) => p.id === m.page.id)) board.pages.push({ ...m.page, strokes: [] });
        break;
      case 'page:rename': {
        const p = board.pages.find((x) => x.id === m.id);
        if (p) p.name = m.name;
        break;
      }
      case 'page:delete':
        dropPage(m.id);
        break;
      case 'board:rename':
        setBoardTitle(m.title);
        break;
    }
  }
  if (!currentPage()) pageId = board.pages[0]?.id ?? null;
  renderPages();
  redraw();
}

// ---------- student link (tutor only) ----------
const shareBtn = document.getElementById('share');
let share = null;

function setShare(s) {
  share = s;
  shareBtn.textContent =
    s.status === 'on' ? 'Copy student link' : s.status === 'starting' ? 'Starting sharing…' : 'Sharing is off';
  shareBtn.classList.toggle('off', s.status !== 'on');
  shareBtn.title =
    s.status === 'on' ? 'Copy a link a student can open from anywhere. A new link is needed after a restart.'
    : s.status === 'starting' ? 'Connecting to Cloudflare…'
    : `Sharing is off: ${s.reason}`;
}

shareBtn.addEventListener('click', async () => {
  if (!share || share.status === 'starting') {
    toast('Sharing is still starting. Try again in a few seconds.');
    return;
  }
  if (share.status !== 'on') {
    toast(`Sharing is off: ${share.reason}`, 6000);
    return;
  }
  const link = `${share.url}/b/${boardId}`;
  if (await copyText(link)) toast(`Copied ${link}`, 4000);
  else prompt('Copy this link for your student:', link);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The clipboard API needs https or localhost; fall back to the old way.
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

// ---------- board title ----------
// Shown top-left; click to rename, Enter or click away to save, Esc to cancel.
const titleInput = document.getElementById('boardTitle');

function setBoardTitle(t) {
  board.title = t;
  document.title = `${t} – Tutor Board`;
  if (document.activeElement !== titleInput) titleInput.value = t;
}

titleInput.addEventListener('focus', () => titleInput.select());
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') titleInput.blur();
  else if (e.key === 'Escape') {
    titleInput.value = board.title;
    titleInput.blur();
  }
});
titleInput.addEventListener('blur', () => {
  const t = titleInput.value.trim();
  if (!t || t === board.title) {
    titleInput.value = board.title;
    return;
  }
  setBoardTitle(t.slice(0, 120));
  net.send({ type: 'board:rename', title: board.title });
});

function addStrokeLocal(s) {
  const page = board.pages.find((p) => p.id === s.pageId);
  if (!page || strokes.has(s.id)) return false;
  page.strokes.push(s);
  strokes.set(s.id, s);
  return true;
}

function removeStrokesLocal(pid, ids) {
  const page = board.pages.find((p) => p.id === pid);
  const set = new Set(ids);
  if (page) page.strokes = page.strokes.filter((s) => !set.has(s.id));
  for (const id of set) strokes.delete(id);
}

function dropPage(id) {
  const page = board.pages.find((p) => p.id === id);
  if (!page) return false;
  for (const s of page.strokes) strokes.delete(s.id);
  board.pages = board.pages.filter((p) => p !== page);
  views.delete(id);
  if (pageId === id) pageId = board.pages[0]?.id ?? null;
  return true;
}

function deletePageLocal(id) {
  if (!dropPage(id)) return;
  renderPages();
  redraw();
}

// ---------- rendering ----------
function resize() {
  dpr = window.devicePixelRatio || 1;
  for (const c of [ink, overlay]) {
    c.width = Math.round(innerWidth * dpr);
    c.height = Math.round(innerHeight * dpr);
    // Exactly the window's size. CSS 100vh can be taller than the visible
    // window in iPad Safari, which stretched the drawing below the pen.
    c.style.width = innerWidth + 'px';
    c.style.height = innerHeight + 'px';
  }
  redraw();
}

function applyView(ctx) {
  const v = view();
  ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
}

let redrawQueued = false;
function requestRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(redraw);
}

function redraw() {
  redrawQueued = false;
  ictx.setTransform(1, 0, 0, 1, 0, 0);
  ictx.fillStyle = '#fff';
  ictx.fillRect(0, 0, ink.width, ink.height);
  drawGrid();
  applyView(ictx);
  const page = currentPage();
  if (page) {
    const v = view();
    const x0 = toWorldX(0, v), y0 = toWorldY(0, v);
    const x1 = toWorldX(innerWidth, v), y1 = toWorldY(innerHeight, v);
    for (const s of page.strokes) {
      const b = strokeBounds(s);
      const m = maxHalfWidth(s);
      if (b.maxX + m < x0 || b.minX - m > x1 || b.maxY + m < y0 || b.minY - m > y1) continue;
      drawStroke(ictx, s);
    }
  }
  document.getElementById('zoom').textContent = Math.round(view().z * 100) + '%';
}

function drawGrid() {
  const v = view();
  let step = 32 * v.z;
  while (step < 14) step *= 2;
  const ox = ((v.x % step) + step) % step;
  const oy = ((v.y % step) + step) % step;
  const r = Math.max(1.5, 1.5 * dpr);
  ictx.fillStyle = '#d3d8e0';
  for (let x = ox; x < innerWidth; x += step) {
    for (let y = oy; y < innerHeight; y += step) {
      ictx.fillRect(x * dpr - r / 2, y * dpr - r / 2, r, r);
    }
  }
}

function clearOverlay() {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
}

// Draws the newest bit of the live stroke (from the last curve midpoint to the
// pen tip), plus the browser's predicted next points, on the overlay.
function drawLiveTip(predicted) {
  clearOverlay();
  const s = live?.stroke;
  if (!s) return;
  const p = s.points;
  const n = p.length / 3;
  if (!n) return;
  const v = view();
  const i = (n - 1) * 3;
  applyView(octx);
  octx.strokeStyle = s.color;
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  // A single point shows as the dot it will become (see dotWidth).
  octx.lineWidth = n === 1 ? dotWidth(s.size, p[2]) : widthAt(s.size, p[i + 2]);
  octx.beginPath();
  if (n >= 2) octx.moveTo((p[i - 3] + p[i]) / 2, (p[i - 2] + p[i + 1]) / 2);
  else octx.moveTo(p[0], p[1]);
  octx.lineTo(p[i], p[i + 1]);
  for (const e of predicted) octx.lineTo(toWorldX(e.clientX, v), toWorldY(e.clientY, v));
  octx.stroke();
}

function drawEraserCursor(cx, cy) {
  clearOverlay();
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.strokeStyle = '#6b7280';
  octx.lineWidth = 1;
  octx.beginPath();
  octx.arc(cx, cy, ERASER_RADIUS, 0, Math.PI * 2);
  octx.stroke();
}

// ---------- input ----------
// act = the current gesture: { kind: 'draw' | 'erase' | 'pan', pointerId, touch, ... }
let act = null;
// live = the stroke being drawn, how many of its numbers were already sent,
// and whether the last point sent has since got a higher pressure.
let live = null;
let spaceDown = false;
let lastRate = null;

const useRawUpdate = 'onpointerrawupdate' in window;

// Touch screens (SPEC R27, R35). Fingers on the canvas: pointerId -> { x, y }.
const touches = new Map();
// Two fingers pan and pinch zoom: { ids, x, y, d } = their midpoint and distance.
let pinch = null;
// After a pinch, or with the pen down, no finger starts anything until all are up.
let touchBlocked = false;

// Once a pen (Apple Pencil, Surface pen, Wacom) has been used on this device,
// one finger is probably a palm, so it only pans, and only with the Pan tool.
const PEN_KEY = 'tutorboard.penUsed';
let penUsed = false;
try {
  penUsed = localStorage.getItem(PEN_KEY) === '1';
} catch { /* storage blocked: treat as no pen yet */ }

function notePen(e) {
  if (penUsed || e.pointerType !== 'pen') return;
  penUsed = true;
  try {
    localStorage.setItem(PEN_KEY, '1');
  } catch { /* storage blocked: remember for this tab only */ }
}
// In pen mode one finger does nothing, which can be confusing, so a finger
// that drags far gets a hint (not for a resting palm, which hardly moves).
// Shown rarely, so it never gets in the way of writing.
const HINT_DISTANCE = 70; // CSS px the finger has to move
const HINT_GAP = 60_000; // ms between hints
const HINT_MAX = 3; // hints per page load
const BIG_CONTACT = 30; // px: a contact this big is probably a palm
let hintFinger = null; // { id, x, y }: where the ignored finger landed
let hintsShown = 0;
let lastHint = -Infinity;

function checkHint(e) {
  // Skip it while the pen is down, or for a big contact (if the device
  // reports contact size; most report 1 or 0 when they don't).
  if ((act && !act.touch) || Math.max(e.width || 0, e.height || 0) > BIG_CONTACT) {
    hintFinger = null;
    return;
  }
  const dx = e.clientX - hintFinger.x, dy = e.clientY - hintFinger.y;
  if (dx * dx + dy * dy < HINT_DISTANCE * HINT_DISTANCE) return;
  hintFinger = null;
  const now = performance.now();
  if (hintsShown >= HINT_MAX || now - lastHint < HINT_GAP) return;
  hintsShown++;
  lastHint = now;
  toast('Use two fingers to move the page (or pick Pan)', 3500);
}

// pointerover also fires when a pen starts hovering, so a Pencil counts even
// before it touches. (Not pointermove, to keep work out of the drawing path.)
window.addEventListener('pointerover', notePen, true);
window.addEventListener('pointerdown', notePen, true);

function capture(e) {
  try {
    overlay.setPointerCapture(e.pointerId);
  } catch { /* the pointer is already gone */ }
}

function pressureOf(e) {
  if (e.pointerType !== 'pen') return 0.5;
  return e.pressure > 0 ? e.pressure : 0.1;
}

function isEraserTip(e) {
  return e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
}

overlay.addEventListener('pointerdown', (e) => {
  if (!currentPage()) return;
  e.preventDefault();
  if (e.pointerType === 'touch') {
    touchDown(e);
    return;
  }
  if (act) {
    if (!act.touch) return;
    finishGesture(true); // the pen wins over fingers
  }
  // Fingers still on the screen (a resting hand) stay ignored until all are up.
  pinch = null;
  hintFinger = null;
  if (touches.size) touchBlocked = true;

  let kind;
  if (e.button === 1 || e.button === 2 || tool.mode === 'hand' || spaceDown) kind = 'pan';
  else if (isEraserTip(e) || tool.mode === 'eraser') kind = 'erase';
  else if (e.button === 0) kind = 'draw';
  else return;
  startGesture(e, kind);
});

function touchDown(e) {
  // The first finger down: nothing else is touching, so start from a clean slate.
  if (e.isPrimary) {
    if (act?.touch) finishGesture(true);
    touches.clear();
    pinch = null;
    touchBlocked = false;
    hintFinger = null;
  }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  capture(e);
  if (act && !act.touch) {
    touchBlocked = true; // fingers are ignored while the pen is down
    return;
  }
  if (touchBlocked || pinch) return; // a third finger is ignored
  if (touches.size === 2) {
    startPinch();
    return;
  }
  if (touches.size !== 1) return;
  if (tool.mode === 'hand' || spaceDown) startGesture(e, 'pan');
  else if (!penUsed) startGesture(e, tool.mode === 'eraser' ? 'erase' : 'draw');
  // Otherwise it's probably a palm, so it does nothing (but see checkHint).
  else if (hintsShown < HINT_MAX) hintFinger = { id: e.pointerId, x: e.clientX, y: e.clientY };
}

function startPinch() {
  // A finger stroke was the start of a pinch, not writing: cancel it.
  if (act) finishGesture(true);
  hintFinger = null;
  const [a, b] = touches.values();
  pinch = { ids: [...touches.keys()], x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}

// The page follows the midpoint of the two fingers and zooms around it.
function movePinch() {
  const a = touches.get(pinch.ids[0]);
  const b = touches.get(pinch.ids[1]);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const v = view();
  v.x += x - pinch.x;
  v.y += y - pinch.y;
  if (pinch.d > 0 && d > 0) zoomAt(x, y, d / pinch.d);
  pinch.x = x;
  pinch.y = y;
  pinch.d = d;
  requestRedraw();
}

function touchUp(e) {
  if (!touches.delete(e.pointerId)) return;
  if (hintFinger?.id === e.pointerId) hintFinger = null;
  if (pinch && pinch.ids.includes(e.pointerId)) {
    pinch = null;
    touchBlocked = true; // the finger left behind doesn't start drawing
  }
  if (!touches.size) touchBlocked = false;
}

function startGesture(e, kind) {
  capture(e);
  act = { kind, pointerId: e.pointerId, touch: e.pointerType === 'touch', lastX: e.clientX, lastY: e.clientY };

  if (kind === 'draw') {
    const s = { id: newId(), pageId, color: tool.color, size: tool.size, points: [] };
    addStrokeLocal(s);
    live = { stroke: s, sent: 0, raised: false };
    act.samples = 0;
    act.t0 = e.timeStamp;
    act.t1 = e.timeStamp;
    addPoint(e);
    net.send({ type: 'stroke:start', stroke: { ...s, points: s.points.slice() } });
    live.sent = s.points.length;
    drawLiveTip([]);
  } else if (kind === 'erase') {
    act.erased = [];
    eraseAt(e.clientX, e.clientY);
    drawEraserCursor(e.clientX, e.clientY);
  } else {
    overlay.style.cursor = 'grabbing';
  }
}

function addPoint(e) {
  const s = live.stroke;
  const v = view();
  const x = toWorldX(e.clientX, v);
  const y = toWorldY(e.clientY, v);
  const p = s.points;
  act.samples++;
  act.t1 = e.timeStamp;
  const n = p.length / 3;
  if (n > 0) {
    const dx = x - p[p.length - 3];
    const dy = y - p[p.length - 2];
    const min = 0.2 / v.z; // skip only exact repeats (< 0.2 screen px)
    if (dx * dx + dy * dy < min * min) {
      // The pen is still on the same spot. Keep the highest pressure seen
      // there: a light tap starts near 0 and only then presses harder.
      const pr = round(pressureOf(e), 1000);
      if (pr > p[p.length - 1]) {
        p[p.length - 1] = pr;
        // Already sent: flush() sends the new pressure too.
        if (p.length <= live.sent) live.raised = true;
      }
      return;
    }
  }
  p.push(round(x, 100), round(y, 100), round(pressureOf(e), 1000));
  if (n >= 1) drawSegment(ictx, s, n);
}

function samplesOf(e) {
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  return list.length ? list : [e];
}

function handleMove(e) {
  if (e.pointerType === 'touch' && !touchMove(e)) return;
  if (!act) {
    if (tool.mode === 'eraser' || isEraserTip(e)) drawEraserCursor(e.clientX, e.clientY);
    return;
  }
  if (e.pointerId !== act.pointerId) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) {
    endGesture(e);
    return;
  }

  if (act.kind === 'draw') {
    for (const ev of samplesOf(e)) addPoint(ev);
    queueFlush();
    if (useRawUpdate) drawLiveTip([]);
  } else if (act.kind === 'erase') {
    for (const ev of samplesOf(e)) eraseAt(ev.clientX, ev.clientY);
    drawEraserCursor(e.clientX, e.clientY);
  } else {
    const v = view();
    v.x += e.clientX - act.lastX;
    v.y += e.clientY - act.lastY;
    requestRedraw();
  }
  act.lastX = e.clientX;
  act.lastY = e.clientY;
}

// pointerrawupdate fires as soon as the pen reports, instead of once per frame.
// Use it for samples when available; pointermove still supplies predictions.
if (useRawUpdate) {
  overlay.addEventListener('pointerrawupdate', handleMove);
  overlay.addEventListener('pointermove', (e) => {
    if (act?.kind === 'draw' && e.pointerId === act.pointerId) {
      drawLiveTip(e.getPredictedEvents ? e.getPredictedEvents() : []);
    }
  });
} else {
  overlay.addEventListener('pointermove', (e) => {
    handleMove(e);
    if (act?.kind === 'draw' && e.pointerId === act.pointerId) {
      drawLiveTip(e.getPredictedEvents ? e.getPredictedEvents() : []);
    }
  });
}

// Keeps track of where each finger is. Returns true if this finger is the one
// running the current gesture, so handleMove should go on with it.
function touchMove(e) {
  const t = touches.get(e.pointerId);
  if (!t) return false;
  t.x = e.clientX;
  t.y = e.clientY;
  if (pinch) {
    if (pinch.ids.includes(e.pointerId)) movePinch();
    return false;
  }
  if (hintFinger?.id === e.pointerId) checkHint(e);
  return act?.pointerId === e.pointerId;
}

overlay.addEventListener('pointerup', endGesture);
overlay.addEventListener('pointercancel', endGesture);
overlay.addEventListener('contextmenu', (e) => e.preventDefault());

function endGesture(e) {
  if (e.pointerType === 'touch') touchUp(e);
  if (!act || e.pointerId !== act.pointerId) return;
  // iOS cancels a touch it decides was a palm or a system gesture, so a
  // cancelled finger stroke is thrown away. A cancelled pen stroke is kept.
  finishGesture(act.touch && e.type === 'pointercancel');
  if (tool.mode === 'eraser' && e.pointerType !== 'touch') drawEraserCursor(e.clientX, e.clientY);
}

// Ends the current gesture. With `cancel` (a finger stroke that turned into a
// pinch, was interrupted by the pen, or was cancelled by iOS), the stroke is
// removed here and for everyone else, and left out of undo. Strokes already
// erased stay erased and can be undone.
function finishGesture(cancel) {
  if (act.kind === 'draw') {
    const s = live.stroke;
    if (cancel) {
      // Sent after its start and points, so a resend after reconnecting
      // also ends with the stroke deleted.
      flush();
      removeStrokesLocal(s.pageId, [s.id]);
      net.send({ type: 'stroke:delete', pageId: s.pageId, ids: [s.id] });
      requestRedraw();
    } else {
      drawTail(ictx, s);
      flush();
      net.send({ type: 'stroke:end', id: s.id, pageId: s.pageId });
      pushUndo({ type: 'add', strokes: [s] });
      const secs = (act.t1 - act.t0) / 1000;
      if (secs > 0.15) {
        lastRate = Math.round((act.samples - 1) / secs);
        document.getElementById('rate').textContent = `pen ${lastRate} Hz`;
      }
    }
    live = null;
  } else if (act.kind === 'erase') {
    if (act.erased.length) pushUndo({ type: 'erase', strokes: act.erased });
  }
  act = null;
  clearOverlay();
  updateCursor();
}

// Send new points once per frame (every point is sent, just grouped).
let flushQueued = false;
function queueFlush() {
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(flush);
}
function flush() {
  flushQueued = false;
  if (!live) return;
  const s = live.stroke;
  if (live.raised) {
    // The last point sent got a higher pressure (see addPoint). Send that
    // first, so others have it before they draw the ink that uses it.
    live.raised = false;
    const at = live.sent - 3;
    net.send({ type: 'stroke:pressure', id: s.id, pageId: s.pageId, at, pressure: s.points[at + 2] });
  }
  sendPoints(s, live.sent);
  live.sent = s.points.length;
}

// Sends a stroke's points from index `from` on. `at` tells the server where
// they go, so a resend after reconnecting never doubles them up.
function sendPoints(s, from) {
  const p = s.points;
  for (let i = from; i < p.length; i += CHUNK) {
    net.send({ type: 'stroke:points', id: s.id, pageId: s.pageId, at: i, points: p.slice(i, i + CHUNK) });
  }
}

// Sends a whole stroke (undo/redo): one message, or several if it's very long.
function sendStroke(s) {
  if (s.points.length <= CHUNK) {
    net.send({ type: 'stroke:add', stroke: s });
    return;
  }
  net.send({ type: 'stroke:start', stroke: { ...s, points: s.points.slice(0, CHUNK) } });
  sendPoints(s, CHUNK);
  net.send({ type: 'stroke:end', id: s.id, pageId: s.pageId });
}

function eraseAt(cx, cy) {
  const v = view();
  const x = toWorldX(cx, v), y = toWorldY(cy, v);
  const r = ERASER_RADIUS / v.z;
  const page = currentPage();
  const hit = page.strokes.filter((s) => s !== live?.stroke && hitStroke(s, x, y, r));
  if (!hit.length) return;
  const ids = hit.map((s) => s.id);
  removeStrokesLocal(pageId, ids);
  act.erased.push(...hit);
  net.send({ type: 'stroke:delete', pageId, ids });
  requestRedraw();
}

// Wheel scrolls the canvas; Ctrl+wheel (and trackpad pinch) zooms.
overlay.addEventListener('wheel', (e) => {
  e.preventDefault();
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const v = view();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * scale * 0.01));
  else {
    v.x -= e.deltaX * scale;
    v.y -= e.deltaY * scale;
  }
  requestRedraw();
}, { passive: false });

function zoomAt(cx, cy, factor) {
  const v = view();
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * factor));
  const k = z / v.z;
  v.x = cx - (cx - v.x) * k;
  v.y = cy - (cy - v.y) * k;
  v.z = z;
}

function fitView() {
  const page = currentPage();
  const b = page && pageBounds(page.strokes);
  const v = view();
  if (!b) {
    v.x = 0; v.y = 0; v.z = 1;
  } else {
    const pad = 80;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    v.z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((innerWidth - pad * 2) / w, (innerHeight - pad * 2) / h, 2)));
    v.x = innerWidth / 2 - ((b.minX + b.maxX) / 2) * v.z;
    v.y = innerHeight / 2 - ((b.minY + b.maxY) / 2) * v.z;
  }
  redraw();
}

function updateCursor() {
  overlay.style.cursor = tool.mode === 'hand' || spaceDown ? 'grab' : tool.mode === 'eraser' ? 'none' : 'crosshair';
}

// ---------- undo / redo ----------
// Each entry: { type: 'add' | 'erase', strokes }. Undo of 'add' removes them;
// undo of 'erase' puts them back. Redo does the opposite.
function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > 500) undoStack.shift();
  redoStack.length = 0;
}

function removeAndSend(list) {
  const byPage = new Map();
  for (const s of list) {
    if (!strokes.has(s.id)) continue;
    if (!byPage.has(s.pageId)) byPage.set(s.pageId, []);
    byPage.get(s.pageId).push(s.id);
  }
  for (const [pid, ids] of byPage) {
    removeStrokesLocal(pid, ids);
    for (let i = 0; i < ids.length; i += 5000) {
      net.send({ type: 'stroke:delete', pageId: pid, ids: ids.slice(i, i + 5000) });
    }
  }
}

function addAndSend(list) {
  for (const s of list) {
    if (addStrokeLocal(s)) sendStroke(s);
  }
}

function undo() {
  if (act) return;
  const a = undoStack.pop();
  if (!a) return;
  if (a.type === 'add') removeAndSend(a.strokes);
  else addAndSend(a.strokes);
  redoStack.push(a);
  requestRedraw();
}

function redo() {
  if (act) return;
  const a = redoStack.pop();
  if (!a) return;
  if (a.type === 'add') addAndSend(a.strokes);
  else removeAndSend(a.strokes);
  undoStack.push(a);
  requestRedraw();
}

function clearPage() {
  const page = currentPage();
  if (!page || !page.strokes.length) return;
  const list = page.strokes.slice();
  removeAndSend(list);
  pushUndo({ type: 'erase', strokes: list });
  redraw();
  toast('Page cleared – Ctrl+Z to undo');
}

// ---------- pages ----------
function renderPages() {
  const el = document.getElementById('pages');
  el.innerHTML = '';
  for (const p of board.pages) {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.title = 'Double-click to rename';
    b.classList.toggle('active', p.id === pageId);
    b.onclick = () => switchPage(p.id);
    b.ondblclick = () => renamePage(p);
    el.appendChild(b);
  }
  document.getElementById('deletePage').disabled = board.pages.length <= 1;
}

function switchPage(id) {
  if (act || id === pageId) return;
  pageId = id;
  renderPages();
  redraw();
}

function addPage() {
  let n = board.pages.length + 1;
  while (board.pages.some((p) => p.name === `Page ${n}`)) n++;
  const page = { id: newId(), name: `Page ${n}`, strokes: [] };
  board.pages.push(page);
  net.send({ type: 'page:add', page: { id: page.id, name: page.name } });
  switchPage(page.id);
}

function renamePage(p) {
  const name = prompt('Page name', p.name);
  if (!name || !name.trim()) return;
  p.name = name.trim().slice(0, 80);
  net.send({ type: 'page:rename', id: p.id, name: p.name });
  renderPages();
}

function deletePage() {
  const page = currentPage();
  if (!page || board.pages.length <= 1) return;
  if (!confirm(`Delete "${page.name}"? This can't be undone.`)) return;
  net.send({ type: 'page:delete', id: page.id });
  deletePageLocal(page.id);
}

// ---------- export ----------
function exportPage() {
  const page = currentPage();
  const b = page && pageBounds(page.strokes);
  if (!b) {
    toast('Nothing to export on this page');
    return;
  }
  const pad = 48;
  const minX = b.minX - pad, minY = b.minY - pad;
  const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
  const scale = Math.min(3, 8192 / w, 8192 / h);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
  for (const s of page.strokes) drawStroke(x, s);
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = `${board.title}_${page.name}`.replace(/[^\w\- ]+/g, '').trim();
    a.download = `${name || 'page'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

// ---------- toolbar ----------
function setTool(mode) {
  tool.mode = mode;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === mode);
  if (mode !== 'eraser') clearOverlay();
  updateCursor();
}

function setColor(c) {
  tool.color = c;
  for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('active', b.dataset.color === c);
  if (tool.mode !== 'pen') setTool('pen');
}

function setSize(sz) {
  tool.size = sz;
  for (const b of document.querySelectorAll('.size')) b.classList.toggle('active', Number(b.dataset.size) === sz);
  if (tool.mode !== 'pen') setTool('pen');
}

function buildToolbar() {
  const colors = document.getElementById('colors');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = c;
    b.style.setProperty('--c', c);
    b.title = c;
    b.onclick = () => setColor(c);
    colors.appendChild(b);
  }
  const sizes = document.getElementById('sizes');
  for (const sz of SIZES) {
    const b = document.createElement('button');
    b.className = 'size';
    b.dataset.size = sz;
    b.title = `Size ${sz}`;
    const dot = document.createElement('i');
    const d = Math.max(3, sz * 1.4);
    dot.style.width = dot.style.height = d + 'px';
    b.appendChild(dot);
    b.onclick = () => setSize(sz);
    sizes.appendChild(b);
  }
  for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
  document.getElementById('undo').onclick = undo;
  document.getElementById('redo').onclick = redo;
  document.getElementById('fit').onclick = fitView;
  document.getElementById('clear').onclick = clearPage;
  document.getElementById('export').onclick = exportPage;
  document.getElementById('addPage').onclick = addPage;
  document.getElementById('deletePage').onclick = deletePage;
  document.getElementById('zoom').onclick = () => {
    zoomAt(innerWidth / 2, innerHeight / 2, 1 / view().z);
    redraw();
  };
  setTool('pen');
  setColor(tool.color);
  setSize(tool.size);
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (mod) return;
  else if (k === 'p') setTool('pen');
  else if (k === 'e') setTool('eraser');
  else if (k === 'h') setTool('hand');
  else if (k === 'f') fitView();
  else if (e.code === 'Space' && !spaceDown) { spaceDown = true; updateCursor(); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; updateCursor(); }
});

let toastTimer;
function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

window.addEventListener('resize', resize);
buildToolbar();
resize();

// ---------- debug mode ----------
// Add ?debug to a board link to see what the browser reports for each finger
// and pen: a ring where it says the pointer is (as big as the contact, if the
// device reports that), the latest events with what the app did, and the
// window sizes. For checking touch input on a real iPad. Nothing here runs
// without ?debug.
if (new URLSearchParams(location.search).has('debug')) startDebug();

function startDebug() {
  const panel = document.createElement('pre');
  panel.id = 'debug';
  document.body.appendChild(panel);
  // Measures what CSS 100vh means on this device.
  const vhProbe = document.createElement('div');
  vhProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden';
  document.body.appendChild(vhProbe);

  const pointers = new Map(); // pointerId -> latest event
  const rings = new Map(); // pointerId -> ring element
  const log = []; // newest first
  let queued = false;

  const n = (v) => Math.round(v);
  const describe = (e) =>
    `${e.pointerType} #${e.pointerId} at ${n(e.clientX)},${n(e.clientY)} size ${n(e.width)}x${n(e.height)} pressure ${e.pressure.toFixed(2)}`;
  const target = (e) => (e.target === overlay ? 'canvas' : e.target.id || e.target.tagName?.toLowerCase() || '?');
  const state = () =>
    `gesture ${act ? act.kind + (act.touch ? ' (finger)' : '') : 'none'} · pinch ${pinch ? 'yes' : 'no'}` +
    ` · fingers ${touches.size}${touchBlocked ? ' (ignored until all up)' : ''}`;

  function onEvent(e) {
    const gone = e.type === 'pointerup' || e.type === 'pointercancel' || (e.type === 'pointerout' && !e.relatedTarget);
    if (gone) {
      pointers.delete(e.pointerId);
      rings.get(e.pointerId)?.remove();
      rings.delete(e.pointerId);
    } else if (e.type !== 'pointerout') {
      pointers.set(e.pointerId, e);
    }
    if (e.type === 'pointerdown' || e.type === 'pointerup' || e.type === 'pointercancel') {
      // Listening on window after the canvas, so this is the state after the app handled it.
      log.unshift(`${e.type.slice(7)} ${describe(e)} on ${target(e)} → ${state()}`);
      log.length = Math.min(log.length, 12);
    }
    queueRender();
  }
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout']) {
    window.addEventListener(t, onEvent);
  }
  window.addEventListener('resize', queueRender);
  window.visualViewport?.addEventListener('resize', queueRender);
  window.visualViewport?.addEventListener('scroll', queueRender);

  function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  function render() {
    queued = false;
    const vv = window.visualViewport;
    const c = ink.getBoundingClientRect();
    panel.textContent = [
      `window ${innerWidth}x${innerHeight} · CSS 100vh = ${vhProbe.offsetHeight}px · dpr ${dpr}`,
      `canvas ${n(c.width)}x${n(c.height)} at ${n(c.left)},${n(c.top)}`,
      vv ? `visual viewport ${n(vv.width)}x${n(vv.height)} at ${n(vv.offsetLeft)},${n(vv.offsetTop)} · scale ${vv.scale.toFixed(2)}` : 'no visualViewport',
      `pen used on this device: ${penUsed ? 'yes' : 'no'} · tool ${tool.mode} · board ${boardId}`,
      state(),
      '',
      ...[...pointers.values()].map(describe),
      '',
      ...log,
    ].join('\n');
    for (const [id, e] of pointers) {
      let ring = rings.get(id);
      if (!ring) {
        ring = document.createElement('div');
        ring.className = 'debug-ring';
        ring.style.color = e.pointerType === 'pen' ? '#d62d2d' : e.pointerType === 'touch' ? '#1f5fd1' : '#6b7280';
        document.body.appendChild(ring);
        rings.set(id, ring);
      }
      const size = Math.max(16, e.width || 0, e.height || 0);
      ring.style.width = ring.style.height = size + 'px';
      ring.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
    }
  }
  queueRender();
}
