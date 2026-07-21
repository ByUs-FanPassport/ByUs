import { describe, expect, it, vi } from "vitest";
import { PinataMetadataAdapter } from "../src/adapters/pinata.js";
import type { MetadataDocument } from "../src/ports.js";

const document: MetadataDocument = {
  schema: "https://byus.kr/schemas/credential-metadata-v1.json",
  version: 1,
  name: "ByUs Fan Passport",
  description: "A soulbound credential.",
  image: "ipfs://bafy-assets/passport/kara.png",
  attributes: [{ trait_type: "Credential", value: "Fan Passport" }],
};

describe("PinataMetadataAdapter", () => {
  it("pins CIDv1 JSON with an authorization bearer and returns an IPFS URI", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, _init) => new Response(JSON.stringify({ IpfsHash: "bafy-result" }), { status: 200 }));
    const adapter = new PinataMetadataAdapter("https://api.pinata.cloud", "secret-jwt", fetchImpl);
    await expect(adapter.pin(document, "passport:test")).resolves.toBe("ipfs://bafy-result");
    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.pinata.cloud/pinning/pinJSONToIPFS");
    expect(request?.headers).toMatchObject({ authorization: "Bearer secret-jwt" });
    expect(JSON.parse(String(request?.body))).toMatchObject({ pinataContent: document, pinataOptions: { cidVersion: 1 } });
  });

  it("marks rate limiting as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, _init) => new Response("rate limited", { status: 429 }));
    const adapter = new PinataMetadataAdapter("https://api.pinata.cloud", "secret-jwt", fetchImpl);
    await expect(adapter.pin(document, "passport:test")).rejects.toMatchObject({ code: "PINATA_UPLOAD_FAILED", retryable: true });
  });
});
