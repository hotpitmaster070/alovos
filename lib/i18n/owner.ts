export type OwnerDictionary = {
  dashboard: {
    title: string;
    subtitle: string;
    allBranches: string;
    branch: string;
    apply: string;
    stockCost: string;
    stockCostHint: string;
    belowPar: string;
    belowParHint: (outOfStock: number) => string;
    wastedToday: string;
    wastedTodayHint: string;
    discrepancies: string;
    discrepanciesHint: (suspicious: number) => string;
    runningOut: string;
    nothingRunningOut: string;
    product: string;
    left: string;
    minimum: string;
    toOrder: string;
    status: string;
    forbidden: string;
    wasteFeed: string;
    shownLimit: (count: number) => string;
  };
  par: {
    order: (left: string, min: string) => string;
    /** Short form for product cards and stock rows. */
    orderNow: string;
    out: string;
  };
  wasteFeed: {
    title: string;
    lossToday: (amount: string) => string;
    loss: (amount: string) => string;
    reason: string;
    allReasons: string;
    cook: string;
    allCooks: string;
    day: string;
    apply: string;
    date: string;
    product: string;
    quantity: string;
    cost: string;
    photo: string;
    empty: string;
    forbidden: string;
    logWaste: string;
    dashboard: string;
  };
  losses: {
    open: string;
    title: string;
    subtitle: string;
    periods: { week: string; month: string };
    range: (start: string, end: string) => string;
    total: string;
    totalHint: (overLimit: number) => string;
    product: string;
    expected: string;
    actual: string;
    lossQty: string;
    lossValue: string;
    lossPercent: string;
    breakdown: (writtenOff: string, countLoss: string) => string;
    noSales: string;
    empty: string;
    forbidden: string;
    how: string;
  };
};

export const OWNER_AZ: OwnerDictionary = {
  dashboard: {
    title: "Sahibkar paneli",
    subtitle: "Anbar, itkilər və sayım nəticələri canlı",
    allBranches: "Bütün filiallar",
    branch: "Filial",
    apply: "Göstər",
    stockCost: "Anbarın dəyəri",
    stockCostHint: "Hazırki qalıq × partiyanın qiyməti",
    belowPar: "Minimumdan aşağı",
    belowParHint: (n) => (n > 0 ? `${n} məhsul bitib` : "Bitmiş məhsul yoxdur"),
    wastedToday: "Bu gün silinib",
    wastedTodayHint: "Silinmə anındakı qiymətlə",
    discrepancies: "Həftəlik kəsir",
    discrepanciesHint: (n) => (n > 0 ? `${n} şübhəli sayım` : "Şübhəli sayım yoxdur"),
    runningOut: "Nə bitir",
    nothingRunningOut: "Bütün məhsullar minimumdan yuxarıdır.",
    product: "Məhsul",
    left: "Qalıb",
    minimum: "Minimum",
    toOrder: "Sifariş et",
    status: "Vəziyyət",
    forbidden: "Bu panel yalnız sahibkar və aşpaz üçündür.",
    wasteFeed: "Silinmələr",
    shownLimit: (n) => `İlk ${n} sətir göstərilir`,
  },
  par: {
    order: (left, min) => `SİFARİŞ ET! Qalıb ${left}, minimum ${min}`,
    orderNow: "İndi sifariş et",
    out: "BİTİB!",
  },
  wasteFeed: {
    title: "Silinmə lenti",
    lossToday: (amount) => `Bu günkü itki: ${amount}`,
    loss: (amount) => `İtki: ${amount}`,
    reason: "Səbəb",
    allReasons: "Bütün səbəblər",
    cook: "Aşpaz",
    allCooks: "Hamı",
    day: "Gün",
    apply: "Göstər",
    date: "Vaxt",
    product: "Məhsul",
    quantity: "Miqdar",
    cost: "Dəyər",
    photo: "Foto",
    empty: "Bu gün üçün silinmə yoxdur.",
    forbidden: "Lent yalnız sahibkar və aşpaz üçündür.",
    logWaste: "Sil",
    dashboard: "Panel",
  },
  losses: {
    open: "Haradan gedir",
    title: "Gözlənilən və faktiki",
    subtitle: "Satış × texnoloji kart ilə anbardan həqiqətən çıxanın fərqi",
    periods: { week: "Həftə", month: "Ay" },
    range: (start, end) => `${start} — ${end}`,
    total: "Dövr üzrə itki",
    totalHint: (n) => (n > 0 ? `${n} məhsul həddən yuxarıdır` : "Həddən yuxarı məhsul yoxdur"),
    product: "Məhsul",
    expected: "Gözlənilən",
    actual: "Faktiki",
    lossQty: "İtki",
    lossValue: "İtki, pul",
    lossPercent: "İtki %",
    breakdown: (w, c) => `silinib ${w} · sayımda çatışmır ${c}`,
    noSales: "satış yoxdur",
    empty: "Bu dövrdə satış və itki yoxdur.",
    forbidden: "Hesabat yalnız sahibkar və aşpaz üçündür.",
    how: "Gözlənilən: satılan porsiyalar × texnoloji kart. Faktiki: satış, silinmələr və sayımda çatışmayan. Filiallar arası köçürmə və hazırlıq itki sayılmır.",
  },
};

