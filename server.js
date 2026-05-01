// ============================================================
// OXIDUR · Backend para MercadoPago
// ============================================================

const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Sirve el frontend (index.html, media, etc.)

// ==================== CONFIGURACIÓN ====================
// ⚠️ REEMPLAZÁ ESTO CON TUS CREDENCIALES REALES DE PRODUCCIÓN
const MP_ACCESS_TOKEN = 'APP_USR-3928310919354671-043022-0e5e8ce01f6fea12c09fe9a17324ae78-246366612'; // ← Tu Access Token real

const SITE_URL = 'https://tiendaoxidur.com';   // ← Cambia por tu dominio real

const mpClient = new MercadoPagoConfig({ 
  accessToken: MP_ACCESS_TOKEN 
});

// ==================== CREAR PREFERENCIA ====================
app.post('/api/create-preference', async (req, res) => {
  try {
    const { items, payer } = req.body;

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
          identification: { 
            type: 'DNI', 
            number: payer.dni 
          },
          address: {
            street_name: payer.address,
            zip_code: payer.cp
          }
        },

        shipments: {
          cost: 0,
          mode: 'not_specified'
        },

        back_urls: {
          success: `${SITE_URL}/gracias.html`,
          failure: `${SITE_URL}/error.html`,
          pending: `${SITE_URL}/pendiente.html`
        },

        auto_return: 'approved',
        statement_descriptor: 'OXIDUR',
        notification_url: `${SITE_URL}/api/webhook`
      }
    });

    res.json({
      id: result.id,
      init_point: result.init_point
    });

  } catch (err) {
    console.error('Error creando preferencia:', err);
    res.status(500).json({ 
      error: 'No se pudo crear la preferencia de pago' 
    });
  }
});

// ==================== WEBHOOK ====================
app.post('/api/webhook', (req, res) => {
  console.log('Webhook recibido:', req.body);
  res.sendStatus(200);
});

// ==================== INICIO ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ OXIDUR server corriendo en puerto ${PORT}`);
});