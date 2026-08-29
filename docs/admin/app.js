// ===================================================================
// HOLAA Trendy — Panel Administrativo
// Bootstrap: autenticación (email/password para administradores,
// Sección 11 es solo para el cliente), layout con sidebar según rol
// (Sección 22/23), y enrutamiento por hash entre módulos.
// ===================================================================

import { auth } from "/shared/firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { obtenerPerfilAdmin } from "/shared/firestore-ops.js";
import { itemsVisibles } from "./js/menu.js";
import { mostrarToast } from "./js/utils.js";

import { renderDashboard } from "./js/dashboard.js";
import { renderCampanas } from "./js/campanas.js";
import { renderClientes } from "./js/clientes.js";
import { renderRespuestas } from "./js/respuestas.js";
import { renderSegmentos } from "./js/segmentos.js";
import { renderBeneficios } from "./js/beneficios.js";
import { renderConsentimientos } from "./js/consentimientos.js";
import { renderSucursales } from "./js/sucursales.js";
import { renderAdministradores } from "./js/administradores.js";
import { renderAuditoria } from "./js/auditoria.js";

const app = document.getElementById("app");

const MODULOS = {
  dashboard: renderDashboard,
  campanas: renderCampanas,
  clientes: renderClientes,
  respuestas: renderRespuestas,
  segmentos: renderSegmentos,
  beneficios: renderBeneficios,
  consentimientos: renderConsentimientos,
  sucursales: renderSucursales,
  administradores: renderAdministradores,
  auditoria: renderAuditoria,
};

const ETIQUETAS = {
  dashboard: "Dashboard", campanas: "Campañas", clientes: "Clientes", respuestas: "Respuestas",
  segmentos: "Segmentos", beneficios: "Beneficios", consentimientos: "Consentimientos",
  sucursales: "Sucursales y Caja", administradores: "Administradores", auditoria: "Auditoría",
};

let usuarioActual = null;
let rolActual = null;

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    usuarioActual = null;
    rolActual = null;
    renderLogin();
    return;
  }
  // Antes el rol venía de un "custom claim" (necesita Admin SDK / Cloud
  // Functions). En el camino 100% Spark vive en el documento
  // administradores/{uid} de Firestore, y firestore.rules es quien de
  // verdad hace cumplir los permisos — esto solo decide qué mostrar.
  const perfil = await obtenerPerfilAdmin(u.uid);
  const rol = perfil?.rol;
  if (!rol || perfil.estado !== "activo") {
    mostrarToast("Tu cuenta no tiene un rol administrativo activo. Contacta a un Super Admin.", "error");
    await signOut(auth);
    return;
  }
  usuarioActual = u;
  rolActual = rol;
  renderLayout();
  window.addEventListener("hashchange", renderContenido);
  renderContenido();
});

// -------------------------------------------------------------------
// Login
// -------------------------------------------------------------------
function renderLogin() {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-tarjeta">
        <img src="/shared/logo_holaatrendy.png" alt="HOLAA Trendy" />
        <h1>Panel Administrativo</h1>
        <form id="form-login">
          <input type="email" id="input-email" placeholder="Correo electrónico" required />
          <input type="password" id="input-password" placeholder="Contraseña" required />
          <div id="login-error" class="login-error" hidden></div>
          <button type="submit" class="btn btn-primario" style="width:100%">Iniciar sesión</button>
        </form>
      </div>
    </div>`;

  document.getElementById("form-login").onsubmit = async (ev) => {
    ev.preventDefault();
    const email = document.getElementById("input-email").value.trim();
    const password = document.getElementById("input-password").value;
    const errorEl = document.getElementById("login-error");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      errorEl.textContent = "Correo o contraseña incorrectos.";
      errorEl.hidden = false;
    }
  };
}

// -------------------------------------------------------------------
// Layout (sidebar + contenedor de módulo)
// -------------------------------------------------------------------
function renderLayout() {
  const items = itemsVisibles(rolActual);
  app.innerHTML = `
    <div class="admin-shell">
      <aside class="sidebar" id="sidebar">
        <img src="/shared/logo_holaatrendy.png" alt="HOLAA Trendy" class="sidebar-logo" />
        <nav class="sidebar-nav" id="sidebar-nav">
          ${items.map((item) => `
            <button class="sidebar-link" data-ruta="${item.ruta}">
              <span>${item.icono}</span><span>${item.etiqueta}</span>
            </button>`).join("")}
        </nav>
        <div class="sidebar-pie">
          ${usuarioActual.email}<br />
          <span class="solo-lectura-tag" style="background:rgba(255,255,255,0.1);color:white">${rolActual}</span>
          <div style="margin-top:0.5rem"><button id="btn-salir">Cerrar sesión</button></div>
        </div>
      </aside>
      <main class="contenido" id="contenido"></main>
    </div>`;

  document.querySelectorAll(".sidebar-link").forEach((btn) => {
    btn.onclick = () => { location.hash = `#/${btn.dataset.ruta}`; };
  });
  document.getElementById("btn-salir").onclick = () => signOut(auth);

  if (!location.hash) location.hash = "#/dashboard";
}

function rutaActual() {
  return (location.hash.replace(/^#\//, "") || "dashboard").split("/")[0];
}

function renderContenido() {
  const ruta = rutaActual();
  const contenedor = document.getElementById("contenido");
  if (!contenedor) return;

  document.querySelectorAll(".sidebar-link").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.ruta === ruta);
  });

  const render = MODULOS[ruta];
  if (!render) {
    contenedor.innerHTML = `<div class="mensaje-vacio"><div class="icono">🔒</div>No tienes acceso a este módulo, o no existe.</div>`;
    return;
  }
  contenedor.innerHTML = `<div class="contenido-header"><div><h1>${ETIQUETAS[ruta]}</h1></div></div><div id="modulo-body"></div>`;
  render(document.getElementById("modulo-body"), { rol: rolActual, usuario: usuarioActual });
}
