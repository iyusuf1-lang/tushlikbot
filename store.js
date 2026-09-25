const fs = require('fs');
const path = require('path');

// Railway'da doimiy Volume ulasangiz, DB_PATH ni o'sha papkaga ko'rsating
// (masalan /app/data/store.json), aks holda qayta deploy qilinganda ma'lumot tozalanadi.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'store.json');

// Saytdan import qilingan taom rasmlari shu yerga yuklab olinadi
// (store.json bilan bir papkada — Volume ulansa, rasmlar ham saqlanib qoladi).
const IMAGES_DIR = path.join(path.dirname(DB_PATH), 'images');

// Boshlang'ich restoran/menyu. Buni botdagi admin buyruqlari orqali
// (/restoran_qoshish, /taom_qoshish, /menyu_import) o'zgartirish mumkin, kodga tegmasdan.
const DEFAULT_RESTAURANTS = [
  {
    id: 1,
    name: "Standart menyu",
    url: null,
    items: [
      { id: 1, name: "Osh", price: 20000, image: null },
      { id: 2, name: "Lag'mon", price: 18000, image: null },
      { id: 3, name: "Shashlik", price: 15000, image: null },
      { id: 4, name: "Manti (5 dona)", price: 15000, image: null },
      { id: 5, name: "Salat", price: 8000, image: null },
      { id: 6, name: "Choy / Kompot", price: 3000, image: null },
    ],
  },
];

// To'lov holatlari
const PAID = 'paid';
const PENDING = 'pending'; // chek yuborilgan, admin tasdiqlashini kutmoqda

// Xotirada saqlab qo'yiladi — har bir so'rovda diskdan qayta o'qimaslik uchun
// (Mini App har 5 soniyada so'rov yuboradi, disk operatsiyasi shart emas).
let cache = null;

// Yetishmayotgan maydonlarni to'ldiradi va eski formatlarni yangisiga o'tkazadi
function normalize(store) {
  // Eski (bitta menyuli) formatdan avtomatik migratsiya
  if (!store.restaurants) {
    store.restaurants = store.menu
      ? [{ id: 1, name: "Standart menyu", url: null, items: store.menu }]
      : DEFAULT_RESTAURANTS;
    store.orders = (store.orders || []).map((o) => ({
      restaurant_id: 1,
      restaurant_name: "Standart menyu",
      ...o,
    }));
    delete store.menu;
  }
  if (!store.orders) store.orders = [];
  if (!store.comments) store.comments = [];
  if (!store.deliveryFees) store.deliveryFees = {};
  if (!store.payments) store.payments = [];
  if (!store.settings) store.settings = {};
  delete store.users; // eski, ishlatilmaydigan maydon
  return store;
}

function load() {
  if (cache) return cache;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const store = fs.existsSync(DB_PATH)
    ? JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
    : { restaurants: DEFAULT_RESTAURANTS };
  save(normalize(store));
  return cache;
}

// Avval vaqtinchalik faylga yozib, keyin almashtiramiz — yozish paytida
// server o'chib qolsa ham store.json buzilmaydi.
function save(store) {
  cache = store;
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function nextId(list) {
  return list.length ? Math.max(...list.map((x) => x.id)) + 1 : 1;
}

// /images/... ko'rinishidagi, bizning serverga yuklab olingan rasmni diskdan o'chiradi
function removeLocalImage(image) {
  if (!image || !image.startsWith('/images/')) return;
  const file = path.join(IMAGES_DIR, path.basename(image));
  fs.promises.unlink(file).catch(() => {});
}

// ---------- Restoranlar ----------

function getRestaurants() {
  return load().restaurants;
}

function getRestaurant(id) {
  return load().restaurants.find((r) => r.id === Number(id)) || null;
}

function addRestaurant(name, url = null) {
  const store = load();
  const restaurant = { id: nextId(store.restaurants), name, url: url || null, items: [] };
  store.restaurants.push(restaurant);
  save(store);
  return restaurant;
}

function setRestaurantUrl(id, url) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(id));
  if (!restaurant) return false;
  restaurant.url = url || null;
  save(store);
  return true;
}

function deleteRestaurant(id) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(id));
  if (!restaurant) return false;
  store.restaurants = store.restaurants.filter((r) => r !== restaurant);
  restaurant.items.forEach((i) => removeLocalImage(i.image));
  save(store);
  return true;
}

