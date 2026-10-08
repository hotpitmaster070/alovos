// Fails when a tenant table query in the ANBAR feature is missing the tenant filter, or when
// products/product_stocks are changed directly instead of through stock_movements.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TENANT_TABLES = ["products", "product_stocks", "storage_locations", "stock_movements", "kitchen_tasks"];
const ROOTS = ["lib/anbar", "app/(app)/app/anbar", "app/api/stock", "components/anbar", "components/auth"];
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
  for (const match of source.matchAll(/\.from\(\s*["'](products|product_stocks|storage_locations|stock_movements|kitchen_tasks)["']\s*\)/g)) {
    const end = source.indexOf(";", match.index);
    const statement = source.slice(match.index, end === -1 ? undefined : end);
    checked += 1;
    if (TENANT_TABLES.includes(match[1]) && !/tenant_id/.test(statement)) {
      violations.push(`${file}: .from("${match[1]}") without tenant_id`);
    }
    if (match[1] === "products" && /\.(update|delete|upsert)\(/.test(statement)) {
      violations.push(`${file}: direct ${match[0]} update/delete`);
    }
    if (match[1] === "product_stocks" && /\.(insert|update|delete|upsert)\(/.test(statement)) {
      violations.push(`${file}: product_stocks is updated only by the stock_movements trigger`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`tenant-scope check passed: ${checked} tenant table statements in ${files.length} files`);
