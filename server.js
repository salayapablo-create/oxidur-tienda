// ============================================================
// OXIDUR · Backend
// ============================================================
// Integraciones:
//   - MercadoPago (cobro)
//   - Envia.com (generación automática de guía cuando se cobra)
//   - Webhook que conecta MP → Envia
//
// INSTALACIÓN LOCAL:
//   npm init -y
//   npm install express cors mercadopago axios dotenv
//   node server.js
//
// VARIABLES DE ENTORNO (configurar en Render / archivo .env):
//   MP_ACCESS_TOKEN       Access Token de MercadoPago
//   ENVIA_API_KEY         API Key de Envia.com
//   SITE_URL              URL pública del sitio (ej: https://oxidur.com.ar)
//   NOTIFY_EMAIL          Email donde recibís las notificaciones de pedidos
//
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // sirve el frontend

// ============================================================
// CONFIGURACIÓN
// ============================================================

// Credenciales (leídas de variables de entorno por seguridad)
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'PEGAR_AQUI_PARA_TESTING_LOCAL';
const ENVIA_API_KEY   = process.env.ENVIA_API_KEY   || 'PEGAR_AQUI_PARA_TESTING_LOCAL';
const SITE_URL        = process.env.SITE_URL        || 'http://localhost:3000';
const NOTIFY_EMAIL    = process.env.NOTIFY_EMAIL    || 'microfloor1@hotmail.com';

// Modo de Envia: "test" para sandbox, "production" para real
const ENVIA_MODE = process.env.ENVIA_MODE || 'test';
const ENVIA_BASE_URL = ENVIA_MODE === 'production'
  ? 'https://api.envia.com'
  : 'https://api-test.envia.com'; // sandbox oficial

// ----- RESEND (envío de emails) -----------------------------
// Conseguí tu API Key en https://resend.com/api-keys (3.000 emails gratis/mes)
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
// Mail "de" que aparece en los correos. En modo prueba podés usar el default de Resend.
const EMAIL_FROM = process.env.EMAIL_FROM || 'OXIDUR <onboarding@resend.dev>';
// Lista de mails del admin separados por coma (ej: "uno@x.com,dos@y.com")
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || NOTIFY_EMAIL)
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);
// WhatsApp para mostrar en el mail al cliente
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '5491158533291';

// ----- Datos del REMITENTE (HIDROSOL SRL) -------------------
const SENDER = {
  name: 'HIDROSOL SRL',
  company: 'HIDROSOL SRL',
  email: 'microfloor1@hotmail.com',
  phone: '1158533291',
  street: 'Gral. Heredia',
  number: '2353',
  district: 'Avellaneda',
  city: 'Avellaneda',
  state: { name: 'Buenos Aires', code: 'B' },
  country: 'AR',
  postalCode: '1870',
  reference: 'Entre Ferré y Magán'
};

// ----- Catálogo de productos físicos ------------------------
// Pesos en kg, dimensiones en cm (caja de envío)
const PRODUCT_SPECS = {
  '1l': { weight: 1.1, length: 12, width: 12, height: 15, name: 'OXIDUR 1L' },
  '4l': { weight: 4.2, length: 18, width: 18, height: 22, name: 'OXIDUR 4L' }
};

// ============================================================
// MERCADOPAGO: Crear preferencia de pago
// ============================================================

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

app.post('/api/create-preference', async (req, res) => {
  try {
    const { items, payer } = req.body;

    // Validación básica
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
        shipments: {
          cost: 0,                  // envío gratis para el cliente
          mode: 'not_specified'
        },
        back_urls: {
          success: `${SITE_URL}/gracias.html`,
          failure: `${SITE_URL}/error.html`,
          pending: `${SITE_URL}/pendiente.html`
        },
        auto_return: 'approved',
        statement_descriptor: 'OXIDUR',
        notification_url: `${SITE_URL}/api/webhook/mercadopago`,
        // Metadata: guardamos los datos del pedido para usar después en Envia
        metadata: {
          payer_full: JSON.stringify(payer),
          items_full: JSON.stringify(items)
        },
        external_reference: `OXIDUR-${Date.now()}`
      }
    });

    res.json({
      id: result.id,
      init_point: result.init_point
    });
  } catch (err) {
    console.error('Error creando preferencia:', err);
    res.status(500).json({ error: 'No se pudo crear la preferencia de pago' });
  }
});

