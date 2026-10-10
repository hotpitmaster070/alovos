import type { SkipReason } from "@/lib/auto-order/delivery";
import type { AutoOrderNotify, LimitSource } from "@/lib/smart-settings/model";
import { ruPlural } from "./plural";

/** Owner settings page (/app/owner/settings) and the auto-order board (/app/anbar/sifarisler). */
export type AutoOrderDictionary = {
  settings: {
    open: string;
    title: string;
    subtitle: string;
    tabs: { stock: string; losses: string; autoOrder: string };
    ownerOnly: string;
    notReady: string;
    save: string;
    saving: string;
    saved: string;
    stock: {
      defaultLabel: string;
      defaultHint: string;
      branch: string;
      allBranches: string;
      branchHint: string;
      search: string;
      product: string;
      left: string;
      branchMin: string;
      productMin: string;
      effective: string;
      inherit: (value: string) => string;
      sources: Record<LimitSource, string>;
      legend: string;
      saveAll: (count: number) => string;
      nothingChanged: string;
      savedRows: (count: number) => string;
      empty: string;
      noMatch: string;
    };
    losses: {
      enabled: string;
      enabledHint: string;
      limit: string;
      limitHint: (value: string) => string;
      preview: string;
      sample: (percent: number) => string;
      tones: { ok: string; watch: string; over: string };
      open: string;
    };
    autoOrder: {
      enabled: string;
      enabledHint: string;
      draftTime: string;
      draftHint: string;
      time: string;
      timeHint: (timezone: string) => string;
      autoSend: string;
      autoSendHint: string;
      notify: string;
      channels: Record<AutoOrderNotify, string>;
      providers: { whatsapp: string; email: string; connected: string; missing: string; missingHint: string };
      timesOrder: string;
      open: string;
    };
  };
  board: {
    title: string;
    subtitle: string;
    ready: (suppliers: number) => string;
    nothing: string;
    branch: string;
    build: string;
    building: string;
    built: (suppliers: number) => string;
    noSupplier: string;
    noSupplierHint: string;
    setSupplier: string;
    preview: string;
    drafts: string;
    noDrafts: string;
    product: string;
    qty: string;
    left: string;
    auto: string;
    extra: string;
    addExtra: string;
    extraProduct: string;
    extraQty: string;
    add: string;
    cancel: string;
    message: string;
    sendOne: string;
    sendAll: (count: number) => string;
    sending: string;
    sent: (count: number) => string;
    whatsapp: string;
    email: string;
    noContact: string;
    oldBoard: string;
    readOnly: string;
    /** "Draft at 15:00 · auto-send at 18:00"; without auto-send only the draft time. */
    schedule: (draftTime: string, deadline: string, autoSend: boolean) => string;
    delivered: (channel: "whatsapp" | "email") => string;
    notDelivered: string;
    reasons: Record<SkipReason, string>;
    yesterdayFailed: string;
  };
  /** Owner dashboard: what went to suppliers yesterday. */
  owner: {
    title: string;
    sent: (orders: number) => string;
    /** Phase 1, before receiving: "~520 ₼". */
    estimated: (amount: string) => string;
    estimatedHint: string;
    /** Phase 2: "Заказано ~520 ₼ → Принято 780 ₼ (факт)". */
    actual: (estimated: string, actual: string) => string;
    /** Signed amount, e.g. "+260 ₼". */
    delta: (signed: string) => string;
    partial: (received: number, orders: number) => string;
    split: (chef: number, auto: number) => string;
    failed: (count: number) => string;
    none: string;
    open: string;
  };
  /** Start of the order message to the supplier: "Salam! Sifariş:". */
  message: { greeting: string; subject: string };
};

