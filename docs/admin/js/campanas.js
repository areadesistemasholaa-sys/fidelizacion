import { db } from "/shared/firebase-config.js";
import { collection, getDocs, orderBy, query, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { duplicarCampana as opDuplicarCampana, cambiarEstadoCampana as opCambiarEstadoCampana, actualizarCampana as opActualizarCampana, crearCampana as opCrearCampana, guardarPregunta as opGuardarPregunta } from "/shared/firestore-ops.js";
import { escapeHtml, formatearFecha, badgeEstadoCampana, mostrarToast } from "./utils.js";
import { puedeGestionarCampanas } from "./menu.js";

const TIPOS_PREGUNTA = [
  { valor: "texto", etiqueta: "Texto" },
  { valor: "telefono", etiqueta: "Teléfono" },
  { valor: "numero", etiqueta: "Número" },
  { valor: "seleccion_unica", etiqueta: "Selección única" },
  { valor: "seleccion_multiple", etiqueta: "Selección múltiple" },
  { valor: "lista_desplegable", etiqueta: "Lista desplegable" },
  { valor: "escala", etiqueta: "Escala (1-5)" },
  { valor: "si_no", etiqueta: "Sí/No" },
  { valor: "fecha", etiqueta: "Fecha" },
  { valor: "rango_edad", etiqueta: "Rango de edad" },
];

const TIPOGRAFIAS = ["Poppins", "Inter", "Montserrat", "Playfair Display", "Nunito", "Quicksand"];

export async function renderCampanas(el, ctx) {
  const gestiona = puedeGestionarCampanas(ctx.rol);
  el.innerHTML = `
    <div class="contenido-header" style="margin-bottom:1rem">
      <p style="color:var(--holaa-gris-texto);font-size:0.88rem;margin:0">Crea, programa y administra campañas comerciales reutilizables.</p>
      ${gestiona ? `<button class="btn btn-primario" id="btn-nueva-campana">+ Nueva campaña</button>` : ""}
    </div>
    <div class="tabla-wrap"><div id="lista-campanas" class="mensaje-vacio">Cargando…</div></div>`;

  if (gestiona) {
    document.getElementById("btn-nueva-campana").onclick = () => abrirModalCampana(null, ctx);
  }
  await cargarLista(ctx);
}

async function cargarLista(ctx) {
  const cont = document.getElementById("lista-campanas");
  const snap = await getDocs(collection(db, "campanas"));
  const campanas = snap.docs.map((d) => d.data()).sort((a, b) => (b.fechaCreacion?.seconds || 0) - (a.fechaCreacion?.seconds || 0));

  if (campanas.length === 0) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">🎯</div>Aún no hay campañas. Crea la primera — por ejemplo, "Regreso a Clases".</div>`;
    return;
  }

  const gestiona = puedeGestionarCampanas(ctx.rol);
  cont.innerHTML = `
    <table>
      <thead><tr><th>Campaña</th><th>Estado</th><th>Vigencia</th><th>Versión</th>${gestiona ? "<th>Acciones</th>" : ""}</tr></thead>
      <tbody>
        ${campanas.map((c) => `
          <tr>
            <td><strong>${escapeHtml(c.nombre)}</strong></td>
            <td>${badgeEstadoCampana(c.estado)}</td>
            <td>${formatearFecha(c.fechaInicio)} — ${formatearFecha(c.fechaFin)}</td>
            <td>v${c.version || 1}</td>
            ${gestiona ? `<td class="tabla-acciones">
              <button data-accion="editar" data-id="${c.campanaId}">Editar</button>
              <button data-accion="preguntas" data-id="${c.campanaId}">Preguntas</button>
              <button data-accion="duplicar" data-id="${c.campanaId}">Duplicar</button>
              ${accionesEstado(c)}
            </td>` : ""}
          </tr>`).join("")}
      </tbody>
    </table>`;

  cont.querySelectorAll("button[data-accion]").forEach((btn) => {
    btn.onclick = () => manejarAccion(btn.dataset.accion, btn.dataset.id, ctx);
  });
}

function accionesEstado(c) {
  const acciones = {
    borrador: [["activar", "Activar"], ["programada_o_activa", "Programar"]],
    programada: [["activar", "Activar"], ["pausada", "Pausar"]],
    activa: [["pausada", "Pausar"], ["finalizada", "Finalizar"]],
    pausada: [["activa", "Reanudar"], ["finalizada", "Finalizar"]],
    finalizada: [["archivada", "Archivar"]],
    archivada: [],
  };
  return (acciones[c.estado] || [])
    .map(([estado, etiqueta]) => `<button data-accion="estado:${estado}" data-id="${c.campanaId}">${etiqueta}</button>`)
    .join("");
}

