const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

let restaurants = [];
let currentRestaurant = null; // { id, name, url, items }
const qtyMap = {};
let pollTimer = null;

// Admin/holat ma'lumotlari — /api/bootstrap orqali bir marta olinadi
let appState = { isAdmin: false };

function getInitData() {
  return tg?.initData || '';
}

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

function renderTodayLabel() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000); // Toshkent, UTC+5
  const d = now.getUTCDate();
  const m = now.getUTCMonth() + 1;
  const weekday = WEEKDAYS[now.getUTCDay()];
  document.getElementById('today-date').textContent = `${weekday}, ${d}.${m < 10 ? '0' + m : m}`;
}

function formatSom(n) {
  return `${n.toLocaleString('ru-RU')} so'm`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openExternal(url) {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

function showStatusIn(elId, msg, isError) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  setTimeout(() => { el.textContent = ''; el.classList.remove('error'); }, 2500);
}

function showStatus(msg, isError) {
  showStatusIn('status', msg, isError);
}

function showAdminStatus(msg, isError) {
  showStatusIn('admin-status', msg, isError);
}

// ---------- 1-ekran: restoranlar ----------

async function loadRestaurants() {
  const res = await fetch('/api/restaurants');
  restaurants = await res.json();
  renderRestaurantList();
}

function renderRestaurantList() {
  const list = document.getElementById('restaurant-list');
  if (!restaurants.length) {
    list.innerHTML = '<p class="empty-note">Hozircha restoranlar qo\'shilmagan.</p>';
    return;
  }
  list.innerHTML = restaurants
    .map(
      (r) => `
      <div class="restaurant-card">
        <div class="restaurant-main" data-action="open" data-id="${r.id}">
          <div>
            <div class="r-name">${escapeHtml(r.name)}</div>
            <div class="r-count">${r.itemCount} ta taom</div>
          </div>
          <span class="r-arrow">→</span>
        </div>
        ${r.url ? `<button type="button" class="site-link-btn" data-url="${escapeHtml(r.url)}">🔗 Saytdagi menyu</button>` : ''}
      </div>
    `
    )
    .join('');
}

document.getElementById('restaurant-list').addEventListener('click', (e) => {
  const siteBtn = e.target.closest('.site-link-btn');
  if (siteBtn) {
    openExternal(siteBtn.dataset.url);
    return;
  }
  const main = e.target.closest('.restaurant-main');
  if (main) openRestaurant(Number(main.dataset.id));
});

async function openRestaurant(id) {
  const res = await fetch(`/api/restaurants/${id}/menu`);
  if (!res.ok) return;
  currentRestaurant = await res.json();
  currentRestaurant.items.forEach((item) => { qtyMap[item.id] = 0; });

  document.getElementById('restaurant-section').hidden = true;
  document.getElementById('menu-section').hidden = false;
  document.getElementById('menu-restaurant-name').textContent = currentRestaurant.name;

  const siteRow = document.getElementById('menu-site-link');
  if (currentRestaurant.url) {
    siteRow.hidden = false;
    siteRow.querySelector('button').dataset.url = currentRestaurant.url;
  } else {
    siteRow.hidden = true;
  }

  document.getElementById('comment-input').value = '';
  document.getElementById('menu-search').value = '';

  loadCurrentOrderNote(id);

  renderMenu();
}

document.getElementById('menu-search').addEventListener('input', renderMenu);

document.getElementById('back-btn').addEventListener('click', () => {
  currentRestaurant = null;
  document.getElementById('menu-search').value = '';
  document.getElementById('menu-section').hidden = true;
  document.getElementById('restaurant-section').hidden = false;
});

document.getElementById('menu-site-link').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn?.dataset.url) openExternal(btn.dataset.url);
});

// ---------- 2-ekran: menyu ----------

async function loadCurrentOrderNote(restaurantId) {
  const note = document.getElementById('current-order-note');
  note.hidden = true;
  try {
    const res = await fetch(`/api/my-order/${restaurantId}?initData=${encodeURIComponent(getInitData())}`);
    const data = await res.json();
    if (!data.items || !data.items.length) return;
    const text = data.items.map((i) => `${i.name} ×${i.qty}`).join(', ');
    note.textContent = `✅ Sizning joriy buyurtmangiz: ${text}. Pastda tanlagan taomlaringiz shu buyurtmaga QO'SHILADI.`;
    note.hidden = false;
  } catch {
    // jim, muhim emas
  }
}