export const AUTO_ORDER_AZ: AutoOrderDictionary = {
  settings: {
    open: "Ağıllı ayarlar",
    title: "Ağıllı ayarlar",
    subtitle: "Limitlər, itki həddi və avto-sifariş — hamısı sizin restoran üçün",
    tabs: { stock: "Anbar və limitlər", losses: "İtkilər", autoOrder: "Avto-sifariş" },
    ownerOnly: "Bu ayarları yalnız sahibkar dəyişir.",
    notReady: "Ayarlar hələ bazada yoxdur: yeniləməni tətbiq edin.",
    save: "Saxla",
    saving: "Saxlanılır…",
    saved: "Saxlanıldı",
    stock: {
      defaultLabel: "Ümumi minimum",
      defaultHint: "Öz minimumu olmayan məhsullar üçün. 0 — izlənmir.",
      branch: "Filial",
      allBranches: "Bütün filiallar",
      branchHint: "Filial minimumu yalnız seçilmiş filial üçün qoyulur",
      search: "Məhsul axtar",
      product: "Məhsul",
      left: "Qalıb",
      branchMin: "Filial minimumu",
      productMin: "Məhsul minimumu",
      effective: "İşləyən",
      inherit: (value) => `boş — ${value}`,
      sources: { branch: "filial", product: "məhsul", tenant: "ümumi", off: "izlənmir" },
      legend: "Qayda: filial → məhsul → ümumi → 0 (izlənmir). Boş xana növbəti səviyyəni götürür.",
      saveAll: (n) => (n > 0 ? `Hamısını saxla (${n})` : "Hamısını saxla"),
      nothingChanged: "Dəyişiklik yoxdur",
      savedRows: (n) => `${n} məhsul saxlanıldı`,
      empty: "Hələ məhsul yoxdur",
      noMatch: "Heç nə tapılmadı",
    },
    losses: {
      enabled: "İtki xəbərdarlığı",
      enabledHint: "Söndürülsə, hesabatda heç nə qırmızı olmur",
      limit: "İtki həddi",
      limitHint: (v) => `${v}%-dən çox itki qırmızı göstərilir`,
      preview: "Necə görünəcək",
      sample: (p) => `${p}% itki`,
      tones: { ok: "normal", watch: "diqqət", over: "həddən yuxarı" },
      open: "İtki hesabatı",
    },
    autoOrder: {
      enabled: "Avto-sifariş",
      enabledHint: "Hər gün sistem minimumdan aşağı olanları təchizatçılar üzrə qaralamaya yığır, şef əlavə edir və göndərir",
      draftTime: "Qaralama vaxtı",
      draftHint: "Sistem bu vaxt minimumdan aşağı olanları qaralamaya yığır",
      time: "Göndərmə son vaxtı",
      timeHint: (tz) => `Şef bu vaxta qədər göndərməsə, sistem özü göndərir. Restoranın vaxtı ilə (${tz})`,
      autoSend: "Şef göndərməsə, özü göndər",
      autoSendHint: "Son vaxtda qaralamalar (sistem + əlavələr) təchizatçılara gedir. Sahibkara bildiriş getmir — səhər paneldə görünür",
      notify: "Təchizatçılara necə göndərilsin",
      channels: { system: "Mesaj göndərmə (şef özü göndərir)", whatsapp: "WhatsApp, olmasa e-poçt", email: "E-poçt, olmasa WhatsApp" },
      providers: {
        whatsapp: "WhatsApp",
        email: "E-poçt",
        connected: "qoşulub",
        missing: "qoşulmayıb",
        missingHint: "Qoşulmayan kanal üçün sifariş qaralamada qalır, şef onu linklə göndərir",
      },
      timesOrder: "Qaralama vaxtı son vaxtdan gec ola bilməz",
      open: "Sifarişlərə keç",
    },
  },
  board: {
    title: "Avto-sifariş",
    subtitle: "Minimumdan aşağı olanlar, təchizatçılar üzrə",
    ready: (n) => `Avto-sifariş hazırdır! ${n} təchizatçı`,
    nothing: "Hər şey minimumdan yuxarıdır — sifariş lazım deyil.",
    branch: "Filial",
    build: "Sifarişi indi yığ",
    building: "Yığılır…",
    built: (n) => `${n} təchizatçı üçün qaralama hazırdır`,
    noSupplier: "Təchizatçısız",
    noSupplierHint: "Bu məhsullara təchizatçı təyin edin — onda sifarişə düşəcəklər.",
    setSupplier: "Kataloqda təyin et",
    preview: "Nə lazımdır",
    drafts: "Bugünkü qaralamalar",
    noDrafts: "Hələ qaralama yoxdur. «Sifarişi indi yığ» düyməsini basın.",
    product: "Məhsul",
    qty: "Miqdar",
    left: "Qalıb",
    auto: "avto",
    extra: "əlavə",
    addExtra: "+ Əlavə məhsul",
    extraProduct: "Məhsul",
    extraQty: "Miqdar",
    add: "Əlavə et",
    cancel: "Ləğv et",
    message: "Mesaj",
    sendOne: "Bu təchizatçıya göndər",
    sendAll: (n) => `Hamısını göndər (${n})`,
    sending: "Göndərilir…",
    sent: (n) => `${n} sifariş göndərildi`,
    whatsapp: "WhatsApp-da aç",
    email: "E-poçtla",
    noContact: "Telefon və e-poçt yoxdur",
    oldBoard: "Bütün sifarişlər",
    readOnly: "Sifarişləri şef və sahibkar göndərir.",
    schedule: (d, s, auto) => (auto ? `Qaralama ${d}-da · avto-göndərmə ${s}-da` : `Qaralama ${d}-da · şef özü göndərir`),
    delivered: (c) => (c === "whatsapp" ? "WhatsApp-a getdi" : "E-poçta getdi"),
    notDelivered: "Getmədi — linklə göndərin",
    reasons: { disabled: "mesaj göndərmə söndürülüb", no_contact: "telefon və e-poçt yoxdur", not_configured: "WhatsApp / e-poçt qoşulmayıb" },
    yesterdayFailed: "Dünən avtomatik getməyənlər",
  },
  owner: {
    title: "Dünən təchizatçılara",
    sent: (n) => `${n} sifariş göndərildi`,
    estimated: (a) => `~${a}`,
    estimatedHint: "təxmini · son alış qiymətləri ilə, qəbuldan sonra dəqiqləşəcək",
    actual: (e, a) => `Sifariş ~${e} → Qəbul ${a} (fakt)`,
    delta: (s) => `${s} təxminə görə`,
    partial: (r, n) => `${n} sifarişdən ${r}-i qəbul edilib, qalanları yoldadır`,
    split: (c, a) => `şef: ${c} · avtomatik: ${a}`,
    failed: (n) => `${n} getmədi`,
    none: "Dünən sifariş göndərilməyib",
    open: "Sifarişlər",
  },
  message: { greeting: "Salam! Sifariş:", subject: "Sifariş" },
};

