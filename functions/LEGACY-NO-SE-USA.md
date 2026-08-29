# Esta carpeta ya NO se usa

El proyecto pasó al camino "100% Spark" (ver README.md, sección
"Camino 100% Spark"): ya no hay Cloud Functions desplegadas. Toda esa
lógica ahora vive en `docs/shared/firestore-ops.js` y se hace cumplir
con `firestore.rules`.

Se conserva esta carpeta únicamente como referencia/historial, y por
si en el futuro decides pasar al plan Blaze y quieres recuperar esa
lógica en forma de Cloud Functions otra vez. `firebase.json` ya no la
referencia, así que no se despliega aunque exista aquí.
