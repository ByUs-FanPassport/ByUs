import type { ComponentPropsWithoutRef } from "react";
import styles from "./fan-surface.module.css";

export const fanUtilityCanvasClassName = styles.canvas;
/** Static surface only. Actions retain FanAction and their own focus treatment. */
export function FanSurface({ tone = "default", className, ...props }: ComponentPropsWithoutRef<"section"> & { tone?: "default" | "focus" }) {
  return <section {...props} className={[styles.card, className].filter(Boolean).join(" ")} data-fan-surface-card data-tone={tone} />;
}
