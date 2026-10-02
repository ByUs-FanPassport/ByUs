import "server-only";
import { RsvpError, type RsvpInput, type RsvpRepository } from "./rsvp-route";

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };

export function createRsvpRepository(client: RpcClient): RsvpRepository {
  return { async submit(input: RsvpInput, ipHash: string, payloadHash: string) {
    const { data, error } = await client.rpc("submit_byus_day_rsvp", {
      p_id: input.idempotencyKey,
      p_locale: input.locale,
      p_korean_name: input.koreanName,
      p_english_name: input.englishName,
      p_phone_e164: input.phone,
      p_affiliation: input.affiliation,
      p_occupation: input.occupation,
      p_email: input.email,
      p_nationality: input.nationality,
      p_resident_registration_number_encrypted: input.residentRegistrationNumberEncrypted,
      p_consent: input.consent,
      p_ip_hash: ipHash,
      p_payload_hash: payloadHash,
    });
    if (error) {
      for (const code of ["RSVP_INVALID", "RSVP_CLOSED", "RSVP_RATE_LIMITED", "RSVP_IDEMPOTENCY_CONFLICT"] as const) {
        if (error.message === code) throw new RsvpError(code);
      }
      throw new RsvpError("RSVP_UNAVAILABLE");
    }
    if (data !== true) throw new RsvpError("RSVP_UNAVAILABLE");
  } };
}
