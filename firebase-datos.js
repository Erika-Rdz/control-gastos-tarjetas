// Conexión con Firebase: inicio de sesión, carga y guardado de datos.
// Los gastos viven en UNA sola colección ("gastos") que comparten la administradora y los empleados:
// - La administradora ve y edita todos los gastos, y recibe en tiempo real lo que capturan los empleados.
// - Cada empleado solo ve y edita los gastos que tienen su correo (employeeEmail).
// La seguridad real la ponen las reglas de Firestore (archivo reglas-firestore.txt).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, onSnapshot, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const ADMIN_EMAIL = "accountspayable@peninsulasteel.com";
const firebaseConfig = {
  apiKey: "AIzaSyCVX-3idv52JFeama-J-xXgljXVkDiUn5U",
  authDomain: "control-gastos-tarjetas.firebaseapp.com",
  projectId: "control-gastos-tarjetas",
  storageBucket: "control-gastos-tarjetas.firebasestorage.app",
  messagingSenderId: "59175865970",
  appId: "1:59175865970:web:f06650346537b6a7413ceb"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
auth.languageCode = "es"; // correos de Firebase en español

// Campos que un empleado puede modificar en sus gastos (debe coincidir con las reglas de Firestore).
const CAMPOS_EMPLEADO = ["concept", "account", "center", "centerSplits", "status", "receipt", "receiptPath", "receiptName",
  "alcohol", "authStatus", "authRequestedAt", "authRequestedBy"];
// Campos que el jefe inmediato puede modificar al autorizar o rechazar.
const CAMPOS_JEFE = ["authStatus", "authBy", "authByName", "authAt", "authComment"];

let datosCargados = false;              // evita guardar encima de Firebase si la carga falló
let sincronizados = new Map();          // id del gasto -> última versión conocida en Firebase
let accesosSincronizados = new Map();   // correo -> acceso guardado en Firebase
let detenerEscucha = null;
let escuchasSesion = [];          // escuchas del empleado / jefe
let colaGuardado = Promise.resolve();
let renderPendiente = false;

// ---------- Utilidades ----------
const norm = v => String(v || "").trim().toLowerCase();
const esAdmin = email => norm(email) === norm(ADMIN_EMAIL);

function estable(v) {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(estable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + estable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
const iguales = (a, b) => estable(a) === estable(b);

// Quita campos temporales de pantalla (los que empiezan con "_") y valores que Firestore no acepta.
function limpio(x) {
  const o = {};
  Object.keys(x || {}).forEach(k => { if (!k.startsWith("_")) o[k] = x[k]; });
  return JSON.parse(JSON.stringify(o));
}

function nuevoId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2);
}

function ordenar() {
  s.expenses.sort((a, b) => (typeof a.orden === "number" ? a.orden : 1e15) - (typeof b.orden === "number" ? b.orden : 1e15));
}

function siguienteOrden() {
  return (s.expenses || []).reduce((m, x) => typeof x.orden === "number" && x.orden > m ? x.orden : m, -1) + 1;
}

// Correo de acceso del empleado (vacío si no tiene acceso o está desactivado).
function correoDeEmpleado(nombre) {
  const n = norm(nombre);
  const acceso = (s.userAccess || []).find(a => norm(a.employee) === n && norm(a.email));
  if (acceso) return acceso.enabled === false ? "" : norm(acceso.email);
  const emp = (s.employees || []).find(e => norm(e.name) === n && norm(e.email));
  return emp ? norm(emp.email) : "";
}

// Jefe inmediato del empleado (nombre y correo), según Configuración → Jefes inmediatos.
function jefeDeEmpleado(nombre) {
  const emp = (s.employees || []).find(e => norm(e.name) === norm(nombre));
  if (!emp || !emp.boss) return { name: "", email: "" };
  const jefe = (s.bosses || []).find(b => norm(b.name) === norm(emp.boss));
  if (!jefe || jefe.enabled === false || !norm(jefe.email)) return { name: emp.boss, email: "" };
  return { name: jefe.name, email: norm(jefe.email) };
}

function accesosDeseados() {
  const m = new Map();
  (s.employees || []).forEach(e => {
    const email = correoDeEmpleado(e.name);
    if (email && !m.has(email)) m.set(email, { email, employee: e.name, role: "Empleado", isBoss: false, bossName: "", enabled: true });
  });
  (s.bosses || []).forEach(b => {
    const email = norm(b.email);
    if (!email || b.enabled === false) return;
    if (m.has(email)) Object.assign(m.get(email), { isBoss: true, bossName: b.name });
    else m.set(email, { email, employee: "", role: "Jefe", isBoss: true, bossName: b.name, enabled: true });
  });
  return m;
}

// Asegura que el gasto tenga id, orden y correo del empleado; devuelve la versión a guardar.
function prepararGasto(x) {
  if (!x.id) x.id = x.importId || nuevoId();
  x.id = String(x.id).replace(/\//g, "_");
  if (typeof x.orden !== "number") x.orden = siguienteOrden();
  x.employeeEmail = correoDeEmpleado(x.employee);
  const jefe = jefeDeEmpleado(x.employee);
  x.bossEmail = jefe.email;
  x.bossName = jefe.name;
  return limpio(x);
}

function datosSinGastos() {
  const copia = { ...s };
  delete copia.expenses;
  return limpio(copia);
}

async function ejecutarEnLotes(operaciones) {
  for (let i = 0; i < operaciones.length; i += 400) {
    const lote = writeBatch(db);
    operaciones.slice(i, i + 400).forEach(op => op(lote));
    await lote.commit();
  }
}

function enEdicion() {
  const a = document.activeElement;
  return !!(a && a.closest && a.closest("main") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
}

// Redibuja sin interrumpir si la usuaria está escribiendo en un campo.
function renderSeguro() {
  if (enEdicion()) { renderPendiente = true; return; }
  window.render();
}
document.addEventListener("focusout", () => setTimeout(() => {
  if (renderPendiente && !enEdicion()) { renderPendiente = false; window.render(); }
}, 80));

// ---------- Sesión ----------
window.firebaseAuth = auth;
window.esAdministrador = esAdmin;
window.firebaseLogin = async (email, password) => {
  // La sesión termina al cerrar el navegador (más seguro en computadoras compartidas).
  await setPersistence(auth, browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
};
window.firebaseLogout = () => signOut(auth);
window.detenerSincronizacion = () => { if (detenerEscucha) { detenerEscucha(); detenerEscucha = null; } escuchasSesion.forEach(f => f()); escuchasSesion = []; datosCargados = false; };

// ---------- Contraseñas ----------
// Recuperar: envía un correo con un enlace para crear una contraseña nueva.
window.olvideContrasena = async function () {
  const campo = document.getElementById("loginUser");
  let email = norm(campo && campo.value);
  if (!email) email = norm(prompt("Escribe tu correo para enviarte el enlace de recuperación:") || "");
  if (!email) return;
  try {
    await sendPasswordResetEmail(auth, email);
    alert("Si el correo " + email + " está registrado, en unos minutos recibirás un mensaje para crear una contraseña nueva.\n\nRevisa también la carpeta de correo no deseado (spam).");
  } catch (e) {
    console.error(e);
    const msg = e.code === "auth/invalid-email" ? "El correo no tiene un formato válido."
      : e.code === "auth/too-many-requests" ? "Se hicieron demasiados intentos. Espera unos minutos e inténtalo de nuevo."
      : "No se pudo enviar el correo. " + (e.code || e.message);
    alert(msg);
  }
};

// Cambiar: ventana para escribir la contraseña actual y la nueva.
window.abrirCambioContrasena = function () {
  let dlg = document.getElementById("dlgContrasena");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "dlgContrasena";
    dlg.style.cssText = "border:0;border-radius:14px;padding:26px;width:min(380px,92vw);box-shadow:0 20px 55px rgba(0,0,0,.25)";
    dlg.innerHTML = '<h3 style="margin-top:0">Cambiar contraseña</h3>'
      + '<label>Contraseña actual</label><input id="pwActual" type="password" autocomplete="current-password">'
      + '<label>Contraseña nueva (mínimo 8 caracteres)</label><input id="pwNueva" type="password" autocomplete="new-password">'
      + '<label>Repite la contraseña nueva</label><input id="pwNueva2" type="password" autocomplete="new-password">'
      + '<div id="pwError" class="login-error"></div>'
      + '<div style="display:flex;gap:10px;margin-top:16px"><button type="button" class="primary" id="pwGuardar" style="text-align:center">Guardar</button>'
      + '<button type="button" id="pwCancelar" style="text-align:center;border:1px solid #cbd5e1">Cancelar</button></div>';
    document.body.appendChild(dlg);
    dlg.querySelector("#pwCancelar").onclick = () => dlg.close();
    dlg.querySelector("#pwGuardar").onclick = guardarNuevaContrasena;
  }
  ["pwActual", "pwNueva", "pwNueva2"].forEach(id => { dlg.querySelector("#" + id).value = ""; });
  dlg.querySelector("#pwError").style.display = "none";
  dlg.showModal();
};

async function guardarNuevaContrasena() {
  const dlg = document.getElementById("dlgContrasena");
  const err = dlg.querySelector("#pwError");
  const boton = dlg.querySelector("#pwGuardar");
  const actual = dlg.querySelector("#pwActual").value;
  const nueva = dlg.querySelector("#pwNueva").value;
  const nueva2 = dlg.querySelector("#pwNueva2").value;
  const mostrar = m => { err.textContent = m; err.style.display = "block"; };
  if (!actual || !nueva) return mostrar("Llena todos los campos.");
  if (nueva.length < 8) return mostrar("La contraseña nueva debe tener al menos 8 caracteres.");
  if (nueva !== nueva2) return mostrar("Las contraseñas nuevas no coinciden.");
  if (nueva === actual) return mostrar("La contraseña nueva debe ser diferente a la actual.");
  const u = auth.currentUser;
  if (!u) return mostrar("Tu sesión no está activa. Vuelve a iniciar sesión.");
  boton.disabled = true;
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, actual));
    await updatePassword(u, nueva);
    dlg.close();
    alert("Tu contraseña se cambió correctamente.");
  } catch (e) {
    console.error(e);
    mostrar(e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "La contraseña actual no es correcta."
      : e.code === "auth/weak-password" ? "La contraseña nueva es muy débil."
      : e.code === "auth/too-many-requests" ? "Demasiados intentos. Espera unos minutos."
      : "No se pudo cambiar la contraseña. " + (e.code || e.message));
  } finally {
    boton.disabled = false;
  }
}

