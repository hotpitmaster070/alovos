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
      time: string;
      timeHint: (timezone: string) => string;
      notify: string;
      channels: Record<AutoOrderNotify, string>;
      channelHint: string;
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
      enabledHint: "Hər gün sistem minimumdan aşağı olanları təchizatçılar üzrə qaralamaya yığır",
      time: "Vaxt",
      timeHint: (tz) => `Restoranın vaxtı ilə (${tz})`,
      notify: "Bildiriş",
      channels: { system: "Sistemdə", whatsapp: "WhatsApp", email: "E-poçt" },
      channelHint: "WhatsApp və e-poçt hələlik yalnız jurnala yazılır",
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
      enabledHint: "Каждый день система собирает всё, что ниже минимума, в черновики по поставщикам",
      time: "Время",
      timeHint: (tz) => `По времени ресторана (${tz})`,
      notify: "Уведомление",
      channels: { system: "В системе", whatsapp: "WhatsApp", email: "Email" },
      channelHint: "WhatsApp и email пока только записываются в журнал",
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
      enabledHint: "Every day the system puts everything below its minimum into drafts per supplier",
      time: "Time",
      timeHint: (tz) => `In the restaurant's time (${tz})`,
      notify: "Notification",
      channels: { system: "In the app", whatsapp: "WhatsApp", email: "Email" },
      channelHint: "WhatsApp and email are only logged for now",
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
  },
  message: { greeting: "Hello! Order:", subject: "Order" },
};
