"use client";

import { useEffect, useRef } from "react";
import { CalendarIcon } from "@animateicons/react/lucide/calendar-icon";
import { TicketIcon } from "@animateicons/react/lucide/ticket-icon";
import { GiftIcon } from "@animateicons/react/lucide/gift-icon";
import { RadioIcon } from "@animateicons/react/lucide/radio-icon";
import styles from "./fan-motion-icon.module.css";

const icons = { calendar: CalendarIcon, ticket: TicketIcon, gift: GiftIcon, radio: RadioIcon };
type IconHandle = { startAnimation(): void; stopAnimation(): void };

/** Decorative only. Labels belong to the surrounding action. */
export function FanMotionIcon({ name, size = 20, className, active = false }: {
  name: keyof typeof icons;
  size?: number;
  className?: string;
  active?: boolean;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const handle = useRef<IconHandle>(null);
  const Icon = icons[name];
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const target = element.closest("a,button,[role=tab]") ?? element;
    let visible = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let repeatTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(stopTimer);
      clearTimeout(repeatTimer);
      handle.current?.stopAnimation();
      element.dataset.animating = "false";
    };
    const play = () => {
      if (!visible || reduced.matches || document.hidden || target.matches(":disabled,[aria-disabled=true]")) return;
      clearTimeout(stopTimer);
      handle.current?.startAnimation();
      element.dataset.animating = "true";
      // Radio's library animation repeats indefinitely; bound every activation.
      stopTimer = setTimeout(() => {
        handle.current?.stopAnimation();
        element.dataset.animating = "false";
      }, 1200);
    };
    const sync = () => {
      stop();
      if (active && name === "radio" && visible && !reduced.matches && !document.hidden && pointer.matches) {
        play();
        repeatTimer = setTimeout(sync, 7000);
      }
    };
    const hover = () => { if (pointer.matches) play(); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }, { threshold: 0.1 });
    observer?.observe(element);
    target.addEventListener("pointerenter", hover);
    target.addEventListener("focusin", play);
    target.addEventListener("pointerleave", stop);
    target.addEventListener("focusout", stop);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    pointer.addEventListener("change", sync);
    return () => {
      stop();
      observer?.disconnect();
      target.removeEventListener("pointerenter", hover);
      target.removeEventListener("focusin", play);
      target.removeEventListener("pointerleave", stop);
      target.removeEventListener("focusout", stop);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
      pointer.removeEventListener("change", sync);
    };
  }, [active, name]);
  return <span ref={root} className={`${styles.icon} ${className ?? ""}`} aria-hidden="true" data-fan-motion={name} data-animating="false" style={{ width: size, height: size }}>
    <Icon ref={handle} size={size} isAnimated={false} />
  </span>;
}
