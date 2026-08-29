export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

export function formatearFecha(valor) {
  if (!valor) return "—";
  const d = valor?.toDate ? valor.toDate() : new Date(valor);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

export function formatearFechaHora(valor) {
  if (!valor) return "—";
  const d = valor?.toDate ? valor.toDate() : new Date(valor);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function mostrarToast(mensaje, tipo = "normal") {
  const el = document.createElement("div");
  el.className = `toast ${tipo === "error" ? "error" : tipo === "exito" ? "exito" : ""}`;
  el.textContent = mensaje;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function badgeEstadoCampana(estado) {
  return `<span class="badge badge-${estado}">${estado}</span>`;
}

export function badgeEstadoUso(estado) {
  return `<span class="badge badge-${estado}">${estado}</span>`;
}

/** Dispara la descarga de una URL firmada (exportaciones a Excel) */
export function descargarDesdeUrl(url, nombreSugerido) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreSugerido || "";
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