// ---------- Administradora ----------
window.cargarDatosAdmin = async function () {
  const u = auth.currentUser;
  if (!u || !esAdmin(u.email)) throw new Error("La sesión de administradora no es válida.");
  datosCargados = false;

  const ref = doc(db, "usuarios", u.uid);
  const snap = await getDoc(ref);
  const datos = snap.exists() ? (snap.data().datos || {}) : null;
  if (datos) Object.keys(datos).forEach(k => { if (k !== "expenses") s[k] = datos[k]; });

  // Migración única: pasa los gastos del documento de la administradora a la colección "gastos".
  if (datos && Array.isArray(datos.expenses) && datos.expenses.length && !datos.gastosMigrados) {
    try {
      await setDoc(doc(db, "respaldos", "antes-de-migrar-" + Date.now()), { fecha: new Date().toISOString(), datos });
    } catch (e) {
      console.warn("No se pudo guardar el respaldo en Firebase; se descargará en tu computadora.", e);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" }));
      a.download = "respaldo-control-gastos-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
    }
    s.expenses = datos.expenses.map((x, i) => ({ ...x, orden: typeof x.orden === "number" ? x.orden : i }));
    // Si un empleado ya había capturado datos en la colección "gastos", se conservan.
    const existentes = new Map((await getDocs(collection(db, "gastos"))).docs.map(d => [d.id, d.data()]));
    const tieneValor = v => !(v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length));
    const ops = s.expenses.map(x => {
      prepararGasto(x);
      const ex = existentes.get(x.id);
      if (ex) CAMPOS_EMPLEADO.forEach(k => { if (tieneValor(ex[k])) x[k] = ex[k]; });
      const d = limpio(x);
      return lote => lote.set(doc(db, "gastos", d.id), d);
    });
    await ejecutarEnLotes(ops);
    s.gastosMigrados = true;
    await setDoc(ref, { datos: datosSinGastos() });
  }

  const gastos = await getDocs(collection(db, "gastos"));
  s.expenses = gastos.docs.map(d => ({ ...d.data(), id: d.id }));
  ordenar();
  sincronizados = new Map(s.expenses.map(x => [x.id, limpio(x)]));

  const accesos = await getDocs(collection(db, "accesos"));
  accesosSincronizados = new Map(accesos.docs.map(d => [d.id, d.data()]));

  datosCargados = true;
  escucharGastos();
  await window.guardarEnFirebase(); // actualiza accesos, catálogos y correos de los gastos si cambiaron
};

