/**
 * Branch-to-branch transfer: request shape, database error mapping and the error texts the API returns
 * (AZ / RU / EN). The transfer itself is public.transfer_stock_between_branches(), one transaction.
 */

export const TRANSFER_MAX_ITEMS = 200;
export const TRANSFER_MAX_QUANTITY = 1_000_000;
export const TRANSFER_NOTE_MAX = 500;

export const TRANSFER_ERRORS = [
  "forbidden",
  "invalid_input",
  "same_branch",
  "from_branch_not_found",
  "to_branch_not_found",
  "product_not_found",
  "location_not_found",
  "open_count",
  "insufficient_stock",
  "save_failed",
] as const;
export type TransferError = (typeof TRANSFER_ERRORS)[number];

export const TRANSFER_STATUS: Record<TransferError, number> = {
  forbidden: 403,
  invalid_input: 400,
  same_branch: 400,
  from_branch_not_found: 404,
  to_branch_not_found: 404,
  product_not_found: 404,
  location_not_found: 404,
  open_count: 409,
  insufficient_stock: 400,
  save_failed: 500,
};

export type TransferItem = {
  productId: string;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
};
export type TransferInput = { fromBranchId: string; toBranchId: string; items: TransferItem[]; note: string | null };

/** A product the source branch cannot cover; available excludes expired stock. */
export type Shortage = { productId: string; requested: number; available: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalId = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
};
const requiredId = (value: unknown): string | undefined => {
  const id = optionalId(value);
  return id ?? undefined;
};

type Places = { fromLocationId: string | null; toLocationId: string | null };

function parseItem(raw: unknown, defaults: Places): TransferItem | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const productId = requiredId(record.product_id);
  const fromLocationId = record.from_location_id == null ? defaults.fromLocationId : optionalId(record.from_location_id);
  const toLocationId = record.to_location_id == null ? defaults.toLocationId : optionalId(record.to_location_id);
  const quantity = record.quantity;
  if (!productId || fromLocationId === undefined || toLocationId === undefined) return null;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > TRANSFER_MAX_QUANTITY) return null;
  return { productId, quantity, fromLocationId, toLocationId };
}

/**
 * {from_branch_id, to_branch_id, from_location_id?, to_location_id?, items: [{product_id, quantity,
 * from_location_id?, to_location_id?}], note?}. Top-level places apply to items that name none.
 * The single-product shape of the earlier endpoint ({product_id, quantity, from_location_id, to_location_id}
 * at the top level) is read as one item. No tenant field: the database takes it from the session.
 */
export function parseTransferInput(body: Record<string, unknown> | null): TransferInput | null {
  if (!body) return null;
  const fromBranchId = requiredId(body.from_branch_id);
  const toBranchId = requiredId(body.to_branch_id);
  const fromLocationId = optionalId(body.from_location_id);
  const toLocationId = optionalId(body.to_location_id);
  if (!fromBranchId || !toBranchId || fromLocationId === undefined || toLocationId === undefined) return null;
  const defaults: Places = { fromLocationId, toLocationId };

  const rawItems = Array.isArray(body.items) ? body.items : body.items === undefined && "product_id" in body ? [body] : null;
  if (!rawItems || rawItems.length === 0 || rawItems.length > TRANSFER_MAX_ITEMS) return null;
  const items: TransferItem[] = [];
  const keys = new Set<string>();
  for (const raw of rawItems) {
    const item = parseItem(raw, defaults);
    if (!item) return null;
    const key = `${item.productId}:${item.fromLocationId ?? ""}`;
    if (keys.has(key)) return null;
    keys.add(key);
    items.push(item);
  }

  const note = typeof body.note === "string" ? body.note.trim() : body.note === undefined || body.note === null ? "" : null;
  if (note === null || note.length > TRANSFER_NOTE_MAX) return null;
  return { fromBranchId, toBranchId, items, note: note === "" ? null : note };
}

/** p_items for public.transfer_stock_between_branches(). */
export const rpcItems = (items: TransferItem[]) =>
  items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    from_location_id: item.fromLocationId,
    to_location_id: item.toLocationId,
  }));

