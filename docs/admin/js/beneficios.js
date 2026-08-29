import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFechaHora, badgeEstadoUso, mostrarToast } from "./utils.js";
import { exportarBeneficios } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

export async function renderBeneficios(el, ctx) {
  el.innerHTML = `
    <div class="filtros-fila">
      <select id="sel-estado">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="usado">Usado</option>
        <option value="expirado">Expirado</option>
        <option value="cancelado">Cancelado</option>
      </select>
      ${puedeExportar(ctx.rol) ? `<button class="btn btn-primario" id="btn-exportar-beneficios">Exportar a Excel</button>` : ""}
    </div>
    <div class="tabla-wrap"><div id="lista-beneficios" class="mensaje-vacio">Cargando…</div></div>`;

  await cargarLista();
  document.getElementById("sel-estado").onchange = cargarLista;

  const btnExportar = document.getElementById("btn-exportar-beneficios");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      const estadoUso = document.getElementById("sel-estado").value;
      btnExportar.disabled = true;
      btnExportar.textContent = "Generando…";
      try {
        const r = await exportarBeneficios({ estadoUso: estadoUso || undefined });
        mostrarToast(`Exportación lista (${r.registros} registros).`, "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
      btnExportar.textContent = "Exportar a Excel";
    };
  }
}

async function cargarLista() {
  const cont = document.getElementById("lista-beneficios");
  const snap = await getDocs(query(collection(db, "beneficiosAsignados"), orderBy("fechaGeneracion", "desc"), limit(150)));
  const estadoFiltro = document.getElementById("sel-estado")?.value;
  const docs = estadoFiltro ? snap.docs.filter((d) => d.data().estadoUso === estadoFiltro) : snap.docs;

  if (docs.length === 0) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">🎁</div>No hay beneficios que coincidan.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Sucursal</th><th>Estado</th><th>Generado</th><th>Validado</th></tr></thead>
      <tbody>
        ${docs.map((d) => { const b = d.data(); return `
          <tr>
            <td style="font-family:monospace">${escapeHtml(b.codigoBarras)}</td>
            <td>${escapeHtml(b.sucursalId || "—")}</td>
            <td>${badgeEstadoUso(b.estadoUso)}</td>
            <td>${formatearFechaHora(b.fechaGeneracion)}</td>
            <td>${b.fechaHoraValidacion ? formatearFechaHora(b.fechaHoraValidacion) : "—"}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>`;
}
