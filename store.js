const fs = require('fs');
const path = require('path');

// Railway'da doimiy Volume ulasangiz, DB_PATH ni o'sha papkaga ko'rsating
// (masalan /app/data/store.json), aks holda qayta deploy qilinganda ma'lumot tozalanadi.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'store.json');

// Boshlang'ich menyu. Xohlagancha o'zgartiring yoki keyinroq data/store.json faylidan
// to'g'ridan-to'g'ri tahrirlang.
const DEFAULT_MENU = [
  { id: 1, name: "Osh", price: 20000 },
  { id: 2, name: "Lag'mon", price: 18000 },
  { id: 3, name: "Shashlik", price: 15000 },
  { id: 4, name: "Manti (5 dona)", price: 15000 },
  { id: 5, name: "Salat", price: 8000 },
  { id: 6, name: "Choy / Kompot", price: 3000 },
];

function ensureStore() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ menu: DEFAULT_MENU, orders: [] }, null, 2));
  }
}

function load() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function save(store) {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function getMenu() {
  return load().menu;
}

function getOrders(date) {
  return load().orders.filter((o) => o.date === date);
}

// Foydalanuvchining shu kungi buyurtmasini butunlay almashtiradi
// (qayta yuborilsa, eskisi o'chib, yangisi yoziladi).
function replaceUserOrder(date, userId, userName, items) {
  const store = load();
  store.orders = store.orders.filter((o) => !(o.date === date && o.user_id === userId));
  for (const item of items) {
    if (item.qty > 0) {
      store.orders.push({
        date,
        user_id: userId,
        user_name: userName,
        item_name: item.name,
        price: item.price,
        qty: item.qty,
      });
    }
  }
  save(store);
}

function clearUserOrder(date, userId) {
  const store = load();
  store.orders = store.orders.filter((o) => !(o.date === date && o.user_id === userId));
  save(store);
}

module.exports = { getMenu, getOrders, replaceUserOrder, clearUserOrder };
