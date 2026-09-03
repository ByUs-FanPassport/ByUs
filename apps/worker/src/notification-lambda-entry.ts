import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createWorkerSecretLoader } from "./aws-secret.js";
import { createNotificationLambdaHandler } from "./notification-lambda.js";
import { runNotificationWorkerOnce } from "./notification-runtime.js";
import { runBenefitMaintenanceOnce } from "./benefit-maintenance.js";
const secrets = new SecretsManagerClient({});
const loadSecret = createWorkerSecretLoader((command: GetSecretValueCommand) =>
  secrets.send(command),
);
export const handler = createNotificationLambdaHandler(
  {
    loadSecret,
    runWorker: runNotificationWorkerOnce,
    runMaintenance: runBenefitMaintenanceOnce,
  },
  process.env,
);
