import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const verification = await readFile(new URL("./verify-g5-content-cms-dev.sql", import.meta.url), "utf8");
const sql = `begin;\n${verification.replace(/^\\set[^\n]*\n/, "")}\nrollback;`;
const child = spawn("npx", ["supabase", "db", "query", "--linked", sql], { cwd: new URL("..", import.meta.url), stdio: "inherit" });
const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
if (exitCode !== 0) process.exit(Number(exitCode) || 1);
console.log("CMS_DEV_PROOF transaction=rolled_back");