// ============================================================
// WEBHOOK MercadoPago: cuando se acredita un pago, generamos la guía
// ============================================================

app.post('/api/webhook/mercadopago', async (req, res) => {
  // Respondemos rápido para no hacer timeout (MP reintenta si tarda mucho)
  res.sendStatus(200);

  try {
    const { type, data } = req.body;

    // Solo nos interesa cuando hay un pago
    if (type !== 'payment' || !data?.id) {
      console.log('Webhook ignorado (no es pago):', type);
      return;
    }

    // Buscar el pago real en MercadoPago para confirmar que fue aprobado
    const payment = new Payment(mpClient);
    const paymentInfo = await payment.get({ id: data.id });

    if (paymentInfo.status !== 'approved') {
      console.log(`Pago ${data.id} en estado ${paymentInfo.status}, no genero guía aún.`);
      return;
    }

    console.log(`✅ Pago ${data.id} aprobado. Generando guía con Envia...`);

    // Recuperar los datos del pedido desde la metadata de la preferencia
    const payer = JSON.parse(paymentInfo.metadata?.payer_full || '{}');
    const items = JSON.parse(paymentInfo.metadata?.items_full || '[]');
    const orderRef = paymentInfo.external_reference || `MP-${data.id}`;
    const total = items.reduce((s, i) => s + (i.unit_price * i.quantity), 0);

    // Generar guía en Envia
    const envioResult = await crearEnvio({ payer, items, orderRef });

    if (envioResult.ok) {
      console.log(`📦 Guía generada: ${envioResult.tracking || envioResult.shipmentId}`);
    } else {
      console.error('❌ Error generando guía:', envioResult.error);
    }

    // Notificar por mail siempre, haya andado Envia o no
    // (si Envia falló, el admin recibe alerta y genera la guía a mano)
    await notificarVenta({
      payer, items, paymentId: data.id, orderRef, total, envioResult
    });
  } catch (err) {
    console.error('Error procesando webhook MP:', err);
  }
});

// ============================================================
// ENVIA.COM: Funciones de cotización y generación de guía
// ============================================================

/**
 * Convierte el carrito a la lista de paquetes que entiende Envia.
 * Cada presentación (1L o 4L) es una caja independiente porque
 * tienen pesos y medidas distintas.
 */
function buildPackages(items) {
  const packages = [];
  for (const item of items) {
    // Inferir el size desde el title del item (ej: "OXIDUR Negro - 1 LITRO")
    const isFourLiters = /4\s*LITROS?/i.test(item.title);
    const spec = isFourLiters ? PRODUCT_SPECS['4l'] : PRODUCT_SPECS['1l'];

    for (let i = 0; i < item.quantity; i++) {
      packages.push({
        content: spec.name,
        amount: 1,
        type: 'box',
        weight: spec.weight,
        weightUnit: 'KG',
        lengthUnit: 'CM',
        dimensions: {
          length: spec.length,
          width:  spec.width,
          height: spec.height
        },
        insurance: 0,
        declaredValue: item.unit_price
      });
    }
  }
  return packages;
}

/**
 * Genera el envío en Envia.com (un endpoint que cotiza y crea la guía).
 */
