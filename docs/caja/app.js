// ===================================================================
// HOLAA Trendy — Panel Caja (Sección 20)
// Flujo: escanear -> ver resultado -> siguiente cliente.
// Solo lector físico de código de barras (actúa como teclado + Enter).
// Sin acceso a clientes, campañas ni configuración más allá de la
// sucursal del propio dispositivo (Sección 20.4).
// ===================================================================

import { auth, db } from "/shared/firebase-config.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, orderBy, limit, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { configurarDispositivoCaja, validarBeneficio as opValidarBeneficio } from "/shared/firestore-ops.js";

const app = document.getElementById("app");
const LS_KEY = "holaa_caja_dispositivo_id";
const LS_SUCURSAL_NOMBRE = "holaa_caja_sucursal_nombre";
const LS_SUCURSAL_ID = "holaa_caja_sucursal_id";
const HISTORIAL_MAX = 50;
const REGISTROS_MAX = 40;

let bloqueadoEnvio = false;
let unsubscribeRegistros = null;

// -------------------------------------------------------------------
// Historial de escaneos (Sección 20) — queda guardado en este mismo
// dispositivo (localStorage), por si se recarga la página o se cierra
// el navegador. No requiere permisos nuevos en Firestore: es puramente
// una bitácora local de lo que esta caja ha escaneado.
// -------------------------------------------------------------------
function claveHistorial(dispositivoId) {
  return `holaa_caja_historial_${dispositivoId}`;
}

function obtenerHistorial(dispositivoId) {
  try {
    return JSON.parse(localStorage.getItem(claveHistorial(dispositivoId)) || "[]");
  } catch {
    return [];
  }
}

function agregarAlHistorial(dispositivoId, entrada) {
  const lista = obtenerHistorial(dispositivoId);
  lista.unshift({ ...entrada, hora: new Date().toISOString() });
  localStorage.setItem(claveHistorial(dispositivoId), JSON.stringify(lista.slice(0, HISTORIAL_MAX)));
}

function limpiarHistorial(dispositivoId) {
  localStorage.removeItem(claveHistorial(dispositivoId));
}

const ETIQUETA_RESULTADO = {
  verificado: { texto: "Verificado", icono: "✅", clase: "verde" },
  ya_aplicado: { texto: "Ya aplicado", icono: "❌", clase: "rojo" },
  sucursal_incorrecta: { texto: "Sucursal incorrecta", icono: "⚠️", clase: "amarillo" },
  no_valido: { texto: "No válido", icono: "❌", clase: "rojo" },
  dispositivo_no_autorizado: { texto: "Dispositivo no autorizado", icono: "🚫", clase: "rojo" },
  error: { texto: "Error de conexión", icono: "❌", clase: "rojo" },
};

function formatearHora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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
    renderPantallaEscaneo(dispositivoId, localStorage.getItem(LS_SUCURSAL_NOMBRE) || "", localStorage.getItem(LS_SUCURSAL_ID) || "");
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
      localStorage.setItem(LS_SUCURSAL_ID, sucursalId);
      renderPantallaEscaneo(resultado.dispositivoId, resultado.sucursalNombre, sucursalId);
    } catch (e) {
      errorEl.textContent = e.message || "No se pudo configurar el dispositivo.";
      errorEl.hidden = false;
    }
  };
}

