/** Small, bounded decorative simulation. All coordinates are local CSS pixels. */
export type Marble = { x: number; y: number; vx: number; vy: number };
export type MarbleInteraction = {
  heldIndex?: number | null;
  drag?: { index: number; x: number; y: number } | null;
  pointer?: { x: number; y: number; vx: number; vy: number } | null;
};

export const MARBLE_SIZE = 44;
const COLLISION_DISTANCE = 46;
const RESTING_SPEED = 7;
const MAX_SPEED = 180;
const DRAG_FOLLOW_RATE = 16;
const RELEASE_DAMPING_RATE = 3;
const POINTER_RADIUS = 110;
const POINTER_COUPLING = .08;
const WANDER_RATE = .32;

export function createMarbles(count: number, width: number, height: number): Marble[] {
  const cx = width / 2, cy = height / 2, rx = Math.max(1, cx - 26), ry = Math.max(1, cy - 26);
  const spots: { x: number; y: number }[] = [];
  for (let row = -5; row <= 5; row++) for (let col = -5; col <= 5; col++) {
    const x = col * 48 + (Math.abs(row) % 2) * 24, y = row * 42;
    if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) spots.push({ x, y });
  }
  spots.sort((a, b) => a.x ** 2 + a.y ** 2 - b.x ** 2 - b.y ** 2);
  return spots.slice(0, count).map((spot, i) => ({ x: spot.x + cx, y: spot.y + cy, vx: Math.cos(i * 2.399 + .7) * RESTING_SPEED, vy: Math.sin(i * 2.399 + .7) * RESTING_SPEED }));
}

function validIndex(index: number | null | undefined, length: number): index is number {
  return Number.isInteger(index) && index! >= 0 && index! < length;
}

function clampSpeed(body: Marble) {
  const speed = Math.hypot(body.vx, body.vy);
  if (!Number.isFinite(speed)) { body.vx = 0; body.vy = 0; return; }
  if (speed > MAX_SPEED) { body.vx *= MAX_SPEED / speed; body.vy *= MAX_SPEED / speed; }
}

function projectToEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  const dx = Number.isFinite(x) ? x - cx : 0, dy = Number.isFinite(y) ? y - cy : 0;
  const edge = Math.hypot(dx / rx, dy / ry);
  return edge > 1 ? { x: cx + dx / edge, y: cy + dy / edge } : { x: cx + dx, y: cy + dy };
}

export function stepMarbles(
  bodies: Marble[], width: number, height: number, seconds: number, interaction: MarbleInteraction = {},
) {
  const dt = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .04));
  const cx = width / 2, cy = height / 2, rx = Math.max(1, cx - 26), ry = Math.max(1, cy - 26);
  const dragIndex = validIndex(interaction.drag?.index, bodies.length) ? interaction.drag.index : null;
  const heldIndex = dragIndex === null && validIndex(interaction.heldIndex, bodies.length) ? interaction.heldIndex : null;
  const fixedIndex = dragIndex ?? heldIndex;
  const pointer = interaction.pointer;
  const pointerMoving = pointer && Number.isFinite(pointer.x + pointer.y + pointer.vx + pointer.vy)
    && Math.hypot(pointer.vx, pointer.vy) > .01;

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i]!;
    if (![body.x, body.y, body.vx, body.vy].every(Number.isFinite)) {
      body.x = cx; body.y = cy; body.vx = 0; body.vy = 0;
    }
    if (i === heldIndex) { body.vx = 0; body.vy = 0; continue; }
    if (i === dragIndex && interaction.drag) {
      const target = projectToEllipse(interaction.drag.x, interaction.drag.y, cx, cy, rx, ry);
      const follow = 1 - Math.exp(-DRAG_FOLLOW_RATE * dt);
      const wantedX = (target.x - body.x) * follow, wantedY = (target.y - body.y) * follow;
      const wantedDistance = Math.hypot(wantedX, wantedY);
      const allowedDistance = MAX_SPEED * dt;
      const scale = wantedDistance > allowedDistance && wantedDistance > 0 ? allowedDistance / wantedDistance : 1;
      const dx = wantedX * scale, dy = wantedY * scale;
      body.x += dx; body.y += dy;
      body.vx = dt > 0 ? dx / dt : 0; body.vy = dt > 0 ? dy / dt : 0;
      continue;
    }

    let speed = Math.hypot(body.vx, body.vy);
    if (speed < .001) {
      const angle = i * 2.399 + .7;
      body.vx = Math.cos(angle) * RESTING_SPEED;
      body.vy = Math.sin(angle) * RESTING_SPEED;
      speed = RESTING_SPEED;
    } else {
      const targetSpeed = speed + (RESTING_SPEED - speed) * (1 - Math.exp(-RELEASE_DAMPING_RATE * dt));
      body.vx *= targetSpeed / speed; body.vy *= targetSpeed / speed;
      const turn = Math.sin(body.x * .021 + body.y * .017 + i * 1.71) * WANDER_RATE * dt;
      const cos = Math.cos(turn), sin = Math.sin(turn), vx = body.vx, vy = body.vy;
      body.vx = vx * cos - vy * sin; body.vy = vx * sin + vy * cos;
    }
    if (pointerMoving && pointer && i !== fixedIndex) {
      const distance = Math.hypot(body.x - pointer.x, body.y - pointer.y);
      if (distance < POINTER_RADIUS) {
        const strength = (1 - distance / POINTER_RADIUS) * POINTER_COUPLING * dt;
        body.vx += pointer.vx * strength; body.vy += pointer.vy * strength;
      }
    }
    clampSpeed(body);
    body.x += body.vx * dt; body.y += body.vy * dt;
  }

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!, b = bodies[j]!;
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      if (distance >= COLLISION_DISTANCE) continue;
      const angle = ((i + 1) * .754877666 + (j + 1) * .569840291) * Math.PI * 2;
      const nx = distance < .001 ? Math.cos(angle) : dx / distance;
      const ny = distance < .001 ? Math.sin(angle) : dy / distance;
      const overlap = COLLISION_DISTANCE - distance;
      const aFixed = i === fixedIndex, bFixed = j === fixedIndex;
      if (!aFixed && !bFixed) {
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
      } else if (aFixed && !bFixed) {
        b.x += nx * overlap; b.y += ny * overlap;
      } else if (!aFixed && bFixed) {
        a.x -= nx * overlap; a.y -= ny * overlap;
      }
      const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (approach > 0) {
        if (!aFixed && !bFixed) {
          a.vx -= approach * nx; a.vy -= approach * ny;
          b.vx += approach * nx; b.vy += approach * ny;
        } else if (aFixed && !bFixed) {
          b.vx += 2 * approach * nx; b.vy += 2 * approach * ny;
        } else if (!aFixed && bFixed) {
          a.vx -= 2 * approach * nx; a.vy -= 2 * approach * ny;
        }
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      if (i === fixedIndex) continue;
      const x = (body.x - cx) / rx, y = (body.y - cy) / ry, edge = Math.hypot(x, y);
      if (edge <= 1) continue;
      body.x = cx + (body.x - cx) / edge; body.y = cy + (body.y - cy) / edge;
      const normal = Math.hypot(x / rx, y / ry), nx = x / rx / normal, ny = y / ry / normal;
      const outward = body.vx * nx + body.vy * ny;
      if (outward > 0) { body.vx -= 2 * outward * nx; body.vy -= 2 * outward * ny; }
    }
  }
  for (const body of bodies) clampSpeed(body);
}
