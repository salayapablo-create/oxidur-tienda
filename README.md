# OXIDUR · Tienda Online

Tienda e-commerce para HIDROSOL SRL con:
- Catálogo de OXIDUR en 6 colores y 2 presentaciones (1L y 4L)
- Carrito + checkout integrado con **MercadoPago**
- Generación automática de guías de envío con **Envia.com**
- WhatsApp flotante siempre visible
- Envío gratis a todo el país (lo paga HIDROSOL desde su cuenta de Envia)

---

## 🚀 Cómo correrlo localmente (para probar)

### Paso 1: Instalar dependencias

```bash
cd oxidur-store
npm install
```

### Paso 2: Configurar credenciales

Copiá `.env.example` como `.env` y completá los valores:

```bash
cp .env.example .env
```

Editá `.env` y pegá:
- `MP_ACCESS_TOKEN` → Tu Access Token de MercadoPago (panel developers)
- `ENVIA_API_KEY` → Tu API Key de Envia.com
- `ENVIA_MODE=test` (para no generar guías reales mientras probás)

### Paso 3: Arrancar el servidor

```bash
npm start
```

Abrí `http://localhost:3000`. Vas a poder probar todo el flujo de compra.

---

## 🌐 Deploy en producción (Render)

Render es un hosting gratis que corre Node.js. Te doy el paso a paso:

### Paso 1: Subir el código a GitHub

1. Creá una cuenta en https://github.com (si no tenés)
2. Creá un repositorio nuevo, ponele "oxidur-store"
3. Subí el contenido de la carpeta (sin el archivo `.env` — ese tiene secretos)

> ⚠️ El `.gitignore` ya está configurado para que `.env` NUNCA se suba. No lo borres.

### Paso 2: Crear el servicio en Render

1. Andá a https://render.com y registrate (podés usar tu cuenta de GitHub)
2. Hacé clic en **New → Web Service**
3. Conectá tu repositorio de GitHub `oxidur-store`
4. Configurá así:
   - **Name**: oxidur-tienda
   - **Region**: Oregon (US West) o cualquiera
   - **Branch**: main
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### Paso 3: Configurar variables de entorno

En tu nuevo servicio, andá a **Environment** y agregá estas variables (clic en "Add Environment Variable" para cada una):

| Variable | Valor |
|----------|-------|
| `MP_ACCESS_TOKEN` | Tu Access Token de MercadoPago |
| `ENVIA_API_KEY` | Tu API Key de Envia.com |
| `ENVIA_MODE` | `test` para empezar, después `production` |
| `SITE_URL` | La URL que te da Render (ej: `https://oxidur-tienda.onrender.com`) |
| `NOTIFY_EMAIL` | `microfloor1@hotmail.com` |

### Paso 4: Configurar el webhook de MercadoPago

Para que la guía se genere automáticamente cuando se cobra, MercadoPago tiene que avisarle a tu server:

1. Andá al panel de MercadoPago Developers → Tu aplicación → Webhooks
2. Agregá esta URL: `https://oxidur-tienda.onrender.com/api/webhook/mercadopago`
3. Marcá el evento **Pagos** (`payment`)
4. Guardá

### Paso 5: Probar el flujo completo

1. Abrí tu sitio en Render
2. Comprá un producto cualquiera
3. Pagá con una **tarjeta de prueba** de MercadoPago (https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/test-cards)
4. Verificá en los logs de Render que aparezca: `📦 Guía generada: [tracking]`
5. Entrá al panel de Envia y mirá que la guía esté ahí

Cuando todo funcione bien con `ENVIA_MODE=test`, cambiás a `production` y queda todo en vivo.

---

## 📦 Datos de configuración (ya cargados)

**Remitente** (HIDROSOL SRL):
- Dirección: Gral. Heredia 2353, Avellaneda, CP 1870, Bs. As.
- Email: microfloor1@hotmail.com
- Tel: 1158533291

**Productos**:
- OXIDUR 1L: 1,1 kg · caja 12×12×15 cm
- OXIDUR 4L: 4,2 kg · caja 18×18×22 cm

**Carrier por defecto**: Andreani. Si querés cambiar a OCA o Correo Argentino, editá `server.js` línea con `carrier: 'andreani'`.

---

## 🛠 Cómo funciona el flujo de envío

```
1. Cliente entra al sitio
2. Elige color + tamaño + cantidad
3. Hace clic en "Agregar al carrito"
4. Va al checkout, completa datos
5. Hace clic en "Pagar con MercadoPago"
6. Server crea la preferencia de pago en MP
7. Cliente paga en MercadoPago
8. MercadoPago avisa al server vía webhook
9. Server llama a Envia.com → genera guía
10. Cliente recibe email de Envia con tracking
11. HIDROSOL recibe email para imprimir etiqueta
12. Despachan el producto
```

El cliente no paga envío. HIDROSOL paga la tarifa B2B negociada en su cuenta de Envia.

---

## 🔐 Seguridad

- Las credenciales (`MP_ACCESS_TOKEN`, `ENVIA_API_KEY`) **nunca** están en el código que se sube a GitHub
- Se cargan como variables de entorno en Render
- El archivo `.env` local está ignorado por `.gitignore`
- Si una credencial se compromete, regenerala desde el panel correspondiente y actualizá la variable en Render

---

## 📁 Estructura

```
oxidur-store/
├── index.html          ← frontend (tienda)
├── app.js              ← lógica de carrito y checkout
├── server.js           ← backend (MP + Envia)
├── package.json        ← dependencias Node.js
├── .env.example        ← plantilla de variables (sin secretos)
├── .gitignore          ← no sube .env ni node_modules
├── README.md           ← este archivo
└── media/              ← logos, fotos, videos
```

---

## ❓ Solución de problemas comunes

**"No se generó la guía después del pago"**
- Verificá los logs de Render: ¿llegó el webhook de MP?
- Probá llamar manualmente a `/api/health` para ver si las credenciales están bien cargadas

**"El sitio carga pero no procesa pagos"**
- Verificá que `MP_ACCESS_TOKEN` esté configurado en Render
- Probá con credenciales TEST primero, después producción

**"Envía rechaza la dirección del destinatario"**
- Algunos destinos requieren más datos. Editá el campo `state` en el server (por defecto está como `'B'` = Buenos Aires)
- Idealmente agregar un selector de provincia en el checkout

---

## 📞 Soporte

- MercadoPago: https://www.mercadopago.com.ar/developers
- Envia.com: https://docs.envia.com