async function guardarTodo() {
  const u = auth.currentUser;
  if (!u || !esAdmin(u.email) || !datosCargados) return;
  const ops = [];

  ops.push(lote => lote.set(doc(db, "usuarios", u.uid), { datos: datosSinGastos() }));
  ops.push(lote => lote.set(doc(db, "catalogos", "empleados"), { accounts: limpio({ a: s.accounts || [] }).a, centers: limpio({ c: s.centers || [] }).c }));

  const deseados = accesosDeseados();
  deseados.forEach((a, email) => { if (!iguales(accesosSincronizados.get(email), a)) ops.push(lote => lote.set(doc(db, "accesos", email), a)); });
  accesosSincronizados.forEach((a, email) => { if (!deseados.has(email)) ops.push(lote => lote.delete(doc(db, "accesos", email))); });

  const guardados = new Map();
  const borrados = [];
  (s.expenses || []).forEach(x => {
    const d = prepararGasto(x);
    guardados.set(d.id, d);
    const previo = sincronizados.get(d.id);
    if (!previo) { ops.push(lote => lote.set(doc(db, "gastos", d.id), d)); return; }
    const cambios = {};
    new Set([...Object.keys(previo), ...Object.keys(d)]).forEach(k => {
      if (!iguales(previo[k], d[k])) cambios[k] = (k in d) ? d[k] : deleteField();
    });
    if (Object.keys(cambios).length) ops.push(lote => lote.update(doc(db, "gastos", d.id), cambios));
  });
  sincronizados.forEach((v, id) => { if (!guardados.has(id)) { borrados.push(id); ops.push(lote => lote.delete(doc(db, "gastos", id))); } });

  await ejecutarEnLotes(ops);
  guardados.forEach((d, id) => sincronizados.set(id, d));
  borrados.forEach(id => sincronizados.delete(id));
  accesosSincronizados = deseados;
}

