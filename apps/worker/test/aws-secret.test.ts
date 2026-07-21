import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { createWorkerSecretLoader } from "../src/aws-secret.js";

describe("AWS Secrets Manager loader", () => {
  it("requests the named secret and returns its SecretString", async () => {
    const send = vi.fn().mockResolvedValue({ SecretString: '{"WORKER_ID":"worker-1"}' });
    const loadSecret = createWorkerSecretLoader(send);

    await expect(loadSecret("byus/worker/prod")).resolves.toBe('{"WORKER_ID":"worker-1"}');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetSecretValueCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({ SecretId: "byus/worker/prod" });
  });

  it("rejects binary-only and empty secret responses", async () => {
    const binaryLoader = createWorkerSecretLoader(
      vi.fn().mockResolvedValue({ SecretBinary: new Uint8Array([1, 2, 3]) }),
    );
    const emptyLoader = createWorkerSecretLoader(vi.fn().mockResolvedValue({ SecretString: "" }));

    await expect(binaryLoader("byus/worker/prod")).rejects.toThrow(
      "worker secret does not contain a SecretString",
    );
    await expect(emptyLoader("byus/worker/prod")).rejects.toThrow(
      "worker secret does not contain a SecretString",
    );
  });

  it.each(["ResourceNotFoundException", "AccessDeniedException", "TimeoutError"])(
    "preserves the AWS %s failure for Lambda error handling",
    async (name) => {
      const error = Object.assign(new Error(name), { name });
      const loadSecret = createWorkerSecretLoader(vi.fn().mockRejectedValue(error));

      await expect(loadSecret("byus/worker/prod")).rejects.toMatchObject({ name });
    },
  );

  it("does not cache secret values, allowing rotation to take effect", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ SecretString: "version-1", VersionId: "1" })
      .mockResolvedValueOnce({ SecretString: "version-2", VersionId: "2" });
    const loadSecret = createWorkerSecretLoader(send);

    await expect(loadSecret("byus/worker/prod")).resolves.toBe("version-1");
    await expect(loadSecret("byus/worker/prod")).resolves.toBe("version-2");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
