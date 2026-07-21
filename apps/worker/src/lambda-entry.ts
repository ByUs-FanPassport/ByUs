import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createLambdaHandler } from "./lambda.js";
import { runWorkerOnce } from "./runtime.js";

const secrets = new SecretsManagerClient({});

export const handler = createLambdaHandler({
  async loadSecret(secretId) {
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!result.SecretString) throw new Error("worker secret does not contain a SecretString");
    return result.SecretString;
  },
  runWorker: runWorkerOnce,
}, process.env);
