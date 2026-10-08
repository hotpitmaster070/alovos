import type { BlockSlug } from "@/lib/block-slugs";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import type { StorageType, Unit } from "@/lib/anbar/types";
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
  kitchen: {
    movements: string;
    search: string;
    place: string;
    places: { all: string };
    qty: string;
    writeOff: string;
    transfer: string;
    receipt: string;
    empty: string;
    dialogTitle: string;
    type: string;
    types: {
      prihod: string;
      spisanie: string;
      peremeshchenie: string;
      waste: string;
      task: string;
    };
    from: string;
    to: string;
    reason: string;
    choose: string;
    submit: string;
    working: string;
    cancel: string;
    branch: string;
    storage: string;
    total: string;
    updated: string;
    units: { kg: string; litr: string; sht: string };
    errors: {
      invalid_input: string;
      unauthenticated: string;
      no_tenant: string;
      product_not_found: string;
      location_not_found: string;
      insufficient_stock: string;
      save_failed: string;
    };
    date: string;
    allTypes: string;
    apply: string;
    noMovements: string;
    when: string;
    who: string;
    what: string;
  };
  sayim: {
    title: string;
    open: string;
    blind: string;
    groupKey: string;
    groupHint: string;
    location: string;
    noLocations: string;
    counted: string;
    submit: string;
    empty: string;
    noCount: string;
    start: string;
    finish: string;
    merge: string;
    approve: string;
    cancel: string;
    confirmApprove: string;
    confirmCancel: string;
    finishedMine: string;
    finishedCount: (finished: number) => string;
    waitMerge: string;
    waitApprove: string;
    readOnly: string;
    scan: string;
    scanNotFound: string;
    state: string;
    status: Record<"draft" | "counting" | "merging" | "approved" | "cancelled", string>;
    mergeModes: Record<"last" | "sum", string>;
    mergeMode: string;
    notices: Record<"saved" | "finished" | "started" | "merged" | "approved" | "cancelled", string>;
    errors: Record<
      | "invalid_input"
      | "unauthenticated"
      | "no_tenant"
      | "forbidden"
      | "count_not_found"
      | "location_not_found"
      | "product_not_found"
      | "invalid_status"
      | "already_finished"
      | "nothing_counted"
      | "insufficient_stock"
      | "save_failed",
      string
    >;
    product: string;
    discrepancies: string;
    expected: string;
    actual: string;
    difference: string;
    differenceValue: string;
    counters: string;
    total: string;
    noDifferences: string;
    hiddenUntilMerge: string;
    history: string;
    noHistory: string;
    startedAt: string;
    approvedAt: string;
  };
  searchLabel: string;
  searchPlaceholder: string;
  searchButton: string;
  scan: {
    open: string;
    title: string;
    hint: string;
    close: string;
    button: string;
    torch: string;
    manual: string;
    manualPlaceholder: string;
    manualSubmit: string;
    retry: string;
    errors: {
      insecure: string;
      inApp: string;
      unsupported: string;
      denied: string;
      notFound: string;
      busy: string;
      failed: string;
    };
  };
  barcode: {
    search: string;
    add: string;
    allBranches: string;
    sharedBranch: string;
    internalCode: string;
    stock: string;
    value: string;
    noPhoto: string;
    empty: string;
    noMatch: string;
    found: string;
    notFound: (code: string) => string;
    createTitle: string;
    createWithCode: string;
    name: string;
    unit: string;
    price: string;
    branch: string;
    create: string;
    updateExpiry: string;
    save: string;
    saved: string;
    close: string;
    receive: string;
  };
  shelf: {
    products: (count: number) => string;
    shown: (shown: number, total: number) => string;
    scan: string;
    category: string;
    categoryPlaceholder: string;
    uncategorized: string;
    shelfLifeDays: string;
    minStock: string;
    optional: string;
    days: (count: number) => string;
    expiresIn: (days: number) => string;
    expiresToday: string;
    expired: (days: number) => string;
    noExpiry: string;
    lowStock: string;
    codes: string;
    newProduct: string;
  };
  qebul: {
    title: string;
    open: string;
    hint: string;
    scanAgain: string;
    qty: string;
    expiry: string;
    price: string;
    location: string;
    choose: string;
    submit: string;
    done: (name: string) => string;
    noLocations: string;
  };
  storage: {
    add: string;
    title: string;
    name: string;
    namePlaceholder: string;
    type: string;
    branch: string;
    submit: string;
    none: string;
    types: Record<StorageType, string>;
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

export type WasteReasonKey = "spoiled" | "overcooked" | "dropped" | "expired" | "theft" | "other";

export type WasteDictionary = {
  title: string;
  writeOff: string;
  today: string;
  empty: string;
  noStock: string;
  product: string;
  quantity: string;
  reason: string;
  photo: string;
  photoTheft: string;
  who: string;
  total: string;
  submit: string;
  working: string;
  cancel: string;
  choose: string;
  search: string;
  noMatches: string;
  saved: string;
  reasons: Record<WasteReasonKey, string>;
  errors: {
    invalid_input: string;
    unauthenticated: string;
    no_tenant: string;
    product_not_found: string;
    location_not_found: string;
    insufficient_stock: string;
    photo_required: string;
    forbidden: string;
    save_failed: string;
  };
};

export type ScannerDictionary = {
  title: string;
  recognize: string;
  receive: string;
  drop: string;
  browse: string;
  back: string;
  name: string;
  qty: string;
  unit: string;
  price: string;
  product: string;
  search: string;
  create: string;
  pickLocation: string;
  empty: string;
  working: string;
  saved: string;
  selected: string;
  errors: {
    invalid_input: string;
    unauthenticated: string;
    no_tenant: string;
    location_not_found: string;
    photo_required: string;
    scan_failed: string;
    no_items: string;
    save_failed: string;
  };
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
  demo: string;
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
    period: string;
    included: string;
    trial: (days: number) => string;
    cta: string;
  };
  footer: {
    tagline: string;
  };
  moduleStub: string;
  blockNumber: string;
  pagination: {
    previous: string;
    next: string;
    page: (page: number) => string;
    shown: (from: number, to: number, total: number) => string;
  };
  sidebar: {
    dashboard: string;
    openMenu: string;
    closeMenu: string;
    killer: string;
    signOut: string;
  };
  blockDetails: Record<BlockSlug, BlockDetails>;
  anbar: AnbarDictionary;
  waste: WasteDictionary;
  scanner: ScannerDictionary;
  login: LoginDictionary;
  onboarding: OnboardingDictionary;
};

