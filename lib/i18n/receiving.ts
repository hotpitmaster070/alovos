import type { ReceivingErrorCode } from "@/lib/receiving/model";

export type ReceivingDictionary = {
  title: string;
  subtitle: string;
  forbidden: string;
  noBranches: string;
  branch: string;
  zone: string;
  zoneHint: string;
  noZones: string;
  order: string;
  chooseOrder: string;
  noOrders: string;
  withoutOrder: string;
  orderOption: (supplier: string | null, date: string, items: number) => string;
  invoicePhoto: string;
  invoiceDone: string;
  retake: string;
  uploading: string;
  addProduct: string;
  addProductPlaceholder: string;
  loading: string;
  empty: string;
  orderHint: string;
  table: {
    product: string;
    expected: string;
    actual: string;
    diffQty: string;
    diffMoney: string;
    photo: string;
    photoTaken: string;
    takePhoto: string;
    remove: string;
  };
  totals: { expected: string; received: string; difference: string; flagged: (count: number) => string };
  accept: string;
  accepting: string;
  acceptHint: string;
  success: (lines: number, total: string) => string;
  successNoTotal: (lines: number) => string;
  scan: {
    scan_invoice: string;
    scanning: string;
    no_items_found: string;
    matched: string;
    not_matched: string;
    title: string;
    hint: string;
    invoiceName: string;
    dbProduct: string;
    choose: string;
    quantity: string;
    price: string;
    total: string;
    createProduct: string;
    created: (name: string) => string;
    apply: string;
    discard: string;
    applied: (count: number) => string;
    skipped: (count: number) => string;
    errors: {
      ai_not_configured: string;
      rate_limited: string;
      scan_failed: string;
      invalid_input: string;
      unknown: string;
    };
  };
  delegation: {
    button: string;
    title: string;
    description: string;
    close: string;
    to: string;
    toPlaceholder: string;
    noCandidates: string;
    duration: string;
    durations: { m30: string; h2: string; d1: string; open: string };
    reason: string;
    reasonPlaceholder: string;
    reasons: string[];
    activate: string;
    activated: (name: string) => string;
    left: (minutes: number) => string;
    untilReturn: string;
    incoming: (name: string, left: string, reason: string) => string;
    outgoing: (name: string, left: string, reason: string) => string;
    endEarly: string;
    ended: string;
  };
  errors: Record<ReceivingErrorCode, string>;
};

