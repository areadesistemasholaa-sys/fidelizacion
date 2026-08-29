import { db } from "/shared/firebase-config.js";
import { collection, getDocs, getDoc, doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFecha, mostrarToast } from "./utils.js";
import { revocarDispositivoCaja } from "/shared/firestore-ops.js";

export async function renderSucursales(el) {
  el.innerHTML = `
    <div class="contenido-header" style="margin-bottom:1rem">
      <p style="color:var(--holaa-gris-texto);font-size:0.88rem;margin:0">Catálogo de sucursales (Sección 19) y dispositivos de caja vinculados (Sección 20.2).</p>
      <button class="btn btn-primario" id="btn-nueva-sucursal">+ Nueva sucursal</button>
    </div>
    <div class="tabla-wrap" style="margin-bottom:1.5rem"><div id="lista-sucursales" class="mensaje-vacio">Cargando…</div></div>
    <h2 style="font-size:1.05rem;margin:0 0 0.75rem">Dispositivos de caja</h2>
    <div class="tabla-wrap"><div id="lista-dispositivos" class="mensaje-vacio">Cargando…</div></div>`;

  document.getElementById("btn-nueva-sucursal").onclick = async () => {
    const nombre = prompt("Nombre de la nueva sucursal:");
    if (!nombre) return;
    const ref = doc(collection(db, "sucursales"));
    await setDoc(ref, { sucursalId: ref.id, nombre, estado: "activa", fechaCreacion: new Date() });
    await setDoc(doc(db, "sucursales", ref.id, "privado", "config"), { pinConfiguracion: null });
    mostrarToast("Sucursal creada.", "exito");
    cargarSucursales();
  };

  await cargarSucursales();
  await cargarDispositivos();
}

async function cargarSucursales() {
  const cont = document.getElementById("lista-sucursales");
  const snap = await getDocs(collection(db, "sucursales"));
  const sucursales = await Promise.all(snap.docs.map(async (d) => {
    const privadoSnap = await getDoc(doc(db, "sucursales", d.id, "privado", "config"));
    return { ref: d.id, ...d.data(), pinConfiguracion: privadoSnap.exists() ? privadoSnap.data().pinConfiguracion : null };
  }));
  if (sucursales.length === 0) {
    cont.innerHTML = `<div class="mensaje-vacio">Sin sucursales. Ejecuta las semillas iniciales o agrega una manualmente.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Estado</th><th>PIN de configuración</th><th>Acciones</th></tr></thead>
      <tbody>
        ${sucursales.map((s) => `
          <tr>
            <td>${escapeHtml(s.nombre)}</td>
            <td><span class="badge ${s.estado === "activa" ? "badge-activa" : "badge-borrador"}">${s.estado}</span></td>
            <td>${s.pinConfiguracion ? "••••" : "Sin PIN"}</td>
            <td class="tabla-acciones">
              <button data-accion="toggle" data-id="${s.ref}" data-estado="${s.estado}">${s.estado === "activa" ? "Desactivar" : "Activar"}</button>
              <button data-accion="pin" data-id="${s.ref}">Definir PIN</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  cont.querySelectorAll("[data-accion='toggle']").forEach((btn) => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "sucursales", btn.dataset.id), { estado: btn.dataset.estado === "activa" ? "inactiva" : "activa" });
      cargarSucursales();
    };
  });
  cont.querySelectorAll("[data-accion='pin']").forEach((btn) => {
    btn.onclick = async () => {
      const pin = prompt("Nuevo PIN de configuración (4 dígitos), o vacío para quitarlo:");
      if (pin === null) return;
      await setDoc(doc(db, "sucursales", btn.dataset.id, "privado", "config"), { pinConfiguracion: pin || null });
      mostrarToast("PIN actualizado.", "exito");
      cargarSucursales();
    };
  });
}

async function cargarDispositivos() {
  const cont = document.getElementById("lista-dispositivos");
  const snap = await getDocs(collection(db, "dispositivosCaja"));
  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">🖥️</div>Ningún dispositivo se ha configurado todavía. Se registran automáticamente al abrir el Panel Caja por primera vez.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Dispositivo</th><th>Sucursal</th><th>Estado</th><th>Configurado</th><th>Acciones</th></tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const disp = d.data(); return `
          <tr>
            <td>${escapeHtml(disp.nombreDispositivo)}</td>
            <td>${escapeHtml(disp.sucursalId)}</td>
            <td><span class="badge ${disp.estado === "activo" ? "badge-activa" : "badge-expirado"}">${disp.estado}</span></td>
            <td>${formatearFecha(disp.fechaConfiguracion)}</td>
            <td class="tabla-acciones">${disp.estado === "activo" ? `<button data-revocar="${disp.dispositivoId}">Revocar</button>` : ""}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>`;

  cont.querySelectorAll("[data-revocar]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("¿Revocar este dispositivo? Deberá configurarse de nuevo en la sucursal.")) return;
      try {
        await revocarDispositivoCaja({ dispositivoId: btn.dataset.revocar });
        mostrarToast("Dispositivo revocado.", "exito");
        cargarDispositivos();
      } catch (e) { mostrarToast(e.message, "error"); }
    };
  });
}