async function manejarAccion(accion, campanaId, ctx) {
  if (accion === "editar") return abrirModalCampana(campanaId, ctx);
  if (accion === "preguntas") return abrirModalPreguntas(campanaId, ctx);

  if (accion === "duplicar") {
    const nuevoNombre = prompt("Nombre de la nueva campaña (copia):");
    if (nuevoNombre === null) return;
    try {
      await opDuplicarCampana({ campanaId, nuevoNombre: nuevoNombre || undefined });
      mostrarToast("Campaña duplicada.", "exito");
      renderCampanas(document.getElementById("modulo-body"), ctx);
    } catch (e) { mostrarToast(e.message, "error"); }
    return;
  }

  if (accion.startsWith("estado:")) {
    const nuevoEstado = accion.split(":")[1];
    if (nuevoEstado === "activa" && !confirm("¿Activar esta campaña? Será visible para los clientes de inmediato.")) return;
    try {
      await opCambiarEstadoCampana({ campanaId, nuevoEstado });
      mostrarToast("Estado actualizado.", "exito");
      renderCampanas(document.getElementById("modulo-body"), ctx);
    } catch (e) { mostrarToast(e.message, "error"); }
  }
}

// -------------------------------------------------------------------
// Modal: crear/editar campaña (general, tema, beneficio)
// -------------------------------------------------------------------
async function abrirModalCampana(campanaId, ctx) {
  let campana = { nombre: "", descripcion: "", mensajeBienvenida: "", mensajeFinal: "", fechaInicio: "", fechaFin: "", tema: {} };
  if (campanaId) {
    const snap = await getDoc(doc(db, "campanas", campanaId));
    campana = snap.data();
  }
  const tema = { colorPrimario: "#C20152", colorSecundario: "#000000", colorFondo: "#FFFFFF", tipografia: "Poppins", icono: "🛍️", estiloTarjeta: "redondeado", ...(campana.tema || {}) };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h2>${campanaId ? "Editar campaña" : "Nueva campaña"}</h2>
      <div class="modal-tabs">
        <button class="modal-tab activo" data-tab="general">General</button>
        <button class="modal-tab" data-tab="tema">Apariencia</button>
        <button class="modal-tab" data-tab="mensajes">Mensajes</button>
      </div>
      <div id="tab-general">
        <div class="campo-grupo"><label>Nombre de la campaña</label><input id="c-nombre" value="${escapeHtml(campana.nombre || "")}" placeholder="ej. Regreso a Clases" /></div>
        <div class="campo-grupo"><label>Descripción</label><textarea id="c-descripcion" rows="2">${escapeHtml(campana.descripcion || "")}</textarea></div>
        <div class="campo-grupo"><label>Imagen (ruta en /public/campanas/… o URL)</label><input id="c-imagen" value="${escapeHtml(campana.imagen || "")}" placeholder="/campanas/regreso-clases.jpg" /></div>
        <div class="campo-fila-2">
          <div class="campo-grupo"><label>Fecha de inicio</label><input type="date" id="c-inicio" value="${valorFecha(campana.fechaInicio)}" /></div>
          <div class="campo-grupo"><label>Fecha de fin</label><input type="date" id="c-fin" value="${valorFecha(campana.fechaFin)}" /></div>
        </div>
      </div>
      <div id="tab-tema" hidden>
        <div class="campo-fila-2">
          <div class="campo-grupo"><label>Color primario</label><input type="color" class="color-swatch" id="t-primario" value="${tema.colorPrimario}" /></div>
          <div class="campo-grupo"><label>Color secundario</label><input type="color" class="color-swatch" id="t-secundario" value="${tema.colorSecundario}" /></div>
        </div>
        <div class="campo-fila-2">
          <div class="campo-grupo"><label>Color de fondo</label><input type="color" class="color-swatch" id="t-fondo" value="${tema.colorFondo}" /></div>
          <div class="campo-grupo"><label>Tipografía</label>
            <select id="t-tipografia">${TIPOGRAFIAS.map((f) => `<option ${tema.tipografia === f ? "selected" : ""}>${f}</option>`).join("")}</select>
          </div>
        </div>
        <div class="campo-fila-2">
          <div class="campo-grupo"><label>Ícono/emoji</label><input id="t-icono" value="${escapeHtml(tema.icono || "")}" maxlength="4" /></div>
          <div class="campo-grupo"><label>Estilo de tarjeta</label>
            <select id="t-estilo"><option value="redondeado" ${tema.estiloTarjeta === "redondeado" ? "selected" : ""}>Redondeado</option><option value="recto" ${tema.estiloTarjeta === "recto" ? "selected" : ""}>Recto</option></select>
          </div>
        </div>
        <p style="font-size:0.78rem;color:var(--holaa-gris-texto)">Si no personalizas un campo, se usa la identidad base de HOLAA Trendy (magenta #C20152 + negro).</p>
      </div>
      <div id="tab-mensajes" hidden>
        <div class="campo-grupo"><label>Mensaje de bienvenida</label><textarea id="c-bienvenida" rows="2">${escapeHtml(campana.mensajeBienvenida || "")}</textarea></div>
        <div class="campo-grupo"><label>Mensaje final</label><textarea id="c-final" rows="2">${escapeHtml(campana.mensajeFinal || "")}</textarea></div>
      </div>
      <div class="modal-acciones">
        <button class="btn btn-secundario" id="btn-cerrar-modal">Cancelar</button>
        <button class="btn btn-primario" id="btn-guardar-campana">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.onclick = () => {
      overlay.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("activo"));
      tab.classList.add("activo");
      ["general", "tema", "mensajes"].forEach((n) => { overlay.querySelector(`#tab-${n}`).hidden = n !== tab.dataset.tab; });
    };
  });

  overlay.querySelector("#btn-cerrar-modal").onclick = () => overlay.remove();
  overlay.querySelector("#btn-guardar-campana").onclick = async () => {
    const payload = {
      nombre: overlay.querySelector("#c-nombre").value.trim(),
      descripcion: overlay.querySelector("#c-descripcion").value.trim(),
      imagen: overlay.querySelector("#c-imagen").value.trim() || null,
      fechaInicio: overlay.querySelector("#c-inicio").value || null,
      fechaFin: overlay.querySelector("#c-fin").value || null,
      mensajeBienvenida: overlay.querySelector("#c-bienvenida").value.trim(),
      mensajeFinal: overlay.querySelector("#c-final").value.trim(),
      tema: {
        colorPrimario: overlay.querySelector("#t-primario").value,
        colorSecundario: overlay.querySelector("#t-secundario").value,
        colorFondo: overlay.querySelector("#t-fondo").value,
        tipografia: overlay.querySelector("#t-tipografia").value,
        icono: overlay.querySelector("#t-icono").value,
        estiloTarjeta: overlay.querySelector("#t-estilo").value,
      },
    };
    if (!payload.nombre) { mostrarToast("El nombre es obligatorio.", "error"); return; }

    try {
      if (campanaId) {
        await opActualizarCampana({ campanaId, cambios: payload });
      } else {
        await opCrearCampana(payload);
      }
      mostrarToast("Campaña guardada.", "exito");
      overlay.remove();
      renderCampanas(document.getElementById("modulo-body"), ctx);
    } catch (e) { mostrarToast(e.message, "error"); }
  };
}