function renderMenu() {
  const query = document.getElementById('menu-search').value.trim().toLowerCase();
  const list = document.getElementById('menu-list');
  const emptyNote = document.getElementById('menu-empty-note');
  list.innerHTML = '';

  const filtered = query
    ? currentRestaurant.items.filter((item) => item.name.toLowerCase().includes(query))
    : currentRestaurant.items;

  emptyNote.hidden = filtered.length > 0;

  filtered.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'menu-item';
    const thumb = item.image
      ? `<img class="item-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy" />`
      : '<div class="item-thumb item-thumb-empty">🍽</div>';
    row.innerHTML = `
      ${thumb}
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
  currentRestaurant.items.forEach((item) => { total += item.price * (qtyMap[item.id] || 0); });
  document.getElementById('my-total').textContent = formatSom(total);
}

document.getElementById('submit-btn').addEventListener('click', async () => {
  const items = currentRestaurant.items
    .filter((item) => qtyMap[item.id] > 0)
    .map((item) => ({ name: item.name, price: item.price, qty: qtyMap[item.id] }));
  const comment = document.getElementById('comment-input').value.trim();

  if (!items.length && !comment) {
    showStatus("Taom tanlang yoki izoh yozing", true);
    return;
  }

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData(), restaurant_id: currentRestaurant.id, items, comment }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showStatus(data.error || 'Xatolik yuz berdi', true);
      return;
    }
    tg?.HapticFeedback?.notificationOccurred('success');
    showStatus('Buyurtma yuborildi ✓');
    loadOrders();
  } catch {
    showStatus('Xatolik: Mini App Telegram ichida ochilishi kerak', true);
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!currentRestaurant) return;
  try {
    const res = await fetch('/api/order', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData(), restaurant_id: currentRestaurant.id }),
    });
    if (!res.ok) throw new Error();
    currentRestaurant.items.forEach((item) => { qtyMap[item.id] = 0; });
    document.getElementById('comment-input').value = '';
    renderMenu();
    showStatus('Buyurtma bekor qilindi');
    loadOrders();
  } catch {
    showStatus('Xatolik yuz berdi', true);
  }
});

// ---------- Umumiy jadval (restoran bo'yicha guruhlangan) ----------

async function loadOrders() {
  const res = await fetch('/api/orders');
  renderOrders(await res.json());
}

function renderOrders(data) {
  const container = document.getElementById('orders-container');
  const grandRow = document.getElementById('grand-total-row');
  const deliveryNote = document.getElementById('delivery-note');
  const finalBreakdown = document.getElementById('final-breakdown');

  if (!data.restaurants.length) {
    container.innerHTML = '<p class="empty-note" id="empty-note">Hali hech kim buyurtma bermadi</p>';
    grandRow.hidden = true;
    deliveryNote.hidden = true;
    finalBreakdown.hidden = true;
    return;
  }

  container.innerHTML = data.restaurants
    .map((rest) => {
      const rows = rest.users
        .map((u) => {
          const itemsText = u.items.length
            ? u.items.map((i) => `${escapeHtml(i.name)} ×${i.qty}`).join(', ')
            : '<span class="no-items">(taom tanlamagan)</span>';
          const commentRow = u.comment
            ? `<tr class="comment-row"><td></td><td colspan="2">💬 ${escapeHtml(u.comment)}</td></tr>`
            : '';
          return `<tr><td>${escapeHtml(u.user_name)}</td><td>${itemsText}</td><td class="num">${formatSom(u.total)}</td></tr>${commentRow}`;
        })
        .join('');
      return `
        <div class="restaurant-block">
          <div class="restaurant-block-header">
            <span class="rb-name">${escapeHtml(rest.restaurant_name)}</span>
            <span class="rb-subtotal">${formatSom(rest.subtotal)}</span>
          </div>
          <table>
            <thead><tr><th>Ism</th><th>Taomlar</th><th class="num">Summa</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    })
    .join('');

  if (data.deliveryFee > 0 && data.payingCount > 0) {
    deliveryNote.hidden = false;
    deliveryNote.textContent =
      `🚚 Yetkazib berish: ${formatSom(data.deliveryFee)} — ${data.payingCount} kishiga, ` +
      `har biriga ${formatSom(data.deliveryPerPerson)}`;
  } else {
    deliveryNote.hidden = true;
  }

  if (data.userSummaries.length) {
    finalBreakdown.hidden = false;
    document.getElementById('final-breakdown-body').innerHTML = data.userSummaries
      .map((u) => {
        const paidCell = appState.isAdmin
          ? `<button type="button" class="paid-toggle ${u.paid ? 'is-paid' : 'is-unpaid'}" data-user-id="${u.user_id}" data-paid="${u.paid}">${u.paid ? '✅' : '❌'}</button>`
          : `<span class="paid-badge">${u.paid ? '✅' : '❌'}</span>`;
        return `
          <tr>
            <td>${escapeHtml(u.user_name)}</td>
            <td class="num">${formatSom(u.foodTotal)}</td>
            <td class="num">${formatSom(u.deliveryShare)}</td>
            <td class="num">${formatSom(u.finalTotal)}</td>
            <td class="num">${paidCell}</td>
          </tr>`;
      })
      .join('');
  } else {
    finalBreakdown.hidden = true;
  }

  document.getElementById('grand-total').textContent = formatSom(data.grandTotal);
  grandRow.hidden = false;
}

