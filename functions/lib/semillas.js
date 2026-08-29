"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { requiereRol, PUEDE_ADMINISTRAR_SISTEMA } = require("./roles");

// Catálogo inicial de las 10 sucursales (Sección 19)
const SUCURSALES_SEMILLA = [
  "Juárez",
  "Mercado",
  "Nuevo León 1",
  "Nuevo León 2",
  "Nuevo León 3",
  "Tempoal 1",
  "Tempoal 2",
  "Tantoyuca Centro",
  "Tantoyuca Mercado",
  "Tamazunchale",
];

// Biblioteca inicial de preguntas reutilizables (Sección 8)
const PREGUNTAS_SEMILLA = [
  { texto: "¿Qué edad tienes?", tipo: "rango_edad", opciones: [] },
  {
    texto: "¿Qué prendas compras con mayor frecuencia?",
    tipo: "seleccion_multiple",
    opciones: ["Blusas", "Vestidos", "Jeans", "Pantalones", "Faldas", "Conjuntos", "Accesorios"],
  },
  { texto: "¿Cuál es tu estilo?", tipo: "seleccion_unica", opciones: ["Casual", "Formal", "Deportivo", "Trendy"] },
  { texto: "¿Qué talla utilizas?", tipo: "lista_desplegable", opciones: ["XS", "S", "M", "L", "XL", "XXL"] },
  {
    texto: "¿Con qué frecuencia compras ropa?",
    tipo: "seleccion_unica",
    opciones: ["Semanal", "Quincenal", "Mensual", "Cada temporada", "Rara vez"],
  },
];

/**
 * ejecutarSemillas — callable de un solo uso (solo admin) para
 * precargar sucursales y biblioteca de preguntas al desplegar el
 * proyecto por primera vez (Sección 19 "catálogo inicial a precargar").
 */
exports.ejecutarSemillas = functions.https.onCall(async (data, context) => {
  requiereRol(context, PUEDE_ADMINISTRAR_SISTEMA);
  const db = admin.firestore();
  const batch = db.batch();

  const sucursalesExistentes = await db.collection("sucursales").limit(1).get();
  if (sucursalesExistentes.empty) {
    SUCURSALES_SEMILLA.forEach((nombre) => {
      const ref = db.collection("sucursales").doc();
      batch.set(ref, {
        sucursalId: ref.id,
        nombre,
        estado: "activa",
        pinConfiguracion: null,
        fechaCreacion: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }

  const preguntasExistentes = await db.collection("bibliotecaPreguntas").limit(1).get();
  if (preguntasExistentes.empty) {
    PREGUNTAS_SEMILLA.forEach((p) => {
      const ref = db.collection("bibliotecaPreguntas").doc();
      batch.set(ref, { preguntaId: ref.id, ...p });
    });
  }

  await batch.commit();
  return { ok: true };
});
