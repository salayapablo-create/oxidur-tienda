// ===========================================================
// OXIDUR · Tienda online
// ===========================================================

const MERCADOPAGO_PUBLIC_KEY = 'APP_USR-0ad749c3-db9e-4f56-9d04-f0dd384ba42e'; // ← Cambia después por la real
const BACKEND_CREATE_PREFERENCE_URL = '/api/create-preference';

// ----- CATÁLOGO ---------------------------------------------
const PRODUCTS = [
  {
    id: 'oxidur',
    name: 'OXIDUR',
    description: 'Esmalte antioxidante de base acuosa',
    sizes: [
      { id: '1l', label: '1 LITRO', price: 55000 },
      { id: '4l', label: '4 LITROS', price: 199000 }
    ],
    rendimiento: 'Rinde hasta 10 m² por litro',
    tag: 'MÁS VENDIDO'
  }
];

const COLORS = [
  { id: 'azul',   name: 'Azul',   hex: '#1f3fa3' },
  { id: 'blanco', name: 'Blanco', hex: '#f4f4f1' },
  { id: 'gris',   name: 'Gris',   hex: '#6f7178' },
  { id: 'negro',  name: 'Negro',  hex: '#1a1a1c' },
  { id: 'rojo',   name: 'Rojo',   hex: '#c1241f' },
  { id: 'verde',  name: 'Verde',  hex: '#21482a' }
];

// ----- HELPERS ---------------------------------------------
const fmt = n => '$' + n.toLocaleString('es-AR');
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function renderProducts() {
  const grid = $('#productsGrid');
  const cards = COLORS.map(color => {
    const product = PRODUCTS[0];
    const initialSize = product.sizes[0];
    const isLight = color.id === 'blanco';

    return `
      <article class="product-card" data-color="${color.id}">
        <div class="product-image">
          <img src="media/Lata OXIDUR.jpeg" alt="Lata OXIDUR ${color.name}" style="width:100%; height:auto; border-radius:8px;">
          <span class="product-tag">${product.tag}</span>
        </div>
        <div class="product-info">
          <h3 class="product-name">OXIDUR ${color.name}</h3>
          <div class="product-meta">${product.rendimiento}</div>

          <div class="size-selector" data-color="${color.id}">
            ${product.sizes.map((s, i) => `
              <button class="size-option ${i === 0 ? 'active' : ''}" data-size="${s.id}" data-price="${s.price}">${s.label}</button>
            `).join('')}
          </div>

          <div class="product-bottom">
            <div class="product-price">
              <span class="product-price-currency">$</span><span class="price-value">${initialSize.price.toLocaleString('es-AR')}</span>
            </div>
            <button class="add-cart" data-color="${color.id}">Agregar al carrito</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.innerHTML = cards;
  bindProductEvents();
}

// ----- CARRITO ---------------------------------------------
const cart = [];

function addToCart(item) {
  const key = `${item.productId}-${item.sizeId}-${item.colorId}`;
  const existing = cart.find(i => i.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, key, qty: 1 });
  }
  renderCart();
  openCart();   // ← Abre automáticamente el carrito al agregar
}

function renderProducts() {
  const grid = $('#productsGrid');
  
  grid.innerHTML = COLORS.map(color => {
    const product = PRODUCTS[0];
    const initialSize = product.sizes[0];

    return `
      <article class="product-card" data-color="${color.id}">
        <!-- LATA PRINCIPAL (única imagen) -->
        <div class="product-image">
          <img src="media/Lata OXIDUR.jpeg" alt="Lata OXIDUR ${color.name}" class="main-can">
          <span class="product-tag">${product.tag}</span>
        </div>

        <!-- Info y selectores -->
        <div class="product-info">
          <h3 class="product-name">OXIDUR ${color.name}</h3>
          <div class="product-meta">${product.rendimiento}</div>

          <!-- Colores (pequeños) -->
          <div class="color-options">
            ${COLORS.map(c => `
              <div class="color-dot ${c.id === color.id ? 'active' : ''}" 
                   style="background:${c.hex}" 
                   data-color="${c.id}"></div>
            `).join('')}
          </div>

          <!-- Tamaños -->
          <div class="size-selector">
            ${product.sizes.map((s, i) => `
              <button class="size-option ${i === 0 ? 'active' : ''}" 
                      data-size="${s.id}" 
                      data-price="${s.price}">${s.label}</button>
            `).join('')}
          </div>

          <div class="product-bottom">
            <div class="product-price">
              <span class="product-price-currency">$</span>
              <span class="price-value">${initialSize.price.toLocaleString('es-AR')}</span>
            </div>
            <button class="add-cart" data-color="${color.id}">Agregar al carrito</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  bindProductEvents();
}

  // Bind events del carrito
  body.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const action = btn.dataset.action;
      if (action === 'inc') updateQty(key, 1);
      else if (action === 'dec') updateQty(key, -1);
      else if (action === 'remove') removeFromCart(key);
    });
  });
}

function updateQty(key, delta) {
  const item = cart.find(i => i.key === key);
  if (item) {
    item.qty += delta;
    if (item.qty <= 0) removeFromCart(key);
    else renderCart();
  }
}

function removeFromCart(key) {
  const idx = cart.findIndex(i => i.key === key);
  if (idx > -1) cart.splice(idx, 1);
  renderCart();
}

// ----- CART DRAWER -----------------------------------------
function openCart() {
  $('#cartDrawer').classList.add('open');
  $('#cartOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  $('#cartDrawer').classList.remove('open');
  $('#cartOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Bind botones del carrito
$('#cartBtn').addEventListener('click', openCart);
$('#cartClose').addEventListener('click', closeCart);
$('#cartOverlay').addEventListener('click', closeCart);

// ----- CHECKOUT MODAL --------------------------------------
$('#checkoutBtn').addEventListener('click', () => {
  if (cart.length === 0) return showToast('El carrito está vacío');
  closeCart();
  $('#checkoutModal').classList.add('open');
});

$('#ckCancel').addEventListener('click', () => {
  $('#checkoutModal').classList.remove('open');
});

$('#mpBtn').addEventListener('click', async () => {
  const data = {
    name: $('#ckName').value.trim(),
    email: $('#ckEmail').value.trim(),
    phone: $('#ckPhone').value.trim(),
    dni: $('#ckDni').value.trim(),
    address: $('#ckAddr').value.trim(),
    city: $('#ckCity').value.trim(),
    cp: $('#ckCp').value.trim()
  };

  if (!data.name || !data.email || !data.address) {
    showToast('Completá los datos requeridos');
    return;
  }

  const items = cart.map(i => ({
    title: `${i.name} - ${i.size}`,
    quantity: i.qty,
    unit_price: i.price,
    currency_id: 'ARS'
  }));

  try {
    $('#mpBtn').innerHTML = 'Procesando pago...';
    $('#mpBtn').disabled = true;

    const res = await fetch(BACKEND_CREATE_PREFERENCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, payer: data })
    });

    const result = await res.json();

    if (result.init_point) {
      window.location.href = result.init_point;
    } else {
      throw new Error('No se recibió link de pago');
    }
  } catch (err) {
    console.error(err);
    showToast('Error al conectar con MercadoPago');
    $('#mpBtn').innerHTML = 'Pagar con MercadoPago';
    $('#mpBtn').disabled = false;
  }
});

// ----- INIT ------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  renderCart();
});