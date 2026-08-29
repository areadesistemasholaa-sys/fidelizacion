"use strict";

/**
 * Roles del Panel Administrativo + Caja (Sección 23).
 * Los roles se guardan como custom claim `rol` en Firebase Auth
 * (nunca solo en Firestore), para que las Firestore/Storage Security
 * Rules y las Cloud Functions puedan confiar en `request.auth.token.rol`.
 */
const ROLES = Object.freeze({
  SUPER_ADMIN: "superadmin",
  ADMIN: "admin",
  MARKETING: "marketing",
  ANALITICA: "analitica",
  CONSULTA: "consulta",
  CAJA: "caja",
});

const TODOS_ROLES_ADMIN = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.MARKETING,
  ROLES.ANALITICA,
  ROLES.CONSULTA,
];

// Quién puede exportar a Excel (Sección 23 y 25.5): permiso independiente
const PUEDE_EXPORTAR = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MARKETING, ROLES.ANALITICA];

// Quién puede crear/editar/activar campañas y encuestas
const PUEDE_GESTIONAR_CAMPANAS = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MARKETING];

// Quién puede administrar catálogos (sucursales, dispositivos, admins)
const PUEDE_ADMINISTRAR_SISTEMA = [ROLES.SUPER_ADMIN, ROLES.ADMIN];

// Quién puede dar de alta/editar administradores y asignar roles
const PUEDE_GESTIONAR_ADMINS = [ROLES.SUPER_ADMIN];

function requiereRol(context, rolesPermitidos, mensaje) {
  const rol = context.auth && context.auth.token && context.auth.token.rol;
  if (!context.auth || !rolesPermitidos.includes(rol)) {
    const { HttpsError } = require("firebase-functions/v1/https");
    throw new HttpsError(
      "permission-denied",
      mensaje || "No tienes permisos suficientes para realizar esta acción."
    );
  }
  return rol;
}

module.exports = {
  ROLES,
  TODOS_ROLES_ADMIN,
  PUEDE_EXPORTAR,
  PUEDE_GESTIONAR_CAMPANAS,
  PUEDE_ADMINISTRAR_SISTEMA,
  PUEDE_GESTIONAR_ADMINS,
  requiereRol,
};
