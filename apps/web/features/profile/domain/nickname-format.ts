export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 32;
// Keep pathological combining sequences below PostgreSQL's unique-index limit.
export const NICKNAME_MAX_CODE_POINTS = 512;
export const NICKNAME_MAX_BYTES = 2048;

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const encoder = new TextEncoder();
const newline = /[\r\n\u2028\u2029]/u;
// Joiners and combining marks remain available for ordinary scripts and emoji.
// Explicitly reject invisible fillers, bidi overrides and hidden separators.
const unsupported = /[\p{Cc}\p{Cs}\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]/u;
const visibleBase = /[\p{L}\p{N}\p{P}\p{S}]/u;

export type NicknameFormatReason = "empty" | "too_long" | "newline" | "unsupported";

export type NicknameFormat = {
  nickname: string;
  normalized: string;
  length: number;
  valid: boolean;
  reason: NicknameFormatReason | null;
};

/**
 * Canonical nickname format shared by browser validation and the server.
 * Compatibility characters are normalized before ordinary edge spaces are
 * removed so the stored value matches the database RPC contract.
 */
export function getNicknameFormat(input: string): NicknameFormat {
  const nickname = input.normalize("NFKC").replace(/^ +| +$/g, "");
  const normalized = nickname.toLowerCase();
  const length = Array.from(segmenter.segment(nickname)).length;
  const reason: NicknameFormatReason | null = newline.test(nickname)
    ? "newline"
    : unsupported.test(nickname)
      ? "unsupported"
      : !visibleBase.test(nickname)
        ? "empty"
        : length > NICKNAME_MAX_LENGTH
          ? "too_long"
          : Array.from(nickname).length > NICKNAME_MAX_CODE_POINTS
            || Array.from(normalized).length > NICKNAME_MAX_CODE_POINTS
            || encoder.encode(nickname).length > NICKNAME_MAX_BYTES
            || encoder.encode(normalized).length > NICKNAME_MAX_BYTES
            ? "unsupported"
            : null;

  return {
    nickname,
    normalized,
    length,
    valid: reason === null,
    reason,
  };
}

export function getNicknameFormatMessage(reason: NicknameFormatReason | null, locale: "ko" | "en"): string {
  if (!reason) return "";
  const messages = {
    ko: {
      empty: "닉네임을 입력해 주세요.",
      too_long: "닉네임은 32자까지 입력할 수 있어요.",
      newline: "닉네임은 한 줄로 입력해 주세요.",
      unsupported: "사용할 수 없는 문자가 포함되어 있어요. 해당 문자를 지워 주세요.",
    },
    en: {
      empty: "Enter a display name.",
      too_long: "Your display name must be 32 characters or fewer.",
      newline: "Keep your display name on one line.",
      unsupported: "Remove the unsupported characters from your display name.",
    },
  };
  return messages[locale][reason];
}