// -------------------------------------------------------------------
// Sección 20.1/20.3 — Pantalla de escaneo y validación
// -------------------------------------------------------------------
function renderPantallaEscaneo(dispositivoId, sucursalNombre, sucursalId) {
  app.innerHTML = `
    <div class="caja-header">
      <span class="caja-sucursal">📍 ${escapeHtml(sucursalNombre)}</span>
      <button id="btn-reconfigurar" style="background:none;border:none;color:var(--holaa-gris-texto);font-size:0.8rem;text-decoration:underline">Cambiar sucursal</button>
    </div>
    <div class="caja-modo-tabs">
      <button class="caja-modo-btn activo" id="btn-modo-fisico" type="button">🔌 Lector físico</button>
      <button class="caja-modo-btn" id="btn-modo-camara" type="button">📷 Cámara</button>
    </div>
    <div class="caja-centro">
      <div id="vista-fisico">
        <div class="caja-icono-espera">🛒</div>
        <div class="caja-instruccion">Usa el escáner para leer el código del cupón del cliente</div>
      </div>
      <div id="lector-camara" style="display:none;width:100%;max-width:340px;border-radius:var(--radio-tarjeta);overflow:hidden"></div>
      <input type="text" id="input-scan" autofocus autocomplete="off" />
    </div>
    <div class="caja-historial" id="caja-registros"></div>
    <div class="caja-historial" id="caja-historial"></div>`;

  document.getElementById("btn-reconfigurar").onclick = () => {
    if (confirm("¿Cambiar la sucursal de esta terminal? Se pedirá volver a configurarla.")) {
      if (unsubscribeRegistros) { unsubscribeRegistros(); unsubscribeRegistros = null; }
      detenerEscaneoCamara();
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_SUCURSAL_NOMBRE);
      localStorage.removeItem(LS_SUCURSAL_ID);
      renderConfiguracion();
    }
  };

  const inputScan = document.getElementById("input-scan");
  const btnFisico = document.getElementById("btn-modo-fisico");
  const btnCamara = document.getElementById("btn-modo-camara");
  const vistaFisico = document.getElementById("vista-fisico");
  const vistaCamara = document.getElementById("lector-camara");

  btnFisico.onclick = () => {
    btnFisico.classList.add("activo");
    btnCamara.classList.remove("activo");
    vistaFisico.style.display = "block";
    vistaCamara.style.display = "none";
    detenerEscaneoCamara();
    mantenerFoco(inputScan);
  };
  btnCamara.onclick = () => {
    btnCamara.classList.add("activo");
    btnFisico.classList.remove("activo");
    vistaFisico.style.display = "none";
    vistaCamara.style.display = "block";
    iniciarEscaneoCamara(dispositivoId, sucursalNombre, sucursalId);
  };

  mantenerFoco(inputScan);

  let buffer = "";
  inputScan.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      if (buffer.trim()) validar(buffer.trim(), dispositivoId, sucursalNombre, sucursalId);
      buffer = "";
      inputScan.value = "";
    }
  });
  inputScan.addEventListener("input", () => { buffer = inputScan.value; });

  pintarHistorial(dispositivoId);
  escucharRegistros(sucursalId);
}

// -------------------------------------------------------------------
// Sección 20.2 (nuevo) — Escaneo con la cámara del celular, como
// alternativa al lector físico (que sigue siendo el modo por default,
// ya que #input-scan siempre está escuchando en segundo plano). La
// pestaña "Cámara" usa html5-qrcode para leer CODE128 (y QR) con la
// cámara trasera del dispositivo.
// -------------------------------------------------------------------
let scannerCamara = null;

function iniciarEscaneoCamara(dispositivoId, sucursalNombre, sucursalId) {
  if (!window.Html5Qrcode) {
    window.alert("No se pudo cargar el lector de cámara. Revisa tu conexión a internet e intenta de nuevo.");
    return;
  }
  scannerCamara = new Html5Qrcode("lector-camara");
  scannerCamara
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      (textoDecodificado) => {
        detenerEscaneoCamara();
        if (textoDecodificado.trim()) validar(textoDecodificado.trim(), dispositivoId, sucursalNombre, sucursalId);
      },
      () => {} // fallos de lectura cuadro-a-cuadro mientras busca el código; normal, se ignoran
    )
    .catch(() => {
      window.alert("No pudimos acceder a la cámara. Revisa que el navegador tenga permiso de cámara para este sitio.");
    });
}

function detenerEscaneoCamara() {
  if (!scannerCamara) return;
  const s = scannerCamara;
  scannerCamara = null;
  s.stop().then(() => s.clear()).catch(() => {});
}

