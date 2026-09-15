// ===================================================================
// HOLAA Trendy — Exportación a Excel (camino "100% Spark")
// Panel Admin -> lee Firestore directo (permitido por rol vía
// firestore.rules) -> arma el .xlsx en el propio navegador con
// ExcelJS + FileSaver (cargados por CDN, ver admin/index.html) ->
// descarga inmediata. No hay URL que expire.
//
// Cada hoja se arma con encabezado legible y con estilo, anchos de
// columna reales, fechas como fechas (no texto ISO) y franjas de
// lectura. Además, los IDs internos de Firestore (cliente, sucursal,
// campaña, pregunta) se resuelven a su nombre/texto para que el
// archivo lo pueda leer alguien que no conoce la base de datos —
// el ID se deja también como columna aparte por trazabilidad, pero
// nunca es la única referencia.
// ===================================================================

import { db } from "/shared/firebase-config.js";
import {
  collection, getDocs, getDoc, doc, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { registrarAuditoria } from "/shared/firestore-ops.js";

const MAGENTA_HOLAA = "C20152";
const GRIS_BANDA = "F7F2F5";
const GRIS_BORDE = "EDEDED";

// Para celdas: se guarda como Date real (con numFmt) en vez de texto
// ISO plano, para que Excel la reconozca y se pueda ordenar/filtrar.
function fechaCelda(v) {
  if (!v) return null;
  return v?.toDate ? v.toDate() : new Date(v);
}

function capitalizar(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const ETIQUETAS_CONSENTIMIENTO = {
  aviso_privacidad: "Aviso de privacidad",
  comunicaciones_comerciales: "Comunicaciones comerciales",
  analitica: "Analítica",
};
function etiquetaConsentimiento(tipo) {
  return ETIQUETAS_CONSENTIMIENTO[tipo] || tipo;
}

function anchoColumna(filas, key, headerLen, min = 10, max = 42) {
  const maxContenido = filas.reduce((m, f) => Math.max(m, String(f[key] ?? "").length), 0);
  return Math.min(max, Math.max(min, headerLen + 2, maxContenido + 2));
}

function estilizarEncabezado(fila) {
  fila.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${MAGENTA_HOLAA}` } };
    celda.alignment = { vertical: "middle", horizontal: "left" };
    celda.border = { bottom: { style: "thin", color: { argb: `FF${MAGENTA_HOLAA}` } } };
  });
  fila.height = 20;
}

function aplicarBandasYBordes(hoja, primeraFilaDatos) {
  hoja.eachRow((fila, numFila) => {
    if (numFila < primeraFilaDatos) return;
    if ((numFila - primeraFilaDatos) % 2 === 1) {
      fila.eachCell((celda) => {
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GRIS_BANDA}` } };
      });
    }
    fila.eachCell((celda) => {
      celda.border = { ...(celda.border || {}), bottom: { style: "hair", color: { argb: `FF${GRIS_BORDE}` } } };
    });
  });
}

// ---------------------------------------------------------------
// Resolución de IDs -> texto legible. Sucursales y campañas son
// catálogos pequeños: se trae la colección completa una sola vez
// (mismo patrón que ya usan clientes.js/segmentos.js en el admin),
// en vez de ir preguntando ID por ID.
// ---------------------------------------------------------------
async function obtenerMapaSucursales() {
  const snap = await getDocs(collection(db, "sucursales"));
  return Object.fromEntries(snap.docs.map((d) => [d.data().sucursalId, d.data().nombre]));
}

async function obtenerMapaCampanas() {
  const snap = await getDocs(collection(db, "campanas"));
  return Object.fromEntries(snap.docs.map((d) => [d.data().campanaId, d.data().nombre]));
}

// clientes sí puede ser una colección grande, así que solo se piden
// los IDs que realmente aparecen en el reporte (en paralelo, por ID
// de documento — clienteId es el propio id del documento).
async function obtenerMapaClientes(clienteIds) {
  const idsUnicos = [...new Set(clienteIds.filter(Boolean))];
  const mapa = {};
  await Promise.all(idsUnicos.map(async (id) => {
    const snap = await getDoc(doc(db, "clientes", id));
    if (snap.exists()) mapa[id] = snap.data().nombre || "";
  }));
  return mapa;
}