async function crearEnvio({ payer, items, orderRef }) {
  try {
    const packages = buildPackages(items);

    const payload = {
      origin: {
        name: SENDER.name,
        company: SENDER.company,
        email: SENDER.email,
        phone: SENDER.phone,
        street: SENDER.street,
        number: SENDER.number,
        district: SENDER.district,
        city: SENDER.city,
        state: SENDER.state.code,
        country: SENDER.country,
        postalCode: SENDER.postalCode,
        reference: SENDER.reference
      },
      destination: {
        name: payer.name,
        company: payer.name,
        email: payer.email,
        phone: payer.phone,
        street: payer.address,
        number: 'S/N',
        district: payer.city || 'CABA',
        city: payer.city || 'CABA',
        state: 'B',                // por defecto Bs. As. (mejorable con un mapeo de provincia)
        country: 'AR',
        postalCode: payer.cp,
        reference: ''
      },
      packages,
      shipment: {
        carrier: 'oca',             // Andreani / OCA / correoargentino
        type: 1,                    // 1 = paquete estándar
        service: 'estandar'         // estandar | urgente | sucursal — depende del carrier
      },
      settings: {
        currency: 'ARS',
        printFormat: 'PDF',         // PDF | ZPL | PNG — formato de la etiqueta
        printSize: 'STOCK_4X6',     // tamaño de la etiqueta
        comments: `Pedido ${orderRef}`
      },
      additionalServices: [],
      sendEmail: true,             // que Envia mande email al cliente con el tracking
      additionalInfo: `Pedido OXIDUR ${orderRef}`
    };

    const response = await axios.post(
      `${ENVIA_BASE_URL}/ship/generate/`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${ENVIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const data = response.data;
    if (data.meta === 'generate' && data.data?.length > 0) {
      const shipment = data.data[0];
      return {
        ok: true,
        shipmentId: shipment.shipmentId,
        tracking: shipment.trackingNumber,
        labelUrl: shipment.label,
        carrier: shipment.carrier
      };
    } else {
      // Logueamos la respuesta completa para diagnosticar
      console.error('Respuesta inesperada de Envia:');
      console.error(JSON.stringify(data, null, 2));

      // Extraer mensaje legible del error
      let errorMsg = 'Respuesta inesperada de Envia';
      if (typeof data.message === 'string') errorMsg = data.message;
      else if (typeof data.error === 'string') errorMsg = data.error;
      else if (data.error?.message) errorMsg = data.error.message;
      else if (data.error?.description) errorMsg = data.error.description;

      return {
        ok: false,
        error: errorMsg,
        raw: data
      };
    }
  } catch (err) {
    // Logueamos el detalle completo del error
    console.error('Error en llamada a Envia:');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Mensaje:', err.message);
    }

    // Extraer mensaje legible
    const errData = err.response?.data;
    let errorMsg = err.message;
    if (errData?.error?.message) errorMsg = errData.error.message;
    else if (errData?.error?.description) errorMsg = errData.error.description;
    else if (errData?.message) errorMsg = errData.message;

    return {
      ok: false,
      error: errorMsg,
      raw: errData
    };
  }
}

// ============================================================
// EMAILS (Resend)
// ============================================================

const fmtMoney = n => '$' + Number(n).toLocaleString('es-AR');

/**
 * Manda un email vía Resend.
 * Si no está configurada la API Key, no falla pero loguea aviso.
 */
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
    console.error('Error mandando email:');
    console.error(err.response?.data || err.message);
    return {
      ok: false,
      error: err.response?.data?.message || err.message
    };
  }
}

/**
 * Plantilla HTML para el email al admin (Hidrosol)
 */
