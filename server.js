// ============================================================
// OXIDUR · Backend
// ============================================================
// Integraciones:
//   - MercadoPago (cobro)
//   - MiCorreo API (Correo Argentino) - generación automática de guías
//   - Resend (notificaciones por email)
//
// API REST de MiCorreo (Correo Argentino)
// Documentación oficial: apiMiCorreo.pdf v2025-01-14
//
// Flujo de auth:
//   1. POST /token con HTTP Basic Auth (usuario:password)
//      → devuelve JWT token
//   2. Usar token como Bearer en headers para resto de endpoints
//   3. Token expira ~2hs, se renueva automáticamente
//
// VARIABLES DE ENTORNO (Render):
//   MP_ACCESS_TOKEN          MercadoPago
//   CORREO_USER              Usuario de API MiCorreo
//   CORREO_PASSWORD          Contraseña de API MiCorreo
//   CORREO_CUSTOMER_ID       customerId (opcional - se obtiene auto)
//   CORREO_MODE              "test" o "production"
//   SITE_URL                 URL pública
//   RESEND_API_KEY           Resend
//   EMAIL_FROM               Mail "de"
//   ADMIN_EMAILS             Mails admin separados por coma
//   WHATSAPP_NUMBER          WhatsApp
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ============================================================
// CONFIGURACIÓN
// ============================================================

// MercadoPago
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';

// MiCorreo (Correo Argentino)
const CORREO_USER         = process.env.CORREO_USER         || '';
const CORREO_PASSWORD     = process.env.CORREO_PASSWORD     || '';
const CORREO_CUSTOMER_ID  = process.env.CORREO_CUSTOMER_ID  || ''; // se cachea si no se pasa
const CORREO_MODE         = process.env.CORREO_MODE         || 'test';

const CORREO_BASE_URL = CORREO_MODE === 'production'
  ? 'https://api.correoargentino.com.ar/micorreo/v1'
  : 'https://apitest.correoargentino.com.ar/micorreo/v1';

// Site
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// ----- Datos del REMITENTE (HIDROSOL SRL) -------------------
const SENDER = {
  name: 'HIDROSOL SRL',
  phone: '1158533291',
  cellPhone: '1158533291',
  email: 'microfloor1@hotmail.com',
  originAddress: {
    streetName: 'Gral. Heredia',
    streetNumber: '2353',
    floor: '',
    apartment: '',
    city: 'Avellaneda',
    provinceCode: 'B',
    postalCode: '1869'
  },
  postalCodeOrigin: '1869'  // CP de origen de envíos
};

// ----- Catálogo de productos físicos ------------------------
// MiCorreo: pesos en GRAMOS, dimensiones enteras en CM
const PRODUCT_SPECS = {
  '1l': { weight: 1100, length: 15, width: 12, height: 12, name: 'OXIDUR 1L' },
  '4l': { weight: 4200, length: 22, width: 18, height: 18, name: 'OXIDUR 4L' }
};

// ----- Provincias AR → códigos ISO 3166-2 -------------------
const PROVINCIAS_AR = {
  'salta': 'A',
  'buenos aires': 'B',
  'provincia de buenos aires': 'B',
  'caba': 'C',
  'capital federal': 'C',
  'ciudad autonoma de buenos aires': 'C',
  'ciudad autónoma de buenos aires': 'C',
  'san luis': 'D',
  'entre rios': 'E',
  'entre ríos': 'E',
  'la rioja': 'F',
  'santiago del estero': 'G',
  'chaco': 'H',
  'san juan': 'J',
  'catamarca': 'K',
  'la pampa': 'L',
  'mendoza': 'M',
  'misiones': 'N',
  'formosa': 'P',
  'neuquen': 'Q',
  'neuquén': 'Q',
  'rio negro': 'R',
  'río negro': 'R',
  'santa fe': 'S',
  'tucuman': 'T',
  'tucumán': 'T',
  'chubut': 'U',
  'tierra del fuego': 'V',
  'corrientes': 'W',
  'cordoba': 'X',
  'córdoba': 'X',
  'jujuy': 'Y',
  'santa cruz': 'Z'
};

function normalizarProvincia(nombre) {
  if (!nombre) return 'B';
  if (/^[A-Z]$/.test(nombre)) return nombre;
  const key = nombre.toLowerCase().trim();
  return PROVINCIAS_AR[key] || 'B';
}

