import InvoiceUpload from "@/components/modules/invoice-upload";
import { RecordList } from "@/components/modules/record-list";
import { loadRows } from "@/lib/modules/load";

export async function SupplyPage() {
  const [suppliers, orders] = await Promise.all([
    loadRows("/app/techizat", "suppliers", "id, name, contact, rating, delivery_days"),
    loadRows("/app/techizat", "purchase_orders", "id, status, created_at"),
  ]);
  return <RecordList slug="techizat" groups={[{ label: "suppliers", rows: suppliers }, { label: "purchase_orders", rows: orders }]} />;
}

export async function InvoicePage() {
  const [invoices, alerts] = await Promise.all([
    loadRows("/app/hesablar", "invoices", "id, total, created_at"),
    loadRows("/app/hesablar", "price_alerts", "id, contract_price, invoice_price, created_at"),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <InvoiceUpload />
      <RecordList slug="hesablar" groups={[{ label: "invoices", rows: invoices }, { label: "price_alerts", rows: alerts }]} />
    </div>
  );
}

export async function RecipePage() {
  const cards = await loadRows("/app/reseptler", "tech_cards", "id, name, allergens, calories");
  return <RecordList slug="reseptler" groups={[{ label: "tech_cards", rows: cards }]} />;
}

export async function PrepPage() {
  const rows = await loadRows("/app/hazirliq", "prep_tasks", "id, title, quantity, for_date, status");
  return <RecordList slug="hazirliq" groups={[{ label: "prep_tasks", rows }]} />;
}

export async function PosPage() {
  const rows = await loadRows("/app/pos", "pos_integrations", "id, type, created_at");
  return <RecordList slug="pos" groups={[{ label: "pos_integrations", rows }]} />;
}

export async function ReportPage() {
  const [movements, alerts] = await Promise.all([
    loadRows("/app/analitika", "stock_movements", "id, movement_type, quantity, created_at"),
    loadRows("/app/analitika", "price_alerts", "id, contract_price, invoice_price, created_at"),
  ]);
  return <RecordList slug="analitika" groups={[{ label: "stock_movements", rows: movements }, { label: "price_alerts", rows: alerts }]} />;
}

export async function StaffPage() {
  const [staff, shifts] = await Promise.all([
    loadRows("/app/komanda", "staff", "id, role, hourly_rate"),
    loadRows("/app/komanda", "shifts", "id, started_at, ended_at"),
  ]);
  return <RecordList slug="komanda" groups={[{ label: "staff", rows: staff }, { label: "shifts", rows: shifts }]} />;
}

export async function HaccpPage() {
  const rows = await loadRows("/app/haccp", "haccp_logs", "id, kind, reading, note, created_at");
  return <RecordList slug="haccp" groups={[{ label: "haccp_logs", rows }]} />;
}
