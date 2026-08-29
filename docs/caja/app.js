// ===================================================================
// HOLAA Trendy — Panel Caja (Sección 20)
// Flujo: escanear -> ver resultado -> siguiente cliente.
// Acepta lector físico de código de barras (actúa como teclado + Enter)
// o la cámara del dispositivo (BarcodeDetector nativo, si el navegador
// lo soporta). Sin acceso a clientes, campañas ni configuración más
// allá de la sucursal del propio dispositivo (Sección 20.4).
// ===================================================================

import { auth, db } from "/shared/firebase-config.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { configurarDispositivoCaja, validarBeneficio as opValidarBeneficio } from "/shared/firestore-ops.js";

const app = document.getElementById("app");
const LS_KEY = "holaa_caja_dispositivo_id";
const LS_SUCURSAL_NOMBRE = "holaa_caja_sucursal_nombre";

let bloqueadoEnvio = false;

init();

async function init() {
  await new Promise((resolve) => onAuthStateChanged(auth, async (u) => {
    if (!u) await signInAnonymously(auth);
    resolve();
  }));

  const dispositivoId = localStorage.getItem(LS_KEY);
  if (!dispositivoId) {
    renderConfiguracion();
  } else {
    renderPantallaEscaneo(dispositivoId, localStorage.getItem(LS_SUCURSAL_NOMBRE) || "");
  }
}

// -------------------------------------------------------------------
// Sección 20.2 — Configuración inicial del dispositivo (primer uso)
// -------------------------------------------------------------------
async function renderConfiguracion() {
  const q = query(collection(db, "sucursales"), where("estado", "==", "activa"));
  const snap = await getDocs(q);
  const sucursales = snap.docs.map((d) => ({ ...d.data(), sucursalId: d.id }));

  app.innerHTML = `
    <div class="caja-centro">
      <img src="/shared/logo_holaatrendy.png" alt="HOLAA Trendy" style="height:44px;margin-bottom:1.5rem" />
      <h1 class="caja-instruccion">Configura esta terminal</h1>
      <form class="caja-config-form" id="form-config">
        <label for="sel-sucursal">Sucursal</label>
        <select id="sel-sucursal" required>
          <option value="">Selecciona una sucursal</option>
          ${sucursales.map((s) => `<option value="${s.sucursalId}">${escapeHtml(s.nombre)}</option>`).join("")}
        </select>
        <label for="input-pin">PIN de sucursal (si aplica)</label>
        <input type="password" id="input-pin" inputmode="numeric" placeholder="Opcional" />
        <label for="input-nombre-disp">Nombre de esta caja</label>
        <input type="text" id="input-nombre-disp" placeholder="ej. Caja 1" />
        <div id="error-config" class="resultado-detalle" style="color:#C41E3A;opacity:1;margin-top:0.75rem" hidden></div>
        <button type="submit" class="btn btn-primario mt-1" style="width:100%;margin-top:1.25rem">Guardar y comenzar</button>
      </form>
    </div>`;

  document.getElementById("form-config").onsubmit = async (ev) => {
    ev.preventDefault();
    const sucursalId = document.getElementById("sel-sucursal").value;
    const pin = document.getElementById("input-pin").value;
    const nombreDispositivo = document.getElementById("input-nombre-disp").value || undefined;
    const errorEl = document.getElementById("error-config");

    if (!sucursalId) {
      errorEl.textContent = "Selecciona una sucursal.";
      errorEl.hidden = false;
      return;
    }

    try {
      const resultado = await configurarDispositivoCaja({ sucursalId, pinIntento: pin, nombreDispositivo });
      localStorage.setItem(LS_KEY, resultado.dispositivoId);
      localStorage.setItem(LS_SUCURSAL_NOMBRE, resultado.sucursalNombre);
      renderPantallaEscaneo(resultado.dispositivoId, resultado.sucursalNombre);
    } catch (e) {
      errorEl.textContent = e.message || "No se pudo configurar el dispositivo.";
      errorEl.hidden = false;
    }
  };
}

