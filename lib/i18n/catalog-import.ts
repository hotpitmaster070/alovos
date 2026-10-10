import type { ImportRequestError } from "@/lib/import/catalog";
import type { ImportFileError } from "@/lib/import/parse";
import type { ImportErrorCode, ImportField } from "@/lib/import/model";
import { ruPlural } from "./plural";

export type CatalogImportDictionary = {
  open: string;
  title: string;
  subtitle: string;
  back: string;
  forbidden: string;
  branch: string;
  noBranch: string;
  location: string;
  locationHint: string;
  drop: {
    title: string;
    active: string;
    hint: (maxRows: number, maxMb: number) => string;
    browse: string;
    template: string;
  };
  checking: string;
  another: string;
  summary: { valid: (count: number) => string; errors: (count: number) => string; stocked: (count: number) => string };
  ignored: (columns: string) => string;
  filter: { all: string; errors: string };
  table: { row: string; status: string; ok: string };
  fields: Record<ImportField, string>;
  rowErrors: Record<ImportErrorCode, string>;
  fileErrors: Record<ImportFileError, string>;
  requestErrors: Record<ImportRequestError, string>;
  network: string;
  submit: (count: number) => string;
  fixFirst: (count: number) => string;
  phase: { upload: string; write: string };
  done: (count: number, seconds: string) => string;
  doneStocked: (count: number) => string;
  redirecting: string;
};

const ruCount = {
  products: (n: number) => `${n} ${ruPlural(n, "товар", "товара", "товаров")}`,
  rows: (n: number) => `${n} ${ruPlural(n, "строка", "строки", "строк")}`,
  errors: (n: number) => `${n} ${ruPlural(n, "ошибка", "ошибки", "ошибок")}`,
};

export const CATALOG_IMPORT_AZ: CatalogImportDictionary = {
  open: "İdxal",
  title: "Kataloqun idxalı",
  subtitle: "CSV və ya Excel faylı: əvvəlcə yoxlama, sonra hamısı bir əməliyyatda yazılır və ya heç biri yazılmır.",
  back: "Kataloq",
  forbidden: "İdxal yalnız sahib və şef üçündür.",
  branch: "Filial",
  noBranch: "Filialsız (yalnız kataloq, qalıqsız)",
  location: "Standart saxlama yeri",
  locationHint: "Faylda yer göstərilməyən qalıqlar bura qəbul olunur.",
  drop: {
    title: "Faylı bura atın",
    active: "Buraxın — yoxlayaq",
    hint: (maxRows, maxMb) => `CSV, XLSX · ${maxRows} sətrə qədər · ${maxMb} MB-a qədər`,
    browse: "Fayl seçin",
    template: "CSV şablonunu yükləyin",
  },
  checking: "Fayl yoxlanılır…",
  another: "Başqa fayl",
  summary: {
    valid: (n) => `${n} hazırdır`,
    errors: (n) => `${n} xəta`,
    stocked: (n) => `${n} qalıqla`,
  },
  ignored: (columns) => `Tanınmayan sütunlar nəzərə alınmır: ${columns}`,
  filter: { all: "Hamısı", errors: "Yalnız xətalar" },
  table: { row: "Sətir", status: "Status", ok: "Hazırdır" },
  fields: {
    name: "Ad",
    unit: "Vahid",
    barcode: "Barkod",
    category: "Kateqoriya",
    price: "Qiymət",
    shelf_life_days: "Saxlama, gün",
    min_stock: "Minimum",
    initial_stock: "Qalıq",
    location: "Yer",
    expiry_date: "Son tarix",
  },
  rowErrors: {
    required: "boş ola bilməz",
    too_short: "çox qısadır",
    too_long: "çox uzundur",
    invalid_unit: "naməlum vahid",
    invalid_number: "rəqəm deyil",
    not_integer: "tam ədəd olmalıdır",
    negative: "mənfi ola bilməz",
    too_large: "çox böyükdür",
    duplicate_in_file: "faylda təkrarlanır",
    exists: "kataloqda artıq var",
    invalid_date: "tarix İİİİ-AA-GG olmalıdır",
    expiry_past: "tarix keçib",
    branch_required: "qalıq üçün filial seçin",
    location_not_found: "belə yer yoxdur",
    invalid: "yanlış dəyər",
  },
  fileErrors: {
    empty: "Fayl boşdur.",
    unsupported: "Yalnız CSV və XLSX faylları.",
    too_large: "Fayl çox böyükdür.",
    too_many_rows: "Sətir çox çoxdur.",
    no_name_column: "Ad sütunu tapılmadı.",
    unreadable: "Faylı oxumaq mümkün olmadı.",
  },
  requestErrors: {
    unauthenticated: "Yenidən daxil olun.",
    no_tenant: "Müəssisə tapılmadı.",
    forbidden: "İdxal yalnız sahib və şef üçündür.",
    branch_not_found: "Filial tapılmadı.",
    location_not_found: "Saxlama yeri tapılmadı.",
    conflict: "Kimsə eyni anda məhsul əlavə etdi — faylı yenidən yoxlayın.",
    invalid_input: "Sorğu yanlışdır.",
    save_failed: "Yazmaq alınmadı, heç nə dəyişmədi.",
  },
  network: "Şəbəkə xətası, heç nə dəyişmədi.",
  submit: (n) => `${n} məhsulu idxal et`,
  fixFirst: (n) => `Əvvəlcə ${n} xətanı düzəldin`,
  phase: { upload: "Yüklənir", write: "Bazaya yazılır" },
  done: (n, seconds) => `${n} məhsul ${seconds} saniyəyə idxal olundu`,
  doneStocked: (n) => `${n} məhsul qalıqla anbara qəbul olundu`,
  redirecting: "Kataloqa keçid…",
};

