// ===========================================================
// OXIDUR · Tienda online
// ===========================================================

const MERCADOPAGO_PUBLIC_KEY = 'APP_USR-XXXXXXXXXXXX'; // ← Cambia después por la real
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

// ----- HELPERS ---------------------------------------------
const fmt = n => '$' + n.toLocaleString('es-AR');
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ----- RENDER PRODUCTOS ------------------------------------
function renderProducts() {
  const grid = $('#productsGrid');
  if (!grid) return;

  const cards = COLORS.map(color => {
    const product = PRODUCTS[0];
    const initialSize = product.sizes[0];
    const isLight = color.id === 'blanco';

    return `
      <article class="product-card" data-color="${color.id}">
        <div class="product-image">
          <span class="product-tag">${product.tag}</span>
          <div class="product-can" style="background:${color.hex};">
            <span class="product-can-tagline" style="color:${isLight ? '#1a1a1c' : 'white'};">ESMALTE ANTIOXIDANTE</span>
            <span class="product-can-label" style="color:${isLight ? '#1a1a1c' : 'white'};">OXIDUR</span>
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
            <button class="add-cart" data-color="${color.id}">Agregar</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.innerHTML = cards;
  bindProductEvents();
}

function bindProductEvents() {
  // Size selector
  $$('.size-selector').forEach(selector => {
    selector.querySelectorAll('.size-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selector.querySelectorAll('.size-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const card = selector.closest('.product-card');
        card.querySelector('.price-value').textContent = Number(btn.dataset.price).toLocaleString('es-AR');
        card.querySelector('.product-can-size').textContent = btn.textContent;
      });
    });
  });

  // Add to cart
  $$('.add-cart').forEach(btn => {
    btn.addEventListener('click', () => {
      const colorId = btn.dataset.color;
      const card = btn.closest('.product-card');
      const activeSize = card.querySelector('.size-option.active');
      if (!activeSize) return;

      const colorObj = COLORS.find(c => c.id === colorId);

      addToCart({
        productId: 'oxidur',
        sizeId: activeSize.dataset.size,
        colorId,
        name: 'OXIDUR ' + colorObj.name,
        color: colorObj,
        size: activeSize.textContent,
        price: Number(activeSize.dataset.price)
      });

      showToast(`${colorObj.name} ${activeSize.textContent} agregado`);
    });
  });
}

// ----- CARRITO y resto del código (mantengo lo que ya tenías) -------------
const cart = [];

function addToCart(item) { /* ... tu código anterior ... */ }
function renderCart() { /* ... tu código anterior ... */ }
// ... (todo el resto del carrito, drawer, toast, checkout, etc.)

// ----- INIT ------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  renderCart();
});