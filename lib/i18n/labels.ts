import type { ProductType, StockFilter, StockKind } from "@/lib/labels/final";
import type { LabelsErrorCode, ShelfLifeSource } from "@/lib/labels/model";
import type { PrepWasteCause } from "@/lib/labels/waste";
import { ruPlural } from "./plural";

export type LabelsDictionary = {
  /** BCP 47 tag for dates on labels (Intl). */
  locale: string;
  errors: Record<LabelsErrorCode, string>;
  receipt: {
    prep: string;
    source: Record<ShelfLifeSource, string>;
    remember: string;
    copies: string;
    working: string;
  };
  birka: {
    name: string;
    lot: string;
    made: string;
    expires: string;
    composition: string;
    qty: string;
    storage: string;
    portions: (count: number) => string;
  };
  prep: {
    title: string;
    hint: string;
    nav: string;
    empty: string;
    readOnly: string;
    add: string;
    edit: string;
    archive: string;
    confirmArchive: string;
    name: string;
    inputs: string;
    outputs: string;
    product: string;
    choose: string;
    qty: string;
    portions: string;
    outputName: string;
    addInput: string;
    addOutput: string;
    remove: string;
    save: string;
    cancel: string;
    working: string;
    close: string;
    cook: string;
    cookTitle: (name: string) => string;
    taken: (unit: string) => string;
    from: string;
    fromAuto: string;
    to: string;
    yields: string;
    expiry: (date: string) => string;
    ready: string;
    copiesFor: (product: string) => string;
    printAll: string;
    done: (count: number) => string;
  };
  expiring: {
    title: string;
    empty: string;
    daysLeft: (days: number) => string;
    inStock: string;
    reprint: string;
  };
  waste: {
    norm: string;
    items: string;
    itemsHint: string;
    itemName: string;
    itemPercent: string;
    addItem: string;
    plan: string;
    planNorm: (qty: string) => string;
    fact: string;
    qty: (unit: string) => string;
    cause: string;
    causes: Record<PrepWasteCause, string>;
    causeNote: string;
    balanceCause: string;
    portionWeight: string;
    weightUnknown: (qty: string, approx: string | null) => string;
    journal: { cause: string; note: string; prep: string; lot: string; day: string };
    balanceOk: (diff: string) => string;
    balanceOff: (diff: string) => string;
    balanceUnknown: string;
    confirmLoss: string;
    today: (qty: string, cost: string | null) => string;
    vsNorm: (norm: number, over: number) => string;
    noRuns: string;
    expiredTitle: string;
    expiredHint: string;
    expiredEmpty: string;
    expiredDays: (days: number) => string;
    writeOff: string;
    confirmWriteOff: (qty: string, product: string) => string;
    writtenOff: (product: string) => string;
  };
  trim: {
    section: string;
    hint: string;
    product: string;
    qty: (unit: string) => string;
    note: string;
    add: string;
    noProducts: string;
    gross: string;
    net: string;
    planTrim: (qty: string) => string;
    planEvaporation: (qty: string) => string;
    /** "8 kg = 5 kg out + 0.9 kg waste + 0.1 kg evaporation". */
    balanceParts: (net: string, output: string, waste: string, evaporation: string | null) => string;
    /** Waste journal: the run's net use against its waste. */
    runLine: (run: { gross: string; trim: string | null; net: string; waste: string; share: string; evaporation: string | null }) => string;
    evaporation: string;
    usable: string;
    usableProduct: string;
    lot: string;
  };
  stock: {
    types: Record<ProductType, string>;
    kinds: Record<StockKind, string>;
    filters: Record<StockFilter, string>;
    title: string;
    hint: string;
    cookHint: string;
    total: string;
    cost: string;
    sale: string;
    margin: string;
    wasteToday: string;
    lines: (count: number) => string;
    unpriced: (count: number) => string;
    open: string;
    empty: string;
    more: (shown: number, total: number) => string;
    columns: { name: string; qty: string; lot: string; expiry: string; cost: string; sale: string; kind: string; place: string };
    economics: {
      title: string;
      type: string;
      salePrice: string;
      density: string;
      trimValue: string;
      trimValueHint: string;
      save: string;
      saved: string;
    };
  };
  move: {
    action: string;
    title: string;
    hint: (qty: string, product: string, place: string) => string;
    to: string;
    noTargets: string;
    qty: string;
    qtyHint: (max: string) => string;
    shelfLife: string;
    expiry: string;
    keeps: string;
    restarts: string;
    remember: string;
    reason: string;
    reasonPlaceholder: string;
    copies: string;
    submit: string;
    working: string;
    done: (expiry: string) => string;
  };
  norms: {
    title: string;
    hint: string;
    place: string;
    days: string;
    fallback: (days: number) => string;
    noPlaces: string;
    save: string;
    saved: string;
    readOnly: string;
  };
  photoAi: {
    badges: { approved: (confidence: string) => string; suspicious: string; noAi: string; pending: string; limitReached: string };
    review: string;
    reviewed: string;
    needsReview: string;
    photoHint: string;
    today: string;
    todayLine: (logs: number, photos: number) => string;
    counts: (approved: number, suspicious: number) => string;
    toReview: (count: number) => string;
    usage: (used: number, limit: number) => string;
    buyAi: (price: string) => string;
  };
  billing: {
    title: string;
    hint: string;
    plan: string;
    price: (price: string, days: number) => string;
    trial: (days: number) => string;
    photos: (count: number) => string;
    aiOff: string;
    aiUsage: (used: number, limit: number) => string;
    freeChecks: (count: number) => string;
    packages: string;
    addon: (price: string, photos: number, days: number) => string;
    request: string;
    requested: string;
    active: string;
    settings: string;
    photoEnabled: string;
    aiEnabled: string;
    tolerance: string;
    toleranceHint: string;
    save: string;
    saved: string;
    ownerOnly: string;
    open: string;
  };
  currency: {
    title: string;
    current: string;
    save: string;
    saved: string;
    warning: string;
    ownerOnly: string;
    signup: string;
    signupHint: string;
    signupPick: string;
    signupRequired: string;
    receipt: string;
    supplier: string;
    restaurant: (code: string) => string;
    fxRate: (from: string, to: string) => string;
    converted: (original: string, base: string) => string;
  };
};

