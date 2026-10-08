import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { PAGE_SIZE } from "@/lib/pagination";

export type RowPage = {
  rows: Record<string, unknown>[];
  page: number;
  hasMore: boolean;
};

export type PageParams = Record<string, string | string[] | undefined>;

/** 1-based page number from ?{param}=n; anything else is page 1. */
export function pageParam(params: PageParams, param: string): number {
  const raw = params[param];
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value > 1 ? value : 1;
}

export async function loadRows(path: string, table: string, columns: string, page: number): Promise<RowPage> {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, path);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const from = (page - 1) * PAGE_SIZE;
  // One extra row tells whether a next page exists.
  const { data, error } = await gated.scope.client
    .from(table)
    .select(columns)
    .eq("tenant_id", gated.scope.tenantId)
    .order("id")
    .range(from, from + PAGE_SIZE);
  if (error) throw error;
  const rows = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  return { rows: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE };
}
