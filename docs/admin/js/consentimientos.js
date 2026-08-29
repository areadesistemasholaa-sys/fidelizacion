import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFechaHora, mostrarToast } from "./utils.js";
import { exportarConsentimientos } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

export async function renderConsentimientos(el, ctx) {
  el.innerHTML = `
    <div class="filtros-fila">
      ${puedeExportar(ctx.rol) ? `<button class="btn btn-primario" id="btn-exportar-consent">Exportar a Excel</button>` : ""}
    </div>
    <div class="tabla-wrap"><div id="lista-consent" class="mensaje-vacio">Cargando…</div></div>`;

  const snap = await getDocs(query(collection(db, "consentimientos"), orderBy("fechaHora", "desc"), limit(150)));
  const cont = document.getElementById("lista-consent");
  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">✅</div>Aún no hay consentimientos registrados.</div>`;
  } else {
    cont.innerHTML = `
      <table>
        <thead><tr><th>Cliente</th><th>Tipo</th><th>Aceptado</th><th>Versión</th><th>Fecha</th></tr></thead>
        <tbody>
          ${snap.docs.map((d) => { const c = d.data(); return `
            <tr>
              <td>${escapeHtml(c.clienteId).slice(0, 10)}…</td>
              <td>${etiquetaTipo(c.tipo)}</td>
              <td>${c.aceptado ? "✅ Sí" : "❌ No"}</td>
              <td>v${c.version || 1}</td>
              <td>${formatearFechaHora(c.fechaHora)}</td>
            </tr>`; }).join("")}
        </tbody>
      </table>`;
  }

  const btnExportar = document.getElementById("btn-exportar-consent");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      btnExportar.disabled = true;
      try {
        const r = await exportarConsentimientos();
        mostrarToast(`Exportación lista (${r.registros} registros).`, "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
    };
  }
}

function etiquetaTipo(tipo) {
  return { aviso_privacidad: "Aviso de privacidad", comunicaciones_comerciales: "Comunicaciones comerciales", analitica: "Analítica" }[tipo] || tipo;
}
