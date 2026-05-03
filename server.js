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

    // Generar guía en Envia
    const envioResult = await crearEnvio({ payer, items, orderRef });

    if (envioResult.ok) {
      console.log(`📦 Guía generada: ${envioResult.tracking || envioResult.shipmentId}`);
      // Acá podés mandar un email al cliente con el tracking, etc.
    } else {
      console.error('❌ Error generando guía:', envioResult.error);
      // Mandar email de alerta al admin para gestionar manualmente
    }
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
        carrier: 'andreani',       // o 'oca', 'correoargentino' — ver cuál tenés mejor tarifado en Envia
        type: 1,                    // 1 = paquete estándar
        service: 'estandar'         // estandar | urgente | sucursal — depende del carrier
      },
      settings: {
        currency: 'ARS'
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
      shipment: { carrier: 'andreani', type: 1, service: 'estandar' },
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
 * Endpoint que lista los servicios disponibles para un carrier
 * (para descubrir cuáles tenés habilitados en tu cuenta)
 */
app.get('/api/envia/servicios', async (req, res) => {
  try {
    const carrier = req.query.carrier || 'andreani';
    const response = await axios.get(
      `${ENVIA_BASE_URL}/queries/carriers/${carrier}/AR`,
      {
        headers: { 'Authorization': `Bearer ${ENVIA_API_KEY}` },
        timeout: 15000
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({
      error: err.response?.data?.message || err.message,
      detail: err.response?.data
    });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mp: !!MP_ACCESS_TOKEN && !MP_ACCESS_TOKEN.includes('PEGAR'),
    envia: !!ENVIA_API_KEY && !ENVIA_API_KEY.includes('PEGAR'),
    enviaMode: ENVIA_MODE
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
});