// Los guardados se hacen en fila para que no se pisen entre sí.
window.guardarEnFirebase = function () {
  colaGuardado = colaGuardado.catch(() => {}).then(guardarTodo);
  return colaGuardado;
};

// Recibe en tiempo real lo que capturan los empleados.
function escucharGastos() {
  if (detenerEscucha) detenerEscucha();
  detenerEscucha = onSnapshot(collection(db, "gastos"), snap => {
    let cambio = false;
    snap.docChanges().forEach(ch => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const id = ch.doc.id;
      const i = s.expenses.findIndex(x => x.id === id);
      if (ch.type === "removed") {
        if (i >= 0) { s.expenses.splice(i, 1); cambio = true; }
        sincronizados.delete(id);
        return;
      }
      const remoto = { ...ch.doc.data(), id };
      const remotoLimpio = limpio(remoto);
      if (iguales(sincronizados.get(id), remotoLimpio)) return;
      sincronizados.set(id, remotoLimpio);
      if (i >= 0) {
        const x = s.expenses[i];
        Object.keys(x).forEach(k => { if (!k.startsWith("_") && !(k in remoto)) delete x[k]; });
        Object.assign(x, remoto);
      } else {
        s.expenses.push(remoto);
      }
      cambio = true;
    });
    if (cambio) { ordenar(); renderSeguro(); }
  }, err => console.error("Error en la sincronización de gastos:", err));
}

// ---------- Empleados y jefes ----------
const base = x => { const o = {}; CAMPOS_EMPLEADO.forEach(k => { o[k] = x[k] === undefined ? null : JSON.parse(JSON.stringify(x[k])); }); return o; };

// Mantiene una lista (s.expenses o s.teamExpenses) al día con lo que cambia en Firebase.
function escucharLista(q, obtenerLista, alCambiar) {
  return onSnapshot(q, snap => {
    let cambio = false;
    const lista = obtenerLista();
    snap.docChanges().forEach(ch => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const id = ch.doc.id;
      const i = lista.findIndex(x => x.id === id);
      if (ch.type === "removed") { if (i >= 0) { lista.splice(i, 1); cambio = true; } return; }
      const remoto = { ...ch.doc.data(), id, _firestoreId: id };
      if (i >= 0) {
        const x = lista[i];
        if (iguales(limpio(x), limpio(remoto))) return;
        Object.keys(x).forEach(k => { if (!k.startsWith("_") && !(k in remoto)) delete x[k]; });
        Object.assign(x, remoto);
        x._base = base(x);
      } else {
        remoto._base = base(remoto);
        lista.push(remoto);
      }
      cambio = true;
    });
    if (cambio) { lista.sort((a, b) => (a.orden ?? 1e15) - (b.orden ?? 1e15)); alCambiar(); }
  }, err => console.error("Error en la sincronización:", err));
}

