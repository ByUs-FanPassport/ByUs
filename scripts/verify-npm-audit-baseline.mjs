import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const baselineUrl = new URL("./security-audit-baseline.json", import.meta.url);
const baseline = JSON.parse(await readFile(baselineUrl, "utf8"));
const reportArgument = process.argv.find((argument) => argument.startsWith("--report="));

let rawReport;
let auditExitCode = 0;

if (reportArgument) {
  const reportPath = reportArgument.slice("--report=".length);
  if (!reportPath) throw new Error("--report requires a JSON file path");
  rawReport = await readFile(reportPath, "utf8");
} else {
  const auditEnvironment = { ...process.env };
  // npm injects user-level lifecycle configuration into npm-run scripts. That
  // value is unrelated to a read-only audit and npm 11 rejects it at project scope.
  delete auditEnvironment.npm_config_allow_scripts;

  const audit = spawnSync(
    "npm",
    ["audit", "--omit=dev", "--ignore-scripts", "--json"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: auditEnvironment,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (audit.error) throw audit.error;
  auditExitCode = audit.status ?? 1;
  rawReport = audit.stdout;

  if (audit.stderr.trim()) process.stderr.write(audit.stderr);
}

let report;
try {
  report = JSON.parse(rawReport);
} catch (error) {
  throw new Error(`npm audit did not return valid JSON (exit ${auditExitCode})`, { cause: error });
}

const counts = report?.metadata?.vulnerabilities;
if (!counts || !Number.isInteger(counts.moderate)
  || !Number.isInteger(counts.high) || !Number.isInteger(counts.critical)) {
  const auditError = report?.error?.summary ?? report?.error?.code ?? "missing vulnerability metadata";
  throw new Error(`npm audit could not be evaluated: ${auditError}`);
}

const failures = [];
if (counts.critical > baseline.maximum.critical) {
  failures.push(`critical vulnerabilities: ${counts.critical} (allowed ${baseline.maximum.critical})`);
}
if (counts.high > baseline.maximum.high) {
  failures.push(`high vulnerabilities: ${counts.high} (allowed ${baseline.maximum.high})`);
}
if (counts.moderate > baseline.maximum.moderate) {
  failures.push(`moderate vulnerabilities: ${counts.moderate} (baseline ${baseline.maximum.moderate})`);
}

const moderateVulnerabilities = Object.entries(report.vulnerabilities ?? {})
  .filter(([, vulnerability]) => vulnerability?.severity === "moderate");
const allowedVulnerabilities = new Set(baseline.allowedModerateVulnerabilities ?? []);
const newVulnerabilities = moderateVulnerabilities
  .map(([name]) => name)
  .filter((name) => !allowedVulnerabilities.has(name));
if (newVulnerabilities.length > 0) {
  failures.push(`new moderate vulnerability paths: ${newVulnerabilities.sort().join(", ")}`);
}

const allowedAdvisories = new Set(baseline.allowedModerateAdvisories ?? []);
const observedAdvisories = moderateVulnerabilities.flatMap(([, vulnerability]) =>
  (vulnerability.via ?? [])
    .filter((via) => typeof via === "object" && via !== null && Number.isInteger(via.source))
    .map((via) => via.source),
);
const newAdvisories = [...new Set(observedAdvisories)]
  .filter((source) => !allowedAdvisories.has(source));
if (newAdvisories.length > 0) {
  failures.push(`new moderate advisory IDs: ${newAdvisories.sort((left, right) => left - right).join(", ")}`);
}

const summary = [
  `critical ${counts.critical}/${baseline.maximum.critical}`,
  `high ${counts.high}/${baseline.maximum.high}`,
  `moderate ${counts.moderate}/${baseline.maximum.moderate}`,
].join(", ");

if (failures.length > 0) {
  throw new Error(`npm audit baseline failed (${summary}):\n- ${failures.join("\n- ")}`);
}

console.log(`npm audit baseline passed: ${summary}.`);
if (counts.moderate > 0) {
  console.log(`Tracked moderate advisories remain open; review ${baseline.trackingDocument}.`);
}
