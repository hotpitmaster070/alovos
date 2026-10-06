import type { BlockSlug } from "@/lib/block-slugs";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import type { Unit } from "@/lib/anbar/types";
import type { LoginErrorCode } from "@/lib/auth-errors";

export type BlockDetails = {
  spec: string;
  killers: readonly string[];
};

export type AnbarDictionary = {
  title: string;
  catalog: {
    title: string;
    open: string;
    empty: string;
    quantity: string;
    branch: string;
    noBranch: string;
  };
  searchLabel: string;
  searchPlaceholder: string;
  searchButton: string;
  scan: {
    open: string;
    title: string;
    hint: string;
    close: string;
    denied: string;
    failed: string;
  };
  filters: {
    title: string;
    location: string;
    allLocations: string;
    expiredOnly: string;
    lowStock: (threshold: number) => string;
    expiry: string;
    expiryAll: string;
    expiryWeek: string;
    expiryMonth: string;
    expiryOk: string;
    apply: string;
    reset: string;
  };
  pagination: {
    previous: string;
    next: string;
    page: (page: number) => string;
  };
  emptyTitle: string;
  emptyHint: string;
  noMatchTitle: string;
  noMatchHint: string;
  errorTitle: string;
  retry: string;
  loading: string;
  fields: {
    barcode: string;
    location: string;
    qty: string;
    cost: string;
    expiry: string;
    noLocation: string;
    noBarcode: string;
    noExpiry: string;
    actions: string;
    name: string;
  };
  expiry: {
    expired: string;
    today: string;
    daysLeft: (days: number) => string;
  };
  lowStockBadge: string;
  move: {
    open: string;
    title: string;
    description: (name: string, from: string) => string;
    target: string;
    choose: string;
    qty: string;
    available: (qty: number, unit: string) => string;
    submit: string;
    working: string;
    success: string;
    noTargets: string;
    needsLocation: string;
    cancel: string;
  };
  addLocation: {
    open: string;
    title: string;
    name: string;
    submit: string;
    success: string;
  };
  addProduct: {
    open: string;
    title: string;
    name: string;
    barcode: string;
    qty: string;
    unit: string;
    cost: string;
    expiry: string;
    location: string;
    noLocation: string;
    submit: string;
    success: string;
    cancel: string;
  };
  working: string;
  units: Record<Unit, string>;
  errors: Record<AnbarErrorCode, string>;
};

export type LoginDictionary = {
  title: string;
  subtitle: string;
  email: string;
  password: string;
  passwordHint: string;
  signIn: string;
  signUp: string;
  haveAccount: string;
  noAccount: string;
  working: string;
  confirmEmail: string;
  errors: Record<LoginErrorCode, string>;
};

export type OnboardingDictionary = {
  title: string;
  body: string;
  retry: string;
};

