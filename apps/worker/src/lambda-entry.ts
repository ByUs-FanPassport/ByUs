import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createWorkerSecretLoader } from "./aws-secret.js";
import { createLambdaHandler } from "./lambda.js";
import { runWorkerOnce } from "./runtime.js";

const secrets = new SecretsManagerClient({});
const loadSecret = createWorkerSecretLoader((command: GetSecretValueCommand) => secrets.send(command));

export const handler = createLambdaHandler({
  loadSecret,
  runWorker: runWorkerOnce,
}, process.env);
