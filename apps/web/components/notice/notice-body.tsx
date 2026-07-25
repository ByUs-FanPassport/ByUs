import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { JSONContent } from "@tiptap/core";
import React from "react";
import type { TiptapDocument } from "../../server/notice/notice-domain";
import { noticeExtensions } from "./tiptap-extensions";
import styles from "./notice-detail.module.css";

export function NoticeBody({ document, locale }: { document: TiptapDocument; locale: "ko" | "en" }) {
  const newWindowLabel = locale === "ko" ? "새 창" : "opens in a new window";
  return (
    <div className={styles.body}>
      {renderToReactElement({
        content: document as JSONContent,
        extensions: noticeExtensions,
        options: {
          markMapping: {
            link: ({ mark, children }) => React.createElement(
              "a",
              { href: mark.attrs.href, target: "_blank", rel: "noreferrer" },
              children,
              React.createElement("span", { className: styles.srOnly }, `, ${newWindowLabel}`),
            ),
          },
        },
      })}
    </div>
  );
}
