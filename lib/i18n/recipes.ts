import type { TechCardErrorCode } from "@/lib/recipes/model";
import type { SaleErrorCode } from "@/lib/recipes/sales";

export type TechCardEditorDictionary = {
  listTitle: string;
  listSubtitle: string;
  newCard: string;
  newTitle: string;
  back: string;
  columns: { name: string; category: string; cost: string; salePrice: string; foodCost: string; margin: string };
  missingPrices: (missing: number, total: number) => string;
  name: string;
  category: string;
  salePrice: string;
  yieldQty: string;
  yieldUnit: string;
  ingredients: string;
  perPortion: string;
  addIngredient: string;
  product: string;
  pickProduct: string;
  brutto: string;
  netto: string;
  waste: string;
  priceLot: string;
  latestPrice: string;
  unitPrice: string;
  lineCost: string;
  noPrice: string;
  remove: string;
  save: string;
  saved: string;
  delete: string;
  deleteConfirm: string;
  summary: string;
  cost: string;
  foodCost: string;
  margin: string;
  costNote: string;
  nettoAboveBrutto: string;
  sources: { price_lot: string; latest_lot: string; product: string };
  errors: Record<TechCardErrorCode, string>;
};

export type RecipesDictionary = {
  editor: TechCardEditorDictionary;
  title: string;
  subtitle: string;
  empty: string;
  back: string;
  ingredients: string;
  noIngredients: string;
  cooking_batch: string;
  deduct_preview: string;
  deduct_success: string;
  insufficient_stock_warning: (product: string, shortage: string) => string;
  portions: string;
  branch: string;
  noBranches: string;
  table: { product: string; net: string; waste: string; gross: string };
  confirm: string;
  cancel: string;
  close: string;
  errors: Record<SaleErrorCode, string>;
};

export const RECIPES_AZ: RecipesDictionary = {
  editor: {
    listTitle: "Texnoloji kartlar",
    listSubtitle: "Reseptlər, maya dəyəri və food cost canlı olaraq son qiymətlərlə.",
    newCard: "Yeni kart",
    newTitle: "Yeni texnoloji kart",
    back: "Kartlara qayıt",
    columns: { name: "Ad", category: "Kateqoriya", cost: "Maya", salePrice: "Satış qiyməti", foodCost: "Food cost", margin: "Marja" },
    missingPrices: (missing, total) => `${total} inqrediyentdən ${missing}-nin qiyməti yoxdur`,
    name: "Adı",
    category: "Kateqoriya",
    salePrice: "Satış qiyməti",
    yieldQty: "Çıxış (1 porsiya)",
    yieldUnit: "Vahid",
    ingredients: "İnqrediyentlər",
    perPortion: "1 porsiya üçün, məhsulun vahidində",
    addIngredient: "İnqrediyent əlavə et",
    product: "Məhsul",
    pickProduct: "Məhsul seçin",
    brutto: "Brutto",
    netto: "Netto",
    waste: "İtki, %",
    priceLot: "Qiymət",
    latestPrice: "Son qiymət",
    unitPrice: "Vahid qiyməti",
    lineCost: "Maya",
    noPrice: "qiymət yoxdur",
    remove: "Sil",
    save: "Yadda saxla",
    saved: "Kart yadda saxlanıldı",
    delete: "Kartı sil",
    deleteConfirm: "Kart silinsin? Bunu geri qaytarmaq olmaz.",
    summary: "Porsiyanın iqtisadiyyatı",
    cost: "Maya dəyəri",
    foodCost: "Food cost",
    margin: "Marja",
    costNote: "Maya brutto üzrə hesablanır: son partiyanın qiyməti, seçilmiş partiya və ya məhsulun qiyməti.",
    nettoAboveBrutto: "Netto bruttodan çox ola bilməz",
    sources: { price_lot: "seçilmiş partiya", latest_lot: "son partiya", product: "məhsul qiyməti" },
    errors: {
      invalid_input: "Məlumatları yoxlayın: ad, brutto və netto (netto ≤ brutto).",
      forbidden: "Bunun üçün icazəniz yoxdur.",
      recipe_not_found: "Texnoloji kart tapılmadı.",
      product_not_found: "Məhsul tapılmadı.",
      duplicate_product: "Bir məhsul kartda iki dəfə ola bilməz.",
      no_tenant: "Restoran tapılmadı.",
      unauthenticated: "Yenidən daxil olun.",
      save_failed: "Yadda saxlamaq alınmadı. Yenidən cəhd edin.",
    },
  },
  title: "Texnoloji kartlar",
  subtitle: "Resept üzrə hazırlanmış porsiyaların inqrediyentlərini anbardan silin.",
  empty: "Hələ texnoloji kart yoxdur.",
  back: "Kartlara qayıt",
  ingredients: "İnqrediyentlər",
  noIngredients: "Bu kartda inqrediyent yoxdur.",
  cooking_batch: "🍳 Hazırlığı sil",
  deduct_preview: "Silinəcək",
  deduct_success: "Partiya silindi",
  insufficient_stock_warning: (product, shortage) => `Anbarda çatışmazlıq: ${product} — ${shortage}`,
  portions: "Porsiya sayı",
  branch: "Filial",
  noBranches: "Əvvəlcə filial əlavə edin.",
  table: { product: "Məhsul", net: "Netto / porsiya", waste: "İtki, %", gross: "Cəmi silinəcək" },
  confirm: "Sil",
  cancel: "Ləğv et",
  close: "Bağla",
  errors: {
    invalid_input: "Məlumatları yoxlayın.",
    forbidden: "Silmək üçün icazəniz yoxdur.",
    branch_not_found: "Filial tapılmadı.",
    recipe_not_found: "Texnoloji kart tapılmadı.",
    no_tenant: "Restoran tapılmadı.",
    save_failed: "Silmək alınmadı. Yenidən cəhd edin.",
  },
};

