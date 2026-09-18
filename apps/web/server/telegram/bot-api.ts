import "server-only";

import { z } from "zod";

const telegramResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

export interface TelegramReactionPort {
  setOkayReaction(input: { chatId: number; messageId: number }): Promise<void>;
}

export function createTelegramReactionPort(botToken: string, fetcher: typeof fetch = fetch): TelegramReactionPort {
  return {
    async setOkayReaction({ chatId, messageId }) {
      const response = await fetcher(`https://api.telegram.org/bot${botToken}/setMessageReaction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: "emoji", emoji: "👌" }],
          is_big: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = telegramResponseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !payload.success || !payload.data.ok) {
        throw new Error("TELEGRAM_REACTION_FAILED");
      }
    },
  };
}
