import type { ExpiryAction } from "@/lib/labels/expiry";
import { ruPlural } from "./plural";

export type ExpiryDictionary = {
  card: {
    title: string;
    hint: (days: number) => string;
    empty: string;
    count: (count: number) => string;
    total: (money: string) => string;
  };
  columns: {
    product: string;
    lot: string;
    place: string;
    quantity: string;
    expiry: string;
    daysLeft: string;
    value: string;
    actions: string;
  };
  days: (daysLeft: number) => string;
  actions: Record<ExpiryAction, string>;
  done: Record<ExpiryAction, (product: string) => string>;
  confirmWriteOff: (qty: string, product: string) => string;
  extend: {
    title: (product: string) => string;
    date: string;
    note: string;
    notePlaceholder: string;
    save: string;
    cancel: string;
    dateError: string;
    noteError: string;
  };
  working: string;
  expiredValue: (money: string) => string;
  bell: {
    label: (count: number) => string;
    title: string;
    empty: string;
    item: (count: number, money: string | null) => string;
    open: string;
    markRead: string;
  };
  dashboard: {
    nav: string;
    title: string;
    subtitle: string;
    branch: string;
    alertTitle: (count: number) => string;
    alertValue: (money: string) => string;
    alertEmpty: string;
    open: string;
    forbidden: string;
    noBranch: string;
  };
};

export const EXPIRY_AZ: ExpiryDictionary = {
  card: {
    title: "Müddəti bitir",
    hint: (days) => `Bu gündən ${days} gün ərzində bitən partiyalar. Sistem özü heç nə silmir — qərarı şef verir.`,
    empty: "Yaxın günlərdə müddəti bitən partiya yoxdur.",
    count: (count) => `${count} partiya`,
    total: (money) => `Cəmi: ${money}`,
  },
  columns: {
    product: "Məhsul",
    lot: "Partiya",
    place: "Yer",
    quantity: "Miqdar",
    expiry: "Son tarix",
    daysLeft: "Qalıb",
    value: "Dəyər",
    actions: "Qərar",
  },
  days: (d) => (d < 0 ? `${-d} gün keçib` : d === 0 ? "bu gün" : d === 1 ? "sabah" : `${d} gün`),
  actions: {
    use_in_production: "İstehsala",
    discount: "Endirim",
    staff: "Personala",
    extend: "Uzat",
    write_off: "Sil",
  },
  done: {
    use_in_production: (p) => `${p}: istehsala yönləndirildi`,
    discount: (p) => `${p}: endirimə qoyuldu`,
    staff: (p) => `${p}: personal yeməyinə verildi`,
    extend: (p) => `${p}: müddət uzadıldı`,
    write_off: (p) => `${p}: silindi`,
  },
  confirmWriteOff: (qty, product) => `${product} (${qty}) silinsin? Bu, tullantı jurnalına düşəcək.`,
  extend: {
    title: (product) => `${product}: müddəti uzat`,
    date: "Yeni son tarix",
    note: "Səbəb",
    notePlaceholder: "Məs.: qablaşdırma bağlıdır, yoxlanıldı",
    save: "Uzat",
    cancel: "Ləğv et",
    dateError: "Tarix bu gündən sonra olmalıdır.",
    noteError: "Səbəbi yazın (500 simvola qədər).",
  },
  working: "Gözləyin…",
  expiredValue: (money) => `Müddəti bitmiş: ${money} (cəmə daxil deyil)`,
  bell: {
    label: (count) => (count > 0 ? `Bildirişlər: ${count} oxunmamış` : "Bildirişlər"),
    title: "Müddəti bitir",
    empty: "Yeni bildiriş yoxdur.",
    item: (count, money) => `${count} partiyanın müddəti bitir${money ? ` · ${money}` : ""}`,
    open: "Siyahıya bax",
    markRead: "Oxundu",
  },
  dashboard: {
    nav: "Şef paneli",
    title: "Şef paneli",
    subtitle: "Bu gün nəyə baxmaq lazımdır.",
    branch: "Filial",
    alertTitle: (count) => `${count} partiyanın müddəti bitir`,
    alertValue: (money) => `Dəyəri: ${money}`,
    alertEmpty: "Yaxın günlərdə müddəti bitən partiya yoxdur.",
    open: "Qərar ver",
    forbidden: "Bu panel yalnız şef və sahib üçündür.",
    noBranch: "Filial yoxdur.",
  },
};

