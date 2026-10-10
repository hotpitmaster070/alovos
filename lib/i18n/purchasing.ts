import type { ForecastStatus, InviteRole, PurchasingErrorCode, RequestStatus } from "@/lib/purchasing/model";
import { ruPlural } from "./plural";

export type PurchasingDictionary = {
  /** BCP 47 tag for weekday and date names (Intl). */
  locale: string;
  settingsLink: string;
  limits: {
    button: string;
    title: (product: string) => string;
    par: string;
    parHint: string;
    min: string;
    minHint: string;
    supplier: string;
    noSupplier: string;
    unit: (unit: string) => string;
    save: string;
    cancel: string;
    working: string;
    saved: string;
  };
  forecast: {
    title: string;
    hint: string;
    status: Record<ForecastStatus, string>;
    nextDelivery: (day: string) => string;
    willRunOut: string;
    orderQty: (qty: string, days: number | null) => string;
    projected: (qty: string) => string;
    usage: (qty: string) => string;
    onOrder: (qty: string) => string;
    noDelivery: string;
    stock: string;
    product: string;
    state: string;
    all: string;
    attention: string;
    empty: string;
  };
  value: {
    title: string;
    live: string;
    byType: string;
  };
  suppliers: {
    title: string;
    open: string;
    add: string;
    edit: string;
    name: string;
    code: string;
    codeHint: string;
    contact: string;
    phone: string;
    phonePlaceholder: string;
    phoneHint: string;
    email: string;
    days: string;
    noDays: string;
    branch: string;
    allBranches: string;
    leadTime: string;
    inactive: string;
    deactivate: string;
    activate: string;
    save: string;
    cancel: string;
    working: string;
    empty: string;
    saved: string;
  };
  orders: {
    title: string;
    open: string;
    check: string;
    checked: (changed: number) => string;
    drafts: string;
    sent: string;
    status: Record<RequestStatus, string>;
    auto: string;
    approve: string;
    receive: string;
    discard: string;
    confirmDiscard: string;
    empty: string;
    noSent: string;
    product: string;
    qty: string;
    contact: string;
    sentAt: string;
    readOnly: string;
    done: string;
  };
  invite: {
    title: string;
    open: string;
    phone: string;
    phonePlaceholder: string;
    role: string;
    roles: Record<InviteRole, string>;
    create: string;
    working: string;
    link: string;
    copy: string;
    copied: string;
    share: string;
    shareText: (url: string) => string;
    expires: (date: string) => string;
    history: string;
    used: string;
    expired: string;
    pending: string;
    empty: string;
    ownerOnly: string;
  };
  accept: {
    title: string;
    body: (restaurant: string, role: string) => string;
    accept: string;
    signIn: string;
    signUp: string;
    needAccount: string;
    signUpHint: string;
    openApp: string;
    states: Record<"used" | "expired" | "not_found", string> & { joined: (restaurant: string) => string };
  };
  owner: {
    title: string;
    open: string;
    hint: string;
    stockValue: string;
    lowStock: string;
    critical: string;
    autoRequests: string;
    live: string;
    noAccess: string;
  };
  errors: Record<PurchasingErrorCode, string>;
};