export const LABELS_AZ: LabelsDictionary = {
  locale: "az-Latn-AZ",
  errors: {
    invalid_input: "Məlumatları yoxlayın",
    unauthenticated: "Yenidən daxil olun",
    no_tenant: "Restoran tapılmadı",
    forbidden: "Bunun üçün icazəniz yoxdur",
    product_not_found: "Məhsul tapılmadı",
    location_not_found: "Saxlama yeri tapılmadı",
    preparation_not_found: "Resept tapılmadı",
    lot_not_found: "Lot tapılmadı",
    insufficient_stock: "Anbarda kifayət qədər yoxdur — heç nə yazılmadı",
    balance_mismatch: "Balans tutmur — fərqi yoxlayın və ya itkini təsdiqləyin",
    stock_exists: "Anbarda qalıq var, valyutanı dəyişmək üçün anbarı sıfırlayın",
    lot_expired: "Müddəti bitib - köçürmək olmaz, silin",
    open_count: "Bu yerdə sayım gedir - bitəndən sonra köçürün",
    request_not_found: "Sifariş tapılmadı: bu məhsul və filial üçün göndərilmiş sifariş seçin",
    save_failed: "Saxlamaq alınmadı, yenidən cəhd edin",
  },
  receipt: {
    prep: "Zaqotovka et",
    source: { rule: "bu yer üçün norma", product: "məhsulun norması", default: "restoranın standartı" },
    remember: "Bu yer üçün norma kimi yadda saxla",
    copies: "Neçə birka?",
    working: "Gözləyin…",
  },
  birka: {
    name: "Ad",
    lot: "Lot",
    made: "İstehsal",
    expires: "Son",
    composition: "Tərkib",
    qty: "Miqdar",
    storage: "Saxlama",
    portions: (count) => `${count} porsiya`,
  },
  prep: {
    title: "Zaqotovka",
    hint: "Xammal → hazır zaqotovkalar. Hər çıxışın öz son tarixi və birkası olur.",
    nav: "Zaqotovka",
    empty: "Hələ resept yoxdur",
    readOnly: "Reseptləri sahibi və şef dəyişir",
    add: "Resept əlavə et",
    edit: "Dəyiş",
    archive: "Arxivə",
    confirmArchive: "Resept arxivə göndərilsin?",
    name: "Ad",
    inputs: "Nə götürülür",
    outputs: "Nə alınır",
    product: "Məhsul",
    choose: "Seçin",
    qty: "Miqdar",
    portions: "Porsiya",
    outputName: "Birkadakı ad",
    addInput: "+ xammal",
    addOutput: "+ çıxış",
    remove: "Sil",
    save: "Saxla",
    cancel: "Ləğv et",
    working: "Gözləyin…",
    close: "Bağla",
    cook: "Hazırla",
    cookTitle: (name) => `Hazırla: ${name}`,
    taken: (unit) => `Nə qədər götürdünüz (${unit})`,
    from: "Haradan götürdünüz",
    fromAuto: "Avtomatik (ilk bitən)",
    to: "Hara qoyulur",
    yields: "Alınan",
    expiry: (date) => `Son: ${date}`,
    ready: "Hazırdır və saxlamaya qoy",
    copiesFor: (product) => `Neçə birka: ${product}`,
    printAll: "Çap et hamısını",
    done: (count) => `${count} lot yaradıldı`,
  },
  expiring: {
    title: "Tezliklə bitir",
    empty: "Yaxın günlərdə bitən lot yoxdur",
    daysLeft: (days) => (days <= 0 ? "bu gün" : `${days} gün`),
    inStock: "Qalıq",
    reprint: "Birka",
  },
  waste: {
    norm: "Tullantı norması, %",
    items: "Tullantı növləri",
    itemsHint: "Növlər varsa, norma onların cəmidir",
    itemName: "Nə (məs. sümük)",
    itemPercent: "%",
    addItem: "+ növ",
    plan: "Plan (texkarta)",
    planNorm: (qty) => `Tullantı norma ${qty}`,
    fact: "Fakt",
    qty: (unit) => `Tullantı (${unit})`,
    cause: "Səbəb",
    causes: { norm: "kəsim norması", fatty: "yağlı idi", bony: "sümüklü idi", other: "digər" },
    causeNote: "Nə oldu?",
    balanceCause: "balans fərqi (təsdiqlənmiş itki)",
    portionWeight: "1 porsiya neçə kq?",
    weightUnknown: (qty, approx) => `${qty}${approx ? ` (~${approx})` : ""} - çəki məlum deyil`,
    journal: { cause: "Səbəb", note: "Qeyd", prep: "Hazırlıq", lot: "Lot nömrəsi", day: "Gün" },
    balanceOk: (diff) => `Balans: fərq ${diff}`,
    balanceOff: (diff) => `Fərq ${diff} - yoxlayın!`,
    balanceUnknown: "Balans hesablanmır (ədəd və ya fərqli vahidlər)",
    confirmLoss: "Bəli, itki var",
    today: (qty, cost) => `Bu gün tullantı: ${qty}${cost ? ` (${cost})` : ""}`,
    vsNorm: (norm, over) => (over > 0 ? ` - ${norm}% norma, ${over}% artıq` : ` - ${norm}% norma, normadadır`),
    noRuns: "Bu gün zaqotovka olmayıb",
    expiredTitle: "Artıq vaxtı keçib",
    expiredHint: "Satışa getmir. Şef və ya sahib silir — tullantı kimi yazılır",
    expiredEmpty: "Vaxtı keçən qalıq yoxdur",
    expiredDays: (days) => (days < 0 ? `${-days} gün keçib` : days === 0 ? "bu gün bitir" : `${days} gün qalıb`),
    writeOff: "Sil - xarab oldu",
    confirmWriteOff: (qty, product) => `${product}: ${qty} tullantı kimi silinsin?`,
    writtenOff: (product) => `${product} silindi`,
  },
  trim: {
    section: "Qaytarılan (trim)",
    hint: "Yararlı qalıq anbara qayıdır (məs. sümük bulyon üçün) - xalis sərfdən çıxılır",
    product: "Nə qaytarılır",
    qty: (unit) => `Miqdar (${unit})`,
    note: "Qeyd (məs. bulyon üçün)",
    add: "+ qaytarılan",
    noProducts: "Trim məhsulu yoxdur - kataloqda növü «Trim» olan məhsul yaradın",
    gross: "Götürdün",
    net: "Xalis sərf",
    planTrim: (qty) => `qaytarılan ${qty}`,
    planEvaporation: (qty) => `buxarlanma ${qty}`,
    balanceParts: (net, output, waste, evaporation) =>
      `${net} = çıxış ${output} + tullantı ${waste}${evaporation ? ` + buxarlanma ${evaporation}` : ""}`,
    runLine: (run) =>
      `Götürdün ${run.gross}${run.trim ? ` · qaytarılan ${run.trim}` : ""} · xalis sərf ${run.net} vs tullantı ${run.waste} (${run.share})${run.evaporation ? ` · buxarlanma ${run.evaporation}` : ""}`,
    evaporation: "Buxarlanma, %",
    usable: "Yararlı - anbara qayıdır",
    usableProduct: "Trim məhsulu",
    lot: "Trim",
  },
  stock: {
    types: { raw: "Xammal", semi: "Zaqotovka", ready: "Hazır yemək", trim: "Trim (qaytarılan)", waste: "Tullantı" },
    kinds: { raw: "Xammal", semi: "Zaqotovka", trim: "Qaytarılan trim" },
    filters: { all: "Hamısı", raw: "Xammal", semi: "Zaqotovka", trim: "Qaytarılan", expiring: "Müddəti bitir" },
    title: "Anbar qalığı",
    hint: "Xammal, zaqotovka və qaytarılan trim ayrıca. FIFO: ilk bitən yuxarıda.",
    cookHint: "İlk bitəni götürün (FIFO) - lot və son tarix birkada.",
    total: "Cəmi",
    cost: "Maya",
    sale: "Satış",
    margin: "Qazanc",
    wasteToday: "Tullantı (bu gün)",
    lines: (count) => `${count} sətir`,
    unpriced: (count) => `${count} sətirdə satış qiyməti yoxdur`,
    open: "Bax →",
    empty: "Qalıq yoxdur",
    more: (shown, total) => `${shown} / ${total} göstərilir`,
    columns: { name: "Ad", qty: "Miqdar", lot: "Lot", expiry: "Son", cost: "Maya", sale: "Satış", kind: "Növ", place: "Yer" },
    economics: {
      title: "Növ və qiymət",
      type: "Növ",
      salePrice: "Satış qiyməti (1 vahid)",
      density: "Sıxlıq, kq/l",
      trimValue: "Trim dəyəri, xammal mayasının %-i",
      trimValueHint: "boş - restoran standartı",
      save: "Saxla",
      saved: "Saxlanıldı",
    },
  },
  move: {
    action: "Köçür",
    title: "Başqa yerə köçür",
    hint: (qty, product, place) => `${qty} · ${product} · indi: ${place}`,
    to: "Hara",
    noTargets: "Bu filialda başqa aktiv saxlama yeri yoxdur",
    qty: "Miqdar",
    qtyHint: (max) => `hamısı: ${max}`,
    shelfLife: "Saxlama müddəti, gün",
    expiry: "Yeni son tarix",
    keeps: "Eyni növ yer - son tarix dəyişmir",
    restarts: "Başqa növ yer - müddət bu gündən yenidən sayılır",
    remember: "Bu məhsul üçün bu yerdə yadda saxla",
    reason: "Səbəb",
    reasonPlaceholder: "məs. atmamaq üçün dondurucuya",
    copies: "Birka sayı",
    submit: "Köçür",
    working: "Köçürülür…",
    done: (expiry) => `Köçürüldü · son tarix ${expiry}`,
  },
  norms: {
    title: "Harada nə qədər saxlanır",
    hint: "Hər yer üçün gün sayı. Boş - məhsulun ümumi müddəti.",
    place: "Yer",
    days: "Gün",
    fallback: (days) => `boş: ${days} gün`,
    noPlaces: "Bu filialda saxlama yeri yoxdur",
    save: "Saxla",
    saved: "Saxlanıldı",
    readOnly: "Yalnız sahib, şef və aşpaz dəyişə bilər",
  },
  photoAi: {
    badges: {
      approved: (confidence) => `AI ✅ ${confidence}%`,
      suspicious: "🔴 Şübhəli",
      noAi: "📷 Foto var (AI yox)",
      pending: "AI yoxlayır…",
      limitReached: "📷 AI limiti bitib",
    },
    review: "Baxdım",
    reviewed: "Qeyd edildi",
    needsReview: "Sahib baxmalıdır",
    photoHint: "Foto tullantını sübut edir.",
    today: "Bu gün tullantı",
    todayLine: (logs, photos) => `${logs} silinmə · ${photos} foto`,
    counts: (approved, suspicious) => `AI ✅ ${approved} · 🔴 ${suspicious}`,
    toReview: (count) => `${count} baxış gözləyir`,
    usage: (used, limit) => `AI ${used}/${limit} bu ay`,
    buyAi: (price) => `AI Paketi Al +${price}`,
  },
  billing: {
    title: "Abunə və paketlər",
    hint: "Ödənişdən sonra paket aktiv olur.",
    plan: "Plan",
    price: (price, days) => `${price} / ${days} gün`,
    trial: (days) => `${days} gün pulsuz`,
    photos: (count) => `Bu ay ${count} foto`,
    aiOff: "Foto var, AI yox",
    aiUsage: (used, limit) => `AI yoxlama: ${used}/${limit}`,
    freeChecks: (count) => `Pulsuz: ayda ${count} AI yoxlama`,
    packages: "Paketlər",
    addon: (price, photos, days) => `AI +${price} · ${photos} foto / ${days} gün`,
    request: "Al",
    requested: "Sorğu göndərildi - ödənişdən sonra aktiv olacaq",
    active: "Aktiv",
    settings: "Tullantı fotoları",
    photoEnabled: "Silinmədə foto istə",
    aiEnabled: "AI yoxlama",
    tolerance: "Şübhəli fərq, %",
    toleranceHint: "AI çəkisi qeyd ediləndən bu qədər fərqlənsə - şübhəli",
    save: "Saxla",
    saved: "Saxlanıldı",
    ownerOnly: "Yalnız sahib dəyişə bilər",
    open: "Abunə →",
  },
  currency: {
    title: "Valyuta",
    current: "Restoranın valyutası",
    save: "Valyutanı dəyiş",
    saved: "Valyuta dəyişdi",
    warning: "Mövcud qalıqlar yenidən hesablanmayacaq, yeni qəbullar yeni valyutada olacaq",
    ownerOnly: "Yalnız sahib dəyişə bilər",
    signup: "Restoranın valyutası",
    signupHint: "Bütün qalıq və maya bu valyutada göstəriləcək. Sonra ayarlarda dəyişmək olar.",
    signupPick: "Valyutanı seçin",
    signupRequired: "Restoranın valyutasını seçin",
    receipt: "Qiymətin valyutası",
    supplier: "Tədarükçünün valyutası",
    restaurant: (code) => `Restoranın valyutası (${code})`,
    fxRate: (from, to) => `Məzənnə: 1 ${from} = ? ${to}`,
    converted: (original, base) => `${original} = ${base} (maya bundan hesablanır)`,
  },
};