export const RECEIVING_AZ: ReceivingDictionary = {
  title: "Malın qəbulu",
  subtitle: "Sifarişlə müqayisə, qaimə və tərəzi fotoları — təchizatçı üçün sübut.",
  forbidden: "Qəbul yalnız sahibkar və şef üçündür.",
  noBranches: "Əvvəlcə filial əlavə edin.",
  branch: "Filial",
  zone: "Qəbul yeri",
  zoneHint: "Məhsulun öz yeri yoxdursa, bura düşür.",
  noZones: "Bu filialda saxlama yeri yoxdur.",
  order: "Təchizatçı sifarişi",
  chooseOrder: "Sifariş seçin",
  noOrders: "Gözlənilən sifariş yoxdur",
  withoutOrder: "Sifarişsiz",
  orderOption: (supplier, date, items) => `${supplier ?? "Təchizatçı"} · ${date} · ${items} mövqe`,
  invoicePhoto: "📸 Qaimənin fotosu",
  invoiceDone: "Qaimə çəkildi",
  retake: "Yenidən çək",
  uploading: "Yüklənir…",
  addProduct: "Məhsul əlavə et",
  addProductPlaceholder: "Məhsul seçin…",
  loading: "Yüklənir…",
  empty: "Sifariş seçin və ya sifarişsiz məhsul əlavə edin.",
  orderHint: "Boş fakt = gətirilməyib (0).",
  table: {
    product: "Məhsul",
    expected: "Gözlənilən",
    actual: "Fakt",
    diffQty: "Fərq",
    diffMoney: "Fərq, pul",
    photo: "Tərəzidə foto",
    photoTaken: "Foto var",
    takePhoto: "Foto çək",
    remove: "Sil",
  },
  totals: {
    expected: "Gözlənilən məbləğ",
    received: "Qəbul edilən məbləğ",
    difference: "Fərq",
    flagged: (count) => `${count} mövqedə fərq 5%-dən çoxdur`,
  },
  accept: "Malı qəbul et",
  accepting: "Qəbul edilir…",
  acceptHint: "Qaimənin fotosu və ən azı bir fakt lazımdır.",
  success: (lines, total) => `Qəbul edildi: ${lines} mövqe, ${total}`,
  successNoTotal: (lines) => `Qəbul edildi: ${lines} mövqe`,
  scan: {
    scan_invoice: "📸 Qaiməni skan et",
    scanning: "🤖 Süni intellekt qaiməni oxuyur...",
    no_items_found: "Qaimədə mövqe tapılmadı. Daha aydın foto çəkin.",
    matched: "Tapıldı",
    not_matched: "Tapılmadı",
    title: "Tanınmış qaimə",
    hint: "Qəbuldan əvvəl hər rəqəmi yoxlayın və düzəldin.",
    invoiceName: "Qaimədəki ad",
    dbProduct: "Bazadakı məhsul",
    choose: "Məhsul seçin…",
    quantity: "Miqdar",
    price: "Qiymət",
    total: "Cəmi",
    createProduct: "➕ Yeni məhsul yarat",
    created: (name) => `Məhsul yaradıldı: ${name}`,
    apply: "Qəbula köçür",
    discard: "Ləğv et",
    applied: (count) => `${count} mövqe cədvələ köçürüldü`,
    skipped: (count) => `${count} mövqe sifarişdə yoxdur və ya məhsul seçilməyib — keçildi`,
    errors: {
      ai_not_configured: "Süni intellekt qoşulmayıb: GEMINI_API_KEY əlavə edin.",
      rate_limited: "Çox skan: bir dəqiqə gözləyin.",
      scan_failed: "Qaiməni oxumaq alınmadı. Yenidən cəhd edin.",
      invalid_input: "Foto çox böyükdür və ya format dəstəklənmir.",
      unknown: "Skan alınmadı. Yenidən cəhd edin.",
    },
  },
  delegation: {
    button: "🚶‍♂️ Uzaqlaşıram / Qəbulu ötür",
    title: "Qəbulu müvəqqəti ötür",
    description: "Seçilən əməkdaş bu filialda malı qəbul edə biləcək, amma alış qiymətlərini görməyəcək.",
    close: "Bağla",
    to: "Kimə ötürmək",
    toPlaceholder: "Əməkdaş seçin",
    noCandidates: "Bu filialda başqa əməkdaş yoxdur.",
    duration: "Müddət",
    durations: { m30: "30 dəqiqə", h2: "2 saat", d1: "1 gün", open: "Qayıdana qədər" },
    reason: "Səbəb",
    reasonPlaceholder: "məs. nahar",
    reasons: ["tualet", "nahar", "məzuniyyət", "görüş"],
    activate: "Aktivləşdir",
    activated: (name) => `Qəbul ${name} adlı əməkdaşa ötürüldü`,
    left: (minutes) => (minutes < 60 ? `${minutes} dəq` : `${Math.floor(minutes / 60)} saat ${minutes % 60} dəq`),
    untilReturn: "qayıdana qədər",
    incoming: (name, left, reason) => `⏸️ Malı şef ${name} əvəzinə qəbul edirsiniz (qalıb: ${left}). Səbəb: ${reason}`,
    outgoing: (name, left, reason) => `Qəbulu ${name} aparır (qalıb: ${left}). Səbəb: ${reason}`,
    endEarly: "Vaxtından əvvəl bitir",
    ended: "Ötürmə bitdi",
  },
  errors: {
    unauthenticated: "Yenidən daxil olun.",
    no_tenant: "Restoran tapılmadı.",
    forbidden: "Qəbul üçün icazəniz yoxdur.",
    branch_not_found: "Filial tapılmadı.",
    location_not_found: "Qəbul yerini seçin.",
    order_not_found: "Sifariş tapılmadı.",
    order_closed: "Bu sifariş artıq qəbul edilib və ya ləğv olunub.",
    product_not_found: "Məhsul tapılmadı.",
    product_not_in_order: "Məhsul bu sifarişdə yoxdur.",
    invoice_photo_required: "Qaimənin fotosunu çəkin.",
    invalid_photo: "Foto yüklənməyib, yenidən çəkin.",
    nothing_received: "Ən azı bir məhsulun faktını daxil edin.",
    delegate_not_found: "İstifadəçi tapılmadı.",
    scan_expired: "Skan köhnəlib (15 dəq). Qaiməni yenidən skan edin və ya skansız qəbul edin.",
    delegation_not_found: "Ötürmə tapılmadı.",
    invalid_input: "Məlumatları yoxlayın.",
    upload_failed: "Foto yüklənmədi. Yenidən cəhd edin.",
    save_failed: "Saxlamaq alınmadı. Yenidən cəhd edin.",
  },
};

