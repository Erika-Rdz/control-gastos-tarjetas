// Bebidas alcohólicas y autorización del jefe inmediato.
// Regla: si la cuenta es 6120100003 - MEALS EMPLOYEES y el centro de costos (o alguno de la división)
// es Ventas FL o Ventas TX, el empleado debe indicar si hubo bebidas alcohólicas: Cliente, Personal o No aplica.
// Si elige "Personal", el gasto requiere autorización de su jefe inmediato.
(function () {
  const CUENTA_COMIDAS = "6120100003";
  const OPCIONES = ["Cliente", "Personal", "No aplica"];

  const norm = v => String(v || "").trim().toLowerCase();
  const q = v => String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  function session() { try { return JSON.parse(sessionStorage.getItem("controlGastosSession") || "null"); } catch (e) { return null; } }
  const esEmpleado = () => session()?.role === "Empleado";

  // ---------- Regla ----------
  function nombreCuentaComidas() {
    const a = (s.accounts || []).find(a => String(a.code).trim() === CUENTA_COMIDAS);
    return a ? a.name : null;
  }
  function esCentroVentas(nombre) {
    const n = norm(nombre).replace(/\s+/g, " ");
    return /ventas/.test(n) && /\b(fl|tx)\b/.test(n);
  }
  window.requiereBebidas = function (x) {
    if (!x) return false;
    const cuenta = nombreCuentaComidas();
    const esComidas = cuenta ? x.account === cuenta : /meals employees/i.test(x.account || "");
    if (!esComidas) return false;
    if (esCentroVentas(x.center)) return true;
    return (x.centerSplits || []).some(p => esCentroVentas(p.center));
  };

  // El estado del gasto toma en cuenta la autorización.
  const estadoBase = expenseStatus;
  expenseStatus = window.expenseStatus = function (x) {
    const estado = estadoBase(x);
    if (estado === "Pendiente de clasificar" || !window.requiereBebidas(x)) return estado;
    if (!x.alcohol) return "Pendiente de clasificar";
    if (x.alcohol === "Personal") {
      if (x.authStatus === "Rechazada") return "Rechazado por jefe";
      if (x.authStatus === "Solicitada") return "En autorización";
      if (x.authStatus !== "Autorizada") return "Requiere autorización";
    }
    return estado;
  };

  // ---------- Recuadro dentro de la fila del gasto ----------
  function estadoAutorizacion(x) {
    if (x.alcohol !== "Personal") return "";
    const quien = x.bossName ? esc(x.bossName) : "tu jefe inmediato";
    if (x.authStatus === "Autorizada")
      return `<div class="auth-msg auth-ok">✅ Autorizado por ${esc(x.authByName || x.authBy || "el jefe")}${x.authComment ? "<br><i>" + esc(x.authComment) + "</i>" : ""}</div>`;
    if (x.authStatus === "Solicitada")
      return `<div class="auth-msg auth-wait">⏳ Enviado a ${quien} para autorización</div>`;
    const rechazo = x.authStatus === "Rechazada"
      ? `<div class="auth-msg auth-no">❌ Rechazado por ${esc(x.authByName || x.authBy || "el jefe")}${x.authComment ? ": " + esc(x.authComment) : ""}</div>` : "";
    return `${rechazo}<div class="auth-msg auth-need">Requiere autorización</div>`
      + `<button type="button" class="split-btn" onclick="bebidasSolicitar('${q(x.id)}')">📨 ${x.authStatus === "Rechazada" ? "Volver a solicitar" : "Solicitar autorización"}</button>`;
  }

  function recuadro(x) {
    const opciones = OPCIONES.map(o => `<option value="${o}" ${x.alcohol === o ? "selected" : ""}>${o}</option>`).join("");
    return `<div class="alcohol-box"><label>🍷 Bebidas alcohólicas</label>`
      + `<select class="expense-select ${x.alcohol ? "" : "pending-field"}" onchange="bebidasCambiar('${q(x.id)}',this.value)">`
      + `<option value="">Seleccionar...</option>${opciones}</select>${estadoAutorizacion(x)}</div>`;
  }

  function filas() {
    const body = document.getElementById("expenses");
    if (!body) return;
    [...body.children].forEach((tr, i) => {
      const x = s.expenses[i];
      const td = tr.children[5];
      if (!x || !td) return;
      td.querySelector(".alcohol-box")?.remove();
      if (window.requiereBebidas(x)) td.insertAdjacentHTML("beforeend", recuadro(x));
      if (tr.children[8]) tr.children[8].textContent = expenseStatus(x);
    });
  }

  function vigilarTabla() {
    const body = document.getElementById("expenses");
    if (!body || body._vigilado) return;
    body._vigilado = true;
    new MutationObserver(filas).observe(body, { childList: true });
    filas();
  }

  async function guardar(x) {
    if (esEmpleado()) await window.guardarGastoEmpleado(x);
    else save();
  }

  window.bebidasCambiar = async function (id, valor) {
    const x = (s.expenses || []).find(g => g.id === id);
    if (!x) return;
    x.alcohol = valor;
    // Cualquier cambio reinicia la autorización.
    x.authStatus = "";
    x.authRequestedAt = "";
    x.authRequestedBy = "";
    try { await guardar(x); } catch (e) { console.error(e); alert("No se pudo guardar el cambio. " + (e.code || e.message || "")); }
    filas();
  };

  window.bebidasSolicitar = async function (id) {
    const x = (s.expenses || []).find(g => g.id === id);
    if (!x) return;
    if (!x.bossEmail) {
      alert("Este empleado todavía no tiene un jefe inmediato con acceso al sistema. Avisa a la administradora para que lo configure.");
      return;
    }
    if (!confirm("¿Enviar este gasto a " + (x.bossName || "tu jefe inmediato") + " para autorización?")) return;
    x.authStatus = "Solicitada";
    x.authRequestedAt = new Date().toISOString();
    x.authRequestedBy = session()?.user || "";
    try { await guardar(x); } catch (e) { console.error(e); alert("No se pudo enviar la solicitud. " + (e.code || e.message || "")); }
    filas();
  };

  // ---------- Página de Autorizaciones ----------
  const fecha = v => v ? new Date(v).toLocaleDateString("es-MX") : "";
  function centros(x) {
    return (x.centerSplits && x.centerSplits.length) ? x.centerSplits.map(p => esc(p.center) + " " + money(p.amount)).join(" + ") : esc(x.center || "");
  }
  function etiqueta(x) {
    if (x.authStatus === "Autorizada") return '<span style="color:#166534;font-weight:bold">Autorizado</span>';
    if (x.authStatus === "Rechazada") return '<span style="color:#991b1b;font-weight:bold">Rechazado</span>';
    if (x.authStatus === "Solicitada") return '<span style="color:#92400e;font-weight:bold">Pendiente del jefe</span>';
    return '<span style="color:#64748b;font-weight:bold">Sin solicitar</span>';
  }
  function detalle(x) {
    if (!x.authBy) return "";
    return esc(x.authByName || x.authBy) + " · " + fecha(x.authAt) + (x.authComment ? "<br><i>" + esc(x.authComment) + "</i>" : "");
  }

  window.renderAutorizaciones = function () {
    const box = document.getElementById("approvals");
    if (!box) return;
    const sess = session();
    if (sess?.role === "Empleado" && sess.isBoss) {
      const equipo = (s.teamExpenses || []).filter(x => x.alcohol === "Personal" && x.authStatus);
      const pendientes = equipo.filter(x => x.authStatus === "Solicitada");
      const historial = equipo.filter(x => x.authStatus !== "Solicitada");
      box.innerHTML = `<h3>Pendientes de autorizar (${pendientes.length})</h3>`
        + `<p>Gastos de comidas de tu equipo de ventas donde el empleado indicó consumo de bebidas alcohólicas <b>personal</b>.</p>`
        + (pendientes.length ? `<table><thead><tr><th>Fecha</th><th>Empleado</th><th>Comercio</th><th>Importe</th><th>Concepto</th><th>Centro de costos</th><th>Solicitado</th><th>Acciones</th></tr></thead><tbody>`
          + pendientes.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.employee)}</td><td>${esc(x.supplier || "")}</td><td>${money(x.amount)}</td><td>${esc(x.concept || "")}</td><td>${centros(x)}</td><td>${fecha(x.authRequestedAt)}</td>`
            + `<td style="white-space:nowrap"><button class="primary" style="display:inline-block;width:auto" onclick="jefeDecidir('${q(x.id)}','Autorizada')">✅ Autorizar</button> `
            + `<button class="split-btn" onclick="jefeDecidir('${q(x.id)}','Rechazada')">❌ Rechazar</button></td></tr>`).join("")
          + `</tbody></table>` : "<p><b>No tienes gastos pendientes de autorizar.</b></p>")
        + `<h3 style="margin-top:26px">Historial</h3>`
        + (historial.length ? `<table><thead><tr><th>Fecha</th><th>Empleado</th><th>Comercio</th><th>Importe</th><th>Concepto</th><th>Decisión</th><th>Detalle</th></tr></thead><tbody>`
          + historial.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.employee)}</td><td>${esc(x.supplier || "")}</td><td>${money(x.amount)}</td><td>${esc(x.concept || "")}</td><td>${etiqueta(x)}</td><td>${detalle(x)}</td></tr>`).join("")
          + `</tbody></table>` : "<p>Todavía no hay autorizaciones registradas.</p>");
      return;
    }
    if (sess?.role === "Empleado") return;
    // Administradora: vista de consulta de todos los gastos con consumo personal.
    const lista = (s.expenses || []).filter(x => window.requiereBebidas(x) && x.alcohol === "Personal");
    box.innerHTML = `<h3>Bebidas alcohólicas de consumo personal (${lista.length})</h3>`
      + `<p>Gastos de MEALS EMPLOYEES en Ventas FL / Ventas TX que requieren autorización del jefe inmediato. La autorización la da cada jefe desde su usuario.</p>`
      + (lista.length ? `<table><thead><tr><th>Fecha</th><th>Empleado</th><th>Jefe inmediato</th><th>Comercio</th><th>Importe</th><th>Concepto</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>`
        + lista.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.employee)}</td><td>${esc(x.bossName || "—")}${x.bossEmail ? "" : '<br><small style="color:#991b1b">Sin acceso configurado</small>'}</td><td>${esc(x.supplier || "")}</td><td>${money(x.amount)}</td><td>${esc(x.concept || "")}</td><td>${etiqueta(x)}</td><td>${detalle(x)}</td></tr>`).join("")
        + `</tbody></table>` : "<p>No hay gastos con consumo personal de bebidas alcohólicas.</p>");
  };

  window.jefeDecidir = async function (id, decision) {
    let comentario = "";
    if (decision === "Rechazada") {
      comentario = prompt("Motivo del rechazo (el empleado lo verá):");
      if (comentario === null) return;
      if (!comentario.trim()) { alert("Escribe el motivo del rechazo."); return; }
    } else {
      comentario = prompt("Comentario (opcional):", "");
      if (comentario === null) return;
    }
    try {
      await window.decidirAutorizacion(id, decision, comentario.trim());
      window.renderAutorizaciones();
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar la decisión. " + (e.code || e.message || ""));
    }
  };

  // ---------- Configuración: jefes inmediatos ----------
  const correoValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  function asegurar() { if (!Array.isArray(s.bosses)) s.bosses = []; }

  window.agregarJefe = function () {
    asegurar();
    const name = (prompt("Nombre del jefe inmediato:") || "").trim();
    if (!name) return;
    if (s.bosses.some(b => norm(b.name) === norm(name))) { alert("Ya existe un jefe con ese nombre."); return; }
    const email = norm(prompt("Correo con el que " + name + " iniciará sesión:") || "");
    if (!correoValido(email)) { alert("Escribe un correo válido."); return; }
    s.bosses.push({ name, email, enabled: true });
    save(); render();
    alert("Jefe agregado.\n\nRecuerda crear su usuario y contraseña en Firebase → Authentication con el correo " + email + ".");
  };
  window.editarJefe = function (i) {
    asegurar();
    const b = s.bosses[i]; if (!b) return;
    const name = prompt("Nombre del jefe inmediato:", b.name);
    if (name === null || !name.trim()) return;
    const email = prompt("Correo de acceso:", b.email);
    if (email === null) return;
    if (!correoValido(norm(email))) { alert("Escribe un correo válido."); return; }
    (s.employees || []).forEach(e => { if (norm(e.boss) === norm(b.name)) e.boss = name.trim(); });
    b.name = name.trim(); b.email = norm(email);
    save(); render();
  };
  window.activarJefe = function (i) {
    asegurar(); const b = s.bosses[i]; if (!b) return;
    b.enabled = b.enabled === false; save(); render();
  };
  window.quitarJefe = function (i) {
    asegurar(); const b = s.bosses[i]; if (!b) return;
    if (!confirm("¿Quitar a " + b.name + " como jefe inmediato? Sus empleados quedarán sin jefe asignado.")) return;
    (s.employees || []).forEach(e => { if (norm(e.boss) === norm(b.name)) e.boss = ""; });
    s.bosses.splice(i, 1); save(); render();
  };
  window.asignarJefe = function (empleado, jefe) {
    const e = (s.employees || []).find(e => e.name === empleado); if (!e) return;
    e.boss = jefe; save(); render();
  };

  function configJefes() {
    if (esEmpleado()) return;
    const section = document.getElementById("configuracion");
    if (!section) return;
    asegurar();
    let box = document.getElementById("bossManager");
    if (!box) {
      box = document.createElement("div");
      box.className = "box"; box.id = "bossManager";
      const accesos = document.getElementById("accessManager");
      if (accesos) accesos.after(box); else section.appendChild(box);
    }
    const nombres = s.bosses.map(b => b.name);
    box.innerHTML = `<h3>👔 Jefes inmediatos</h3>`
      + `<p>Los jefes autorizan los gastos de comidas con consumo <b>personal</b> de bebidas alcohólicas. Cada jefe necesita además su usuario y contraseña en Firebase → Authentication.</p>`
      + `<button class="primary" style="display:inline-block;width:auto" onclick="agregarJefe()">+ Agregar jefe</button>`
      + `<table style="margin-top:12px"><thead><tr><th>Jefe</th><th>Correo de acceso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`
      + (s.bosses.map((b, i) => `<tr><td><b>${esc(b.name)}</b></td><td>${esc(b.email)}</td><td>${b.enabled === false ? '<b style="color:#991b1b">Desactivado</b>' : '<b style="color:#166534">Activo</b>'}</td>`
        + `<td><button class="split-btn" onclick="editarJefe(${i})">Editar</button> <button class="split-btn" onclick="activarJefe(${i})">${b.enabled === false ? "Activar" : "Desactivar"}</button> <button class="split-btn" onclick="quitarJefe(${i})">Quitar</button></td></tr>`).join("")
        || '<tr><td colspan="4">Todavía no hay jefes registrados.</td></tr>')
      + `</tbody></table>`
      + `<h4 style="margin-top:20px">Jefe inmediato de cada empleado</h4>`
      + `<table><thead><tr><th>Empleado</th><th>Jefe inmediato</th></tr></thead><tbody>`
      + ((s.employees || []).map(e => {
        const actual = e.boss || "";
        const extra = actual && !nombres.some(n => norm(n) === norm(actual)) ? `<option value="${esc(actual)}" selected>${esc(actual)} (sin acceso)</option>` : "";
        return `<tr><td>${esc(e.name)}</td><td><select class="expense-select" onchange="asignarJefe('${esc(q(e.name))}',this.value)"><option value="">Sin jefe asignado</option>${extra}`
          + nombres.map(n => `<option value="${esc(n)}" ${norm(n) === norm(actual) ? "selected" : ""}>${esc(n)}</option>`).join("") + `</select></td></tr>`;
      }).join("") || '<tr><td colspan="2">Primero agrega empleados.</td></tr>')
      + `</tbody></table>`;
  }

  // ---------- Estilos ----------
  const css = document.createElement("style");
  css.textContent = ".alcohol-box{margin-top:8px;padding:8px;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc}"
    + ".alcohol-box label{display:block;font-weight:bold;font-size:12px;margin-bottom:4px}"
    + ".auth-msg{font-size:12px;margin:6px 0;font-weight:bold}.auth-ok{color:#166534}.auth-wait{color:#92400e}.auth-no{color:#991b1b}.auth-need{color:#b45309}";
  document.head.appendChild(css);

  const anterior = window.render || render;
  window.render = render = function () { anterior(); vigilarTabla(); configJefes(); window.renderAutorizaciones(); };
  vigilarTabla();
})();
