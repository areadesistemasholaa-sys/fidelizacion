import { db } from "/shared/firebase-config.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { escapeHtml, formatearFechaHora, badgeEstadoUso, mostrarToast } from "./utils.js";
import { exportarBeneficios } from "/shared/exportaciones.js";
import { puedeExportar, puedeGestionarCampanas } from "./menu.js";
import { crearBeneficio as opCrearBeneficio, actualizarBeneficio as opActualizarBeneficio, TIPOS_BENEFICIO } from "/shared/firestore-ops.js";

const TIPOS = [
  { valor: TIPOS_BENEFICIO.PORCENTAJE, etiqueta: "Porcentaje de descuento", sufijo: "%" },
  { valor: TIPOS_BENEFICIO.MONTO_FIJO, etiqueta: "Monto fijo de descuento", sufijo: "$" },
  { valor: TIPOS_BENEFICIO.PRODUCTO_GRATIS, etiqueta: "Producto/artículo gratis", sufijo: "" },
  { valor: TIPOS_BENEFICIO.OTRO, etiqueta: "Otro / personalizado", sufijo: "" },
];

// Usadas también por campanas.js al armar el selector de beneficio
// dentro del modal de campaña.
export function etiquetaTipoBeneficio(tipo) {
  return TIPOS.find((t) => t.valor === tipo)?.etiqueta || tipo || "Otro";
}

export function resumenBeneficio(b) {
  if (!b) return "";
  if (b.tipo === TIPOS_BENEFICIO.PORCENTAJE && b.valor != null) return `${b.valor}% de descuento`;
  if (b.tipo === TIPOS_BENEFICIO.MONTO_FIJO && b.valor != null) return `$${b.valor} de descuento`;
  if (b.tipo === TIPOS_BENEFICIO.PRODUCTO_GRATIS) return "Producto gratis";
  return b.descripcionCliente || etiquetaTipoBeneficio(b.tipo);
}

function badgeActivo(activo) {
  return activo === false
    ? `<span class="badge badge-inactivo">inactivo</span>`
    : `<span class="badge badge-activo">activo</span>`;
}

export async function renderBeneficios(el, ctx) {
  const gestiona = puedeGestionarCampanas(ctx.rol);
  el.innerHTML = `
    <div class="modal-tabs">
      <button class="modal-tab activo" data-tab="catalogo">Catálogo de beneficios</button>
      <button class="modal-tab" data-tab="codigos">Códigos generados</button>
    </div>

    <div id="tab-catalogo">
      <div class="filtros-fila">
        ${gestiona ? `<button class="btn btn-primario" id="btn-nuevo-beneficio">+ Nuevo beneficio</button>` : ""}
      </div>
      <div class="tabla-wrap"><div id="lista-catalogo" class="mensaje-vacio">Cargando…</div></div>
    </div>

    <div id="tab-codigos" hidden>
      <div class="filtros-fila">
        <select id="sel-estado">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="usado">Usado</option>
          <option value="expirado">Expirado</option>
          <option value="cancelado">Cancelado</option>
        </select>
        ${puedeExportar(ctx.rol) ? `<button class="btn btn-primario" id="btn-exportar-beneficios">Exportar a Excel</button>` : ""}
      </div>
      <div class="tabla-wrap"><div id="lista-beneficios" class="mensaje-vacio">Cargando…</div></div>
    </div>`;

  el.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.onclick = () => {
      el.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("activo"));
      tab.classList.add("activo");
      ["catalogo", "codigos"].forEach((n) => { el.querySelector(`#tab-${n}`).hidden = n !== tab.dataset.tab; });
    };
  });

  await cargarCatalogo(ctx);
  if (gestiona) {
    document.getElementById("btn-nuevo-beneficio").onclick = () => abrirModalBeneficio(null, ctx);
  }

  await cargarListaCodigos();
  document.getElementById("sel-estado").onchange = cargarListaCodigos;

  const btnExportar = document.getElementById("btn-exportar-beneficios");
  if (btnExportar) {
    btnExportar.onclick = async () => {
      const estadoUso = document.getElementById("sel-estado").value;
      btnExportar.disabled = true;
      btnExportar.textContent = "Generando…";
      try {
        const r = await exportarBeneficios({ estadoUso: estadoUso || undefined });
        mostrarToast(`Exportación lista (${r.registros} registros).`, "exito");
      } catch (e) { mostrarToast(e.message, "error"); }
      btnExportar.disabled = false;
      btnExportar.textContent = "Exportar a Excel";
    };
  }
}

