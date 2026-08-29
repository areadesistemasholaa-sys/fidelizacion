import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFechaHora, mostrarToast } from "./utils.js";
import { exportarRespuestas } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

export async function renderRespuestas(el, ctx) {
  const campanas = (await getDocs(collection(db, "campanas"))).docs.map((d) => d.data());

  el.innerHTML = `
    <div class="filtros-fila">
      <select id="sel-campana"><option value="">Todas las campañas</option>${campanas.map((c) => `<option value="${c.campanaId}">${escapeHtml(c.nombre)}</option>`).join("")}</select>
      ${puedeExportar(ctx.rol) ? `<button class="btn btn-primario" id="btn-exportar-respuestas">Exportar a Excel</button>` : ""}
    </div>
    <div class="tabla-wrap"><div id="lista-respuestas" class="mensaje-vacio">Selecciona una campaña o mira las más recientes…</div></div>`;

  document.getElementById("sel-campana").onchange = (e) => cargarLista(e.target.value);
  await cargarLista("");

  const btnExportar = document.getElementById("btn-exportar-respuestas");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      const campanaId = document.getElementById("sel-campana").value;
      btnExportar.disabled = true;
      btnExportar.textContent = "Generando…";
      try {
        const r = await exportarRespuestas({ campanaId: campanaId || undefined });
        mostrarToast(`Exportación lista (${r.registros} registros).`, "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
      btnExportar.textContent = "Exportar a Excel";
    };
  }
}

async function cargarLista(campanaId) {
  const cont = document.getElementById("lista-respuestas");
  let q = query(collection(db, "respuestas"), orderBy("fecha", "desc"), limit(150));
  if (campanaId) q = query(collection(db, "respuestas"), where("campanaId", "==", campanaId), orderBy("fecha", "desc"), limit(150));
  const snap = await getDocs(q);

  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">📝</div>Aún no hay respuestas registradas.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Cliente</th><th>Sucursal</th><th>Versión</th><th>Fecha</th></tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const r = d.data(); return `
          <tr>
            <td>${escapeHtml(r.clienteId).slice(0, 10)}…</td>
            <td>${escapeHtml(r.sucursalId || "—")}</td>
            <td>v${r.versionCampana || 1}</td>
            <td>${formatearFechaHora(r.fecha)}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>`;
}
