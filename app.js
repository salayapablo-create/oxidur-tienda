// ===========================================================
// OXIDUR · Tienda online
// ===========================================================

// ----- CONFIGURACIÓN DE MERCADOPAGO ---------------------
// Reemplazá estos valores con tus credenciales reales:
// 1) Conseguilas en https://www.mercadopago.com.ar/developers/panel
// 2) La PUBLIC KEY se usa en el frontend (acá)
// 3) El ACCESS TOKEN se usa en el backend (NUNCA lo expongas en el frontend)
const MERCADOPAGO_PUBLIC_KEY = 'TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
// URL del backend que crea la preferencia de pago (ver server.js)
const BACKEND_CREATE_PREFERENCE_URL = '/api/create-preference';

// ----- CATÁLOGO ---------------------------------------------
const PRODUCTS = [
  {
    id: 'oxidur',
    name: 'OXIDUR',
    description: 'Esmalte antioxidante de base acuosa',
    sizes: [
      { id: '1l', label: '1 LITRO',  price: 8500,  rinde: '10 m²' },
      { id: '4l', label: '4 LITROS', price: 28900, rinde: '40 m²' }
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
const selection = {
  colorId: 'negro',
  sizeId: '1l',
  qty: 1
};

// ----- HELPERS ---------------------------------------------
const fmt = n => '$' + n.toLocaleString('es-AR');
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// Para el overlay de color: cada color tiene una "fuerza" de tinte
// (el blanco no necesita teñir, el negro tampoco — están casi iguales)
const COLOR_TINTS = {
  azul:   { tint: '#1f3fa3', strength: 0.65 },
  blanco: { tint: '#ffffff', strength: 0.0 },  // mostramos la foto original
  gris:   { tint: '#6f7178', strength: 0.45 },
  negro:  { tint: '#000000', strength: 0.0 },  // mostramos la foto original
  rojo:   { tint: '#c1241f', strength: 0.7 },
  verde:  { tint: '#21482a', strength: 0.7 }
};

// ----- RENDER PRODUCTO -------------------------------------
function renderColorSwatches() {
  const wrap = $('#colorSwatches');
  wrap.innerHTML = COLORS.map(c => `
    <div class="color-swatch ${c.id === selection.colorId ? 'active' : ''}"
         data-color="${c.id}"
         style="background:${c.hex}; ${c.id === 'blanco' ? 'border-color:#444;' : ''}"
         title="${c.name}"></div>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      selection.colorId = sw.dataset.color;
      updateProductView();
    });
  });
}

function renderSizeOptions() {
  const wrap = $('#sizeOptions');
  const product = PRODUCTS[0];
  wrap.innerHTML = product.sizes.map(s => `
    <button class="size-option ${s.id === selection.sizeId ? 'active' : ''}"
            data-size="${s.id}">
      ${s.label}
      <span class="size-rendimiento">Rinde ${s.rinde}</span>
    </button>
  `).join('');
  wrap.querySelectorAll('.size-option').forEach(btn => {
    btn.addEventListener('click', () => {
      selection.sizeId = btn.dataset.size;
      updateProductView();
    });
  });
}

function updateProductView() {
  // Color activo en swatches
  $$('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === selection.colorId);
  });
  // Size activo
  $$('.size-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === selection.sizeId);
  });

  const colorObj = COLORS.find(c => c.id === selection.colorId);
  const sizeObj = PRODUCTS[0].sizes.find(s => s.id === selection.sizeId);

  // Título y label de color
  $('#productTitle').textContent = `OXIDUR ${colorObj.name}`;
  $('#productColorLabel').textContent = colorObj.name;
  $('#colorCurrent').textContent = colorObj.name;

  // Precio y cuotas
  $('#productPrice').textContent = sizeObj.price.toLocaleString('es-AR');
  const cuota = Math.round(sizeObj.price / 3);
  $('#productInstallments').textContent = `3 cuotas sin interés de ${fmt(cuota)}`;

  // Tinte sobre la imagen
  const tint = COLOR_TINTS[selection.colorId];
  const overlay = $('#productColorOverlay');
  overlay.style.setProperty('--tint', tint.tint);
  overlay.style.setProperty('--tint-strength', tint.strength);

  // Cantidad
  $('#qtyNum').textContent = selection.qty;
}

// Cantidad
$('#qtyMinus').addEventListener('click', () => {
  if (selection.qty > 1) {
    selection.qty--;
    $('#qtyNum').textContent = selection.qty;
  }
});
$('#qtyPlus').addEventListener('click', () => {
  if (selection.qty < 99) {
    selection.qty++;
    $('#qtyNum').textContent = selection.qty;
  }
});

// Agregar al carrito
$('#addCartBtn').addEventListener('click', () => {
  const colorObj = COLORS.find(c => c.id === selection.colorId);
  const sizeObj = PRODUCTS[0].sizes.find(s => s.id === selection.sizeId);

  for (let i = 0; i < selection.qty; i++) {
    addToCart({
      productId: 'oxidur',
      sizeId: sizeObj.id,
      colorId: colorObj.id,
      name: 'OXIDUR ' + colorObj.name,
      color: colorObj,
      size: sizeObj.label,
      price: sizeObj.price
    });
  }

  const btn = $('#addCartBtn');
  btn.classList.add('added');
  const original = btn.innerHTML;
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg> Agregado al carrito';
  setTimeout(() => {
    btn.classList.remove('added');
    btn.innerHTML = original;
  }, 1600);

  showToast(`${selection.qty}× ${colorObj.name} ${sizeObj.label} agregado`);

  // Reset cantidad a 1
  selection.qty = 1;
  $('#qtyNum').textContent = 1;
});

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

  // ===== MODO REAL: descomentá esto cuando tengas el backend listo =====
  /*
  try {
    const res = await fetch(BACKEND_CREATE_PREFERENCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, payer: data })
    });
    const { init_point } = await res.json();
    window.location.href = init_point;
  } catch (err) {
    showToast('Error al iniciar el pago');
    console.error(err);
  }
  */

  // ===== MODO DEMO =====
  $('#mpBtn').innerHTML = 'Redirigiendo a MercadoPago...';
  setTimeout(() => {
    alert(
      '✅ DEMO: En producción, acá te redirigiría al checkout de MercadoPago.\n\n' +
      'Resumen del pedido:\n' +
      cart.map(i => `• ${i.name} (${i.size}) x${i.qty} = ${fmt(i.price * i.qty)}`).join('\n') +
      `\n\nTotal: ${fmt(cartTotal())}\n\nPara: ${data.name}\n${data.address}, ${data.city} (${data.cp})`
    );
    $('#checkoutModal').classList.remove('open');
    $('#mpBtn').innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-5-5 1.41-1.41L11 14.17l7.59-7.59L20 8l-9 9z"/></svg> Pagar con MercadoPago';
    cart.length = 0;
    renderCart();
  }, 1500);
});

// ----- INIT ------------------------------------------------
renderColorSwatches();
renderSizeOptions();
updateProductView();
renderCart();

// Smooth scroll para anchors
$$('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#' || href.length < 2) return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
