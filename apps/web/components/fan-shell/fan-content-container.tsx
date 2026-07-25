import { createElement, type HTMLAttributes, type ReactNode } from "react";

import styles from "./fan-content-container.module.css";

type FanContentElement = "div" | "main" | "section";

export type FanContentContainerProps = HTMLAttributes<HTMLElement> & {
  as?: FanContentElement;
  children: ReactNode;
};

export function FanContentContainer({
  as = "div",
  children,
  className,
  ...props
}: FanContentContainerProps) {
  return createElement(
    as,
    {
      ...props,
      className: [styles.container, className].filter(Boolean).join(" "),
      "data-fan-content-container": "",
    },
    children,
  );
}
