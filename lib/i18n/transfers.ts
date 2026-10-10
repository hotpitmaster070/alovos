import { ruPlural } from "./plural";

export type TransfersDictionary = {
  open: string;
  title: string;
  subtitle: string;
  back: string;
  forbidden: string;
  needTwoBranches: string;
  from: string;
  to: string;
  branch: string;
  place: string;
  anyPlace: string;
  autoPlace: string;
  search: { label: string; placeholder: string; searching: string; empty: (query: string) => string; add: string; added: string };
  table: { product: string; available: string; expiry: string; quantity: string; remove: string };
  available: (quantity: string, unit: string) => string;
  noExpiry: string;
  lineErrors: { quantity: string; exceeds: (available: string) => string };
  empty: string;
  lines: (count: number) => string;
  note: string;
  notePlaceholder: string;
  submit: (count: number) => string;
  submitting: string;
  fixLines: string;
  tooMany: (max: number) => string;
  optionsErrors: { unauthenticated: string; forbidden: string; invalid_input: string; not_found: string; save_failed: string };
  network: string;
  success: { title: string; number: (number: string) => string; moved: (count: number) => string; print: string; open: string; another: string; redirecting: string };
  invoice: {
    title: string;
    number: string;
    date: string;
    from: string;
    to: string;
    createdBy: string;
    status: string;
    statuses: Record<string, string>;
    product: string;
    code: string;
    quantity: string;
    lots: string;
    lot: (quantity: string, expiry: string, from: string, to: string) => string;
    note: string;
    print: string;
    back: string;
    sent: string;
    received: string;
    signature: string;
  };
};

export const TRANSFERS_AZ: TransfersDictionary = {
  open: "Filiala göndər",
  title: "Filiallar arası köçürmə",
  subtitle: "Bir qaimə — bir əməliyyat: ya bütün məhsullar köçür, ya heç biri. Ən tez bitən partiya birinci gedir (FEFO).",
  back: "Kataloq",
  forbidden: "Köçürmə yalnız sahib və şef üçündür.",
  needTwoBranches: "Köçürmə üçün ən azı iki filial lazımdır.",
  from: "Haradan",
  to: "Haraya",
  branch: "Filial",
  place: "Saxlama yeri",
  anyPlace: "Filialın bütün yerləri",
  autoPlace: "Avtomatik: eyni tipli yer",
  search: {
    label: "Məhsul",
    placeholder: "ALO kodu, barkod və ya ad",
    searching: "Axtarılır…",
    empty: (query) => `«${query}» üçün göndərən filialda qalıq yoxdur`,
    add: "Əlavə et",
    added: "Əlavə olunub",
  },
  table: { product: "Məhsul", available: "Qalıq", expiry: "Ən yaxın son tarix", quantity: "Miqdar", remove: "Sil" },
  available: (quantity, unit) => `var ${quantity} ${unit}`.trim(),
  noExpiry: "tarixsiz",
  lineErrors: { quantity: "miqdarı daxil edin", exceeds: (available) => `qalıqdan çoxdur (var ${available})` },
  empty: "Yuxarıdakı axtarışla məhsul əlavə edin.",
  lines: (n) => `${n} mövqe`,
  note: "Qeyd",
  notePlaceholder: "Məsələn: həftəlik təchizat",
  submit: (n) => `Qaimə yarat (${n})`,
  submitting: "Köçürülür…",
  fixLines: "Qırmızı sətirləri düzəldin",
  tooMany: (max) => `Bir qaimədə ən çox ${max} mövqe`,
  optionsErrors: {
    unauthenticated: "Yenidən daxil olun.",
    forbidden: "Köçürmə yalnız sahib və şef üçündür.",
    invalid_input: "Axtarış yanlışdır.",
    not_found: "Filial və ya yer tapılmadı.",
    save_failed: "Qalıqları yükləmək alınmadı.",
  },
  network: "Şəbəkə xətası, heç nə dəyişmədi.",
  success: {
    title: "Qaimə yaradıldı",
    number: (number) => `Qaimə № ${number}`,
    moved: (n) => `${n} mövqe köçürüldü`,
    print: "Qaiməni çap et",
    open: "Qaiməni aç",
    another: "Yeni köçürmə",
    redirecting: "Qaiməyə keçid…",
  },
  invoice: {
    title: "Köçürmə qaiməsi",
    number: "Nömrə",
    date: "Tarix",
    from: "Göndərən",
    to: "Qəbul edən",
    createdBy: "Yaradan",
    status: "Status",
    statuses: { completed: "Tamamlandı" },
    product: "Məhsul",
    code: "Kod",
    quantity: "Miqdar",
    lots: "Partiyalar",
    lot: (quantity, expiry, from, to) => `${quantity} · ${expiry} · ${from} → ${to}`,
    note: "Qeyd",
    print: "Çap et",
    back: "Yeni köçürmə",
    sent: "Təhvil verdi",
    received: "Qəbul etdi",
    signature: "imza",
  },
};

