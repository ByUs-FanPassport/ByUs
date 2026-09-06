import { z } from "zod";
import { getNicknameFormat } from "./nickname-format";

/** Shared read contract: graphemes, rather than UTF-16 code units. */
export const nicknameSchema = z.string().refine(
  (value) => getNicknameFormat(value).valid,
  "Invalid display name format",
);
