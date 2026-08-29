"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const { requiereRol, PUEDE_EXPORTAR } = require("./roles");
const { registrarAuditoria } = require("./auditoria");

// Columnas exactas del sistema administrativo/contable existente
// (Sección 13 nota de compatibilidad / 25.2)
const COLUMNAS_COMPATIBLES = [
  "REPRESENTANTE", "NOMBRE", "RFC", "CURP", "DOMICILIO", "NO.EXT", "NO.INT",
  "COLONIA", "C.P.", "LOCALIDAD", "MUNICIPIO", "ESTADO", "PAIS", "TELÉFONO",
  "CELULAR", "EMAILS", "COMENTARIO", "APLICA RETENCIONES (S/N)",
  "DESGLOSAR IEPS (S/N)", "NÚMERO DE PRECIO", "LIMITE DE CRÉDITO", "DIAS DE CRÉDITO",
];

async function subirYFirmar(workbook, nombreArchivo) {
  const buffer = await workbook.xlsx.writeBuffer();
  const bucket = admin.storage().bucket();
  const file = bucket.file(`exportaciones/${nombreArchivo}`);
  await file.save(buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 30 * 60 * 1000, // enlace temporal: 30 minutos
  });
  return url;
}

function aplicarFiltrosClientes(query, filtros) {
  if (filtros?.sucursalId) query = query.where("sucursalPreferida", "==", filtros.sucursalId);
  if (filtros?.estado) query = query.where("estado", "==", filtros.estado);
  return query;
}

/**
 * exportarClientes — Sección 25.2: plantilla "compatible" (mismas
 * columnas que el sistema contable, con campos no recopilados en
 * blanco) o "extendida" (columnas propias del CRM de campañas).
 */
exports.exportarClientes = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_EXPORTAR, "No tienes permiso para exportar.");
  const db = admin.firestore();
  const formato = data?.formato === "extendida" ? "extendida" : "compatible";

  let query = db.collection("clientes");
  query = aplicarFiltrosClientes(query, data?.filtros);
  const snap = await query.get();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clientes");

  if (formato === "compatible") {
    sheet.columns = COLUMNAS_COMPATIBLES.map((c) => ({ header: c, key: c, width: 18 }));
    snap.forEach((doc) => {
      const c = doc.data();
      sheet.addRow({
        REPRESENTANTE: "",
        NOMBRE: c.nombre || "",
        RFC: "",
        CURP: "",
        DOMICILIO: "",
        "NO.EXT": "",
        "NO.INT": "",
        COLONIA: "",
        "C.P.": "",
        LOCALIDAD: "",
        MUNICIPIO: "",
        ESTADO: "",
        PAIS: "México",
        "TELÉFONO": c.telefono || "",
        CELULAR: c.celular || "",
        EMAILS: c.email || "",
        COMENTARIO: "",
        "APLICA RETENCIONES (S/N)": "N",
        "DESGLOSAR IEPS (S/N)": "N",
        "NÚMERO DE PRECIO": "",
        "LIMITE DE CRÉDITO": "",
        "DIAS DE CRÉDITO": "",
      });
    });
  } else {
    sheet.columns = [
      { header: "Cliente ID", key: "clienteId", width: 24 },
      { header: "Nombre", key: "nombre", width: 24 },
      { header: "Teléfono", key: "telefono", width: 16 },
      { header: "Celular", key: "celular", width: 16 },
      { header: "Email", key: "email", width: 24 },
      { header: "Rango de edad", key: "rangoEdad", width: 16 },
      { header: "Sucursal preferida", key: "sucursalPreferida", width: 20 },
      { header: "Estado", key: "estado", width: 12 },
      { header: "Fecha de registro", key: "fechaRegistro", width: 20 },
      { header: "Última actualización", key: "fechaActualizacion", width: 20 },
    ];
    snap.forEach((doc) => {
      const c = doc.data();
      sheet.addRow({
        clienteId: c.clienteId,
        nombre: c.nombre || "",
        telefono: c.telefono || "",
        celular: c.celular || "",
        email: c.email || "",
        rangoEdad: c.rangoEdad || "",
        sucursalPreferida: c.sucursalPreferida || "",
        estado: c.estado || "",
        fechaRegistro: c.fechaRegistro?.toDate?.().toISOString() || "",
        fechaActualizacion: c.fechaActualizacion?.toDate?.().toISOString() || "",
      });
    });
  }
  sheet.getRow(1).font = { bold: true };

  const nombreArchivo = `clientes_${formato}_${Date.now()}.xlsx`;
  const url = await subirYFirmar(workbook, nombreArchivo);

  await registrarAuditoria({
    accion: "exportar_clientes",
    modulo: "exportaciones",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { formato, filtros: data?.filtros || {}, registros: snap.size },
  });
  await db.collection("exportaciones").add({
    tipo: "clientes",
    formato,
    generadoPor: context.auth.uid,
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    registros: snap.size,
  });

  return { url, registros: snap.size };
});

