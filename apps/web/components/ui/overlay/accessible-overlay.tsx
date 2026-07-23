"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import overlayStyles from "./accessible-overlay.module.css";
import { takeOverlayTrigger } from "./focus-return";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const overlayHosts: HTMLElement[] = [];
const originalBodyState = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
let originalBodyStyle = { overflow: "", position: "", top: "", width: "" };
let lockedScrollY = 0;

function syncDocumentIsolation() {
  if (!document.body) return;
  const top = overlayHosts.at(-1);
  if (!top) {
    for (const [element, state] of originalBodyState) {
      element.inert = state.inert;
      state.ariaHidden === null
        ? element.removeAttribute("aria-hidden")
        : element.setAttribute("aria-hidden", state.ariaHidden);
    }
    originalBodyState.clear();
    document.body.style.overflow = originalBodyStyle.overflow;
    document.body.style.position = originalBodyStyle.position;
    document.body.style.top = originalBodyStyle.top;
    document.body.style.width = originalBodyStyle.width;
    const scrollTo = window.scrollTo as typeof window.scrollTo & { _isMockFunction?: boolean };
    if (!navigator.userAgent.toLowerCase().includes("jsdom") || scrollTo._isMockFunction) {
      scrollTo.call(window, 0, lockedScrollY);
    }
    return;
  }

  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!originalBodyState.has(child)) {
      originalBodyState.set(child, {
        inert: child.inert,
        ariaHidden: child.getAttribute("aria-hidden"),
      });
    }
    const active = child === top;
    child.inert = !active;
    if (active) child.removeAttribute("aria-hidden");
    else child.setAttribute("aria-hidden", "true");
  }
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.width = "100%";
}

function registerHost(host: HTMLElement) {
  if (overlayHosts.length === 0) {
    originalBodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    lockedScrollY = window.scrollY;
  }
  overlayHosts.push(host);
  syncDocumentIsolation();
  return () => {
    const index = overlayHosts.lastIndexOf(host);
    if (index >= 0) overlayHosts.splice(index, 1);
    host.remove();
    syncDocumentIsolation();
  };
}

function isTopOverlay(host: HTMLElement) {
  return overlayHosts.at(-1) === host;
}

function isVisibleFocusable(element: HTMLElement) {
  if (element.hidden || element.closest("[hidden], [aria-hidden=\"true\"], [inert]")) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  // jsdom has no layout engine, so zero rectangles are meaningful only in a browser.
  const hasLayoutEngine = !navigator.userAgent.toLowerCase().includes("jsdom");
  if (hasLayoutEngine && element.getClientRects().length === 0) return false;
  return true;
}

function focusableWithin(content: HTMLElement) {
  return Array.from(content.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(isVisibleFocusable);
}

export type OverlayVariant = "dialog" | "alert-dialog" | "drawer" | "bottom-sheet";

export type AccessibleOverlayProps = {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  backdropClassName: string;
  contentClassName: string;
  contentAs?: "aside" | "section";
  busy?: boolean;
  variant?: OverlayVariant;
};

export function AccessibleOverlay({
  open,
  children,
  onClose,
  labelledBy,
  describedBy,
  role = "dialog",
  closeOnEscape = true,
  closeOnBackdrop = true,
  initialFocusRef,
  backdropClassName,
  contentClassName,
  contentAs = "aside",
  busy = false,
  variant = "dialog",
}: AccessibleOverlayProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const triggerSelectorRef = useRef<string | null>(null);
  const closeRef = useRef(onClose);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const rememberedTrigger = takeOverlayTrigger();
    triggerRef.current = rememberedTrigger?.element
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    triggerSelectorRef.current = rememberedTrigger?.selector ?? null;
    const nextHost = document.createElement("div");
    nextHost.dataset.overlayHost = "";
    document.body.append(nextHost);
    const unregister = registerHost(nextHost);
    setHost(nextHost);
    return () => {
      unregister();
      setHost(null);
      window.setTimeout(() => {
        const remembered = triggerRef.current;
        const trigger = triggerSelectorRef.current
          ? document.querySelector<HTMLElement>(triggerSelectorRef.current)
          : remembered?.isConnected
            ? remembered
            : null;
        const top = overlayHosts.at(-1);
        if (trigger && (!top || top.contains(trigger))) trigger.focus();
      }, 250);
    };
  }, [open]);

  useEffect(() => {
    if (!host) return;
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;
      const preferred = initialFocusRef?.current
        && isVisibleFocusable(initialFocusRef.current)
        ? initialFocusRef.current
        : focusableWithin(content).find((element) => element.hasAttribute("data-autofocus"))
          ?? focusableWithin(content)[0]
        ?? content;
      preferred.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [host, initialFocusRef]);

  useEffect(() => {
    if (!host) return;
    const activeHost = host;
    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopOverlay(activeHost)) return;
      if (event.key === "Escape" && closeOnEscape && !busy) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const content = contentRef.current;
      if (!content) return;
      const focusable = focusableWithin(content);
      if (focusable.length === 0) {
        event.preventDefault();
        content.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !content.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !content.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, closeOnEscape, host]);

  if (!open || !host) return null;
  const Content = contentAs;
  return createPortal(
    <div
      className={`${overlayStyles.backdrop} ${backdropClassName}`}
      data-overlay-root=""
      data-variant={variant}
      data-reduced-motion="respect"
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget
          && closeOnBackdrop
          && !busy
          && isTopOverlay(host)
        ) closeRef.current();
      }}
    >
      <Content
        ref={contentRef as RefObject<HTMLElement>}
        className={contentClassName}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
        data-overlay-content=""
        data-variant={variant}
      >
        {children}
      </Content>
    </div>,
    host,
  );
}

type VariantOverlayProps = Omit<AccessibleOverlayProps, "role" | "variant" | "contentAs">;

export function Dialog(props: VariantOverlayProps) {
  return <AccessibleOverlay {...props} variant="dialog" role="dialog" contentAs="section" />;
}

export function AlertDialog(props: VariantOverlayProps) {
  return <AccessibleOverlay {...props} variant="alert-dialog" role="alertdialog" contentAs="section" closeOnBackdrop={props.closeOnBackdrop ?? false} />;
}

export function Drawer(props: VariantOverlayProps) {
  return <AccessibleOverlay {...props} variant="drawer" role="dialog" contentAs="aside" />;
}

export function BottomSheet(props: VariantOverlayProps) {
  return <AccessibleOverlay {...props} variant="bottom-sheet" role="dialog" contentAs="section" />;
}
