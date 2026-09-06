"use client";

import { useEffect, useRef, useState } from "react";
import type { Avatar } from "../domain/avatar";
import type { useAvatar } from "./use-avatar";
import { Avatar as AvatarImage } from "./avatar";
import { loadAvatarEditor } from "./load-avatar-editor";
import { avatarEditorCopy } from "./avatar-editor-copy";
import styles from "./avatar-editor.module.css";

type AvatarResource = ReturnType<typeof useAvatar>;
type Locale = "ko" | "en";

export function AvatarSettings({ locale, resource }: { locale: Locale; resource: AvatarResource }) {
  const t = avatarEditorCopy[locale];
  const [open, setOpen] = useState(false);
  const [Editor, setEditor] = useState<typeof import("./avatar-editor").AvatarEditor | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [editorOwner, setEditorOwner] = useState<string | null>(null);
  const [editorSnapshot, setEditorSnapshot] = useState<{ avatar: Avatar; imageUrl: string | null } | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const state = resource.state;
  const closeEditor = () => {
    setOpen(false);
    setEditorOwner(null);
    setEditorSnapshot(null);
    requestAnimationFrame(() => changeButtonRef.current?.focus());
  };
  useEffect(() => {
    if (!open || editorOwner !== resource.ownerId || Editor) return;
    let active = true;
    setLoadFailed(false);
    void loadAvatarEditor().then((module) => {
      if (active) setEditor(() => module.AvatarEditor);
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [open, editorOwner, resource.ownerId, Editor, loadRevision]);
  useEffect(() => {
    if (state.status === "ready") {
      setEditorSnapshot({ avatar: state.avatar, imageUrl: state.imageUrl });
    }
  }, [state]);
  useEffect(() => {
    if (open && editorOwner && resource.ownerId !== editorOwner) closeEditor();
  }, [editorOwner, open, resource.ownerId]);
  return (
    <div className={styles.settingsRow}>
      <div className={styles.currentAvatar}>
        {state.status === "ready" ? (
          <AvatarImage avatar={state.avatar} imageUrl={state.imageUrl} label={t.avatar} size={64} />
        ) : (
          <span className={styles.loadingAvatar} aria-hidden="true" />
        )}
        <span>
          <strong>{t.avatar}</strong>
          <small>{state.status === "error" ? t.loadError : state.status === "loading" ? t.loading : t.help}</small>
        </span>
      </div>
      {state.status === "ready" ? (
        <button ref={changeButtonRef} type="button" onClick={() => {
          setEditorOwner(resource.ownerId ?? null);
          setEditorSnapshot({ avatar: state.avatar, imageUrl: state.imageUrl });
          setOpen(true);
        }}>{t.change}</button>
      ) : state.status === "error" ? (
        <button type="button" onClick={resource.refresh}>{t.retry}</button>
      ) : null}
      {open && editorSnapshot && editorOwner === resource.ownerId ? (
        Editor ? <Editor
          locale={locale}
          resource={resource}
          avatar={editorSnapshot.avatar}
          imageUrl={editorSnapshot.imageUrl}
          refreshUnavailable={state.status === "error"}
          onClose={closeEditor}
        /> : <div className={styles.editorLoadState}>
          <span role={loadFailed ? "alert" : "status"}>{loadFailed ? t.loadError : t.loading}</span>
          {loadFailed ? <button type="button" onClick={() => setLoadRevision((value) => value + 1)}>{t.retry}</button> : null}
          <button type="button" onClick={closeEditor}>{t.cancel}</button>
        </div>
      ) : null}
    </div>
  );
}
