import type { StorageType } from "@/lib/anbar/types";
import type { InventoryErrorCode } from "@/lib/inventory/model";
import type { DiscrepancyReason, InventoryMode, TaskPhase } from "@/lib/inventory/modes";
import { ruPlural } from "./plural";

export type InventoryDictionary = {
  modes: Record<InventoryMode, { title: string; tagline: string; description: string; bestFor: string }>;
  phases: Record<TaskPhase, string>;
  zoneTypes: Record<StorageType, string>;
  reasons: Record<DiscrepancyReason, string>;
  errors: Record<InventoryErrorCode, string>;
  common: {
    cancel: string;
    back: string;
    next: string;
    close: string;
    all: string;
    apply: string;
    reset: string;
    forbidden: string;
    working: string;
  };
  chef: {
    title: string;
    subtitle: string;
    newTask: string;
    discrepancies: string;
    stats: {
      active: string;
      activeHint: (awaiting: number) => string;
      finished: string;
      finishedHint: string;
      share: string;
      shareHint: string;
      losses: string;
      lossesHint: string;
    };
    table: {
      task: string;
      mode: string;
      branch: string;
      zones: string;
      cooks: string;
      progress: string;
      status: string;
      actions: string;
      open: string;
      close: string;
      cancel: string;
      empty: string;
      emptyHint: string;
    };
    confirmCancel: string;
    created: string;
    cancelledNotice: string;
  };
  wizard: {
    title: string;
    step: (current: number, total: number) => string;
    chooseMode: string;
    setup: string;
    branch: string;
    zones: string;
    zonesParallel: string;
    noZones: string;
    defaultZones: string;
    addZone: string;
    zoneName: string;
    zoneType: string;
    add: string;
    cooks: string;
    cooksHint: (min: number, max: number) => string;
    noCooks: string;
    assign: string;
    assignHint: string;
    nobody: string;
    taskTitle: string;
    defaultTitle: (mode: string, date: string) => string;
    deadline: string;
    create: string;
    varianceNote: (percent: string) => string;
    roles: Record<string, string>;
  };
  detail: {
    back: string;
    zone: string;
    product: string;
    expected: string;
    result: string;
    difference: string;
    variance: string;
    value: string;
    needsReview: string;
    waiting: string;
    sent: string;
    notSent: string;
    progress: (sent: number, total: number) => string;
    noLines: string;
    closeAndWriteOff: string;
    report: string;
    createdAt: string;
    deadline: string;
    closedAt: string;
    loss: string;
    surplus: string;
  };
  cook: {
    hello: (name: string) => string;
    subtitle: string;
    open: string;
    openHint: string;
    sent: string;
    sentHint: string;
    accuracy: string;
    accuracyHint: string;
    accuracyEmpty: string;
    empty: string;
    emptyHint: string;
    products: (count: number) => string;
    deadline: string;
    noDeadline: string;
    swipeHint: string;
    start: string;
    view: string;
    peers: (sent: number, total: number) => string;
    waitingReview: string;
    closedCard: string;
  };
  count: {
    progress: (done: number, total: number) => string;
    finish: string;
    send: string;
    blindNote: string;
    nothing: string;
    confirmMissing: (missing: number) => string;
    confirmSend: string;
    sentTitle: string;
    sentText: string;
    peerSent: string;
    expected: string;
    difference: string;
    yours: string;
    hiddenUntilClose: string;
    back: string;
    search: string;
    next: string;
    restored: string;
  };
  report: {
    title: string;
    subtitle: string;
    kpi: {
      loss: string;
      lossHint: string;
      surplus: string;
      surplusHint: string;
      accuracy: string;
      accuracyHint: string;
      over: (percent: string) => string;
      overHint: string;
    };
    filters: {
      branch: string;
      task: string;
      allTasks: string;
      from: string;
      to: string;
      significant: (quantity: string, share: string) => string;
    };
    table: {
      product: string;
      zone: string;
      expected: string;
      counted: string;
      diffQty: string;
      unitCost: string;
      diffMoney: string;
      variance: string;
      reason: string;
      noReason: string;
    };
    review: string;
    totals: { lines: string; loss: string; surplus: string; net: string };
    empty: string;
    emptyHint: string;
    reasonSaved: string;
    close: {
      button: string;
      pickTask: string;
      title: string;
      text: (amount: string) => string;
      details: string;
      confirm: string;
      done: (amount: string) => string;
    };
  };
};

