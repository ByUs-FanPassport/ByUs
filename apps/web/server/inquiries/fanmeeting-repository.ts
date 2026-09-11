import "server-only";
import { InquiryError, type InquiryInput, type InquiryRepository, type InquiryType } from "./fanmeeting-route";
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
export function createInquiryRepository(client: RpcClient): InquiryRepository {
  return { async submit(input: InquiryInput, ipHash: string, payloadHash: string, inquiryType: InquiryType) {
    const args: Record<string, unknown> = {
      p_id: input.idempotencyKey, p_locale: input.locale, p_name: input.name,
      p_company: input.company, p_email: input.email, p_message: input.message,
      p_consent: input.consent, p_ip_hash: ipHash, p_payload_hash: payloadHash,
    };
    if (inquiryType !== "fanmeeting") args.p_inquiry_type = inquiryType;
    const { data, error } = await client.rpc(
      inquiryType === "fanmeeting" ? "submit_business_inquiry" : "submit_categorized_business_inquiry",
      args,
    );
    if (error) {
      for (const code of ["INQUIRY_RATE_LIMITED", "INQUIRY_IDEMPOTENCY_CONFLICT", "INQUIRY_INVALID"] as const) {
        if (error.message === code) throw new InquiryError(code);
      }
      throw new InquiryError("INQUIRY_UNAVAILABLE");
    }
    if (typeof data !== "boolean") throw new InquiryError("INQUIRY_UNAVAILABLE");
    return data;
  } };
}
