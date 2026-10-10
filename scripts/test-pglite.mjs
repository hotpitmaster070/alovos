// Runs the PGlite database tests (supabase/tests/*.test.mjs) one by one and fails if any of them fails.
// Usage: PGLITE_DIR=/path/to/node_modules node scripts/test-pglite.mjs [name ...]
//   name: a test file without ".test.mjs" (e.g. default_zones); none = all.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve("supabase/tests");
const TIMEOUT_MS = 15 * 60 * 1000;

if (!process.env.PGLITE_DIR) {
  console.error("Set PGLITE_DIR to a node_modules directory that contains @electric-sql/pglite");
  process.exit(2);
}

const wanted = process.argv.slice(2);
const all = fs.readdirSync(DIR).filter((f) => f.endsWith(".test.mjs")).map((f) => f.slice(0, -".test.mjs".length)).sort();
const unknown = wanted.filter((name) => !all.includes(name));
if (unknown.length) {
  console.error(`Unknown test(s): ${unknown.join(", ")}`);
  process.exit(2);
}

let failed = 0;
for (const name of wanted.length ? wanted : all) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(DIR, `${name}.test.mjs`)], { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = out.match(/^\d+ passed, \d+ failed$/m)?.[0] ?? (run.error ? run.error.message : "no summary");
  const good = run.status === 0;
  if (!good) failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}: ${summary} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (!good) {
    const lines = out.split("\n");
    const failures = lines.filter((l) => /^(FAIL|ERROR)/.test(l));
    // A crash before the summary: its own output says why.
    for (const line of failures.length ? failures : lines.filter(Boolean).slice(-15)) console.log(`     ${line.slice(0, 400)}`);
  }
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nall PGlite tests passed");
process.exit(failed ? 1 : 0);