/**
 * exportarRespuestas — Sección 25.1/25.4: una fila por cliente, una
 * columna por pregunta; en selección múltiple, opciones concatenadas
 * por comas de forma consistente. Incluye siempre la versión de
 * encuesta de cada respuesta (Sección 35).
 */
exports.exportarRespuestas = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_EXPORTAR, "No tienes permiso para exportar.");
  const db = admin.firestore();
  const { campanaId } = data || {};

  let query = db.collection("respuestas");
  if (campanaId) query = query.where("campanaId", "==", campanaId);
  const snap = await query.get();

  // Recolectar el set de preguntas presentes en las respuestas
  const preguntasSet = new Map();
  const filas = [];
  snap.forEach((doc) => {
    const r = doc.data();
    Object.entries(r.respuestas || {}).forEach(([preguntaId, valor]) => {
      if (!preguntasSet.has(preguntaId)) preguntasSet.set(preguntaId, preguntaId);
    });
    filas.push(r);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Respuestas");
  const columnasBase = [
    { header: "Cliente ID", key: "clienteId", width: 24 },
    { header: "Campaña ID", key: "campanaId", width: 20 },
    { header: "Versión encuesta", key: "versionCampana", width: 16 },
    { header: "Sucursal", key: "sucursalId", width: 18 },
    { header: "Fecha", key: "fecha", width: 20 },
  ];
  const columnasPreguntas = Array.from(preguntasSet.keys()).map((pid) => ({
    header: pid,
    key: pid,
    width: 24,
  }));
  sheet.columns = [...columnasBase, ...columnasPreguntas];

  filas.forEach((r) => {
    const fila = {
      clienteId: r.clienteId,
      campanaId: r.campanaId,
      versionCampana: r.versionCampana,
      sucursalId: r.sucursalId,
      fecha: r.fecha?.toDate?.().toISOString() || "",
    };
    Object.entries(r.respuestas || {}).forEach(([preguntaId, valor]) => {
      fila[preguntaId] = Array.isArray(valor) ? valor.join(", ") : valor;
    });
    sheet.addRow(fila);
  });
  sheet.getRow(1).font = { bold: true };

  const nombreArchivo = `respuestas_${campanaId || "todas"}_${Date.now()}.xlsx`;
  const url = await subirYFirmar(workbook, nombreArchivo);

  await registrarAuditoria({
    accion: "exportar_respuestas",
    modulo: "exportaciones",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId: campanaId || "todas", registros: snap.size },
  });

  return { url, registros: snap.size };
});

/**
 * exportarBeneficios — Sección 25.1: generados, canjeados y vigentes.
 */
