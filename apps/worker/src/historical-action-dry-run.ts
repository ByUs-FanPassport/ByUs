import { readFile } from "node:fs/promises";
import { buildHistoricalDryRunReport } from "./historical-action-classifier.js";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: historical-action-dry-run <evidence.json>");
const input = JSON.parse(await readFile(inputPath, "utf8"));
process.stdout.write(`${JSON.stringify(buildHistoricalDryRunReport(input), null, 2)}\n`);
