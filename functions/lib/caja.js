"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { requiereRol, PUEDE_ADMINISTRAR_SISTEMA } = require("./roles");
const { registrarAuditoria } = require("./auditoria");

/**
 * configurarDispositivoCaja — Sección 20.2. Primer uso del Panel Caja
 * en una terminal: registra el dispositivo vinculado a una sucursal.
 * Requiere el PIN corto de la sucursal (evita que cualquiera configure
 * un dispositivo con la sucursal incorrecta).
 * No requiere una cuenta de cajera individual (Sección 20.4): se
 * autentica con Firebase Auth anónimo desde el propio Panel Caja.
 */
exports.configurarDispositivoCaja = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sesión de dispositivo requerida.");
  }
  const { sucursalId, pinSucursal, nombreDispositivo } = data;
  const db = admin.firestore();

  const sucursalRef = db.collection("sucursales").doc(sucursalId);
  const sucursalSnap = await sucursalRef.get();
  if (!sucursalSnap.exists || sucursalSnap.data().estado !== "activa") {
    throw new functions.https.HttpsError("invalid-argument", "Sucursal no válida.");
  }
  if (sucursalSnap.data().pinConfiguracion && sucursalSnap.data().pinConfiguracion !== pinSucursal) {
    throw new functions.https.HttpsError("permission-denied", "PIN de sucursal incorrecto.");
  }

  const dispositivoRef = db.collection("dispositivosCaja").doc();
  await dispositivoRef.set({
    dispositivoId: dispositivoRef.id,
    sucursalId,
    nombreDispositivo: nombreDispositivo || `Caja - ${sucursalSnap.data().nombre}`,
    fechaConfiguracion: admin.firestore.FieldValue.serverTimestamp(),
    configuradoPor: context.auth.uid,
    estado: "activo",
  });

  await registrarAuditoria({
    accion: "configurar_dispositivo_caja",
    modulo: "caja",
    usuarioUid: context.auth.uid,
    detalle: { dispositivoId: dispositivoRef.id, sucursalId },
  });

  return { dispositivoId: dispositivoRef.id, sucursalNombre: sucursalSnap.data().nombre };
});

/**
 * validarBeneficio — Sección 20.3. Núcleo de seguridad del Panel Caja.
 * Ejecuta en una transacción atómica: existencia/vigencia del código,
 * uso previo, y coincidencia de sucursal del dispositivo vs. beneficio.
 * NUNCA se marca "usado" desde el cliente ni desde el navegador de caja
 * directamente — solo esta Cloud Function puede hacerlo.
 */
exports.validarBeneficio = functions.https.onCall(async (data, context) => {
  const { codigoBarras, dispositivoId } = data;
  if (!codigoBarras || !dispositivoId) {
    throw new functions.https.HttpsError("invalid-argument", "Falta código de barras o dispositivo.");
  }

  const db = admin.firestore();

  const dispositivoSnap = await db.collection("dispositivosCaja").doc(dispositivoId).get();
  if (!dispositivoSnap.exists || dispositivoSnap.data().estado !== "activo") {
    return { resultado: "dispositivo_no_autorizado", mensaje: "Este dispositivo no está autorizado. Vuelve a configurarlo." };
  }
  const sucursalDispositivo = dispositivoSnap.data().sucursalId;

  const query = await db
    .collection("beneficiosAsignados")
    .where("codigoBarras", "==", codigoBarras)
    .limit(1)
    .get();

  if (query.empty) {
    return { resultado: "no_valido", mensaje: "CÓDIGO NO VÁLIDO O EXPIRADO" };
  }

  const beneficioRef = query.docs[0].ref;

  const resultado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(beneficioRef);
    const beneficio = snap.data();

    const expiracion = beneficio.fechaExpiracionCodigo?.toDate
      ? beneficio.fechaExpiracionCodigo.toDate()
      : new Date(beneficio.fechaExpiracionCodigo);
    if (expiracion && expiracion.getTime() < Date.now()) {
      return { resultado: "no_valido", mensaje: "CÓDIGO NO VÁLIDO O EXPIRADO" };
    }

    if (beneficio.estadoUso !== "pendiente") {
      return { resultado: "ya_aplicado", mensaje: "CUPÓN YA APLICADO" };
    }

    if (beneficio.sucursalId !== sucursalDispositivo) {
      // No se marca como usado: sigue disponible para la sucursal correcta.
      return { resultado: "sucursal_incorrecta", mensaje: "NO PERTENECE A ESTA SUCURSAL" };
    }

    tx.update(beneficioRef, {
      estadoUso: "usado",
      dispositivoIdValidacion: dispositivoId,
      validadoPor: dispositivoSnap.data().nombreDispositivo,
      fechaHoraValidacion: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { resultado: "verificado", mensaje: "VERIFICADO", beneficioId: beneficio.beneficioId };
  });

  // Auditoría de cada validación (Sección 36), fuera de la transacción
  await registrarAuditoria({
    accion: "validar_beneficio",
    modulo: "caja",
    detalle: {
      codigoBarras,
      dispositivoId,
      sucursalDispositivo,
      resultado: resultado.resultado,
    },
  });

  return resultado;
});

/**
 * revocarDispositivoCaja — panel admin (Sección 20.2 punto 4)
 */
exports.revocarDispositivoCaja = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_ADMINISTRAR_SISTEMA);
  const db = admin.firestore();
  const { dispositivoId } = data;

  await db.collection("dispositivosCaja").doc(dispositivoId).update({ estado: "revocado" });

  await registrarAuditoria({
    accion: "revocar_dispositivo_caja",
    modulo: "caja",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { dispositivoId },
  });

  return { ok: true };
});

module.exports._generarPinAleatorio = () => crypto.randomInt(1000, 9999).toString();