document.getElementById('final-breakdown-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('.paid-toggle');
  if (!btn) return;
  const userId = Number(btn.dataset.userId);
  const newPaid = btn.dataset.paid !== 'true';
  try {
    const res = await fetch('/api/admin/toggle-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData(), user_id: userId, paid: newPaid }),
    });
    if (!res.ok) throw new Error();
    loadOrders();
  } catch {
    showAdminStatus("To'lov holatini o'zgartirib bo'lmadi", true);
  }
});

// Ilk yuklanishda restoranlar ro'yxati + bugungi jadvalni BITTA so'rov bilan olamiz
// (ikkita alohida fetch o'rniga) — sekin tarmoqlarda ochilish tezligini oshiradi.
async function loadBootstrap() {
  try {
    const res = await fetch('/api/bootstrap?initData=' + encodeURIComponent(getInitData()));
    const data = await res.json();
    restaurants = data.restaurants;
    appState = { isAdmin: data.isAdmin, cardNumber: data.cardNumber };

    applyAdminState();
    applyPaymentCard();

    renderRestaurantList();
    renderOrders(data.orders);
  } catch {
    // Agar biror sababga ko'ra bootstrap ishlamasa, eski usulga (2 ta alohida so'rov) qaytamiz
    loadRestaurants();
    loadOrders();
  }
}

function applyAdminState() {
  document.getElementById('admin-panel').hidden = !appState.isAdmin;
  if (appState.isAdmin) {
    document.getElementById('card-input').value = appState.cardNumber || '';
  }
}

function applyPaymentCard() {
  const box = document.getElementById('payment-card-box');
  if (appState.cardNumber) {
    box.hidden = false;
    document.getElementById('payment-card-number').textContent = appState.cardNumber;
  } else {
    box.hidden = true;
  }
}

document.getElementById('copy-card-btn').addEventListener('click', async () => {
  const number = appState.cardNumber || '';
  try {
    await navigator.clipboard.writeText(number);
    showStatus('Karta raqami nusxalandi ✓');
  } catch {
    showStatus(number, false);
  }
});

document.getElementById('card-save-btn').addEventListener('click', async () => {
  const cardNumber = document.getElementById('card-input').value.trim();
  try {
    const res = await fetch('/api/admin/card-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData(), cardNumber }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    appState.cardNumber = data.cardNumber;
    applyPaymentCard();
    showAdminStatus(cardNumber ? 'Karta raqami saqlandi ✓' : 'Karta raqami olib tashlandi ✓');
  } catch {
    showAdminStatus('Xatolik yuz berdi', true);
  }
});

document.getElementById('delivery-save-btn').addEventListener('click', async () => {
  const amount = Number(document.getElementById('delivery-input').value) || 0;
  try {
    const res = await fetch('/api/admin/delivery-fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData(), amount }),
    });
    if (!res.ok) throw new Error();
    showAdminStatus(amount > 0 ? 'Dastavka narxi saqlandi ✓' : 'Dastavka narxi olib tashlandi ✓');
    document.getElementById('delivery-input').value = '';
    loadOrders();
  } catch {
    showAdminStatus('Xatolik yuz berdi', true);
  }
});

document.getElementById('clear-all-btn').addEventListener('click', () => {
  const doClear = async () => {
    try {
      const res = await fetch('/api/admin/clear-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: getInitData() }),
      });
      if (!res.ok) throw new Error();
      showAdminStatus("Barcha buyurtmalar bekor qilindi ✓");
      loadOrders();
    } catch {
      showAdminStatus('Xatolik yuz berdi', true);
    }
  };

  const message = "Bugungi BARCHA buyurtmalar o'chiriladi. Bu amalni qaytarib bo'lmaydi. Davom etasizmi?";
  if (tg?.showConfirm) {
    tg.showConfirm(message, (confirmed) => { if (confirmed) doClear(); });
  } else if (window.confirm(message)) {
    doClear();
  }
});

renderTodayLabel();
loadBootstrap();
pollTimer = setInterval(loadOrders, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(pollTimer); }
  else { loadOrders(); pollTimer = setInterval(loadOrders, 5000); }
});
