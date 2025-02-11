require("dotenv").config(); // Cargar variables de entorno desde .env
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const mercadopago = require("mercadopago");
const cors = require("cors");
const fs = require("fs");

// Inicializar Firebase con la clave de servicio
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://servivending-94889.firebaseio.com",
});

const db = admin.firestore();

// Configurar Mercado Pago con la variable de entorno
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN, // Ahora se toma de .env
});

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Ruta para generar un pago y código QR
app.post("/crear_pago", async (req, res) => {
  try {
    const { maquina_id, productos } = req.body;

    if (!maquina_id || !productos || productos.length === 0) {
      return res.status(400).json({ error: "Datos insuficientes" });
    }

    let total = 0;
    productos.forEach((p) => (total += p.precio * p.cantidad));

    const preference = {
      items: productos.map((p) => ({
        title: p.nombre,
        quantity: p.cantidad,
        currency_id: "MXN",
        unit_price: p.precio,
      })),
      external_reference: maquina_id,
      notification_url: process.env.WEBHOOK_URL, // Webhook desde .env
    };

    const response = await mercadopago.preferences.create(preference);
    res.json({
      payment_url: response.body.init_point,
      qr_data: response.body.id,
    });
  } catch (error) {
    console.error("Error al crear pago:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// Webhook para recibir pagos
app.post("/webhook_pago", async (req, res) => {
  try {
    const { action, data } = req.body;

    if (action === "payment.created") {
      const paymentId = data.id;

      const payment = await mercadopago.payment.findById(paymentId);
      const { status, external_reference } = payment.body;

      if (status === "approved") {
        const maquinaRef = db.collection("maquinas").doc(external_reference);
        const maquinaDoc = await maquinaRef.get();

        if (maquinaDoc.exists) {
          const productos = maquinaDoc.data().productos;

          productos.forEach((p) => {
            p.stock = Math.max(0, p.stock - p.cantidad);
          });

          await maquinaRef.update({ productos });
          console.log(`Pago aprobado. Stock actualizado en máquina ${external_reference}`);
        }

        res.sendStatus(200);
      } else {
        console.log("Pago no aprobado:", status);
        res.sendStatus(400);
      }
    }
  } catch (error) {
    console.error("Error en webhook:", error);
    res.sendStatus(500);
  }
});

// Ruta para obtener datos de una máquina
app.get("/maquina/:id", async (req, res) => {
  try {
    const maquinaRef = db.collection("maquinas").doc(req.params.id);
    const doc = await maquinaRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    res.json(doc.data());
  } catch (error) {
    console.error("Error al obtener máquina:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
