// ===================================================================
// HOLAA Trendy — Portal Cliente
// Flujo (Sección 33): abre campaña -> bienvenida -> encuesta (incluye
// sucursal, Sección 19) -> datos -> privacidad -> consentimientos ->
// envía -> ve cupón con código de barras -> lo muestra en caja.
// ===================================================================

import { auth, db } from "/shared/firebase-config.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, limit, getDocs, orderBy, doc, getDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { enviarEncuesta as opEnviarEncuesta } from "/shared/firestore-ops.js";

let unsubscribeBeneficio = null;

function escucharBeneficio(beneficioAsignadoId) {
  if (unsubscribeBeneficio) { unsubscribeBeneficio(); unsubscribeBeneficio = null; }
  if (!beneficioAsignadoId) return;
  unsubscribeBeneficio = onSnapshot(doc(db, "beneficiosAsignados", beneficioAsignadoId), (snap) => {
    if (snap.exists() && snap.data().estadoUso === "usado") {
      marcarBeneficioUsadoEnPantalla();
    }
  });
}

function marcarBeneficioUsadoEnPantalla() {
  const cont = document.getElementById("estado-cupon");
  if (!cont) return;
  cont.innerHTML = `
    <div class="acento-superior"></div>
    <p class="subtexto" style="font-weight:600;text-align:center;margin-bottom:0">Este beneficio ya fue canjeado en sucursal.</p>`;
}

const app = document.getElementById("app");

const estado = {
  campana: null,
  preguntas: [],
  sucursales: [],
  pasoActual: 0, // índice dentro de preguntas (incluye la de sucursal)
  respuestas: {}, // { preguntaId: valor }
  datosCliente: { nombre: "", telefono: "", email: "", rangoEdad: "" },
  consentimientos: { aviso_privacidad: false, comunicaciones_comerciales: false, analitica: false },
  usuario: null,
  ultimoBeneficio: null,
};

// -------------------------------------------------------------------
// Arranque
// -------------------------------------------------------------------
init();

async function init() {
  onAuthStateChanged(auth, (u) => { estado.usuario = u; });

  const [campana, sucursales] = await Promise.all([
    cargarCampanaActiva(),
    cargarSucursalesActivas(),
  ]);

  estado.sucursales = sucursales;

  if (!campana) {
    renderSinCampana();
    return;
  }

  estado.campana = campana;
  aplicarTema(campana.tema);
  estado.preguntas = await cargarPreguntas(campana.campanaId);

  renderBienvenida();
}