export const AUTO_ORDER_RU: AutoOrderDictionary = {
  settings: {
    open: "Умные настройки",
    title: "Умные настройки",
    subtitle: "Лимиты, порог потерь и авто-заказ — под ваш ресторан",
    tabs: { stock: "Склад и лимиты", losses: "Потери", autoOrder: "Авто-заказ" },
    ownerOnly: "Эти настройки меняет только владелец.",
    notReady: "Настроек ещё нет в базе: примените обновление.",
    save: "Сохранить",
    saving: "Сохранение…",
    saved: "Сохранено",
    stock: {
      defaultLabel: "Общий минимум",
      defaultHint: "Для товаров без своего минимума. 0 — не отслеживать.",
      branch: "Филиал",
      allBranches: "Все филиалы",
      branchHint: "Минимум филиала задаётся только для выбранного филиала",
      search: "Поиск товара",
      product: "Товар",
      left: "Осталось",
      branchMin: "Минимум филиала",
      productMin: "Минимум товара",
      effective: "Действует",
      inherit: (value) => `пусто — ${value}`,
      sources: { branch: "филиал", product: "товар", tenant: "общий", off: "не отслеживается" },
      legend: "Порядок: филиал → товар → общий → 0 (не отслеживать). Пустая ячейка берёт следующий уровень.",
      saveAll: (n) => (n > 0 ? `Сохранить всё (${n})` : "Сохранить всё"),
      nothingChanged: "Изменений нет",
      savedRows: (n) => `Сохранено: ${n} ${ruPlural(n, "товар", "товара", "товаров")}`,
      empty: "Товаров пока нет",
      noMatch: "Ничего не найдено",
    },
    losses: {
      enabled: "Предупреждать о потерях",
      enabledHint: "Если выключить, в отчёте ничего не подсвечивается красным",
      limit: "Порог потерь",
      limitHint: (v) => `Потери больше ${v}% подсвечиваются красным`,
      preview: "Как это будет выглядеть",
      sample: (p) => `${p}% потерь`,
      tones: { ok: "норма", watch: "внимание", over: "выше порога" },
      open: "Отчёт о потерях",
    },
    autoOrder: {
      enabled: "Авто-заказ",
      enabledHint: "Каждый день система собирает всё, что ниже минимума, в черновики по поставщикам, шеф дополняет и отправляет",
      draftTime: "Время черновика",
      draftHint: "В это время система собирает всё, что ниже минимума, в черновики",
      time: "Дедлайн отправки",
      timeHint: (tz) => `Если шеф не отправит до этого времени, система отправит сама. По времени ресторана (${tz})`,
      autoSend: "Отправлять автоматически, если шеф не нажал",
      autoSendHint: "В дедлайн черновики (система + экстра) уходят поставщикам. Владельцу уведомление не приходит — утром видно в дашборде",
      notify: "Как отправлять поставщикам",
      channels: { system: "Не отправлять сообщения (шеф отправляет сам)", whatsapp: "WhatsApp, если нет — email", email: "Email, если нет — WhatsApp" },
      providers: {
        whatsapp: "WhatsApp",
        email: "Email",
        connected: "подключён",
        missing: "не подключён",
        missingHint: "Если канал не подключён, заказ остаётся черновиком и шеф отправляет его по ссылке",
      },
      timesOrder: "Время черновика не может быть позже дедлайна",
      open: "К заказам",
    },
  },
  board: {
    title: "Авто-заказ",
    subtitle: "Что ниже минимума, по поставщикам",
    ready: (n) => `Авто-заказ готов! ${n} ${ruPlural(n, "поставщик", "поставщика", "поставщиков")}`,
    nothing: "Всё выше минимума — заказывать нечего.",
    branch: "Филиал",
    build: "Составить заказ сейчас",
    building: "Составляем…",
    built: (n) => `Черновики готовы: ${n} ${ruPlural(n, "поставщик", "поставщика", "поставщиков")}`,
    noSupplier: "Без поставщика",
    noSupplierHint: "Назначьте этим товарам поставщика — тогда они попадут в заказ.",
    setSupplier: "Назначить в каталоге",
    preview: "Что нужно",
    drafts: "Черновики на сегодня",
    noDrafts: "Черновиков пока нет. Нажмите «Составить заказ сейчас».",
    product: "Товар",
    qty: "Кол-во",
    left: "Осталось",
    auto: "авто",
    extra: "экстра",
    addExtra: "+ Добавить экстра товар",
    extraProduct: "Товар",
    extraQty: "Количество",
    add: "Добавить",
    cancel: "Отмена",
    message: "Сообщение",
    sendOne: "Отправить этому поставщику",
    sendAll: (n) => `Отправить все (${n})`,
    sending: "Отправка…",
    sent: (n) => `Отправлено: ${n} ${ruPlural(n, "заказ", "заказа", "заказов")}`,
    whatsapp: "Открыть WhatsApp",
    email: "По email",
    noContact: "Нет телефона и email",
    oldBoard: "Все заказы",
    readOnly: "Заказы отправляют шеф и владелец.",
    schedule: (d, s, auto) => (auto ? `Черновик в ${d} · авто-отправка в ${s}` : `Черновик в ${d} · отправляет шеф`),
    delivered: (c) => (c === "whatsapp" ? "Ушло в WhatsApp" : "Ушло на email"),
    notDelivered: "Не ушло — отправьте по ссылке",
    reasons: { disabled: "сообщения выключены", no_contact: "нет телефона и email", not_configured: "WhatsApp / email не подключены" },
    yesterdayFailed: "Вчера не ушло автоматически",
  },
  owner: {
    title: "Вчера поставщикам",
    sent: (n) => `Отправлено ${n} ${ruPlural(n, "заказ", "заказа", "заказов")}`,
    estimated: (a) => `~${a}`,
    estimatedHint: "примерно · по последним ценам, уточнится после приёмки",
    actual: (e, a) => `Заказано ~${e} → Принято ${a} (факт)`,
    delta: (s) => `${s} к оценке`,
    partial: (r, n) => `принято ${r} из ${n}, остальные ещё в пути`,
    split: (c, a) => `шеф: ${c} · автоматически: ${a}`,
    failed: (n) => `не ушло: ${n}`,
    none: "Вчера заказы не отправлялись",
    open: "Заказы",
  },
  message: { greeting: "Здравствуйте! Заказ:", subject: "Заказ" },
};

