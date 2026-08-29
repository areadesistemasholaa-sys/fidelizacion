import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFechaHora } from "./utils.js";

export async function renderAuditoria(el) {
  el.innerHTML = `<div class="tabla-wrap"><div id="lista-auditoria" class="mensaje-vacio">Cargando…</div></div>`;

  const snap = await getDocs(query(collection(db, "auditoria"), orderBy("fechaHora", "desc"), limit(200)));
  const cont = document.getElementById("lista-auditoria");
  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">🛡️</div>Sin actividad registrada todavía.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Acción</th><th>Módulo</th><th>Usuario</th><th>Rol</th></tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const a = d.data(); return `
          <tr>
            <td>${formatearFechaHora(a.fechaHora)}</td>
            <td>${escapeHtml(a.accion)}</td>
            <td>${escapeHtml(a.modulo)}</td>
            <td>${escapeHtml(a.usuarioEmail || "—")}</td>
            <td>${escapeHtml(a.rol || "—")}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>`;
}
