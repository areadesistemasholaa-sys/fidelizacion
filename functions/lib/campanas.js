"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { requiereRol, PUEDE_GESTIONAR_CAMPANAS } = require("./roles");
const { registrarAuditoria } = require("./auditoria");

const ESTADOS_VALIDOS = [
  "borrador",
  "programada",
  "activa",
  "pausada",
  "finalizada",
  "archivada",
];

// Transiciones de estado permitidas (Sección 4)
const TRANSICIONES = {
  borrador: ["programada", "activa", "archivada"],
  programada: ["activa", "pausada", "borrador", "archivada"],
  activa: ["pausada", "finalizada"],
  pausada: ["activa", "finalizada", "archivada"],
  finalizada: ["archivada"],
  archivada: [],
};

function temaConDefaults(tema) {
  // Sección 9.2: si un campo del tema no se configura, se aplica el
  // tema por defecto de HOLAA Trendy (Sección 31.2) para que la
  // encuesta nunca se vea "rota".
  const DEFAULT = {
    colorPrimario: "#C20152",
    colorSecundario: "#000000",
    colorFondo: "#FFFFFF",
    colorTexto: "#000000",
    tipografia: "Poppins",
    logo: "assets/branding/logo_holaatrendy.png",
    imagenFondo: null,
    icono: "🛍️",
    estiloTarjeta: "redondeado",
  };
  return { ...DEFAULT, ...(tema || {}) };
}

/**
 * crearCampana — Sección 6
 * El administrador crea una campaña en estado "borrador". No se
 * codifican preguntas en el frontend: la pregunta de sistema
 * "¿En qué sucursal te encuentras?" (Sección 19.1) se agrega
 * automáticamente como primera pregunta, no editable/eliminable.
 */
exports.crearCampana = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_GESTIONAR_CAMPANAS);
  const db = admin.firestore();

  if (!data.nombre || typeof data.nombre !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "La campaña necesita un nombre.");
  }

  const campanaRef = db.collection("campanas").doc();
  const ahora = admin.firestore.FieldValue.serverTimestamp();

  const campana = {
    campanaId: campanaRef.id,
    nombre: data.nombre,
    descripcion: data.descripcion || "",
    imagen: data.imagen || null,
    fechaInicio: data.fechaInicio ? new Date(data.fechaInicio) : null,
    fechaFin: data.fechaFin ? new Date(data.fechaFin) : null,
    estado: "borrador",
    beneficioId: data.beneficioId || null,
    version: 1,
    fechaCreacion: ahora,
    creadoPor: context.auth.uid,
    tema: temaConDefaults(data.tema),
    temaId: data.temaId || null,
    mensajeBienvenida: data.mensajeBienvenida || "",
    mensajeFinal: data.mensajeFinal || "",
  };

  await campanaRef.set(campana);

  // Pregunta de sistema obligatoria: sucursal (Sección 19.1)
  await campanaRef.collection("preguntas").doc("sucursal_sistema").set({
    preguntaId: "sucursal_sistema",
    texto: "¿En qué sucursal te encuentras?",
    tipo: "sucursal_sistema", // tipo especial: el frontend lo puebla desde /sucursales
    opciones: [],
    obligatoria: true,
    orden: 0,
    activa: true,
    editable: false, // no editable/eliminable por el administrador (solo reordenable)
  });

  await registrarAuditoria({
    accion: "crear_campana",
    modulo: "campanas",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId: campanaRef.id, nombre: data.nombre },
  });

  return { campanaId: campanaRef.id };
});

/**
 * actualizarCampana — Sección 6
 * Editar campos de una campaña. NO modifica retroactivamente
 * respuestas ya registradas con una versión anterior (Sección 35):
 * si se editan las preguntas de una campaña ya activa, se incrementa
 * `version`.
 */
exports.actualizarCampana = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_GESTIONAR_CAMPANAS);
  const db = admin.firestore();
  const { campanaId, cambios, incrementarVersion } = data;

  if (!campanaId) {
    throw new functions.https.HttpsError("invalid-argument", "Falta campanaId.");
  }

  const ref = db.collection("campanas").doc(campanaId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "La campaña no existe.");
  }

  const actualizacion = { ...cambios };
  if (actualizacion.tema) {
    actualizacion.tema = temaConDefaults({ ...snap.data().tema, ...actualizacion.tema });
  }
  if (actualizacion.fechaInicio) actualizacion.fechaInicio = new Date(actualizacion.fechaInicio);
  if (actualizacion.fechaFin) actualizacion.fechaFin = new Date(actualizacion.fechaFin);
  if (incrementarVersion) {
    actualizacion.version = admin.firestore.FieldValue.increment(1);
  }
  actualizacion.fechaActualizacion = admin.firestore.FieldValue.serverTimestamp();
  actualizacion.actualizadoPor = context.auth.uid;

  await ref.update(actualizacion);

  await registrarAuditoria({
    accion: "actualizar_campana",
    modulo: "campanas",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId, campos: Object.keys(cambios || {}) },
  });

  return { ok: true };
});

