// ============================================================
// OXIDUR · Backend mínimo para MercadoPago
// ============================================================
// Este server corre en Node.js y crea las "preferencias" de pago
// que el frontend usa para redirigir al checkout de MercadoPago.
//
// INSTALACIÓN:
//   npm init -y
//   npm install express mercadopago cors
//   node server.js
//
// ============================================================

const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // sirve el frontend

// ⚠️ REEMPLAZAR con tu Access Token real de MercadoPago
// Lo conseguís en: https://www.mercadopago.com.ar/developers/panel
const MP_ACCESS_TOKEN = 'TEST-xxxxxxxxxxxxxxxx-xxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxx';

// URL pública de tu sitio (cambiala cuando subas a producción)
const SITE_URL = 'http://localhost:3000';

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// Endpoint que el frontend llama para iniciar el pago
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
          identification: { type: 'DNI', number: payer.dni },
          address: {
            street_name: payer.address,
            zip_code: payer.cp
          }
        },
        shipments: {
          cost: 0, // envío gratis
          mode: 'not_specified'
        },
        back_urls: {
          success: `${SITE_URL}/gracias.html`,
          failure: `${SITE_URL}/error.html`,
          pending: `${SITE_URL}/pendiente.html`
        },
        auto_return: 'approved',
        statement_descriptor: 'OXIDUR',
        notification_url: `${SITE_URL}/api/webhook` // opcional: para recibir notificaciones
      }
    });

    res.json({
      id: result.id,
      init_point: result.init_point // URL a la que redirigir al usuario
    });
  } catch (err) {
    console.error('Error creando preferencia:', err);
    res.status(500).json({ error: 'No se pudo crear la preferencia de pago' });
  }
});

// Webhook (opcional): MercadoPago notifica acá los cambios de estado
app.post('/api/webhook', (req, res) => {
  console.log('Webhook recibido:', req.body);
  // Acá podés actualizar tu base de datos, mandar emails, etc.
  res.sendStatus(200);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ OXIDUR server corriendo en http://localhost:${PORT}`);
});