export const CATALOG_IMPORT_RU: CatalogImportDictionary = {
  open: "Импорт",
  title: "Импорт каталога",
  subtitle: "Файл CSV или Excel: сначала проверка, затем всё записывается одной транзакцией — или ничего.",
  back: "Каталог",
  forbidden: "Импорт доступен только владельцу и шефу.",
  branch: "Филиал",
  noBranch: "Без филиала (только каталог, без остатков)",
  location: "Место хранения по умолчанию",
  locationHint: "Сюда принимаются остатки, для которых в файле не указано место.",
  drop: {
    title: "Перетащите файл сюда",
    active: "Отпустите — проверим",
    hint: (maxRows, maxMb) => `CSV, XLSX · до ${maxRows} строк · до ${maxMb} МБ`,
    browse: "Выбрать файл",
    template: "Скачать шаблон CSV",
  },
  checking: "Проверяем файл…",
  another: "Другой файл",
  summary: {
    valid: (n) => `Готово: ${ruCount.rows(n)}`,
    errors: (n) => ruCount.errors(n),
    stocked: (n) => `${n} с остатком`,
  },
  ignored: (columns) => `Нераспознанные колонки пропущены: ${columns}`,
  filter: { all: "Все", errors: "Только ошибки" },
  table: { row: "Строка", status: "Статус", ok: "Готово" },
  fields: {
    name: "Название",
    unit: "Ед.",
    barcode: "Штрихкод",
    category: "Категория",
    price: "Цена",
    shelf_life_days: "Срок, дн.",
    min_stock: "Минимум",
    initial_stock: "Остаток",
    location: "Место",
    expiry_date: "Годен до",
  },
  rowErrors: {
    required: "не заполнено",
    too_short: "слишком коротко",
    too_long: "слишком длинно",
    invalid_unit: "неизвестная единица",
    invalid_number: "не число",
    not_integer: "нужно целое число",
    negative: "не может быть меньше нуля",
    too_large: "слишком большое",
    duplicate_in_file: "повторяется в файле",
    exists: "уже есть в каталоге",
    invalid_date: "дата в формате ГГГГ-ММ-ДД",
    expiry_past: "дата уже прошла",
    branch_required: "для остатка выберите филиал",
    location_not_found: "такого места нет",
    invalid: "неверное значение",
  },
  fileErrors: {
    empty: "Файл пустой.",
    unsupported: "Только файлы CSV и XLSX.",
    too_large: "Файл слишком большой.",
    too_many_rows: "Слишком много строк.",
    no_name_column: "Не найдена колонка с названием.",
    unreadable: "Не удалось прочитать файл.",
  },
  requestErrors: {
    unauthenticated: "Войдите заново.",
    no_tenant: "Организация не найдена.",
    forbidden: "Импорт доступен только владельцу и шефу.",
    branch_not_found: "Филиал не найден.",
    location_not_found: "Место хранения не найдено.",
    conflict: "Кто-то одновременно добавил товар — проверьте файл ещё раз.",
    invalid_input: "Неверный запрос.",
    save_failed: "Не удалось записать, ничего не изменилось.",
  },
  network: "Ошибка сети, ничего не изменилось.",
  submit: (n) => `Импортировать ${ruCount.products(n)}`,
  fixFirst: (n) => `Сначала исправьте ${n} ${ruPlural(n, "ошибку", "ошибки", "ошибок")}`,
  phase: { upload: "Загрузка", write: "Запись в базу" },
  done: (n, seconds) => `${ruCount.products(n)} за ${seconds} с`,
  doneStocked: (n) => `${n} с остатком принято на склад`,
  redirecting: "Переходим в каталог…",
};