// Las preguntas viven en la subcolección campanas/{campanaId}/preguntas.
// Se arma un mapa preguntaId -> { texto, orden } por cada campaña
// involucrada en el reporte (en paralelo).
async function obtenerMapaPreguntas(campanaIds) {
  const idsUnicos = [...new Set(campanaIds.filter(Boolean))];
  const mapa = {};
  await Promise.all(idsUnicos.map(async (campanaId) => {
    const snap = await getDocs(collection(db, "campanas", campanaId, "preguntas"));
    snap.forEach((d) => {
      const p = d.data();
      mapa[p.preguntaId || d.id] = { texto: p.texto || d.id, orden: p.orden ?? Infinity };
    });
  }));
  return mapa;
}

async function guardarBlob(libro, nombreArchivo) {
  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  window.saveAs(blob, nombreArchivo);
}

/**
 * Arma un libro con una sola hoja de datos tabulares (encabezado con
 * estilo, autofiltro, ancho de columna real y fila congelada).
 * columnas: [{ header, key, width?, esFecha? }]
 */
async function descargarTabla({ nombreHoja, columnas, filas, nombreArchivo }) {
  const libro = new window.ExcelJS.Workbook();
  libro.creator = "HOLAA Trendy";
  libro.created = new Date();

  const hoja = libro.addWorksheet(nombreHoja, { views: [{ state: "frozen", ySplit: 1 }] });

  hoja.columns = columnas.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || anchoColumna(filas, c.key, c.header.length),
  }));

  filas.forEach((f) => hoja.addRow(f));

  columnas.forEach((c, i) => {
    if (c.esFecha) hoja.getColumn(i + 1).numFmt = "dd/mm/yyyy hh:mm";
  });

  estilizarEncabezado(hoja.getRow(1));
  aplicarBandasYBordes(hoja, 2);
  if (filas.length) {
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  }

  await guardarBlob(libro, nombreArchivo);
}

// Columnas exactas del sistema administrativo/contable existente:
// esto SÍ debe quedarse como plantilla fija (no se resuelve nada
// aquí), porque es la que importa el otro sistema.
const COLUMNAS_COMPATIBLES = [
  "REPRESENTANTE", "NOMBRE", "RFC", "CURP", "DOMICILIO", "NO.EXT", "NO.INT",
  "COLONIA", "C.P.", "LOCALIDAD", "MUNICIPIO", "ESTADO", "PAIS", "TELÉFONO",
  "CELULAR", "EMAILS", "COMENTARIO", "APLICA RETENCIONES (S/N)",
  "DESGLOSAR IEPS (S/N)", "NÚMERO DE PRECIO", "LIMITE DE CRÉDITO", "DIAS DE CRÉDITO",
];

