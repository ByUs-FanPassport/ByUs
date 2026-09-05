import { describe, expect, it } from "vitest";
import { isMainCreator, orderCreatorsForDiscovery } from "./creator-discovery";
const item = (slug: string, fanCount: number, displayOrder = 10) => ({ slug, fanCount, displayOrder });
describe("editorial creator discovery", () => {
  it("keeps the three leads ahead of even a larger new audience without mutating input", () => {
    const input = [item("new", 99_000_000), item("yuna", 3), item("changha", 21), item("elina", 12)];
    expect(orderCreatorsForDiscovery(input).map(c => c.slug)).toEqual(["changha", "elina", "yuna", "new"]);
    expect(input[0].slug).toBe("new");
  });
  it("orders additional creators by audience with stable editorial ties", () => {
    expect(orderCreatorsForDiscovery([item("b", 10, 20), item("a", 10, 10), item("c", 30)]).map(c => c.slug)).toEqual(["c", "a", "b"]);
  });
  it("does not promote an arbitrary creator when a lead is absent", () => {
    expect(isMainCreator("new")).toBe(false);
    expect(orderCreatorsForDiscovery([item("new", 99), item("yuna", 1)]).map(c => c.slug)).toEqual(["yuna", "new"]);
  });
});

it("supports thirteen creators without removing anyone or changing lead membership", () => {
  const input = [item("elina", 1), item("changha", 2), item("yuna", 3), ...Array.from({length:10}, (_,i) => item(`new-${i}`, i * 100))];
  const result = orderCreatorsForDiscovery(input);
  expect(result).toHaveLength(13);
  expect(result.slice(0,3).map(c=>c.slug)).toEqual(["changha","elina","yuna"]);
  expect(new Set(result.map(c=>c.slug)).size).toBe(13);
});