function addMenuItem(restaurantId, name, price, image = null) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(restaurantId));
  if (!restaurant) return null;
  const item = { id: nextId(restaurant.items), name, price, image: image || null };
  restaurant.items.push(item);
  save(store);
  return item;
}

// Taomning narxi va/yoki rasmini yangilaydi (faqat berilgan maydonlar o'zgaradi)
function updateMenuItem(restaurantId, itemId, patch) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(restaurantId));
  const item = restaurant?.items.find((i) => i.id === Number(itemId));
  if (!item) return null;
  if (patch.price !== undefined) item.price = patch.price;
  if (patch.image !== undefined) {
    if (item.image !== patch.image) removeLocalImage(item.image);
    item.image = patch.image || null;
  }
  save(store);
  return item;
}

function setMenuItemImage(restaurantId, itemId, image) {
  return !!updateMenuItem(restaurantId, itemId, { image: image || null });
}

function deleteMenuItem(restaurantId, itemId) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(restaurantId));
  const item = restaurant?.items.find((i) => i.id === Number(itemId));
  if (!item) return false;
  restaurant.items = restaurant.items.filter((i) => i !== item);
  removeLocalImage(item.image);
  save(store);
  return true;
}

// ---------- Buyurtmalar ----------

function getOrders(date) {
  return load().orders.filter((o) => o.date === date);
}

// Bitta foydalanuvchining shu kun + shu restoran bo'yicha joriy buyurtma
// tarkibini qaytaradi (Mini App qayta ochilganda "joriy buyurtmangiz" deb
// ko'rsatish uchun ishlatiladi).
function getUserOrderItems(date, userId, restaurantId) {
  return load()
    .orders.filter((o) => o.date === date && o.user_id === userId && o.restaurant_id === Number(restaurantId))
    .map((o) => ({ name: o.item_name, price: o.price, qty: o.qty }));
}

function userHasOrder(date, userId) {
  return load().orders.some((o) => o.date === date && o.user_id === userId);
}

// Foydalanuvchi qayta kirib yana taom tanlasa, buni MAVJUD buyurtmasiga
// QO'SHADI (masalan avval 2 osh bergan, yana 1 osh qo'shsa — natija 3 osh
// bo'ladi). Buyurtma faqat foydalanuvchi "Bekor qilish" tugmasini
// bosgandagina (clearUserOrder) o'chadi.
// newItems server tomonida menyudan olingan bo'lishi shart: [{ name, price, qty }]
function addToUserOrder(date, userId, userName, restaurantId, restaurantName, newItems) {
  const store = load();
  const isMine = (o) => o.date === date && o.user_id === userId && o.restaurant_id === restaurantId;
  const existing = store.orders.filter(isMine);
  const others = store.orders.filter((o) => !isMine(o));

  const merged = {}; // item_name -> { item_name, price, qty }
  for (const row of existing) {
    merged[row.item_name] = { item_name: row.item_name, price: row.price, qty: row.qty };
  }
  for (const item of newItems) {
    if (merged[item.name]) {
      merged[item.name].qty += item.qty;
      merged[item.name].price = item.price; // narx yangilangan bo'lishi mumkin, so'nggisini olamiz
    } else {
      merged[item.name] = { item_name: item.name, price: item.price, qty: item.qty };
    }
  }

  store.orders = others.concat(
    Object.values(merged).map((m) => ({
      date,
      user_id: userId,
      user_name: userName,
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      item_name: m.item_name,
      price: m.price,
      qty: m.qty,
    }))
  );
  save(store);
}

function clearUserOrder(date, userId, restaurantId) {
  const store = load();
  const isMine = (o) => o.date === date && o.user_id === userId && o.restaurant_id === restaurantId;
  store.orders = store.orders.filter((o) => !isMine(o));
  store.comments = store.comments.filter((c) => !isMine(c));
  save(store);
}

// Foydalanuvchining shu kun + shu restorandagi buyurtmasidan FAQAT bitta
// taomni olib tashlaydi, qolgan taomlarga tegmaydi.
function removeItemFromOrder(date, userId, restaurantId, itemName) {
  const store = load();
  const before = store.orders.length;
  store.orders = store.orders.filter(
    (o) =>
      !(o.date === date && o.user_id === userId && o.restaurant_id === restaurantId && o.item_name === itemName)
  );
  const removed = store.orders.length < before;
  if (removed) save(store);
  return removed;
}

// ---------- Izohlar ----------

function getComments(date) {
  return load().comments.filter((c) => c.date === date);
}