export const INVENTORY_AZ: InventoryDictionary = {
  modes: {
    fast_zones: {
      title: "Zonalar üzrə sürətli",
      tagline: "1 aşpaz = 1 zona",
      description: "Hər aşpaz öz zonasını sayır. Sürətli, çarpaz yoxlama olmadan.",
      bestFor: "Gündəlik sayım üçün",
    },
    control_parallel: {
      title: "Paralel nəzarət",
      tagline: "2+ aşpaz = 1 zona, kor sayım",
      description: "Bir neçə aşpaz eyni zonanı bir-birindən xəbərsiz sayır, sistem fərqi (variance) hesablayır.",
      bestFor: "Bahalı məhsullar və həftəlik oğurluq nəzarəti üçün",
    },
  },
  phases: { active: "Aktiv", done: "Yoxlamada", closed: "Bağlanıb", cancelled: "Ləğv edilib" },
  zoneTypes: { quru: "Quru anbar", soyuducu: "Soyuducu", dondurucu: "Dondurucu", custom: "Digər" },
  reasons: { receiving_error: "Qəbul xətası", theft: "Oğurluq", spoilage: "Xarab olma", mis_sort: "Qarışıq sort" },
  errors: {
    unauthenticated: "Yenidən daxil olun.",
    no_tenant: "Restoran tapılmadı.",
    forbidden: "Bunun üçün icazəniz yoxdur.",
    invalid_input: "Məlumatları yoxlayın.",
    branch_not_found: "Filial tapılmadı.",
    location_not_found: "Zona tapılmadı.",
    assignee_not_found: "Aşpaz bu filialda işləmir.",
    open_count: "Bu zonada artıq açıq sayım var.",
    task_not_found: "Tapşırıq tapılmadı.",
    task_closed: "Tapşırıq artıq bağlanıb.",
    already_submitted: "Bu zona artıq göndərilib.",
    product_not_found: "Məhsul tapılmadı.",
    nothing_counted: "Heç nə sayılmayıb.",
    insufficient_stock: "Qalıq çatmır: əvvəlcə hərəkətləri yoxlayın.",
    line_not_found: "Sətir tapılmadı.",
    duplicate_name: "Bu adda zona artıq var.",
    save_failed: "Saxlamaq alınmadı. Yenidən cəhd edin.",
  },
  common: {
    cancel: "Ləğv et",
    back: "Geri",
    next: "Davam",
    close: "Bağla",
    all: "Hamısı",
    apply: "Tətbiq et",
    reset: "Sıfırla",
    forbidden: "Bu bölmə yalnız sahib və şef üçündür.",
    working: "Gözləyin…",
  },
  chef: {
    title: "İnventarizasiya",
    subtitle: "Tapşırıq verin, aşpazlar kor sayır, siz fərqi pulla görürsünüz.",
    newTask: "Yeni inventarizasiya",
    discrepancies: "Fərqlərə bax",
    stats: {
      active: "Aktiv",
      activeHint: (awaiting) => (awaiting > 0 ? `${awaiting} yoxlamanı gözləyir` : "Hamısı nəzarətdə"),
      finished: "Həftədə bitib",
      finishedHint: "Son 7 gün",
      share: "Orta fərq",
      shareHint: "Gözlənilən dəyərə nisbətdə",
      losses: "İtki",
      lossesHint: "Son 7 gündə çatışmazlıq",
    },
    table: {
      task: "Tapşırıq",
      mode: "Rejim",
      branch: "Filial",
      zones: "Zonalar",
      cooks: "Aşpazlar",
      progress: "Gedişat",
      status: "Status",
      actions: "",
      open: "Aç",
      close: "Bağla",
      cancel: "Ləğv et",
      empty: "Hələ inventarizasiya yoxdur",
      emptyHint: "İlk tapşırığı yaradın: 2 dəqiqə çəkir.",
    },
    confirmCancel: "Tapşırığı ləğv edək? Qalıqlar dəyişməyəcək.",
    created: "Tapşırıq yaradıldı. Aşpazlar onu telefonda görəcək.",
    cancelledNotice: "Tapşırıq ləğv edildi.",
  },
  wizard: {
    title: "Yeni inventarizasiya",
    step: (current, total) => `Addım ${current} / ${total}`,
    chooseMode: "Rejimi seçin",
    setup: "Filial, zonalar və aşpazlar",
    branch: "Filial",
    zones: "Zonalar",
    zonesParallel: "Zona (paralel nəzarətdə bir zona)",
    noZones: "Bu filialda zona yoxdur.",
    defaultZones: "Standart zonaları yarat",
    addZone: "Zona əlavə et",
    zoneName: "Zonanın adı",
    zoneType: "Növ",
    add: "Əlavə et",
    cooks: "Aşpazlar",
    cooksHint: (min, max) => `${min}–${max} nəfər seçin`,
    noCooks: "Bu filialda işçi yoxdur. Komanda bölməsindən dəvət edin.",
    assign: "Kim hansı zonanı sayır",
    assignHint: "Avtomatik paylanıb, dəyişə bilərsiniz.",
    nobody: "Seçin",
    taskTitle: "Ad",
    defaultTitle: (mode, date) => `${mode} · ${date}`,
    deadline: "Son müddət (istəyə görə)",
    create: "Tapşırığı yarat",
    varianceNote: (percent) => `Aşpazların rəqəmləri ${percent}-dən çox fərqlənsə, fərqi pulla göstərəcəyik.`,
    roles: { cook: "aşpaz", chef: "şef", owner: "sahib" },
  },
  detail: {
    back: "Bütün tapşırıqlar",
    zone: "Zona",
    product: "Məhsul",
    expected: "Uçotda",
    result: "Fakt",
    difference: "Fərq",
    variance: "Variance",
    value: "Pulla",
    needsReview: "Şef yoxlamalıdır",
    waiting: "Sayılır…",
    sent: "Göndərib",
    notSent: "Göndərməyib",
    progress: (sent, total) => `${sent} / ${total} zona göndərilib`,
    noLines: "Hələ heç kim göndərməyib.",
    closeAndWriteOff: "Bağla və sil",
    report: "Fərqlər hesabatı",
    createdAt: "Yaradılıb",
    deadline: "Son müddət",
    closedAt: "Bağlanıb",
    loss: "İtki",
    surplus: "Artıq",
  },
  cook: {
    hello: (name) => `Salam, ${name}!`,
    subtitle: "Zonanı sayın: rəqəmləri yalnız siz görürsünüz.",
    open: "Bu gün",
    openHint: "Göndəriləcək zonalar",
    sent: "Bitirdim",
    sentHint: "Göndərilmiş zonalar",
    accuracy: "Dəqiqlik",
    accuracyHint: "Bağlanmış inventarizasiyalarda",
    accuracyEmpty: "İlk yoxlamadan sonra",
    empty: "Tapşırıq yoxdur",
    emptyHint: "Şef tapşırıq verəndə burada görünəcək.",
    products: (count) => `${count} məhsul`,
    deadline: "Son müddət",
    noDeadline: "Müddətsiz",
    swipeHint: "Açmaq üçün sağa sürüşdürün",
    start: "Saymağa başla",
    view: "Bax",
    peers: (sent, total) => `Digər aşpazlar: ${sent} / ${total} göndərib`,
    waitingReview: "Şefin yoxlamasını gözləyir",
    closedCard: "Bağlanıb",
  },
  count: {
    progress: (done, total) => `${done} / ${total}`,
    finish: "Sayımı bitir",
    send: "Zonanı göndər",
    blindNote: "Kor sayım: gözlənilən miqdar göstərilmir. Gördüyünüzü yazın.",
    nothing: "Bu zonada məhsul yoxdur.",
    confirmMissing: (missing) => `${missing} məhsul boş qalıb: 0 kimi göndərilməyəcək. Davam edək?`,
    confirmSend: "Zonanı göndərək? Sonra dəyişmək olmayacaq.",
    sentTitle: "Zona təhvil verildi!",
    sentText: "Şefin yoxlamasını gözləyin.",
    peerSent: "Digər aşpaz artıq sayıb, tutuşdurmanı gözləyirik.",
    expected: "Uçotda",
    difference: "Fərq",
    yours: "Sizin",
    hiddenUntilClose: "Nəticələr şef inventarizasiyanı bağlayanda görünəcək.",
    back: "Tapşırıqlarım",
    search: "Məhsul axtar",
    next: "Növbəti",
    restored: "Qaralama bərpa olundu",
  },
  report: {
    title: "Fərqlər",
    subtitle: "İnventarizasiyaların nəticəsi pulla: ən bahalı itkilər yuxarıda.",
    kpi: {
      loss: "Ümumi itki",
      lossHint: "Çatışmazlıq maya dəyəri ilə",
      surplus: "Artıq",
      surplusHint: "Uçotdan artıq tapılan",
      accuracy: "Dəqiqlik",
      accuracyHint: "Əhəmiyyətli fərqsiz sətirlər",
      over: (percent) => `${percent}-dən çox fərq`,
      overHint: "Aşpazların rəqəmləri ayrılır",
    },
    filters: {
      branch: "Filial",
      task: "Tapşırıq",
      allTasks: "Son tapşırıqlar",
      from: "Başlanğıc",
      to: "Son",
      significant: (quantity, share) => `Yalnız ${quantity}-dən və ya dəyərin ${share}-indən çox fərqlər`,
    },
    table: {
      product: "Məhsul",
      zone: "Zona",
      expected: "Uçotda",
      counted: "Fakt",
      diffQty: "Fərq",
      unitCost: "Qiymət",
      diffMoney: "Fərq, pul",
      variance: "Variance",
      reason: "Səbəb",
      noReason: "—",
    },
    review: "Şef yoxlamalıdır",
    totals: { lines: "Mövqe", loss: "İtki", surplus: "Artıq", net: "Net" },
    empty: "Fərq yoxdur",
    emptyHint: "Bitmiş inventarizasiyalar burada görünəcək.",
    reasonSaved: "Səbəb saxlanıldı",
    close: {
      button: "İnventarizasiyanı bağla və sil",
      pickTask: "Bağlamaq üçün tapşırığı seçin",
      title: "İnventarizasiyanı bağlayaq?",
      text: (amount) => `${amount} məbləğində itki silinsin?`,
      details: "Qalıqlar sayılan miqdara bərabər olacaq, hər fərq üçün anbar hərəkəti yaradılacaq. Bunu geri qaytarmaq olmur.",
      confirm: "Bağla və sil",
      done: (amount) => `İnventarizasiya bağlandı! ${amount} itki silindi`,
    },
  },
};