export const LABELS_RU: LabelsDictionary = {
  locale: "ru-RU",
  errors: {
    invalid_input: "Проверьте данные",
    unauthenticated: "Войдите заново",
    no_tenant: "Ресторан не найден",
    forbidden: "Нет прав на это действие",
    product_not_found: "Товар не найден",
    location_not_found: "Место хранения не найдено",
    preparation_not_found: "Рецепт не найден",
    lot_not_found: "Партия не найдена",
    insufficient_stock: "На складе не хватает — ничего не записано",
    balance_mismatch: "Баланс не сходится — проверьте разницу или подтвердите потерю",
    stock_exists: "На складе есть остатки — обнулите склад, чтобы сменить валюту",
    lot_expired: "Срок истёк — перемещать нельзя, спишите",
    open_count: "Здесь идёт инвентаризация — переместите после неё",
    request_not_found: "Заказ не найден: выберите отправленный заказ этого товара и филиала",
    save_failed: "Не удалось сохранить, попробуйте ещё раз",
  },
  receipt: {
    prep: "В заготовку",
    source: { rule: "норма для этого места", product: "норма товара", default: "стандарт ресторана" },
    remember: "Запомнить как норму для этого места",
    copies: "Сколько бирок?",
    working: "Подождите…",
  },
  birka: {
    name: "Наим.",
    lot: "Партия",
    made: "Изгот.",
    expires: "Годен до",
    composition: "Состав",
    qty: "Кол-во",
    storage: "Хранение",
    portions: (count) => `${count} ${ruPlural(count, "порция", "порции", "порций")}`,
  },
  prep: {
    title: "Заготовки",
    hint: "Сырьё → готовые заготовки. У каждого выхода свой срок и своя бирка.",
    nav: "Заготовки",
    empty: "Рецептов пока нет",
    readOnly: "Рецепты меняют владелец и шеф",
    add: "Добавить рецепт",
    edit: "Изменить",
    archive: "В архив",
    confirmArchive: "Отправить рецепт в архив?",
    name: "Название",
    inputs: "Что берём",
    outputs: "Что получаем",
    product: "Товар",
    choose: "Выберите",
    qty: "Кол-во",
    portions: "Порций",
    outputName: "Название на бирке",
    addInput: "+ сырьё",
    addOutput: "+ выход",
    remove: "Убрать",
    save: "Сохранить",
    cancel: "Отмена",
    working: "Подождите…",
    close: "Закрыть",
    cook: "Приготовить",
    cookTitle: (name) => `Приготовить: ${name}`,
    taken: (unit) => `Сколько взяли (${unit})`,
    from: "Откуда взяли",
    fromAuto: "Автоматически (что раньше истекает)",
    to: "Куда кладём",
    yields: "Выход",
    expiry: (date) => `Годен до ${date}`,
    ready: "Готово на хранение",
    copiesFor: (product) => `Сколько бирок: ${product}`,
    printAll: "Печатать все",
    done: (count) => `Создано партий: ${count}`,
  },
  expiring: {
    title: "Скоро истекает",
    empty: "В ближайшие дни ничего не истекает",
    daysLeft: (days) => (days <= 0 ? "сегодня" : `${days} ${ruPlural(days, "день", "дня", "дней")}`),
    inStock: "Остаток",
    reprint: "Бирка",
  },
  waste: {
    norm: "Норма отходов, %",
    items: "Виды отходов",
    itemsHint: "Если виды заданы, норма — их сумма",
    itemName: "Что (напр. кость)",
    itemPercent: "%",
    addItem: "+ вид",
    plan: "План (техкарта)",
    planNorm: (qty) => `Норма отходов ${qty}`,
    fact: "Факт",
    qty: (unit) => `Отходы (${unit})`,
    cause: "Причина",
    causes: { norm: "норма обрезки", fatty: "было жирное", bony: "было с костью", other: "другое" },
    causeNote: "Что случилось?",
    balanceCause: "разница баланса (подтверждённая потеря)",
    portionWeight: "Сколько кг в 1 порции?",
    weightUnknown: (qty, approx) => `${qty}${approx ? ` (~${approx})` : ""} — вес неизвестен`,
    journal: { cause: "Причина", note: "Заметка", prep: "Заготовка", lot: "Номер партии", day: "День" },
    balanceOk: (diff) => `Баланс: разница ${diff}`,
    balanceOff: (diff) => `Разница ${diff} — проверьте!`,
    balanceUnknown: "Баланс не считается (штуки или разные единицы)",
    confirmLoss: "Да, есть потеря",
    today: (qty, cost) => `Отходы сегодня: ${qty}${cost ? ` (${cost})` : ""}`,
    vsNorm: (norm, over) => (over > 0 ? ` — норма ${norm}%, превышение ${over}%` : ` — норма ${norm}%, в норме`),
    noRuns: "Сегодня заготовок не было",
    expiredTitle: "Уже просрочено",
    expiredHint: "В продажи не уходит. Списывает шеф или владелец — запишется в отходы",
    expiredEmpty: "Просроченных остатков нет",
    expiredDays: (days) =>
      days < 0
        ? `просрочено на ${-days} ${ruPlural(-days, "день", "дня", "дней")}`
        : days === 0
          ? "истекает сегодня"
          : `осталось ${days} ${ruPlural(days, "день", "дня", "дней")}`,
    writeOff: "Списать — испорчено",
    confirmWriteOff: (qty, product) => `Списать в отходы ${product}: ${qty}?`,
    writtenOff: (product) => `${product} списано`,
  },
  trim: {
    section: "Возврат (трим)",
    hint: "Полезный остаток возвращается на склад (напр. кость на бульон) - вычитается из чистого расхода",
    product: "Что возвращается",
    qty: (unit) => `Количество (${unit})`,
    note: "Заметка (напр. на бульон)",
    add: "+ возврат",
    noProducts: "Нет трим-товаров - создайте в каталоге товар с типом «Трим»",
    gross: "Взяли",
    net: "Чистый расход",
    planTrim: (qty) => `возврат ${qty}`,
    planEvaporation: (qty) => `уварка ${qty}`,
    balanceParts: (net, output, waste, evaporation) =>
      `${net} = выход ${output} + отходы ${waste}${evaporation ? ` + уварка ${evaporation}` : ""}`,
    runLine: (run) =>
      `Взяли ${run.gross}${run.trim ? ` · возврат ${run.trim}` : ""} · чистый расход ${run.net} vs отходы ${run.waste} (${run.share})${run.evaporation ? ` · уварка ${run.evaporation}` : ""}`,
    evaporation: "Уварка / испарение, %",
    usable: "Полезный - возвращается на склад",
    usableProduct: "Трим-товар",
    lot: "Трим",
  },
  stock: {
    types: { raw: "Сырьё", semi: "Заготовка", ready: "Готовое блюдо", trim: "Трим (возврат)", waste: "Отходы" },
    kinds: { raw: "Сырьё", semi: "Заготовки", trim: "Возвратный трим" },
    filters: { all: "Все", raw: "Сырьё", semi: "Заготовки", trim: "Возврат", expiring: "Истекает срок" },
    title: "Остатки склада",
    hint: "Сырьё, заготовки и возвратный трим отдельно. FIFO: что истекает раньше - сверху.",
    cookHint: "Берите то, что истекает раньше (FIFO) - партия и срок на бирке.",
    total: "Итого",
    cost: "Себестоимость",
    sale: "Продажа",
    margin: "Прибыль",
    wasteToday: "Отходы (сегодня)",
    lines: (count) => `${count} ${ruPlural(count, "строка", "строки", "строк")}`,
    unpriced: (count) => `без цены продажи: ${count}`,
    open: "Открыть →",
    empty: "Остатков нет",
    more: (shown, total) => `показано ${shown} из ${total}`,
    columns: { name: "Название", qty: "Кол-во", lot: "Партия", expiry: "Срок", cost: "Себест.", sale: "Продажа", kind: "Тип", place: "Место" },
    economics: {
      title: "Тип и цена",
      type: "Тип",
      salePrice: "Цена продажи (за единицу)",
      density: "Плотность, кг/л",
      trimValue: "Стоимость трима, % от себестоимости сырья",
      trimValueHint: "пусто - стандарт ресторана",
      save: "Сохранить",
      saved: "Сохранено",
    },
  },
  move: {
    action: "Переместить",
    title: "Переместить в другое место",
    hint: (qty, product, place) => `${qty} · ${product} · сейчас: ${place}`,
    to: "Куда",
    noTargets: "В этом филиале нет других активных мест хранения",
    qty: "Количество",
    qtyHint: (max) => `всё: ${max}`,
    shelfLife: "Срок хранения, дней",
    expiry: "Новый срок годности",
    keeps: "Место того же типа — срок не меняется",
    restarts: "Место другого типа — срок считается заново с сегодня",
    remember: "Запомнить для этого товара в этом месте",
    reason: "Причина",
    reasonPlaceholder: "напр. в морозилку, чтобы не выкидывать",
    copies: "Бирок",
    submit: "Переместить",
    working: "Перемещаем…",
    done: (expiry) => `Перемещено · годен до ${expiry}`,
  },
  norms: {
    title: "Где и сколько хранить",
    hint: "Дней для каждого места. Пусто — общий срок товара.",
    place: "Место",
    days: "Дней",
    fallback: (days) => `пусто: ${days} дн.`,
    noPlaces: "В этом филиале нет мест хранения",
    save: "Сохранить",
    saved: "Сохранено",
    readOnly: "Менять могут владелец, шеф и повар",
  },
  photoAi: {
    badges: {
      approved: (confidence) => `AI ✅ ${confidence}%`,
      suspicious: "🔴 Подозрительно",
      noAi: "📷 Фото есть (без AI)",
      pending: "AI проверяет…",
      limitReached: "📷 Лимит AI исчерпан",
    },
    review: "Проверено",
    reviewed: "Отмечено",
    needsReview: "Нужна проверка владельца",
    photoHint: "Фото подтверждает списание.",
    today: "Отходы сегодня",
    todayLine: (logs, photos) => `${logs} ${ruPlural(logs, "списание", "списания", "списаний")} · ${photos} фото`,
    counts: (approved, suspicious) => `AI ✅ ${approved} · 🔴 ${suspicious}`,
    toReview: (count) => `ждут проверки: ${count}`,
    usage: (used, limit) => `AI ${used}/${limit} в этом месяце`,
    buyAi: (price) => `Купить AI-пакет +${price}`,
  },
  billing: {
    title: "Подписка и пакеты",
    hint: "Пакет включается после оплаты.",
    plan: "Тариф",
    price: (price, days) => `${price} / ${days} дн.`,
    trial: (days) => `${days} дн. бесплатно`,
    photos: (count) => `В этом месяце ${count} фото`,
    aiOff: "Фото есть, AI нет",
    aiUsage: (used, limit) => `AI-проверки: ${used}/${limit}`,
    freeChecks: (count) => `Бесплатно: ${count} AI-проверок в месяц`,
    packages: "Пакеты",
    addon: (price, photos, days) => `AI +${price} · ${photos} фото / ${days} дн.`,
    request: "Купить",
    requested: "Заявка отправлена - включится после оплаты",
    active: "Активен",
    settings: "Фото отходов",
    photoEnabled: "Просить фото при списании",
    aiEnabled: "AI-проверка",
    tolerance: "Порог подозрения, %",
    toleranceHint: "Если вес по AI отличается от записанного больше - подозрительно",
    save: "Сохранить",
    saved: "Сохранено",
    ownerOnly: "Менять может только владелец",
    open: "Подписка →",
  },
  currency: {
    title: "Валюта",
    current: "Валюта ресторана",
    save: "Сменить валюту",
    saved: "Валюта изменена",
    warning: "Текущие остатки не будут пересчитаны, новые приёмки будут в новой валюте",
    ownerOnly: "Менять может только владелец",
    signup: "Валюта ресторана",
    signupHint: "Остатки и себестоимость будут в этой валюте. Потом можно сменить в настройках.",
    signupPick: "Выберите валюту",
    signupRequired: "Выберите валюту ресторана",
    receipt: "Валюта цены",
    supplier: "Валюта поставщика",
    restaurant: (code) => `Валюта ресторана (${code})`,
    fxRate: (from, to) => `Курс: 1 ${from} = ? ${to}`,
    converted: (original, base) => `${original} = ${base} (себестоимость считается от этого)`,
  },
};

