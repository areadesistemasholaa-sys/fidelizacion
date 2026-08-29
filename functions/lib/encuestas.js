"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");

/**
 * Genera un código de barras único, corto, apto para lectores físicos
 * (numérico, tipo CODE128/EAN estándar de 12-13 dígitos).
 */
function generarCodigoBarras() {
  // Prefijo fijo + timestamp corto + aleatorio -> 13 dígitos numéricos
  const ts = Date.now().toString().slice(-8);
  const rand = crypto.randomInt(100, 999);
  return `77${ts}${rand}`;
}

/**
 * enviarEncuesta — flujo completo del CLIENTE (Sección 33):
 *  1. Busca/crea el cliente por su UID de Auth (nunca por teléfono,
 *     Sección 13) para evitar duplicados (Sección 11).
 *  2. Registra la respuesta con la versión exacta de la campaña
 *     contestada (Sección 35 — no se modifican respuestas históricas).
 *  3. Registra los consentimientos seleccionados (Sección 17).
 *  4. Genera el beneficio con código de barras de un solo uso,
 *     vinculado a la sucursal indicada por el cliente (Sección 18).
 * Todo en una única transacción para consistencia.
 */
exports.enviarEncuesta = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión (OTP) antes de responder la encuesta."
    );
  }

  const { campanaId, respuestas, datosCliente, consentimientos, sucursalId } = data;

  if (!campanaId || !respuestas || !sucursalId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Faltan datos requeridos (campaña, respuestas o sucursal)."
    );
  }

  const db = admin.firestore();
  const clienteId = context.auth.uid;

  const campanaRef = db.collection("campanas").doc(campanaId);
  const sucursalRef = db.collection("sucursales").doc(sucursalId);

  const [campanaSnap, sucursalSnap] = await Promise.all([campanaRef.get(), sucursalRef.get()]);

  if (!campanaSnap.exists || campanaSnap.data().estado !== "activa") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Esta campaña ya no está activa."
    );
  }
  if (!sucursalSnap.exists || sucursalSnap.data().estado !== "activa") {
    throw new functions.https.HttpsError("invalid-argument", "Sucursal no válida.");
  }

  const campana = campanaSnap.data();
  const ahora = admin.firestore.FieldValue.serverTimestamp();

  const resultado = await db.runTransaction(async (tx) => {
    // 1) Cliente — crea o actualiza (Sección 13)
    const clienteRef = db.collection("clientes").doc(clienteId);
    const clienteSnap = await tx.get(clienteRef);

    const datosClienteBase = {
      clienteId,
      nombre: datosCliente?.nombre || (clienteSnap.exists ? clienteSnap.data().nombre : ""),
      telefono: datosCliente?.telefono || (clienteSnap.exists ? clienteSnap.data().telefono : ""),
      celular: datosCliente?.celular || (clienteSnap.exists ? clienteSnap.data().celular : ""),
      email: datosCliente?.email || (clienteSnap.exists ? clienteSnap.data().email : ""),
      rangoEdad: datosCliente?.rangoEdad || (clienteSnap.exists ? clienteSnap.data().rangoEdad : ""),
      estado: "activo",
      sucursalPreferida: sucursalId,
      fechaActualizacion: ahora,
    };

    if (clienteSnap.exists) {
      tx.update(clienteRef, datosClienteBase);
    } else {
      tx.set(clienteRef, { ...datosClienteBase, fechaRegistro: ahora });
    }

    // 2) Respuesta (Sección 16) — conserva versión exacta de campaña
    const respuestaRef = db.collection("respuestas").doc();
    tx.set(respuestaRef, {
      respuestaId: respuestaRef.id,
      clienteId,
      campanaId,
      fecha: ahora,
      respuestas,
      sucursalId,
      versionCampana: campana.version || 1,
    });

    // 3) Consentimientos (Sección 17)
    const consentimientoRefs = [];
    (consentimientos || []).forEach((c) => {
      const ref = db.collection("consentimientos").doc();
      consentimientoRefs.push(ref);
      tx.set(ref, {
        clienteId,
        campanaId,
        tipo: c.tipo, // 'aviso_privacidad' | 'comunicaciones_comerciales' | 'analitica'
        aceptado: !!c.aceptado,
        version: c.version || 1,
        fechaHora: ahora,
      });
    });

    // 4) Beneficio con código de barras de un solo uso (Sección 18)
    let beneficioAsignado = null;
    if (campana.beneficioId) {
      const codigoBarras = generarCodigoBarras();
      const beneficioRef = db.collection("beneficiosAsignados").doc();
      const vigenciaHoras = campana.vigenciaCodigoHoras || 72; // vigencia corta del código mostrado
      const fechaExpiracionCodigo = new Date(Date.now() + vigenciaHoras * 3600 * 1000);

      tx.set(beneficioRef, {
        beneficioAsignadoId: beneficioRef.id,
        beneficioId: campana.beneficioId,
        clienteId,
        campanaId,
        sucursalId,
        codigoBarras,
        fechaGeneracion: ahora,
        fechaExpiracionCodigo,
        estadoUso: "pendiente",
        dispositivoIdValidacion: null,
        validadoPor: null,
        fechaHoraValidacion: null,
      });

      beneficioAsignado = {
        beneficioAsignadoId: beneficioRef.id,
        codigoBarras,
        fechaExpiracionCodigo: fechaExpiracionCodigo.toISOString(),
      };
    }

    return { respuestaId: respuestaRef.id, beneficioAsignado };
  });

  return {
    ok: true,
    respuestaId: resultado.respuestaId,
    beneficio: resultado.beneficioAsignado,
    mensajeFinal: campana.mensajeFinal || "¡Gracias por participar!",
  };
});