// -------------------------------------------------------------------
// Sección 20.1/20.3 — Pantalla de escaneo y validación
// -------------------------------------------------------------------
function renderPantallaEscaneo(dispositivoId, sucursalNombre) {
  app.innerHTML = `
    <div class="caja-header">
      <span class="caja-sucursal">📍 ${escapeHtml(sucursalNombre)}</span>
      <button id="btn-reconfigurar" style="background:none;border:none;color:var(--holaa-gris-texto);font-size:0.8rem;text-decoration:underline">Cambiar sucursal</button>
    </div>
    <div class="caja-centro">
      <div class="caja-icono-espera">🛒</div>
      <div class="caja-instruccion">Escanea el código del cupón del cliente</div>
      <input type="text" id="input-scan" autofocus autocomplete="off" />
      <button class="caja-boton-camara" id="btn-camara">📷 Usar la cámara</button>
      <div id="lector-camara" hidden></div>
    </div>`;

  document.getElementById("btn-reconfigurar").onclick = () => {
    if (confirm("¿Cambiar la sucursal de esta terminal? Se pedirá volver a configurarla.")) {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_SUCURSAL_NOMBRE);
      renderConfiguracion();
    }
  };

  const inputScan = document.getElementById("input-scan");
  mantenerFoco(inputScan);

  let buffer = "";
  inputScan.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      if (buffer.trim()) validar(buffer.trim(), dispositivoId, sucursalNombre);
      buffer = "";
      inputScan.value = "";
    }
  });
  inputScan.addEventListener("input", () => { buffer = inputScan.value; });

  document.getElementById("btn-camara").onclick = () => iniciarCamara(dispositivoId, sucursalNombre);
}

function mantenerFoco(el) {
  el.focus();
  document.addEventListener("click", () => el.focus());
  window.addEventListener("focus", () => el.focus());
}

async function iniciarCamara(dispositivoId, sucursalNombre) {
  const contCamara = document.getElementById("lector-camara");
  if (!("BarcodeDetector" in window)) {
    alert("Este navegador no soporta lectura de código de barras por cámara. Usa el lector físico o escríbelo manualmente.");
    return;
  }
  contCamara.hidden = false;
  contCamara.innerHTML = `<video id="video-camara" style="width:100%;border-radius:16px" playsinline></video>`;
  const video = document.getElementById("video-camara");

  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  video.srcObject = stream;
  await video.play();

  const detector = new window.BarcodeDetector({ formats: ["code_128", "ean_13", "ean_8", "upc_a"] });
  const intervalo = setInterval(async () => {
    try {
      const codigos = await detector.detect(video);
      if (codigos.length > 0) {
        clearInterval(intervalo);
        stream.getTracks().forEach((t) => t.stop());
        contCamara.hidden = true;
        validar(codigos[0].rawValue, dispositivoId, sucursalNombre);
      }
    } catch { /* seguir intentando */ }
  }, 400);
}

// -------------------------------------------------------------------
// Sección 20.3 — Llamada a la Cloud Function de validación
// -------------------------------------------------------------------
async function validar(codigoBarras, dispositivoId, sucursalNombre) {
  if (bloqueadoEnvio) return;
  bloqueadoEnvio = true;

  mostrarResultado("cargando", "Verificando…", "");

  try {
    const r = await opValidarBeneficio({ codigoBarras, dispositivoId });
    mostrarResultadoDesdeRespuesta(r);
  } catch (e) {
    mostrarResultado("rojo", "❌", "ERROR DE CONEXIÓN", e.message || "Intenta de nuevo.");
  }

  setTimeout(() => {
    bloqueadoEnvio = false;
    renderPantallaEscaneo(dispositivoId, sucursalNombre);
  }, 2600);
}

function mostrarResultadoDesdeRespuesta(data) {
  const mapa = {
    verificado: { color: "verde", icono: "✅" },
    ya_aplicado: { color: "rojo", icono: "❌" },
    sucursal_incorrecta: { color: "amarillo", icono: "⚠️" },
    no_valido: { color: "rojo", icono: "❌" },
    dispositivo_no_autorizado: { color: "rojo", icono: "🚫" },
  };
  const info = mapa[data.resultado] || { color: "rojo", icono: "❌" };
  mostrarResultado(info.color, info.icono, data.mensaje);
}

function mostrarResultado(color, icono, titulo, detalle) {
  const overlay = document.createElement("div");
  overlay.className = `resultado-pantalla ${color === "cargando" ? "" : color}`;
  if (color === "cargando") overlay.style.background = "#1a1a1a";
  overlay.innerHTML = `
    <div class="resultado-icono">${icono}</div>
    <div class="resultado-titulo">${escapeHtml(titulo)}</div>
    ${detalle ? `<div class="resultado-detalle">${escapeHtml(detalle)}</div>` : ""}`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2500);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
