import { WorkerError } from "../domain.js";
import type { MetadataDocument, MetadataPort } from "../ports.js";

export class PinataMetadataAdapter implements MetadataPort {
  constructor(
    private readonly apiUrl: string,
    private readonly jwt: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async pin(document: MetadataDocument, operationKey: string): Promise<string> {
    const response = await this.fetchImpl(`${this.apiUrl.replace(/\/$/, "")}/pinning/pinJSONToIPFS`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        pinataContent: document,
        pinataMetadata: {
          name: `byus-credential-v1-${operationKey}`,
          keyvalues: { application: "byus", schemaVersion: "1" },
        },
        pinataOptions: { cidVersion: 1 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new WorkerError("PINATA_UPLOAD_FAILED", `Pinata returned HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500);
    }
    const result = await response.json() as { IpfsHash?: string };
    if (!result.IpfsHash) throw new WorkerError("PINATA_INVALID_RESPONSE", "Pinata response did not include IpfsHash", true);
    return `ipfs://${result.IpfsHash}`;
  }
}
