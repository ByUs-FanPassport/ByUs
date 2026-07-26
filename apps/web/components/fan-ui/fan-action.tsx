import type { Route } from "next";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./fan-action.module.css";

export type FanActionVariant =
  | "primary"
  | "neutral"
  | "text"
  | "service"
  | "passport";

export function fanActionClassName(
  variant: FanActionVariant,
  options: { fullWidth?: boolean; className?: string } = {},
) {
  return [
    styles.action,
    styles[variant],
    options.fullWidth ? styles.fullWidth : "",
    options.className ?? "",
  ].filter(Boolean).join(" ");
}

type FanActionProps = Readonly<{
  children: ReactNode;
  variant?: FanActionVariant;
  fullWidth?: boolean;
  className?: string;
  ariaLabel?: string;
}> & (
  | Readonly<{ href: string; onClick?: never; type?: never; disabled?: never }>
  | Readonly<{
      href?: never;
      onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
      type?: "button" | "submit";
      disabled?: boolean;
      ariaBusy?: boolean;
    }>
);

export function FanAction({
  children,
  variant = "neutral",
  fullWidth,
  className,
  ariaLabel,
  ...props
}: FanActionProps) {
  const actionClassName = fanActionClassName(variant, { fullWidth, className });
  if ("href" in props && props.href) {
    return (
      <Link className={actionClassName} href={props.href as Route} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }

  const buttonProps = props as Extract<FanActionProps, { href?: never }>;
  return (
    <button
      className={actionClassName}
      type={buttonProps.type ?? "button"}
      onClick={buttonProps.onClick}
      disabled={buttonProps.disabled}
      aria-busy={buttonProps.ariaBusy}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