exports.exportarBeneficios = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_EXPORTAR, "No tienes permiso para exportar.");
  const db = admin.firestore();
  const { campanaId, sucursalId, estadoUso } = data || {};

  let query = db.collection("beneficiosAsignados");
  if (campanaId) query = query.where("campanaId", "==", campanaId);
  if (sucursalId) query = query.where("sucursalId", "==", sucursalId);
  if (estadoUso) query = query.where("estadoUso", "==", estadoUso);
  const snap = await query.get();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Beneficios");
  sheet.columns = [
    { header: "Código de barras", key: "codigoBarras", width: 20 },
    { header: "Cliente ID", key: "clienteId", width: 24 },
    { header: "Campaña", key: "campanaId", width: 20 },
    { header: "Sucursal", key: "sucursalId", width: 18 },
    { header: "Estado", key: "estadoUso", width: 14 },
    { header: "Generado", key: "fechaGeneracion", width: 20 },
    { header: "Expira", key: "fechaExpiracionCodigo", width: 20 },
    { header: "Validado por", key: "validadoPor", width: 20 },
    { header: "Fecha validación", key: "fechaHoraValidacion", width: 20 },
  ];
  snap.forEach((doc) => {
    const b = doc.data();
    sheet.addRow({
      codigoBarras: b.codigoBarras,
      clienteId: b.clienteId,
      campanaId: b.campanaId,
      sucursalId: b.sucursalId,
      estadoUso: b.estadoUso,
      fechaGeneracion: b.fechaGeneracion?.toDate?.().toISOString() || "",
      fechaExpiracionCodigo: b.fechaExpiracionCodigo?.toDate?.().toISOString() || "",
      validadoPor: b.validadoPor || "",
      fechaHoraValidacion: b.fechaHoraValidacion?.toDate?.().toISOString() || "",
    });
  });
  sheet.getRow(1).font = { bold: true };

  const url = await subirYFirmar(workbook, `beneficios_${Date.now()}.xlsx`);

  await registrarAuditoria({
    accion: "exportar_beneficios",
    modulo: "exportaciones",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId, sucursalId, estadoUso, registros: snap.size },
  });

  return { url, registros: snap.size };
});

/**
 * exportarConsentimientos — Sección 25.1: historial de aceptación/revocación.
 */
exports.exportarConsentimientos = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_EXPORTAR, "No tienes permiso para exportar.");
  const db = admin.firestore();
  const snap = await db.collection("consentimientos").get();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Consentimientos");
  sheet.columns = [
    { header: "Cliente ID", key: "clienteId", width: 24 },
    { header: "Campaña", key: "campanaId", width: 20 },
    { header: "Tipo", key: "tipo", width: 24 },
    { header: "Aceptado", key: "aceptado", width: 12 },
    { header: "Versión", key: "version", width: 10 },
    { header: "Fecha", key: "fechaHora", width: 20 },
  ];
  snap.forEach((doc) => {
    const c = doc.data();
    sheet.addRow({
      clienteId: c.clienteId,
      campanaId: c.campanaId || "",
      tipo: c.tipo,
      aceptado: c.aceptado ? "Sí" : "No",
      version: c.version,
      fechaHora: c.fechaHora?.toDate?.().toISOString() || "",
    });
  });
  sheet.getRow(1).font = { bold: true };

  const url = await subirYFirmar(workbook, `consentimientos_${Date.now()}.xlsx`);

  await registrarAuditoria({
    accion: "exportar_consentimientos",
    modulo: "exportaciones",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { registros: snap.size },
  });

  return { url, registros: snap.size };
});

/**
 * exportarDashboard — Sección 24: resumen estadístico de una campaña.
 */
exports.exportarDashboard = functions.https.onCall(async (data, context) => {
  const rol = requiereRol(context, PUEDE_EXPORTAR, "No tienes permiso para exportar.");
  const db = admin.firestore();
  const { campanaId } = data || {};

  let query = db.collection("respuestas");
  if (campanaId) query = query.where("campanaId", "==", campanaId);
  const respuestasSnap = await query.get();

  const porSucursal = {};
  const porRangoEdad = {};
  respuestasSnap.forEach((doc) => {
    const r = doc.data();
    porSucursal[r.sucursalId] = (porSucursal[r.sucursalId] || 0) + 1;
  });

  const workbook = new ExcelJS.Workbook();
  const resumen = workbook.addWorksheet("Resumen");
  resumen.addRow(["Campaña", campanaId || "Todas"]);
  resumen.addRow(["Total de participaciones", respuestasSnap.size]);
  resumen.addRow([]);
  resumen.addRow(["Sucursal", "Participaciones"]);
  Object.entries(porSucursal).forEach(([suc, count]) => resumen.addRow([suc, count]));

  const url = await subirYFirmar(workbook, `dashboard_${campanaId || "todas"}_${Date.now()}.xlsx`);

  await registrarAuditoria({
    accion: "exportar_dashboard",
    modulo: "exportaciones",
    usuarioUid: context.auth.uid,
    usuarioEmail: context.auth.token.email,
    rol,
    detalle: { campanaId: campanaId || "todas" },
  });

  return { url };
});