export const RECIPES_RU: RecipesDictionary = {
  editor: {
    listTitle: "Техкарты",
    listSubtitle: "Рецептуры, себестоимость и food cost вживую по последним ценам.",
    newCard: "Новая техкарта",
    newTitle: "Новая техкарта",
    back: "К техкартам",
    columns: { name: "Название", category: "Категория", cost: "Себестоимость", salePrice: "Цена продажи", foodCost: "Food cost", margin: "Маржа" },
    missingPrices: (missing, total) => `Нет цены у ${missing} из ${total} ингредиентов`,
    name: "Название",
    category: "Категория",
    salePrice: "Цена продажи",
    yieldQty: "Выход (1 порция)",
    yieldUnit: "Ед.",
    ingredients: "Ингредиенты",
    perPortion: "На 1 порцию, в единице продукта",
    addIngredient: "Добавить ингредиент",
    product: "Продукт",
    pickProduct: "Выберите продукт",
    brutto: "Брутто",
    netto: "Нетто",
    waste: "Отход, %",
    priceLot: "Цена",
    latestPrice: "Последняя цена",
    unitPrice: "Цена за ед.",
    lineCost: "Стоимость",
    noPrice: "нет цены",
    remove: "Удалить",
    save: "Сохранить",
    saved: "Техкарта сохранена",
    delete: "Удалить техкарту",
    deleteConfirm: "Удалить техкарту? Это нельзя отменить.",
    summary: "Экономика порции",
    cost: "Себестоимость",
    foodCost: "Food cost",
    margin: "Маржа",
    costNote: "Себестоимость считается по брутто: цена последней партии, выбранной партии или цена продукта.",
    nettoAboveBrutto: "Нетто не может быть больше брутто",
    sources: { price_lot: "выбранная партия", latest_lot: "последняя партия", product: "цена продукта" },
    errors: {
      invalid_input: "Проверьте данные: название, брутто и нетто (нетто ≤ брутто).",
      forbidden: "Нет прав на это действие.",
      recipe_not_found: "Техкарта не найдена.",
      product_not_found: "Продукт не найден.",
      duplicate_product: "Один продукт не может быть в техкарте дважды.",
      no_tenant: "Ресторан не найден.",
      unauthenticated: "Войдите заново.",
      save_failed: "Не удалось сохранить. Попробуйте ещё раз.",
    },
  },
  title: "Техкарты",
  subtitle: "Списывайте со склада ингредиенты приготовленных порций по рецептуре.",
  empty: "Техкарт пока нет.",
  back: "К техкартам",
  ingredients: "Ингредиенты",
  noIngredients: "В техкарте нет ингредиентов.",
  cooking_batch: "🍳 Списать приготовление",
  deduct_preview: "Будет списано",
  deduct_success: "Партия списана",
  insufficient_stock_warning: (product, shortage) => `Нехватка на складе: ${product} — ${shortage}`,
  portions: "Количество порций",
  branch: "Филиал",
  noBranches: "Сначала добавьте филиал.",
  table: { product: "Продукт", net: "Нетто / порция", waste: "Отход, %", gross: "Всего спишется" },
  confirm: "Списать",
  cancel: "Отмена",
  close: "Закрыть",
  errors: {
    invalid_input: "Проверьте данные.",
    forbidden: "Нет прав на списание.",
    branch_not_found: "Филиал не найден.",
    recipe_not_found: "Техкарта не найдена.",
    no_tenant: "Ресторан не найден.",
    save_failed: "Не удалось списать. Попробуйте ещё раз.",
  },
};

