import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFecha, mostrarToast } from "./utils.js";
import { exportarSegmento } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

const UMBRAL_FRECUENCIA_DEFECTO = 2;

/**
 * Constructor de segmentos (Sección 21): el administrador combina
 * criterios estáticos sobre /clientes (sucursal, estado,
 * consentimiento) con un análisis dinámico de actividad tomado de
 * /respuestas — cada encuesta contestada es una "visita" del
 * cliente a una sucursal. Con eso se puede acotar el segmento a un
 * periodo (fecha inicial/fecha final elegidas por el usuario),
 * quedarse solo con clientes frecuentes (visitas >= umbral) o solo
 * con clientes comunes entre sucursales (contestaron en más de una).
 *
 * Nota: el sistema no registra compras/ventas, solo participación
 * en campañas (encuestas y canjes), así que "frecuente"/"común" se
 * mide sobre esa actividad, no sobre historial de compra.
 */
export async function renderSegmentos(el, ctx) {
  const sucursales = (await getDocs(collection(db, "sucursales"))).docs.map((d) => d.data());

  el.innerHTML = `
    <div class="tabla-wrap" style="padding:1.25rem;margin-bottom:1.25rem">
      <div class="filtros-fila">
        <select id="f-sucursal"><option value="">Cualquier sucursal</option>${sucursales.map((s) => `<option value="${s.sucursalId}">${escapeHtml(s.nombre)}</option>`).join("")}</select>
        <select id="f-consentimiento">
          <option value="">Cualquier consentimiento</option>
          <option value="comercial_si">Aceptan promociones</option>
        </select>
        <select id="f-estado"><option value="">Cualquier estado</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option></select>
      </div>
      <div class="filtros-fila" style="margin-top:0.6rem;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.82rem;color:var(--holaa-gris-texto)">Del <input type="date" id="f-fecha-inicio" style="margin:0 0.4rem"></label>
        <label style="font-size:0.82rem;color:var(--holaa-gris-texto)">al <input type="date" id="f-fecha-fin" style="margin:0 0.4rem"></label>
        <label style="font-size:0.82rem;display:flex;align-items:center;gap:0.3rem">
          <input type="checkbox" id="f-frecuentes"> Solo clientes frecuentes (mínimo
          <input type="number" id="f-umbral" min="2" value="${UMBRAL_FRECUENCIA_DEFECTO}" style="width:3.2rem">
          visitas)
        </label>
        <label style="font-size:0.82rem;display:flex;align-items:center;gap:0.3rem">
          <input type="checkbox" id="f-comunes"> Solo clientes comunes (varias sucursales)
        </label>
      </div>
      <p style="font-size:0.76rem;color:var(--holaa-gris-texto);margin:0.5rem 0 0">
        El periodo y los filtros de frecuencia se calculan sobre las encuestas contestadas (Sección /respuestas), no sobre historial de compra.
      </p>
      <div class="filtros-fila" style="margin-top:0.75rem;margin-bottom:0">
        <button class="btn btn-primario" id="btn-buscar-segmento">Construir segmento</button>
      </div>
    </div>
    <div id="resultado-segmento"></div>`;

  document.getElementById("btn-buscar-segmento").onclick = () => buscarSegmento(ctx);
}

// Une, por clienteId, cuántas encuestas contestó (visitas) y en
// cuántas sucursales distintas lo hizo, dentro del rango de fechas
// dado (si no se da rango, se analiza todo el historial).
async function obtenerMapaActividad({ fechaInicio, fechaFin }) {
  let q = collection(db, "respuestas");
  const condiciones = [];
  if (fechaInicio) condiciones.push(where("fecha", ">=", new Date(`${fechaInicio}T00:00:00`)));
  if (fechaFin) condiciones.push(where("fecha", "<=", new Date(`${fechaFin}T23:59:59.999`)));
  const consulta = condiciones.length ? query(q, ...condiciones) : query(q);
  const snap = await getDocs(consulta);

  const mapa = {};
  snap.forEach((d) => {
    const r = d.data();
    if (!r.clienteId) return;
    if (!mapa[r.clienteId]) mapa[r.clienteId] = { visitas: 0, sucursales: new Set() };
    mapa[r.clienteId].visitas += 1;
    if (r.sucursalId) mapa[r.clienteId].sucursales.add(r.sucursalId);
  });
  return mapa;
}

