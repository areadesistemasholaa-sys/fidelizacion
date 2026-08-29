import { db } from "/shared/firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { crearAdministrador as opCrearAdministrador, cambiarRolAdministrador as opCambiarRolAdministrador, desactivarAdministrador as opDesactivarAdministrador } from "/shared/firestore-ops.js";
import { escapeHtml, mostrarToast } from "./utils.js";

const ROLES = [
  ["superadmin", "Super Admin"], ["admin", "Admin"], ["marketing", "Marketing"],
  ["analitica", "Analítica"], ["consulta", "Consulta (solo lectura)"], ["caja", "Caja (solo Panel Caja)"],
];

export async function renderAdministradores(el) {
  el.innerHTML = `
    <div class="contenido-header" style="margin-bottom:1rem">
      <p style="color:var(--holaa-gris-texto);font-size:0.88rem;margin:0">Solo Super Admin puede crear cuentas y asignar roles (Sección 23).</p>
      <button class="btn btn-primario" id="btn-nuevo-admin">+ Nuevo administrador</button>
    </div>
    <div class="tabla-wrap"><div id="lista-admins" class="mensaje-vacio">Cargando…</div></div>`;

  document.getElementById("btn-nuevo-admin").onclick = abrirModalNuevoAdmin;
  await cargarLista();
}

async function cargarLista() {
  const cont = document.getElementById("lista-admins");
  const snap = await getDocs(collection(db, "administradores"));
  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio">Aún no hay administradores registrados en Firestore (revisa Firebase Auth directamente si acabas de desplegar).</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const a = d.data(); return `
          <tr>
            <td>${escapeHtml(a.nombre || "—")}</td>
            <td>${escapeHtml(a.email)}</td>
            <td>
              <select data-cambiar-rol="${a.uid}">
                ${ROLES.map(([v, l]) => `<option value="${v}" ${a.rol === v ? "selected" : ""}>${l}</option>`).join("")}
              </select>
            </td>
            <td><span class="badge ${a.estado === "activo" ? "badge-activa" : "badge-expirado"}">${a.estado}</span></td>
            <td class="tabla-acciones">${a.estado === "activo" ? `<button data-desactivar="${a.uid}">Desactivar</button>` : ""}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>`;

  cont.querySelectorAll("[data-cambiar-rol]").forEach((sel) => {
    sel.onchange = async () => {
      try {
        await opCambiarRolAdministrador({ uid: sel.dataset.cambiarRol, nuevoRol: sel.value });
        mostrarToast("Rol actualizado.", "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
    };
  });
  cont.querySelectorAll("[data-desactivar]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("¿Desactivar esta cuenta?")) return;
      try {
        await opDesactivarAdministrador({ uid: btn.dataset.desactivar });
        mostrarToast("Cuenta desactivada.", "exito");
        cargarLista();
      } catch (e) { mostrarToast(e.message, "error"); }
    };
  });
}

function abrirModalNuevoAdmin() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <h2>Nuevo administrador</h2>
      <div class="campo-grupo"><label>Nombre</label><input id="a-nombre" /></div>
      <div class="campo-grupo"><label>Correo electrónico</label><input id="a-email" type="email" /></div>
      <div class="campo-grupo"><label>Rol</label><select id="a-rol">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      <p style="font-size:0.78rem;color:var(--holaa-gris-texto)">Se crea la cuenta en Firebase Authentication; la persona deberá usar "¿Olvidaste tu contraseña?" en el login para definir su contraseña la primera vez.</p>
      <div class="modal-acciones">
        <button class="btn btn-secundario" id="cancelar-admin">Cancelar</button>
        <button class="btn btn-primario" id="guardar-admin">Crear</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#cancelar-admin").onclick = () => overlay.remove();
  overlay.querySelector("#guardar-admin").onclick = async () => {
    const nombre = overlay.querySelector("#a-nombre").value.trim();
    const email = overlay.querySelector("#a-email").value.trim();
    const rol = overlay.querySelector("#a-rol").value;
    if (!email) { mostrarToast("El correo es obligatorio.", "error"); return; }
    try {
      await opCrearAdministrador({ nombre, email, rol });
      mostrarToast("Administrador creado.", "exito");
      overlay.remove();
      cargarLista();
    } catch (e) { mostrarToast(e.message, "error"); }
  };
}