function valorFecha(f) {
  if (!f) return "";
  const d = f?.toDate ? f.toDate() : new Date(f);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// -------------------------------------------------------------------
// Modal: constructor de encuestas (Sección 7 + 8)
// -------------------------------------------------------------------
async function abrirModalPreguntas(campanaId, ctx) {
  const snap = await getDocs(query(collection(db, "campanas", campanaId, "preguntas"), orderBy("orden", "asc")));
  const preguntas = snap.docs.map((d) => d.data());

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:720px">
      <h2>Preguntas de la encuesta</h2>
      <div id="lista-preguntas"></div>
      <button class="btn btn-secundario mt-1" id="btn-agregar-pregunta" style="margin-top:1rem">+ Agregar pregunta</button>
      <div class="modal-acciones"><button class="btn btn-primario" id="btn-cerrar-preguntas">Listo</button></div>
    </div>`;
  document.body.appendChild(overlay);

  function pintarLista() {
    const cont = overlay.querySelector("#lista-preguntas");
    cont.innerHTML = preguntas.map((p, i) => `
      <div class="pregunta-item">
        <span class="grip">⠿</span>
        <div class="info">
          <div class="texto">${escapeHtml(p.texto)} ${p.obligatoria ? "<span style=\"color:var(--holaa-magenta)\">*</span>" : ""}</div>
          <div class="meta">${etiquetaTipo(p.tipo)}${p.editable === false ? " · pregunta de sistema" : ""}</div>
        </div>
        <div class="tabla-acciones">
          ${p.editable !== false ? `<button data-editar="${i}">Editar</button><button data-eliminar="${i}">Eliminar</button>` : ""}
        </div>
      </div>`).join("");

    cont.querySelectorAll("[data-editar]").forEach((btn) => {
      btn.onclick = () => abrirEditorPregunta(preguntas[Number(btn.dataset.editar)]);
    });
    cont.querySelectorAll("[data-eliminar]").forEach((btn) => {
      btn.onclick = async () => {
        const p = preguntas[Number(btn.dataset.eliminar)];
        if (!confirm("¿Eliminar esta pregunta?")) return;
        await opGuardarPregunta({ campanaId, pregunta: { preguntaId: p.preguntaId, eliminar: true } });
        preguntas.splice(Number(btn.dataset.eliminar), 1);
        pintarLista();
      };
    });
  }

  function abrirEditorPregunta(preguntaExistente) {
    const editOverlay = document.createElement("div");
    editOverlay.className = "modal-overlay";
    const opcionesTexto = (preguntaExistente?.opciones || []).join("\n");
    editOverlay.innerHTML = `
      <div class="modal" style="max-width:460px">
        <h2>${preguntaExistente ? "Editar" : "Nueva"} pregunta</h2>
        <div class="campo-grupo"><label>Texto de la pregunta</label><input id="p-texto" value="${escapeHtml(preguntaExistente?.texto || "")}" /></div>
        <div class="campo-grupo"><label>Tipo</label>
          <select id="p-tipo">${TIPOS_PREGUNTA.map((t) => `<option value="${t.valor}" ${preguntaExistente?.tipo === t.valor ? "selected" : ""}>${t.etiqueta}</option>`).join("")}</select>
        </div>
        <div class="campo-grupo" id="grupo-opciones"><label>Opciones (una por línea)</label><textarea id="p-opciones" rows="4">${escapeHtml(opcionesTexto)}</textarea></div>
        <div class="campo-grupo"><label><input type="checkbox" id="p-obligatoria" ${preguntaExistente?.obligatoria ? "checked" : ""} style="width:auto;margin-right:0.4rem" />Obligatoria</label></div>
        <div class="modal-acciones">
          <button class="btn btn-secundario" id="cancelar-pregunta">Cancelar</button>
          <button class="btn btn-primario" id="guardar-pregunta">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(editOverlay);
    editOverlay.querySelector("#cancelar-pregunta").onclick = () => editOverlay.remove();
    editOverlay.querySelector("#guardar-pregunta").onclick = async () => {
      const texto = editOverlay.querySelector("#p-texto").value.trim();
      const tipo = editOverlay.querySelector("#p-tipo").value;
      const opciones = editOverlay.querySelector("#p-opciones").value.split("\n").map((o) => o.trim()).filter(Boolean);
      const obligatoria = editOverlay.querySelector("#p-obligatoria").checked;
      if (!texto) { mostrarToast("El texto de la pregunta es obligatorio.", "error"); return; }

      const r = await opGuardarPregunta({
        campanaId,
        pregunta: { preguntaId: preguntaExistente?.preguntaId, texto, tipo, opciones, obligatoria, orden: preguntas.length + 1, activa: true },
      });
      if (preguntaExistente) {
        Object.assign(preguntaExistente, { texto, tipo, opciones, obligatoria });
      } else {
        preguntas.push({ preguntaId: r.preguntaId, texto, tipo, opciones, obligatoria, activa: true, editable: true });
      }
      editOverlay.remove();
      pintarLista();
    };
  }

  overlay.querySelector("#btn-agregar-pregunta").onclick = () => abrirEditorPregunta(null);
  overlay.querySelector("#btn-cerrar-preguntas").onclick = () => overlay.remove();
  pintarLista();
}

function etiquetaTipo(tipo) {
  if (tipo === "sucursal_sistema") return "Sucursal (pregunta de sistema)";
  return TIPOS_PREGUNTA.find((t) => t.valor === tipo)?.etiqueta || tipo;
}