export const TRANSFERS_RU: TransfersDictionary = {
  open: "Передать в филиал",
  title: "Перемещение между филиалами",
  subtitle: "Одна накладная — одна транзакция: переезжают все товары или ни один. Первой уходит партия с ближайшим сроком (FEFO).",
  back: "Каталог",
  forbidden: "Перемещение доступно только владельцу и шефу.",
  needTwoBranches: "Для перемещения нужно минимум два филиала.",
  from: "Откуда",
  to: "Куда",
  branch: "Филиал",
  place: "Место хранения",
  anyPlace: "Все места филиала",
  autoPlace: "Автоматически: место того же типа",
  search: {
    label: "Товар",
    placeholder: "ALO-код, штрихкод или название",
    searching: "Ищем…",
    empty: (query) => `В филиале-отправителе нет остатка по «${query}»`,
    add: "Добавить",
    added: "Добавлен",
  },
  table: { product: "Товар", available: "Остаток", expiry: "Ближайший срок", quantity: "Количество", remove: "Убрать" },
  available: (quantity, unit) => `есть ${quantity} ${unit}`.trim(),
  noExpiry: "без срока",
  lineErrors: { quantity: "введите количество", exceeds: (available) => `больше остатка (есть ${available})` },
  empty: "Добавьте товары поиском выше.",
  lines: (n) => `${n} ${ruPlural(n, "позиция", "позиции", "позиций")}`,
  note: "Комментарий",
  notePlaceholder: "Например: еженедельное пополнение",
  submit: (n) => `Создать накладную (${n})`,
  submitting: "Перемещаем…",
  fixLines: "Исправьте красные строки",
  tooMany: (max) => `Не больше ${max} позиций в одной накладной`,
  optionsErrors: {
    unauthenticated: "Войдите заново.",
    forbidden: "Перемещение доступно только владельцу и шефу.",
    invalid_input: "Неверный поиск.",
    not_found: "Филиал или место не найдены.",
    save_failed: "Не удалось загрузить остатки.",
  },
  network: "Ошибка сети, ничего не изменилось.",
  success: {
    title: "Накладная создана",
    number: (number) => `Накладная № ${number}`,
    moved: (n) => `Перемещено: ${n} ${ruPlural(n, "позиция", "позиции", "позиций")}`,
    print: "Печать накладной",
    open: "Открыть накладную",
    another: "Новое перемещение",
    redirecting: "Открываем накладную…",
  },
  invoice: {
    title: "Накладная на перемещение",
    number: "Номер",
    date: "Дата",
    from: "Отправитель",
    to: "Получатель",
    createdBy: "Создал",
    status: "Статус",
    statuses: { completed: "Проведена" },
    product: "Товар",
    code: "Код",
    quantity: "Количество",
    lots: "Партии",
    lot: (quantity, expiry, from, to) => `${quantity} · ${expiry} · ${from} → ${to}`,
    note: "Комментарий",
    print: "Печать",
    back: "Новое перемещение",
    sent: "Сдал",
    received: "Принял",
    signature: "подпись",
  },
};

export const TRANSFERS_EN: TransfersDictionary = {
  open: "Send to branch",
  title: "Transfer between branches",
  subtitle: "One note, one transaction: every product moves or none does. The batch that expires first goes first (FEFO).",
  back: "Catalog",
  forbidden: "Only owners and chefs can transfer stock.",
  needTwoBranches: "A transfer needs at least two branches.",
  from: "From",
  to: "To",
  branch: "Branch",
  place: "Storage place",
  anyPlace: "Any place in the branch",
  autoPlace: "Automatic: a place of the same type",
  search: {
    label: "Product",
    placeholder: "ALO code, barcode or name",
    searching: "Searching…",
    empty: (query) => `No stock for “${query}” in the sending branch`,
    add: "Add",
    added: "Added",
  },
  table: { product: "Product", available: "In stock", expiry: "Nearest expiry", quantity: "Quantity", remove: "Remove" },
  available: (quantity, unit) => `have ${quantity} ${unit}`.trim(),
  noExpiry: "no date",
  lineErrors: { quantity: "enter a quantity", exceeds: (available) => `more than in stock (have ${available})` },
  empty: "Add products with the search above.",
  lines: (n) => `${n} ${n === 1 ? "line" : "lines"}`,
  note: "Note",
  notePlaceholder: "For example: weekly restock",
  submit: (n) => `Create transfer note (${n})`,
  submitting: "Transferring…",
  fixLines: "Fix the red lines",
  tooMany: (max) => `At most ${max} lines per note`,
  optionsErrors: {
    unauthenticated: "Please sign in again.",
    forbidden: "Only owners and chefs can transfer stock.",
    invalid_input: "Invalid search.",
    not_found: "Branch or place not found.",
    save_failed: "Could not load stock.",
  },
  network: "Network error; nothing changed.",
  success: {
    title: "Transfer note created",
    number: (number) => `Note No. ${number}`,
    moved: (n) => `${n} ${n === 1 ? "line" : "lines"} transferred`,
    print: "Print transfer note",
    open: "Open transfer note",
    another: "New transfer",
    redirecting: "Opening the note…",
  },
  invoice: {
    title: "Stock transfer note",
    number: "Number",
    date: "Date",
    from: "From",
    to: "To",
    createdBy: "Created by",
    status: "Status",
    statuses: { completed: "Completed" },
    product: "Product",
    code: "Code",
    quantity: "Quantity",
    lots: "Batches",
    lot: (quantity, expiry, from, to) => `${quantity} · ${expiry} · ${from} → ${to}`,
    note: "Note",
    print: "Print",
    back: "New transfer",
    sent: "Sent by",
    received: "Received by",
    signature: "signature",
  },
};