export const PURCHASING_AZ: PurchasingDictionary = {
  locale: "az",
  settingsLink: "Ayarlar",
  limits: {
    button: "Limit qoy",
    title: (product) => `Limit: ${product}`,
    par: "Par səviyyəsi",
    parHint: "Çatdırılmadan sonra olmalı olan miqdar",
    min: "Minimum",
    minHint: "Boş qalsa, ümumi minimum tətbiq olunur",
    supplier: "Təchizatçı",
    noSupplier: "Seçilməyib",
    unit: (unit) => `Vahid: ${unit}`,
    save: "Saxla",
    cancel: "Ləğv et",
    working: "Saxlanılır…",
    saved: "Limit saxlanıldı",
  },
  forecast: {
    title: "Limitlər və proqnoz",
    hint: "Qalıq, gündəlik sərf və növbəti çatdırılmaya qədər proqnoz",
    status: { critical: "🔴 Qurtardı", order: "🟡 Sifariş et", ok: "🟢 OK", no_limits: "Limit yoxdur" },
    nextDelivery: (day) => `Növbəti çatdırılma ${day}`,
    willRunOut: "çatmayacaq!",
    orderQty: (qty, days) => (days === null ? `Sifariş et: ${qty}` : `Sifariş et: ${qty} (${days} gün qaldı)`),
    projected: (qty) => `Proqnoz: ${qty}`,
    usage: (qty) => `Gündə: ${qty}`,
    onOrder: (qty) => `Yoldadır: ${qty}`,
    noDelivery: "Çatdırılma günü yoxdur",
    stock: "Qalıq",
    product: "Məhsul",
    state: "Vəziyyət",
    all: "Hamısı",
    attention: "Diqqət tələb edən",
    empty: "Diqqət tələb edən məhsul yoxdur",
  },
  value: {
    title: "Anbar dəyəri",
    live: "canlı",
    byType: "Son alış qiyməti ilə",
  },
  suppliers: {
    title: "Təchizatçılar",
    open: "Təchizatçılar",
    add: "Təchizatçı əlavə et",
    edit: "Redaktə et",
    name: "Ad",
    code: "Kod",
    codeHint: "Boş qalsa addan yaranır",
    contact: "Əlaqə",
    phone: "Telefon (WhatsApp)",
    phonePlaceholder: "+994 50 123 45 67",
    phoneHint: "Sifariş bu nömrəyə WhatsApp ilə gedir",
    email: "E-poçt",
    days: "Çatdırılma günləri",
    noDays: "Gün seçilməyib",
    branch: "Filial",
    allBranches: "Bütün filiallar",
    leadTime: "Hazırlıq müddəti, gün",
    inactive: "Deaktiv",
    deactivate: "Deaktiv et",
    activate: "Aktiv et",
    save: "Saxla",
    cancel: "Ləğv et",
    working: "Saxlanılır…",
    empty: "Hələ təchizatçı yoxdur",
    saved: "Təchizatçı saxlanıldı",
  },
  orders: {
    title: "Sifarişlər",
    open: "Sifarişlər",
    check: "İndi yoxla",
    checked: (changed) => (changed === 0 ? "Yeni sifariş lazım deyil" : `${changed} qaralama yaradıldı və ya yeniləndi`),
    drafts: "Qaralamalar",
    sent: "Göndərilənlər",
    status: { draft: "Qaralama", sent: "Göndərilib", received: "Qəbul edilib" },
    auto: "Avto",
    approve: "Təsdiq et və göndər",
    receive: "Qəbul edildi",
    discard: "Sil",
    confirmDiscard: "Qaralama silinsin?",
    empty: "Sifariş qaralaması yoxdur",
    noSent: "Göndərilmiş sifariş yoxdur",
    product: "Məhsul",
    qty: "Miqdar",
    contact: "Əlaqə",
    sentAt: "Göndərilib",
    readOnly: "Sifarişləri şef və sahib təsdiqləyir.",
    done: "Hazırdır",
  },
  invite: {
    title: "Şefi dəvət et",
    open: "Dəvət",
    phone: "Telefon",
    phonePlaceholder: "+994 50 123 45 67",
    role: "Rol",
    roles: { chef: "Şef", owner: "Sahib" },
    create: "Link yarat",
    working: "Yaradılır…",
    link: "Dəvət linki",
    copy: "Kopyala",
    copied: "Kopyalandı",
    share: "WhatsApp ilə göndər",
    shareText: (url) => `alovOS-a dəvət: ${url}`,
    expires: (date) => `Bitir: ${date}`,
    history: "Dəvətlər",
    used: "İstifadə olunub",
    expired: "Vaxtı keçib",
    pending: "Gözləyir",
    empty: "Hələ dəvət yoxdur",
    ownerOnly: "Dəvəti yalnız sahib göndərə bilər.",
  },
  accept: {
    title: "Dəvət",
    body: (restaurant, role) => `${restaurant} sizi ${role} kimi dəvət edir.`,
    accept: "Qəbul et",
    signIn: "Daxil ol",
    signUp: "Qeydiyyat",
    needAccount: "Qəbul etmək üçün daxil olun və ya qeydiyyatdan keçin.",
    signUpHint: "Qeydiyyatdan sonra dəvət edən restoranın komandasına qoşulacaqsınız, yeni restoran yaradılmır.",
    openApp: "Anbara keç",
    states: {
      used: "Bu link artıq istifadə olunub.",
      expired: "Linkin vaxtı keçib. Yenisini istəyin.",
      not_found: "Dəvət tapılmadı.",
      joined: (restaurant) => `Siz artıq ${restaurant} komandasındasınız.`,
    },
  },
  owner: {
    title: "Sahib paneli",
    open: "Sahib paneli",
    hint: "Yalnız rəqəmlər: pul, az qalanlar və avtomatik sifarişlər",
    stockValue: "Anbar dəyəri",
    lowStock: "Az qalan məhsullar",
    critical: "Qurtaranlar",
    autoRequests: "Avto sifariş qaralamaları",
    live: "canlı",
    noAccess: "Bu panel sahib və şef üçündür.",
  },
  errors: {
    invalid_input: "Məlumatı yoxlayın",
    unauthenticated: "Yenidən daxil olun",
    no_tenant: "Təşkilat tapılmadı",
    forbidden: "Bu əməliyyat şef və ya sahib üçündür",
    product_not_found: "Məhsul tapılmadı",
    supplier_not_found: "Təchizatçı tapılmadı",
    branch_not_found: "Filial tapılmadı",
    request_not_found: "Sifariş tapılmadı",
    invalid_status: "Sifariş artıq dəyişib, səhifəni yeniləyin",
    duplicate_code: "Bu kod artıq var",
    min_above_par: "Minimum sifariş səviyyəsindən böyük ola bilməz",
    invitation_not_found: "Dəvət tapılmadı",
    invitation_used: "Bu link artıq istifadə olunub",
    invitation_expired: "Linkin vaxtı keçib",
    save_failed: "Saxlamaq alınmadı",
  },
};