// Foydalanuvchining shu kun + shu restoran bo'yicha izohini saqlaydi/almashtiradi.
// Bo'sh matn yuborilsa, izoh olib tashlanadi.
function setUserComment(date, userId, userName, restaurantId, restaurantName, text) {
  const store = load();
  store.comments = store.comments.filter(
    (c) => !(c.date === date && c.user_id === userId && c.restaurant_id === restaurantId)
  );
  const trimmed = (text || '').trim();
  if (trimmed) {
    store.comments.push({
      date,
      user_id: userId,
      user_name: userName,
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      text: trimmed.slice(0, 300),
    });
  }
  save(store);
}

// ---------- Eski ma'lumotlarni tozalash ----------

// Belgilangan kundan eski buyurtma, izoh, to'lov va dastavka yozuvlarini
// o'chiradi (fayl vaqt o'tishi bilan haddan tashqari katta bo'lib
// ketmasligi uchun). Sanalar "YYYY-MM-DD" ko'rinishida bo'lgani uchun
// oddiy satr taqqoslash orqali ham to'g'ri ishlaydi.
function cleanupOldData(daysToKeep) {
  const store = load();
  const cutoff = new Date(Date.now() + 5 * 60 * 60 * 1000); // Toshkent vaqti
  cutoff.setUTCDate(cutoff.getUTCDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let removed = 0;
  for (const key of ['orders', 'comments', 'payments']) {
    const before = store[key].length;
    store[key] = store[key].filter((x) => x.date >= cutoffStr);
    removed += before - store[key].length;
  }
  for (const date of Object.keys(store.deliveryFees)) {
    if (date < cutoffStr) {
      delete store.deliveryFees[date];
      removed++;
    }
  }

  if (removed > 0) save(store);
  return removed;
}

// ---------- Admin: bekor qilish ----------

// Bugungi BARCHA buyurtma va izohlarni tozalaydi (barcha restoranlar, barcha odamlar)
function clearAllOrders(date) {
  const store = load();
  store.orders = store.orders.filter((o) => o.date !== date);
  store.comments = store.comments.filter((c) => c.date !== date);
  save(store);
}

// Bitta odamning shu kungi buyurtmasini BARCHA restoranlar bo'yicha tozalaydi
function clearOrdersForUser(date, userId) {
  const store = load();
  const before = store.orders.length;
  store.orders = store.orders.filter((o) => !(o.date === date && o.user_id === userId));
  store.comments = store.comments.filter((c) => !(c.date === date && c.user_id === userId));
  save(store);
  return store.orders.length < before;
}

// ---------- Yetkazib berish narxi (dastavka) ----------

function setDeliveryFee(date, amount) {
  const store = load();
  if (amount > 0) {
    store.deliveryFees[date] = amount;
  } else {
    delete store.deliveryFees[date];
  }
  save(store);
}

function getDeliveryFee(date) {
  return load().deliveryFees[date] || 0;
}

// ---------- To'lov holati ----------

// status: PAID, PENDING yoki null (to'lanmagan)
function setPaymentStatus(date, userId, status) {
  const store = load();
  store.payments = store.payments.filter((p) => !(p.date === date && p.user_id === userId));
  if (status) store.payments.push({ date, user_id: userId, status });
  save(store);
}

// user_id -> 'paid' | 'pending'. Eski yozuvlarda status yo'q — ular to'langan hisoblanadi.
function getPaymentStatuses(date) {
  const map = {};
  for (const p of load().payments) {
    if (p.date === date) map[p.user_id] = p.status || PAID;
  }
  return map;
}

// ---------- Umumiy sozlamalar (karta, eslatma) ----------

function getSettings() {
  return load().settings;
}

function updateSettings(patch) {
  const store = load();
  store.settings = { ...store.settings, ...patch };
  save(store);
  return store.settings;
}

module.exports = {
  IMAGES_DIR,
  PAID,
  PENDING,
  getRestaurants,
  getRestaurant,
  addRestaurant,
  setRestaurantUrl,
  deleteRestaurant,
  addMenuItem,
  updateMenuItem,
  setMenuItemImage,
  deleteMenuItem,
  getOrders,
  getUserOrderItems,
  userHasOrder,
  addToUserOrder,
  clearUserOrder,
  removeItemFromOrder,
  getComments,
  setUserComment,
  clearAllOrders,
  cleanupOldData,
  clearOrdersForUser,
  setDeliveryFee,
  getDeliveryFee,
  setPaymentStatus,
  getPaymentStatuses,
  getSettings,
  updateSettings,
};
