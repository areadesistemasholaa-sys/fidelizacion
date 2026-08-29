// ===================================================================
// HOLAA Trendy — Exportación a Excel (camino "100% Spark")
// Antes: Panel Admin -> Cloud Function -> ExcelJS -> Storage -> URL
//        firmada de 30 min.
// Ahora: Panel Admin -> lee Firestore directo (permitido por rol vía
//        firestore.rules) -> arma el .xlsx en el propio navegador con
//        SheetJS (cargado por CDN, ver admin/index.html) -> descarga
//        inmediata. Es incluso más simple: no hay URL que expire.
// ===================================================================

import { db, auth } from "/shared/firebase-config.js";
import {
  collection, getDocs, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { registrarAuditoria } from "/shared/firestore-ops.js";

function descargarLibro(hojaDatos, nombreHoja, nombreArchivo) {
  const libro = window.XLSX.utils.book_new();
  const hoja = window.XLSX.utils.json_to_sheet(hojaDatos);
  window.XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  window.XLSX.writeFile(libro, nombreArchivo);
}

function fechaISO(v) {
  return v?.toDate ? v.toDate().toISOString() : v ? new Date(v).toISOString() : "";
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

  let filas;
  if (formato === "compatible") {
    filas = snap.docs.map((d) => {
      const c = d.data();
      const fila = Object.fromEntries(COLUMNAS_COMPATIBLES.map((k) => [k, ""]));
      return { ...fila, NOMBRE: c.nombre || "", PAIS: "México", "TELÉFONO": c.telefono || "", CELULAR: c.celular || "", EMAILS: c.email || "", "APLICA RETENCIONES (S/N)": "N", "DESGLOSAR IEPS (S/N)": "N" };
    });
  } else {
    filas = snap.docs.map((d) => {
      const c = d.data();
      return {
        "Cliente ID": c.clienteId, Nombre: c.nombre || "", "Teléfono": c.telefono || "", Celular: c.celular || "",
        Email: c.email || "", "Rango de edad": c.rangoEdad || "", "Sucursal preferida": c.sucursalPreferida || "",
        Estado: c.estado || "", "Fecha de registro": fechaISO(c.fechaRegistro), "Última actualización": fechaISO(c.fechaActualizacion),
      };
    });
  }

  descargarLibro(filas, "Clientes", `clientes_${formato}_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_clientes", modulo: "exportaciones", detalle: { formato, filtros, registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarRespuestas({ campanaId } = {}) {
  let q = collection(db, "respuestas");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  const snap = await getDocs(q);

  const filas = snap.docs.map((d) => {
    const r = d.data();
    const fila = {
      "Cliente ID": r.clienteId, "Campaña ID": r.campanaId, "Versión encuesta": r.versionCampana,
      Sucursal: r.sucursalId, Fecha: fechaISO(r.fecha),
    };
    Object.entries(r.respuestas || {}).forEach(([preguntaId, valor]) => {
      fila[preguntaId] = Array.isArray(valor) ? valor.join(", ") : valor;
    });
    return fila;
  });

  descargarLibro(filas, "Respuestas", `respuestas_${campanaId || "todas"}_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_respuestas", modulo: "exportaciones", detalle: { campanaId: campanaId || "todas", registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarBeneficios({ campanaId, sucursalId, estadoUso } = {}) {
  let q = collection(db, "beneficiosAsignados");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  if (sucursalId) q = query(q, where("sucursalId", "==", sucursalId));
  if (estadoUso) q = query(q, where("estadoUso", "==", estadoUso));
  const snap = await getDocs(q);

  const filas = snap.docs.map((d) => {
    const b = d.data();
    return {
      "Código de barras": b.codigoBarras, "Cliente ID": b.clienteId, "Campaña": b.campanaId, Sucursal: b.sucursalId,
      Estado: b.estadoUso, Generado: fechaISO(b.fechaGeneracion), Expira: fechaISO(b.fechaExpiracionCodigo),
      "Validado por": b.validadoPor || "", "Fecha validación": fechaISO(b.fechaHoraValidacion),
    };
  });

  descargarLibro(filas, "Beneficios", `beneficios_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_beneficios", modulo: "exportaciones", detalle: { campanaId, sucursalId, estadoUso, registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarConsentimientos() {
  const snap = await getDocs(collection(db, "consentimientos"));
  const filas = snap.docs.map((d) => {
    const c = d.data();
    return { "Cliente ID": c.clienteId, "Campaña": c.campanaId || "", Tipo: c.tipo, Aceptado: c.aceptado ? "Sí" : "No", "Versión": c.version, Fecha: fechaISO(c.fechaHora) };
  });
  descargarLibro(filas, "Consentimientos", `consentimientos_${Date.now()}.xlsx`);
  await registrarAuditoria({ accion: "exportar_consentimientos", modulo: "exportaciones", detalle: { registros: snap.size } });
  return { registros: snap.size };
}

export async function exportarDashboard({ campanaId } = {}) {
  let q = collection(db, "respuestas");
  if (campanaId) q = query(q, where("campanaId", "==", campanaId));
  const snap = await getDocs(q);

  const porSucursal = {};
  snap.forEach((d) => { const r = d.data(); porSucursal[r.sucursalId] = (porSucursal[r.sucursalId] || 0) + 1; });

  const filas = [
    { A: "Campaña", B: campanaId || "Todas" },
    { A: "Total de participaciones", B: snap.size },
    { A: "", B: "" },
    { A: "Sucursal", B: "Participaciones" },
    ...Object.entries(porSucursal).map(([suc, count]) => ({ A: suc, B: count })),
  ];

  const libro = window.XLSX.utils.book_new();
  const hoja = window.XLSX.utils.json_to_sheet(filas, { skipHeader: true });
  window.XLSX.utils.book_append_sheet(libro, hoja, "Resumen");
  window.XLSX.writeFile(libro, `dashboard_${campanaId || "todas"}_${Date.now()}.xlsx`);

  await registrarAuditoria({ accion: "exportar_dashboard", modulo: "exportaciones", detalle: { campanaId: campanaId || "todas" } });
}