export const EXPIRY_RU: ExpiryDictionary = {
  card: {
    title: "Истекает срок",
    hint: (days) =>
      `Партии, у которых срок истекает в ближайшие ${days} ${ruPlural(days, "день", "дня", "дней")}. Система сама ничего не списывает — решает шеф.`,
    empty: "В ближайшие дни ни у одной партии срок не истекает.",
    count: (count) => `${count} ${ruPlural(count, "партия", "партии", "партий")}`,
    total: (money) => `Итого: ${money}`,
  },
  columns: {
    product: "Продукт",
    lot: "Партия",
    place: "Место",
    quantity: "Кол-во",
    expiry: "Годен до",
    daysLeft: "Осталось",
    value: "Стоимость",
    actions: "Решение",
  },
  days: (d) =>
    d < 0 ? `просрочено ${-d} ${ruPlural(-d, "день", "дня", "дней")}` : d === 0 ? "сегодня" : d === 1 ? "завтра" : `${d} ${ruPlural(d, "день", "дня", "дней")}`,
  actions: {
    use_in_production: "В производство",
    discount: "Скидка",
    staff: "Персоналу",
    extend: "Продлить",
    write_off: "Списать",
  },
  done: {
    use_in_production: (p) => `${p}: отправлено в производство`,
    discount: (p) => `${p}: поставлено на скидку`,
    staff: (p) => `${p}: отдано на питание персонала`,
    extend: (p) => `${p}: срок продлён`,
    write_off: (p) => `${p}: списано`,
  },
  confirmWriteOff: (qty, product) => `Списать ${product} (${qty})? Запись попадёт в журнал списаний.`,
  extend: {
    title: (product) => `${product}: продлить срок`,
    date: "Новый срок годности",
    note: "Причина",
    notePlaceholder: "Напр.: упаковка закрыта, проверено",
    save: "Продлить",
    cancel: "Отмена",
    dateError: "Дата должна быть позже сегодняшней.",
    noteError: "Укажите причину (до 500 символов).",
  },
  working: "Подождите…",
  expiredValue: (money) => `Просрочено: ${money} (не входит в итог)`,
  bell: {
    label: (count) => (count > 0 ? `Уведомления: ${count} непрочитанных` : "Уведомления"),
    title: "Истекает срок",
    empty: "Новых уведомлений нет.",
    item: (count, money) => `Истекает срок у ${count} ${ruPlural(count, "партии", "партий", "партий")}${money ? ` · ${money}` : ""}`,
    open: "Открыть список",
    markRead: "Прочитано",
  },
  dashboard: {
    nav: "Панель шефа",
    title: "Панель шефа",
    subtitle: "На что посмотреть сегодня.",
    branch: "Филиал",
    alertTitle: (count) => `Истекает срок у ${count} ${ruPlural(count, "партии", "партий", "партий")}`,
    alertValue: (money) => `На сумму ${money}`,
    alertEmpty: "В ближайшие дни ни у одной партии срок не истекает.",
    open: "Принять решение",
    forbidden: "Эта панель только для шефа и владельца.",
    noBranch: "Нет филиалов.",
  },
};

export const EXPIRY_EN: ExpiryDictionary = {
  card: {
    title: "Expiring soon",
    hint: (days) => `Lots expiring within ${days} ${days === 1 ? "day" : "days"} from today. The system writes nothing off — the chef decides.`,
    empty: "No lot expires in the next days.",
    count: (count) => `${count} ${count === 1 ? "lot" : "lots"}`,
    total: (money) => `Total: ${money}`,
  },
  columns: {
    product: "Product",
    lot: "Lot",
    place: "Place",
    quantity: "Qty",
    expiry: "Best before",
    daysLeft: "Left",
    value: "Value",
    actions: "Decision",
  },
  days: (d) => (d < 0 ? `expired ${-d} ${-d === 1 ? "day" : "days"} ago` : d === 0 ? "today" : d === 1 ? "tomorrow" : `${d} days`),
  actions: {
    use_in_production: "To production",
    discount: "Discount",
    staff: "Staff meal",
    extend: "Extend",
    write_off: "Write off",
  },
  done: {
    use_in_production: (p) => `${p}: sent to production`,
    discount: (p) => `${p}: marked for discount`,
    staff: (p) => `${p}: given as a staff meal`,
    extend: (p) => `${p}: expiry extended`,
    write_off: (p) => `${p}: written off`,
  },
  confirmWriteOff: (qty, product) => `Write off ${product} (${qty})? It goes into the waste log.`,
  extend: {
    title: (product) => `${product}: extend expiry`,
    date: "New best-before date",
    note: "Reason",
    notePlaceholder: "E.g. sealed, checked",
    save: "Extend",
    cancel: "Cancel",
    dateError: "The date must be after today.",
    noteError: "Enter a reason (up to 500 characters).",
  },
  working: "Please wait…",
  expiredValue: (money) => `Expired: ${money} (not in the total)`,
  bell: {
    label: (count) => (count > 0 ? `Notifications: ${count} unread` : "Notifications"),
    title: "Expiring soon",
    empty: "No new notifications.",
    item: (count, money) => `${count} ${count === 1 ? "lot expires" : "lots expire"} soon${money ? ` · ${money}` : ""}`,
    open: "Open the list",
    markRead: "Mark read",
  },
  dashboard: {
    nav: "Chef dashboard",
    title: "Chef dashboard",
    subtitle: "What needs a look today.",
    branch: "Branch",
    alertTitle: (count) => `${count} ${count === 1 ? "lot expires" : "lots expire"} soon`,
    alertValue: (money) => `Worth ${money}`,
    alertEmpty: "No lot expires in the next days.",
    open: "Decide",
    forbidden: "This dashboard is for chefs and owners only.",
    noBranch: "No branches.",
  },
};
