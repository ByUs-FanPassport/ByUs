import { expect, it, vi } from "vitest";
import { runRaffleRecipientRemindersOnce } from "../src/raffle-recipient-reminders.js";
import type { NotificationWorkerEnv } from "../src/notification-env.js";
const env = {} as NotificationWorkerEnv;
it("delegates timing and unique enqueue to the service RPC", async () => { const rpc = vi.fn(async () => ({ data: 2, error: null })); expect(await runRaffleRecipientRemindersOnce(env, { rpc } as never)).toBe(2); expect(rpc).toHaveBeenCalledExactlyOnceWith("enqueue_due_benefit_recipient_reminders"); });
it("fails without exposing DB detail", async () => { const rpc = vi.fn(async () => ({ data: null, error: { message: "private database detail" } })); await expect(runRaffleRecipientRemindersOnce(env, { rpc } as never)).rejects.toThrow("RAFFLE_REMINDER_UNAVAILABLE"); });
