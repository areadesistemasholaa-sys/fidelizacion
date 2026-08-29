"use strict";

const admin = require("firebase-admin");
admin.initializeApp();

// ------------------------------------------------------------------
// HOLAA Trendy — Cloud Functions
// Organizadas por módulo, siguiendo el PROMPT MAESTRO:
//   campanas.js       -> Sección 6, 14, 35 (CRUD + estados + encuestas)
//   encuestas.js      -> Sección 11, 13, 16, 17, 18, 33 (envío del cliente)
//   caja.js           -> Sección 20 (dispositivos + validación de cupones)
//   exportaciones.js  -> Sección 22, 25 (exportación a Excel)
//   administradores.js-> Sección 23 (roles vía custom claims)
//   semillas.js       -> Sección 19 (catálogo inicial de sucursales)
// ------------------------------------------------------------------

const campanas = require("./lib/campanas");
const encuestas = require("./lib/encuestas");
const caja = require("./lib/caja");
const exportaciones = require("./lib/exportaciones");
const administradores = require("./lib/administradores");
const semillas = require("./lib/semillas");

// Campañas
exports.crearCampana = campanas.crearCampana;
exports.actualizarCampana = campanas.actualizarCampana;
exports.cambiarEstadoCampana = campanas.cambiarEstadoCampana;
exports.duplicarCampana = campanas.duplicarCampana;
exports.eliminarCampana = campanas.eliminarCampana;
exports.guardarPregunta = campanas.guardarPregunta;

// Portal cliente
exports.enviarEncuesta = encuestas.enviarEncuesta;

// Panel Caja
exports.configurarDispositivoCaja = caja.configurarDispositivoCaja;
exports.validarBeneficio = caja.validarBeneficio;
exports.revocarDispositivoCaja = caja.revocarDispositivoCaja;

// Exportación a Excel
exports.exportarClientes = exportaciones.exportarClientes;
exports.exportarRespuestas = exportaciones.exportarRespuestas;
exports.exportarBeneficios = exportaciones.exportarBeneficios;
exports.exportarConsentimientos = exportaciones.exportarConsentimientos;
exports.exportarDashboard = exportaciones.exportarDashboard;

// Administradores
exports.crearAdministrador = administradores.crearAdministrador;
exports.cambiarRolAdministrador = administradores.cambiarRolAdministrador;
exports.desactivarAdministrador = administradores.desactivarAdministrador;

// Utilidades de despliegue inicial
exports.ejecutarSemillas = semillas.ejecutarSemillas;
