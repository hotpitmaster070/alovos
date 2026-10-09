import InvoiceUpload from "@/components/modules/invoice-upload";
import { RecordList, type RecordGroup } from "@/components/modules/record-list";
import { loadRows, pageParam, type PageParams } from "@/lib/modules/load";

type PageProps = { searchParams: PageParams };

/** One paginated group per table; the page lives in ?{table}=n so groups page independently. */
async function group(path: string, table: string, columns: string, params: PageParams): Promise<RecordGroup> {
  const page = await loadRows(path, table, columns, pageParam(params, table));
  return { label: table, param: table, ...page };
}

const query = (params: PageParams): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      return first === undefined ? [] : [[key, first]];
    }),
  );

export async function SupplyPage({ searchParams }: PageProps) {
  const groups = await Promise.all([
    group("/app/techizat", "suppliers", "id, code, name, contact, rating, lead_time_days", searchParams),
    group("/app/techizat", "purchase_requests", "id, status, auto_created, request_date", searchParams),
    group("/app/techizat", "purchase_orders", "id, status, created_at", searchParams),
  ]);
  return <RecordList slug="techizat" groups={groups} query={query(searchParams)} />;
}

export async function InvoicePage({ searchParams }: PageProps) {
  const groups = await Promise.all([
    group("/app/hesablar", "invoices", "id, total, created_at", searchParams),
    group("/app/hesablar", "price_alerts", "id, contract_price, invoice_price, created_at", searchParams),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <InvoiceUpload />
      <RecordList slug="hesablar" groups={groups} query={query(searchParams)} />
    </div>
  );
}

export async function RecipePage({ searchParams }: PageProps) {
  const groups = [await group("/app/reseptler", "tech_cards", "id, name, allergens, calories", searchParams)];
  return <RecordList slug="reseptler" groups={groups} query={query(searchParams)} />;
}

export async function PrepPage({ searchParams }: PageProps) {
  const groups = [await group("/app/hazirliq", "prep_tasks", "id, title, quantity, for_date, status", searchParams)];
  return <RecordList slug="hazirliq" groups={groups} query={query(searchParams)} />;
}

export async function PosPage({ searchParams }: PageProps) {
  const groups = [await group("/app/pos", "pos_integrations", "id, type, created_at", searchParams)];
  return <RecordList slug="pos" groups={groups} query={query(searchParams)} />;
}

export async function ReportPage({ searchParams }: PageProps) {
  const groups = await Promise.all([
    group("/app/analitika", "stock_movements", "id, movement_type, quantity, created_at", searchParams),
    group("/app/analitika", "price_alerts", "id, contract_price, invoice_price, created_at", searchParams),
  ]);
  return <RecordList slug="analitika" groups={groups} query={query(searchParams)} />;
}

export async function StaffPage({ searchParams }: PageProps) {
  const groups = await Promise.all([
    group("/app/komanda", "staff", "id, role, hourly_rate", searchParams),
    group("/app/komanda", "shifts", "id, started_at, ended_at", searchParams),
  ]);
  return <RecordList slug="komanda" groups={groups} query={query(searchParams)} />;
}

export async function HaccpPage({ searchParams }: PageProps) {
  const groups = [await group("/app/haccp", "haccp_logs", "id, kind, reading, note, created_at", searchParams)];
  return <RecordList slug="haccp" groups={groups} query={query(searchParams)} />;
}
