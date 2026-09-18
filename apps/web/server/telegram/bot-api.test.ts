import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createTelegramReactionPort } from "./bot-api";

describe("Telegram Bot API reaction", () => {
  it("uses the standard okay emoji and the exact source message", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    await createTelegramReactionPort("8135965800:test-token-value-abcdefghijklmnopqrstuvwxyz", fetcher)
      .setOkayReaction({ chatId: -5187701508, messageId: 55 });
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = vi.mocked(fetcher).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: -5187701508,
      message_id: 55,
      reaction: [{ type: "emoji", emoji: "👌" }],
      is_big: false,
    });
  });

  it("fails without exposing the provider response", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false, description: "private" }, { status: 400 })) as unknown as typeof fetch;
    await expect(createTelegramReactionPort("8135965800:test-token-value-abcdefghijklmnopqrstuvwxyz", fetcher)
      .setOkayReaction({ chatId: -5187701508, messageId: 55 }))
      .rejects.toThrow("TELEGRAM_REACTION_FAILED");
  });
});
