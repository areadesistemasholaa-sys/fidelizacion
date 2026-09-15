// ===================================================================
// HOLAA Trendy — Exportación a Excel (camino "100% Spark")
// Panel Admin -> lee Firestore directo (permitido por rol vía
// firestore.rules) -> arma el .xlsx en el propio navegador con
// ExcelJS + FileSaver (cargados por CDN, ver admin/index.html) ->
// descarga inmediata. No hay URL que expire.
//
// A diferencia del volcado plano que producía SheetJS
// (XLSX.utils.json_to_sheet), aquí cada hoja se arma con encabezado
// legible y con estilo, anchos de columna reales, fechas como
// fechas (no texto ISO) y franjas de lectura — igual que la versión
// que antes generaba la Cloud Function con ExcelJS.
// ===================================================================

import { db, auth } from "/shared/firebase-config.js";
import {
  collection, getDocs, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { registrarAuditoria } from "/shared/firestore-ops.js";

const MAGENTA_HOLAA = "C20152";
const GRIS_BANDA = "F7F2F5";
const GRIS_BORDE = "EDEDED";

function fechaISO(v) {
  return v?.toDate ? v.toDate().toISOString() : v ? new Date(v).toISOString() : "";
}

// Para celdas: se guarda como Date real (con numFmt) en vez de texto
// ISO plano, para que Excel la reconozca y se pueda ordenar/filtrar.
function fechaCelda(v) {
  if (!v) return null;
  return v?.toDate ? v.toDate() : new Date(v);
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

// Firestore limita las consultas "in" a 10 valores por lote, así que
// se arma el mapa clienteId -> nombre en tandas de 10.
async function obtenerMapaClientes(clienteIds) {
  const idsUnicos = [...new Set(clienteIds.filter(Boolean))];
  const mapa = {};
  const TAMANIO_LOTE = 10;
  for (let i = 0; i < idsUnicos.length; i += TAMANIO_LOTE) {
    const lote = idsUnicos.slice(i, i + TAMANIO_LOTE);
    const q = query(collection(db, "clientes"), where("clienteId", "in", lote));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const c = d.data();
      mapa[c.clienteId] = c.nombre || "";
    });
  }
  return mapa;
}

// Igual que obtenerMapaClientes, pero para resolver sucursalId -> nombre.
async function obtenerMapaSucursales(sucursalIds) {
  const idsUnicos = [...new Set(sucursalIds.filter(Boolean))];
  const mapa = {};
  const TAMANIO_LOTE = 10;
  for (let i = 0; i < idsUnicos.length; i += TAMANIO_LOTE) {
    const lote = idsUnicos.slice(i, i + TAMANIO_LOTE);
    const q = query(collection(db, "sucursales"), where("sucursalId", "in", lote));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const s = d.data();
      mapa[s.sucursalId] = s.nombre || "";
    });
  }
  return mapa;
}