export type Dictionary = {
  languageLabel: string;
  hero: {
    title: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  modulesLabel: string;
  price: {
    amount: number;
    currency: string;
    period: string;
    included: string;
    trialDays: number;
    trial: (days: number) => string;
    cta: string;
  };
  footer: {
    tagline: string;
  };
  moduleStub: string;
  blockNumber: string;
  sidebar: {
    dashboard: string;
    openMenu: string;
    closeMenu: string;
    killer: string;
    signOut: string;
  };
  blockDetails: Record<BlockSlug, BlockDetails>;
  anbar: AnbarDictionary;
  login: LoginDictionary;
  onboarding: OnboardingDictionary;
};

const AZ: Dictionary = {
  languageLabel: "Dil",
  hero: {
    title: "Mətbəx üçün əməliyyat sistemi",
    subtitle: "12 blok. Bir mətbəx əməliyyat sistemi.",
    ctaPrimary: "Pulsuz Başla",
    ctaSecondary: "Panelə bax",
  },
  modulesLabel: "Modullar",
  price: {
    amount: 79,
    currency: "AZN",
    period: "ay",
    included: "Hər şey daxil.",
    trialDays: 14,
    trial: (days) => `${days} gün pulsuz sınaq.`,
    cta: "Başla - pulsuz",
  },
  footer: {
    tagline: "Built for modern kitchens · Baku, AZ.",
  },
  moduleStub: "Modul {name} - spek hazırdır, UI növbəti",
  blockNumber: "Blok",
  sidebar: {
    dashboard: "Panel",
    openMenu: "Menyunu aç",
    closeMenu: "Menyunu bağla",
    killer: "KILLER",
    signOut: "Çıxış",
  },
  blockDetails: {
    anbar: {
      spec: "Ehtiyatlar: məhsullar, barkodlar, son istifadə tarixi, inventarizasiya, transferlər.",
      killers: [],
    },
    techizat: {
      spec: "Təchizatçılar, qiymət siyahıları, satınalma sorğuları.",
      killers: [],
    },
    hesablar: {
      spec: "AI skan ilə qaimələr (ai_scan_json).",
      killers: ["3.1 AI skan qaimə 99%"],
    },
    reseptler: {
      spec: "Reseptlər: brutto/netto/itki/çıxım, canlı maya dəyəri, 14 allergen, KBJU.",
      killers: ["4.4 Avtomatik allergenlər 14 + KBJU"],
    },
    tullanti: {
      spec: "Tullantı jurnalı: səbəb, foto, çəki, AI Tani.",
      killers: ["5.2 Foto + AI Tani Vision API"],
    },
    hazirliq: {
      spec: "Hazırlıq planlaşdırması və istehsal.",
      killers: [],
    },
    pos: {
      spec: "POS satışlarının sinxronizasiyası.",
      killers: [],
    },
    analitika: {
      spec: "Analitik hesabatlar, menyu mühəndisliyi, avto-məsləhətlər.",
      killers: ["8.4 Ulduzlar/Atlar/İtlər + Avto-məsləhət"],
    },
    komanda: {
      spec: "QR və fotoşəkilli əməkdaşlar.",
      killers: [],
    },
    haccp: {
      spec: "Temperatur jurnalları (əl ilə + IoT Shelly) və yoxlama siyahıları.",
      killers: ["10.1 IoT Shelly + WhatsApp xəbərdarlığı"],
    },
    "ai-skaner": {
      spec: "AI skaner: qaimələr və tullantı vedrəsinin tanınması.",
      killers: ["11.3 AI Tani vedrə Vision API"],
    },
    sebeke: {
      spec: "Şəbəkə və françayzinq idarəetməsi.",
      killers: [],
    },
  },
  anbar: {
    title: "Anbar",
    catalog: {
      title: "Kataloq",
      open: "Kataloq",
      empty: "Kataloq boşdur",
      quantity: "Miqdar",
      branch: "Filial",
      noBranch: "Filial yoxdur",
    },
    searchLabel: "Barkod",
    searchPlaceholder: "Barkodu skan edin və ya yazın",
    searchButton: "Axtar",
    scan: {
      open: "Kamera ilə skan",
      title: "Barkodu skan edin",
      hint: "Kameranı barkoda yönəldin.",
      close: "Bağla",
      denied: "Kameraya icazə verilmədi.",
      failed: "Kameranı işə salmaq mümkün olmadı.",
    },
    filters: {
      title: "Filtrlər",
      location: "Məkan",
      allLocations: "Bütün məkanlar",
      expiredOnly: "Yalnız vaxtı keçmişlər",
      lowStock: (threshold) => `Az qalıq (< ${threshold})`,
      expiry: "Son istifadə tarixi",
      expiryAll: "Hamısı",
      expiryWeek: "7 gündən az",
      expiryMonth: "30 gündən az",
      expiryOk: "30 gündən çox",
      apply: "Tətbiq et",
      reset: "Təmizlə",
    },
    pagination: {
      previous: "Əvvəlki",
      next: "Növbəti",
      page: (page) => `Səhifə ${page}`,
    },
    emptyTitle: "Anbar boşdur",
    emptyHint: "İlk məkanı və məhsulu əlavə edin.",
    noMatchTitle: "Heç nə tapılmadı",
    noMatchHint: "Bu filtrlərə uyğun məhsul yoxdur.",
    errorTitle: "Anbarı yükləmək mümkün olmadı",
    retry: "Yenidən cəhd et",
    loading: "Yüklənir",
    fields: {
      barcode: "Barkod",
      location: "Məkan",
      qty: "Miqdar",
      cost: "Maya dəyəri",
      expiry: "Son istifadə tarixi",
      noLocation: "Məkan yoxdur",
      noBarcode: "Barkodsuz",
      noExpiry: "Tarixsiz",
      actions: "Əməliyyat",
      name: "Ad",
    },
    expiry: {
      expired: "Vaxtı keçib",
      today: "Bu gün bitir",
      daysLeft: (days) => `${days} gün qalıb`,
    },
    lowStockBadge: "Az qalıb",
    move: {
      open: "Köçür",
      title: "Məhsulu köçür",
      description: (name, from) => `${name} - ${from}`,
      target: "Hədəf məkan",
      choose: "Məkan seçin",
      qty: "Köçürülən miqdar",
      available: (qty, unit) => `Mövcud: ${qty} ${unit}`,
      submit: "Köçür",
      working: "Köçürülür",
      success: "Köçürüldü",
      noTargets: "Köçürmək üçün başqa məkan yoxdur.",
      needsLocation: "Köçürmək üçün məhsulun məkanı olmalıdır.",
      cancel: "Ləğv et",
    },
    addLocation: {
      open: "Məkan əlavə et",
      title: "Yeni məkan",
      name: "Məkanın adı",
      submit: "Əlavə et",
      success: "Məkan əlavə edildi",
    },
    addProduct: {
      open: "Məhsul əlavə et",
      title: "Yeni məhsul",
      name: "Məhsulun adı",
      barcode: "Barkod",
      qty: "Miqdar",
      unit: "Vahid",
      cost: "Maya dəyəri",
      expiry: "Son istifadə tarixi",
      location: "Məkan",
      noLocation: "Məkansız",
      submit: "Əlavə et",
      success: "Məhsul əlavə edildi",
      cancel: "Ləğv et",
    },
    working: "Saxlanılır",
    units: { kg: "kq", g: "q", l: "l", ml: "ml", pcs: "ədəd" },
    errors: {
      unauthenticated: "Davam etmək üçün daxil olun.",
      invalidInput: "Daxil edilən məlumat düzgün deyil.",
      productNotFound: "Məhsul tapılmadı.",
      locationNotFound: "Məkan tapılmadı.",
      sameLocation: "Məhsul artıq bu məkandadır.",
      invalidQty: "Miqdar sıfırdan böyük olmalıdır.",
      exceedsQty: "Miqdar mövcud ehtiyatdan çoxdur.",
      unitMismatch: "Hədəf məkandakı eyni barkodlu məhsulun vahidi fərqlidir.",
      duplicateBarcode: "Bu məkanda həmin barkodlu məhsul artıq var.",
      concurrent: "Məlumat dəyişdi. Səhifəni yeniləyib yenidən cəhd edin.",
      saveFailed: "Yadda saxlamaq mümkün olmadı.",
    },
  },
  login: {
    title: "Daxil ol",
    subtitle: "alovos hesabınıza daxil olun və ya yeni hesab yaradın.",
    email: "E-poçt",
    password: "Şifrə",
    passwordHint: "Ən azı 6 simvol.",
    signIn: "Daxil ol",
    signUp: "Qeydiyyat",
    haveAccount: "Hesabınız var? Daxil olun",
    noAccount: "Hesabınız yoxdur? Qeydiyyatdan keçin",
    working: "Gözləyin",
    confirmEmail: "Hesab yaradıldı. Təsdiq üçün e-poçtunuzu yoxlayın.",
    errors: {
      invalidCredentials: "E-poçt və ya şifrə yanlışdır.",
      weakPassword: "Şifrə çox zəifdir. Daha uzun və mürəkkəb şifrə seçin.",
      emailTaken: "Bu e-poçt artıq qeydiyyatdan keçib.",
      emailNotConfirmed: "E-poçt hələ təsdiqlənməyib. Gələn qutunuzu yoxlayın.",
      rateLimited: "Çox cəhd edildi. Bir az sonra yenidən cəhd edin.",
      network: "Şəbəkə xətası. Bağlantını yoxlayıb yenidən cəhd edin.",
      unknown: "Alınmadı. Yenidən cəhd edin.",
    },
  },
  onboarding: {
    title: "Təşkilat tapılmadı",
    body: "Bu hesaba təşkilat bağlamaq mümkün olmadı. Yenidən cəhd edin və ya başqa hesabla daxil olun.",
    retry: "Yenidən cəhd et",
  },
};

const RU: Dictionary = {
  languageLabel: "Язык",
  hero: {
    title: "Операционная система для кухни",
    subtitle: "12 блоков. Одна операционная система для кухни.",
    ctaPrimary: "Начать бесплатно",
    ctaSecondary: "Смотреть панель",
  },
  modulesLabel: "Модули",
  price: {
    amount: 79,
    currency: "AZN",
    period: "мес",
    included: "Всё включено.",
    trialDays: 14,
    trial: (days) => `${days} дней бесплатного пробного периода.`,
    cta: "Начать - бесплатно",
  },
  footer: {
    tagline: "Создано для современных кухонь · Баку, AZ.",
  },
  moduleStub: "Модуль {name} - спек готов, UI далее",
  blockNumber: "Блок",
  sidebar: {
    dashboard: "Панель",
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    killer: "KILLER",
    signOut: "Выйти",
  },
  blockDetails: {
    anbar: {
      spec: "Запасы: продукты, штрихкоды, сроки годности, инвентаризация, перемещения.",
      killers: [],
    },
    techizat: {
      spec: "Поставщики, прайс-листы, заявки на закупку.",
      killers: [],
    },
    hesablar: {
      spec: "Счета с AI-сканированием (ai_scan_json).",
      killers: ["3.1 AI-скан счёта 99%"],
    },
    reseptler: {
      spec: "Рецепты: брутто/нетто/потери/выход, живая себестоимость, 14 аллергенов, КБЖУ.",
      killers: ["4.4 Аллергены авто 14 + КБЖУ"],
    },
    tullanti: {
      spec: "Журнал списаний: причина, фото, вес, AI Tani.",
      killers: ["5.2 Фото + AI Tani Vision API"],
    },
    hazirliq: {
      spec: "Планирование заготовок и производство.",
      killers: [],
    },
    pos: {
      spec: "Синхронизация продаж с кассой.",
      killers: [],
    },
    analitika: {
      spec: "Аналитические отчёты, инженерия меню, авто-советы.",
      killers: ["8.4 Звёзды/Лошади/Собаки + Авто-советы"],
    },
    komanda: {
      spec: "Сотрудники с QR и фото.",
      killers: [],
    },
    haccp: {
      spec: "Журналы температур (вручную + IoT Shelly) и чек-листы.",
      killers: ["10.1 IoT Shelly + уведомление в WhatsApp"],
    },
    "ai-skaner": {
      spec: "AI-сканер: счета и распознавание мусорного ведра.",
      killers: ["11.3 AI Tani ведро Vision API"],
    },
    sebeke: {
      spec: "Управление сетью и франшизой.",
      killers: [],
    },
  },
  anbar: {
    title: "Склад",
    catalog: {
      title: "Каталог",
      open: "Каталог",
      empty: "В каталоге пока нет товаров",
      quantity: "Количество",
      branch: "Филиал",
      noBranch: "Без филиала",
    },
    searchLabel: "Штрихкод",
    searchPlaceholder: "Отсканируйте или введите штрихкод",
    searchButton: "Найти",
    scan: {
      open: "Сканировать камерой",
      title: "Сканирование штрихкода",
      hint: "Наведите камеру на штрихкод.",
      close: "Закрыть",
      denied: "Нет доступа к камере.",
      failed: "Не удалось запустить камеру.",
    },
    filters: {
      title: "Фильтры",
      location: "Локация",
      allLocations: "Все локации",
      expiredOnly: "Только просроченные",
      lowStock: (threshold) => `Мало на складе (< ${threshold})`,
      expiry: "Срок годности",
      expiryAll: "Любой",
      expiryWeek: "Меньше 7 дней",
      expiryMonth: "Меньше 30 дней",
      expiryOk: "Больше 30 дней",
      apply: "Применить",
      reset: "Сбросить",
    },
    pagination: {
      previous: "Назад",
      next: "Вперёд",
      page: (page) => `Страница ${page}`,
    },
    emptyTitle: "Склад пуст",
    emptyHint: "Добавьте первую локацию и товар.",
    noMatchTitle: "Ничего не найдено",
    noMatchHint: "Нет товаров, подходящих под фильтры.",
    errorTitle: "Не удалось загрузить склад",
    retry: "Повторить",
    loading: "Загрузка",
    fields: {
      barcode: "Штрихкод",
      location: "Локация",
      qty: "Количество",
      cost: "Себестоимость",
      expiry: "Срок годности",
      noLocation: "Без локации",
      noBarcode: "Без штрихкода",
      noExpiry: "Без срока",
      actions: "Действия",
      name: "Название",
    },
    expiry: {
      expired: "Просрочено",
      today: "Истекает сегодня",
      daysLeft: (days) => `Осталось ${days} дн.`,
    },
    lowStockBadge: "Мало",
    move: {
      open: "Переместить",
      title: "Переместить товар",
      description: (name, from) => `${name} - ${from}`,
      target: "Целевая локация",
      choose: "Выберите локацию",
      qty: "Количество к перемещению",
      available: (qty, unit) => `Доступно: ${qty} ${unit}`,
      submit: "Переместить",
      working: "Перемещение",
      success: "Перемещено",
      noTargets: "Нет другой локации для перемещения.",
      needsLocation: "Чтобы переместить товар, у него должна быть локация.",
      cancel: "Отмена",
    },
    addLocation: {
      open: "Добавить локацию",
      title: "Новая локация",
      name: "Название локации",
      submit: "Добавить",
      success: "Локация добавлена",
    },
    addProduct: {
      open: "Добавить товар",
      title: "Новый товар",
      name: "Название товара",
      barcode: "Штрихкод",
      qty: "Количество",
      unit: "Единица",
      cost: "Себестоимость",
      expiry: "Срок годности",
      location: "Локация",
      noLocation: "Без локации",
      submit: "Добавить",
      success: "Товар добавлен",
      cancel: "Отмена",
    },
    working: "Сохранение",
    units: { kg: "кг", g: "г", l: "л", ml: "мл", pcs: "шт" },
    errors: {
      unauthenticated: "Войдите, чтобы продолжить.",
      invalidInput: "Некорректные данные.",
      productNotFound: "Товар не найден.",
      locationNotFound: "Локация не найдена.",
      sameLocation: "Товар уже находится в этой локации.",
      invalidQty: "Количество должно быть больше нуля.",
      exceedsQty: "Количество больше остатка.",
      unitMismatch: "У товара с тем же штрихкодом в целевой локации другая единица измерения.",
      duplicateBarcode: "Товар с таким штрихкодом в этой локации уже есть.",
      concurrent: "Данные изменились. Обновите страницу и повторите.",
      saveFailed: "Не удалось сохранить.",
    },
  },
  login: {
    title: "Вход",
    subtitle: "Войдите в аккаунт alovos или создайте новый.",
    email: "Эл. почта",
    password: "Пароль",
    passwordHint: "Не менее 6 символов.",
    signIn: "Войти",
    signUp: "Регистрация",
    haveAccount: "Уже есть аккаунт? Войти",
    noAccount: "Нет аккаунта? Зарегистрироваться",
    working: "Подождите",
    confirmEmail: "Аккаунт создан. Проверьте почту для подтверждения.",
    errors: {
      invalidCredentials: "Неверная почта или пароль.",
      weakPassword: "Слишком простой пароль. Выберите более длинный и сложный.",
      emailTaken: "Эта почта уже зарегистрирована.",
      emailNotConfirmed: "Почта ещё не подтверждена. Проверьте входящие.",
      rateLimited: "Слишком много попыток. Повторите чуть позже.",
      network: "Ошибка сети. Проверьте соединение и повторите.",
      unknown: "Не удалось. Повторите попытку.",
    },
  },
  onboarding: {
    title: "Организация не найдена",
    body: "Не удалось привязать организацию к этому аккаунту. Повторите попытку или войдите в другой аккаунт.",
    retry: "Повторить",
  },
};

const EN: Dictionary = {
  languageLabel: "Language",
  hero: {
    title: "The operating system for kitchens",
    subtitle: "12 blocks. One kitchen operating system.",
    ctaPrimary: "Start free",
    ctaSecondary: "View dashboard",
  },
  modulesLabel: "Modules",
  price: {
    amount: 79,
    currency: "AZN",
    period: "mo",
    included: "Everything included.",
    trialDays: 14,
    trial: (days) => `${days}-day free trial.`,
    cta: "Start - free",
  },
  footer: {
    tagline: "Built for modern kitchens · Baku, AZ.",
  },
  moduleStub: "Module {name} - spec ready, UI next",
  blockNumber: "Block",
  sidebar: {
    dashboard: "Dashboard",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    killer: "KILLER",
    signOut: "Sign out",
  },
  blockDetails: {
    anbar: {
      spec: "Inventory: products, barcodes, expiry, stock counts, transfers.",
      killers: [],
    },
    techizat: {
      spec: "Suppliers, supplier price lists, purchase requests.",
      killers: [],
    },
    hesablar: {
      spec: "Invoices with AI scanning (ai_scan_json).",
      killers: ["3.1 AI scan invoice 99%"],
    },
    reseptler: {
      spec: "Recipes: gross/net/waste/yield, live cost, 14 allergens, KBJU.",
      killers: ["4.4 Allergens auto 14 + KBJU"],
    },
    tullanti: {
      spec: "Wastage log: reason, photo, weight, AI Tani.",
      killers: ["5.2 Photo + AI Tani Vision API"],
    },
    hazirliq: {
      spec: "Prep planning and production.",
      killers: [],
    },
    pos: {
      spec: "POS sales sync.",
      killers: [],
    },
    analitika: {
      spec: "Analytics reports, menu engineering, auto-advice.",
      killers: ["8.4 Stars/Horses/Dogs + Auto-advice"],
    },
    komanda: {
      spec: "Employees with QR and photo.",
      killers: [],
    },
    haccp: {
      spec: "Temperature logs (manual + IoT Shelly) and checklists.",
      killers: ["10.1 IoT Shelly + WhatsApp alert"],
    },
    "ai-skaner": {
      spec: "AI scanner: invoices and waste bucket recognition.",
      killers: ["11.3 AI Tani bucket Vision API"],
    },
    sebeke: {
      spec: "Network and franchise management.",
      killers: [],
    },
  },
  anbar: {
    title: "Stock",
    catalog: {
      title: "Catalog",
      open: "Catalog",
      empty: "The catalog is empty",
      quantity: "Quantity",
      branch: "Branch",
      noBranch: "No branch",
    },
    searchLabel: "Barcode",
    searchPlaceholder: "Scan or type a barcode",
    searchButton: "Search",
    scan: {
      open: "Scan with camera",
      title: "Scan a barcode",
      hint: "Point the camera at the barcode.",
      close: "Close",
      denied: "Camera access was denied.",
      failed: "Could not start the camera.",
    },
    filters: {
      title: "Filters",
      location: "Location",
      allLocations: "All locations",
      expiredOnly: "Expired only",
      lowStock: (threshold) => `Low stock (< ${threshold})`,
      expiry: "Expiry",
      expiryAll: "Any",
      expiryWeek: "Under 7 days",
      expiryMonth: "Under 30 days",
      expiryOk: "30 days or more",
      apply: "Apply",
      reset: "Reset",
    },
    pagination: {
      previous: "Previous",
      next: "Next",
      page: (page) => `Page ${page}`,
    },
    emptyTitle: "The warehouse is empty",
    emptyHint: "Add your first location and product.",
    noMatchTitle: "No match",
    noMatchHint: "No products match these filters.",
    errorTitle: "Could not load the warehouse",
    retry: "Try again",
    loading: "Loading",
    fields: {
      barcode: "Barcode",
      location: "Location",
      qty: "Quantity",
      cost: "Cost",
      expiry: "Expiry date",
      noLocation: "No location",
      noBarcode: "No barcode",
      noExpiry: "No date",
      actions: "Actions",
      name: "Name",
    },
    expiry: {
      expired: "Expired",
      today: "Expires today",
      daysLeft: (days) => `${days} days left`,
    },
    lowStockBadge: "Low",
    move: {
      open: "Move",
      title: "Move stock",
      description: (name, from) => `${name} - ${from}`,
      target: "Target location",
      choose: "Choose a location",
      qty: "Quantity to move",
      available: (qty, unit) => `Available: ${qty} ${unit}`,
      submit: "Move",
      working: "Moving",
      success: "Moved",
      noTargets: "There is no other location to move to.",
      needsLocation: "A product needs a location before it can be moved.",
      cancel: "Cancel",
    },
    addLocation: {
      open: "Add location",
      title: "New location",
      name: "Location name",
      submit: "Add",
      success: "Location added",
    },
    addProduct: {
      open: "Add product",
      title: "New product",
      name: "Product name",
      barcode: "Barcode",
      qty: "Quantity",
      unit: "Unit",
      cost: "Cost",
      expiry: "Expiry date",
      location: "Location",
      noLocation: "No location",
      submit: "Add",
      success: "Product added",
      cancel: "Cancel",
    },
    working: "Saving",
    units: { kg: "kg", g: "g", l: "l", ml: "ml", pcs: "pcs" },
    errors: {
      unauthenticated: "Sign in to continue.",
      invalidInput: "The submitted data is not valid.",
      productNotFound: "Product not found.",
      locationNotFound: "Location not found.",
      sameLocation: "The product is already at this location.",
      invalidQty: "Quantity must be greater than zero.",
      exceedsQty: "Quantity is more than the available stock.",
      unitMismatch: "The product with the same barcode at the target location uses a different unit.",
      duplicateBarcode: "A product with this barcode already exists at this location.",
      concurrent: "The data changed. Refresh the page and try again.",
      saveFailed: "Could not save.",
    },
  },
  login: {
    title: "Sign in",
    subtitle: "Sign in to your alovos account or create a new one.",
    email: "Email",
    password: "Password",
    passwordHint: "At least 6 characters.",
    signIn: "Sign in",
    signUp: "Sign up",
    haveAccount: "Already have an account? Sign in",
    noAccount: "No account yet? Sign up",
    working: "Please wait",
    confirmEmail: "Account created. Check your email to confirm it.",
    errors: {
      invalidCredentials: "Wrong email or password.",
      weakPassword: "That password is too weak. Choose a longer, stronger one.",
      emailTaken: "This email is already registered.",
      emailNotConfirmed: "Your email is not confirmed yet. Check your inbox.",
      rateLimited: "Too many attempts. Try again in a moment.",
      network: "Network error. Check your connection and try again.",
      unknown: "Something went wrong. Try again.",
    },
  },
  onboarding: {
    title: "No organization",
    body: "This account has no organization yet. Try again, or sign in with a different account.",
    retry: "Try again",
  },
};

export const dictionaries = { AZ, RU, EN } satisfies Record<string, Dictionary>;

export type Lang = keyof typeof dictionaries;

export const LANGS = ["AZ", "RU", "EN"] as const satisfies readonly Lang[];

export const DEFAULT_LANG: Lang = "AZ";

export const isLang = (value: unknown): value is Lang =>
  typeof value === "string" && (LANGS as readonly string[]).includes(value);