export const INVENTORY_RU: InventoryDictionary = {
  modes: {
    fast_zones: {
      title: "Быстро по зонам",
      tagline: "1 повар = 1 зона",
      description: "Каждый повар считает свою зону. Быстро, без перекрёстной проверки.",
      bestFor: "Для ежедневной инвентаризации",
    },
    control_parallel: {
      title: "Контроль параллельно",
      tagline: "2+ повара = 1 зона, вслепую",
      description: "Несколько поваров считают одну зону, не видя друг друга. Система считает variance.",
      bestFor: "Для дорогих продуктов и еженедельного контроля краж",
    },
  },
  phases: { active: "Активна", done: "На проверке", closed: "Закрыта", cancelled: "Отменена" },
  zoneTypes: { quru: "Сухой склад", soyuducu: "Холодильник", dondurucu: "Морозильник", custom: "Другое" },
  reasons: { receiving_error: "Ошибка приёмки", theft: "Воровство", spoilage: "Порча", mis_sort: "Пересорт" },
  errors: {
    unauthenticated: "Войдите снова.",
    no_tenant: "Ресторан не найден.",
    forbidden: "Недостаточно прав.",
    invalid_input: "Проверьте данные.",
    branch_not_found: "Филиал не найден.",
    location_not_found: "Зона не найдена.",
    assignee_not_found: "Повар не работает в этом филиале.",
    open_count: "В этой зоне уже идёт подсчёт.",
    task_not_found: "Задача не найдена.",
    task_closed: "Задача уже закрыта.",
    already_submitted: "Эта зона уже отправлена.",
    product_not_found: "Продукт не найден.",
    nothing_counted: "Ничего не посчитано.",
    insufficient_stock: "Не хватает остатка: сначала проверьте движения.",
    line_not_found: "Строка не найдена.",
    duplicate_name: "Зона с таким названием уже есть.",
    save_failed: "Не удалось сохранить. Попробуйте ещё раз.",
  },
  common: {
    cancel: "Отмена",
    back: "Назад",
    next: "Далее",
    close: "Закрыть",
    all: "Все",
    apply: "Применить",
    reset: "Сбросить",
    forbidden: "Раздел доступен только владельцу и шефу.",
    working: "Минуту…",
  },
  chef: {
    title: "Инвентаризация",
    subtitle: "Ставьте задачи, повара считают вслепую, вы видите разницу в деньгах.",
    newTask: "Новая инвентаризация",
    discrepancies: "Посмотреть расхождения",
    stats: {
      active: "Активных",
      activeHint: (awaiting) => (awaiting > 0 ? `${awaiting} ${ruPlural(awaiting, "ждёт", "ждут", "ждут")} проверки` : "Всё под контролем"),
      finished: "Завершено за неделю",
      finishedHint: "Последние 7 дней",
      share: "Среднее расхождение",
      shareHint: "От учётной стоимости",
      losses: "Потери",
      lossesHint: "Недостача за 7 дней",
    },
    table: {
      task: "Задача",
      mode: "Режим",
      branch: "Филиал",
      zones: "Зоны",
      cooks: "Повара",
      progress: "Прогресс",
      status: "Статус",
      actions: "",
      open: "Открыть",
      close: "Закрыть",
      cancel: "Отменить",
      empty: "Инвентаризаций пока нет",
      emptyHint: "Создайте первую задачу — это займёт 2 минуты.",
    },
    confirmCancel: "Отменить задачу? Остатки не изменятся.",
    created: "Задача создана. Повара увидят её в телефоне.",
    cancelledNotice: "Задача отменена.",
  },
  wizard: {
    title: "Новая инвентаризация",
    step: (current, total) => `Шаг ${current} из ${total}`,
    chooseMode: "Выберите режим",
    setup: "Филиал, зоны и повара",
    branch: "Филиал",
    zones: "Зоны",
    zonesParallel: "Зона (в параллельном контроле — одна)",
    noZones: "В филиале нет зон.",
    defaultZones: "Создать зоны по умолчанию",
    addZone: "Добавить зону",
    zoneName: "Название зоны",
    zoneType: "Тип",
    add: "Добавить",
    cooks: "Повара",
    cooksHint: (min, max) => `Выберите от ${min} до ${max}`,
    noCooks: "В филиале нет сотрудников. Пригласите их в разделе «Команда».",
    assign: "Кто считает какую зону",
    assignHint: "Распределено автоматически — можно поменять.",
    nobody: "Выберите",
    taskTitle: "Название",
    defaultTitle: (mode, date) => `${mode} · ${date}`,
    deadline: "Дедлайн (необязательно)",
    create: "Создать задачу",
    varianceNote: (percent) => `Если цифры поваров разойдутся больше чем на ${percent}, покажем разницу в деньгах.`,
    roles: { cook: "повар", chef: "шеф", owner: "владелец" },
  },
  detail: {
    back: "Все задачи",
    zone: "Зона",
    product: "Продукт",
    expected: "Учтено",
    result: "Факт",
    difference: "Разница",
    variance: "Variance",
    value: "В деньгах",
    needsReview: "Требует проверки шефа",
    waiting: "Считает…",
    sent: "Сдал",
    notSent: "Не сдал",
    progress: (sent, total) => `Сдано ${sent} из ${total}`,
    noLines: "Пока никто не отправил подсчёт.",
    closeAndWriteOff: "Закрыть и списать",
    report: "Отчёт по расхождениям",
    createdAt: "Создана",
    deadline: "Дедлайн",
    closedAt: "Закрыта",
    loss: "Потери",
    surplus: "Излишки",
  },
  cook: {
    hello: (name) => `Салам, ${name}!`,
    subtitle: "Посчитайте зону — ваши цифры видите только вы.",
    open: "Моих задач сегодня",
    openHint: "Зоны к сдаче",
    sent: "Завершил",
    sentHint: "Сданные зоны",
    accuracy: "Точность",
    accuracyHint: "По закрытым инвентаризациям",
    accuracyEmpty: "После первой проверки",
    empty: "Задач нет",
    emptyHint: "Когда шеф назначит подсчёт, он появится здесь.",
    products: (count) => `${count} ${ruPlural(count, "продукт", "продукта", "продуктов")}`,
    deadline: "Дедлайн",
    noDeadline: "Без срока",
    swipeHint: "Смахните вправо, чтобы открыть",
    start: "Начать подсчёт",
    view: "Посмотреть",
    peers: (sent, total) => `Другие повара: сдали ${sent} из ${total}`,
    waitingReview: "Ждёт проверки шефа",
    closedCard: "Закрыта",
  },
  count: {
    progress: (done, total) => `${done} / ${total}`,
    finish: "Завершить подсчёт",
    send: "Отправить зону",
    blindNote: "Слепой подсчёт: учётное количество скрыто. Пишите, что видите.",
    nothing: "В этой зоне нет продуктов.",
    confirmMissing: (missing) => `${missing} ${ruPlural(missing, "продукт не заполнен", "продукта не заполнены", "продуктов не заполнены")} и не будут отправлены. Продолжить?`,
    confirmSend: "Отправить зону? Изменить потом будет нельзя.",
    sentTitle: "Зона сдана!",
    sentText: "Ожидайте проверки шефа.",
    peerSent: "Второй повар уже посчитал — ждём сверку.",
    expected: "Учтено",
    difference: "Разница",
    yours: "Ваш",
    hiddenUntilClose: "Результаты появятся, когда шеф закроет инвентаризацию.",
    back: "Мои задачи",
    search: "Найти продукт",
    next: "Далее",
    restored: "Черновик восстановлен",
  },
  report: {
    title: "Расхождения",
    subtitle: "Итоги инвентаризаций в деньгах — самые дорогие потери сверху.",
    kpi: {
      loss: "Общие потери",
      lossHint: "Недостача по себестоимости",
      surplus: "Излишки",
      surplusHint: "Найдено сверх учёта",
      accuracy: "Точность инвентаризации",
      accuracyHint: "Строки без существенной разницы",
      over: (percent) => `Расхождений > ${percent}`,
      overHint: "Цифры поваров расходятся",
    },
    filters: {
      branch: "Филиал",
      task: "Задача",
      allTasks: "Последние задачи",
      from: "С",
      to: "По",
      significant: (quantity, share) => `Только расхождения > ${quantity} или > ${share} от стоимости`,
    },
    table: {
      product: "Продукт",
      zone: "Зона",
      expected: "Учтено",
      counted: "Факт",
      diffQty: "Разница",
      unitCost: "Цена",
      diffMoney: "Разница, деньги",
      variance: "Variance",
      reason: "Причина",
      noReason: "—",
    },
    review: "Требует проверки шефа",
    totals: { lines: "Всего позиций", loss: "Всего потери", surplus: "Всего излишки", net: "Net" },
    empty: "Расхождений нет",
    emptyHint: "Завершённые инвентаризации появятся здесь.",
    reasonSaved: "Причина сохранена",
    close: {
      button: "Закрыть инвентаризацию и списать",
      pickTask: "Выберите задачу, чтобы закрыть",
      title: "Закрыть инвентаризацию?",
      text: (amount) => `Списать потери на сумму ${amount}?`,
      details: "Это создаст движения склада и обновит остатки до посчитанных. Отменить будет нельзя.",
      confirm: "Закрыть и списать",
      done: (amount) => `Инвентаризация закрыта! Потери ${amount} списаны`,
    },
  },
};

