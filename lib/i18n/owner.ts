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
};
