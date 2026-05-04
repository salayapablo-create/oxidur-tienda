// ============================================================
// OXIDUR · Backend
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

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'PEGAR_AQUI_PARA_TESTING_LOCAL';
const ENVIA_API_KEY   = process.env.ENVIA_API_KEY   || 'PEGAR_AQUI_PARA_TESTING_LOCAL';
const SITE_URL        = process.env.SITE_URL        || 'http://localhost:3000';
const NOTIFY_EMAIL    = process.env.NOTIFY_EMAIL    || 'microfloor1@hotmail.com';

const ENVIA_MODE = process.env.ENVIA_MODE || 'test';
const ENVIA_BASE_URL = ENVIA_MODE === 'production'
  ? 'https://api.envia.com'
  : 'https://api-test.envia.com';

// ----- Datos del REMITENTE ---------------------------
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

// ----- Especificaciones de productos -----------------
const PRODUCT_SPECS = {
  '1l': { weight: 1.1, length: 12, width: 12, height: 15, name: 'OXIDUR 1L' },
  '4l': { weight: 4.2, length: 18, width: 18, height: 22, name: 'OXIDUR 4L' }
};

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
    console.error('Error creando preferencia MP:', err);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});

// ============================================================
// WEBHOOK MERCADOPAGO
// ============================================================

app.post('/api/webhook/mercadopago', async (req, res) => {
  res.sendStatus(200);

  try {
    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return;

    const payment = new Payment(mpClient);
    const paymentInfo = await payment.get({ id: data.id });

    if (paymentInfo.status !== 'approved') {
      console.log(`Pago ${data.id} en estado ${paymentInfo.status}`);
      return;
    }

    console.log(`✅ Pago ${data.id} aprobado. Generando guía...`);

    const payer = JSON.parse(paymentInfo.metadata?.payer_full || '{}');
    const items = JSON.parse(paymentInfo.metadata?.items_full || '[]');
    const orderRef = paymentInfo.external_reference || `MP-${data.id}`;

    const envioResult = await crearEnvio({ payer, items, orderRef });

    if (envioResult.ok) {
      console.log(`📦 Guía generada: ${envioResult.tracking || envioResult.shipmentId}`);
    } else {
      console.error('❌ Error generando guía:', envioResult.error);
    }
  } catch (err) {
    console.error('Error en webhook:', err);
  }
});

// ============================================================
// ENVIA.COM - FUNCIÓN PRINCIPAL (CORREGIDA)
// ============================================================

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
        phone: payer.phone || '',
        street: payer.address,
        number: '',                    // ← Mejor vacío
        district: payer.city || 'CABA',
        city: payer.city || 'CABA',
        state: 'B',                    // Puedes mejorar esto con un selector de provincia
        country: 'AR',
        postalCode: payer.cp,
        reference: ''
      },
      packages,
      shipment: {
        carrier: 'andreani',
        type: 1,
        service: 'estandar'            // ← Agregado (importante)
      },
      settings: {
        currency: 'ARS',
        printFormat: 'PDF',
        printSize: 'PAPER_4X6'         // ← Obligatorio
      },
      additionalServices: [],
      sendEmail: true,
      additionalInfo: `Pedido OXIDUR ${orderRef}`
    };

    console.log('📤 Enviando payload a Envia...');

    const response = await axios.post(
      `${ENVIA_BASE_URL}/ship/generate/`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${ENVIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
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
      console.error('Respuesta inesperada de Envia:', JSON.stringify(data, null, 2));
      return { ok: false, error: data.message || 'Respuesta inesperada', raw: data };
    }
  } catch (err) {
    console.error('❌ Error en llamada a Envia:');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
    return {
      ok: false,
      error: err.response?.data?.message || err.message,
      raw: err.response?.data
    };
  }
}

// ============================================================
// BUILD PACKAGES (sin cambios, estaba bien)
// ============================================================

function buildPackages(items) {
  const packages = [];
  for (const item of items) {
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
          width: spec.width,
          height: spec.height
        },
        insurance: 0,
        declaredValue: item.unit_price
      });
    }
  }
  return packages;
}

// ============================================================
// ENDPOINTS AUXILIARES
// ============================================================

app.post('/api/envia/crear', async (req, res) => {
  const result = await crearEnvio(req.body);
  res.json(result);
});

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
      shipment: { carrier: 'andreani', type: 1 },
      settings: { currency: 'ARS' }
    };

    const response = await axios.post(`${ENVIA_BASE_URL}/ship/rate/`, payload, {
      headers: { 'Authorization': `Bearer ${ENVIA_API_KEY}` }
    });

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mp: !!MP_ACCESS_TOKEN && !MP_ACCESS_TOKEN.includes('PEGAR'),
    envia: !!ENVIA_API_KEY && !ENVIA_API_KEY.includes('PEGAR'),
    enviaMode: ENVIA_MODE
  });
});

// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ OXIDUR server corriendo en puerto ${PORT}`);
  console.log(`   Modo Envia: ${ENVIA_MODE}`);
});