export const RECIPES_EN: RecipesDictionary = {
  editor: {
    listTitle: "Recipe cards",
    listSubtitle: "Recipes, live cost and food cost from the latest prices.",
    newCard: "New card",
    newTitle: "New recipe card",
    back: "Back to recipe cards",
    columns: { name: "Name", category: "Category", cost: "Cost", salePrice: "Sale price", foodCost: "Food cost", margin: "Margin" },
    missingPrices: (missing, total) => `${missing} of ${total} ingredients have no price`,
    name: "Name",
    category: "Category",
    salePrice: "Sale price",
    yieldQty: "Yield (1 portion)",
    yieldUnit: "Unit",
    ingredients: "Ingredients",
    perPortion: "Per portion, in the product's unit",
    addIngredient: "Add ingredient",
    product: "Product",
    pickProduct: "Choose a product",
    brutto: "Gross",
    netto: "Net",
    waste: "Waste, %",
    priceLot: "Price",
    latestPrice: "Latest price",
    unitPrice: "Unit price",
    lineCost: "Cost",
    noPrice: "no price",
    remove: "Remove",
    save: "Save",
    saved: "Recipe card saved",
    delete: "Delete card",
    deleteConfirm: "Delete this card? This cannot be undone.",
    summary: "Portion economics",
    cost: "Cost",
    foodCost: "Food cost",
    margin: "Margin",
    costNote: "Cost uses the gross quantity at the latest lot price, a chosen lot or the product price.",
    nettoAboveBrutto: "Net cannot exceed gross",
    sources: { price_lot: "chosen lot", latest_lot: "latest lot", product: "product price" },
    errors: {
      invalid_input: "Check the data: name, gross and net (net ≤ gross).",
      forbidden: "You are not allowed to do this.",
      recipe_not_found: "Recipe card not found.",
      product_not_found: "Product not found.",
      duplicate_product: "A product can be on the card only once.",
      no_tenant: "Restaurant not found.",
      unauthenticated: "Sign in again.",
      save_failed: "Could not save. Try again.",
    },
  },
  title: "Recipe cards",
  subtitle: "Write off the ingredients of cooked portions from stock by recipe.",
  empty: "No recipe cards yet.",
  back: "Back to recipe cards",
  ingredients: "Ingredients",
  noIngredients: "This card has no ingredients.",
  cooking_batch: "🍳 Deduct cooking batch",
  deduct_preview: "Will deduct",
  deduct_success: "Batch deducted",
  insufficient_stock_warning: (product, shortage) => `Insufficient stock: ${product}, shortage ${shortage}`,
  portions: "Portions",
  branch: "Branch",
  noBranches: "Add a branch first.",
  table: { product: "Product", net: "Net / portion", waste: "Waste, %", gross: "Total to deduct" },
  confirm: "Deduct",
  cancel: "Cancel",
  close: "Close",
  errors: {
    invalid_input: "Check the data.",
    forbidden: "You are not allowed to write off stock.",
    branch_not_found: "Branch not found.",
    recipe_not_found: "Recipe card not found.",
    no_tenant: "Restaurant not found.",
    save_failed: "Could not write off. Try again.",
  },
};
