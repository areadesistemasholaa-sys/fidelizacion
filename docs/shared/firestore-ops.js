// ===================================================================
// HOLAA Trendy — Operaciones de datos (camino "100% Spark")
// Reemplaza a las antiguas Cloud Functions (functions/lib/*.js) con
// operaciones directas del SDK de Firestore desde el navegador.
// La seguridad ya NO vive aquí ni en "ocultar botones": vive en
// firestore.rules, que Google evalúa en sus propios servidores antes
// de aceptar cualquier lectura/escritura. Este archivo solo organiza
// las llamadas y replica la lógica de negocio (Sección 6/36).
// ===================================================================

import { app, auth, db } from "/shared/firebase-config.js";
import { firebaseConfig } from "/shared/firebase-config.js";
import {
  initializeApp,
  deleteApp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as signOutSecundario,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================================================================
// ROLES (Sección 23) — YA NO son "custom claims" de Auth (eso requiere
// el Admin SDK = Cloud Functions = Blaze). Ahora el rol vive en el
// documento administradores/{uid} de Firestore, y firestore.rules lo
// consulta con get() en cada verificación de permiso.
// ===================================================================
export const ROLES = Object.freeze({
  SUPER_ADMIN: "superadmin",
  ADMIN: "admin",
  MARKETING: "marketing",
  ANALITICA: "analitica",
  CONSULTA: "consulta",
  CAJA: "caja",
});

export async function obtenerPerfilAdmin(uid) {
  const snap = await getDoc(doc(db, "administradores", uid));
  if (!snap.exists()) return null;
  return snap.data();
}

// ===================================================================
// AUDITORÍA (Sección 36)
// Nota honesta: como ya no hay Cloud Function que registre esto de
// forma forzosa, es el propio navegador del admin quien escribe el
// registro. firestore.rules exige que usuarioUid coincida con
// request.auth.uid, así que nadie puede falsificar auditoría a
// nombre de otra persona, pero un admin malicioso con permisos
// legítimos técnicamente podría omitir la llamada. Es una limitación
// aceptada de quitar el servidor, documentada aquí a propósito.
// ===================================================================
export async function registrarAuditoria({ accion, modulo, rol, detalle }) {
  const u = auth.currentUser;
  await addDoc(collection(db, "auditoria"), {
    accion,
    modulo,
    usuarioUid: u ? u.uid : null,
    usuarioEmail: u ? u.email : null,
    rol: rol || null,
    detalle: detalle || {},
    fechaHora: serverTimestamp(),
  });
}

// ===================================================================
// CAMPAÑAS (Sección 6/14/35) — CRUD normal, protegido por rol en
// firestore.rules. La máquina de estados (TRANSICIONES) se valida
// aquí para la UX; la única barrera de seguridad real es "¿tiene el
// rol correcto?", igual que antes vivía en requiereRol().
// ===================================================================
const TRANSICIONES = {
  borrador: ["programada", "activa", "archivada"],
  programada: ["activa", "pausada", "borrador", "archivada"],
  activa: ["pausada", "finalizada"],
  pausada: ["activa", "finalizada", "archivada"],
  finalizada: ["archivada"],
  archivada: [],
};

function temaConDefaults(tema) {
  const DEFAULT = {
    colorPrimario: "#C20152",
    colorSecundario: "#000000",
    colorFondo: "#FFFFFF",
    colorTexto: "#000000",
    tipografia: "Poppins",
    logo: "/shared/logo_holaatrendy.png",
    imagenFondo: null,
    icono: "🛍️",
    estiloTarjeta: "redondeado",
  };
  return { ...DEFAULT, ...(tema || {}) };
}

export async function crearCampana(datos) {
  if (!datos.nombre) throw new Error("La campaña necesita un nombre.");
  const campanaRef = doc(collection(db, "campanas"));
  const campana = {
    campanaId: campanaRef.id,
    nombre: datos.nombre,
    descripcion: datos.descripcion || "",
    // Sección 17 (sin Storage): la imagen es una RUTA/URL, no un archivo
    // subido — súbela a public/campanas/ del repo o usa una URL externa.
    imagen: datos.imagen || null,
    fechaInicio: datos.fechaInicio ? new Date(datos.fechaInicio) : null,
    fechaFin: datos.fechaFin ? new Date(datos.fechaFin) : null,
    estado: "borrador",
    beneficioId: datos.beneficioId || null,
    version: 1,
    fechaCreacion: serverTimestamp(),
    creadoPor: auth.currentUser.uid,
    tema: temaConDefaults(datos.tema),
    temaId: datos.temaId || null,
    mensajeBienvenida: datos.mensajeBienvenida || "",
    mensajeFinal: datos.mensajeFinal || "",
  };
  await setDoc(campanaRef, campana);

  await setDoc(doc(db, "campanas", campanaRef.id, "preguntas", "sucursal_sistema"), {
    preguntaId: "sucursal_sistema",
    texto: "¿En qué sucursal te encuentras?",
    tipo: "sucursal_sistema",
    opciones: [],
    obligatoria: true,
    orden: 0,
    activa: true,
    editable: false,
  });

  await registrarAuditoria({ accion: "crear_campana", modulo: "campanas", detalle: { campanaId: campanaRef.id, nombre: datos.nombre } });
  return { campanaId: campanaRef.id };
}

export async function actualizarCampana({ campanaId, cambios, incrementarVersion }) {
  if (!campanaId) throw new Error("Falta campanaId.");
  const ref = doc(db, "campanas", campanaId);
  const patch = { ...cambios };
  if (incrementarVersion) {
    const snap = await getDoc(ref);
    patch.version = (snap.data()?.version || 1) + 1;
  }
  if (patch.tema) patch.tema = temaConDefaults(patch.tema);
  await updateDoc(ref, patch);
  await registrarAuditoria({ accion: "actualizar_campana", modulo: "campanas", detalle: { campanaId, cambios: Object.keys(cambios || {}) } });
}

export async function cambiarEstadoCampana({ campanaId, nuevoEstado }) {
  const ref = doc(db, "campanas", campanaId);
  const snap = await getDoc(ref);
  const actual = snap.data()?.estado;
  if (!TRANSICIONES[actual]?.includes(nuevoEstado)) {
    throw new Error(`No se puede pasar de "${actual}" a "${nuevoEstado}".`);
  }
  await updateDoc(ref, { estado: nuevoEstado });
  await registrarAuditoria({ accion: "cambiar_estado_campana", modulo: "campanas", detalle: { campanaId, de: actual, a: nuevoEstado } });
}

export async function duplicarCampana({ campanaId }) {
  const snap = await getDoc(doc(db, "campanas", campanaId));
  if (!snap.exists()) throw new Error("Campaña no encontrada.");
  const original = snap.data();
  const nuevaRef = doc(collection(db, "campanas"));
  await setDoc(nuevaRef, {
    ...original,
    campanaId: nuevaRef.id,
    nombre: `${original.nombre} (copia)`,
    estado: "borrador",
    version: 1,
    fechaCreacion: serverTimestamp(),
    creadoPor: auth.currentUser.uid,
  });
  const preguntasSnap = await getDocs(collection(db, "campanas", campanaId, "preguntas"));
  await Promise.all(
    preguntasSnap.docs.map((p) => setDoc(doc(db, "campanas", nuevaRef.id, "preguntas", p.id), p.data()))
  );
  await registrarAuditoria({ accion: "duplicar_campana", modulo: "campanas", detalle: { origen: campanaId, nueva: nuevaRef.id } });
  return { campanaId: nuevaRef.id };
}

export async function eliminarCampana({ campanaId }) {
  await deleteDoc(doc(db, "campanas", campanaId));
  await registrarAuditoria({ accion: "eliminar_campana", modulo: "campanas", detalle: { campanaId } });
}

export async function guardarPregunta({ campanaId, pregunta }) {
  if (pregunta.preguntaId === "sucursal_sistema" && pregunta.eliminar) {
    throw new Error("La pregunta de sucursal es obligatoria y no puede eliminarse.");
  }
  const preguntaId = pregunta.preguntaId || doc(collection(db, "campanas", campanaId, "preguntas")).id;
  const ref = doc(db, "campanas", campanaId, "preguntas", preguntaId);

  if (pregunta.eliminar) {
    await deleteDoc(ref);
    await registrarAuditoria({ accion: "eliminar_pregunta", modulo: "campanas", detalle: { campanaId, preguntaId } });
    return { ok: true };
  }

  await setDoc(ref, { ...pregunta, preguntaId }, { merge: true });
  await registrarAuditoria({ accion: "guardar_pregunta", modulo: "campanas", detalle: { campanaId, preguntaId } });
  return { preguntaId };
}

// ===================================================================
// BENEFICIOS (catálogo) — Sección 6bis. Esto define QUÉ es cada
// beneficio (nombre, tipo de descuento, valor, texto para el
// cliente). Es distinto de "beneficiosAsignados", que son los
// códigos de un solo uso ya generados para un cliente concreto al
// responder una encuesta (ver enviarEncuesta más abajo).
// ===================================================================
export const TIPOS_BENEFICIO = Object.freeze({
  PORCENTAJE: "porcentaje",
  MONTO_FIJO: "monto_fijo",
  PRODUCTO_GRATIS: "producto_gratis",
  OTRO: "otro",
});

export async function crearBeneficio(datos) {
  if (!datos.nombre) throw new Error("El beneficio necesita un nombre.");
  const ref = doc(collection(db, "beneficios"));
  const beneficio = {
    beneficioId: ref.id,
    nombre: datos.nombre,
    tipo: datos.tipo || TIPOS_BENEFICIO.OTRO,
    valor: datos.valor !== undefined && datos.valor !== null && datos.valor !== "" ? Number(datos.valor) : null,
    descripcionCliente: datos.descripcionCliente || "",
    activo: datos.activo !== false,
    fechaCreacion: serverTimestamp(),
    creadoPor: auth.currentUser.uid,
  };
  await setDoc(ref, beneficio);
  await registrarAuditoria({ accion: "crear_beneficio", modulo: "beneficios", detalle: { beneficioId: ref.id, nombre: beneficio.nombre } });
  return { beneficioId: ref.id };
}

export async function actualizarBeneficio({ beneficioId, cambios }) {
  if (!beneficioId) throw new Error("Falta beneficioId.");
  const patch = { ...cambios };
  if (patch.valor !== undefined) {
    patch.valor = patch.valor !== null && patch.valor !== "" ? Number(patch.valor) : null;
  }
  await updateDoc(doc(db, "beneficios", beneficioId), patch);
  await registrarAuditoria({ accion: "actualizar_beneficio", modulo: "beneficios", detalle: { beneficioId, campos: Object.keys(cambios || {}) } });
}

// ===================================================================
// ENCUESTAS / ENVÍO DEL CLIENTE (Sección 33)
// Se ejecuta con la sesión (email-link) del propio cliente — nunca
// como admin — y una transacción de Firestore, igual que antes,
// solo que corriendo en el navegador en vez de en una Cloud Function.
// El código de barras se genera aquí; que sea "único" lo garantiza
// el id aleatorio de Firestore + timestamp, y firestore.rules impide
// que un cliente cree más de un beneficio por respuesta.
// ===================================================================
function generarCodigoBarras() {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(100 + Math.random() * 900);
  return `77${ts}${rand}`;
}

export async function enviarEncuesta({ campanaId, respuestas, datosCliente, consentimientos, sucursalId }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Debes iniciar sesión (enlace seguro) antes de responder la encuesta.");
  if (!campanaId || !respuestas || !sucursalId) throw new Error("Faltan datos requeridos (campaña, respuestas o sucursal).");

  const clienteId = u.uid;
  const campanaRef = doc(db, "campanas", campanaId);
  const sucursalRef = doc(db, "sucursales", sucursalId);
  const [campanaSnap, sucursalSnap] = await Promise.all([getDoc(campanaRef), getDoc(sucursalRef)]);

  if (!campanaSnap.exists() || campanaSnap.data().estado !== "activa") throw new Error("Esta campaña ya no está activa.");
  if (!sucursalSnap.exists() || sucursalSnap.data().estado !== "activa") throw new Error("Sucursal no válida.");

  const campana = campanaSnap.data();
  const clienteRef = doc(db, "clientes", clienteId);
  const respuestaRef = doc(collection(db, "respuestas"));
  const beneficioRef = campana.beneficioId ? doc(collection(db, "beneficiosAsignados")) : null;

  // Lectura del beneficio elegido por el administrador para esta
  // campaña (Sección 6bis). Se guarda una copia (nombre/descripción)
  // dentro del código generado para que quede fija en el tiempo,
  // aunque el catálogo cambie después.
  let beneficioDef = null;
  if (campana.beneficioId) {
    const beneficioDefSnap = await getDoc(doc(db, "beneficios", campana.beneficioId));
    beneficioDef = beneficioDefSnap.exists() ? beneficioDefSnap.data() : null;
  }

  let codigoBarras = null;
  let fechaExpiracionCodigo = null;

  await runTransaction(db, async (tx) => {
    const clienteSnap = await tx.get(clienteRef);
    const ahora = serverTimestamp();

    const datosClienteBase = {
      clienteId,
      nombre: datosCliente?.nombre || (clienteSnap.exists() ? clienteSnap.data().nombre : ""),
      telefono: datosCliente?.telefono || (clienteSnap.exists() ? clienteSnap.data().telefono : ""),
      email: datosCliente?.email || (clienteSnap.exists() ? clienteSnap.data().email : u.email || ""),
      rangoEdad: datosCliente?.rangoEdad || (clienteSnap.exists() ? clienteSnap.data().rangoEdad : ""),
      estado: "activo",
      sucursalPreferida: sucursalId,
      fechaActualizacion: ahora,
    };
    if (clienteSnap.exists()) tx.update(clienteRef, datosClienteBase);
    else tx.set(clienteRef, { ...datosClienteBase, fechaRegistro: ahora });

    tx.set(respuestaRef, {
      respuestaId: respuestaRef.id,
      clienteId,
      campanaId,
      fecha: ahora,
      respuestas,
      sucursalId,
      versionCampana: campana.version || 1,
    });

    (consentimientos || []).forEach((c) => {
      const ref = doc(collection(db, "consentimientos"));
      tx.set(ref, {
        clienteId,
        campanaId,
        tipo: c.tipo,
        aceptado: !!c.aceptado,
        version: c.version || 1,
        fechaHora: ahora,
      });
    });

    if (beneficioRef) {
      codigoBarras = generarCodigoBarras();
      const vigenciaHoras = campana.vigenciaCodigoHoras || 72;
      fechaExpiracionCodigo = new Date(Date.now() + vigenciaHoras * 3600 * 1000);
      tx.set(beneficioRef, {
        beneficioAsignadoId: beneficioRef.id,
        beneficioId: campana.beneficioId,
        beneficioNombre: beneficioDef?.nombre || null,
        beneficioDescripcion: beneficioDef?.descripcionCliente || null,
        clienteId,
        clienteNombre: datosClienteBase.nombre || null,
        campanaId,
        sucursalId,
        codigoBarras,
        fechaGeneracion: ahora,
        fechaExpiracionCodigo,
        estadoUso: "pendiente",
        dispositivoIdValidacion: null,
        validadoPor: null,
        fechaHoraValidacion: null,
      });
    }
  });

  return {
    ok: true,
    respuestaId: respuestaRef.id,
    beneficio: beneficioRef ? {
      beneficioAsignadoId: beneficioRef.id,
      codigoBarras,
      fechaExpiracionCodigo: fechaExpiracionCodigo.toISOString(),
      nombre: beneficioDef?.nombre || null,
      descripcion: beneficioDef?.descripcionCliente || null,
    } : null,
    mensajeFinal: campana.mensajeFinal || "¡Gracias por participar!",
  };
}

// ===================================================================
// PANEL CAJA (Sección 20) — el núcleo de seguridad "sin servidor".
// configurarDispositivoCaja y validarBeneficio se ejecutan como
// transacciones/escrituras del navegador, PERO la parte que de
// verdad importa (¿el PIN es correcto?, ¿el cupón sigue disponible?,
// ¿pertenece a esta sucursal?) la revisa firestore.rules del lado de
// Google, no este archivo. Este archivo solo arma la petición.
// ===================================================================
export async function configurarDispositivoCaja({ sucursalId, pinIntento, nombreDispositivo }) {
  const sucursalSnap = await getDoc(doc(db, "sucursales", sucursalId));
  if (!sucursalSnap.exists() || sucursalSnap.data().estado !== "activa") throw new Error("Sucursal no válida.");

  const dispositivoRef = doc(collection(db, "dispositivosCaja"));
  // pinIntento viaja dentro del propio documento nuevo: firestore.rules
  // lo compara, del lado de Google, contra sucursales/{id}/privado/config
  // (colección con lectura restringida a administradores) ANTES de
  // aceptar la escritura. No se expone el PIN real de la sucursal al
  // navegador en ningún momento — solo se guarda, dentro del registro
  // de esta caja, lo que la persona tecleó (que ya conocía).
  await setDoc(dispositivoRef, {
    dispositivoId: dispositivoRef.id,
    sucursalId,
    nombreDispositivo: nombreDispositivo || `Caja - ${sucursalSnap.data().nombre}`,
    fechaConfiguracion: serverTimestamp(),
    configuradoPor: auth.currentUser.uid,
    estado: "activo",
    pinIntento: pinIntento || "",
  });

  return { dispositivoId: dispositivoRef.id, sucursalNombre: sucursalSnap.data().nombre };
}

export async function validarBeneficio({ codigoBarras, dispositivoId }) {
  if (!codigoBarras || !dispositivoId) throw new Error("Falta código de barras o dispositivo.");

  const dispositivoSnap = await getDoc(doc(db, "dispositivosCaja", dispositivoId));
  if (!dispositivoSnap.exists() || dispositivoSnap.data().estado !== "activo") {
    return { resultado: "dispositivo_no_autorizado", mensaje: "Este dispositivo no está autorizado. Vuelve a configurarlo." };
  }
  const sucursalDispositivo = dispositivoSnap.data().sucursalId;

  const q = query(collection(db, "beneficiosAsignados"), where("codigoBarras", "==", codigoBarras), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return { resultado: "no_valido", mensaje: "CÓDIGO NO VÁLIDO O EXPIRADO" };

  const beneficioRef = snap.docs[0].ref;
  let resultado;
  try {
    resultado = await runTransaction(db, async (tx) => {
      const bSnap = await tx.get(beneficioRef);
      const b = bSnap.data();

      const expiracion = b.fechaExpiracionCodigo?.toDate ? b.fechaExpiracionCodigo.toDate() : new Date(b.fechaExpiracionCodigo);
      if (expiracion && expiracion.getTime() < Date.now()) return { resultado: "no_valido", mensaje: "CÓDIGO NO VÁLIDO O EXPIRADO" };
      if (b.estadoUso !== "pendiente") return { resultado: "ya_aplicado", mensaje: "CUPÓN YA APLICADO" };
      if (b.sucursalId !== sucursalDispositivo) return { resultado: "sucursal_incorrecta", mensaje: "NO PERTENECE A ESTA SUCURSAL" };

      // firestore.rules exige, además, que esta actualización solo
      // cambie estadoUso de "pendiente" a "usado" y nada más — ver rules.
      tx.update(beneficioRef, {
        estadoUso: "usado",
        dispositivoIdValidacion: dispositivoId,
        validadoPor: dispositivoSnap.data().nombreDispositivo,
        fechaHoraValidacion: serverTimestamp(),
      });
      return {
        resultado: "verificado",
        mensaje: "VERIFICADO",
        beneficioId: b.beneficioAsignadoId,
        beneficioNombre: b.beneficioNombre || null,
        beneficioDescripcion: b.beneficioDescripcion || null,
      };
    });
  } catch (e) {
    // Si firestore.rules rechaza la escritura (p.ej. carrera entre dos
    // cajas validando el mismo cupón al mismo tiempo), tratamos como
    // "ya aplicado" en vez de mostrar un error críptico.
    resultado = { resultado: "ya_aplicado", mensaje: "CUPÓN YA APLICADO" };
  }

  await registrarAuditoria({ accion: "validar_beneficio", modulo: "caja", detalle: { codigoBarras, dispositivoId, sucursalDispositivo, resultado: resultado.resultado } });
  return resultado;
}

export async function revocarDispositivoCaja({ dispositivoId }) {
  await updateDoc(doc(db, "dispositivosCaja", dispositivoId), { estado: "revocado" });
  await registrarAuditoria({ accion: "revocar_dispositivo_caja", modulo: "caja", detalle: { dispositivoId } });
}

// ===================================================================
// ADMINISTRADORES (Sección 23) — ya sin custom claims (eso requiere
// Admin SDK). El rol vive en el documento; la CUENTA de Firebase Auth
// se crea con una "app secundaria" para no cerrar la sesión del
// Super Admin que la está creando, y se le manda de una vez el correo
// de "definir tu contraseña" (igual que ya decía la propia interfaz).
// ===================================================================
export async function crearAdministrador({ email, nombre, rol }) {
  if (!Object.values(ROLES).includes(rol)) throw new Error("Rol no válido.");

  const nombreAppSecundaria = `secundaria-${Date.now()}`;
  const appSecundaria = initializeApp(firebaseConfig, nombreAppSecundaria);
  const authSecundaria = getAuth(appSecundaria);
  const passwordTemporal = crypto.randomUUID();
  let uid;
  try {
    const cred = await createUserWithEmailAndPassword(authSecundaria, email, passwordTemporal);
    uid = cred.user.uid;
    await signOutSecundario(authSecundaria);
  } finally {
    await deleteApp(appSecundaria);
  }

  await setDoc(doc(db, "administradores", uid), {
    uid,
    email,
    nombre: nombre || "",
    rol,
    estado: "activo",
    fechaCreacion: serverTimestamp(),
    creadoPor: auth.currentUser.uid,
  });

  await sendPasswordResetEmail(auth, email);

  await registrarAuditoria({ accion: "crear_administrador", modulo: "administradores", detalle: { nuevoUid: uid, email, rolAsignado: rol } });
  return { uid };
}

export async function cambiarRolAdministrador({ uid, nuevoRol }) {
  if (!Object.values(ROLES).includes(nuevoRol)) throw new Error("Rol no válido.");
  await updateDoc(doc(db, "administradores", uid), { rol: nuevoRol });
  await registrarAuditoria({ accion: "cambiar_rol_administrador", modulo: "administradores", detalle: { uid, nuevoRol } });
}

export async function desactivarAdministrador({ uid }) {
  // Nota honesta: no podemos deshabilitar la CUENTA de Firebase Auth
  // desde el navegador (eso también requiere Admin SDK). Lo que sí
  // logramos, y es lo que importa, es que firestore.rules niegue
  // absolutamente todo a alguien cuyo estado no sea "activo" — así
  // que aunque la cuenta pueda iniciar sesión, no puede leer ni
  // escribir nada del sistema.
  await updateDoc(doc(db, "administradores", uid), { estado: "inactivo" });
  await registrarAuditoria({ accion: "desactivar_administrador", modulo: "administradores", detalle: { uid } });
}

// ===================================================================
// SEMILLAS (Sección 19) — antes era una Cloud Function de un solo
// uso; ahora es simplemente un botón en el Panel Admin que hace un
// puñado de escrituras directas (solo Super Admin, según las reglas).
// ===================================================================
const SUCURSALES_SEMILLA = [
  "Juárez", "Mercado", "Nuevo León 1", "Nuevo León 2", "Nuevo León 3",
  "Tempoal 1", "Tempoal 2", "Tantoyuca Centro", "Tantoyuca Mercado", "Tamazunchale",
];

const PREGUNTAS_SEMILLA = [
  { texto: "¿Qué edad tienes?", tipo: "rango_edad", opciones: [] },
  { texto: "¿Qué prendas compras con mayor frecuencia?", tipo: "seleccion_multiple", opciones: ["Blusas", "Vestidos", "Jeans", "Pantalones", "Faldas", "Conjuntos", "Accesorios"] },
  { texto: "¿Cuál es tu estilo?", tipo: "seleccion_unica", opciones: ["Casual", "Formal", "Deportivo", "Trendy"] },
  { texto: "¿Qué talla utilizas?", tipo: "lista_desplegable", opciones: ["XS", "S", "M", "L", "XL", "XXL"] },
  { texto: "¿Con qué frecuencia compras ropa?", tipo: "seleccion_unica", opciones: ["Semanal", "Quincenal", "Mensual", "Cada temporada", "Rara vez"] },
];

export async function ejecutarSemillas() {
  await Promise.all(
    SUCURSALES_SEMILLA.map(async (nombre) => {
      const ref = doc(collection(db, "sucursales"));
      await setDoc(ref, { sucursalId: ref.id, nombre, estado: "activa", fechaCreacion: serverTimestamp() });
      // El PIN vive aparte, en una subcolección de lectura restringida
      // a administradores (nunca pública) — ver firestore.rules.
      await setDoc(doc(db, "sucursales", ref.id, "privado", "config"), { pinConfiguracion: null });
    })
  );
  await Promise.all(
    PREGUNTAS_SEMILLA.map((p) => addDoc(collection(db, "bibliotecaPreguntas"), { ...p, fechaCreacion: serverTimestamp() }))
  );
  await registrarAuditoria({ accion: "ejecutar_semillas", modulo: "sistema", detalle: {} });
  return { ok: true };
}
