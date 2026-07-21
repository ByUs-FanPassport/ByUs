const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(
  key: ArrayBuffer,
  value: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export async function signLambdaInvoke(input: {
  region: string;
  functionName: string;
  body: string;
  credentials: AwsCredentials;
  now?: Date;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const host = `lambda.${input.region}.amazonaws.com`;
  const canonicalUri = `/2015-03-31/functions/${
    encodeURIComponent(input.functionName)
  }/invocations`;
  const bodyHash = await sha256(input.body);
  const canonicalHeaders =
    `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "POST",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");
  const scope = `${date}/${input.region}/lambda/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(
    encoder.encode(`AWS4${input.credentials.secretAccessKey}`)
      .buffer as ArrayBuffer,
    date,
  );
  const regionKey = await hmac(dateKey, input.region);
  const serviceKey = await hmac(regionKey, "lambda");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      authorization,
      "content-type": "application/json",
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": amzDate,
    },
  };
}
