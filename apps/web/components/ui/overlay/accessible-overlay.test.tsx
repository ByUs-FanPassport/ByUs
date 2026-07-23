import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibleOverlay } from "./accessible-overlay";

function Harness() {
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return <div data-testid="application">
    <button type="button" onClick={() => setDrawer(true)}>Open drawer</button>
    {drawer && <AccessibleOverlay open onClose={() => setDrawer(false)} labelledBy="drawer-title" backdropClassName="backdrop" contentClassName="drawer">
      <h2 id="drawer-title">Drawer</h2>
      <button type="button" data-autofocus hidden>Hidden autofocus</button>
      <button type="button" style={{ display: "none" }}>Display none</button>
      <button type="button" aria-hidden="true">Aria hidden</button>
      <button type="button" data-autofocus onClick={() => setConfirm(true)}>Retry</button>
      <button type="button" onClick={() => setDrawer(false)}>Close drawer</button>
    </AccessibleOverlay>}
    {confirm && <AccessibleOverlay open onClose={() => setConfirm(false)} labelledBy="confirm-title" describedBy="confirm-description" role="alertdialog" backdropClassName="backdrop" contentClassName="confirm" contentAs="section" closeOnBackdrop={false}>
      <h2 id="confirm-title">Confirm retry</h2>
      <p id="confirm-description">This cannot duplicate the job.</p>
      <button type="button" data-autofocus onClick={() => setConfirm(false)}>Cancel</button>
      <button type="button">Confirm</button>
    </AccessibleOverlay>}
  </div>;
}

function ForcedStack({ parent, child }: { parent: boolean; child: boolean }) {
  return <div data-testid="forced-app">
    {parent && <AccessibleOverlay open onClose={() => undefined} labelledBy="forced-parent" backdropClassName="backdrop" contentClassName="drawer"><h2 id="forced-parent">Forced parent</h2><button type="button">Parent action</button></AccessibleOverlay>}
    {child && <AccessibleOverlay open onClose={() => undefined} labelledBy="forced-child" role="alertdialog" backdropClassName="backdrop" contentClassName="confirm"><h2 id="forced-child">Forced child</h2><button type="button">Child action</button></AccessibleOverlay>}
  </div>;
}

describe("AccessibleOverlay", () => {
  const scrollTo = vi.fn();
  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
  });

  it("isolates and locks the page, traps focus, closes on Escape, and restores its trigger", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open drawer" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Drawer" });
    const retry = screen.getByRole("button", { name: "Retry" });
    const close = screen.getByRole("button", { name: "Close drawer" });
    await waitFor(() => expect(retry).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.width).toBe("100%");
    expect(screen.getByTestId("application").parentElement).toHaveProperty("inert", true);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(retry).toHaveFocus();
    retry.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.position).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("keeps the parent inert while a nested alertdialog is open and restores parent focus", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    await waitFor(() => expect(retry).toHaveFocus());
    fireEvent.click(retry);
    const alert = await screen.findByRole("alertdialog", { name: "Confirm retry" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "Drawer", hidden: true }).closest("[data-overlay-host]")).toHaveProperty("inert", true);

    fireEvent.pointerDown(alert.parentElement!);
    expect(alert).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(alert).not.toBeInTheDocument());
    await waitFor(() => expect(retry).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "Drawer" })).toBeInTheDocument();
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("restores pre-existing inert, aria-hidden, body styles, and scroll position", async () => {
    const sibling = document.createElement("div");
    sibling.inert = true;
    sibling.setAttribute("aria-hidden", "legacy");
    document.body.append(sibling);
    document.body.style.overflow = "clip";
    document.body.style.position = "relative";
    document.body.style.top = "4px";
    document.body.style.width = "95%";
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
    await screen.findByRole("dialog", { name: "Drawer" });
    expect(document.body.style.top).toBe("-240px");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(sibling.inert).toBe(true);
    expect(sibling).toHaveAttribute("aria-hidden", "legacy");
    expect(document.body.style.overflow).toBe("clip");
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.top).toBe("4px");
    expect(document.body.style.width).toBe("95%");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 240);
    sibling.remove();
    document.body.removeAttribute("style");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("retains isolation when a parent unmounts before its nested child", async () => {
    const { rerender } = render(<ForcedStack parent child />);
    await screen.findByRole("alertdialog", { name: "Forced child" });
    rerender(<ForcedStack parent={false} child />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Forced parent", hidden: true })).not.toBeInTheDocument());
    expect(screen.getByTestId("forced-app").parentElement).toHaveProperty("inert", true);
    expect(document.body.style.position).toBe("fixed");
    rerender(<ForcedStack parent={false} child={false} />);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("forced-app").parentElement?.inert).toBeFalsy();
    expect(document.body.style.position).toBe("");
  });
});