async function buscarSegmento(ctx) {
  const sucursalId = document.getElementById("f-sucursal").value;
  const estado = document.getElementById("f-estado").value;
  const consentimiento = document.getElementById("f-consentimiento").value;
  const fechaInicio = document.getElementById("f-fecha-inicio").value;
  const fechaFin = document.getElementById("f-fecha-fin").value;
  const soloFrecuentes = document.getElementById("f-frecuentes").checked;
  const umbralFrecuencia = Math.max(2, Number(document.getElementById("f-umbral").value) || UMBRAL_FRECUENCIA_DEFECTO);
  const soloComunes = document.getElementById("f-comunes").checked;

  if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
    mostrarToast("La fecha inicial no puede ser posterior a la fecha final.", "error");
    return;
  }

  const cont = document.getElementById("resultado-segmento");
  cont.innerHTML = `<div class="mensaje-vacio">Buscando…</div>`;

  const sucursalesSnap = await getDocs(collection(db, "sucursales"));
  const mapaSucursales = Object.fromEntries(sucursalesSnap.docs.map((d) => [d.data().sucursalId, d.data().nombre]));

  let q = collection(db, "clientes");
  const condiciones = [];
  if (sucursalId) condiciones.push(where("sucursalPreferida", "==", sucursalId));
  if (estado) condiciones.push(where("estado", "==", estado));
  const consulta = condiciones.length ? query(q, ...condiciones) : query(q);
  const snap = await getDocs(consulta);

  let clientes = snap.docs.map((d) => d.data());

  if (consentimiento === "comercial_si") {
    const idsConSet = new Set();
    const consentSnap = await getDocs(query(collection(db, "consentimientos"), where("tipo", "==", "comunicaciones_comerciales"), where("aceptado", "==", true)));
    consentSnap.forEach((d) => idsConSet.add(d.data().clienteId));
    clientes = clientes.filter((c) => idsConSet.has(c.clienteId));
  }

  // Actividad dinámica: solo se calcula si el usuario pidió periodo,
  // frecuencia o "comunes" — si no, el segmento se comporta como antes.
  const necesitaActividad = !!(fechaInicio || fechaFin || soloFrecuentes || soloComunes);
  let mapaActividad = null;
  if (necesitaActividad) {
    mapaActividad = await obtenerMapaActividad({ fechaInicio, fechaFin });
    if (fechaInicio || fechaFin) {
      clientes = clientes.filter((c) => mapaActividad[c.clienteId]);
    }
    if (soloFrecuentes) {
      clientes = clientes.filter((c) => (mapaActividad[c.clienteId]?.visitas || 0) >= umbralFrecuencia);
    }
    if (soloComunes) {
      clientes = clientes.filter((c) => (mapaActividad[c.clienteId]?.sucursales?.size || 0) >= 2);
    }
    clientes.sort((a, b) => (mapaActividad[b.clienteId]?.visitas || 0) - (mapaActividad[a.clienteId]?.visitas || 0));
  }

  if (clientes.length === 0) {
    cont.innerHTML = `<div class="tabla-wrap"><div class="mensaje-vacio"><div class="icono">🧩</div>Ningún cliente cumple estos criterios.</div></div>`;
    return;
  }

  cont.innerHTML = `
    <div class="tabla-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1rem 0">
        <strong>${clientes.length} clientes en este segmento</strong>
        ${puedeExportar(ctx.rol) ? `<button class="btn btn-secundario" id="btn-exportar-segmento">Exportar a Excel</button>` : ""}
      </div>
      <table>
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Sucursal</th><th>Registro</th>${necesitaActividad ? "<th>Visitas</th><th>Sucursales visitadas</th>" : ""}</tr></thead>
        <tbody>
          ${clientes.slice(0, 200).map((c) => {
            const act = necesitaActividad ? mapaActividad[c.clienteId] : null;
            return `
            <tr>
              <td>${escapeHtml(c.nombre || "—")}</td><td>${escapeHtml(c.telefono || "—")}</td><td>${escapeHtml(mapaSucursales[c.sucursalPreferida] || "—")}</td><td>${formatearFecha(c.fechaRegistro)}</td>
              ${necesitaActividad ? `<td>${act?.visitas || 0}</td><td>${act?.sucursales?.size || 0}</td>` : ""}
            </tr>`; }).join("")}
        </tbody>
      </table>
      ${clientes.length > 200 ? `<p style="padding:0.75rem 1rem;color:var(--holaa-gris-texto);font-size:0.78rem;margin:0">Mostrando los primeros 200. Usa "Exportar a Excel" para el segmento completo.</p>` : ""}
    </div>`;

  const btnExportar = document.getElementById("btn-exportar-segmento");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      btnExportar.disabled = true;
      try {
        await exportarSegmento({
          clientes, mapaSucursales, mapaActividad,
          criterios: {
            sucursalNombre: sucursalId ? (mapaSucursales[sucursalId] || sucursalId) : "",
            estado, consentimiento, fechaInicio, fechaFin, soloFrecuentes, umbralFrecuencia, soloComunes,
          },
        });
        mostrarToast("Exportación lista.", "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
    };
  }
}