/** The database raises the code as the message; anything else is save_failed. */
export function mapTransferError(message: string | null | undefined): TransferError {
  const text = message ?? "";
  return TRANSFER_ERRORS.find((code) => code !== "save_failed" && text.includes(code)) ?? "save_failed";
}

/** DETAIL of insufficient_stock: [{product_id, requested, available}]. */
export function parseShortages(details: string | null | undefined): Shortage[] {
  if (!details) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const requested = Number(record.requested);
    const available = Number(record.available);
    if (typeof record.product_id !== "string" || !Number.isFinite(requested) || !Number.isFinite(available)) return [];
    return [{ productId: record.product_id, requested, available }];
  });
}

export const TRANSFER_LANGS = ["az", "ru", "en"] as const;
export type TransferLang = (typeof TRANSFER_LANGS)[number];

/** Explicit ?lang / x-alovos-lang first, then Accept-Language; Azerbaijani by default like the app. */
export function pickTransferLang(explicit: string | null, acceptLanguage: string | null): TransferLang {
  const wanted = [explicit ?? "", ...(acceptLanguage ?? "").split(",").map((part) => part.split(";")[0])];
  for (const tag of wanted) {
    const base = tag.trim().toLowerCase().slice(0, 2);
    if ((TRANSFER_LANGS as readonly string[]).includes(base)) return base as TransferLang;
  }
  return "az";
}

type Messages = Record<TransferError, string> & { shortageLine: (name: string, requested: string, available: string) => string };

export const TRANSFER_MESSAGES: Record<TransferLang, Messages> = {
  az: {
    forbidden: "Filiallar arası köçürmə yalnız sahib və şef üçündür.",
    invalid_input: "Sorğu yanlışdır: filialları, məhsulları və miqdarları yoxlayın.",
    same_branch: "Göndərən və qəbul edən filial eyni ola bilməz.",
    from_branch_not_found: "Göndərən filial tapılmadı.",
    to_branch_not_found: "Qəbul edən filial tapılmadı.",
    product_not_found: "Məhsul tapılmadı.",
    location_not_found: "Saxlama yeri tapılmadı.",
    open_count: "Bu yerdə sayım açıqdır — əvvəlcə sayımı bağlayın.",
    insufficient_stock: "Anbarda kifayət qədər qalıq yoxdur. Heç nə köçürülmədi.",
    save_failed: "Köçürmə alınmadı, heç nə dəyişmədi.",
    shortageLine: (name, requested, available) => `${name}: lazımdır ${requested}, var ${available}`,
  },
  ru: {
    forbidden: "Перемещение между филиалами доступно только владельцу и шефу.",
    invalid_input: "Неверный запрос: проверьте филиалы, товары и количества.",
    same_branch: "Филиал-отправитель и филиал-получатель не могут совпадать.",
    from_branch_not_found: "Филиал-отправитель не найден.",
    to_branch_not_found: "Филиал-получатель не найден.",
    product_not_found: "Товар не найден.",
    location_not_found: "Место хранения не найдено.",
    open_count: "В этом месте открыта инвентаризация — сначала завершите её.",
    insufficient_stock: "Недостаточно остатка на складе. Ничего не перемещено.",
    save_failed: "Перемещение не удалось, ничего не изменилось.",
    shortageLine: (name, requested, available) => `${name}: нужно ${requested}, есть ${available}`,
  },
  en: {
    forbidden: "Only owners and chefs can transfer stock between branches.",
    invalid_input: "Invalid request: check the branches, products and quantities.",
    same_branch: "The sending and receiving branch must differ.",
    from_branch_not_found: "Sending branch not found.",
    to_branch_not_found: "Receiving branch not found.",
    product_not_found: "Product not found.",
    location_not_found: "Storage place not found.",
    open_count: "A stock count is open in this place — finish it first.",
    insufficient_stock: "Not enough stock. Nothing was transferred.",
    save_failed: "The transfer failed; nothing changed.",
    shortageLine: (name, requested, available) => `${name}: need ${requested}, have ${available}`,
  },
};