export const OWNER_RU: OwnerDictionary = {
  dashboard: {
    title: "Дашборд владельца",
    subtitle: "Склад, потери и результаты инвентаризаций в реальном времени",
    allBranches: "Все филиалы",
    branch: "Филиал",
    apply: "Показать",
    stockCost: "Стоимость склада",
    stockCostHint: "Текущий остаток × цена партии",
    belowPar: "Ниже минимума",
    belowParHint: (n) => (n > 0 ? `${n} закончились` : "Нет закончившихся"),
    wastedToday: "Списано сегодня",
    wastedTodayHint: "По цене на момент списания",
    discrepancies: "Недостача за неделю",
    discrepanciesHint: (n) => (n > 0 ? `${n} подозрительных подсчётов` : "Подозрительных подсчётов нет"),
    runningOut: "Что заканчивается",
    nothingRunningOut: "Все товары выше минимума.",
    product: "Товар",
    left: "Осталось",
    minimum: "Минимум",
    toOrder: "Заказать",
    status: "Статус",
    forbidden: "Дашборд доступен только владельцу и шефу.",
    wasteFeed: "Списания",
    shownLimit: (n) => `Показаны первые ${n} строк`,
  },
  par: {
    order: (left, min) => `ЗАКАЖИ! Осталось ${left}, минимум ${min}`,
    orderNow: "Закажи сейчас",
    out: "ЗАКОНЧИЛОСЬ!",
  },
  wasteFeed: {
    title: "Лента списаний",
    lossToday: (amount) => `Потери сегодня: ${amount}`,
    loss: (amount) => `Потери: ${amount}`,
    reason: "Причина",
    allReasons: "Все причины",
    cook: "Повар",
    allCooks: "Все",
    day: "День",
    apply: "Показать",
    date: "Время",
    product: "Продукт",
    quantity: "Кол-во",
    cost: "Стоимость",
    photo: "Фото",
    empty: "За этот день списаний нет.",
    forbidden: "Лента доступна только владельцу и шефу.",
    logWaste: "Списать",
    dashboard: "Дашборд",
  },
  losses: {
    open: "Где теряем",
    title: "Ожидалось и факт",
    subtitle: "Продажи × техкарты против того, что реально ушло со склада",
    periods: { week: "Неделя", month: "Месяц" },
    range: (start, end) => `${start} — ${end}`,
    total: "Потери за период",
    totalHint: (n) => (n > 0 ? `${n} товаров выше порога` : "Выше порога ничего нет"),
    product: "Товар",
    expected: "Ожидалось",
    actual: "Факт",
    lossQty: "Потери",
    lossValue: "Потери, деньги",
    lossPercent: "% потерь",
    breakdown: (w, c) => `списано ${w} · недостача при подсчёте ${c}`,
    noSales: "продаж нет",
    empty: "За период нет ни продаж, ни потерь.",
    forbidden: "Отчёт доступен только владельцу и шефу.",
    how: "Ожидалось: проданные порции × техкарта. Факт: продажи, списания и недостача при подсчёте. Перемещения между филиалами и заготовки потерями не считаются.",
  },
};

export const OWNER_EN: OwnerDictionary = {
  dashboard: {
    title: "Owner dashboard",
    subtitle: "Stock, waste and count results, live",
    allBranches: "All branches",
    branch: "Branch",
    apply: "Show",
    stockCost: "Stock value",
    stockCostHint: "Current balance × lot price",
    belowPar: "Below par",
    belowParHint: (n) => (n > 0 ? `${n} out of stock` : "Nothing out of stock"),
    wastedToday: "Wasted today",
    wastedTodayHint: "At the price when written off",
    discrepancies: "Shortage this week",
    discrepanciesHint: (n) => (n > 0 ? `${n} suspicious counts` : "No suspicious counts"),
    runningOut: "Running out",
    nothingRunningOut: "Every product is above its minimum.",
    product: "Product",
    left: "Left",
    minimum: "Minimum",
    toOrder: "To order",
    status: "Status",
    forbidden: "The dashboard is for owners and chefs.",
    wasteFeed: "Waste",
    shownLimit: (n) => `First ${n} rows shown`,
  },
  par: {
    order: (left, min) => `ORDER! ${left} left, minimum ${min}`,
    orderNow: "Order now",
    out: "OUT OF STOCK!",
  },
  wasteFeed: {
    title: "Waste feed",
    lossToday: (amount) => `Lost today: ${amount}`,
    loss: (amount) => `Lost: ${amount}`,
    reason: "Reason",
    allReasons: "All reasons",
    cook: "Cook",
    allCooks: "Everyone",
    day: "Day",
    apply: "Show",
    date: "Time",
    product: "Product",
    quantity: "Qty",
    cost: "Cost",
    photo: "Photo",
    empty: "No waste on this day.",
    forbidden: "The feed is for owners and chefs.",
    logWaste: "Write off",
    dashboard: "Dashboard",
  },
  losses: {
    open: "Where it goes",
    title: "Expected vs actual",
    subtitle: "Sales × tech cards against what really left the stock",
    periods: { week: "Week", month: "Month" },
    range: (start, end) => `${start} — ${end}`,
    total: "Loss in the period",
    totalHint: (n) => (n > 0 ? `${n} products over the line` : "Nothing over the line"),
    product: "Product",
    expected: "Expected",
    actual: "Actual",
    lossQty: "Loss",
    lossValue: "Loss, money",
    lossPercent: "Loss %",
    breakdown: (w, c) => `written off ${w} · missing at count ${c}`,
    noSales: "no sales",
    empty: "No sales and no losses in this period.",
    forbidden: "The report is for owners and chefs.",
    how: "Expected: portions sold × tech card. Actual: sales, write-offs and count shortages. Transfers between branches and prep are not losses.",
  },
};