export const CATALOG_IMPORT_EN: CatalogImportDictionary = {
  open: "Import",
  title: "Catalog import",
  subtitle: "CSV or Excel file: checked first, then everything is written in one transaction — or nothing is.",
  back: "Catalog",
  forbidden: "Only owners and chefs can import.",
  branch: "Branch",
  noBranch: "No branch (catalog only, no stock)",
  location: "Default storage place",
  locationHint: "Stock without a place in the file is received here.",
  drop: {
    title: "Drop the file here",
    active: "Release to check it",
    hint: (maxRows, maxMb) => `CSV, XLSX · up to ${maxRows} rows · up to ${maxMb} MB`,
    browse: "Choose file",
    template: "Download CSV template",
  },
  checking: "Checking the file…",
  another: "Another file",
  summary: {
    valid: (n) => `${n} ready`,
    errors: (n) => `${n} ${n === 1 ? "error" : "errors"}`,
    stocked: (n) => `${n} with stock`,
  },
  ignored: (columns) => `Unrecognised columns skipped: ${columns}`,
  filter: { all: "All", errors: "Errors only" },
  table: { row: "Row", status: "Status", ok: "Ready" },
  fields: {
    name: "Name",
    unit: "Unit",
    barcode: "Barcode",
    category: "Category",
    price: "Price",
    shelf_life_days: "Shelf life, days",
    min_stock: "Minimum",
    initial_stock: "Stock",
    location: "Place",
    expiry_date: "Use by",
  },
  rowErrors: {
    required: "is empty",
    too_short: "is too short",
    too_long: "is too long",
    invalid_unit: "unknown unit",
    invalid_number: "not a number",
    not_integer: "must be a whole number",
    negative: "cannot be negative",
    too_large: "is too large",
    duplicate_in_file: "repeats in the file",
    exists: "already in the catalog",
    invalid_date: "date must be YYYY-MM-DD",
    expiry_past: "date has passed",
    branch_required: "choose a branch for stock",
    location_not_found: "no such place",
    invalid: "invalid value",
  },
  fileErrors: {
    empty: "The file is empty.",
    unsupported: "CSV and XLSX files only.",
    too_large: "The file is too large.",
    too_many_rows: "Too many rows.",
    no_name_column: "No name column found.",
    unreadable: "The file could not be read.",
  },
  requestErrors: {
    unauthenticated: "Please sign in again.",
    no_tenant: "Organization not found.",
    forbidden: "Only owners and chefs can import.",
    branch_not_found: "Branch not found.",
    location_not_found: "Storage place not found.",
    conflict: "Someone added a product at the same time — check the file again.",
    invalid_input: "Invalid request.",
    save_failed: "Could not write; nothing changed.",
  },
  network: "Network error; nothing changed.",
  submit: (n) => `Import ${n} ${n === 1 ? "product" : "products"}`,
  fixFirst: (n) => `Fix ${n} ${n === 1 ? "error" : "errors"} first`,
  phase: { upload: "Uploading", write: "Writing to the database" },
  done: (n, seconds) => `${n} ${n === 1 ? "product" : "products"} in ${seconds} s`,
  doneStocked: (n) => `${n} received into stock`,
  redirecting: "Opening the catalog…",
};
