// Conexión con Firebase: inicio de sesión, carga y guardado de datos.
// Los gastos viven en UNA sola colección ("gastos") que comparten la administradora y los empleados:
// - La administradora ve y edita todos los gastos, y recibe en tiempo real lo que capturan los empleados.
// - Cada empleado solo ve y edita los gastos que tienen su correo (employeeEmail).
// La seguridad real la ponen las reglas de Firestore (archivo reglas-firestore.txt).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
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

// Campos que un empleado puede modificar en sus gastos (debe coincidir con las reglas de Firestore).
const CAMPOS_EMPLEADO = ["concept", "account", "center", "centerSplits", "status", "receipt", "receiptPath", "receiptName"];

let datosCargados = false;              // evita guardar encima de Firebase si la carga falló
let sincronizados = new Map();          // id del gasto -> última versión conocida en Firebase
let accesosSincronizados = new Map();   // correo -> acceso guardado en Firebase
let detenerEscucha = null;
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

function accesosDeseados() {
  const m = new Map();
  (s.employees || []).forEach(e => {
    const email = correoDeEmpleado(e.name);
    if (email && !m.has(email)) m.set(email, { email, employee: e.name, role: "Empleado", enabled: true });
  });
  return m;
}

// Asegura que el gasto tenga id, orden y correo del empleado; devuelve la versión a guardar.
function prepararGasto(x) {
  if (!x.id) x.id = x.importId || nuevoId();
  x.id = String(x.id).replace(/\//g, "_");
  if (typeof x.orden !== "number") x.orden = siguienteOrden();
  x.employeeEmail = correoDeEmpleado(x.employee);
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
window.detenerSincronizacion = () => { if (detenerEscucha) { detenerEscucha(); detenerEscucha = null; } datosCargados = false; };

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

// ---------- Empleados ----------
window.cargarSesionEmpleado = async function (email) {
  email = norm(email);
  const acceso = await getDoc(doc(db, "accesos", email));
  if (!acceso.exists() || acceso.data().enabled === false) throw new Error("Este usuario no tiene acceso habilitado.");
  const info = acceso.data();
  const catalogo = await getDoc(doc(db, "catalogos", "empleados"));
  const gastos = await getDocs(query(collection(db, "gastos"), where("employeeEmail", "==", email)));
  s.employees = [];
  s.userAccess = [];
  s.statementSummaries = {};
  s.expenses = gastos.docs.map(d => ({ ...d.data(), id: d.id, _firestoreId: d.id }));
  ordenar();
  if (catalogo.exists()) {
    s.accounts = catalogo.data().accounts || [];
    s.centers = catalogo.data().centers || [];
  }
  return { user: email, name: info.employee, employee: info.employee, role: "Empleado" };
};

// El empleado solo guarda los campos que tiene permitidos.
window.guardarGastoEmpleado = async function (x) {
  const id = x && (x._firestoreId || x.id);
  if (!id) return;
  const cambios = {};
  CAMPOS_EMPLEADO.forEach(k => { cambios[k] = x[k] === undefined ? deleteField() : JSON.parse(JSON.stringify(x[k])); });
  await updateDoc(doc(db, "gastos", id), cambios);
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
