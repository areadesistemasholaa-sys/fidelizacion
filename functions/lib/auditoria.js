"use strict";

const admin = require("firebase-admin");

/**
 * Registra una acción administrativa en la bitácora de auditoría
 * (Sección 36). Se llama desde cada Cloud Function sensible —
 * nunca se confía en que el frontend reporte sus propias acciones.
 *
 * @param {object} datos
 * @param {string} datos.accion       ej. "crear_campana", "activar_campana",
 *                                    "exportar", "validar_beneficio"
 * @param {string} datos.modulo       ej. "campanas", "exportaciones", "caja"
 * @param {string} [datos.usuarioUid]
 * @param {string} [datos.usuarioEmail]
 * @param {string} [datos.rol]
 * @param {object} [datos.detalle]    payload libre relevante a la acción
 */
async function registrarAuditoria(datos) {
  const db = admin.firestore();
  await db.collection("auditoria").add({
    accion: datos.accion,
    modulo: datos.modulo,
    usuarioUid: datos.usuarioUid || null,
    usuarioEmail: datos.usuarioEmail || null,
    rol: datos.rol || null,
    detalle: datos.detalle || {},
    fechaHora: admin.firestore.FieldValue.serverTimestamp(),
  });
}

module.exports = { registrarAuditoria };
