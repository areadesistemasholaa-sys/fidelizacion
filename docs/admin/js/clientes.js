import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFecha, mostrarToast } from "./utils.js";
import { exportarClientes } from "/shared/exportaciones.js";
import { contarClientes, cambiarEstadoCliente, eliminarCliente } from "/shared/firestore-ops.js";
import { puedeExportar, puedeEliminarClientes } from "./menu.js";

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
    <div id="total-clientes" style="margin:0.5rem 0 0.75rem;color:var(--holaa-gris-texto);font-size:0.85rem"></div>
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

  await cargarListaClientes(ctx);
}

async function cargarListaClientes(ctx) {
  const contTotal = document.getElementById("total-clientes");
  const cont = document.getElementById("lista-clientes");
  cont.innerHTML = `<div class="mensaje-vacio">Cargando…</div>`;

  const [total, snap, sucursalesSnap] = await Promise.all([
    contarClientes(),
    getDocs(query(collection(db, "clientes"), orderBy("fechaRegistro", "desc"), limit(200))),
    getDocs(collection(db, "sucursales")),
  ]);
  const mapaSucursales = Object.fromEntries(sucursalesSnap.docs.map((d) => [d.data().sucursalId, d.data().nombre]));

  contTotal.textContent = `${total} clientes registrados en total`;

  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">👥</div>Todavía no hay clientes registrados.</div>`;
    return;
  }

  const puedeEliminar = puedeEliminarClientes(ctx.rol);

  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>Sucursal</th><th>Estado</th><th>Registro</th>${puedeEliminar ? "<th>Acciones</th>" : ""}</tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const c = d.data(); return `
          <tr data-cliente-id="${escapeHtml(c.clienteId)}">
            <td>${escapeHtml(c.nombre || "—")}</td>
            <td>${escapeHtml(c.telefono || "—")}</td>
            <td>${escapeHtml(c.email || "—")}</td>
            <td>${escapeHtml(mapaSucursales[c.sucursalPreferida] || "—")}</td>
            <td>${c.estado === "inactivo" ? "Inactivo" : "Activo"}</td>
            <td>${formatearFecha(c.fechaRegistro)}</td>
            ${puedeEliminar ? `
              <td style="white-space:nowrap">
                <button class="btn btn-secundario btn-toggle-estado" data-id="${escapeHtml(c.clienteId)}" data-estado-actual="${c.estado === "inactivo" ? "inactivo" : "activo"}" style="padding:0.3rem 0.6rem;font-size:0.75rem">${c.estado === "inactivo" ? "Reactivar" : "Marcar inactivo"}</button>
                <button class="btn btn-peligro btn-eliminar-cliente" data-id="${escapeHtml(c.clienteId)}" data-nombre="${escapeHtml(c.nombre || c.clienteId)}" style="padding:0.3rem 0.6rem;font-size:0.75rem">Eliminar</button>
              </td>` : ""}
          </tr>`; }).join("")}
      </tbody>
    </table>
    <p style="padding:0.75rem 1rem;color:var(--holaa-gris-texto);font-size:0.78rem;margin:0">Mostrando los 200 registros más recientes de ${total}. Usa "Exportar a Excel" para el catálogo completo.</p>`;

  if (puedeEliminar) {
    cont.querySelectorAll(".btn-toggle-estado").forEach((btn) => {
      btn.onclick = async () => {
        const nuevoEstado = btn.dataset.estadoActual === "inactivo" ? "activo" : "inactivo";
        if (nuevoEstado === "inactivo" && !confirm("¿Marcar este cliente como inactivo? Podrás reactivarlo cuando quieras; no se borra su historial.")) return;
        btn.disabled = true;
        try {
          await cambiarEstadoCliente({ clienteId: btn.dataset.id, nuevoEstado });
          mostrarToast(nuevoEstado === "inactivo" ? "Cliente marcado como inactivo." : "Cliente reactivado.", "exito");
          await cargarListaClientes(ctx);
        } catch (e) { mostrarToast(e.message, "error"); btn.disabled = false; }
      };
    });
    cont.querySelectorAll(".btn-eliminar-cliente").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm(`¿Eliminar PERMANENTEMENTE a "${btn.dataset.nombre}"? Esta acción no se puede deshacer. Sus respuestas y beneficios históricos quedarán registrados, pero ya no podrás ver ni exportar su ficha de cliente.`)) return;
        btn.disabled = true;
        try {
          await eliminarCliente({ clienteId: btn.dataset.id });
          mostrarToast("Cliente eliminado.", "exito");
          await cargarListaClientes(ctx);
        } catch (e) { mostrarToast(e.message, "error"); btn.disabled = false; }
      };
    });
  }
}
