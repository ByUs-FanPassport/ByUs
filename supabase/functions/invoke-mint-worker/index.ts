import { createWorkerInvokerHandler } from "./handler.ts";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const workerEnvironment = required("WORKER_ENVIRONMENT");
if (workerEnvironment !== "dev" && workerEnvironment !== "prod") {
  throw new Error("WORKER_ENVIRONMENT must be dev or prod");
}

Deno.serve(createWorkerInvokerHandler({
  cronSecret: required("BYUS_CRON_SECRET"),
  awsAccessKeyId: required("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
  awsRegion: required("AWS_REGION"),
  lambdaFunctionName: required("LAMBDA_FUNCTION_NAME"),
  workerEnvironment,
}));
