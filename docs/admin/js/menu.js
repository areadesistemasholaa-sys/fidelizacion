// Menú del panel administrativo (Sección 22) y visibilidad por rol
// (Sección 23). superadmin/admin ven todo; los demás roles ven un
// subconjunto acorde a su función.

export const ITEMS_MENU = [
  { ruta: "dashboard", etiqueta: "Dashboard", icono: "📊", roles: ["superadmin", "admin", "marketing", "analitica", "consulta"] },
  { ruta: "clientes", etiqueta: "Clientes", icono: "👥", roles: ["superadmin", "admin", "marketing", "analitica", "consulta"] },
  { ruta: "campanas", etiqueta: "Campañas", icono: "🎯", roles: ["superadmin", "admin", "marketing", "consulta"] },
  { ruta: "respuestas", etiqueta: "Respuestas", icono: "📝", roles: ["superadmin", "admin", "marketing", "analitica", "consulta"] },
  { ruta: "segmentos", etiqueta: "Segmentos", icono: "🧩", roles: ["superadmin", "admin", "marketing", "analitica", "consulta"] },
  { ruta: "beneficios", etiqueta: "Beneficios", icono: "🎁", roles: ["superadmin", "admin", "marketing", "analitica", "consulta"] },
  { ruta: "consentimientos", etiqueta: "Consentimientos", icono: "✅", roles: ["superadmin", "admin", "consulta"] },
  { ruta: "sucursales", etiqueta: "Sucursales y Caja", icono: "🏬", roles: ["superadmin", "admin"] },
  { ruta: "administradores", etiqueta: "Administradores", icono: "🔑", roles: ["superadmin"] },
  { ruta: "auditoria", etiqueta: "Auditoría", icono: "🛡️", roles: ["superadmin", "admin"] },
];

export function itemsVisibles(rol) {
  return ITEMS_MENU.filter((item) => item.roles.includes(rol));
}

export function puedeExportar(rol) {
  return ["superadmin", "admin", "marketing", "analitica"].includes(rol);
}

export function puedeGestionarCampanas(rol) {
  return ["superadmin", "admin", "marketing"].includes(rol);
}
