// Fails when a products/locations query in the ANBAR feature is missing the organization filter,
// or when stock quantity/location is changed with a direct update instead of the move_stock RPC.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib/anbar", "app/(app)/app/anbar", "components/anbar", "components/auth"];
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
};
ROOTS.forEach(walk);

const violations = [];
let checked = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\.from\(\s*["'](products|locations)["']\s*\)/g)) {
    const end = source.indexOf(";", match.index);
    const statement = source.slice(match.index, end === -1 ? undefined : end);
    checked += 1;
    if (match[1] === "products" && !/tenant_id/.test(statement)) {
      violations.push(`${file}: .from("${match[1]}") without tenant_id`);
    }
    if (!/organization_id/.test(statement)) {
      violations.push(`${file}: .from("${match[1]}") without organization_id`);
    }
    if (match[1] === "products" && /\.(update|delete|upsert)\(/.test(statement)) {
      violations.push(`${file}: direct ${match[0]} update/delete; stock moves must use the RPC`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`org-scope check passed: ${checked} products/locations statements in ${files.length} files`);
