// ===========================================================
// OXIDUR · Tienda online
// ===========================================================

// ----- CONFIGURACIÓN DE MERCADOPAGO ---------------------
// Reemplazá estos valores con tus credenciales reales:
// 1) Conseguilas en https://www.mercadopago.com.ar/developers/panel
// 2) La PUBLIC KEY se usa en el frontend (acá)
// 3) El ACCESS TOKEN se usa en el backend (NUNCA lo expongas en el frontend)
const MERCADOPAGO_PUBLIC_KEY = 'APP_USR-0ad749c3-db9e-4f56-9d04-f0dd384ba42e';
// URL del backend que crea la preferencia de pago (ver server.js)
const BACKEND_CREATE_PREFERENCE_URL = '/api/create-preference';

// ----- CATÁLOGO ---------------------------------------------
const PRODUCTS = [
  {
    id: 'oxidur',
    name: 'OXIDUR',
    description: 'Esmalte antioxidante de base acuosa',
    sizes: [
      { id: '1l', label: '1 LITRO', price: 8500 },
      { id: '4l', label: '4 LITROS', price: 28900 }
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

// SVG del logo OXIDUR (isotipo)
const LOGO_SVG = `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <mask id="rc">
      <rect width="100" height="100" fill="white"/>
      <path d="M 60 26 L 80 50 L 60 74 L 40 50 Z" fill="black" transform="rotate(-30 50 50)"/>
    </mask>
    <circle cx="50" cy="50" r="35" stroke="currentColor" stroke-width="11" fill="none" mask="url(#rc)"/>
    <path d="M 60 26 L 78 50 L 60 74 L 42 50 Z" fill="currentColor" transform="rotate(-30 50 50)"/>
  </svg>
`;

// ----- ESTADO ----------------------------------------------
const cart = [];

// ----- HELPERS ---------------------------------------------
const fmt = n => '$' + n.toLocaleString('es-AR');
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ----- RENDER PRODUCTOS ------------------------------------
function renderProducts() {
  const grid = $('#productsGrid');
  const cards = COLORS.map(color => {
    const product = PRODUCTS[0];
    const initialSize = product.sizes[0];
    const isLight = color.id === 'blanco';
    // Color sólido para el cuerpo de la lata
    const bodyColor = color.hex;
    const labelColor = isLight ? '#1a1a1c' : 'white';
    const taglineColor = isLight ? 'rgba(26,26,28,0.7)' : 'rgba(255,255,255,0.7)';

    return `
      <article class="product-card" data-color="${color.id}">
        <div class="product-image">
          <span class="product-tag">${product.tag}</span>
          <div class="product-can" style="background:${bodyColor};">
            <span class="product-can-tagline" style="color:${taglineColor};">ESMALTE ANTIOXIDANTE</span>
            <span class="product-can-label" style="color:${labelColor};">
              <svg viewBox="0 0 100 100"><mask id="rc-${color.id}"><rect width="100" height="100" fill="white"/><path d="M 60 26 L 80 50 L 60 74 L 40 50 Z" fill="black" transform="rotate(-30 50 50)"/></mask><circle cx="50" cy="50" r="35" stroke="currentColor" stroke-width="11" fill="none" mask="url(#rc-${color.id})"/><path d="M 60 26 L 78 50 L 60 74 L 42 50 Z" fill="currentColor" transform="rotate(-30 50 50)"/></svg>
              OXIDUR
            </span>
            <span class="product-can-size">${initialSize.label}</span>
          </div>
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
            <button class="add-cart" data-color="${color.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12h14"/></svg>
              Agregar
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
  grid.innerHTML = cards;

  // Bind size selectors
  $$('.size-selector').forEach(selector => {
    selector.querySelectorAll('.size-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selector.querySelectorAll('.size-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const card = selector.closest('.product-card');
        const priceValue = card.querySelector('.price-value');
        const newPrice = Number(btn.dataset.price);
        priceValue.textContent = newPrice.toLocaleString('es-AR');

        const sizeLabel = btn.textContent;
        card.querySelector('.product-can-size').textContent = sizeLabel;
      });
    });
  });

  // Bind add-to-cart
  $$('.add-cart').forEach(btn => {
    btn.addEventListener('click', () => {
      const colorId = btn.dataset.color;
      const card = btn.closest('.product-card');
      const activeSize = card.querySelector('.size-option.active');
      const sizeId = activeSize.dataset.size;
      const price = Number(activeSize.dataset.price);
      const sizeLabel = activeSize.textContent;
      const colorObj = COLORS.find(c => c.id === colorId);

      addToCart({
        productId: 'oxidur',
        sizeId,
        colorId,
        name: 'OXIDUR ' + colorObj.name,
        color: colorObj,
        size: sizeLabel,
        price
      });

      btn.classList.add('added');
      const original = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg> Agregado';
      setTimeout(() => {
        btn.classList.remove('added');
        btn.innerHTML = original;
      }, 1400);

      showToast(`${colorObj.name} ${sizeLabel} agregado`);
    });
  });
}

// ----- CARRITO ---------------------------------------------
function addToCart(item) {
  const key = `${item.productId}-${item.sizeId}-${item.colorId}`;
  const existing = cart.find(i => i.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, key, qty: 1 });
  }
  renderCart();
}

function removeFromCart(key) {
  const idx = cart.findIndex(i => i.key === key);
  if (idx > -1) cart.splice(idx, 1);
  renderCart();
}

function updateQty(key, delta) {
  const item = cart.find(i => i.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(key);
  } else {
    renderCart();
  }
}

function cartTotal() {
  return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function cartCount() {
  return cart.reduce((sum, i) => sum + i.qty, 0);
}

function renderCart() {
  const body = $('#cartBody');
  $('#cartCount').textContent = cartCount();
  $('#cartTotal').textContent = fmt(cartTotal());
  $('#checkoutBtn').disabled = cart.length === 0;

  if (cart.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg class="cart-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2l1.5 4M6 2H4M7.5 6h13L19 13H8.5M7.5 6L8.5 13M8.5 13L7 16h12"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>
        <p>Tu carrito está vacío</p>
      </div>
    `;
    return;
  }

  body.innerHTML = cart.map(item => {
    const isLight = item.color.id === 'blanco';
    const labelColor = isLight ? '#1a1a1c' : 'white';
    return `
    <div class="cart-item">
      <div class="cart-item-thumb" style="background:${item.color.hex};">
        <svg class="cart-item-thumb-svg" style="color:${labelColor};" viewBox="0 0 100 100"><mask id="rc-cart-${item.key}"><rect width="100" height="100" fill="white"/><path d="M 60 26 L 80 50 L 60 74 L 40 50 Z" fill="black" transform="rotate(-30 50 50)"/></mask><circle cx="50" cy="50" r="35" stroke="currentColor" stroke-width="11" fill="none" mask="url(#rc-cart-${item.key})"/><path d="M 60 26 L 78 50 L 60 74 L 42 50 Z" fill="currentColor" transform="rotate(-30 50 50)"/></svg>
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-meta">${item.size}</div>
        <div class="cart-item-controls">
          <button class="qty-btn" data-action="dec" data-key="${item.key}">−</button>
          <span class="qty-display">${item.qty}</span>
          <button class="qty-btn" data-action="inc" data-key="${item.key}">+</button>
        </div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">${fmt(item.price * item.qty)}</div>
        <button class="cart-item-remove" data-action="remove" data-key="${item.key}">Eliminar</button>
      </div>
    </div>
    `;
  }).join('');

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

$('#cartBtn').addEventListener('click', openCart);
$('#cartClose').addEventListener('click', closeCart);
$('#cartOverlay').addEventListener('click', closeCart);

// ----- TOAST -----------------------------------------------
let toastTimer;
function showToast(msg) {
  $('#toastMsg').textContent = msg;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2500);
}

// ----- CHECKOUT --------------------------------------------
$('#checkoutBtn').addEventListener('click', () => {
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

  // MODO DEMO (por ahora)
  $('#mpBtn').innerHTML = 'Redirigiendo a MercadoPago...';
  setTimeout(() => {
    alert(
      '✅ DEMO: En producción te redirigiría a MercadoPago.\n\n' +
      'Total: ' + fmt(cartTotal()) + '\n' +
      'Productos: ' + cart.length
    );
    $('#checkoutModal').classList.remove('open');
    $('#mpBtn').innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-5-5 1.41-1.41L11 14.17l7.59-7.59L20 8l-9 9z"/></svg> Pagar con MercadoPago';
    
    // Vaciar carrito después de "compra"
    cart.length = 0;
    renderCart();
  }, 1200);
});

// ----- INIT ------------------------------------------------
renderProducts();
renderCart();