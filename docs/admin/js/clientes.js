import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFecha, mostrarToast } from "./utils.js";
import { exportarClientes } from "/shared/exportaciones.js";
import { puedeExportar } from "./menu.js";

export async function renderClientes(el, ctx) {
  el.innerHTML = `
    <div class="filtros-fila">
      ${puedeExportar(ctx.rol) ? `
        <select id="sel-formato-export">
          <option value="compatible">Exportar: formato compatible (contable)</option>
          <option value="extendida">Exportar: formato extendido (marketing)</option>
        </select>
        <button class="btn btn-primario" id="btn-exportar-clientes">Exportar a Excel</button>` : ""}
    </div>
    <div class="tabla-wrap"><div id="lista-clientes" class="mensaje-vacio">Cargando…</div></div>`;

  const btnExportar = document.getElementById("btn-exportar-clientes");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      const formato = document.getElementById("sel-formato-export").value;
      btnExportar.disabled = true;
      btnExportar.textContent = "Generando…";
      try {
        const r = await exportarClientes({ formato });
        mostrarToast(`Exportación lista (${r.registros} registros).`, "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
      btnExportar.textContent = "Exportar a Excel";
    };
  }

  const [snap, sucursalesSnap] = await Promise.all([
    getDocs(query(collection(db, "clientes"), orderBy("fechaRegistro", "desc"), limit(200))),
    getDocs(collection(db, "sucursales")),
  ]);
  const mapaSucursales = Object.fromEntries(sucursalesSnap.docs.map((d) => [d.data().sucursalId, d.data().nombre]));
  const cont = document.getElementById("lista-clientes");
  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">👥</div>Todavía no hay clientes registrados.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Sucursal</th><th>Registro</th></tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const c = d.data(); return `
          <tr>
            <td>${escapeHtml(c.nombre || "—")}</td>
            <td>${escapeHtml(c.telefono || "—")}</td>
            <td>${escapeHtml(c.email || "—")}</td>
            <td>${escapeHtml(mapaSucursales[c.sucursalPreferida] || "—")}</td>
            <td>${formatearFecha(c.fechaRegistro)}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>
    <p style="padding:0.75rem 1rem;color:var(--holaa-gris-texto);font-size:0.78rem;margin:0">Mostrando los 200 registros más recientes. Usa "Exportar a Excel" para el catálogo completo.</p>`;
}