// -------------------------------------------------------------------
// Sección 20 (nuevo) — Lista en vivo de registros de esta sucursal.
// A diferencia del "Historial de hoy" (que es local a esta caja y
// solo lo que ELLA escaneó), esto viene directo de Firestore vía
// onSnapshot: muestra a TODOS los clientes que se registraron en
// esta sucursal (de cualquier dispositivo/celular), en tiempo real,
// y cuando alguien escanea su cupón el mismo doc pasa a "usado" sin
// que la caja tenga que hacer nada extra — el listener ya está
// viendo ese documento.
// -------------------------------------------------------------------
function escucharRegistros(sucursalId) {
  if (unsubscribeRegistros) { unsubscribeRegistros(); unsubscribeRegistros = null; }
  const cont = document.getElementById("caja-registros");
  if (!cont || !sucursalId) return;

  const q = query(
    collection(db, "beneficiosAsignados"),
    where("sucursalId", "==", sucursalId),
    orderBy("fechaGeneracion", "desc"),
    limit(REGISTROS_MAX)
  );

  unsubscribeRegistros = onSnapshot(q, (snap) => {
    if (snap.empty) {
      cont.innerHTML = `
        <div class="caja-historial-encabezado"><h2>Registros de esta sucursal</h2></div>
        <div class="caja-historial-vacio">Aún no hay clientes registrados hoy.</div>`;
      return;
    }
    cont.innerHTML = `
      <div class="caja-historial-encabezado"><h2>Registros de esta sucursal (${snap.size})</h2></div>
      <div class="caja-historial-lista">
        ${snap.docs.map((d) => {
          const b = d.data();
          const usado = b.estadoUso === "usado";
          return `
            <div class="caja-historial-item ${usado ? "verde" : "amarillo"}">
              <span class="caja-historial-icono">${usado ? "✅" : "🕓"}</span>
              <div class="caja-historial-info">
                <div class="caja-historial-codigo">${escapeHtml(b.clienteNombre || "Cliente sin nombre")}</div>
                <div class="caja-historial-detalle">${escapeHtml(b.beneficioNombre || "Beneficio")} — ${usado ? "Ya usado" : "Pendiente de usar"}</div>
              </div>
              <div class="caja-historial-hora">${b.fechaGeneracion?.toDate ? formatearHora(b.fechaGeneracion.toDate().toISOString()) : ""}</div>
            </div>`;
        }).join("")}
      </div>`;
  }, () => {
    cont.innerHTML = `
      <div class="caja-historial-encabezado"><h2>Registros de esta sucursal</h2></div>
      <div class="caja-historial-vacio">No pudimos cargar los registros en vivo.</div>`;
  });
}

// -------------------------------------------------------------------
// Pinta la lista de escaneos recientes de esta caja, sin recargar
// toda la pantalla (para no perder el foco del lector físico).
// -------------------------------------------------------------------
function pintarHistorial(dispositivoId) {
  const cont = document.getElementById("caja-historial");
  if (!cont) return;
  const lista = obtenerHistorial(dispositivoId);

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="caja-historial-encabezado"><h2>Historial de hoy</h2></div>
      <div class="caja-historial-vacio">Aún no has escaneado ningún cupón.</div>`;
    return;
  }

  cont.innerHTML = `
    <div class="caja-historial-encabezado">
      <h2>Historial de hoy (${lista.length})</h2>
      <button id="btn-limpiar-historial">Limpiar</button>
    </div>
    <div class="caja-historial-lista">
      ${lista.map((item) => {
        const info = ETIQUETA_RESULTADO[item.resultado] || ETIQUETA_RESULTADO.error;
        return `
          <div class="caja-historial-item ${info.clase}">
            <span class="caja-historial-icono">${info.icono}</span>
            <div class="caja-historial-info">
              <div class="caja-historial-codigo">${escapeHtml(item.codigoBarras)}</div>
              <div class="caja-historial-detalle">${info.texto}</div>
            </div>
            <div class="caja-historial-hora">${formatearHora(item.hora)}</div>
          </div>`;
      }).join("")}
    </div>`;

  const btnLimpiar = document.getElementById("btn-limpiar-historial");
  if (btnLimpiar) {
    btnLimpiar.onclick = () => {
      if (!confirm("¿Borrar el historial de escaneos de esta caja?")) return;
      limpiarHistorial(dispositivoId);
      pintarHistorial(dispositivoId);
    };
  }
}

function mantenerFoco(el) {
  el.focus();
  document.addEventListener("click", () => el.focus());
  window.addEventListener("focus", () => el.focus());
}

// -------------------------------------------------------------------
// Sección 20.3 — Llamada a la Cloud Function de validación
// -------------------------------------------------------------------
async function validar(codigoBarras, dispositivoId, sucursalNombre, sucursalId) {
  if (bloqueadoEnvio) return;
  bloqueadoEnvio = true;
  if (scannerCamara) detenerEscaneoCamara();

  mostrarResultado("cargando", "Verificando…", "");

  try {
    const r = await opValidarBeneficio({ codigoBarras, dispositivoId });
    mostrarResultadoDesdeRespuesta(r);
    agregarAlHistorial(dispositivoId, { codigoBarras, resultado: r.resultado, mensaje: r.mensaje });
  } catch (e) {
    mostrarResultado("rojo", "❌", "ERROR DE CONEXIÓN", e.message || "Intenta de nuevo.");
    agregarAlHistorial(dispositivoId, { codigoBarras, resultado: "error", mensaje: e.message || "Error de conexión" });
  }

  setTimeout(() => {
    bloqueadoEnvio = false;
    renderPantallaEscaneo(dispositivoId, sucursalNombre, sucursalId);
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
  const detalle = data.resultado === "verificado" ? (data.beneficioDescripcion || data.beneficioNombre || "") : "";
  mostrarResultado(info.color, info.icono, data.mensaje, detalle);
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
