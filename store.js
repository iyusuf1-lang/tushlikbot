const fs = require('fs');
const path = require('path');

// Railway'da doimiy Volume ulasangiz, DB_PATH ni o'sha papkaga ko'rsating
// (masalan /app/data/store.json), aks holda qayta deploy qilinganda ma'lumot tozalanadi.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'store.json');

// Boshlang'ich restoran/menyu. Buni endi botdagi admin buyruqlari orqali
// (/restoran_qoshish, /taom_qoshish, /restoran_sayt) o'zgartirish mumkin, kodga tegmasdan.
const DEFAULT_RESTAURANTS = [
  {
    id: 1,
    name: "Standart menyu",
    url: null,
    items: [
      { id: 1, name: "Osh", price: 20000 },
      { id: 2, name: "Lag'mon", price: 18000 },
      { id: 3, name: "Shashlik", price: 15000 },
      { id: 4, name: "Manti (5 dona)", price: 15000 },
      { id: 5, name: "Salat", price: 8000 },
      { id: 6, name: "Choy / Kompot", price: 3000 },
    ],
  },
];

function ensureStore() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ restaurants: DEFAULT_RESTAURANTS, orders: [], comments: [] }, null, 2));
  }
}

function load() {
  ensureStore();
  const store = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  if (!store.comments) store.comments = [];

  // Eski (bitta menyuli) formatdan avtomatik migratsiya
  if (!store.restaurants && store.menu) {
    const migrated = {
      restaurants: [{ id: 1, name: "Standart menyu", url: null, items: store.menu }],
      orders: (store.orders || []).map((o) => ({
        ...o,
        restaurant_id: 1,
        restaurant_name: "Standart menyu",
      })),
    };
    save(migrated);
    return migrated;
  }
  return store;
}

function save(store) {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function nextId(list) {
  return list.length ? Math.max(...list.map((x) => x.id)) + 1 : 1;
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
  const before = store.restaurants.length;
  store.restaurants = store.restaurants.filter((r) => r.id !== Number(id));
  save(store);
  return store.restaurants.length < before;
}

function addMenuItem(restaurantId, name, price) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(restaurantId));
  if (!restaurant) return null;
  const item = { id: nextId(restaurant.items), name, price };
  restaurant.items.push(item);
  save(store);
  return item;
}

function deleteMenuItem(restaurantId, itemId) {
  const store = load();
  const restaurant = store.restaurants.find((r) => r.id === Number(restaurantId));
  if (!restaurant) return false;
  const before = restaurant.items.length;
  restaurant.items = restaurant.items.filter((i) => i.id !== Number(itemId));
  save(store);
  return restaurant.items.length < before;
}

// ---------- Buyurtmalar ----------

function getOrders(date) {
  return load().orders.filter((o) => o.date === date);
}

// Foydalanuvchining shu kun + shu restoran bo'yicha buyurtmasini almashtiradi.
// Boshqa restoranlardagi buyurtmalariga tegmaydi — bir kunda bir nechta
// restorandan buyurtma berish mumkin.
function replaceUserOrder(date, userId, userName, restaurantId, restaurantName, items) {
  const store = load();
  store.orders = store.orders.filter(
    (o) => !(o.date === date && o.user_id === userId && o.restaurant_id === restaurantId)
  );
  for (const item of items) {
    if (item.qty > 0) {
      store.orders.push({
        date,
        user_id: userId,
        user_name: userName,
        restaurant_id: restaurantId,
        restaurant_name: restaurantName,
        item_name: item.name,
        price: item.price,
        qty: item.qty,
      });
    }
  }
  save(store);
}

function clearUserOrder(date, userId, restaurantId) {
  const store = load();
  store.orders = store.orders.filter(
    (o) => !(o.date === date && o.user_id === userId && o.restaurant_id === restaurantId)
  );
  store.comments = store.comments.filter(
    (c) => !(c.date === date && c.user_id === userId && c.restaurant_id === restaurantId)
  );
  save(store);
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

module.exports = {
  getRestaurants,
  getRestaurant,
  addRestaurant,
  setRestaurantUrl,
  deleteRestaurant,
  addMenuItem,
  deleteMenuItem,
  getOrders,
  replaceUserOrder,
  clearUserOrder,
  getComments,
  setUserComment,
};
