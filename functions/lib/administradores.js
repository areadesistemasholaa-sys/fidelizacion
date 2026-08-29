"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { requiereRol, PUEDE_GESTIONAR_ADMINS, ROLES } = require("./roles");
const { registrarAuditoria } = require("./auditoria");

/**
 * crearAdministrador — solo SUPER_ADMIN. Crea el usuario de Firebase
 * Auth (o usa uno existente por email) y le asigna el custom claim
 * `rol`, que es lo que consultan las Security Rules y las demás
 * Cloud Functions (Sección 23).
 */
exports.crearAdministrador = functions.https.onCall(async (data, context) => {
  const rolSolicitante = requiereRol(context, PUEDE_GESTIONAR_ADMINS);
  const { email, nombre, rol } = data;

  if (!Object.values(ROLES).includes(rol)) {
    throw new functions.https.HttpsError("invalid-argument", "Rol no válido.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch {
    userRecord = await admin.auth().createUser({ email, displayName: nombre });
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, { rol });

  await admin.firestore().collection("administradores").doc(userRecord.uid).set({
    uid: userRecord.uid,
    email,
    nombre: nombre || "",
    rol,
    estado: "activo",
    fechaCreacion: admin.firestore.FieldValue.serverTimestamp(),
    creadoPor: context.auth.uid,
  });

  await registrarAuditoria({
    accion: "crear_administrador",
    modulo: "administradores",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol: rolSolicitante,
    detalle: { nuevoUid: userRecord.uid, email, rolAsignado: rol },
  });

  return { uid: userRecord.uid };
});

/**
 * cambiarRolAdministrador
 */
exports.cambiarRolAdministrador = functions.https.onCall(async (data, context) => {
  const rolSolicitante = requiereRol(context, PUEDE_GESTIONAR_ADMINS);
  const { uid, nuevoRol } = data;

  if (!Object.values(ROLES).includes(nuevoRol)) {
    throw new functions.https.HttpsError("invalid-argument", "Rol no válido.");
  }

  await admin.auth().setCustomUserClaims(uid, { rol: nuevoRol });
  await admin.firestore().collection("administradores").doc(uid).update({ rol: nuevoRol });

  await registrarAuditoria({
    accion: "cambiar_rol_administrador",
    modulo: "administradores",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol: rolSolicitante,
    detalle: { uid, nuevoRol },
  });

  return { ok: true };
});

/**
 * desactivarAdministrador
 */
exports.desactivarAdministrador = functions.https.onCall(async (data, context) => {
  const rolSolicitante = requiereRol(context, PUEDE_GESTIONAR_ADMINS);
  const { uid } = data;

  await admin.auth().updateUser(uid, { disabled: true });
  await admin.firestore().collection("administradores").doc(uid).update({ estado: "inactivo" });

  await registrarAuditoria({
    accion: "desactivar_administrador",
    modulo: "administradores",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol: rolSolicitante,
    detalle: { uid },
  });

  return { ok: true };
});
