"use client";
import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import styles from "./fanpage.module.css";

/** Reuse the product overlay's tested focus, Escape, and background isolation. */
export function FanDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const titleId = useId();
  return <AccessibleOverlay open onClose={onClose} labelledBy={titleId} backdropClassName={styles.dialogBackdrop} contentClassName={styles.dialog}>
    <div className={styles.dialogHeading}><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button></div>
    {children}
  </AccessibleOverlay>;
}