window.cargarSesionEmpleado = async function (email) {
  email = norm(email);
  const acceso = await getDoc(doc(db, "accesos", email));
  if (!acceso.exists() || acceso.data().enabled === false) throw new Error("Este usuario no tiene acceso habilitado.");
  const info = acceso.data();
  const catalogo = await getDoc(doc(db, "catalogos", "empleados"));
  s.employees = [];
  s.userAccess = [];
  s.statementSummaries = {};
  s.expenses = [];
  s.teamExpenses = [];
  if (catalogo.exists()) {
    s.accounts = catalogo.data().accounts || [];
    s.centers = catalogo.data().centers || [];
  }
  escuchasSesion.forEach(f => f()); escuchasSesion = [];
  if (info.employee) {
    const q = query(collection(db, "gastos"), where("employeeEmail", "==", email));
    const gastos = await getDocs(q);
    s.expenses = gastos.docs.map(d => { const x = { ...d.data(), id: d.id, _firestoreId: d.id }; x._base = base(x); return x; });
    ordenar();
    escuchasSesion.push(escucharLista(q, () => s.expenses, renderSeguro));
  }
  if (info.isBoss) {
    const q = query(collection(db, "gastos"), where("bossEmail", "==", email));
    const equipo = await getDocs(q);
    s.teamExpenses = equipo.docs.map(d => ({ ...d.data(), id: d.id, _firestoreId: d.id }));
    s.teamExpenses.sort((a, b) => (a.orden ?? 1e15) - (b.orden ?? 1e15));
    escuchasSesion.push(escucharLista(q, () => s.teamExpenses, () => { if (window.renderAutorizaciones) window.renderAutorizaciones(); }));
  }
  return {
    user: email,
    name: info.employee || info.bossName || email,
    employee: info.employee || "",
    role: "Empleado",
    isBoss: !!info.isBoss,
    bossName: info.bossName || ""
  };
};

// El empleado guarda solo los campos permitidos que realmente cambió.
window.guardarGastoEmpleado = async function (x) {
  const id = x && (x._firestoreId || x.id);
  if (!id) return;
  const previo = x._base || {};
  const cambios = {};
  CAMPOS_EMPLEADO.forEach(k => {
    const valor = x[k] === undefined ? null : x[k];
    if (!iguales(previo[k], valor)) cambios[k] = x[k] === undefined ? deleteField() : JSON.parse(JSON.stringify(x[k]));
  });
  if (!Object.keys(cambios).length) return;
  await updateDoc(doc(db, "gastos", id), cambios);
  x._base = base(x);
};

// El jefe autoriza o rechaza un gasto de su equipo.
window.decidirAutorizacion = async function (id, decision, comentario) {
  const u = auth.currentUser;
  if (!u) throw new Error("Tu sesión no está activa.");
  if (!["Autorizada", "Rechazada"].includes(decision)) throw new Error("Decisión no válida.");
  let nombre = u.email;
  try { nombre = JSON.parse(sessionStorage.getItem("controlGastosSession") || "{}").bossName || u.email; } catch (e) {}
  const cambios = { authStatus: decision, authBy: norm(u.email), authByName: nombre, authAt: new Date().toISOString(), authComment: comentario || "" };
  await updateDoc(doc(db, "gastos", id), cambios);
  const x = (s.teamExpenses || []).find(g => g.id === id);
  if (x) Object.assign(x, cambios);
};

// ---------- Restaurar sesión al recargar la página ----------
const primerEstado = new Promise(res => { const off = onAuthStateChanged(auth, u => { off(); res(u); }); });

(async function restaurarSesion() {
  const u = await primerEstado;
  if (!u) { sessionStorage.removeItem("controlGastosSession"); return; }
  try {
    if (esAdmin(u.email)) {
      const sess = { user: u.email, name: "Administrador", role: "Administrador" };
      sessionStorage.setItem("controlGastosSession", JSON.stringify(sess));
      await window.openApp(sess);
    } else {
      const sess = await window.cargarSesionEmpleado(u.email);
      sessionStorage.setItem("controlGastosSession", JSON.stringify(sess));
      document.getElementById("loginScreen").style.display = "none";
      document.getElementById("appShell").style.display = "block";
      document.getElementById("userLabel").textContent = sess.name;
      document.getElementById("roleLabel").textContent = sess.role;
      window.render();
      if (window.applyRoleUI) window.applyRoleUI(sess);
      if (window.installEmployeeReports) window.installEmployeeReports();
    }
  } catch (e) {
    console.error("No se pudo restaurar la sesión:", e);
    await signOut(auth);
    sessionStorage.removeItem("controlGastosSession");
  }
})();
