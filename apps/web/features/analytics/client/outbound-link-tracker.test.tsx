// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { trackOutboundLinks } from "./outbound-link-tracker";
import { recordProductEventV1 } from "./product-event-client";

vi.mock("./product-event-client", () => ({ recordProductEventV1: vi.fn().mockResolvedValue(true) }));
const stop: Array<() => void> = [];
afterEach(() => { stop.splice(0).forEach(cleanup => cleanup()); document.body.innerHTML = ""; vi.clearAllMocks(); });
function start(path = "/runmusic") { stop.push(trackOutboundLinks(document, path)); }
function setup() {
  document.body.innerHTML = '<main><section data-outbound-campaign="runmusic" data-outbound-placement="fanpage_hero"><a href="https://tickets.example/entry?q=a%20b#seat" data-outbound-kind="ticket"><span>Book</span></a></section></main><footer><a href="https://social.example/profile">Social</a></footer>';
  return document.querySelector("a")!;
}

describe("global outbound tracking", () => {
  it("decorates anchors, preserves ordinary navigation, and records one event for keyboard click or middle click", () => {
    const anchor = setup(); start();
    expect(anchor.href).toContain("q=a%20b&utm_source=byus");
    expect(anchor.href).toContain("utm_campaign=runmusic");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 0 });
    anchor.querySelector("span")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(recordProductEventV1).toHaveBeenCalledTimes(1);
    anchor.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    anchor.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(recordProductEventV1).toHaveBeenCalledTimes(2);
    expect(recordProductEventV1).toHaveBeenCalledWith(expect.objectContaining({ eventName: "outbound_link_click", source: "web.outbound", properties: { campaign: "runmusic", placement: "fanpage_hero", linkKind: "ticket", destinationHost: "tickets.example" } }));
    expect(JSON.stringify(vi.mocked(recordProductEventV1).mock.calls)).not.toMatch(/q=|#seat|https:|Book/);
  });
  it("decorates inserted and changed links and restores only owned changes on SPA cleanup", async () => {
    const anchor = setup(); start();
    const dynamic = document.createElement("a"); dynamic.href = "https://other.example/?utm_source=partner"; document.body.append(dynamic);
    await waitFor(() => expect(dynamic.href).toContain("utm_campaign=runmusic"));
    anchor.setAttribute("href", "https://changed.example/path");
    await waitFor(() => expect(anchor.href).toContain("utm_source=byus"));
    stop.pop()!();
    expect(anchor.getAttribute("href")).toBe("https://changed.example/path");
    expect(dynamic.getAttribute("href")).toBe("https://other.example/?utm_source=partner");
    start("/community");
    expect(anchor.href).toContain("utm_campaign=community");
    expect(anchor.href).not.toContain("utm_campaign=runmusic");
  });
  it("skips opt-out, downloads, canceled actions and admin pages", async () => {
    const anchor = setup(); anchor.dataset.outboundTracking = "off"; start();
    expect(anchor.href).not.toContain("utm_");
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(recordProductEventV1).not.toHaveBeenCalled();
    delete anchor.dataset.outboundTracking; anchor.setAttribute("download", "ticket");
    await waitFor(() => expect(anchor.href).not.toContain("utm_"));
    stop.pop()!(); start("/admin");
    expect(document.querySelector("footer a")?.getAttribute("href")).toBe("https://social.example/profile");
    stop.pop()!(); anchor.removeAttribute("download"); start();
    anchor.addEventListener("click", event => event.preventDefault(), { once: true });
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(recordProductEventV1).not.toHaveBeenCalled();
  });
  it("continues navigation when analytics fails synchronously", () => {
    const anchor = setup(); start(); vi.mocked(recordProductEventV1).mockImplementationOnce(() => { throw new Error("storage blocked"); });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(() => anchor.dispatchEvent(click)).not.toThrow();
    expect(click.defaultPrevented).toBe(false);
  });
});