export async function exportarClientes({ formato = "compatible", filtros = {} } = {}) {
  let q = collection(db, "clientes");
  if (filtros.sucursalId) q = query(q, where("sucursalPreferida", "==", filtros.sucursalId));
  if (filtros.estado) q = query(q, where("estado", "==", filtros.estado));
  const snap = await getDocs(q);

  let columnas, filas;
  if (formato === "compatible") {
    columnas = COLUMNAS_COMPATIBLES.map((h) => ({ header: h, key: h, width: 18 }));
    filas = snap.docs.map((d) => {
      const c = d.data();
      const fila = Object.fromEntries(COLUMNAS_COMPATIBLES.map((k) => [k, ""]));
      return { ...fila, NOMBRE: c.nombre || "", PAIS: "México", "TELÉFONO": c.telefono || "", CELULAR: c.celular || "", EMAILS: c.email || "", "APLICA RETENCIONES (S/N)": "N", "DESGLOSAR IEPS (S/N)": "N" };
    });
  } else {
    const mapaSucursales = await obtenerMapaSucursales();
    columnas = [
      { header: "Cliente ID", key: "clienteId", width: 14 },
      { header: "Nombre", key: "nombre", width: 28 },
      { header: "Teléfono", key: "telefono", width: 14 },
      { header: "Celular", key: "celular", width: 14 },
      { header: "Email", key: "email", width: 26 },
      { header: "Rango de edad", key: "rangoEdad", width: 14 },
      { header: "Sucursal preferida", key: "sucursalNombre", width: 20 },
      { header: "Estado", key: "estadoLegible", width: 12 },
      { header: "Fecha de registro", key: "fechaRegistro", width: 18, esFecha: true },
      { header: "Última actualización", key: "fechaActualizacion", width: 20, esFecha: true },
    ];
    filas = snap.docs.map((d) => {
      const c = d.data();
      return {
        clienteId: c.clienteId, nombre: c.nombre || "", telefono: c.telefono || "", celular: c.celular || "",
        email: c.email || "", rangoEdad: c.rangoEdad || "",
        sucursalNombre: mapaSucursales[c.sucursalPreferida] || c.sucursalPreferida || "",
        estadoLegible: capitalizar(c.estado), fechaRegistro: fechaCelda(c.fechaRegistro), fechaActualizacion: fechaCelda(c.fechaActualizacion),
      };
    });
  }

  await descargarTabla({ nombreHoja: "Clientes", columnas, filas, nombreArchivo: `clientes_${formato}_${Date.now()}.xlsx` });
  await registrarAuditoria({ accion: "exportar_clientes", modulo: "exportaciones", detalle: { formato, filtros, registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarRespuestas({ campanaId } = {}) {
  let q = collection(db, "respuestas");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  const snap = await getDocs(q);

  const idsCampanas = [...new Set(snap.docs.map((d) => d.data().campanaId).filter(Boolean))];

  const [mapaClientes, mapaSucursales, mapaCampanas, mapaPreguntas] = await Promise.all([
    obtenerMapaClientes(snap.docs.map((d) => d.data().clienteId)),
    obtenerMapaSucursales(),
    obtenerMapaCampanas(),
    obtenerMapaPreguntas(idsCampanas),
  ]);

  const preguntasSet = new Set();
  const filas = snap.docs.map((d) => {
    const r = d.data();
    const respuestas = {};
    let sucursalSistemaId = "";
    Object.entries(r.respuestas || {}).forEach(([preguntaId, valor]) => {
      // "sucursal_sistema" no es una pregunta de la encuesta: es la sucursal
      // donde se contestó (según el dispositivo/caja), se resuelve aparte.
      if (preguntaId === "sucursal_sistema") {
        sucursalSistemaId = valor;
        return;
      }
      preguntasSet.add(preguntaId);
      respuestas[preguntaId] = Array.isArray(valor) ? valor.join(", ") : valor;
    });
    return {
      clienteId: r.clienteId, clienteNombre: mapaClientes[r.clienteId] || "",
      campanaId: r.campanaId, campanaNombre: mapaCampanas[r.campanaId] || r.campanaId,
      versionCampana: r.versionCampana,
      sucursalId: r.sucursalId, sucursalNombre: mapaSucursales[r.sucursalId] || r.sucursalId,
      sucursalSistemaNombre: mapaSucursales[sucursalSistemaId] || sucursalSistemaId,
      fecha: fechaCelda(r.fecha), ...respuestas,
    };
  });

  const preguntasOrdenadas = [...preguntasSet].sort((a, b) => {
    const ordenA = mapaPreguntas[a]?.orden ?? Infinity;
    const ordenB = mapaPreguntas[b]?.orden ?? Infinity;
    return ordenA - ordenB;
  });

  const columnas = [
    { header: "Cliente ID", key: "clienteId", width: 14 },
    { header: "Cliente", key: "clienteNombre", width: 24 },
    { header: "Campaña ID", key: "campanaId", width: 16 },
    { header: "Campaña", key: "campanaNombre", width: 22 },
    { header: "Versión encuesta", key: "versionCampana", width: 14 },
    { header: "Sucursal ID", key: "sucursalId", width: 12 },
    { header: "Sucursal", key: "sucursalNombre", width: 20 },
    { header: "Sucursal (dispositivo)", key: "sucursalSistemaNombre", width: 20 },
    { header: "Fecha", key: "fecha", width: 18, esFecha: true },
    ...preguntasOrdenadas.map((p) => ({ header: mapaPreguntas[p]?.texto || p, key: p, width: 30 })),
  ];

  await descargarTabla({ nombreHoja: "Respuestas", columnas, filas, nombreArchivo: `respuestas_${campanaId || "todas"}_${Date.now()}.xlsx` });
  await registrarAuditoria({ accion: "exportar_respuestas", modulo: "exportaciones", detalle: { campanaId: campanaId || "todas", registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarBeneficios({ campanaId, sucursalId, estadoUso } = {}) {
  let q = collection(db, "beneficiosAsignados");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  if (sucursalId) q = query(q, where("sucursalId", "==", sucursalId));
  if (estadoUso) q = query(q, where("estadoUso", "==", estadoUso));
  const snap = await getDocs(q);

  // beneficioNombre y clienteNombre ya vienen guardados en el propio
  // documento (se copian al momento de generar el código, ver
  // firestore-ops.js), así que no hace falta volver a consultarlos.
  const [mapaSucursales, mapaCampanas] = await Promise.all([obtenerMapaSucursales(), obtenerMapaCampanas()]);

  const columnas = [
    { header: "Código de barras", key: "codigoBarras", width: 20 },
    { header: "Cliente ID", key: "clienteId", width: 14 },
    { header: "Cliente", key: "clienteNombre", width: 24 },
    { header: "Beneficio", key: "beneficioNombre", width: 24 },
    { header: "Campaña ID", key: "campanaId", width: 16 },
    { header: "Campaña", key: "campanaNombre", width: 22 },
    { header: "Sucursal ID", key: "sucursalId", width: 12 },
    { header: "Sucursal", key: "sucursalNombre", width: 20 },
    { header: "Estado", key: "estadoLegible", width: 12 },
    { header: "Generado", key: "generado", width: 18, esFecha: true },
    { header: "Expira", key: "expira", width: 18, esFecha: true },
    { header: "Validado por", key: "validadoPor", width: 20 },
    { header: "Fecha validación", key: "fechaValidacion", width: 20, esFecha: true },
  ];

  const filas = snap.docs.map((d) => {
    const b = d.data();
    return {
      codigoBarras: b.codigoBarras, clienteId: b.clienteId, clienteNombre: b.clienteNombre || "",
      beneficioNombre: b.beneficioNombre || "", campanaId: b.campanaId, campanaNombre: mapaCampanas[b.campanaId] || b.campanaId,
      sucursalId: b.sucursalId, sucursalNombre: mapaSucursales[b.sucursalId] || b.sucursalId,
      estadoLegible: capitalizar(b.estadoUso), generado: fechaCelda(b.fechaGeneracion), expira: fechaCelda(b.fechaExpiracionCodigo),
      validadoPor: b.validadoPor || "", fechaValidacion: fechaCelda(b.fechaHoraValidacion),
    };
  });

  await descargarTabla({ nombreHoja: "Beneficios", columnas, filas, nombreArchivo: `beneficios_${Date.now()}.xlsx` });
  await registrarAuditoria({ accion: "exportar_beneficios", modulo: "exportaciones", detalle: { campanaId, sucursalId, estadoUso, registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarConsentimientos() {
  const snap = await getDocs(collection(db, "consentimientos"));
  const [mapaClientes, mapaCampanas] = await Promise.all([
    obtenerMapaClientes(snap.docs.map((d) => d.data().clienteId)),
    obtenerMapaCampanas(),
  ]);

  const columnas = [
    { header: "Cliente ID", key: "clienteId", width: 14 },
    { header: "Cliente", key: "clienteNombre", width: 24 },
    { header: "Campaña ID", key: "campanaId", width: 16 },
    { header: "Campaña", key: "campanaNombre", width: 22 },
    { header: "Tipo", key: "tipoLegible", width: 26 },
    { header: "Aceptado", key: "aceptado", width: 10 },
    { header: "Versión", key: "version", width: 10 },
    { header: "Fecha", key: "fecha", width: 18, esFecha: true },
  ];
  const filas = snap.docs.map((d) => {
    const c = d.data();
    return {
      clienteId: c.clienteId, clienteNombre: mapaClientes[c.clienteId] || "",
      campanaId: c.campanaId || "", campanaNombre: c.campanaId ? (mapaCampanas[c.campanaId] || c.campanaId) : "",
      tipoLegible: etiquetaConsentimiento(c.tipo), aceptado: c.aceptado ? "Sí" : "No", version: c.version, fecha: fechaCelda(c.fechaHora),
    };
  });
  await descargarTabla({ nombreHoja: "Consentimientos", columnas, filas, nombreArchivo: `consentimientos_${Date.now()}.xlsx` });
  await registrarAuditoria({ accion: "exportar_consentimientos", modulo: "exportaciones", detalle: { registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarDashboard({ campanaId } = {}) {
  let q = collection(db, "respuestas");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  const snap = await getDocs(q);

  const [mapaSucursales, mapaCampanas] = await Promise.all([obtenerMapaSucursales(), obtenerMapaCampanas()]);

  const porSucursal = {};
  snap.forEach((d) => { const r = d.data(); porSucursal[r.sucursalId] = (porSucursal[r.sucursalId] || 0) + 1; });

  const libro = new window.ExcelJS.Workbook();
  libro.creator = "HOLAA Trendy";
  libro.created = new Date();
  const hoja = libro.addWorksheet("Resumen");
  hoja.columns = [{ width: 26 }, { width: 18 }];

  hoja.addRow(["Campaña", campanaId ? (mapaCampanas[campanaId] || campanaId) : "Todas"]);
  hoja.addRow(["Total de participaciones", snap.size]);
  hoja.getCell("A1").font = { bold: true };
  hoja.getCell("A2").font = { bold: true };
  hoja.addRow([]);

  const filaEncabezado = hoja.addRow(["Sucursal", "Participaciones"]);
  estilizarEncabezado(filaEncabezado);

  Object.entries(porSucursal)
    .sort((a, b) => b[1] - a[1])
    .forEach(([suc, count]) => hoja.addRow([mapaSucursales[suc] || suc, count]));

  aplicarBandasYBordes(hoja, filaEncabezado.number + 1);
  if (Object.keys(porSucursal).length) {
    hoja.autoFilter = { from: { row: filaEncabezado.number, column: 1 }, to: { row: filaEncabezado.number, column: 2 } };
  }

  await guardarBlob(libro, `dashboard_${campanaId || "todas"}_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_dashboard", modulo: "exportaciones", detalle: { campanaId: campanaId || "todas" } });
}

// ---------------------------------------------------------------
// exportarSegmento — Sección 21: exporta EXACTAMENTE el segmento
// que se ve en pantalla (mismos filtros ya aplicados por
// segmentos.js, incluido consentimiento, periodo, frecuencia y
// "clientes comunes"), en vez de volver a construir el archivo con
// una consulta aparte que podía perder filtros (p. ej. antes el
// Excel ignoraba el filtro de consentimiento).
// ---------------------------------------------------------------
export async function exportarSegmento({ clientes, mapaSucursales, mapaActividad, criterios = {} }) {
  const libro = new window.ExcelJS.Workbook();
  libro.creator = "HOLAA Trendy";
  libro.created = new Date();
  const hoja = libro.addWorksheet("Segmento");

  const filasCriterios = [
    ["Sucursal", criterios.sucursalNombre || "Cualquiera"],
    ["Estado", criterios.estado ? capitalizar(criterios.estado) : "Cualquiera"],
    ["Consentimiento", criterios.consentimiento === "comercial_si" ? "Aceptan promociones" : "Cualquiera"],
    ["Periodo analizado", (criterios.fechaInicio || criterios.fechaFin) ? `${criterios.fechaInicio || "…"} a ${criterios.fechaFin || "…"}` : "Todo el historial"],
  ];
  if (criterios.soloFrecuentes) filasCriterios.push(["Solo clientes frecuentes", `Sí (mínimo ${criterios.umbralFrecuencia} visitas)`]);
  if (criterios.soloComunes) filasCriterios.push(["Solo clientes comunes (varias sucursales)", "Sí"]);
  filasCriterios.push(["Total de clientes en el segmento", clientes.length]);

  filasCriterios.forEach(([etiqueta, valor]) => {
    const fila = hoja.addRow([etiqueta, valor]);
    fila.getCell(1).font = { bold: true };
  });
  hoja.addRow([]);

  const conActividad = !!mapaActividad;
  const encabezados = ["Nombre", "Teléfono", "Sucursal preferida", "Registro"];
  if (conActividad) encabezados.push("Visitas en el periodo", "Sucursales visitadas");

  const filaEncabezado = hoja.addRow(encabezados);
  estilizarEncabezado(filaEncabezado);

  clientes.forEach((c) => {
    const act = conActividad ? mapaActividad[c.clienteId] : null;
    const fila = [c.nombre || "", c.telefono || "", mapaSucursales[c.sucursalPreferida] || c.sucursalPreferida || "", fechaCelda(c.fechaRegistro)];
    if (conActividad) fila.push(act?.visitas || 0, act?.sucursales?.size || 0);
    hoja.addRow(fila);
  });

  const anchos = [26, 16, 20, 18];
  if (conActividad) anchos.push(16, 18);
  anchos.forEach((w, i) => { hoja.getColumn(i + 1).width = w; });
  hoja.getColumn(4).numFmt = "dd/mm/yyyy hh:mm";

  aplicarBandasYBordes(hoja, filaEncabezado.number + 1);
  if (clientes.length) {
    hoja.autoFilter = { from: { row: filaEncabezado.number, column: 1 }, to: { row: filaEncabezado.number, column: encabezados.length } };
  }
  hoja.views = [{ state: "frozen", ySplit: filaEncabezado.number }];

  await guardarBlob(libro, `segmento_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_segmento", modulo: "exportaciones", detalle: { ...criterios, registros: clientes.length } });
  return { registros: clientes.length };
}