function buildAdminEmail({ payer, items, paymentId, orderRef, total, envioResult }) {
  const itemsRows = items.map(i => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;">${i.title}</td>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;text-align:center;">${i.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;text-align:right;">${fmtMoney(i.unit_price)}</td>
      <td style="padding:10px;border-bottom:1px solid #2a2c33;text-align:right;font-weight:bold;">${fmtMoney(i.unit_price * i.quantity)}</td>
    </tr>
  `).join('');

  let envioBlock = '';
  if (envioResult?.ok) {
    envioBlock = `
      <div style="background:#1a4d2e;border-left:4px solid #2ecc71;padding:14px;margin:18px 0;border-radius:4px;">
        <p style="margin:0;color:#7eddb1;font-weight:bold;">✓ Guía generada automáticamente</p>
        <p style="margin:6px 0 0;color:#fff;font-size:14px;">
          Tracking: <strong>${envioResult.tracking || envioResult.shipmentId}</strong><br>
          ${envioResult.carrier ? `Carrier: ${envioResult.carrier}<br>` : ''}
          ${envioResult.labelUrl ? `<a href="${envioResult.labelUrl}" style="color:#ff5b1f;">📄 Descargar etiqueta PDF</a>` : ''}
        </p>
      </div>
    `;
  } else {
    envioBlock = `
      <div style="background:#4d1a1a;border-left:4px solid #e74c3c;padding:14px;margin:18px 0;border-radius:4px;">
        <p style="margin:0;color:#ffb0b0;font-weight:bold;">⚠ Guía NO generada — generala manualmente</p>
        <p style="margin:6px 0 0;color:#fff;font-size:14px;">
          Error: ${envioResult?.error || 'Sin detalle'}<br>
          Andá al panel de Envia.com y creá la guía a mano con los datos del cliente.
        </p>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0d0d0f;font-family:-apple-system,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0f;padding:24px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#15161a;border:1px solid #2a2c33;max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr><td style="background:#ff5b1f;padding:24px;text-align:center;">
          <h1 style="margin:0;color:#0d0d0f;font-size:14px;letter-spacing:0.2em;text-transform:uppercase;font-weight:800;">🛒 Nueva venta · OXIDUR</h1>
        </td></tr>

        <!-- TÍTULO -->
        <tr><td style="padding:30px 30px 10px;">
          <p style="margin:0;color:#9a9b9f;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;">Pedido</p>
          <h2 style="margin:6px 0 0;color:#fff;font-size:28px;letter-spacing:0.02em;">${orderRef}</h2>
          <p style="margin:6px 0 0;color:#ff5b1f;font-size:32px;font-weight:bold;">${fmtMoney(total)}</p>
        </td></tr>

        <!-- ESTADO ENVIO -->
        <tr><td style="padding:0 30px;">${envioBlock}</td></tr>

        <!-- PRODUCTOS -->
        <tr><td style="padding:20px 30px;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Productos</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="color:#fff;font-size:14px;">
            <thead>
              <tr style="border-bottom:2px solid #2a2c33;">
                <th style="padding:10px;text-align:left;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Producto</th>
                <th style="padding:10px;text-align:center;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Cant</th>
                <th style="padding:10px;text-align:right;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Precio</th>
                <th style="padding:10px;text-align:right;color:#9a9b9f;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
            <tfoot>
              <tr><td colspan="3" style="padding:14px 10px;text-align:right;color:#fff;font-size:16px;">Total cobrado:</td>
              <td style="padding:14px 10px;text-align:right;color:#ff5b1f;font-size:20px;font-weight:bold;">${fmtMoney(total)}</td></tr>
            </tfoot>
          </table>
        </td></tr>

        <!-- CLIENTE -->
        <tr><td style="padding:20px 30px;border-top:1px solid #2a2c33;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Cliente</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="color:#fff;font-size:14px;">
            <tr><td style="padding:6px 0;color:#9a9b9f;width:120px;">Nombre:</td><td style="padding:6px 0;font-weight:bold;">${payer.name || '-'}</td></tr>
            <tr><td style="padding:6px 0;color:#9a9b9f;">Email:</td><td style="padding:6px 0;"><a href="mailto:${payer.email}" style="color:#ff5b1f;">${payer.email || '-'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#9a9b9f;">Teléfono:</td><td style="padding:6px 0;"><a href="https://wa.me/${(payer.phone||'').replace(/\D/g,'')}" style="color:#ff5b1f;">${payer.phone || '-'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#9a9b9f;">DNI:</td><td style="padding:6px 0;">${payer.dni || '-'}</td></tr>
          </table>
        </td></tr>

        <!-- ENVIO -->
        <tr><td style="padding:20px 30px;border-top:1px solid #2a2c33;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Dirección de envío</h3>
          <p style="margin:0;color:#fff;font-size:15px;line-height:1.6;">
            ${payer.address || '-'}<br>
            ${payer.city || '-'} · CP <strong>${payer.cp || '-'}</strong>
          </p>
        </td></tr>

        <!-- PAGO -->
        <tr><td style="padding:20px 30px;border-top:1px solid #2a2c33;">
          <h3 style="color:#ff5b1f;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 12px;">Pago</h3>
          <p style="margin:0;color:#fff;font-size:14px;">
            <span style="color:#9a9b9f;">ID MercadoPago:</span> <strong>${paymentId}</strong><br>
            <span style="color:#9a9b9f;">Estado:</span> <span style="color:#2ecc71;font-weight:bold;">Aprobado</span>
          </p>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#0d0d0f;padding:18px;text-align:center;border-top:1px solid #2a2c33;">
          <p style="margin:0;color:#9a9b9f;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">OXIDUR · Notificación automática · ${new Date().toLocaleString('es-AR')}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `;
}

/**
 * Plantilla HTML para el email al cliente
 */
function buildClientEmail({ payer, items, orderRef, total, envioResult }) {
  const itemsRows = items.map(i => `
    <tr>
      <td style="padding:12px 0;color:#0d0d0f;">${i.title}</td>
      <td style="padding:12px 0;text-align:center;color:#0d0d0f;">×${i.quantity}</td>
      <td style="padding:12px 0;text-align:right;color:#0d0d0f;font-weight:bold;">${fmtMoney(i.unit_price * i.quantity)}</td>
    </tr>
  `).join('');

  const trackingBlock = envioResult?.ok && envioResult?.tracking ? `
    <div style="background:#fff8f0;border:2px solid #ff5b1f;padding:18px;margin:20px 0;border-radius:6px;text-align:center;">
      <p style="margin:0;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Tu número de tracking</p>
      <p style="margin:8px 0 0;color:#ff5b1f;font-size:24px;font-weight:bold;letter-spacing:0.04em;">${envioResult.tracking}</p>
      <p style="margin:8px 0 0;color:#9a9b9f;font-size:13px;">Vas a recibir un email del transportista con el seguimiento en detalle.</p>
    </div>
  ` : `
    <div style="background:#fff8f0;border:2px solid #ff5b1f;padding:18px;margin:20px 0;border-radius:6px;text-align:center;">
      <p style="margin:0;color:#0d0d0f;font-size:14px;">Estamos preparando tu envío. En las próximas horas te llega un mail con el número de tracking.</p>
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:24px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;max-width:600px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- HEADER NEGRO -->
        <tr><td style="background:#0d0d0f;padding:30px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:32px;letter-spacing:0.06em;font-weight:800;">OXIDUR</h1>
          <p style="margin:6px 0 0;color:#ff5b1f;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;">Esmalte Antioxidante</p>
        </td></tr>

        <!-- BANNER NARANJA -->
        <tr><td style="background:#ff5b1f;padding:24px;text-align:center;">
          <h2 style="margin:0;color:#0d0d0f;font-size:26px;letter-spacing:0.02em;">¡Gracias por tu compra!</h2>
        </td></tr>

        <!-- SALUDO -->
        <tr><td style="padding:30px 30px 0;">
          <p style="margin:0;color:#0d0d0f;font-size:16px;line-height:1.6;">Hola <strong>${payer.name?.split(' ')[0] || 'amigx'}</strong>,</p>
          <p style="margin:14px 0 0;color:#5a5a5a;font-size:15px;line-height:1.6;">Recibimos tu pedido y ya estamos preparándolo. Te contamos los detalles:</p>
        </td></tr>

        <!-- TRACKING -->
        <tr><td style="padding:0 30px;">${trackingBlock}</td></tr>

        <!-- PEDIDO -->
        <tr><td style="padding:10px 30px;">
          <p style="margin:0 0 6px;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Número de pedido</p>
          <p style="margin:0;color:#0d0d0f;font-size:18px;font-weight:bold;">${orderRef}</p>
        </td></tr>

        <!-- PRODUCTOS -->
        <tr><td style="padding:20px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #0d0d0f;border-bottom:2px solid #0d0d0f;">
            ${itemsRows}
            <tr style="border-top:1px solid #e0e0e0;">
              <td style="padding:14px 0;color:#0d0d0f;font-weight:bold;font-size:16px;" colspan="2">Total</td>
              <td style="padding:14px 0;text-align:right;color:#ff5b1f;font-size:22px;font-weight:bold;">${fmtMoney(total)}</td>
            </tr>
          </table>
        </td></tr>

        <!-- ENVIO GRATIS -->
        <tr><td style="padding:10px 30px 20px;">
          <div style="background:#1f8a3f;color:#fff;padding:16px;text-align:center;border-radius:4px;">
            <p style="margin:0;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:700;">📦 Envío gratis a todo el país</p>
          </div>
        </td></tr>

        <!-- DIRECCIÓN -->
        <tr><td style="padding:0 30px 20px;">
          <p style="margin:0 0 6px;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Dirección de envío</p>
          <p style="margin:0;color:#0d0d0f;font-size:15px;line-height:1.6;">
            ${payer.address}<br>
            ${payer.city} · CP ${payer.cp}
          </p>
        </td></tr>

        <!-- TIEMPOS -->
        <tr><td style="padding:0 30px 20px;">
          <p style="margin:0 0 6px;color:#9a9b9f;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-weight:bold;">Tiempo estimado de entrega</p>
          <p style="margin:0;color:#0d0d0f;font-size:15px;">3 a 7 días hábiles según el destino</p>
        </td></tr>

        <!-- CONTACTO -->
        <tr><td style="background:#f4f4f1;padding:24px 30px;text-align:center;">
          <p style="margin:0;color:#0d0d0f;font-size:14px;font-weight:bold;">¿Necesitás ayuda?</p>
          <p style="margin:10px 0 0;">
            <a href="https://wa.me/${WHATSAPP_NUMBER}" style="display:inline-block;background:#25d366;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-size:14px;font-weight:bold;">💬 WhatsApp</a>
            <a href="mailto:microfloor1@hotmail.com" style="display:inline-block;background:#0d0d0f;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-size:14px;font-weight:bold;margin-left:8px;">✉ Email</a>
          </p>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#0d0d0f;padding:20px;text-align:center;">
          <p style="margin:0;color:#9a9b9f;font-size:11px;">OXIDUR · HIDROSOL SRL · Industria Argentina</p>
          <p style="margin:6px 0 0;color:#9a9b9f;font-size:11px;">tiendaoxidur.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `;
}

/**
 * Notificar la venta por mail al admin y al cliente.
 * Se llama después de que se acredita el pago.
 */
async function notificarVenta({ payer, items, paymentId, orderRef, total, envioResult }) {
  const itemSummary = items.map(i => `${i.title} ×${i.quantity}`).join(', ');

  // Email al admin
  if (ADMIN_EMAILS.length > 0) {
    const adminResult = await sendEmail({
      to: ADMIN_EMAILS,
      subject: `🛒 Nueva venta · ${fmtMoney(total)} · ${itemSummary}`,
      html: buildAdminEmail({ payer, items, paymentId, orderRef, total, envioResult }),
      replyTo: payer.email
    });
    console.log(adminResult.ok
      ? `📧 Email a admin enviado: ${ADMIN_EMAILS.join(', ')}`
      : `❌ Email admin falló: ${adminResult.error}`);
  }

  // Email al cliente
  if (payer.email) {
    const clientResult = await sendEmail({
      to: payer.email,
      subject: `¡Gracias por tu compra en OXIDUR! 🎉 · ${orderRef}`,
      html: buildClientEmail({ payer, items, orderRef, total, envioResult })
    });
    console.log(clientResult.ok
      ? `📧 Email a cliente enviado: ${payer.email}`
      : `❌ Email cliente falló: ${clientResult.error}`);
  }
}

/**
 * Endpoint manual para generar guía desde el panel
 * (útil si MP falla o querés generar una guía a mano)
 */
app.post('/api/envia/crear', async (req, res) => {
  const result = await crearEnvio(req.body);
  res.json(result);
});

/**
 * Endpoint para cotizar un envío sin crear guía
 * (no se usa en el flujo de "envío gratis", pero queda disponible
 *  para chequear cuánto te va a costar a vos cada pedido)
 */
app.post('/api/envia/cotizar', async (req, res) => {
  try {
    const { destination, items } = req.body;
    const packages = buildPackages(items);

    const payload = {
      origin: {
        country: SENDER.country,
        postalCode: SENDER.postalCode,
        state: SENDER.state.code,
        city: SENDER.city
      },
      destination: {
        country: 'AR',
        postalCode: destination.cp,
        state: destination.state || 'B',
        city: destination.city || 'CABA'
      },
      packages,
      shipment: { carrier: 'oca', type: 1, service: 'estandar' },
      settings: { currency: 'ARS' }
    };

    const response = await axios.post(
      `${ENVIA_BASE_URL}/ship/rate/`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${ENVIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json({
      error: err.response?.data?.message || err.message
    });
  }
});

/**
 * Endpoint que prueba qué carriers/servicios están disponibles
 * para tu cuenta haciendo una cotización dummy.
 * Usa esto cuando un carrier falla con "Internal error" para descubrir
 * cuál te queda mejor.
 */
app.get('/api/envia/test-carriers', async (req, res) => {
  const carriers = ['oca', 'andreani', 'correoargentino', 'cruzdelsur'];
  const results = {};

  // Cotización dummy: paquete chico de Avellaneda a CABA
  const basePayload = {
    origin: {
      country: 'AR',
      postalCode: SENDER.postalCode,
      state: SENDER.state.code,
      city: SENDER.city,
      district: SENDER.district
    },
    destination: {
      country: 'AR',
      postalCode: '1414',
      state: 'B',
      city: 'CABA',
      district: 'CABA'
    },
    packages: [{
      content: 'Test',
      amount: 1,
      type: 'box',
      weight: 1.1,
      weightUnit: 'KG',
      lengthUnit: 'CM',
      dimensions: { length: 12, width: 12, height: 15 },
      insurance: 0,
      declaredValue: 8500
    }],
    settings: { currency: 'ARS' }
  };

  for (const carrier of carriers) {
    try {
      const r = await axios.post(
        `${ENVIA_BASE_URL}/ship/rate/`,
        { ...basePayload, shipment: { carrier, type: 1 } },
        {
          headers: {
            'Authorization': `Bearer ${ENVIA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      results[carrier] = {
        ok: true,
        data: r.data
      };
    } catch (err) {
      results[carrier] = {
        ok: false,
        status: err.response?.status,
        error: err.response?.data?.error || err.response?.data?.message || err.message,
        raw: err.response?.data
      };
    }
  }

  res.json(results);
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mp: !!MP_ACCESS_TOKEN && !MP_ACCESS_TOKEN.includes('PEGAR'),
    envia: !!ENVIA_API_KEY && !ENVIA_API_KEY.includes('PEGAR'),
    enviaMode: ENVIA_MODE,
    resend: !!RESEND_API_KEY,
    adminEmails: ADMIN_EMAILS.length
  });
});

// Endpoint de prueba de email — manda un mail de muestra a los admins
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
  const fakeItems = [
    { title: 'OXIDUR Negro - 1 LITRO', quantity: 1, unit_price: 8500 }
  ];
  await notificarVenta({
    payer: fakePayer,
    items: fakeItems,
    paymentId: 'TEST-PAYMENT-001',
    orderRef: 'OXIDUR-TEST-' + Date.now(),
    total: 8500,
    envioResult: { ok: false, error: 'Esto es una prueba — la guía no se generó realmente' }
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
  console.log(`   Modo Envia: ${ENVIA_MODE}`);
  console.log(`   MP configurado: ${!!MP_ACCESS_TOKEN && !MP_ACCESS_TOKEN.includes('PEGAR')}`);
  console.log(`   Envia configurado: ${!!ENVIA_API_KEY && !ENVIA_API_KEY.includes('PEGAR')}`);
  console.log(`   Resend (emails): ${!!RESEND_API_KEY ? 'sí' : 'no'}`);
  console.log(`   Admin emails: ${ADMIN_EMAILS.join(', ') || 'ninguno'}`);
});
