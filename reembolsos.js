// Reembolsos de gastos pagados por el usuario (sin tarjeta de la empresa).
// Solo los usuarios autorizados en Configuración → Reembolsos ven la opción.
// El usuario captura fecha, comercio, concepto, cuenta, centro de costos, importe y PDF; luego firma y envía.
// La administradora lo recibe en Reportes → Reembolsos recibidos y descarga un PDF con todos los comprobantes.
(function () {
  let lista = [];        // reembolsos del usuario
  let actual = null;     // reembolso abierto en el editor
  let recibidos = [];    // administradora
  let cargadoUsuario = false, cargadoAdmin = false;
  let temporizador = null;

  function session() { try { return JSON.parse(sessionStorage.getItem("controlGastosSession") || "null"); } catch (e) { return null; } }
  const puede = () => !!session()?.canReimburse;
  const esAdmin = () => session()?.role === "Administrador";
  const q = v => String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const norm = v => String(v || "").trim().toLowerCase();
  const dinero = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nuevoId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const editable = r => r && (r.status === "Borrador" || r.status === "Devuelto");
  function fechaHora(iso) { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString("es-MX") + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }
  const isoAUs = v => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[2] + "/" + m[3] + "/" + m[1] : v || ""; };
  const usAIso = v => { const m = String(v || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + "-" + m[1] + "-" + m[2] : ""; };
  const ordenFecha = v => usAIso(v) || "9999";
  const total = r => Math.round((r.items || []).reduce((t, i) => t + Number(i.amount || 0), 0) * 100) / 100;
  const etiqueta = st => ({
    Borrador: '<b style="color:#5F6E70">Borrador</b>', Enviado: '<b style="color:#A9741F">📨 Enviado, en revisión</b>',
    Aceptado: '<b style="color:#2F7A68">✅ Aceptado</b>', Pagado: '<b style="color:#1D3B45">💵 Pagado</b>', Devuelto: '<b style="color:#A13A3A">↩️ Devuelto</b>'
  })[st] || esc(st || "");

  // ---------- Formato del reporte (mismo diseño que el reporte mensual) ----------
  function codigoCuenta(nombre) { const a = (s.accounts || []).find(a => a.name === nombre); return a ? String(a.code || "") : ""; }
  function comoReporte(r) {
    const items = [...(r.items || [])].sort((a, b) => ordenFecha(a.date).localeCompare(ordenFecha(b.date)));
    const fechas = items.map(i => i.date).filter(Boolean);
    let fl = 0, tx = 0; items.forEach(i => { if (/\bFL\b/i.test(i.center || "")) fl++; if (/\bTX\b/i.test(i.center || "")) tx++; });
    return {
      title: "Expense Reimbursement Request", fileTitle: "Reimbursement",
      employee: r.ownerName || "", email: r.ownerEmail || "", supervisor: "", department: "",
      location: fl > tx ? "Florida" : tx > fl ? "Texas" : (fl ? "Florida / Texas" : ""), purpose: "Reimbursement",
      period: "", from: fechas[0] || "", to: fechas[fechas.length - 1] || "",
      lines: items.map(i => ({ date: i.date, amount: Number(i.amount || 0), place: i.place || "", description: i.concept || "", accountCode: i.accountCode || codigoCuenta(i.account), receiptPath: i.receiptPath || "" })),
      count: items.length, total: total(r), signedName: r.signedName || "", signedAt: r.signedAt || ""
    };
  }
  async function descargar(r, tipo, aviso) {
    const api = window.ReporteAPI;
    if (!api) { alert("El generador de reportes todavía no está listo. Recarga la página."); return; }
    const rep = comoReporte(r);
    try {
      aviso && aviso("Preparando archivo...");
      if (tipo === "xlsx") await api.excel(rep);
      else api.descargar(await api.pdf(rep, true, aviso), api.nombreArchivo(rep, "pdf"), "application/pdf");
      aviso && aviso("");
    } catch (e) { console.error(e); aviso && aviso(""); alert("No se pudo generar el archivo. " + (e.message || "")); }
  }

  // ---------- Comprobantes (Supabase) ----------
  async function encabezados(tipo) {
    const cfg = window.SUPABASE_CONFIG, u = window.firebaseAuth && window.firebaseAuth.currentUser;
    if (!cfg || !u) throw new Error("Tu sesión no está activa.");
    return { apikey: cfg.publishableKey, Authorization: "Bearer " + await u.getIdToken(false), "Content-Type": tipo };
  }
  window.reembolsoSubir = async function (lineaId, input) {
    const file = input && input.files && input.files[0];
    const it = actual && (actual.items || []).find(i => i.id === lineaId);
    if (!file || !it) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { alert("El comprobante debe ser un archivo PDF."); input.value = ""; return; }
    if (file.size > 10 * 1024 * 1024) { alert("El PDF no puede pesar más de 10 MB."); input.value = ""; return; }
    input.disabled = true;
    try {
      const u = window.firebaseAuth.currentUser, cfg = window.SUPABASE_CONFIG;
      const path = u.uid + "/reembolsos/" + actual.id + "/" + it.id + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const r = await fetch(cfg.url + "/storage/v1/object/comprobantes/" + path, { method: "POST", headers: await encabezados("application/pdf"), body: file });
      if (!r.ok) throw new Error(await r.text());
      it.receiptPath = path; it.receiptName = file.name;
      await guardarAhora();
      pintarUsuario();
    } catch (e) { console.error(e); alert("No se pudo subir el comprobante. " + (e.message || "")); input.disabled = false; }
  };
  window.reembolsoVerPdf = async function (path) {
    try {
      const cfg = window.SUPABASE_CONFIG;
      const r = await fetch(cfg.url + "/storage/v1/object/sign/comprobantes/" + path, { method: "POST", headers: await encabezados("application/json"), body: JSON.stringify({ expiresIn: 300 }) });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      window.open(cfg.url + "/storage/v1" + (d.signedURL || d.signedUrl), "_blank", "noopener");
    } catch (e) { console.error(e); alert("No se pudo abrir el comprobante. " + (e.message || "")); }
  };

  // ---------- Usuario autorizado ----------
  async function cargarUsuario() {
    try { lista = window.misReembolsos ? await window.misReembolsos() : []; } catch (e) { console.error(e); lista = []; }
    if (actual) actual = lista.find(r => r.id === actual.id) || actual;
    pintarUsuario();
  }
  async function guardarAhora() {
    if (!actual || !editable(actual)) return;
    clearTimeout(temporizador);
    const datos = { ...actual, status: "Borrador", total: total(actual), count: (actual.items || []).length };
    delete datos.id;
    await window.guardarReembolso(actual.id, datos);
    actual.status = "Borrador";
    const i = lista.findIndex(r => r.id === actual.id);
    if (i >= 0) lista[i] = actual; else lista.push(actual);
  }
  function guardarLuego() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => guardarAhora().catch(e => { console.error(e); alert("No se pudo guardar el borrador. " + (e.code || e.message || "")); }), 700);
  }

  window.reembolsoNuevo = function () {
    const sess = session() || {};
    actual = { id: nuevoId(), ownerName: sess.name || "", status: "Borrador", createdAt: new Date().toISOString(), items: [{ id: nuevoId(), date: "", place: "", concept: "", account: "", center: "", amount: 0 }] };
    pintarUsuario();
  };
  window.reembolsoAbrir = id => { actual = lista.find(r => r.id === id) || null; pintarUsuario(); };
  window.reembolsoCerrar = async () => { try { await guardarAhora(); } catch (e) { console.error(e); } actual = null; pintarUsuario(); };
  window.reembolsoAgregar = function () { actual.items.push({ id: nuevoId(), date: "", place: "", concept: "", account: "", center: "", amount: 0 }); pintarUsuario(); guardarLuego(); };
  window.reembolsoQuitarLinea = function (id) {
    if (!confirm("¿Quitar este gasto del reembolso?")) return;
    actual.items = actual.items.filter(i => i.id !== id); pintarUsuario(); guardarLuego();
  };
  window.reembolsoCampo = function (id, campo, valor) {
    const it = actual.items.find(i => i.id === id); if (!it) return;
    if (campo === "date") it.date = isoAUs(valor);
    else if (campo === "amount") it.amount = Math.round(Number(valor || 0) * 100) / 100;
    else it[campo] = valor;
    if (campo === "account") it.accountCode = codigoCuenta(valor);
    const t = document.getElementById("reembolsoTotal"); if (t) t.textContent = dinero(total(actual));
    guardarLuego();
  };
  window.reembolsoEliminar = async function (id) {
    if (!confirm("¿Eliminar este borrador de reembolso?")) return;
    try { await window.eliminarReembolso(id); lista = lista.filter(r => r.id !== id); if (actual && actual.id === id) actual = null; pintarUsuario(); }
    catch (e) { console.error(e); alert("No se pudo eliminar. " + (e.code || e.message || "")); }
  };
  window.reembolsoDescargar = (id, tipo) => {
    const r = (actual && actual.id === id) ? actual : lista.find(x => x.id === id);
    if (r) descargar(r, tipo, t => { const el = document.getElementById("reembolsoAviso"); if (el) el.textContent = t; });
  };

  function faltantes(r) {
    const items = r.items || [];
    if (!items.length) return ["Agrega al menos un gasto."];
    const f = [];
    items.forEach((i, k) => {
      const falta = [];
      if (!i.date) falta.push("fecha"); if (!i.place) falta.push("comercio"); if (!i.concept) falta.push("concepto");
      if (!i.account) falta.push("cuenta"); if (!i.center) falta.push("centro de costos"); if (!(Number(i.amount) > 0)) falta.push("importe");
      if (falta.length) f.push("Gasto " + (k + 1) + ": falta " + falta.join(", ") + ".");
    });
    return f;
  }

  window.reembolsoFirmar = async function () {
    try { await guardarAhora(); } catch (e) { console.error(e); }
    const f = faltantes(actual);
    if (f.length) { alert("Antes de enviar, completa lo siguiente:\n\n" + f.join("\n")); return; }
    const sinPdf = actual.items.filter(i => !i.receiptPath).length;
    let dlg = document.getElementById("dlgFirmaReembolso");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "dlgFirmaReembolso";
      dlg.style.cssText = "border:0;border-radius:12px;padding:26px;width:min(460px,92vw);box-shadow:0 20px 55px rgba(0,0,0,.25)";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<h3 style="margin-top:0">Firmar y enviar reembolso</h3>`
      + `<p>${actual.items.length} gasto(s) · <b>USD ${dinero(total(actual))}</b></p>`
      + (sinPdf ? `<p style="color:#A9741F">Atención: ${sinPdf} gasto(s) no tienen comprobante PDF.</p>` : "")
      + `<label style="display:flex;gap:8px;align-items:flex-start;margin:14px 0"><input type="checkbox" id="rbCertifico" style="width:auto;margin-top:3px"> <span>Certifico que estos gastos fueron pagados por mí para fines de la empresa y que la información es correcta.</span></label>`
      + `<label>Escribe tu nombre completo como firma</label><input id="rbNombre" style="width:100%;box-sizing:border-box">`
      + `<div id="rbError" class="login-error"></div>`
      + `<div style="display:flex;gap:10px;margin-top:14px"><button class="primary" id="rbEnviar" style="width:auto">Firmar y enviar</button><button class="split-btn" onclick="document.getElementById('dlgFirmaReembolso').close()">Cancelar</button></div>`;
    dlg.querySelector("#rbEnviar").onclick = async () => {
      const err = dlg.querySelector("#rbError"), nombre = dlg.querySelector("#rbNombre").value.trim();
      const mostrar = m => { err.textContent = m; err.style.display = "block"; };
      if (!dlg.querySelector("#rbCertifico").checked) return mostrar("Marca la casilla de certificación.");
      if (nombre.split(/\s+/).length < 2) return mostrar("Escribe tu nombre y apellido.");
      const boton = dlg.querySelector("#rbEnviar"); boton.disabled = true;
      try {
        const datos = { ...actual, status: "Enviado", signedName: nombre, signedAt: new Date().toISOString(), total: total(actual), count: actual.items.length, reviewComment: "" };
        delete datos.id;
        await window.guardarReembolso(actual.id, datos);
        dlg.close(); actual = null;
        await cargarUsuario();
        alert("Tu reembolso quedó firmado y enviado a Cuentas por Pagar.");
      } catch (e) { console.error(e); mostrar("No se pudo enviar. " + (e.code || e.message || "")); boton.disabled = false; }
    };
    dlg.showModal();
  };

  function pintarUsuario() {
    const box = document.getElementById("reembolsosBox");
    if (!box || !puede()) return;
    if (!actual) {
      const filas = [...lista].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      box.innerHTML = `<button class="primary" style="width:auto;display:inline-block" onclick="reembolsoNuevo()">+ Nuevo reembolso</button>`
        + (filas.length ? `<div style="overflow-x:auto"><table style="margin-top:14px"><thead><tr><th>Creado</th><th style="text-align:right">Gastos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`
          + filas.map(r => `<tr><td>${fechaHora(r.createdAt)}</td><td style="text-align:right">${(r.items || []).length}</td><td style="text-align:right">${dinero(total(r))}</td>`
            + `<td>${esc(r.signedName || "")}<br><small>${fechaHora(r.signedAt)}</small></td><td>${etiqueta(r.status)}${r.status === "Devuelto" && r.reviewComment ? "<br><small>" + esc(r.reviewComment) + "</small>" : ""}</td>`
            + `<td style="white-space:nowrap">${editable(r) ? `<button class="split-btn" onclick="reembolsoAbrir('${q(r.id)}')">✏️ Abrir</button> ` : `<button class="split-btn" onclick="reembolsoAbrir('${q(r.id)}')">👁️ Ver</button> `}`
            + `<button class="split-btn" onclick="reembolsoDescargar('${q(r.id)}','pdf')">⬇️ PDF</button>`
            + (r.status === "Borrador" ? ` <button class="split-btn" onclick="reembolsoEliminar('${q(r.id)}')">🗑️</button>` : "") + `</td></tr>`).join("")
          + `</tbody></table></div>` : `<p style="margin-top:14px">Todavía no tienes reembolsos. Pulsa <b>+ Nuevo reembolso</b> para capturar tus gastos.</p>`)
        + `<div id="reembolsoAviso" style="margin-top:8px;color:#5F6E70"></div>`;
      return;
    }
    const ed = editable(actual);
    const cuentas = (s.accounts || []), centros = (s.centers || []);
    const opc = (arr, sel, txt) => `<option value="">Seleccionar...</option>` + arr.map(a => `<option value="${esc(a.name)}" ${a.name === sel ? "selected" : ""}>${esc(txt(a))}</option>`).join("");
    const dis = ed ? "" : "disabled";
    box.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="split-btn" onclick="reembolsoCerrar()">← Mis reembolsos</button>`
      + `<span>${etiqueta(actual.status)}</span>${actual.status === "Devuelto" && actual.reviewComment ? `<span style="color:#A13A3A">Motivo: ${esc(actual.reviewComment)}</span>` : ""}</div>`
      + `<div style="overflow-x:auto"><table style="margin-top:14px"><thead><tr><th>Fecha</th><th>Comercio</th><th>Concepto</th><th>Cuenta de gasto</th><th>Centro de costos</th><th style="text-align:right">Importe USD</th><th>Comprobante</th><th></th></tr></thead><tbody>`
      + actual.items.map(i => `<tr>`
        + `<td><input type="date" ${dis} value="${usAIso(i.date)}" onchange="reembolsoCampo('${q(i.id)}','date',this.value)" style="width:140px"></td>`
        + `<td><input ${dis} value="${esc(i.place || "")}" placeholder="Comercio" onchange="reembolsoCampo('${q(i.id)}','place',this.value)" style="min-width:150px"></td>`
        + `<td><input ${dis} value="${esc(i.concept || "")}" placeholder="Concepto" onchange="reembolsoCampo('${q(i.id)}','concept',this.value)" style="min-width:180px"></td>`
        + `<td><select ${dis} class="expense-select" onchange="reembolsoCampo('${q(i.id)}','account',this.value)">${opc(cuentas, i.account, a => (a.code ? a.code + " - " : "") + a.name)}</select></td>`
        + `<td><select ${dis} class="expense-select" onchange="reembolsoCampo('${q(i.id)}','center',this.value)">${opc(centros, i.center, c => (c.code ? c.code + " - " : "") + c.name)}</select></td>`
        + `<td><input type="number" step="0.01" min="0" ${dis} value="${i.amount || ""}" onchange="reembolsoCampo('${q(i.id)}','amount',this.value)" style="width:110px;text-align:right"></td>`
        + `<td style="white-space:nowrap">${i.receiptPath ? `<button class="split-btn" onclick="reembolsoVerPdf('${q(i.receiptPath)}')">👁️ Ver PDF</button> ` : ""}`
        + (ed ? `<label class="split-btn" style="display:inline-block">${i.receiptPath ? "🔄 Reemplazar" : "📎 Subir PDF"}<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="reembolsoSubir('${q(i.id)}',this)"></label>` : "") + `</td>`
        + `<td>${ed ? `<button class="split-btn" title="Quitar" onclick="reembolsoQuitarLinea('${q(i.id)}')">🗑️</button>` : ""}</td></tr>`).join("")
      + `<tr style="background:#eef2f7"><td colspan="5"><b>Total</b></td><td style="text-align:right"><b id="reembolsoTotal">${dinero(total(actual))}</b></td><td colspan="2"></td></tr></tbody></table></div>`
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">`
      + (ed ? `<button class="split-btn" onclick="reembolsoAgregar()">+ Agregar gasto</button>` : "")
      + `<button class="split-btn" onclick="reembolsoDescargar('${q(actual.id)}','pdf')">⬇️ PDF con comprobantes</button>`
      + (ed ? `<button class="primary" style="width:auto;display:inline-block" onclick="reembolsoFirmar()">✍️ Firmar y enviar</button>` : "")
      + `</div><p style="font-size:12px;color:#5F6E70">${ed ? "Los cambios se guardan solos como borrador." : "Este reembolso ya se envió; solo es de consulta."}</p>`
      + `<div id="reembolsoAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }

  // ---------- Administradora ----------
  async function cargarAdmin() {
    try { recibidos = window.reembolsosRecibidos ? await window.reembolsosRecibidos() : []; } catch (e) { console.error(e); recibidos = []; }
    pintarAdmin();
  }
  function pintarAdmin() {
    if (!esAdmin()) return;
    const sec = document.getElementById("reportes");
    if (!sec) return;
    let box = document.getElementById("reembolsosRecibidosBox");
    if (!box) {
      box = document.createElement("div"); box.className = "box"; box.id = "reembolsosRecibidosBox";
      const ref = document.getElementById("reportesRecibidosBox");
      if (ref) ref.after(box); else sec.insertBefore(box, sec.children[1] || null);
    }
    const filas = [...recibidos].sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
    const pendientes = filas.filter(r => r.status === "Enviado").length;
    box.innerHTML = `<h3>💵 Reembolsos recibidos ${pendientes ? `(${pendientes} por revisar)` : ""}</h3>`
      + `<p>Gastos pagados por los usuarios autorizados que solicitan reembolso.</p>`
      + `<button class="split-btn" onclick="reembolsosActualizar()">🔄 Actualizar</button>`
      + (filas.length ? `<div style="overflow-x:auto"><table style="margin-top:10px"><thead><tr><th>Solicitante</th><th style="text-align:right">Gastos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`
        + filas.map(r => `<tr><td>${esc(r.ownerName || r.ownerEmail)}</td><td style="text-align:right">${(r.items || []).length}</td><td style="text-align:right">${dinero(total(r))}</td>`
          + `<td>${esc(r.signedName || "")}<br><small>${fechaHora(r.signedAt)}</small></td><td>${etiqueta(r.status)}${r.reviewComment ? "<br><small>" + esc(r.reviewComment) + "</small>" : ""}</td>`
          + `<td style="white-space:nowrap"><button class="split-btn" onclick="reembolsoAdmin('${q(r.id)}','pdf')">⬇️ PDF</button> <button class="split-btn" onclick="reembolsoAdmin('${q(r.id)}','xlsx')">⬇️ Excel</button>`
          + (r.status === "Enviado" ? ` <button class="split-btn" onclick="reembolsoRevisar('${q(r.id)}','Aceptado')">✅ Aceptar</button> <button class="split-btn" onclick="reembolsoRevisar('${q(r.id)}','Devuelto')">↩️ Devolver</button>` : "")
          + (r.status === "Aceptado" ? ` <button class="split-btn" onclick="reembolsoRevisar('${q(r.id)}','Pagado')">💵 Marcar pagado</button>` : "")
          + `</td></tr>`).join("") + `</tbody></table></div>` : "<p>Todavía no hay reembolsos enviados.</p>")
      + `<div id="reembolsoAdminAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }
  window.reembolsosActualizar = cargarAdmin;
  window.reembolsoAdmin = (id, tipo) => { const r = recibidos.find(x => x.id === id); if (r) descargar(r, tipo, t => { const el = document.getElementById("reembolsoAdminAviso"); if (el) el.textContent = t; }); };
  window.reembolsoRevisar = async function (id, status) {
    let comentario = "";
    if (status === "Devuelto") {
      comentario = prompt("Motivo para devolver el reembolso (el solicitante lo verá):");
      if (comentario === null) return;
      if (!comentario.trim()) { alert("Escribe el motivo."); return; }
    }
    if (status === "Pagado" && !confirm("¿Marcar este reembolso como pagado?")) return;
    try { await window.estadoReembolso(id, status, comentario.trim()); await cargarAdmin(); }
    catch (e) { console.error(e); alert("No se pudo actualizar. " + (e.code || e.message || "")); }
  };

  // Configuración: quién puede enviar reembolsos
  window.reembolsoPermiso = function (email, activo) {
    const lista2 = new Set((s.reimbursers || []).map(norm));
    if (activo) lista2.add(norm(email)); else lista2.delete(norm(email));
    s.reimbursers = [...lista2]; save(); render();
  };
  function configReembolsos() {
    if (!esAdmin()) return;
    const sec = document.getElementById("configuracion"); if (!sec) return;
    let box = document.getElementById("reembolsoConfigBox");
    if (!box) {
      box = document.createElement("div"); box.className = "box"; box.id = "reembolsoConfigBox";
      const ref = document.getElementById("bossManager");
      if (ref) ref.after(box); else sec.appendChild(box);
    }
    const personas = [];
    (s.bosses || []).forEach(b => { if (b.email) personas.push({ nombre: b.name, email: norm(b.email), tipo: "Jefe" }); });
    (s.userAccess || []).forEach(a => { if (a.email && a.enabled !== false && !personas.some(p => p.email === norm(a.email))) personas.push({ nombre: a.employee, email: norm(a.email), tipo: "Empleado" }); });
    (s.employees || []).forEach(e => { if (e.email && !personas.some(p => p.email === norm(e.email))) personas.push({ nombre: e.name, email: norm(e.email), tipo: "Empleado" }); });
    const activos = new Set((s.reimbursers || []).map(norm));
    box.innerHTML = `<h3>💵 Reembolsos</h3><p>Marca a las personas que pueden capturar y enviarte reembolsos de gastos pagados por ellas. Solo ellas verán la opción en su menú.</p>`
      + `<table><thead><tr><th>Persona</th><th>Correo</th><th>Tipo</th><th>Puede enviar reembolsos</th></tr></thead><tbody>`
      + (personas.map(p => `<tr><td>${esc(p.nombre)}</td><td>${esc(p.email)}</td><td>${p.tipo}</td><td><input type="checkbox" style="width:auto" ${activos.has(p.email) ? "checked" : ""} onchange="reembolsoPermiso('${q(p.email)}',this.checked)"></td></tr>`).join("")
        || '<tr><td colspan="4">Primero configura usuarios con correo de acceso.</td></tr>')
      + `</tbody></table>`;
  }

  // ---------- Página y menú ----------
  function asegurarPagina() {
    const main = document.querySelector("main");
    if (main && !document.getElementById("reembolsosPage")) {
      const sec = document.createElement("section"); sec.id = "reembolsosPage"; sec.className = "page";
      sec.innerHTML = '<h2>Mis reembolsos</h2><p>Captura los gastos que pagaste tú (sin tarjeta de la empresa), sube cada comprobante y envíalos firmados a Cuentas por Pagar.</p><div class="box" id="reembolsosBox"></div>';
      main.appendChild(sec);
    }
    const nav = document.querySelector("nav");
    let b = document.getElementById("navReembolsos");
    if (nav && !b) {
      b = document.createElement("button"); b.id = "navReembolsos"; b.innerHTML = "💵 Reembolsos";
      b.setAttribute("onclick", "showEmployeePage('reembolsosPage',this);renderReembolsos()");
      nav.appendChild(b);
    }
    if (b) b.style.display = puede() ? "block" : "none";
  }
  window.renderReembolsos = () => { if (puede() && !cargadoUsuario && window.firebaseAuth?.currentUser) { cargadoUsuario = true; cargarUsuario(); } else pintarUsuario(); };

  setInterval(() => {
    try {
      asegurarPagina();
      if (puede() && !cargadoUsuario && window.firebaseAuth?.currentUser) { cargadoUsuario = true; cargarUsuario(); }
      if (esAdmin() && document.getElementById("reportes") && !document.getElementById("reembolsosRecibidosBox")) {
        pintarAdmin();
        if (!cargadoAdmin && window.firebaseAuth?.currentUser) { cargadoAdmin = true; cargarAdmin(); }
      }
    } catch (e) { console.error("Reembolsos:", e); }
  }, 1000);

  const anterior = window.render || render;
  window.render = render = function () {
    anterior();
    try {
      asegurarPagina();
      if (esAdmin()) { pintarAdmin(); configReembolsos(); if (!cargadoAdmin && window.firebaseAuth?.currentUser) { cargadoAdmin = true; cargarAdmin(); } }
    } catch (e) { console.error("Reembolsos:", e); }
  };
})();