function ruPlural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n >= 11 && n <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

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
    period: "ay",
    included: "Hər şey daxil.",
    trial: (days) => `${days} gün pulsuz sınaq.`,
    cta: "Başla - pulsuz",
  },
  footer: {
    tagline: "Built for modern kitchens · Baku, AZ.",
  },
  moduleStub: "Modul {name} - spek hazırdır, UI növbəti",
  blockNumber: "Blok",
  pagination: {
    previous: "Əvvəlki",
    next: "Növbəti",
    page: (page) => `Səhifə ${page}`,
    shown: (from, to, total) => `${total} nəticədən ${from}–${to} göstərilir`,
  },
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
    kitchen: {
      movements: "Hərəkətlər",
      search: "Məhsul axtar",
      place: "Yer",
      places: { all: "Hamısı" },
      qty: "Miqdar",
      writeOff: "Sil",
      transfer: "Köçür",
      receipt: "Mədaxil",
      empty: "Məhsul yoxdur",
      dialogTitle: "Anbar hərəkəti",
      type: "Növ",
      types: {
        prihod: "Mədaxil",
        spisanie: "Silinmə",
        peremeshchenie: "Köçürmə",
        waste: "Tullantı",
        task: "Tapşırıq",
      },
      from: "Haradan",
      to: "Hara",
      reason: "Səbəb / tapşırıq",
      choose: "Seçin",
      submit: "Saxla",
      working: "Gözləyin",
      cancel: "Bağla",
      branch: "Filial",
      storage: "Saxlama yeri",
      total: "Anbar məbləği",
      updated: "Qalıq yeniləndi",
      units: { kg: "kq", litr: "litr", sht: "əd" },
      errors: {
        invalid_input: "Məlumat səhvdir",
        unauthenticated: "Giriş lazımdır",
        no_tenant: "Restoran tapılmadı",
        product_not_found: "Məhsul tapılmadı",
        location_not_found: "Yer tapılmadı",
        insufficient_stock: "Qalıq çatmır",
        save_failed: "Saxlamaq olmadı",
      },
      date: "Tarix",
      allTypes: "Bütün növlər",
      apply: "Göstər",
      noMovements: "Hərəkət yoxdur",
      when: "Vaxt",
      who: "Kim",
      what: "Nə",
    },
    sayim: {
      title: "Kor sayım",
      open: "Sayım",
      blind: "Sistem qalığı göstərilmir.",
      groupKey: "Qrup açarı",
      groupHint: "Bir neçə nəfər eyni açarı yazır.",
      location: "Saxlama yeri",
      noLocations: "Saxlama yeri yoxdur. Əvvəlcə yer əlavə edin.",
      counted: "Sayılan",
      submit: "Saxla",
      empty: "Bu yerdə məhsul yoxdur",
      noCount: "Bu yerdə sayım başlanmayıb.",
      start: "Sayıma başla",
      finish: "Mənim sayımımı bitir",
      merge: "Birləşdir",
      approve: "Təsdiqlə",
      cancel: "Ləğv et",
      confirmApprove: "Qalıq sayımın nəticəsinə görə dəyişəcək. Təsdiqləyirsiniz?",
      confirmCancel: "Sayım ləğv edilsin? Qalıq dəyişməyəcək.",
      finishedMine: "Siz sayımınızı bitirdiniz.",
      finishedCount: (finished) => `Bitirənlər: ${finished}`,
      waitMerge: "Şef nəticələri birləşdirəcək.",
      waitApprove: "Nəticələr birləşdirilib, şefin təsdiqi gözlənilir.",
      readOnly: "Sayımı yalnız aşpaz, şef və sahib apara bilər.",
      scan: "Skan et",
      scanNotFound: "Bu kodla məhsul tapılmadı",
      state: "Status",
      status: {
        draft: "Qaralama",
        counting: "Sayılır",
        merging: "Birləşdirilib",
        approved: "Təsdiqlənib",
        cancelled: "Ləğv edilib",
      },
      mergeModes: { last: "Son daxil edilən", sum: "Cəmi" },
      mergeMode: "Birləşdirmə",
      notices: {
        saved: "Yadda saxlanıldı. Qalıq dəyişmədi.",
        finished: "Sayımınız bitdi.",
        started: "Sayım başladı.",
        merged: "Nəticələr birləşdirildi.",
        approved: "Təsdiqləndi. Qalıq yeniləndi.",
        cancelled: "Sayım ləğv edildi.",
      },
      errors: {
        invalid_input: "Miqdar düzgün deyil.",
        unauthenticated: "Yenidən daxil olun.",
        no_tenant: "Təşkilat tapılmadı.",
        forbidden: "Bu addım üçün icazəniz yoxdur.",
        count_not_found: "Sayım tapılmadı.",
        location_not_found: "Saxlama yeri tapılmadı.",
        product_not_found: "Məhsul tapılmadı.",
        invalid_status: "Sayım artıq bu mərhələdə deyil. Səhifəni yeniləyin.",
        already_finished: "Siz sayımınızı artıq bitirmisiniz.",
        nothing_counted: "Heç nə sayılmayıb.",
        insufficient_stock: "Qalıq dəyişib, təkrar cəhd edin.",
        save_failed: "Yadda saxlamaq alınmadı.",
      },
      product: "Məhsul",
      discrepancies: "Fərqlər",
      expected: "Olmalı",
      actual: "Fakt",
      difference: "Fərq",
      differenceValue: "Fərqin məbləği",
      counters: "Sayanlar",
      total: "Cəmi",
      noDifferences: "Fərq yoxdur.",
      hiddenUntilMerge: "Kor sayım: olmalı miqdar birləşdirmədən sonra şefə, təsdiqdən sonra hamıya görünür.",
      history: "Sayımlar",
      noHistory: "Hələ sayım yoxdur.",
      startedAt: "Başlanıb",
      approvedAt: "Təsdiqlənib",
    },
    searchLabel: "Barkod",
    searchPlaceholder: "Barkodu skan edin və ya yazın",
    searchButton: "Axtar",
    scan: {
      open: "Kamera ilə skan",
      title: "Barkodu skan edin",
      hint: "Kameranı barkoda yönəldin.",
      close: "Bağla",
      button: "Skaner",
      torch: "Fənər",
      manual: "Əl ilə daxil et",
      manualPlaceholder: "Barkod və ya ALO kodu",
      manualSubmit: "Tap",
      retry: "Yenidən cəhd et",
      errors: {
        insecure: "Kamera yalnız HTTPS ilə işləyir. Saytı https:// ünvanı ilə açın.",
        inApp:
          "Bu brauzer kameranı açmır. Saytı Instagram, WhatsApp və ya Telegram daxilində yox, Safari (iPhone) və ya Chrome (Android) ilə açın.",
        unsupported: "Bu brauzer kameranı dəstəkləmir. Safari (iPhone) və ya Chrome (Android) ilə açın.",
        denied:
          "Kameraya icazə verilmədi. iPhone: Ayarlar → Safari → Kamera → İcazə ver. Android: ünvan sətrindəki kilid → İcazələr → Kamera.",
        notFound: "Kamera tapılmadı. Arxa kamerası olan telefonda açın.",
        busy: "Kamera başqa tətbiq tərəfindən istifadə olunur. Kameradan istifadə edən tətbiqləri bağlayın və yenidən cəhd edin.",
        failed: "Kameranı işə salmaq mümkün olmadı. Səhifəni yeniləyin və ya kodu əl ilə daxil edin.",
      },
    },
    barcode: {
      search: "Ad, barkod və ya ALO kodu",
      add: "Əlavə et",
      allBranches: "Bütün filiallar",
      sharedBranch: "Ümumi",
      internalCode: "Daxili kod",
      stock: "Qalıq",
      value: "Dəyər",
      noPhoto: "Foto yoxdur",
      empty: "Kataloq boşdur. İlk məhsulu əlavə edin və ya skan edin.",
      noMatch: "Heç nə tapılmadı",
      found: "Məhsul tapıldı",
      notFound: (code) => `${code} kodu ilə məhsul yoxdur`,
      createTitle: "Yeni məhsul",
      createWithCode: "Bu barkodla yeni məhsul yarat",
      name: "Məhsulun adı",
      unit: "Vahid",
      price: "Vahid qiyməti",
      branch: "Filial",
      create: "Yarat",
      updateExpiry: "Son istifadə tarixi",
      save: "Saxla",
      saved: "Saxlanıldı",
      close: "Bağla",
      receive: "Qəbul et",
    },
    shelf: {
      products: (count) => `${count} məhsul`,
      shown: (shown, total) => `${total} məhsuldan ${shown} göstərilir`,
      scan: "Barkodu skan et",
      category: "Kateqoriya",
      categoryPlaceholder: "Məs. Süd məhsulları",
      uncategorized: "Kateqoriyasız",
      shelfLifeDays: "Saxlama müddəti, gün",
      minStock: "Minimum qalıq",
      optional: "istəyə görə",
      days: (count) => `${count} gün`,
      expiresIn: (days) => `${days} gün qalıb`,
      expiresToday: "Bu gün bitir",
      expired: (days) => `${days} gün əvvəl bitib`,
      noExpiry: "Son tarix yoxdur",
      lowStock: "Az qalıb",
      codes: "Kodlar",
      newProduct: "Yeni məhsul",
    },
    qebul: {
      title: "Mal qəbulu",
      open: "Qəbul",
      hint: "Barkodu skan edin və ya yazın. Barkodsuz məhsul üçün daxili ALO kodundan istifadə edin.",
      scanAgain: "Növbəti məhsul",
      qty: "Miqdar",
      expiry: "Son istifadə tarixi",
      price: "Vahid qiyməti",
      location: "Saxlama yeri",
      choose: "Seçin",
      submit: "Anbara al",
      done: (name) => `${name} anbara alındı`,
      noLocations: "Saxlama yeri yoxdur. Əvvəlcə filial və saxlama yeri yaradın.",
    },
    storage: {
      add: "Saxlama yeri əlavə et",
      title: "Yeni saxlama yeri",
      name: "Ad",
      namePlaceholder: "Məs: Bar soyuducusu, Yarımfabrikat soyuducusu",
      type: "Növ",
      branch: "Filial",
      submit: "Əlavə et",
      none: "Seçilməyib",
      types: { quru: "Quru anbar", soyuducu: "Soyuducu", dondurucu: "Dondurucu", custom: "Digər" },
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
      duplicateLocation: "Bu filialda həmin adda saxlama yeri artıq var.",
      concurrent: "Məlumat dəyişdi. Səhifəni yeniləyib yenidən cəhd edin.",
      saveFailed: "Yadda saxlamaq mümkün olmadı.",
    },
  },
  waste: {
    title: "Tullantı",
    writeOff: "Sil",
    today: "Bu gün",
    empty: "Bu gün silinmə yoxdur",
    noStock: "Bu yerdə məhsul yoxdur",
    product: "Məhsul",
    quantity: "Miqdar",
    reason: "Səbəb",
    photo: "Foto",
    photoTheft: "Oğurluq üçün foto mütləqdir.",
    who: "Kim",
    total: "Günün məbləği",
    submit: "Saxla",
    working: "Saxlanılır",
    cancel: "Bağla",
    choose: "Seçin",
    search: "Məhsul axtar",
    noMatches: "Anbarda belə məhsul yoxdur",
    saved: "Silindi və anbardan çıxarıldı",
    reasons: {
      spoiled: "Xarab",
      overcooked: "Artıq bişmiş",
      dropped: "Düşüb",
      expired: "Vaxtı keçib",
      theft: "Oğurluq",
      other: "Digər",
    },
    errors: {
      invalid_input: "Məlumat səhvdir",
      unauthenticated: "Giriş lazımdır",
      no_tenant: "Restoran tapılmadı",
      product_not_found: "Məhsul tapılmadı",
      location_not_found: "Yer tapılmadı",
      insufficient_stock: "Qalıq çatmır",
      photo_required: "Oğurluq üçün foto mütləqdir",
      forbidden: "Silinmə üçün icazəniz yoxdur",
      save_failed: "Saxlamaq olmadı",
    },
  },
  scanner: {
    title: "Skaner",
    recognize: "Tanı",
    receive: "Anbara al",
    drop: "Qaimə və ya çek şəklini bura atın",
    browse: "Fayl seç",
    back: "Geri",
    name: "Ad",
    qty: "Miqdar",
    unit: "Vahid",
    price: "Qiymət",
    product: "Məhsul",
    search: "Axtar",
    create: "Yeni məhsul",
    pickLocation: "Saxlama yerini seçin",
    empty: "Sətir tapılmadı",
    working: "Gözləyin",
    saved: "Anbara alındı",
    selected: "Seçildi",
    errors: {
      invalid_input: "Məlumat səhvdir",
      unauthenticated: "Giriş lazımdır",
      no_tenant: "Restoran tapılmadı",
      location_not_found: "Yer tapılmadı",
      photo_required: "Foto lazımdır",
      scan_failed: "Tanımaq olmadı",
      no_items: "Sətir tapılmadı",
      save_failed: "Saxlamaq olmadı",
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
    confirmEmail: "E-poçtunuzu yoxlayın.",
    demo: "Demo kimi daxil ol",
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
    period: "мес",
    included: "Всё включено.",
    trial: (days) => `${days} дней бесплатного пробного периода.`,
    cta: "Начать - бесплатно",
  },
  footer: {
    tagline: "Создано для современных кухонь · Баку, AZ.",
  },
  moduleStub: "Модуль {name} - спек готов, UI далее",
  blockNumber: "Блок",
  pagination: {
    previous: "Назад",
    next: "Вперёд",
    page: (page) => `Страница ${page}`,
    shown: (from, to, total) => `Показано ${from}–${to} из ${total}`,
  },
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
    kitchen: {
      movements: "Движения",
      search: "Найти продукт",
      place: "Место",
      places: { all: "Все" },
      qty: "Количество",
      writeOff: "Списать",
      transfer: "Переместить",
      receipt: "Приход",
      empty: "Продуктов нет",
      dialogTitle: "Движение склада",
      type: "Тип",
      types: {
        prihod: "Приход",
        spisanie: "Списание",
        peremeshchenie: "Перемещение",
        waste: "Списание в отход",
        task: "Задача",
      },
      from: "Откуда",
      to: "Куда",
      reason: "Причина / задача",
      choose: "Выберите",
      submit: "Сохранить",
      working: "Сохраняем",
      cancel: "Закрыть",
      branch: "Филиал",
      storage: "Место хранения",
      total: "Сумма склада",
      updated: "Остаток обновлен",
      units: { kg: "кг", litr: "литр", sht: "шт" },
      errors: {
        invalid_input: "Проверьте поля",
        unauthenticated: "Нужен вход",
        no_tenant: "Ресторан не найден",
        product_not_found: "Продукт не найден",
        location_not_found: "Место не найдено",
        insufficient_stock: "Не хватает остатка",
        save_failed: "Не удалось сохранить",
      },
      date: "Дата",
      allTypes: "Все типы",
      apply: "Показать",
      noMovements: "Движений нет",
      when: "Когда",
      who: "Кто",
      what: "Что",
    },
    sayim: {
      title: "Слепой подсчёт",
      open: "Подсчёт",
      blind: "Системный остаток не показывается.",
      groupKey: "Ключ группы",
      groupHint: "Несколько человек вводят один и тот же ключ.",
      location: "Место хранения",
      noLocations: "Мест хранения нет. Сначала добавьте место.",
      counted: "Посчитано",
      submit: "Сохранить",
      empty: "В этом месте нет товаров",
      noCount: "Подсчёт в этом месте не начат.",
      start: "Начать подсчёт",
      finish: "Завершить мой подсчёт",
      merge: "Объединить",
      approve: "Утвердить",
      cancel: "Отменить",
      confirmApprove: "Остаток изменится по результатам подсчёта. Утвердить?",
      confirmCancel: "Отменить подсчёт? Остаток не изменится.",
      finishedMine: "Вы завершили свой подсчёт.",
      finishedCount: (finished) => `Завершили: ${finished}`,
      waitMerge: "Шеф объединит результаты.",
      waitApprove: "Результаты объединены, ждём утверждения шефа.",
      readOnly: "Считать могут повар, шеф и владелец.",
      scan: "Сканировать",
      scanNotFound: "Товар с этим кодом не найден",
      state: "Статус",
      status: {
        draft: "Черновик",
        counting: "Идёт подсчёт",
        merging: "Объединено",
        approved: "Утверждено",
        cancelled: "Отменено",
      },
      mergeModes: { last: "Последний ввод", sum: "Сумма" },
      mergeMode: "Объединение",
      notices: {
        saved: "Сохранено. Остаток не изменился.",
        finished: "Ваш подсчёт завершён.",
        started: "Подсчёт начат.",
        merged: "Результаты объединены.",
        approved: "Утверждено. Остаток обновлён.",
        cancelled: "Подсчёт отменён.",
      },
      errors: {
        invalid_input: "Неверное количество.",
        unauthenticated: "Войдите снова.",
        no_tenant: "Организация не найдена.",
        forbidden: "Нет прав на это действие.",
        count_not_found: "Подсчёт не найден.",
        location_not_found: "Место хранения не найдено.",
        product_not_found: "Товар не найден.",
        invalid_status: "Подсчёт уже на другом этапе. Обновите страницу.",
        already_finished: "Вы уже завершили свой подсчёт.",
        nothing_counted: "Ничего не посчитано.",
        insufficient_stock: "Остаток изменился, попробуйте ещё раз.",
        save_failed: "Не удалось сохранить.",
      },
      product: "Товар",
      discrepancies: "Расхождения",
      expected: "Должно",
      actual: "Факт",
      difference: "Разница",
      differenceValue: "Сумма разницы",
      counters: "Считали",
      total: "Итого",
      noDifferences: "Расхождений нет.",
      hiddenUntilMerge: "Слепой подсчёт: «должно» видно шефу после объединения, всем — после утверждения.",
      history: "Подсчёты",
      noHistory: "Подсчётов пока нет.",
      startedAt: "Начат",
      approvedAt: "Утверждён",
    },
    searchLabel: "Штрихкод",
    searchPlaceholder: "Отсканируйте или введите штрихкод",
    searchButton: "Найти",
    scan: {
      open: "Сканировать камерой",
      title: "Сканирование штрихкода",
      hint: "Наведите камеру на штрихкод.",
      close: "Закрыть",
      button: "Сканер",
      torch: "Фонарик",
      manual: "Ввести вручную",
      manualPlaceholder: "Штрихкод или код ALO",
      manualSubmit: "Найти",
      retry: "Повторить",
      errors: {
        insecure: "Камера работает только по HTTPS. Откройте сайт по адресу с https://.",
        inApp:
          "Этот браузер не даёт доступ к камере. Откройте сайт в Safari (iPhone) или Chrome (Android), а не внутри Instagram, WhatsApp или Telegram.",
        unsupported: "Этот браузер не поддерживает камеру. Откройте сайт в Safari (iPhone) или Chrome (Android).",
        denied:
          "Доступ к камере запрещён. iPhone: Настройки → Safari → Камера → Разрешить. Android: замок в адресной строке → Разрешения → Камера.",
        notFound: "Камера не найдена. Откройте сайт на телефоне с задней камерой.",
        busy: "Камера занята другим приложением. Закройте приложения, которые используют камеру, и нажмите «Повторить».",
        failed: "Не удалось запустить камеру. Обновите страницу или введите код вручную.",
      },
    },
    barcode: {
      search: "Название, штрихкод или код ALO",
      add: "Добавить",
      allBranches: "Все филиалы",
      sharedBranch: "Общий",
      internalCode: "Внутренний код",
      stock: "Остаток",
      value: "Стоимость",
      noPhoto: "Нет фото",
      empty: "Каталог пуст. Добавьте или отсканируйте первый товар.",
      noMatch: "Ничего не найдено",
      found: "Товар найден",
      notFound: (code) => `Товара с кодом ${code} нет`,
      createTitle: "Новый товар",
      createWithCode: "Создать новый товар с этим штрихкодом",
      name: "Название товара",
      unit: "Единица",
      price: "Цена за единицу",
      branch: "Филиал",
      create: "Создать",
      updateExpiry: "Срок годности",
      save: "Сохранить",
      saved: "Сохранено",
      close: "Закрыть",
      receive: "Принять",
    },
    shelf: {
      products: (count) => `${count} ${ruPlural(count, "товар", "товара", "товаров")}`,
      shown: (shown, total) => `Показано ${shown} из ${total} ${ruPlural(total, "товара", "товаров", "товаров")}`,
      scan: "Сканировать штрихкод",
      category: "Категория",
      categoryPlaceholder: "Напр. Молочные продукты",
      uncategorized: "Без категории",
      shelfLifeDays: "Срок хранения, дней",
      minStock: "Минимальный остаток",
      optional: "необязательно",
      days: (count) => `${count} ${ruPlural(count, "день", "дня", "дней")}`,
      expiresIn: (days) => `Осталось ${days} ${ruPlural(days, "день", "дня", "дней")}`,
      expiresToday: "Истекает сегодня",
      expired: (days) => `Просрочено ${days} ${ruPlural(days, "день", "дня", "дней")} назад`,
      noExpiry: "Без срока годности",
      lowStock: "Мало на складе",
      codes: "Коды",
      newProduct: "Новый товар",
    },
    qebul: {
      title: "Приёмка",
      open: "Приёмка",
      hint: "Отсканируйте или введите штрихкод. Для товара без штрихкода используйте внутренний код ALO.",
      scanAgain: "Следующий товар",
      qty: "Количество",
      expiry: "Срок годности",
      price: "Цена за единицу",
      location: "Место хранения",
      choose: "Выберите",
      submit: "Оприходовать",
      done: (name) => `${name} оприходован`,
      noLocations: "Нет мест хранения. Сначала создайте филиал и место хранения.",
    },
    storage: {
      add: "Добавить место хранения",
      title: "Новое место хранения",
      name: "Название",
      namePlaceholder: "Напр.: Барный холодильник, Холодильник для заготовок",
      type: "Тип",
      branch: "Точка",
      submit: "Добавить",
      none: "Не выбрано",
      types: { quru: "Сухой склад", soyuducu: "Холодильник", dondurucu: "Морозильник", custom: "Другое" },
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
      duplicateLocation: "Место хранения с таким названием в этой точке уже есть.",
      concurrent: "Данные изменились. Обновите страницу и повторите.",
      saveFailed: "Не удалось сохранить.",
    },
  },
  waste: {
    title: "Списание",
    writeOff: "Списать",
    today: "Сегодня",
    empty: "Сегодня списаний нет",
    noStock: "В этом месте нет продуктов",
    product: "Продукт",
    quantity: "Количество",
    reason: "Причина",
    photo: "Фото",
    photoTheft: "Для кражи фото обязательно.",
    who: "Кто списал",
    total: "Сумма за день",
    submit: "Сохранить",
    working: "Сохраняем",
    cancel: "Закрыть",
    choose: "Выберите",
    search: "Найти продукт",
    noMatches: "Такого продукта нет на складе",
    saved: "Списано и снято со склада",
    reasons: {
      spoiled: "Испорчено",
      overcooked: "Переготовлено",
      dropped: "Уронили",
      expired: "Просрочено",
      theft: "Кража",
      other: "Другое",
    },
    errors: {
      invalid_input: "Проверьте поля",
      unauthenticated: "Нужен вход",
      no_tenant: "Ресторан не найден",
      product_not_found: "Продукт не найден",
      location_not_found: "Место не найдено",
      insufficient_stock: "Не хватает остатка",
      photo_required: "Для кражи нужно фото",
      forbidden: "Нет прав на списание",
      save_failed: "Не удалось сохранить",
    },
  },
  scanner: {
    title: "Сканер",
    recognize: "Распознать",
    receive: "Оприходовать",
    drop: "Перетащите фото накладной или чека",
    browse: "Выбрать файл",
    back: "Назад",
    name: "Название",
    qty: "Количество",
    unit: "Единица",
    price: "Цена",
    product: "Товар",
    search: "Поиск",
    create: "Новый товар",
    pickLocation: "Выберите место хранения",
    empty: "Строки не найдены",
    working: "Подождите",
    saved: "Оприходовано",
    selected: "Выбран",
    errors: {
      invalid_input: "Проверьте поля",
      unauthenticated: "Нужен вход",
      no_tenant: "Ресторан не найден",
      location_not_found: "Место не найдено",
      photo_required: "Нужно фото",
      scan_failed: "Не удалось распознать",
      no_items: "Строки не найдены",
      save_failed: "Не удалось сохранить",
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
    confirmEmail: "Проверьте почту",
    demo: "Войти как демо",
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
    period: "mo",
    included: "Everything included.",
    trial: (days) => `${days}-day free trial.`,
    cta: "Start - free",
  },
  footer: {
    tagline: "Built for modern kitchens · Baku, AZ.",
  },
  moduleStub: "Module {name} - spec ready, UI next",
  blockNumber: "Block",
  pagination: {
    previous: "Previous",
    next: "Next",
    page: (page) => `Page ${page}`,
    shown: (from, to, total) => `Showing ${from}–${to} of ${total}`,
  },
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
    kitchen: {
      movements: "Movements",
      search: "Find a product",
      place: "Place",
      places: { all: "All" },
      qty: "Quantity",
      writeOff: "Write off",
      transfer: "Move",
      receipt: "Receive",
      empty: "No products",
      dialogTitle: "Stock movement",
      type: "Type",
      types: {
        prihod: "Receipt",
        spisanie: "Write-off",
        peremeshchenie: "Transfer",
        waste: "Waste",
        task: "Task",
      },
      from: "From",
      to: "To",
      reason: "Reason / task",
      choose: "Choose",
      submit: "Save",
      working: "Saving",
      cancel: "Close",
      branch: "Branch",
      storage: "Storage location",
      total: "Stock value",
      updated: "Stock updated",
      units: { kg: "kg", litr: "litre", sht: "pcs" },
      errors: {
        invalid_input: "Check the fields",
        unauthenticated: "Sign in required",
        no_tenant: "Restaurant not found",
        product_not_found: "Product not found",
        location_not_found: "Place not found",
        insufficient_stock: "Not enough stock",
        save_failed: "Could not save",
      },
      date: "Date",
      allTypes: "All types",
      apply: "Show",
      noMovements: "No movements",
      when: "When",
      who: "Who",
      what: "What",
    },
    sayim: {
      title: "Blind count",
      open: "Count",
      blind: "System quantity stays hidden.",
      groupKey: "Group key",
      groupHint: "Several people enter the same key.",
      location: "Storage location",
      noLocations: "No storage locations. Add one first.",
      counted: "Counted",
      submit: "Save",
      empty: "No products at this location",
      noCount: "No count started at this location.",
      start: "Start count",
      finish: "Finish my count",
      merge: "Merge",
      approve: "Approve",
      cancel: "Cancel",
      confirmApprove: "Stock will be set to the counted quantities. Approve?",
      confirmCancel: "Cancel the count? Stock will not change.",
      finishedMine: "You finished your count.",
      finishedCount: (finished) => `Finished: ${finished}`,
      waitMerge: "The chef will merge the results.",
      waitApprove: "Results merged, waiting for the chef to approve.",
      readOnly: "Cooks, chefs and owners can count.",
      scan: "Scan",
      scanNotFound: "No product with this code",
      state: "Status",
      status: {
        draft: "Draft",
        counting: "Counting",
        merging: "Merged",
        approved: "Approved",
        cancelled: "Cancelled",
      },
      mergeModes: { last: "Latest entry", sum: "Sum" },
      mergeMode: "Merge",
      notices: {
        saved: "Saved. Stock unchanged.",
        finished: "Your count is finished.",
        started: "Count started.",
        merged: "Results merged.",
        approved: "Approved. Stock updated.",
        cancelled: "Count cancelled.",
      },
      errors: {
        invalid_input: "Invalid quantity.",
        unauthenticated: "Sign in again.",
        no_tenant: "Organization not found.",
        forbidden: "You are not allowed to do this.",
        count_not_found: "Count not found.",
        location_not_found: "Storage location not found.",
        product_not_found: "Product not found.",
        invalid_status: "The count has moved on. Reload the page.",
        already_finished: "You already finished your count.",
        nothing_counted: "Nothing was counted.",
        insufficient_stock: "Stock changed, try again.",
        save_failed: "Could not save.",
      },
      product: "Product",
      discrepancies: "Discrepancies",
      expected: "Expected",
      actual: "Counted",
      difference: "Difference",
      differenceValue: "Difference value",
      counters: "Counted by",
      total: "Total",
      noDifferences: "No discrepancies.",
      hiddenUntilMerge: "Blind count: the chef sees expected quantities after merging, everyone after approval.",
      history: "Counts",
      noHistory: "No counts yet.",
      startedAt: "Started",
      approvedAt: "Approved",
    },
    searchLabel: "Barcode",
    searchPlaceholder: "Scan or type a barcode",
    searchButton: "Search",
    scan: {
      open: "Scan with camera",
      title: "Scan a barcode",
      hint: "Point the camera at the barcode.",
      close: "Close",
      button: "Scanner",
      torch: "Flashlight",
      manual: "Enter manually",
      manualPlaceholder: "Barcode or ALO code",
      manualSubmit: "Find",
      retry: "Try again",
      errors: {
        insecure: "The camera only works over HTTPS. Open the site with an https:// address.",
        inApp:
          "This browser does not allow camera access. Open the site in Safari (iPhone) or Chrome (Android), not inside Instagram, WhatsApp or Telegram.",
        unsupported: "This browser does not support the camera. Open the site in Safari (iPhone) or Chrome (Android).",
        denied:
          "Camera access is blocked. iPhone: Settings → Safari → Camera → Allow. Android: lock icon in the address bar → Permissions → Camera.",
        notFound: "No camera found. Open the site on a phone with a rear camera.",
        busy: "The camera is in use by another app. Close apps that use the camera and tap “Try again”.",
        failed: "Could not start the camera. Reload the page or enter the code manually.",
      },
    },
    barcode: {
      search: "Name, barcode or ALO code",
      add: "Add",
      allBranches: "All branches",
      sharedBranch: "Shared",
      internalCode: "Internal code",
      stock: "Stock",
      value: "Value",
      noPhoto: "No photo",
      empty: "The catalog is empty. Add or scan your first product.",
      noMatch: "Nothing found",
      found: "Product found",
      notFound: (code) => `No product with code ${code}`,
      createTitle: "New product",
      createWithCode: "Create a new product with this barcode",
      name: "Product name",
      unit: "Unit",
      price: "Price per unit",
      branch: "Branch",
      create: "Create",
      updateExpiry: "Expiry date",
      save: "Save",
      saved: "Saved",
      close: "Close",
      receive: "Receive",
    },
    shelf: {
      products: (count) => `${count} ${count === 1 ? "product" : "products"}`,
      shown: (shown, total) => `Showing ${shown} of ${total} ${total === 1 ? "product" : "products"}`,
      scan: "Scan barcode",
      category: "Category",
      categoryPlaceholder: "e.g. Dairy",
      uncategorized: "Uncategorized",
      shelfLifeDays: "Shelf life, days",
      minStock: "Minimum stock",
      optional: "optional",
      days: (count) => `${count} ${count === 1 ? "day" : "days"}`,
      expiresIn: (days) => `${days} ${days === 1 ? "day" : "days"} left`,
      expiresToday: "Expires today",
      expired: (days) => `Expired ${days} ${days === 1 ? "day" : "days"} ago`,
      noExpiry: "No expiry date",
      lowStock: "Low stock",
      codes: "Codes",
      newProduct: "New product",
    },
    qebul: {
      title: "Goods receipt",
      open: "Receipt",
      hint: "Scan or type a barcode. For products without a barcode use the internal ALO code.",
      scanAgain: "Next product",
      qty: "Quantity",
      expiry: "Expiry date",
      price: "Price per unit",
      location: "Storage location",
      choose: "Choose",
      submit: "Receive into stock",
      done: (name) => `${name} received`,
      noLocations: "No storage locations. Create a branch and a storage location first.",
    },
    storage: {
      add: "Add storage location",
      title: "New storage location",
      name: "Name",
      namePlaceholder: "E.g. Bar fridge, Prep fridge",
      type: "Type",
      branch: "Branch",
      submit: "Add",
      none: "Not selected",
      types: { quru: "Dry store", soyuducu: "Fridge", dondurucu: "Freezer", custom: "Other" },
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
      duplicateLocation: "This branch already has a storage location with that name.",
      concurrent: "The data changed. Refresh the page and try again.",
      saveFailed: "Could not save.",
    },
  },
  waste: {
    title: "Waste",
    writeOff: "Write off",
    today: "Today",
    empty: "Nothing written off today",
    noStock: "No products at this place",
    product: "Product",
    quantity: "Quantity",
    reason: "Reason",
    photo: "Photo",
    photoTheft: "A photo is required for theft.",
    who: "Written off by",
    total: "Today's total",
    submit: "Save",
    working: "Saving",
    cancel: "Close",
    choose: "Choose",
    search: "Find a product",
    noMatches: "No such product in stock",
    saved: "Written off and removed from stock",
    reasons: {
      spoiled: "Spoiled",
      overcooked: "Overcooked",
      dropped: "Dropped",
      expired: "Expired",
      theft: "Theft",
      other: "Other",
    },
    errors: {
      invalid_input: "Check the fields",
      unauthenticated: "Sign in required",
      no_tenant: "Restaurant not found",
      product_not_found: "Product not found",
      location_not_found: "Place not found",
      insufficient_stock: "Not enough stock",
      photo_required: "Theft requires a photo",
      forbidden: "You may not write off stock",
      save_failed: "Could not save",
    },
  },
  scanner: {
    title: "Scanner",
    recognize: "Read",
    receive: "Receive",
    drop: "Drop a photo of the invoice or receipt",
    browse: "Choose file",
    back: "Back",
    name: "Name",
    qty: "Quantity",
    unit: "Unit",
    price: "Price",
    product: "Product",
    search: "Search",
    create: "New product",
    pickLocation: "Choose a storage location",
    empty: "No lines found",
    working: "Please wait",
    saved: "Received into stock",
    selected: "Selected",
    errors: {
      invalid_input: "Check the fields",
      unauthenticated: "Sign in required",
      no_tenant: "Restaurant not found",
      location_not_found: "Place not found",
      photo_required: "A photo is required",
      scan_failed: "Could not read the photo",
      no_items: "No lines found",
      save_failed: "Could not save",
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
    confirmEmail: "Check your email.",
    demo: "Sign in as demo",
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