export const PURCHASING_RU: PurchasingDictionary = {
  locale: "ru",
  settingsLink: "Настройки",
  limits: {
    button: "Задать лимит",
    title: (product) => `Лимит: ${product}`,
    par: "Пар-уровень",
    parHint: "Сколько должно быть после поставки",
    min: "Минимум",
    minHint: "Пусто — общий минимум из настроек",
    supplier: "Поставщик",
    noSupplier: "Не выбран",
    unit: (unit) => `Единица: ${unit}`,
    save: "Сохранить",
    cancel: "Отмена",
    working: "Сохранение…",
    saved: "Лимит сохранён",
  },
  forecast: {
    title: "Лимиты и прогноз",
    hint: "Остаток, расход в день и прогноз до следующей поставки",
    status: { critical: "🔴 Закончилось", order: "🟡 Заказать", ok: "🟢 OK", no_limits: "Без лимита" },
    nextDelivery: (day) => `Следующая поставка ${day}`,
    willRunOut: "не хватит!",
    orderQty: (qty, days) =>
      days === null ? `Заказать: ${qty}` : `Заказать: ${qty} (осталось ${days} ${ruPlural(days, "день", "дня", "дней")})`,
    projected: (qty) => `Прогноз: ${qty}`,
    usage: (qty) => `В день: ${qty}`,
    onOrder: (qty) => `В пути: ${qty}`,
    noDelivery: "Нет дней поставки",
    stock: "Остаток",
    product: "Товар",
    state: "Состояние",
    all: "Все",
    attention: "Требуют внимания",
    empty: "Нет товаров, требующих внимания",
  },
  value: {
    title: "Стоимость склада",
    live: "онлайн",
    byType: "По последней закупочной цене",
  },
  suppliers: {
    title: "Поставщики",
    open: "Поставщики",
    add: "Добавить поставщика",
    edit: "Изменить",
    name: "Название",
    code: "Код",
    codeHint: "Пусто — из названия",
    contact: "Контакт",
    phone: "Телефон (WhatsApp)",
    phonePlaceholder: "+994 50 123 45 67",
    phoneHint: "На этот номер заказ уходит в WhatsApp",
    email: "Email",
    days: "Дни поставки",
    noDays: "Дни не выбраны",
    branch: "Филиал",
    allBranches: "Все филиалы",
    leadTime: "Срок подготовки, дней",
    inactive: "Неактивен",
    deactivate: "Отключить",
    activate: "Включить",
    save: "Сохранить",
    cancel: "Отмена",
    working: "Сохранение…",
    empty: "Поставщиков пока нет",
    saved: "Поставщик сохранён",
  },
  orders: {
    title: "Заказы",
    open: "Заказы",
    check: "Проверить сейчас",
    checked: (changed) =>
      changed === 0 ? "Новых заказов не нужно" : `Создано или обновлено: ${changed} ${ruPlural(changed, "черновик", "черновика", "черновиков")}`,
    drafts: "Черновики",
    sent: "Отправленные",
    status: { draft: "Черновик", sent: "Отправлен", received: "Получен" },
    auto: "Авто",
    approve: "Утвердить и отправить",
    receive: "Получено",
    discard: "Удалить",
    confirmDiscard: "Удалить черновик?",
    empty: "Черновиков заказов нет",
    noSent: "Отправленных заказов нет",
    product: "Товар",
    qty: "Количество",
    contact: "Контакт",
    sentAt: "Отправлен",
    readOnly: "Заказы утверждают шеф и владелец.",
    done: "Готово",
  },
  invite: {
    title: "Пригласить шефа",
    open: "Приглашение",
    phone: "Телефон",
    phonePlaceholder: "+994 50 123 45 67",
    role: "Роль",
    roles: { chef: "Шеф", owner: "Владелец" },
    create: "Создать ссылку",
    working: "Создание…",
    link: "Ссылка-приглашение",
    copy: "Копировать",
    copied: "Скопировано",
    share: "Отправить в WhatsApp",
    shareText: (url) => `Приглашение в alovOS: ${url}`,
    expires: (date) => `Действует до: ${date}`,
    history: "Приглашения",
    used: "Использовано",
    expired: "Истекло",
    pending: "Ожидает",
    empty: "Приглашений пока нет",
    ownerOnly: "Приглашать может только владелец.",
  },
  accept: {
    title: "Приглашение",
    body: (restaurant, role) => `${restaurant} приглашает вас как: ${role}.`,
    accept: "Принять",
    signIn: "Войти",
    signUp: "Регистрация",
    needAccount: "Чтобы принять, войдите или зарегистрируйтесь.",
    signUpHint: "После регистрации вы попадёте в команду пригласившего ресторана — новый ресторан не создаётся.",
    openApp: "Перейти на склад",
    states: {
      used: "Эта ссылка уже использована.",
      expired: "Срок ссылки истёк. Попросите новую.",
      not_found: "Приглашение не найдено.",
      joined: (restaurant) => `Вы уже в команде ${restaurant}.`,
    },
  },
  owner: {
    title: "Панель владельца",
    open: "Панель владельца",
    hint: "Только цифры: деньги, что заканчивается и автозаказы",
    stockValue: "Стоимость склада",
    lowStock: "Заканчивается",
    critical: "Закончилось",
    autoRequests: "Черновики автозаказов",
    live: "онлайн",
    noAccess: "Панель для владельца и шефа.",
  },
  errors: {
    invalid_input: "Проверьте данные",
    unauthenticated: "Войдите снова",
    no_tenant: "Организация не найдена",
    forbidden: "Действие доступно шефу или владельцу",
    product_not_found: "Товар не найден",
    supplier_not_found: "Поставщик не найден",
    branch_not_found: "Филиал не найден",
    request_not_found: "Заказ не найден",
    invalid_status: "Заказ уже изменён, обновите страницу",
    duplicate_code: "Такой код уже есть",
    min_above_par: "Минимум не может быть больше уровня дозаказа",
    invitation_not_found: "Приглашение не найдено",
    invitation_used: "Ссылка уже использована",
    invitation_expired: "Срок ссылки истёк",
    save_failed: "Не удалось сохранить",
  },
};

