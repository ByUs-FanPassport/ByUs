export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

const allowedNicknameCharacters = /^[A-Za-z0-9가-힣 _-]+$/u;

export type NicknameFormat = {
  nickname: string;
  normalized: string;
  length: number;
  valid: boolean;
};

/**
 * Canonical nickname format shared by browser validation and the server.
 * Compatibility characters are normalized before ordinary edge spaces are
 * removed so the stored value matches the database RPC contract.
 */
export function getNicknameFormat(input: string): NicknameFormat {
  const nickname = input.normalize("NFKC").replace(/^ +| +$/g, "");
  const length = Array.from(nickname).length;

  return {
    nickname,
    normalized: nickname.toLowerCase(),
    length,
    valid:
      length >= NICKNAME_MIN_LENGTH
      && length <= NICKNAME_MAX_LENGTH
      && allowedNicknameCharacters.test(nickname),
  };
}
