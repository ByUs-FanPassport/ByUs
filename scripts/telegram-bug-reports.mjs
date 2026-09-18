#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const KEYCHAIN_SERVICE = "codex.telegram.bug-report-operator";
const KEYCHAIN_ACCOUNT = "byus.kr";
const DEFAULT_BASE_URL = "https://byus.kr";

function usage() {
  process.stderr.write([
    "Usage:",
    "  npm run telegram:bugs -- list [pending|completed|all] [limit]",
    "  npm run telegram:bugs -- complete <message-id> <commit> <deployment-url>",
    "",
  ].join("\n"));
}

function operatorSecret() {
  if (process.env.TELEGRAM_BUG_REPORT_OPERATOR_SECRET) return process.env.TELEGRAM_BUG_REPORT_OPERATOR_SECRET;
  if (process.platform !== "darwin") throw new Error("Set TELEGRAM_BUG_REPORT_OPERATOR_SECRET");
  return execFileSync("security", [
    "find-generic-password",
    "-s", KEYCHAIN_SERVICE,
    "-a", KEYCHAIN_ACCOUNT,
    "-w",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function baseUrl() {
  const url = new URL(process.env.BYUS_TELEGRAM_OPERATOR_URL ?? DEFAULT_BASE_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Operator URL must use HTTPS");
  return url.origin;
}

async function call(path, init = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${operatorSecret()}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  return payload;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "list") {
    const status = args[0] ?? "pending";
    const limit = args[1] ?? "20";
    if (!new Set(["pending", "completed", "all"]).has(status) || !/^\d+$/.test(limit)) throw new Error("Invalid list arguments");
    const payload = await call(`/api/internal/telegram/bug-reports?status=${status}&limit=${limit}`);
    process.stdout.write(`${JSON.stringify(payload.reports, null, 2)}\n`);
    return;
  }
  if (command === "complete") {
    const [messageId, commit, deploymentUrl] = args;
    if (!/^\d+$/.test(messageId ?? "") || !/^[0-9a-f]{7,40}$/.test(commit ?? "") || !deploymentUrl) throw new Error("Invalid completion arguments");
    const payload = await call(`/api/internal/telegram/bug-reports/${messageId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commit, deploymentUrl }),
    });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`telegram:bugs failed: ${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 1;
});