export const PURCHASING_EN: PurchasingDictionary = {
  locale: "en",
  settingsLink: "Settings",
  limits: {
    button: "Set limit",
    title: (product) => `Limit: ${product}`,
    par: "Par level",
    parHint: "How much there should be after a delivery",
    min: "Minimum",
    minHint: "Empty uses the default minimum from settings",
    supplier: "Supplier",
    noSupplier: "None",
    unit: (unit) => `Unit: ${unit}`,
    save: "Save",
    cancel: "Cancel",
    working: "Saving…",
    saved: "Limit saved",
  },
  forecast: {
    title: "Limits and forecast",
    hint: "Stock, daily usage and forecast until the next delivery",
    status: { critical: "🔴 Out", order: "🟡 Order", ok: "🟢 OK", no_limits: "No limit" },
    nextDelivery: (day) => `Next delivery ${day}`,
    willRunOut: "won't last!",
    orderQty: (qty, days) => (days === null ? `Order: ${qty}` : `Order: ${qty} (${days} ${days === 1 ? "day" : "days"} left)`),
    projected: (qty) => `Forecast: ${qty}`,
    usage: (qty) => `Per day: ${qty}`,
    onOrder: (qty) => `On order: ${qty}`,
    noDelivery: "No delivery days",
    stock: "Stock",
    product: "Product",
    state: "Status",
    all: "All",
    attention: "Needs attention",
    empty: "Nothing needs attention",
  },
  value: {
    title: "Stock value",
    live: "live",
    byType: "At the latest purchase price",
  },
  suppliers: {
    title: "Suppliers",
    open: "Suppliers",
    add: "Add supplier",
    edit: "Edit",
    name: "Name",
    code: "Code",
    codeHint: "Empty: made from the name",
    contact: "Contact",
    phone: "Phone (WhatsApp)",
    phonePlaceholder: "+994 50 123 45 67",
    phoneHint: "Orders go to this number on WhatsApp",
    email: "Email",
    days: "Delivery days",
    noDays: "No days selected",
    branch: "Branch",
    allBranches: "All branches",
    leadTime: "Lead time, days",
    inactive: "Inactive",
    deactivate: "Deactivate",
    activate: "Activate",
    save: "Save",
    cancel: "Cancel",
    working: "Saving…",
    empty: "No suppliers yet",
    saved: "Supplier saved",
  },
  orders: {
    title: "Orders",
    open: "Orders",
    check: "Check now",
    checked: (changed) => (changed === 0 ? "No new orders needed" : `${changed} draft${changed === 1 ? "" : "s"} created or updated`),
    drafts: "Drafts",
    sent: "Sent",
    status: { draft: "Draft", sent: "Sent", received: "Received" },
    auto: "Auto",
    approve: "Approve and send",
    receive: "Received",
    discard: "Delete",
    confirmDiscard: "Delete this draft?",
    empty: "No draft orders",
    noSent: "No sent orders",
    product: "Product",
    qty: "Quantity",
    contact: "Contact",
    sentAt: "Sent",
    readOnly: "Chefs and owners approve orders.",
    done: "Done",
  },
  invite: {
    title: "Invite a chef",
    open: "Invite",
    phone: "Phone",
    phonePlaceholder: "+994 50 123 45 67",
    role: "Role",
    roles: { chef: "Chef", owner: "Owner" },
    create: "Create link",
    working: "Creating…",
    link: "Invitation link",
    copy: "Copy",
    copied: "Copied",
    share: "Send via WhatsApp",
    shareText: (url) => `Invitation to alovOS: ${url}`,
    expires: (date) => `Expires: ${date}`,
    history: "Invitations",
    used: "Used",
    expired: "Expired",
    pending: "Pending",
    empty: "No invitations yet",
    ownerOnly: "Only the owner can invite.",
  },
  accept: {
    title: "Invitation",
    body: (restaurant, role) => `${restaurant} invites you as ${role}.`,
    accept: "Accept",
    signIn: "Sign in",
    signUp: "Sign up",
    needAccount: "Sign in or sign up to accept.",
    signUpHint: "After signing up you join the inviting restaurant's team; no new restaurant is created.",
    openApp: "Go to stock",
    states: {
      used: "This link has already been used.",
      expired: "This link has expired. Ask for a new one.",
      not_found: "Invitation not found.",
      joined: (restaurant) => `You are already on the ${restaurant} team.`,
    },
  },
  owner: {
    title: "Owner panel",
    open: "Owner panel",
    hint: "Numbers only: money, what is running low and automatic orders",
    stockValue: "Stock value",
    lowStock: "Running low",
    critical: "Out of stock",
    autoRequests: "Automatic order drafts",
    live: "live",
    noAccess: "This panel is for owners and chefs.",
  },
  errors: {
    invalid_input: "Check the data",
    unauthenticated: "Sign in again",
    no_tenant: "Organization not found",
    forbidden: "Only a chef or owner can do this",
    product_not_found: "Product not found",
    supplier_not_found: "Supplier not found",
    branch_not_found: "Branch not found",
    request_not_found: "Order not found",
    invalid_status: "The order has changed, reload the page",
    duplicate_code: "This code is taken",
    min_above_par: "The minimum cannot be above the order-up-to level",
    invitation_not_found: "Invitation not found",
    invitation_used: "This link has already been used",
    invitation_expired: "This link has expired",
    save_failed: "Could not save",
  },
};
