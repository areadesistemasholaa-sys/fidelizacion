import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFecha, mostrarToast } from "./utils.js";
import { exportarClientes } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

/**
 * Constructor de segmentos (Sección 21): el administrador combina
 * criterios sobre /clientes (sucursal, estado) y, cuando aplica,
 * sobre /respuestas (rango de edad, campaña) para obtener un
 * listado exportable. Firestore no permite combinar libremente
 * cualquier condición en una sola consulta, así que se filtra en
 * cliente sobre el universo de /clientes ya acotado por sucursal.
 */
export async function renderSegmentos(el, ctx) {
  const sucursales = (await getDocs(collection(db, "sucursales"))).docs.map((d) => d.data());

  el.innerHTML = `
    <div class="tabla-wrap" style="padding:1.25rem;margin-bottom:1.25rem">
      <div class="filtros-fila" style="margin-bottom:0">
        <select id="f-sucursal"><option value="">Cualquier sucursal</option>${sucursales.map((s) => `<option value="${s.sucursalId}">${escapeHtml(s.nombre)}</option>`).join("")}</select>
        <select id="f-consentimiento">
          <option value="">Cualquier consentimiento</option>
          <option value="comercial_si">Aceptan promociones</option>
        </select>
        <select id="f-estado"><option value="">Cualquier estado</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option></select>
        <button class="btn btn-primario" id="btn-buscar-segmento">Construir segmento</button>
      </div>
    </div>
    <div id="resultado-segmento"></div>`;

  document.getElementById("btn-buscar-segmento").onclick = () => buscarSegmento(ctx);
}

async function buscarSegmento(ctx) {
  const sucursalId = document.getElementById("f-sucursal").value;
  const estado = document.getElementById("f-estado").value;
  const consentimiento = document.getElementById("f-consentimiento").value;

  const cont = document.getElementById("resultado-segmento");
  cont.innerHTML = `<div class="mensaje-vacio">Buscando…</div>`;

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
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Sucursal</th><th>Registro</th></tr></thead>
        <tbody>
          ${clientes.slice(0, 200).map((c) => `
            <tr><td>${escapeHtml(c.nombre || "—")}</td><td>${escapeHtml(c.telefono || "—")}</td><td>${escapeHtml(c.sucursalPreferida || "—")}</td><td>${formatearFecha(c.fechaRegistro)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  const btnExportar = document.getElementById("btn-exportar-segmento");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      btnExportar.disabled = true;
      try {
        await exportarClientes({ formato: "extendida", filtros: { sucursalId: sucursalId || undefined, estado: estado || undefined } });
        mostrarToast("Exportación lista.", "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
    };
  }
}
