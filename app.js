const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

let menu = [];
const qtyMap = {};
let pollTimer = null;

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

function renderTodayLabel() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000); // Toshkent, UTC+5
  const d = now.getUTCDate();
  const m = now.getUTCMonth() + 1;
  const weekday = WEEKDAYS[now.getUTCDay()];
  document.getElementById('today-date').textContent = `${weekday}, ${d}.${m < 10 ? '0' + m : m}`;
}

async function loadMenu() {
  const res = await fetch('/api/menu');
  menu = await res.json();
  menu.forEach((item) => { if (!(item.id in qtyMap)) qtyMap[item.id] = 0; });
  renderMenu();
}

function renderMenu() {
  const list = document.getElementById('menu-list');
  list.innerHTML = '';
  menu.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'menu-item';
    row.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="price">${formatSom(item.price)}</div>
      </div>
      <div class="stepper">
        <button type="button" data-id="${item.id}" data-action="minus" aria-label="Kamaytirish">−</button>
        <span id="qty-${item.id}">${qtyMap[item.id]}</span>
        <button type="button" data-id="${item.id}" data-action="plus" aria-label="Ko'paytirish">+</button>
      </div>
    `;
    list.appendChild(row);
  });
  updateMyTotal();
}

document.getElementById('menu-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'plus') qtyMap[id] += 1;
  if (btn.dataset.action === 'minus') qtyMap[id] = Math.max(0, qtyMap[id] - 1);
  document.getElementById(`qty-${id}`).textContent = qtyMap[id];
  updateMyTotal();
});

function updateMyTotal() {
  let total = 0;
  menu.forEach((item) => { total += item.price * (qtyMap[item.id] || 0); });
  document.getElementById('my-total').textContent = formatSom(total);
}

async function loadOrders() {
  const res = await fetch('/api/orders');
  const data = await res.json();
  const body = document.getElementById('orders-body');

  if (!data.users.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="3">Hali hech kim buyurtma bermadi</td></tr>';
  } else {
    body.innerHTML = data.users
      .map((u) => {
        const itemsText = u.items.map((i) => `${escapeHtml(i.name)} ×${i.qty}`).join(', ');
        return `<tr><td>${escapeHtml(u.user_name)}</td><td>${itemsText}</td><td class="num">${formatSom(u.total)}</td></tr>`;
      })
      .join('');
  }

  document.getElementById('grand-total').textContent = formatSom(data.grandTotal);
}

function formatSom(n) {
  return `${n.toLocaleString('ru-RU')} so'm`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  setTimeout(() => { el.textContent = ''; el.classList.remove('error'); }, 2500);
}

document.getElementById('submit-btn').addEventListener('click', async () => {
  const items = menu
    .filter((item) => qtyMap[item.id] > 0)
    .map((item) => ({ name: item.name, price: item.price, qty: qtyMap[item.id] }));

  if (!items.length) {
    showStatus("Avval kamida bitta taom tanlang", true);
    return;
  }

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg?.initData || '', items }),
    });
    if (!res.ok) throw new Error();
    tg?.HapticFeedback?.notificationOccurred('success');
    showStatus('Buyurtma yuborildi ✓');
    loadOrders();
  } catch {
    showStatus('Xatolik: Mini App Telegram ichida ochilishi kerak', true);
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/order', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg?.initData || '' }),
    });
    if (!res.ok) throw new Error();
    menu.forEach((item) => { qtyMap[item.id] = 0; });
    renderMenu();
    showStatus('Buyurtma bekor qilindi');
    loadOrders();
  } catch {
    showStatus('Xatolik yuz berdi', true);
  }
});

renderTodayLabel();
loadMenu();
loadOrders();
pollTimer = setInterval(loadOrders, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(pollTimer); }
  else { loadOrders(); pollTimer = setInterval(loadOrders, 5000); }
});
