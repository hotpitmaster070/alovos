// Fails when a tenant table query in the ANBAR feature is missing the tenant filter, or when
// products/product_stocks are changed directly instead of through stock_movements.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TENANT_TABLES = [
  "products",
  "product_stocks",
  "storage_locations",
  "stock_movements",
  "kitchen_tasks",
  "suppliers",
  "purchase_requests",
  "invitations",
  "low_stock_with_forecast",
  "product_lots",
  "product_shelf_life_rules",
  "preparations",
  "label_print_logs",
  "tenant_settings",
  "wastage_logs",
  "preparation_runs",
];
const ROOTS = [
  "lib/anbar",
  "lib/purchasing",
  "lib/labels",
  "app/(app)/app/anbar",
  "app/(app)/app/zaqotovka",
  "app/api/lots",
  "app/api/labels",
  "app/api/shelf-life-rules",
  "app/api/preparations",
  "app/api/wastage",
  "components/labels",
  "app/(app)/app/sebeke",
  "app/(app)/app/sifarisler",
  "app/api/stock",
  "app/api/anbar",
  "app/api/suppliers",
  "app/api/purchase-requests",
  "app/api/products",
  "app/api/invitations",
  "components/anbar",
  "components/auth",
  "components/purchasing",
];
const FROM_TENANT_TABLE = new RegExp(`\\.from\\(\\s*["'](${TENANT_TABLES.join("|")})["']\\s*\\)`, "g");
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
  for (const match of source.matchAll(FROM_TENANT_TABLE)) {
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