// ----- Resend -----
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM     = process.env.EMAIL_FROM || 'OXIDUR <onboarding@resend.dev>';
const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL || 'microfloor1@hotmail.com';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || NOTIFY_EMAIL)
  .split(',').map(e => e.trim()).filter(Boolean);
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '5491158533291';

// ============================================================
// MERCADOPAGO
// ============================================================

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

app.post('/api/create-preference', async (req, res) => {
  try {
    const { items, payer } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No hay items en el pedido' });
    }
    if (!payer?.email || !payer?.address) {
      return res.status(400).json({ error: 'Faltan datos del comprador' });
    }

    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: items.map(i => ({
          title: i.title,
          quantity: i.quantity,
          unit_price: i.unit_price,
          currency_id: 'ARS'
        })),
        payer: {
          name: payer.name,
          email: payer.email,
          phone: { number: payer.phone },
          identification: { type: 'DNI', number: payer.dni },
          address: {
            street_name: payer.address,
            zip_code: payer.cp
          }
        },
        shipments: { cost: 0, mode: 'not_specified' },
        back_urls: {
          success: `${SITE_URL}/gracias.html`,
          failure: `${SITE_URL}/error.html`,
          pending: `${SITE_URL}/pendiente.html`
        },
        auto_return: 'approved',
        statement_descriptor: 'OXIDUR',
        notification_url: `${SITE_URL}/api/webhook/mercadopago`,
        metadata: {
          payer_full: JSON.stringify(payer),
          items_full: JSON.stringify(items)
        },
        external_reference: `OXIDUR-${Date.now()}`
      }
    });

    res.json({ id: result.id, init_point: result.init_point });
  } catch (err) {
    console.error('Error creando preferencia:', err);
    res.status(500).json({ error: 'No se pudo crear la preferencia de pago' });
  }
});

// ============================================================
// MICORREO · Auth con JWT (token cacheado)
// ============================================================

let cachedToken = null;
let tokenExpiry = null;
let cachedCustomerId = CORREO_CUSTOMER_ID;

/**
 * Obtiene un JWT token válido. Lo cachea y lo renueva automáticamente
 * cuando se acerca a la expiración.
 */
async function getCorreoToken() {
  // Si tenemos token cacheado y todavía es válido (con 5min de margen), devolverlo
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }

  if (!CORREO_USER || !CORREO_PASSWORD) {
    throw new Error('CORREO_USER o CORREO_PASSWORD no configurados');
  }

  // Login con HTTP Basic Auth
  const response = await axios.post(
    `${CORREO_BASE_URL}/token`,
    null,
    {
      auth: { username: CORREO_USER, password: CORREO_PASSWORD },
      timeout: 15000
    }
  );

  cachedToken = response.data.token;
  // expires viene como "2022-04-26 21:16:20"
  tokenExpiry = new Date(response.data.expires.replace(' ', 'T') + '-03:00').getTime();

  console.log(`🔑 Token MiCorreo obtenido. Expira: ${response.data.expires}`);
  return cachedToken;
}

/**
 * Helper para llamar a la API de MiCorreo con el token automático
 */
async function correoRequest(method, path, data, params) {
  const token = await getCorreoToken();
  return axios({
    method,
    url: `${CORREO_BASE_URL}${path}`,
    data,
    params,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 25000
  });
}

/**
 * Obtiene el customerId. Si no está cacheado, lo busca con /users/validate.
 */
async function getCustomerId() {
  if (cachedCustomerId) return cachedCustomerId;

  const response = await correoRequest('POST', '/users/validate', {
    email: CORREO_USER,
    password: CORREO_PASSWORD
  });

  cachedCustomerId = response.data.customerId;
  console.log(`👤 customerId MiCorreo: ${cachedCustomerId}`);
  return cachedCustomerId;
}

// ============================================================
// MICORREO · Generar envío
// ============================================================

/**
 * Calcula peso total y dimensiones del paquete según items del carrito.
 * Si hay 4L, usa esas dimensiones (caja más grande).
 * Pesos sumados, dentro del límite de 25kg de MiCorreo.
 */