/**
 * cambiarEstadoCampana — activar / pausar / finalizar / archivar
 * (Sección 6). Valida transiciones de estado permitidas.
 */
exports.cambiarEstadoCampana = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_GESTIONAR_CAMPANAS);
  const db = admin.firestore();
  const { campanaId, nuevoEstado } = data;

  if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
    throw new functions.https.HttpsError("invalid-argument", "Estado no válido.");
  }

  const ref = db.collection("campanas").doc(campanaId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "La campaña no existe.");
  }
  const estadoActual = snap.data().estado;
  const permitidas = TRANSICIONES[estadoActual] || [];
  if (!permitidas.includes(nuevoEstado)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `No se puede pasar de "${estadoActual}" a "${nuevoEstado}".`
    );
  }

  await ref.update({
    estado: nuevoEstado,
    fechaActualizacion: admin.firestore.FieldValue.serverTimestamp(),
    actualizadoPor: context.auth.uid,
  });

  await registrarAuditoria({
    accion: `cambiar_estado_${nuevoEstado}`,
    modulo: "campanas",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId, estadoAnterior: estadoActual, nuevoEstado },
  });

  return { ok: true };
});

/**
 * duplicarCampana — Sección 6. Copia campaña + preguntas + tema como
 * nueva campaña en "borrador", útil para reutilizar una campaña
 * anterior (ej. "Navidad 2025" -> "Navidad 2026").
 */
exports.duplicarCampana = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_GESTIONAR_CAMPANAS);
  const db = admin.firestore();
  const { campanaId, nuevoNombre } = data;

  const origenRef = db.collection("campanas").doc(campanaId);
  const origenSnap = await origenRef.get();
  if (!origenSnap.exists) {
    throw new functions.https.HttpsError("not-found", "La campaña origen no existe.");
  }
  const origen = origenSnap.data();

  const nuevaRef = db.collection("campanas").doc();
  const ahora = admin.firestore.FieldValue.serverTimestamp();

  await nuevaRef.set({
    ...origen,
    campanaId: nuevaRef.id,
    nombre: nuevoNombre || `${origen.nombre} (copia)`,
    estado: "borrador",
    version: 1,
    fechaCreacion: ahora,
    creadoPor: context.auth.uid,
    fechaActualizacion: admin.firestore.FieldValue.delete(),
  });

  const preguntasSnap = await origenRef.collection("preguntas").get();
  const batch = db.batch();
  preguntasSnap.forEach((doc) => {
    batch.set(nuevaRef.collection("preguntas").doc(doc.id), doc.data());
  });
  await batch.commit();

  await registrarAuditoria({
    accion: "duplicar_campana",
    modulo: "campanas",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaOrigen: campanaId, campanaNueva: nuevaRef.id },
  });

  return { campanaId: nuevaRef.id };
});

/**
 * eliminarCampana — solo permitido para campañas en "borrador"
 * (nunca elimina campañas con respuestas reales, Sección 26).
 */
exports.eliminarCampana = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_GESTIONAR_CAMPANAS);
  const db = admin.firestore();
  const { campanaId } = data;

  const ref = db.collection("campanas").doc(campanaId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  if (snap.data().estado !== "borrador") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Solo se pueden eliminar campañas en borrador. Usa 'Archivar' para las demás."
    );
  }
  await ref.delete();

  await registrarAuditoria({
    accion: "eliminar_campana",
    modulo: "campanas",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId },
  });

  return { ok: true };
});

/**
 * guardarPregunta — constructor de encuestas (Sección 7). No permite
 * editar/eliminar la pregunta de sistema "sucursal_sistema", solo
 * reordenarla.
 */
exports.guardarPregunta = functions.https.onCall(async (data, context) => {
  requiereRol(context, PUEDE_GESTIONAR_CAMPANAS);
  const db = admin.firestore();
  const { campanaId, pregunta } = data;

  if (pregunta.preguntaId === "sucursal_sistema" && pregunta.eliminar) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "La pregunta de sucursal es obligatoria y no puede eliminarse."
    );
  }

  const preguntasRef = db.collection("campanas").doc(campanaId).collection("preguntas");
  const ref = pregunta.preguntaId ? preguntasRef.doc(pregunta.preguntaId) : preguntasRef.doc();

  if (pregunta.eliminar) {
    await ref.delete();
    return { ok: true };
  }

  await ref.set(
    {
      preguntaId: ref.id,
      texto: pregunta.texto,
      tipo: pregunta.tipo,
      opciones: pregunta.opciones || [],
      obligatoria: !!pregunta.obligatoria,
      orden: pregunta.orden ?? 1,
      activa: pregunta.activa !== false,
      editable: true,
    },
    { merge: true }
  );

  return { preguntaId: ref.id };
});

module.exports.temaConDefaults = temaConDefaults;