export const INVENTORY_EN: InventoryDictionary = {
  modes: {
    fast_zones: {
      title: "Fast by zones",
      tagline: "1 cook = 1 zone",
      description: "Every cook counts their own zone. Fast, no cross-check.",
      bestFor: "For the daily count",
    },
    control_parallel: {
      title: "Parallel control",
      tagline: "2+ cooks = 1 zone, blind",
      description: "Several cooks count the same zone without seeing each other; the system measures the variance.",
      bestFor: "For expensive products and the weekly anti-theft check",
    },
  },
  phases: { active: "Active", done: "In review", closed: "Closed", cancelled: "Cancelled" },
  zoneTypes: { quru: "Dry store", soyuducu: "Fridge", dondurucu: "Freezer", custom: "Other" },
  reasons: { receiving_error: "Receiving error", theft: "Theft", spoilage: "Spoilage", mis_sort: "Mis-sort" },
  errors: {
    unauthenticated: "Please sign in again.",
    no_tenant: "Restaurant not found.",
    forbidden: "You are not allowed to do this.",
    invalid_input: "Please check the data.",
    branch_not_found: "Branch not found.",
    location_not_found: "Zone not found.",
    assignee_not_found: "This cook does not work in the branch.",
    open_count: "This zone is already being counted.",
    task_not_found: "Task not found.",
    task_closed: "The task is already closed.",
    already_submitted: "This zone has already been sent.",
    product_not_found: "Product not found.",
    nothing_counted: "Nothing was counted.",
    insufficient_stock: "Not enough stock: check the movements first.",
    line_not_found: "Line not found.",
    duplicate_name: "A zone with this name already exists.",
    save_failed: "Could not save. Please try again.",
  },
  common: {
    cancel: "Cancel",
    back: "Back",
    next: "Next",
    close: "Close",
    all: "All",
    apply: "Apply",
    reset: "Reset",
    forbidden: "Only owners and chefs can open this page.",
    working: "One moment…",
  },
  chef: {
    title: "Inventory",
    subtitle: "Assign counts, cooks count blind, you see the difference in money.",
    newTask: "New inventory",
    discrepancies: "View discrepancies",
    stats: {
      active: "Active",
      activeHint: (awaiting) => (awaiting > 0 ? `${awaiting} awaiting review` : "All under control"),
      finished: "Finished this week",
      finishedHint: "Last 7 days",
      share: "Average discrepancy",
      shareHint: "Of the book value",
      losses: "Losses",
      lossesHint: "Shortage over 7 days",
    },
    table: {
      task: "Task",
      mode: "Mode",
      branch: "Branch",
      zones: "Zones",
      cooks: "Cooks",
      progress: "Progress",
      status: "Status",
      actions: "",
      open: "Open",
      close: "Close",
      cancel: "Cancel",
      empty: "No inventories yet",
      emptyHint: "Create the first task — it takes 2 minutes.",
    },
    confirmCancel: "Cancel the task? Stock will not change.",
    created: "Task created. Cooks will see it on their phones.",
    cancelledNotice: "Task cancelled.",
  },
  wizard: {
    title: "New inventory",
    step: (current, total) => `Step ${current} of ${total}`,
    chooseMode: "Choose a mode",
    setup: "Branch, zones and cooks",
    branch: "Branch",
    zones: "Zones",
    zonesParallel: "Zone (one zone in parallel control)",
    noZones: "This branch has no zones.",
    defaultZones: "Create default zones",
    addZone: "Add zone",
    zoneName: "Zone name",
    zoneType: "Type",
    add: "Add",
    cooks: "Cooks",
    cooksHint: (min, max) => `Pick ${min} to ${max}`,
    noCooks: "No staff in this branch. Invite them from the Team page.",
    assign: "Who counts which zone",
    assignHint: "Assigned automatically — you can change it.",
    nobody: "Choose",
    taskTitle: "Title",
    defaultTitle: (mode, date) => `${mode} · ${date}`,
    deadline: "Deadline (optional)",
    create: "Create task",
    varianceNote: (percent) => `If the cooks' numbers differ by more than ${percent}, we show the difference in money.`,
    roles: { cook: "cook", chef: "chef", owner: "owner" },
  },
  detail: {
    back: "All tasks",
    zone: "Zone",
    product: "Product",
    expected: "Book",
    result: "Actual",
    difference: "Difference",
    variance: "Variance",
    value: "In money",
    needsReview: "Chef review needed",
    waiting: "Counting…",
    sent: "Sent",
    notSent: "Not sent",
    progress: (sent, total) => `${sent} of ${total} sent`,
    noLines: "Nobody has sent a count yet.",
    closeAndWriteOff: "Close and write off",
    report: "Discrepancy report",
    createdAt: "Created",
    deadline: "Deadline",
    closedAt: "Closed",
    loss: "Loss",
    surplus: "Surplus",
  },
  cook: {
    hello: (name) => `Hi, ${name}!`,
    subtitle: "Count your zone — only you see your numbers.",
    open: "My tasks today",
    openHint: "Zones to send",
    sent: "Done",
    sentHint: "Zones sent",
    accuracy: "Accuracy",
    accuracyHint: "In closed inventories",
    accuracyEmpty: "After the first review",
    empty: "No tasks",
    emptyHint: "When the chef assigns a count, it shows up here.",
    products: (count) => `${count} ${count === 1 ? "product" : "products"}`,
    deadline: "Deadline",
    noDeadline: "No deadline",
    swipeHint: "Swipe right to open",
    start: "Start counting",
    view: "View",
    peers: (sent, total) => `Other cooks: ${sent} of ${total} sent`,
    waitingReview: "Waiting for the chef",
    closedCard: "Closed",
  },
  count: {
    progress: (done, total) => `${done} / ${total}`,
    finish: "Finish count",
    send: "Send zone",
    blindNote: "Blind count: the book quantity is hidden. Enter what you see.",
    nothing: "There are no products in this zone.",
    confirmMissing: (missing) => `${missing} ${missing === 1 ? "product is" : "products are"} empty and will not be sent. Continue?`,
    confirmSend: "Send the zone? You cannot change it afterwards.",
    sentTitle: "Zone sent!",
    sentText: "Wait for the chef's review.",
    peerSent: "Another cook has already counted — waiting for the check.",
    expected: "Book",
    difference: "Difference",
    yours: "Yours",
    hiddenUntilClose: "Results appear when the chef closes the inventory.",
    back: "My tasks",
    search: "Find a product",
    next: "Next",
    restored: "Draft restored",
  },
  report: {
    title: "Discrepancies",
    subtitle: "Inventory results in money — the most expensive losses first.",
    kpi: {
      loss: "Total loss",
      lossHint: "Shortage at cost",
      surplus: "Surplus",
      surplusHint: "Found above the books",
      accuracy: "Inventory accuracy",
      accuracyHint: "Lines without a real difference",
      over: (percent) => `Variance > ${percent}`,
      overHint: "Cooks' numbers disagree",
    },
    filters: {
      branch: "Branch",
      task: "Task",
      allTasks: "Latest tasks",
      from: "From",
      to: "To",
      significant: (quantity, share) => `Only differences > ${quantity} or > ${share} of the value`,
    },
    table: {
      product: "Product",
      zone: "Zone",
      expected: "Book",
      counted: "Actual",
      diffQty: "Difference",
      unitCost: "Price",
      diffMoney: "Difference, money",
      variance: "Variance",
      reason: "Reason",
      noReason: "—",
    },
    review: "Chef review needed",
    totals: { lines: "Lines", loss: "Total loss", surplus: "Total surplus", net: "Net" },
    empty: "No discrepancies",
    emptyHint: "Finished inventories show up here.",
    reasonSaved: "Reason saved",
    close: {
      button: "Close inventory and write off",
      pickTask: "Pick a task to close it",
      title: "Close the inventory?",
      text: (amount) => `Write off losses of ${amount}?`,
      details: "This creates stock movements and sets stock to the counted balance. It cannot be undone.",
      confirm: "Close and write off",
      done: (amount) => `Inventory closed! ${amount} written off`,
    },
  },
};