export const AUTO_ORDER_EN: AutoOrderDictionary = {
  settings: {
    open: "Smart settings",
    title: "Smart settings",
    subtitle: "Limits, loss line and auto-order — tuned to your restaurant",
    tabs: { stock: "Stock and limits", losses: "Losses", autoOrder: "Auto-order" },
    ownerOnly: "Only the owner changes these settings.",
    notReady: "These settings are not in the database yet: apply the update.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    stock: {
      defaultLabel: "Default minimum",
      defaultHint: "For products without their own minimum. 0 — not tracked.",
      branch: "Branch",
      allBranches: "All branches",
      branchHint: "A branch minimum is set for the selected branch only",
      search: "Search products",
      product: "Product",
      left: "Left",
      branchMin: "Branch minimum",
      productMin: "Product minimum",
      effective: "In effect",
      inherit: (value) => `empty — ${value}`,
      sources: { branch: "branch", product: "product", tenant: "default", off: "not tracked" },
      legend: "Order: branch → product → default → 0 (not tracked). An empty cell takes the next level.",
      saveAll: (n) => (n > 0 ? `Save all (${n})` : "Save all"),
      nothingChanged: "Nothing changed",
      savedRows: (n) => `${n} product${n === 1 ? "" : "s"} saved`,
      empty: "No products yet",
      noMatch: "Nothing found",
    },
    losses: {
      enabled: "Loss alert",
      enabledHint: "When off, nothing in the report turns red",
      limit: "Loss line",
      limitHint: (v) => `Losses above ${v}% turn red`,
      preview: "How it will look",
      sample: (p) => `${p}% loss`,
      tones: { ok: "normal", watch: "watch", over: "over the line" },
      open: "Loss report",
    },
    autoOrder: {
      enabled: "Auto-order",
      enabledHint: "Every day the system puts everything below its minimum into drafts per supplier; the chef adds and sends",
      draftTime: "Draft time",
      draftHint: "At this time the system drafts everything below its minimum",
      time: "Send deadline",
      timeHint: (tz) => `If the chef has not sent by then, the system sends. In the restaurant's time (${tz})`,
      autoSend: "Send automatically if the chef has not",
      autoSendHint: "At the deadline the drafts (system + extras) go to the suppliers. The owner is not notified — it shows on the dashboard in the morning",
      notify: "How orders reach suppliers",
      channels: { system: "No messages (the chef sends)", whatsapp: "WhatsApp, else email", email: "Email, else WhatsApp" },
      providers: {
        whatsapp: "WhatsApp",
        email: "Email",
        connected: "connected",
        missing: "not connected",
        missingHint: "Without a connected channel the order stays a draft and the chef sends it by link",
      },
      timesOrder: "The draft time cannot be after the deadline",
      open: "Go to orders",
    },
  },
  board: {
    title: "Auto-order",
    subtitle: "What is below its minimum, per supplier",
    ready: (n) => `Auto-order ready! ${n} supplier${n === 1 ? "" : "s"}`,
    nothing: "Everything is above its minimum — nothing to order.",
    branch: "Branch",
    build: "Build the order now",
    building: "Building…",
    built: (n) => `Drafts ready for ${n} supplier${n === 1 ? "" : "s"}`,
    noSupplier: "No supplier",
    noSupplierHint: "Give these products a supplier and they will be ordered.",
    setSupplier: "Set in the catalog",
    preview: "What is needed",
    drafts: "Today's drafts",
    noDrafts: "No drafts yet. Press “Build the order now”.",
    product: "Product",
    qty: "Qty",
    left: "Left",
    auto: "auto",
    extra: "extra",
    addExtra: "+ Add an extra product",
    extraProduct: "Product",
    extraQty: "Quantity",
    add: "Add",
    cancel: "Cancel",
    message: "Message",
    sendOne: "Send to this supplier",
    sendAll: (n) => `Send all (${n})`,
    sending: "Sending…",
    sent: (n) => `${n} order${n === 1 ? "" : "s"} sent`,
    whatsapp: "Open WhatsApp",
    email: "By email",
    noContact: "No phone or email",
    oldBoard: "All orders",
    readOnly: "Chefs and owners send orders.",
    schedule: (d, s, auto) => (auto ? `Draft at ${d} · auto-send at ${s}` : `Draft at ${d} · the chef sends`),
    delivered: (c) => (c === "whatsapp" ? "Sent on WhatsApp" : "Sent by email"),
    notDelivered: "Not delivered — send by link",
    reasons: { disabled: "messages are off", no_contact: "no phone or email", not_configured: "WhatsApp / email not connected" },
    yesterdayFailed: "Not sent automatically yesterday",
  },
  owner: {
    title: "Yesterday to suppliers",
    sent: (n) => `${n} order${n === 1 ? "" : "s"} sent`,
    estimated: (a) => `~${a}`,
    estimatedHint: "approximate · at the latest purchase prices, confirmed after receiving",
    actual: (e, a) => `Ordered ~${e} → Received ${a} (actual)`,
    delta: (s) => `${s} vs estimate`,
    partial: (r, n) => `${r} of ${n} received, the rest on the way`,
    split: (c, a) => `chef: ${c} · automatic: ${a}`,
    failed: (n) => `${n} not delivered`,
    none: "No orders were sent yesterday",
    open: "Orders",
  },
  message: { greeting: "Hello! Order:", subject: "Order" },
};
