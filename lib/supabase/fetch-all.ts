type RangeResult = { data: unknown; error: { message: string } | null };

const CHUNK = 1000;

/**
 * Every row of a query, read in .range() chunks until an empty one. PostgREST caps a response at its
 * max-rows setting, so one request is not enough for reference data that must be complete
 * (branches, storage places, cost lookups). The query must have a stable order.
 */
export async function fetchAll(query: (from: number, to: number) => PromiseLike<RangeResult>): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (;;) {
    const { data, error } = await query(rows.length, rows.length + CHUNK - 1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length === 0) return rows;
    rows.push(...data);
  }
}
