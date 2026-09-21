import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__notice__notice-body";
import { translate } from "@/i18n/messages";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { JSONContent } from "@tiptap/core";
import React from "react";
import type { TiptapDocument } from "../../server/notice/notice-domain";
import { noticeExtensions } from "./tiptap-extensions";
import styles from "./notice-detail.module.css";

export function NoticeBody({ document, locale }: { document: TiptapDocument; locale: AppLocale }) {
  const newWindowLabel = locale === "ko" ? "새 창" : translate(locale, localizedMessages.m78f7fe6d9b7c, "opens in a new window");
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