// -------------------------------------------------------------------
// Catálogo de beneficios (Sección 6bis): define QUÉ promoción o
// descuento puede asignarse a una campaña. Esto es lo que el
// administrador elige al crear/editar una campaña, y con eso se
// genera el código de barras que recibe el cliente.
// -------------------------------------------------------------------
async function cargarCatalogo(ctx) {
  const cont = document.getElementById("lista-catalogo");
  const gestiona = puedeGestionarCampanas(ctx.rol);
  const snap = await getDocs(query(collection(db, "beneficios"), orderBy("fechaCreacion", "desc")));

  if (snap.empty) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">🎁</div>Aún no hay beneficios. Crea el primero — por ejemplo, "10% de descuento".</div>`;
    return;
  }

  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Tipo</th><th>Detalle para el cliente</th><th>Estado</th>${gestiona ? "<th>Acciones</th>" : ""}</tr></thead>
      <tbody>
        ${snap.docs.map((d) => { const b = d.data(); return `
          <tr>
            <td><strong>${escapeHtml(b.nombre)}</strong></td>
            <td>${escapeHtml(etiquetaTipoBeneficio(b.tipo))}</td>
            <td>${escapeHtml(b.descripcionCliente || resumenBeneficio(b))}</td>
            <td>${badgeActivo(b.activo)}</td>
            ${gestiona ? `<td class="tabla-acciones">
              <button data-editar="${b.beneficioId}">Editar</button>
              <button data-alternar="${b.beneficioId}">${b.activo === false ? "Activar" : "Desactivar"}</button>
            </td>` : ""}
          </tr>`; }).join("")}
      </tbody>
    </table>`;

  if (!gestiona) return;
  const beneficiosPorId = Object.fromEntries(snap.docs.map((d) => [d.data().beneficioId, d.data()]));
  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.onclick = () => abrirModalBeneficio(beneficiosPorId[btn.dataset.editar], ctx);
  });
  cont.querySelectorAll("[data-alternar]").forEach((btn) => {
    btn.onclick = async () => {
      const b = beneficiosPorId[btn.dataset.alternar];
      try {
        await opActualizarBeneficio({ beneficioId: b.beneficioId, cambios: { activo: b.activo === false } });
        mostrarToast("Beneficio actualizado.", "exito");
        cargarCatalogo(ctx);
      } catch (e) { mostrarToast(e.message, "error"); }
    };
  });
}

function abrirModalBeneficio(beneficio, ctx) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <h2>${beneficio ? "Editar beneficio" : "Nuevo beneficio"}</h2>
      <div class="campo-grupo">
        <label>Nombre interno</label>
        <input id="b-nombre" value="${escapeHtml(beneficio?.nombre || "")}" placeholder="ej. 10% Regreso a Clases" />
      </div>
      <div class="campo-fila-2">
        <div class="campo-grupo">
          <label>Tipo</label>
          <select id="b-tipo">${TIPOS.map((t) => `<option value="${t.valor}" ${beneficio?.tipo === t.valor ? "selected" : ""}>${t.etiqueta}</option>`).join("")}</select>
        </div>
        <div class="campo-grupo">
          <label id="b-valor-label">Valor</label>
          <input type="number" id="b-valor" value="${beneficio?.valor ?? ""}" placeholder="ej. 10" />
        </div>
      </div>
      <div class="campo-grupo">
        <label>Texto que verá el cliente junto a su código</label>
        <textarea id="b-descripcion" rows="2" placeholder="ej. 10% de descuento en tu compra">${escapeHtml(beneficio?.descripcionCliente || "")}</textarea>
      </div>
      <div class="campo-grupo"><label><input type="checkbox" id="b-activo" ${beneficio?.activo === false ? "" : "checked"} style="width:auto;margin-right:0.4rem" />Activo (disponible para asignar a campañas)</label></div>
      <div class="modal-acciones">
        <button class="btn btn-secundario" id="btn-cerrar-beneficio">Cancelar</button>
        <button class="btn btn-primario" id="btn-guardar-beneficio">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function actualizarEtiquetaValor() {
    const tipo = overlay.querySelector("#b-tipo").value;
    const grupoValor = overlay.querySelector("#b-valor").closest(".campo-grupo");
    if (tipo === TIPOS_BENEFICIO.PRODUCTO_GRATIS) {
      grupoValor.style.display = "none";
    } else {
      grupoValor.style.display = "";
      overlay.querySelector("#b-valor-label").textContent = tipo === TIPOS_BENEFICIO.PORCENTAJE ? "Porcentaje (ej. 10)" : tipo === TIPOS_BENEFICIO.MONTO_FIJO ? "Monto en $ (ej. 50)" : "Valor (opcional)";
    }
  }
  overlay.querySelector("#b-tipo").onchange = actualizarEtiquetaValor;
  actualizarEtiquetaValor();

  overlay.querySelector("#btn-cerrar-beneficio").onclick = () => overlay.remove();
  overlay.querySelector("#btn-guardar-beneficio").onclick = async () => {
    const datos = {
      nombre: overlay.querySelector("#b-nombre").value.trim(),
      tipo: overlay.querySelector("#b-tipo").value,
      valor: overlay.querySelector("#b-valor").value,
      descripcionCliente: overlay.querySelector("#b-descripcion").value.trim(),
      activo: overlay.querySelector("#b-activo").checked,
    };
    if (!datos.nombre) { mostrarToast("El nombre es obligatorio.", "error"); return; }

    try {
      if (beneficio) {
        await opActualizarBeneficio({ beneficioId: beneficio.beneficioId, cambios: datos });
      } else {
        await opCrearBeneficio(datos);
      }
      mostrarToast("Beneficio guardado.", "exito");
      overlay.remove();
      cargarCatalogo(ctx);
    } catch (e) { mostrarToast(e.message, "error"); }
  };
}

// -------------------------------------------------------------------
// Códigos generados (antes "beneficiosAsignados"): historial de
// códigos de un solo uso ya entregados a clientes concretos.
// -------------------------------------------------------------------
async function cargarListaCodigos() {
  const cont = document.getElementById("lista-beneficios");
  const snap = await getDocs(query(collection(db, "beneficiosAsignados"), orderBy("fechaGeneracion", "desc"), limit(150)));
  const estadoFiltro = document.getElementById("sel-estado")?.value;
  const docs = estadoFiltro ? snap.docs.filter((d) => d.data().estadoUso === estadoFiltro) : snap.docs;

  if (docs.length === 0) {
    cont.innerHTML = `<div class="mensaje-vacio"><div class="icono">🎁</div>No hay códigos que coincidan.</div>`;
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Beneficio</th><th>Sucursal</th><th>Estado</th><th>Generado</th><th>Validado</th></tr></thead>
      <tbody>
        ${docs.map((d) => { const b = d.data(); return `
          <tr>
            <td style="font-family:monospace">${escapeHtml(b.codigoBarras)}</td>
            <td>${escapeHtml(b.beneficioNombre || "—")}</td>
            <td>${escapeHtml(b.sucursalId || "—")}</td>
            <td>${badgeEstadoUso(b.estadoUso)}</td>
            <td>${formatearFechaHora(b.fechaGeneracion)}</td>
            <td>${b.fechaHoraValidacion ? formatearFechaHora(b.fechaHoraValidacion) : "—"}</td>
          </tr>`; }).join("")}
      </tbody>
    </table>`;
}