function buildShipping(items) {
  const tieneCuatroLitros = items.some(i => /4\s*LITROS?/i.test(i.title));
  let pesoTotal = 0;
  let valorDeclarado = 0;

  for (const item of items) {
    const isFourLiters = /4\s*LITROS?/i.test(item.title);
    const spec = isFourLiters ? PRODUCT_SPECS['4l'] : PRODUCT_SPECS['1l'];
    pesoTotal += spec.weight * item.quantity;
    valorDeclarado += item.unit_price * item.quantity;
  }

  const spec = tieneCuatroLitros ? PRODUCT_SPECS['4l'] : PRODUCT_SPECS['1l'];

  return {
    weight: Math.min(pesoTotal, 25000),
    declaredValue: valorDeclarado,
    height: spec.height,
    length: spec.length,
    width: spec.width
  };
}

/**
 * Crea un envío en MiCorreo.
 * Tipo de entrega: 'D' (homeDelivery, a domicilio).
 */
async function crearEnvioCorreo({ payer, items, orderRef }) {
  if (!CORREO_USER || !CORREO_PASSWORD) {
    return { ok: false, error: 'MiCorreo no configurado (faltan credenciales)' };
  }

  try {
    const customerId = await getCustomerId();
    const shipping = buildShipping(items);
    const provinciaCode = normalizarProvincia(payer.state || payer.province);

    const orderData = {
      customerId,
      extOrderId: orderRef,
      orderNumber: orderRef,
      sender: {
        name: SENDER.name,
        phone: SENDER.phone,
        cellPhone: SENDER.cellPhone,
        email: SENDER.email,
        originAddress: SENDER.originAddress
      },
      recipient: {
        name: payer.name || 'Cliente',
        phone: payer.phone || '',
        cellPhone: payer.phone || '',
        email: payer.email || ''
      },
      shipping: {
        deliveryType: 'D',           // D = Domicilio
        agency: null,
        productType: 'CP',           // CP = Paquete
        address: {
          streetName: payer.address || '',
          streetNumber: payer.streetNumber || 'S/N',
          floor: payer.floor || '',
          apartment: payer.apartment || '',
          city: payer.city || '',
          provinceCode: provinciaCode,
          postalCode: payer.cp || ''
        },
        weight: shipping.weight,
        declaredValue: shipping.declaredValue,
        height: shipping.height,
        length: shipping.length,
        width: shipping.width
      }
    };

    const response = await correoRequest('POST', '/shipping/import', orderData);

    if (response.data?.createdAt) {
      return {
        ok: true,
        createdAt: response.data.createdAt,
        orderRef,
        message: 'Envío importado a MiCorreo. Revisá el panel para imprimir el rótulo.'
      };
    } else {
      console.error('Respuesta inesperada de MiCorreo:');
      console.error(JSON.stringify(response.data, null, 2));
      return {
        ok: false,
        error: response.data?.message || 'Respuesta inesperada de MiCorreo',
        raw: response.data
      };
    }
  } catch (err) {
    console.error('Error en llamada a MiCorreo:');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Mensaje:', err.message);
    }

    const errData = err.response?.data;
    const errorMsg = errData?.message || errData?.error || err.message;

    return { ok: false, error: errorMsg, raw: errData };
  }
}

// ============================================================
// WEBHOOK MercadoPago
// ============================================================

/**
 * Valida la firma de un webhook de MercadoPago.
 * MP manda 2 headers: x-signature y x-request-id.
 * x-signature tiene formato: "ts=1234567890,v1=hash..."
 *
 * El "manifest" a firmar es: id:{data.id};request-id:{x-request-id};ts:{ts};
 * La firma se calcula con HMAC-SHA256(manifest, MP_WEBHOOK_SECRET).
 * Si coincide con v1 → webhook legítimo.
 *
 * Devuelve true si es válido, false si no.
 * Si MP_WEBHOOK_SECRET no está configurado, omite la validación (modo legacy).
 */
