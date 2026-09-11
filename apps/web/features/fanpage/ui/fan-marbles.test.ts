import { expect, it } from "vitest";
import { createMarbles, stepMarbles } from "./fan-marbles";
it.each([[244,400], [246,400], [266,400], [306,350], [430,350]])("keeps all 24 fan circles finite and contained through a minute at %sx%s", (width, height) => {
  const bodies = createMarbles(24, width, height);
  expect(bodies).toHaveLength(24);
  for (let frame = 0; frame < 3600; frame++) stepMarbles(bodies, width, height, 1/60);
  for (const body of bodies) {
    expect(Number.isFinite(body.x + body.y)).toBe(true);
    expect(body.x).toBeGreaterThanOrEqual(22); expect(body.x).toBeLessThanOrEqual(width - 22);
    expect(body.y).toBeGreaterThanOrEqual(22); expect(body.y).toBeLessThanOrEqual(height - 22);
  }
  for (let i = 0; i < bodies.length; i++) for (let j = i+1; j < bodies.length; j++) {
    expect(Math.hypot(bodies[i]!.x-bodies[j]!.x,bodies[i]!.y-bodies[j]!.y)).toBeGreaterThan(43);
  }
});
it("uses actual fan cardinality including empty and single fan states", () => {
  expect(createMarbles(0,306,350)).toEqual([]);
  expect(createMarbles(1,306,350)).toHaveLength(1);
});

it("keeps a held marble fixed while collisions move its neighbors", () => {
  const bodies = [
    { x: 153, y: 175, vx: 7, vy: 0 },
    { x: 183, y: 175, vx: -7, vy: 0 },
  ];
  const held = { x: bodies[0]!.x, y: bodies[0]!.y };
  const neighborStart = bodies[1]!.x;
  stepMarbles(bodies, 306, 350, 1 / 60, { heldIndex: 0 });
  expect(bodies[0]!.x).toBeCloseTo(held.x, 10);
  expect(bodies[0]!.y).toBeCloseTo(held.y, 10);
  expect(bodies[0]!.vx).toBe(0);
  expect(bodies[1]!.x).toBeGreaterThan(neighborStart);
  expect(Math.hypot(bodies[0]!.x - bodies[1]!.x, bodies[0]!.y - bodies[1]!.y)).toBeGreaterThan(45.9);
});

it("follows a bounded drag target, then gradually settles near seven pixels per second", () => {
  const bodies = createMarbles(1, 306, 350);
  const startX = bodies[0]!.x;
  for (let frame = 0; frame < 15; frame++) {
    stepMarbles(bodies, 306, 350, 1 / 60, { heldIndex: 0, drag: { index: 0, x: 900, y: -400 } });
  }
  expect(bodies[0]!.x).toBeGreaterThan(startX);
  const ellipseDistance = Math.hypot((bodies[0]!.x - 153) / 127, (bodies[0]!.y - 175) / 149);
  expect(ellipseDistance).toBeLessThanOrEqual(1.000001);
  const releasedSpeed = Math.hypot(bodies[0]!.vx, bodies[0]!.vy);
  for (let frame = 0; frame < 180; frame++) stepMarbles(bodies, 306, 350, 1 / 60);
  const settledSpeed = Math.hypot(bodies[0]!.vx, bodies[0]!.vy);
  expect(settledSpeed).toBeLessThan(releasedSpeed);
  expect(settledSpeed).toBeCloseTo(7, 1);
});

it("applies pointer momentum locally, excludes held targets, and clamps speed", () => {
  const base = [
    { x: 153, y: 175, vx: 7, vy: 0 },
    { x: 40, y: 175, vx: 7, vy: 0 },
    { x: 153, y: 80, vx: 7, vy: 0 },
  ];
  const influenced = structuredClone(base);
  const control = structuredClone(base);
  const pointer = { x: 153, y: 175, vx: 100_000, vy: 0 };
  stepMarbles(influenced, 306, 350, 1 / 60, { heldIndex: 2, pointer });
  stepMarbles(control, 306, 350, 1 / 60, { heldIndex: 2 });
  expect(influenced[0]!.vx).toBeGreaterThan(control[0]!.vx);
  expect(influenced[1]!.vx).toBeCloseTo(control[1]!.vx, 10);
  expect(influenced[2]).toEqual(control[2]);
  expect(Math.hypot(influenced[0]!.vx, influenced[0]!.vy)).toBeLessThanOrEqual(180.000001);
});

it("separates a zero-distance collision without producing non-finite state", () => {
  const bodies = [
    { x: 153, y: 175, vx: 0, vy: 0 },
    { x: 153, y: 175, vx: 0, vy: 0 },
  ];
  stepMarbles(bodies, 306, 350, 1 / 60);
  expect(bodies.every((body) => [body.x, body.y, body.vx, body.vy].every(Number.isFinite))).toBe(true);
  expect(Math.hypot(bodies[0]!.x - bodies[1]!.x, bodies[0]!.y - bodies[1]!.y)).toBeGreaterThan(45.9);
});
