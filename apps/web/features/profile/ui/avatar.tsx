"use client";

import { useState, type CSSProperties } from "react";
import { avatarAssetPath, type Avatar as AvatarModel } from "../domain/avatar";
import styles from "./avatar.module.css";

export function Avatar({
  avatar,
  imageUrl,
  label,
  size = 64,
  className,
}: {
  avatar: AvatarModel;
  imageUrl: string | null;
  label: string;
  size?: number;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photoUrl = imageUrl && failedUrl !== imageUrl ? imageUrl : null;
  return (
    <span
      className={`${styles.avatar}${className ? ` ${className}` : ""}`}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
    >
      <img
        src={photoUrl ?? avatarAssetPath(avatar.characterId)}
        alt={label}
        width={size}
        height={size}
        onError={() => {
          if (photoUrl) setFailedUrl(photoUrl);
        }}
      />
    </span>
  );
}

export function AvatarPlaceholder({ size = 64 }: { size?: number }) {
  return (
    <span
      className={`${styles.avatar} ${styles.placeholder}`}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    />
  );
}