export const LABELS_EN: LabelsDictionary = {
  locale: "en-GB",
  errors: {
    invalid_input: "Check the details",
    unauthenticated: "Please sign in again",
    no_tenant: "Restaurant not found",
    forbidden: "You are not allowed to do this",
    product_not_found: "Product not found",
    location_not_found: "Storage location not found",
    preparation_not_found: "Recipe not found",
    lot_not_found: "Lot not found",
    insufficient_stock: "Not enough in stock — nothing was saved",
    balance_mismatch: "The balance does not add up — check the difference or confirm the loss",
    stock_exists: "Stock exists, clear inventory before currency change",
    lot_expired: "Expired — it cannot be moved, write it off",
    open_count: "A count is going on here — move it after the count",
    request_not_found: "Order not found: pick a sent order of this product and branch",
    save_failed: "Could not save, try again",
  },
  receipt: {
    prep: "Prep it",
    source: { rule: "rule for this place", product: "product default", default: "restaurant default" },
    remember: "Remember as the rule for this place",
    copies: "How many labels?",
    working: "Please wait…",
  },
  birka: {
    name: "Name",
    lot: "Lot",
    made: "Made",
    expires: "Use by",
    composition: "Contains",
    qty: "Qty",
    storage: "Storage",
    portions: (count) => `${count} ${count === 1 ? "portion" : "portions"}`,
  },
  prep: {
    title: "Prep",
    hint: "Raw goods → prepped items. Each output gets its own use-by date and label.",
    nav: "Prep",
    empty: "No recipes yet",
    readOnly: "Owners and chefs edit recipes",
    add: "Add recipe",
    edit: "Edit",
    archive: "Archive",
    confirmArchive: "Archive this recipe?",
    name: "Name",
    inputs: "Takes",
    outputs: "Yields",
    product: "Product",
    choose: "Choose",
    qty: "Qty",
    portions: "Portions",
    outputName: "Name on the label",
    addInput: "+ input",
    addOutput: "+ output",
    remove: "Remove",
    save: "Save",
    cancel: "Cancel",
    working: "Please wait…",
    close: "Close",
    cook: "Prepare",
    cookTitle: (name) => `Prepare: ${name}`,
    taken: (unit) => `Amount taken (${unit})`,
    from: "Taken from",
    fromAuto: "Automatic (earliest expiry)",
    to: "Store in",
    yields: "Yield",
    expiry: (date) => `Use by ${date}`,
    ready: "Ready — put into storage",
    copiesFor: (product) => `Labels: ${product}`,
    printAll: "Print all",
    done: (count) => `${count} ${count === 1 ? "lot" : "lots"} created`,
  },
  expiring: {
    title: "Expiring soon",
    empty: "Nothing expires in the coming days",
    daysLeft: (days) => (days <= 0 ? "today" : `${days} ${days === 1 ? "day" : "days"}`),
    inStock: "In stock",
    reprint: "Label",
  },
  waste: {
    norm: "Waste norm, %",
    items: "Waste types",
    itemsHint: "With types, the norm is their sum",
    itemName: "What (e.g. bone)",
    itemPercent: "%",
    addItem: "+ type",
    plan: "Plan (recipe)",
    planNorm: (qty) => `Waste norm ${qty}`,
    fact: "Actual",
    qty: (unit) => `Waste (${unit})`,
    cause: "Reason",
    causes: { norm: "trimming norm", fatty: "too fatty", bony: "too bony", other: "other" },
    causeNote: "What happened?",
    balanceCause: "balance difference (confirmed loss)",
    portionWeight: "How many kg in 1 portion?",
    weightUnknown: (qty, approx) => `${qty}${approx ? ` (~${approx})` : ""} - weight unknown`,
    journal: { cause: "Reason", note: "Note", prep: "Prep", lot: "Lot number", day: "Day" },
    balanceOk: (diff) => `Balance: difference ${diff}`,
    balanceOff: (diff) => `Difference ${diff} - check it!`,
    balanceUnknown: "No balance (pieces or mixed units)",
    confirmLoss: "Yes, there is a loss",
    today: (qty, cost) => `Waste today: ${qty}${cost ? ` (${cost})` : ""}`,
    vsNorm: (norm, over) => (over > 0 ? ` - ${norm}% norm, ${over}% over` : ` - ${norm}% norm, within it`),
    noRuns: "No preps today",
    expiredTitle: "Already expired",
    expiredHint: "Kept out of sales. A chef or owner writes it off — it is logged as waste",
    expiredEmpty: "No expired stock",
    expiredDays: (days) =>
      days < 0 ? `${-days} ${-days === 1 ? "day" : "days"} past` : days === 0 ? "expires today" : `${days} ${days === 1 ? "day" : "days"} left`,
    writeOff: "Remove - spoiled",
    confirmWriteOff: (qty, product) => `Write off ${product}: ${qty} as waste?`,
    writtenOff: (product) => `${product} written off`,
  },
  trim: {
    section: "Returned (trim)",
    hint: "Usable trim goes back to stock (e.g. bones for stock) - it is taken off the net use",
    product: "What is returned",
    qty: (unit) => `Quantity (${unit})`,
    note: "Note (e.g. for stock)",
    add: "+ returned",
    noProducts: "No trim products - create a product of type “Trim” in the catalog",
    gross: "Taken",
    net: "Net use",
    planTrim: (qty) => `returned ${qty}`,
    planEvaporation: (qty) => `evaporation ${qty}`,
    balanceParts: (net, output, waste, evaporation) =>
      `${net} = output ${output} + waste ${waste}${evaporation ? ` + evaporation ${evaporation}` : ""}`,
    runLine: (run) =>
      `Taken ${run.gross}${run.trim ? ` · returned ${run.trim}` : ""} · net use ${run.net} vs waste ${run.waste} (${run.share})${run.evaporation ? ` · evaporation ${run.evaporation}` : ""}`,
    evaporation: "Evaporation, %",
    usable: "Usable - back to stock",
    usableProduct: "Trim product",
    lot: "Trim",
  },
  stock: {
    types: { raw: "Raw material", semi: "Preparation", ready: "Ready dish", trim: "Trim (returned)", waste: "Waste" },
    kinds: { raw: "Raw material", semi: "Preparations", trim: "Returned trim" },
    filters: { all: "All", raw: "Raw", semi: "Preparations", trim: "Returned", expiring: "Expiring" },
    title: "Stock on hand",
    hint: "Raw material, preparations and returned trim apart. FIFO: what expires first is on top.",
    cookHint: "Take what expires first (FIFO) - lot and expiry are on the label.",
    total: "Total",
    cost: "Cost",
    sale: "Sale",
    margin: "Margin",
    wasteToday: "Waste (today)",
    lines: (count) => `${count} ${count === 1 ? "line" : "lines"}`,
    unpriced: (count) => `${count} without a sale price`,
    open: "Open →",
    empty: "No stock",
    more: (shown, total) => `showing ${shown} of ${total}`,
    columns: { name: "Name", qty: "Qty", lot: "Lot", expiry: "Expires", cost: "Cost", sale: "Sale", kind: "Kind", place: "Place" },
    economics: {
      title: "Type and price",
      type: "Type",
      salePrice: "Sale price (per unit)",
      density: "Density, kg/l",
      trimValue: "Trim value, % of the raw cost",
      trimValueHint: "empty - restaurant default",
      save: "Save",
      saved: "Saved",
    },
  },
  move: {
    action: "Move",
    title: "Move to another place",
    hint: (qty, product, place) => `${qty} · ${product} · now: ${place}`,
    to: "To",
    noTargets: "No other active storage place in this branch",
    qty: "Quantity",
    qtyHint: (max) => `all: ${max}`,
    shelfLife: "Keeps for, days",
    expiry: "New use-by date",
    keeps: "Same kind of place — the date stays",
    restarts: "Another kind of place — the clock restarts today",
    remember: "Remember for this product in this place",
    reason: "Reason",
    reasonPlaceholder: "e.g. to the freezer so it is not thrown away",
    copies: "Labels",
    submit: "Move",
    working: "Moving…",
    done: (expiry) => `Moved · use by ${expiry}`,
  },
  norms: {
    title: "Where and how long it keeps",
    hint: "Days for each place. Empty — the product's general shelf life.",
    place: "Place",
    days: "Days",
    fallback: (days) => `empty: ${days} d`,
    noPlaces: "No storage places in this branch",
    save: "Save",
    saved: "Saved",
    readOnly: "Only the owner, chef and cook can change it",
  },
  photoAi: {
    badges: {
      approved: (confidence) => `AI ✅ ${confidence}%`,
      suspicious: "🔴 Suspicious",
      noAi: "📷 Photo (no AI)",
      pending: "AI checking…",
      limitReached: "📷 AI limit reached",
    },
    review: "Reviewed",
    reviewed: "Marked",
    needsReview: "Needs owner review",
    photoHint: "A photo proves the write-off.",
    today: "Waste today",
    todayLine: (logs, photos) => `${logs} ${logs === 1 ? "write-off" : "write-offs"} · ${photos} photos`,
    counts: (approved, suspicious) => `AI ✅ ${approved} · 🔴 ${suspicious}`,
    toReview: (count) => `${count} to review`,
    usage: (used, limit) => `AI ${used}/${limit} this month`,
    buyAi: (price) => `Buy AI package +${price}`,
  },
  billing: {
    title: "Subscription and packages",
    hint: "A package turns on after payment.",
    plan: "Plan",
    price: (price, days) => `${price} / ${days} days`,
    trial: (days) => `${days} days free`,
    photos: (count) => `${count} photos this month`,
    aiOff: "Photos on, no AI",
    aiUsage: (used, limit) => `AI checks: ${used}/${limit}`,
    freeChecks: (count) => `Free: ${count} AI checks a month`,
    packages: "Packages",
    addon: (price, photos, days) => `AI +${price} · ${photos} photos / ${days} days`,
    request: "Buy",
    requested: "Request sent - turns on after payment",
    active: "Active",
    settings: "Waste photos",
    photoEnabled: "Ask for a photo on write-off",
    aiEnabled: "AI check",
    tolerance: "Suspicious difference, %",
    toleranceHint: "When the AI weight differs from the logged one by more - suspicious",
    save: "Save",
    saved: "Saved",
    ownerOnly: "Only the owner can change this",
    open: "Subscription →",
  },
  currency: {
    title: "Currency",
    current: "Restaurant currency",
    save: "Change currency",
    saved: "Currency changed",
    warning: "Existing stock is not recalculated; new receipts will be in the new currency",
    ownerOnly: "Only the owner can change this",
    signup: "Restaurant currency",
    signupHint: "Stock and cost are shown in this currency. You can change it later in settings.",
    signupPick: "Choose a currency",
    signupRequired: "Choose the restaurant currency",
    receipt: "Price currency",
    supplier: "Supplier currency",
    restaurant: (code) => `Restaurant currency (${code})`,
    fxRate: (from, to) => `Rate: 1 ${from} = ? ${to}`,
    converted: (original, base) => `${original} = ${base} (cost is based on this)`,
  },
};
