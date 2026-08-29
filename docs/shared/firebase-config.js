// ===================================================================
// HOLAA Trendy — Configuración compartida de Firebase (cliente)
// Camino "100% Spark" (Sección 34): SIN Cloud Functions y SIN
// Firebase Storage — ambos requieren el plan Blaze. Solo se usan
// Firestore (base de datos) y Authentication, que son gratis en
// Spark, sin tarjeta, para siempre (dentro de las cuotas gratuitas).
//
// Usado por los tres paneles (cliente, admin, caja) vía:
//   import { app, auth, db, firebaseConfig } from "/shared/firebase-config.js";
//
// IMPORTANTE: reemplaza estos valores con los de tu proyecto de
// Firebase (Configuración del proyecto -> Tus apps -> SDK config).
// Estos valores son públicos por diseño (no son secretos); la
// seguridad real vive en las Firestore Security Rules.
// ===================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
 apiKey: "AIzaSyD_TU_API_KEY_REAL_AQUÍ", // Encuentra tu API Key en la configuración del proyecto en la consola
  authDomain: "fidelizacion-7ecb9.firebaseapp.com",
  projectId: "fidelizacion-7ecb9",
  storageBucket: "fidelizacion-7ecb9.firebasestorage.app",
  messagingSenderId: "595498829850",
  appId: "1:595498829850:web:fidelizacionweb12345"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Activa automáticamente los emuladores locales si la app corre en
// localhost, para poder desarrollar sin tocar datos reales.
const USANDO_EMULADORES = ["localhost", "127.0.0.1"].includes(location.hostname);
if (USANDO_EMULADORES) {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
}
