import {
  GetSecretValueCommand,
  type GetSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";

export type SendGetSecretValue = (
  command: GetSecretValueCommand,
) => Promise<GetSecretValueCommandOutput>;

export function createWorkerSecretLoader(send: SendGetSecretValue) {
  return async (secretId: string): Promise<string> => {
    const result = await send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!result.SecretString) {
      throw new Error("worker secret does not contain a SecretString");
    }
    return result.SecretString;
  };
}