export const RECEIVING_RU: ReceivingDictionary = {
  title: "Приёмка товара",
  subtitle: "Сверка с заказом, фото накладной и весов — доказательства для поставщика.",
  forbidden: "Приёмка доступна только владельцу и шефу.",
  noBranches: "Сначала добавьте филиал.",
  branch: "Филиал",
  zone: "Место приёмки",
  zoneHint: "Сюда попадает товар без своего места хранения.",
  noZones: "В филиале нет мест хранения.",
  order: "Заказ поставщику",
  chooseOrder: "Выберите заказ",
  noOrders: "Нет ожидаемых заказов",
  withoutOrder: "Без заказа",
  orderOption: (supplier, date, items) => `${supplier ?? "Поставщик"} · ${date} · ${items} поз.`,
  invoicePhoto: "📸 Фото накладной",
  invoiceDone: "Накладная снята",
  retake: "Переснять",
  uploading: "Загрузка…",
  addProduct: "Добавить продукт",
  addProductPlaceholder: "Выберите продукт…",
  loading: "Загрузка…",
  empty: "Выберите заказ или добавьте продукты без заказа.",
  orderHint: "Пустой факт = не привезли (0).",
  table: {
    product: "Продукт",
    expected: "Ожидаемо",
    actual: "Факт",
    diffQty: "Разница",
    diffMoney: "Разница, сумма",
    photo: "Фото на весах",
    photoTaken: "Фото есть",
    takePhoto: "Сфотографировать",
    remove: "Убрать",
  },
  totals: {
    expected: "Ожидалось на сумму",
    received: "Принято на сумму",
    difference: "Разница",
    flagged: (count) => `Расхождение больше 5%: ${count} поз.`,
  },
  accept: "Принять товар",
  accepting: "Принимаем…",
  acceptHint: "Нужно фото накладной и хотя бы один факт.",
  success: (lines, total) => `Принято: ${lines} поз. на ${total}`,
  successNoTotal: (lines) => `Принято: ${lines} поз.`,
  scan: {
    scan_invoice: "📸 Сканировать накладную",
    scanning: "🤖 ИИ читает накладную...",
    no_items_found: "В накладной не найдено позиций. Сфотографируйте чётче.",
    matched: "Найден",
    not_matched: "Не найден",
    title: "Распознанная накладная",
    hint: "Проверьте и исправьте любую цифру перед приёмкой.",
    invoiceName: "Название с накладной",
    dbProduct: "Товар в базе",
    choose: "Выберите товар…",
    quantity: "Кол-во",
    price: "Цена",
    total: "Итого",
    createProduct: "➕ Создать новый товар",
    created: (name) => `Товар создан: ${name}`,
    apply: "Перенести в приёмку",
    discard: "Отменить",
    applied: (count) => `Перенесено позиций: ${count}`,
    skipped: (count) => `Пропущено ${count} поз.: нет в заказе или не выбран товар`,
    errors: {
      ai_not_configured: "ИИ не подключён: добавьте GEMINI_API_KEY в environment variables.",
      rate_limited: "Слишком много сканирований: подождите минуту.",
      scan_failed: "Не удалось прочитать накладную. Попробуйте ещё раз.",
      invalid_input: "Фото слишком большое или формат не поддерживается.",
      unknown: "Сканирование не удалось. Попробуйте ещё раз.",
    },
  },
  delegation: {
    button: "🚶‍♂️ Я отошел / Передать приёмку",
    title: "Временно передать приёмку",
    description: "Выбранный сотрудник сможет принимать товар в этом филиале, но не увидит закупочных цен.",
    close: "Закрыть",
    to: "Кому передать",
    toPlaceholder: "Выберите сотрудника",
    noCandidates: "В филиале нет других сотрудников.",
    duration: "Длительность",
    durations: { m30: "30 минут", h2: "2 часа", d1: "1 день", open: "До возвращения" },
    reason: "Причина",
    reasonPlaceholder: "напр. обед",
    reasons: ["туалет", "обед", "отпуск", "встреча"],
    activate: "Активировать",
    activated: (name) => `Приёмка передана: ${name}`,
    left: (minutes) => (minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`),
    untilReturn: "до возвращения",
    incoming: (name, left, reason) => `⏸️ Вы принимаете товар за шефа ${name} (осталось ${left}). Причина: ${reason}`,
    outgoing: (name, left, reason) => `Приёмку ведёт ${name} (осталось ${left}). Причина: ${reason}`,
    endEarly: "Завершить досрочно",
    ended: "Передача завершена",
  },
  errors: {
    unauthenticated: "Войдите заново.",
    no_tenant: "Ресторан не найден.",
    forbidden: "Нет прав на приёмку.",
    branch_not_found: "Филиал не найден.",
    location_not_found: "Выберите место приёмки.",
    order_not_found: "Заказ не найден.",
    order_closed: "Этот заказ уже принят или отменён.",
    product_not_found: "Продукт не найден.",
    product_not_in_order: "Продукта нет в этом заказе.",
    invoice_photo_required: "Сфотографируйте накладную.",
    invalid_photo: "Фото не загрузилось, переснимите.",
    nothing_received: "Укажите факт хотя бы по одному продукту.",
    delegate_not_found: "Пользователь не найден.",
    scan_expired: "Скан устарел (15 мин). Отсканируйте накладную ещё раз или примите без скана.",
    delegation_not_found: "Передача не найдена.",
    invalid_input: "Проверьте данные.",
    upload_failed: "Не удалось загрузить фото. Попробуйте ещё раз.",
    save_failed: "Не удалось сохранить. Попробуйте ещё раз.",
  },
};

export const RECEIVING_EN: ReceivingDictionary = {
  title: "Goods receiving",
  subtitle: "Check against the order, with invoice and scale photos as proof for the supplier.",
  forbidden: "Receiving is available to owners and chefs only.",
  noBranches: "Add a branch first.",
  branch: "Branch",
  zone: "Receiving place",
  zoneHint: "Products without their own storage place go here.",
  noZones: "This branch has no storage places.",
  order: "Supplier order",
  chooseOrder: "Choose an order",
  noOrders: "No orders awaiting delivery",
  withoutOrder: "Without order",
  orderOption: (supplier, date, items) => `${supplier ?? "Supplier"} · ${date} · ${items} items`,
  invoicePhoto: "📸 Invoice photo",
  invoiceDone: "Invoice captured",
  retake: "Retake",
  uploading: "Uploading…",
  addProduct: "Add product",
  addProductPlaceholder: "Choose a product…",
  loading: "Loading…",
  empty: "Choose an order or add products without one.",
  orderHint: "Empty actual = not delivered (0).",
  table: {
    product: "Product",
    expected: "Expected",
    actual: "Actual",
    diffQty: "Difference",
    diffMoney: "Difference, money",
    photo: "Scale photo",
    photoTaken: "Photo taken",
    takePhoto: "Take photo",
    remove: "Remove",
  },
  totals: {
    expected: "Expected value",
    received: "Received value",
    difference: "Difference",
    flagged: (count) => `${count} items differ by more than 5%`,
  },
  accept: "Accept goods",
  accepting: "Accepting…",
  acceptHint: "An invoice photo and at least one actual quantity are required.",
  success: (lines, total) => `Received: ${lines} items, ${total}`,
  successNoTotal: (lines) => `Received: ${lines} items`,
  scan: {
    scan_invoice: "📸 Scan invoice",
    scanning: "🤖 AI is reading the invoice...",
    no_items_found: "No items found on the invoice. Take a clearer photo.",
    matched: "Matched",
    not_matched: "Not matched",
    title: "Recognized invoice",
    hint: "Check and correct any number before receiving.",
    invoiceName: "Name on invoice",
    dbProduct: "Product in database",
    choose: "Choose a product…",
    quantity: "Qty",
    price: "Price",
    total: "Total",
    createProduct: "➕ Create new product",
    created: (name) => `Product created: ${name}`,
    apply: "Move to receiving",
    discard: "Discard",
    applied: (count) => `${count} items moved to the table`,
    skipped: (count) => `${count} items skipped: not in the order or no product chosen`,
    errors: {
      ai_not_configured: "AI is not connected: add GEMINI_API_KEY to environment variables.",
      rate_limited: "Too many scans: wait a minute.",
      scan_failed: "Could not read the invoice. Try again.",
      invalid_input: "The photo is too large or its format is not supported.",
      unknown: "Scan failed. Try again.",
    },
  },
  delegation: {
    button: "🚶‍♂️ I stepped away / Hand over receiving",
    title: "Hand over receiving for a while",
    description: "The chosen person can receive goods at this branch but will not see purchase prices.",
    close: "Close",
    to: "Hand over to",
    toPlaceholder: "Choose a person",
    noCandidates: "Nobody else works at this branch.",
    duration: "Duration",
    durations: { m30: "30 minutes", h2: "2 hours", d1: "1 day", open: "Until I am back" },
    reason: "Reason",
    reasonPlaceholder: "e.g. lunch",
    reasons: ["restroom", "lunch", "vacation", "meeting"],
    activate: "Activate",
    activated: (name) => `Receiving handed over to ${name}`,
    left: (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`),
    untilReturn: "until the chef is back",
    incoming: (name, left, reason) => `⏸️ You are receiving goods for chef ${name} (${left} left). Reason: ${reason}`,
    outgoing: (name, left, reason) => `${name} is receiving goods (${left} left). Reason: ${reason}`,
    endEarly: "End early",
    ended: "Hand-over ended",
  },
  errors: {
    unauthenticated: "Please sign in again.",
    no_tenant: "Restaurant not found.",
    forbidden: "You are not allowed to receive goods.",
    branch_not_found: "Branch not found.",
    location_not_found: "Choose a receiving place.",
    order_not_found: "Order not found.",
    order_closed: "This order is already received or cancelled.",
    product_not_found: "Product not found.",
    product_not_in_order: "The product is not in this order.",
    invoice_photo_required: "Take a photo of the invoice.",
    invalid_photo: "The photo did not upload, retake it.",
    nothing_received: "Enter the actual quantity for at least one product.",
    delegate_not_found: "User not found.",
    scan_expired: "The scan expired (15 min). Scan the invoice again or receive without it.",
    delegation_not_found: "Delegation not found.",
    invalid_input: "Check the data.",
    upload_failed: "Could not upload the photo. Try again.",
    save_failed: "Could not save. Try again.",
  },
};