// Las preguntas viven en la subcolección campanas/{campanaId}/preguntas.
// Se arma un mapa preguntaId -> { texto, orden } por cada campaña involucrada.
async function obtenerMapaPreguntas(campanaIds) {
  const idsUnicos = [...new Set(campanaIds.filter(Boolean))];
  const mapa = {};
  for (const campanaId of idsUnicos) {
    const snap = await getDocs(collection(db, "campanas", campanaId, "preguntas"));
    snap.forEach((d) => {
      const p = d.data();
      mapa[p.preguntaId || d.id] = { texto: p.texto || d.id, orden: p.orden ?? Infinity };
    });
  }
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
    columnas = [
      { header: "Cliente ID", key: "clienteId", width: 14 },
      { header: "Nombre", key: "nombre", width: 28 },
      { header: "Teléfono", key: "telefono", width: 14 },
      { header: "Celular", key: "celular", width: 14 },
      { header: "Email", key: "email", width: 26 },
      { header: "Rango de edad", key: "rangoEdad", width: 14 },
      { header: "Sucursal preferida", key: "sucursalPreferida", width: 18 },
      { header: "Estado", key: "estado", width: 12 },
      { header: "Fecha de registro", key: "fechaRegistro", width: 18, esFecha: true },
      { header: "Última actualización", key: "fechaActualizacion", width: 20, esFecha: true },
    ];
    filas = snap.docs.map((d) => {
      const c = d.data();
      return {
        clienteId: c.clienteId, nombre: c.nombre || "", telefono: c.telefono || "", celular: c.celular || "",
        email: c.email || "", rangoEdad: c.rangoEdad || "", sucursalPreferida: c.sucursalPreferida || "",
        estado: c.estado || "", fechaRegistro: fechaCelda(c.fechaRegistro), fechaActualizacion: fechaCelda(c.fechaActualizacion),
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

  const idsSucursales = [];
  const idsCampanas = [];
  snap.docs.forEach((d) => {
    const r = d.data();
    if (r.sucursalId) idsSucursales.push(r.sucursalId);
    if (r.respuestas?.sucursal_sistema) idsSucursales.push(r.respuestas.sucursal_sistema);
    if (r.campanaId) idsCampanas.push(r.campanaId);
  });

  const mapaClientes = await obtenerMapaClientes(snap.docs.map((d) => d.data().clienteId));
  const mapaSucursales = await obtenerMapaSucursales(idsSucursales);
  const mapaPreguntas = await obtenerMapaPreguntas(idsCampanas);

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
      clienteId: r.clienteId, nombre: mapaClientes[r.clienteId] || "", campanaId: r.campanaId, versionCampana: r.versionCampana,
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
    { header: "Nombre", key: "nombre", width: 24 },
    { header: "Campaña ID", key: "campanaId", width: 16 },
    { header: "Versión encuesta", key: "versionCampana", width: 16 },
    { header: "Sucursal ID", key: "sucursalId", width: 12 },
    { header: "Sucursal", key: "sucursalNombre", width: 22 },
    { header: "Sucursal (dispositivo)", key: "sucursalSistemaNombre", width: 22 },
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

  const columnas = [
    { header: "Código de barras", key: "codigoBarras", width: 20 },
    { header: "Cliente ID", key: "clienteId", width: 14 },
    { header: "Campaña", key: "campanaId", width: 16 },
    { header: "Sucursal", key: "sucursalId", width: 12 },
    { header: "Estado", key: "estadoUso", width: 12 },
    { header: "Generado", key: "generado", width: 18, esFecha: true },
    { header: "Expira", key: "expira", width: 18, esFecha: true },
    { header: "Validado por", key: "validadoPor", width: 18 },
    { header: "Fecha validación", key: "fechaValidacion", width: 20, esFecha: true },
  ];

  const filas = snap.docs.map((d) => {
    const b = d.data();
    return {
      codigoBarras: b.codigoBarras, clienteId: b.clienteId, campanaId: b.campanaId, sucursalId: b.sucursalId,
      estadoUso: b.estadoUso, generado: fechaCelda(b.fechaGeneracion), expira: fechaCelda(b.fechaExpiracionCodigo),
      validadoPor: b.validadoPor || "", fechaValidacion: fechaCelda(b.fechaHoraValidacion),
    };
  });

  await descargarTabla({ nombreHoja: "Beneficios", columnas, filas, nombreArchivo: `beneficios_${Date.now()}.xlsx` });
  await registrarAuditoria({ accion: "exportar_beneficios", modulo: "exportaciones", detalle: { campanaId, sucursalId, estadoUso, registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarConsentimientos() {
  const snap = await getDocs(collection(db, "consentimientos"));
  const columnas = [
    { header: "Cliente ID", key: "clienteId", width: 14 },
    { header: "Campaña", key: "campanaId", width: 16 },
    { header: "Tipo", key: "tipo", width: 22 },
    { header: "Aceptado", key: "aceptado", width: 10 },
    { header: "Versión", key: "version", width: 10 },
    { header: "Fecha", key: "fecha", width: 18, esFecha: true },
  ];
  const filas = snap.docs.map((d) => {
    const c = d.data();
    return { clienteId: c.clienteId, campanaId: c.campanaId || "", tipo: c.tipo, aceptado: c.aceptado ? "Sí" : "No", version: c.version, fecha: fechaCelda(c.fechaHora) };
  });
  await descargarTabla({ nombreHoja: "Consentimientos", columnas, filas, nombreArchivo: `consentimientos_${Date.now()}.xlsx` });
  await registrarAuditoria({ accion: "exportar_consentimientos", modulo: "exportaciones", detalle: { registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarDashboard({ campanaId } = {}) {
  let q = collection(db, "respuestas");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  const snap = await getDocs(q);

  const porSucursal = {};
  snap.forEach((d) => { const r = d.data(); porSucursal[r.sucursalId] = (porSucursal[r.sucursalId] || 0) + 1; });

  const libro = new window.ExcelJS.Workbook();
  libro.creator = "HOLAA Trendy";
  libro.created = new Date();
  const hoja = libro.addWorksheet("Resumen");
  hoja.columns = [{ width: 26 }, { width: 18 }];

  hoja.addRow(["Campaña", campanaId || "Todas"]);
  hoja.addRow(["Total de participaciones", snap.size]);
  hoja.getCell("A1").font = { bold: true };
  hoja.getCell("A2").font = { bold: true };
  hoja.addRow([]);

  const filaEncabezado = hoja.addRow(["Sucursal", "Participaciones"]);
  estilizarEncabezado(filaEncabezado);

  Object.entries(porSucursal)
    .sort((a, b) => b[1] - a[1])
    .forEach(([suc, count]) => hoja.addRow([suc, count]));

  aplicarBandasYBordes(hoja, filaEncabezado.number + 1);
  if (Object.keys(porSucursal).length) {
    hoja.autoFilter = { from: { row: filaEncabezado.number, column: 1 }, to: { row: filaEncabezado.number, column: 2 } };
  }

  await guardarBlob(libro, `dashboard_${campanaId || "todas"}_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_dashboard", modulo: "exportaciones", detalle: { campanaId: campanaId || "todas" } });
}
