import { db } from "/shared/firebase-config.js";
import { collection, query, where, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mostrarToast } from "./utils.js";
import { exportarDashboard } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

export async function renderDashboard(el, ctx) {
  el.innerHTML = `<div class="mensaje-vacio">Cargando estadísticas…</div>`;

  const [clientesCount, campanaActivaSnap, participacionesCount] = await Promise.all([
    getCountFromServer(collection(db, "clientes")),
    getDocs(query(collection(db, "campanas"), where("estado", "==", "activa"))),
    getCountFromServer(collection(db, "respuestas")),
  ]);

  const campanaActiva = campanaActivaSnap.docs[0]?.data();
  const campanaId = campanaActiva?.campanaId;

  let participacionesCampana = participacionesCount.data().count;
  if (campanaId) {
    const c = await getCountFromServer(query(collection(db, "respuestas"), where("campanaId", "==", campanaId)));
    participacionesCampana = c.data().count;
  }

  const beneficiosUsados = campanaId
    ? (await getCountFromServer(query(collection(db, "beneficiosAsignados"), where("campanaId", "==", campanaId), where("estadoUso", "==", "usado")))).data().count
    : 0;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="valor">${clientesCount.data().count}</div><div class="etiqueta">Clientes registrados</div></div>
      <div class="stat-card"><div class="valor">${campanaActiva ? campanaActiva.nombre : "Ninguna"}</div><div class="etiqueta">Campaña activa</div></div>
      <div class="stat-card"><div class="valor">${participacionesCampana}</div><div class="etiqueta">Participaciones (campaña activa)</div></div>
      <div class="stat-card"><div class="valor">${beneficiosUsados}</div><div class="etiqueta">Cupones canjeados</div></div>
    </div>
    <div class="tabla-wrap" style="padding:1.25rem">
      <p style="margin:0 0 1rem;color:var(--holaa-gris-texto);font-size:0.88rem">
        Distribución por sucursal, edad y preferencias disponible en el módulo <strong>Respuestas</strong> y <strong>Segmentos</strong>.
      </p>
      ${puedeExportar(ctx.rol) ? `<button class="btn btn-primario" id="btn-exportar-dash">Exportar resumen a Excel</button>` : ""}
    </div>`;

  const btnExportar = document.getElementById("btn-exportar-dash");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      btnExportar.disabled = true;
      btnExportar.textContent = "Generando…";
      try {
        await exportarDashboard({ campanaId: campanaId || null });
        mostrarToast("Exportación lista.", "exito");
      } catch (e) {
        mostrarToast(e.message || "No se pudo exportar.", "error");
      }
      btnExportar.disabled = false;
      btnExportar.textContent = "Exportar resumen a Excel";
    };
  }
}
