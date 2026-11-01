// Stroke drawing. A stroke's points are a flat array: [x, y, pressure, x, y, pressure, ...]
// in world coordinates. Strokes are drawn as smooth curves through the midpoints
// of consecutive samples, so every sample shapes the line and nothing is dropped.

export function widthAt(size, pressure) {
  return size * (0.3 + 1.4 * pressure); // pressure 0.5 (mouse) -> exactly `size`
}

export function setStyle(ctx, s) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// Draws the piece of curve that becomes known once point k (k >= 1) arrives.
export function drawSegment(ctx, s, k) {
  const p = s.points;
  const i = k * 3;
  setStyle(ctx, s);
  ctx.beginPath();
  if (k === 1) {
    ctx.lineWidth = widthAt(s.size, (p[2] + p[5]) / 2);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo((p[0] + p[3]) / 2, (p[1] + p[4]) / 2);
  } else {
    const ax = p[i - 6], ay = p[i - 5];
    const bx = p[i - 3], by = p[i - 2];
    const cx = p[i], cy = p[i + 1];
    ctx.lineWidth = widthAt(s.size, p[i - 1]);
    ctx.moveTo((ax + bx) / 2, (ay + by) / 2);
    ctx.quadraticCurveTo(bx, by, (bx + cx) / 2, (by + cy) / 2);
  }
  ctx.stroke();
}

// Finishes a stroke: the last half-segment, or a dot for a single tap.
export function drawTail(ctx, s) {
  const p = s.points;
  const n = p.length / 3;
  if (n === 0) return;
  setStyle(ctx, s);
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], widthAt(s.size, p[2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const i = (n - 1) * 3;
  ctx.lineWidth = widthAt(s.size, p[i + 2]);
  ctx.beginPath();
  ctx.moveTo((p[i - 3] + p[i]) / 2, (p[i - 2] + p[i + 1]) / 2);
  ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

export function drawStroke(ctx, s) {
  const n = s.points.length / 3;
  for (let k = 1; k < n; k++) drawSegment(ctx, s, k);
  drawTail(ctx, s);
}

// ---------- geometry ----------

const boundsCache = new WeakMap();

// Bounding box of the stroke's sample points (grows as points are appended).
export function strokeBounds(s) {
  let b = boundsCache.get(s);
  if (!b || b.n > s.points.length) {
    b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, n: 0 };
    boundsCache.set(s, b);
  }
  const p = s.points;
  for (let i = b.n; i < p.length; i += 3) {
    if (p[i] < b.minX) b.minX = p[i];
    if (p[i] > b.maxX) b.maxX = p[i];
    if (p[i + 1] < b.minY) b.minY = p[i + 1];
    if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
  }
  b.n = p.length;
  return b;
}

export const maxHalfWidth = (s) => widthAt(s.size, 1) / 2;

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

// True if a circle of radius r at (x, y) touches the stroke.
export function hitStroke(s, x, y, r) {
  const b = strokeBounds(s);
  const m = r + maxHalfWidth(s);
  if (x < b.minX - m || x > b.maxX + m || y < b.minY - m || y > b.maxY + m) return false;
  const p = s.points;
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= r + widthAt(s.size, p[2]) / 2;
  for (let i = 3; i < p.length; i += 3) {
    const d = distToSegment(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]);
    if (d <= r + widthAt(s.size, p[i + 2]) / 2) return true;
  }
  return false;
}

// Bounds of everything on a page, including line widths. Null if empty.
export function pageBounds(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    if (!s.points.length) continue;
    const b = strokeBounds(s);
    const m = maxHalfWidth(s);
    minX = Math.min(minX, b.minX - m);
    minY = Math.min(minY, b.minY - m);
    maxX = Math.max(maxX, b.maxX + m);
    maxY = Math.max(maxY, b.maxY + m);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