function validarFirmaWebhookMP(req) {
  if (!MP_WEBHOOK_SECRET) {
    console.warn('⚠ MP_WEBHOOK_SECRET no configurado, no se valida firma');
    return true; // permitir todo si no hay clave (compatibilidad)
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || req.body?.data?.id;

  if (!xSignature || !xRequestId || !dataId) {
    console.warn('⚠ Faltan headers o data.id para validar firma');
    return false;
  }

  // Parsear x-signature: "ts=1234567890,v1=abcdef..."
  const parts = xSignature.split(',');
  let ts = null, v1 = null;
  for (const p of parts) {
    const [k, v] = p.trim().split('=');
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  }

  if (!ts || !v1) {
    console.warn('⚠ x-signature mal formado');
    return false;
  }

  // Construir manifest según especificación oficial MP
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Calcular HMAC-SHA256
  const expectedSignature = crypto
    .createHmac('sha256', MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  // Comparar (timingSafeEqual previene ataques de timing)
  const valid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(v1, 'hex')
  );

  if (!valid) {
    console.warn(`⚠ Firma inválida. Esperaba ${expectedSignature}, recibí ${v1}`);
  }

  return valid;
}

app.post('/api/webhook/mercadopago', async (req, res) => {
  // Validar firma ANTES de procesar
  if (!validarFirmaWebhookMP(req)) {
    console.error('❌ Webhook rechazado: firma inválida');
    return res.status(401).send('Invalid signature');
  }

  res.sendStatus(200); // respondemos rápido

  try {
    const { type, data } = req.body;

    if (type !== 'payment' || !data?.id) {
      console.log('Webhook ignorado (no es pago):', type);
      return;
    }

    const payment = new Payment(mpClient);
    const paymentInfo = await payment.get({ id: data.id });

    if (paymentInfo.status !== 'approved') {
      console.log(`Pago ${data.id} en estado ${paymentInfo.status}, no genero guía aún.`);
      return;
    }

    console.log(`✅ Pago ${data.id} aprobado. Importando envío a MiCorreo...`);

    const payer = JSON.parse(paymentInfo.metadata?.payer_full || '{}');
    const items = JSON.parse(paymentInfo.metadata?.items_full || '[]');
    const orderRef = paymentInfo.external_reference || `MP-${data.id}`;
    const total = items.reduce((s, i) => s + (i.unit_price * i.quantity), 0);

    const envioResult = await crearEnvioCorreo({ payer, items, orderRef });

    if (envioResult.ok) {
      console.log(`📦 Envío importado a MiCorreo: ${orderRef}`);
    } else {
      console.error('❌ Error importando envío:', envioResult.error);
    }

    await notificarVenta({
      payer, items, paymentId: data.id, orderRef, total, envioResult
    });
  } catch (err) {
    console.error('Error procesando webhook MP:', err);
  }
});

// ============================================================
// Endpoints útiles
// ============================================================

/**
 * Prueba manual: importar un envío a MiCorreo (usado por test-envia.html)
 */
app.post('/api/envia/crear', async (req, res) => {
  const result = await crearEnvioCorreo(req.body);
  res.json(result);
});

/**
 * Validar credenciales: pide token y valida customerId
 */
app.get('/api/correo/validar', async (req, res) => {
  if (!CORREO_USER || !CORREO_PASSWORD) {
    return res.json({ ok: false, error: 'CORREO_USER o CORREO_PASSWORD no configurados' });
  }

  try {
    const token = await getCorreoToken();
    const customerId = await getCustomerId();
    res.json({
      ok: true,
      message: 'Credenciales válidas',
      customerId,
      tokenObtenido: true,
      mode: CORREO_MODE
    });
  } catch (err) {
    res.json({
      ok: false,
      status: err.response?.status,
      error: err.response?.data?.message || err.response?.data?.error || err.message,
      raw: err.response?.data
    });
  }
});

/**
 * Cotizar un envío (sin generarlo)
 */
app.post('/api/correo/cotizar', async (req, res) => {
  try {
    const { destination, items, deliveredType } = req.body;
    const customerId = await getCustomerId();
    const shipping = buildShipping(items || []);

    const payload = {
      customerId,
      postalCodeOrigin: SENDER.postalCodeOrigin,
      postalCodeDestination: destination?.cp || destination?.postalCode,
      ...(deliveredType ? { deliveredType } : {}), // 'D' / 'S' / null para ambos
      dimensions: {
        weight: shipping.weight,
        height: shipping.height,
        width: shipping.width,
        length: shipping.length
      }
    };

    const response = await correoRequest('POST', '/rates', payload);
    res.json({ ok: true, data: response.data });
  } catch (err) {
    res.json({
      ok: false,
      status: err.response?.status,
      error: err.response?.data?.message || err.message,
      raw: err.response?.data
    });
  }
});

/**
 * Tracking de un envío
 */
app.get('/api/correo/tracking/:shippingId', async (req, res) => {
  try {
    const response = await correoRequest('GET', '/shipping/tracking', null, {
      shippingId: req.params.shippingId
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({
      error: err.response?.data?.message || err.message
    });
  }
});

// ============================================================
// EMAILS (Resend)
// ============================================================

const fmtMoney = n => '$' + Number(n).toLocaleString('es-AR');

async function sendEmail({ to, subject, html, replyTo }) {
  if (!RESEND_API_KEY) {
    console.warn('⚠ RESEND_API_KEY no configurada, no se mandó email a:', to);
    return { ok: false, error: 'Resend no configurado' };
  }
  try {
    const recipients = Array.isArray(to) ? to : [to];
    const response = await axios.post(
      'https://api.resend.com/emails',
      {
        from: EMAIL_FROM,
        to: recipients,
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {})
      },
      {
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    return { ok: true, id: response.data?.id };
  } catch (err) {
    console.error('Error mandando email:', err.response?.data || err.message);
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

function buildAdminEmail({ payer, items, paymentId, orderRef, total, envioResult }) {
  const itemsRows = items.map(i => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;">${i.title}</td>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;text-align:center;">${i.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;text-align:right;">${fmtMoney(i.unit_price)}</td>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;text-align:right;font-weight:bold;">${fmtMoney(i.unit_price * i.quantity)}</td>
    </tr>
  `).join('');

  const envioBlock = envioResult?.ok ? `
    <div style="background:#1a4d2e;border-left:4px solid #2ecc71;padding:14px;margin:18px 0;border-radius:4px;">
      <p style="margin:0;color:#7eddb1;font-weight:bold;">✓ Envío importado a MiCorreo</p>
      <p style="margin:6px 0 0;color:#fff;font-size:14px;">
        Andá al panel de MiCorreo (correoargentino.com.ar) e imprimí el rótulo del pedido <strong>${orderRef}</strong>.
      </p>
    </div>
  ` : `
    <div style="background:#4d1a1a;border-left:4px solid #e74c3c;padding:14px;margin:18px 0;border-radius:4px;">
      <p style="margin:0;color:#ffb0b0;font-weight:bold;">⚠ NO se importó el envío automáticamente</p>
      <p style="margin:6px 0 0;color:#fff;font-size:14px;">
        Error: ${envioResult?.error || 'Sin detalle'}<br>
        Cargá el envío manual en el panel de MiCorreo.
      </p>
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0d0d0f;font-family:-apple-system,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0f;padding:24px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#15161a;border:1px solid #2a2c33;max-width:600px;width:100%;">
        <tr><td style="background:#ff5b1f;padding:24px;text-align:center;">
          <h1 style="margin:0;color:#0d0d0f;font-size:14px;letter-spacing:0.2em;text-transform:uppercase;font-weight:800;">🛒 Nueva venta · OXIDUR</h1>
        </td></tr>
        <tr><td style="padding:30px 30px 10px;">
          <p style="margin:0;color:#9a9b9f;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;">Pedido</p>
          <h2 style="margin:6px 0 0;color:#fff;font-size:28px;letter-spacing:0.02em;">${orderRef}</h2>
          <p style="margin:6px 0 0;color:#ff5b1f;font-size:32px;font-weight:bold;">${fmtMoney(total)}</p>
        </td></tr>
        <tr><td style="padding:0 30px;">${envioBlock}</td></tr>
        <tr><td style="padding:20px 30px;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Productos</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="color:#fff;font-size:14px;">
            <thead><tr style="border-bottom:2px solid #2a2c33;">
              <th style="padding:10px;text-align:left;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Producto</th>
              <th style="padding:10px;text-align:center;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Cant</th>
              <th style="padding:10px;text-align:right;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Precio</th>
              <th style="padding:10px;text-align:right;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Subtotal</th>
            </tr></thead>
            <tbody>${itemsRows}</tbody>
            <tfoot><tr><td colspan="3" style="padding:14px 10px;text-align:right;color:#fff;font-size:16px;">Total cobrado:</td>
              <td style="padding:14px 10px;text-align:right;color:#ff5b1f;font-size:20px;font-weight:bold;">${fmtMoney(total)}</td></tr></tfoot>
          </table>
        </td></tr>
        <tr><td style="padding:20px 30px;border-top:1px solid #2a2c33;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Cliente</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="color:#fff;font-size:14px;">
            <tr><td style="padding:6px 0;color:#9a9b9f;width:120px;">Nombre:</td><td style="padding:6px 0;font-weight:bold;">${payer.name || '-'}</td></tr>
            <tr><td style="padding:6px 0;color:#9a9b9f;">Email:</td><td style="padding:6px 0;"><a href="mailto:${payer.email}" style="color:#ff5b1f;">${payer.email || '-'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#9a9b9f;">Teléfono:</td><td style="padding:6px 0;"><a href="https://wa.me/${(payer.phone||'').replace(/\D/g,'')}" style="color:#ff5b1f;">${payer.phone || '-'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#9a9b9f;">DNI:</td><td style="padding:6px 0;">${payer.dni || '-'}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 30px;border-top:1px solid #2a2c33;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Dirección de envío</h3>
          <p style="margin:0;color:#fff;font-size:15px;line-height:1.6;">
            ${payer.address || '-'}${payer.floor ? ` · <strong style="color:#ff5b1f;">${payer.floor}</strong>` : ''}<br>
            ${payer.city || '-'} · CP <strong>${payer.cp || '-'}</strong>
          </p>
        </td></tr>
        <tr><td style="padding:20px 30px;border-top:1px solid #2a2c33;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Pago</h3>
          <p style="margin:0;color:#fff;font-size:14px;">
            <span style="color:#9a9b9f;">ID MercadoPago:</span> <strong>${paymentId}</strong><br>
            <span style="color:#9a9b9f;">Estado:</span> <span style="color:#2ecc71;font-weight:bold;">Aprobado</span>
          </p>
        </td></tr>
        <tr><td style="background:#0d0d0f;padding:18px;text-align:center;border-top:1px solid #2a2c33;">
          <p style="margin:0;color:#9a9b9f;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">OXIDUR · ${new Date().toLocaleString('es-AR')}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildClientEmail({ payer, items, orderRef, total, envioResult }) {
  const itemsRows = items.map(i => `
    <tr>
      <td style="padding:12px 0;color:#0d0d0f;">${i.title}</td>
      <td style="padding:12px 0;text-align:center;color:#0d0d0f;">×${i.quantity}</td>
      <td style="padding:12px 0;text-align:right;color:#0d0d0f;font-weight:bold;">${fmtMoney(i.unit_price * i.quantity)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:24px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;max-width:600px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr><td style="background:#0d0d0f;padding:30px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:32px;letter-spacing:0.06em;font-weight:800;">OXIDUR</h1>
          <p style="margin:6px 0 0;color:#ff5b1f;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;">Esmalte Antioxidante</p>
        </td></tr>
        <tr><td style="background:#ff5b1f;padding:24px;text-align:center;">
          <h2 style="margin:0;color:#0d0d0f;font-size:26px;letter-spacing:0.02em;">¡Gracias por tu compra!</h2>
        </td></tr>
        <tr><td style="padding:30px 30px 0;">
          <p style="margin:0;color:#0d0d0f;font-size:16px;line-height:1.6;">Hola <strong>${payer.name?.split(' ')[0] || 'amigx'}</strong>,</p>
          <p style="margin:14px 0 0;color:#5a5a5a;font-size:15px;line-height:1.6;">Recibimos tu pedido y ya estamos preparándolo. Te enviamos por Correo Argentino y en las próximas 24 horas vas a recibir el número de tracking.</p>
        </td></tr>
        <tr><td style="padding:20px 30px;">
          <p style="margin:0 0 6px;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Número de pedido</p>
          <p style="margin:0;color:#0d0d0f;font-size:18px;font-weight:bold;">${orderRef}</p>
        </td></tr>
        <tr><td style="padding:0 30px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #0d0d0f;border-bottom:2px solid #0d0d0f;">
            ${itemsRows}
            <tr style="border-top:1px solid #e0e0e0;">
              <td style="padding:14px 0;color:#0d0d0f;font-weight:bold;font-size:16px;" colspan="2">Total</td>
              <td style="padding:14px 0;text-align:right;color:#ff5b1f;font-size:22px;font-weight:bold;">${fmtMoney(total)}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:10px 30px 20px;">
          <div style="background:#1f8a3f;color:#fff;padding:16px;text-align:center;border-radius:4px;">
            <p style="margin:0;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:700;">📦 Envío gratis · Correo Argentino</p>
          </div>
        </td></tr>
        <tr><td style="padding:0 30px 20px;">
          <p style="margin:0 0 6px;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Dirección de envío</p>
          <p style="margin:0;color:#0d0d0f;font-size:15px;line-height:1.6;">
            ${payer.address}${payer.floor ? ` · ${payer.floor}` : ''}<br>
            ${payer.city} · CP ${payer.cp}
          </p>
        </td></tr>
        <tr><td style="padding:0 30px 20px;">
          <p style="margin:0 0 6px;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Tiempo estimado</p>
          <p style="margin:0;color:#0d0d0f;font-size:15px;">3 a 7 días hábiles según el destino</p>
        </td></tr>
        <tr><td style="background:#f4f4f1;padding:24px 30px;text-align:center;">
          <p style="margin:0;color:#0d0d0f;font-size:14px;font-weight:bold;">¿Necesitás ayuda?</p>
          <p style="margin:10px 0 0;">
            <a href="https://wa.me/${WHATSAPP_NUMBER}" style="display:inline-block;background:#25d366;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-size:14px;font-weight:bold;">💬 WhatsApp</a>
            <a href="mailto:microfloor1@hotmail.com" style="display:inline-block;background:#0d0d0f;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-size:14px;font-weight:bold;margin-left:8px;">✉ Email</a>
          </p>
        </td></tr>
        <tr><td style="background:#0d0d0f;padding:20px;text-align:center;">
          <p style="margin:0;color:#9a9b9f;font-size:11px;">OXIDUR · HIDROSOL SRL · Industria Argentina</p>
          <p style="margin:6px 0 0;color:#9a9b9f;font-size:11px;">tiendaoxidur.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function notificarVenta({ payer, items, paymentId, orderRef, total, envioResult }) {
  const itemSummary = items.map(i => `${i.title} ×${i.quantity}`).join(', ');

  if (ADMIN_EMAILS.length > 0) {
    const r = await sendEmail({
      to: ADMIN_EMAILS,
      subject: `🛒 Nueva venta · ${fmtMoney(total)} · ${itemSummary}`,
      html: buildAdminEmail({ payer, items, paymentId, orderRef, total, envioResult }),
      replyTo: payer.email
    });
    console.log(r.ok ? `📧 Email admin enviado` : `❌ Email admin falló: ${r.error}`);
  }

  if (payer.email) {
    const r = await sendEmail({
      to: payer.email,
      subject: `¡Gracias por tu compra en OXIDUR! 🎉 · ${orderRef}`,
      html: buildClientEmail({ payer, items, orderRef, total, envioResult })
    });
    console.log(r.ok ? `📧 Email cliente enviado` : `❌ Email cliente falló: ${r.error}`);
  }
}

// ============================================================
// HEALTH CHECK + Test endpoints
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mp: !!MP_ACCESS_TOKEN,
    correo: !!CORREO_USER && !!CORREO_PASSWORD,
    correoMode: CORREO_MODE,
    correoCustomerId: cachedCustomerId || null,
    resend: !!RESEND_API_KEY,
    adminEmails: ADMIN_EMAILS.length
  });
});

app.get('/api/email/test', async (req, res) => {
  if (!RESEND_API_KEY) {
    return res.status(400).json({ ok: false, error: 'RESEND_API_KEY no configurada' });
  }
  const fakePayer = {
    name: 'Cliente de Prueba',
    email: req.query.email || ADMIN_EMAILS[0] || NOTIFY_EMAIL,
    phone: '1158533291',
    dni: '30.123.456',
    address: 'Av. Corrientes 1234',
    city: 'CABA',
    cp: '1414'
  };
  const fakeItems = [{ title: 'OXIDUR Negro - 1 LITRO', quantity: 1, unit_price: 8500 }];
  await notificarVenta({
    payer: fakePayer,
    items: fakeItems,
    paymentId: 'TEST-PAYMENT-001',
    orderRef: 'OXIDUR-TEST-' + Date.now(),
    total: 8500,
    envioResult: { ok: false, error: 'Esto es una prueba' }
  });
  res.json({
    ok: true,
    message: 'Email de prueba enviado',
    to_admin: ADMIN_EMAILS,
    to_client: fakePayer.email
  });
});

// ============================================================
// ARRANQUE
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ OXIDUR server corriendo en puerto ${PORT}`);
  console.log(`   MP: ${!!MP_ACCESS_TOKEN ? 'sí' : 'no'}`);
  console.log(`   MiCorreo: ${!!CORREO_USER && !!CORREO_PASSWORD ? 'sí' : 'no'} (modo: ${CORREO_MODE})`);
  console.log(`   Resend: ${!!RESEND_API_KEY ? 'sí' : 'no'}`);
  console.log(`   Admin emails: ${ADMIN_EMAILS.join(', ') || 'ninguno'}`);
});