// -------------------------------------------------------------------
// Identidad del cliente — sesión anónima (igual que Panel Caja). No
// se le pide correo ni cuenta de ningún tipo; el uid anónimo de
// Firebase Auth es lo único que usan firestore.rules para saber que
// "una respuesta le pertenece a quien la envió".
// -------------------------------------------------------------------
async function asegurarSesion() {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

async function cargarCampanaActiva() {
  const q = query(collection(db, "campanas"), where("estado", "==", "activa"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...d.data(), campanaId: d.id };
}

async function cargarSucursalesActivas() {
  const q = query(collection(db, "sucursales"), where("estado", "==", "activa"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...d.data(), sucursalId: d.id }));
}

async function cargarPreguntas(campanaId) {
  const q = query(collection(db, "campanas", campanaId, "preguntas"), orderBy("orden", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data()).filter((p) => p.activa !== false);
}

// -------------------------------------------------------------------
// Sección 9.2 — Tema dinámico por campaña, vía variables CSS
// -------------------------------------------------------------------
function aplicarTema(tema) {
  if (!tema) return;
  const r = document.documentElement.style;
  if (tema.colorPrimario) r.setProperty("--color-primario", tema.colorPrimario);
  if (tema.colorSecundario) r.setProperty("--color-secundario", tema.colorSecundario);
  if (tema.colorFondo) r.setProperty("--color-fondo", tema.colorFondo);
  if (tema.colorTexto) r.setProperty("--color-texto", tema.colorTexto);
  if (tema.tipografia) r.setProperty("--fuente-principal", `"${tema.tipografia}", sans-serif`);
  if (tema.estiloTarjeta) r.setProperty("--radio-tarjeta", tema.estiloTarjeta === "recto" ? "4px" : "16px");
}

// -------------------------------------------------------------------
// Renderizado — pantallas
// -------------------------------------------------------------------
function renderSinCampana() {
  app.innerHTML = `
    <div class="pantalla centro">
      <img src="/shared/logo_holaatrendy.png" alt="HOLAA Trendy" style="height:52px;margin:0 auto 1.5rem;display:block" />
      <h1 class="titulo-campana">Por ahora no hay una campaña activa</h1>
      <p class="subtexto">Vuelve pronto — siempre tenemos algo nuevo para ti.</p>
    </div>`;
}

function renderBienvenida() {
  const c = estado.campana;
  app.innerHTML = `
    <div class="encabezado">
      <img src="/shared/logo_holaatrendy.png" alt="HOLAA Trendy" class="logo-holaa" />
    </div>
    <div class="pantalla">
      ${c.imagen ? `<img class="hero-imagen" src="${c.imagen}" alt="" />` : `<div class="acento-superior"></div>`}
      <h1 class="titulo-campana">${escapeHtml(c.nombre)}</h1>
      <p class="subtexto">${escapeHtml(c.mensajeBienvenida || c.descripcion || "Queremos conocerte mejor. Responde nuestra encuesta y recibe un beneficio especial.")}</p>
      <button class="btn btn-primario" id="btn-empezar">Comenzar</button>
    </div>`;
  document.getElementById("btn-empezar").onclick = async () => {
    const boton = document.getElementById("btn-empezar");
    boton.disabled = true;
    boton.textContent = "Un momento…";
    try {
      await asegurarSesion();
      renderPaso();
    } catch (e) {
      boton.disabled = false;
      boton.textContent = "Comenzar";
      window.alert("No pudimos iniciar tu sesión. Intenta de nuevo.");
    }
  };
}

// -------------------------------------------------------------------
// Sección 7 — Constructor de encuestas: renderiza cada tipo de
// pregunta, una por pantalla (mínima fricción, Sección 31.1)
// -------------------------------------------------------------------
function renderPaso() {
  const total = estado.preguntas.length;
  const p = estado.preguntas[estado.pasoActual];

  if (!p) {
    renderDatosCliente();
    return;
  }

  const progresoPct = Math.round((estado.pasoActual / total) * 100);

  app.innerHTML = `
    <div class="progreso-wrap mt-1">
      <div class="progreso-track"><div class="progreso-fill" style="width:${progresoPct}%"></div></div>
      <div class="progreso-texto">Pregunta ${estado.pasoActual + 1} de ${total}</div>
    </div>
    <div class="pantalla">
      <div class="pregunta-texto">${escapeHtml(p.texto)}</div>
      <div id="campo-pregunta"></div>
      <div id="error-pregunta" class="error-texto" hidden></div>
    </div>
    <div class="nav-inferior">
      ${estado.pasoActual > 0 ? `<button class="btn btn-secundario" id="btn-atras">Atrás</button>` : ""}
      <button class="btn btn-primario" id="btn-siguiente">Continuar</button>
    </div>`;

  renderCampoPregunta(p);

  const btnAtras = document.getElementById("btn-atras");
  if (btnAtras) btnAtras.onclick = () => { estado.pasoActual--; renderPaso(); };

  document.getElementById("btn-siguiente").onclick = () => {
    const valor = leerValorPregunta(p);
    if (p.obligatoria && (valor === undefined || valor === "" || (Array.isArray(valor) && valor.length === 0))) {
      const err = document.getElementById("error-pregunta");
      err.textContent = "Esta pregunta es obligatoria.";
      err.hidden = false;
      return;
    }
    estado.respuestas[p.preguntaId] = valor;
    estado.pasoActual++;
    renderPaso();
  };
}

function renderCampoPregunta(p) {
  const cont = document.getElementById("campo-pregunta");
  const valorPrevio = estado.respuestas[p.preguntaId];

  switch (p.tipo) {
    case "sucursal_sistema": {
      cont.innerHTML = `<select id="campo-input">
        <option value="">Selecciona tu sucursal</option>
        ${estado.sucursales.map((s) => `<option value="${s.sucursalId}" ${valorPrevio === s.sucursalId ? "selected" : ""}>${escapeHtml(s.nombre)}</option>`).join("")}
      </select>`;
      break;
    }
    case "lista_desplegable": {
      cont.innerHTML = `<select id="campo-input">
        <option value="">Selecciona una opción</option>
        ${(p.opciones || []).map((o) => `<option value="${escapeHtml(o)}" ${valorPrevio === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
      </select>`;
      break;
    }
    case "seleccion_unica":
    case "rango_edad": {
      const opciones = p.tipo === "rango_edad" ? ["Menos de 18", "18–24", "25–34", "35–44", "45–54", "55 o más"] : (p.opciones || []);
      cont.innerHTML = `<div class="opciones-lista" id="campo-input" data-tipo="unica">
        ${opciones.map((o) => `<button type="button" class="opcion-btn ${valorPrevio === o ? "seleccionada" : ""}" data-valor="${escapeHtml(o)}"><span>${escapeHtml(o)}</span><span class="opcion-check"></span></button>`).join("")}
      </div>`;
      cont.querySelectorAll(".opcion-btn").forEach((btn) => {
        btn.onclick = () => {
          cont.querySelectorAll(".opcion-btn").forEach((b) => b.classList.remove("seleccionada"));
          btn.classList.add("seleccionada");
        };
      });
      break;
    }
    case "seleccion_multiple": {
      const seleccionadas = Array.isArray(valorPrevio) ? valorPrevio : [];
      cont.innerHTML = `<div class="opciones-lista" id="campo-input" data-tipo="multiple">
        ${(p.opciones || []).map((o) => `<button type="button" class="opcion-btn ${seleccionadas.includes(o) ? "seleccionada" : ""}" data-valor="${escapeHtml(o)}"><span>${escapeHtml(o)}</span><span class="opcion-check"></span></button>`).join("")}
      </div>`;
      cont.querySelectorAll(".opcion-btn").forEach((btn) => {
        btn.onclick = () => btn.classList.toggle("seleccionada");
      });
      break;
    }
    case "escala": {
      cont.innerHTML = `<div class="escala-fila" id="campo-input" data-tipo="escala">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="escala-btn ${String(valorPrevio) === String(n) ? "seleccionada" : ""}" data-valor="${n}">${n}</button>`).join("")}
      </div>`;
      cont.querySelectorAll(".escala-btn").forEach((btn) => {
        btn.onclick = () => {
          cont.querySelectorAll(".escala-btn").forEach((b) => b.classList.remove("seleccionada"));
          btn.classList.add("seleccionada");
        };
      });
      break;
    }
    case "si_no": {
      cont.innerHTML = `<div class="sino-fila" id="campo-input" data-tipo="sino">
        <button type="button" class="sino-btn ${valorPrevio === "Sí" ? "seleccionada" : ""}" data-valor="Sí">Sí</button>
        <button type="button" class="sino-btn ${valorPrevio === "No" ? "seleccionada" : ""}" data-valor="No">No</button>
      </div>`;
      cont.querySelectorAll(".sino-btn").forEach((btn) => {
        btn.onclick = () => {
          cont.querySelectorAll(".sino-btn").forEach((b) => b.classList.remove("seleccionada"));
          btn.classList.add("seleccionada");
        };
      });
      break;
    }
    case "fecha": {
      cont.innerHTML = `<input type="date" id="campo-input" value="${valorPrevio || ""}" />`;
      break;
    }
    case "numero": {
      cont.innerHTML = `<input type="number" id="campo-input" value="${valorPrevio || ""}" />`;
      break;
    }
    case "telefono": {
      cont.innerHTML = `<input type="tel" id="campo-input" maxlength="10" value="${valorPrevio || ""}" />`;
      break;
    }
    default: { // texto
      cont.innerHTML = `<input type="text" id="campo-input" value="${valorPrevio || ""}" />`;
    }
  }
}

function leerValorPregunta(p) {
  const cont = document.getElementById("campo-input");
  if (!cont) return undefined;
  const tipo = cont.dataset?.tipo;
  if (tipo === "unica" || tipo === "escala" || tipo === "sino") {
    const sel = cont.querySelector(".seleccionada, .opcion-btn.seleccionada");
    return sel ? sel.dataset.valor : "";
  }
  if (tipo === "multiple") {
    return Array.from(cont.querySelectorAll(".seleccionada")).map((b) => b.dataset.valor);
  }
  return cont.value;
}

// -------------------------------------------------------------------
// Datos del cliente (Sección 13) — se piden después de la encuesta
// -------------------------------------------------------------------
function renderDatosCliente() {
  app.innerHTML = `
    <div class="pantalla">
      <h1 class="pregunta-texto">Casi terminamos</h1>
      <p class="subtexto">Déjanos tu nombre y tu WhatsApp para avisarte de tus promociones.</p>
      <input type="text" id="input-nombre" placeholder="Nombre completo" value="${estado.datosCliente.nombre}" />
      <input type="tel" id="input-telefono" placeholder="WhatsApp (10 dígitos)" maxlength="10" inputmode="numeric" value="${estado.datosCliente.telefono}" />
      <div id="error-datos" class="error-texto" hidden></div>
    </div>
    <div class="nav-inferior">
      <button class="btn btn-secundario" id="btn-atras-datos">Atrás</button>
      <button class="btn btn-primario" id="btn-siguiente-datos">Continuar</button>
    </div>`;

  document.getElementById("btn-atras-datos").onclick = () => { estado.pasoActual = estado.preguntas.length - 1; renderPaso(); };
  document.getElementById("btn-siguiente-datos").onclick = () => {
    const nombre = document.getElementById("input-nombre").value.trim();
    const telefono = document.getElementById("input-telefono").value.trim();
    const err = document.getElementById("error-datos");
    if (!nombre) {
      err.textContent = "Cuéntanos tu nombre para continuar.";
      err.hidden = false;
      return;
    }
    if (!/^\d{10}$/.test(telefono)) {
      err.textContent = "Ingresa tu WhatsApp a 10 dígitos.";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    estado.datosCliente.nombre = nombre;
    estado.datosCliente.telefono = telefono;
    renderPrivacidad();
  };
}

// -------------------------------------------------------------------
// Sección 17 — Aviso de privacidad y consentimientos, separados
// -------------------------------------------------------------------
function renderPrivacidad() {
  app.innerHTML = `
    <div class="pantalla">
      <h1 class="pregunta-texto">Antes de enviar tus respuestas</h1>
      <div class="consentimiento-fila">
        <input type="checkbox" id="chk-privacidad" />
        <label class="consentimiento-texto" for="chk-privacidad">
          He leído y acepto el <a href="/cliente/aviso-privacidad.html" target="_blank" rel="noopener" id="link-aviso" style="color:var(--color-primario)">aviso de privacidad</a> de HOLAA Trendy. <span class="obligatorio">*Obligatorio</span>
        </label>
      </div>
      <div class="consentimiento-fila">
        <input type="checkbox" id="chk-comercial" />
        <label class="consentimiento-texto" for="chk-comercial">
          Acepto recibir promociones y comunicaciones comerciales.
        </label>
      </div>
      <div class="consentimiento-fila">
        <input type="checkbox" id="chk-analitica" />
        <label class="consentimiento-texto" for="chk-analitica">
          Acepto que mis respuestas se usen con fines analíticos y de mejora de servicio.
        </label>
      </div>
      <div id="error-consent" class="error-texto" hidden></div>
    </div>
    <div class="nav-inferior">
      <button class="btn btn-primario" id="btn-enviar" style="flex:1">Enviar y ver mi beneficio</button>
    </div>`;

  document.getElementById("btn-enviar").onclick = async () => {
    const privacidad = document.getElementById("chk-privacidad").checked;
    if (!privacidad) {
      const err = document.getElementById("error-consent");
      err.textContent = "Necesitamos que aceptes el aviso de privacidad para continuar.";
      err.hidden = false;
      return;
    }
    estado.consentimientos = {
      aviso_privacidad: true,
      comunicaciones_comerciales: document.getElementById("chk-comercial").checked,
      analitica: document.getElementById("chk-analitica").checked,
    };
    await enviarEncuestaAlServidor();
  };
}

// -------------------------------------------------------------------
// Envío — transacción de Firestore desde el navegador (Sección 33
// puntos 8–11), protegida por firestore.rules del lado de Google.
// -------------------------------------------------------------------
async function enviarEncuestaAlServidor() {
  app.innerHTML = `<div class="pantalla centro"><div class="spinner" style="margin:0 auto"></div><p class="subtexto mt-1">Enviando tus respuestas…</p></div>`;

  const sucursalId = estado.respuestas["sucursal_sistema"];
  const respuestasSinSucursal = { ...estado.respuestas };

  try {
    const resultado = await opEnviarEncuesta({
      campanaId: estado.campana.campanaId,
      respuestas: respuestasSinSucursal,
      datosCliente: estado.datosCliente,
      consentimientos: Object.entries(estado.consentimientos).map(([tipo, aceptado]) => ({ tipo, aceptado, version: 1 })),
      sucursalId,
    });
    estado.ultimoBeneficio = resultado.beneficio;
    renderCupon(resultado);
  } catch (e) {
    app.innerHTML = `
      <div class="pantalla centro">
        <h1 class="titulo-campana">No pudimos enviar tu respuesta</h1>
        <p class="subtexto">${escapeHtml(e.message || "Intenta de nuevo en unos momentos.")}</p>
        <button class="btn btn-primario" id="btn-reintentar">Reintentar</button>
      </div>`;
    document.getElementById("btn-reintentar").onclick = enviarEncuestaAlServidor;
  }
}

// -------------------------------------------------------------------
// Sección 20 — Cupón con código de barras de un solo uso
// -------------------------------------------------------------------
function renderCupon(resultado) {
  const beneficio = resultado.beneficio;
  app.innerHTML = `
    <div class="pantalla centro">
      <div class="acento-superior"></div>
      <h1 class="titulo-campana">${escapeHtml(resultado.mensajeFinal)}</h1>
      <div id="estado-cupon">
        ${beneficio ? `
          <div class="tarjeta-cupon mt-1">
            ${beneficio.nombre || beneficio.descripcion ? `<div class="beneficio-nombre-texto">${escapeHtml(beneficio.descripcion || beneficio.nombre)}</div>` : ""}
            <p class="subtexto" style="margin-bottom:0">Muestra este código en caja</p>
            <svg id="barcode"></svg>
            <div class="codigo-texto">${beneficio.codigoBarras}</div>
            <div class="vigencia-texto">Válido hasta: ${new Date(beneficio.fechaExpiracionCodigo).toLocaleString("es-MX")}</div>
          </div>
        ` : `<p class="subtexto">Gracias por participar.</p>`}
      </div>
    </div>`;

  if (beneficio && window.JsBarcode) {
    window.JsBarcode("#barcode", beneficio.codigoBarras, {
      format: "CODE128",
      lineColor: "#000000",
      width: 2,
      height: 70,
      displayValue: false,
      margin: 0,
    });
    escucharBeneficio(beneficio.beneficioAsignadoId);
  }
}

// -------------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
