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
  const esJefe = () => session()?.role === "Empleado" && !!session()?.isBoss;
  const CON_JEFE = "Por autorizar jefe";
  let delEquipo = [];
  let cargadoJefe = false;
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
  const hoyUs = () => { const d = new Date(); return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + "/" + d.getFullYear(); };
  const dividido = i => Array.isArray(i.centerSplits) && i.centerSplits.length > 0;
  const centrosDe = i => dividido(i) ? i.centerSplits.map(c => c.center).filter(Boolean).join(" + ") : (i.center || "");
  const sumaDivision = i => Math.round((i.centerSplits || []).reduce((t, c) => t + Number(c.amount || 0), 0) * 100) / 100;
  const etiqueta = (st, r) => st === CON_JEFE ? `<b style="color:#A9741F">⏳ Esperando autorización de ${esc((r && r.bossName) || "su jefe")}</b>` : ({
    Borrador: '<b style="color:#5F6E70">Borrador</b>', Enviado: '<b style="color:#A9741F">📨 Enviado, en revisión</b>',
    Aceptado: '<b style="color:#2F7A68">✅ Aceptado</b>', Pagado: '<b style="color:#1D3B45">💵 Pagado</b>', Devuelto: '<b style="color:#A13A3A">↩️ Devuelto</b>'
  })[st] || esc(st || "");

  // ---------- Formato del reporte (mismo diseño que el reporte mensual) ----------
  function codigoCuenta(nombre) { const a = (s.accounts || []).find(a => a.name === nombre); return a ? String(a.code || "") : ""; }
  function comoReporte(r) {
    const items = [...(r.items || [])].sort((a, b) => ordenFecha(a.date).localeCompare(ordenFecha(b.date)));
    const fechas = items.map(i => i.date).filter(Boolean);
    let fl = 0, tx = 0; items.forEach(i => centrosDe(i).split(" + ").forEach(c => { if (/\bFL\b/i.test(c)) fl++; if (/\bTX\b/i.test(c)) tx++; }));
    return {
      title: "Expense Reimbursement Request", fileTitle: "Reimbursement " + (r.name || ""),
      employee: r.ownerName || "", email: r.ownerEmail || "", supervisor: r.bossName || "", department: "",
      bossApprovedName: r.bossApprovedName || "", bossApprovedBy: r.bossApprovedBy || "", bossApprovedAt: r.bossApprovedAt || "",
      location: fl > tx ? "Florida" : tx > fl ? "Texas" : (fl ? "Florida / Texas" : ""), purpose: (r.name || "Reimbursement") + (r.requestDate ? " (requested " + r.requestDate + ")" : ""),
      period: "", from: fechas[0] || "", to: fechas[fechas.length - 1] || "",
      lines: items.map(i => ({ date: i.date, amount: Number(i.amount || 0), place: i.place || "", description: i.concept || "", accountCode: i.accountCode || codigoCuenta(i.account), centers: centrosDe(i), receiptPath: i.receiptPath || "" })),
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
    actual = { id: nuevoId(), ownerName: sess.name || "", name: "", requestDate: hoyUs(), status: "Borrador", createdAt: new Date().toISOString(), items: [{ id: nuevoId(), date: "", place: "", concept: "", account: "", center: "", amount: 0 }] };
    pintarUsuario();
  };
  window.reembolsoAbrir = id => { actual = lista.find(r => r.id === id) || null; pintarUsuario(); };
  window.reembolsoCerrar = async () => { try { await guardarAhora(); } catch (e) { console.error(e); } actual = null; pintarUsuario(); };
  // Guardar y volver a la lista, para terminarlo y enviarlo después.
  window.reembolsoGuardar = async function () {
    if (!actual) return;
    try {
      await guardarAhora();
      const nombre = actual.name || "Sin nombre";
      actual = null; pintarUsuario();
      const el = document.getElementById("reembolsoAviso");
      if (el) el.innerHTML = `<span style="color:#2F7A68">💾 Se guardó el reembolso <b>${esc(nombre)}</b>. Cuando esté listo, búscalo en la lista y da clic en <b>✍️ Firmar y enviar</b>.</span>`;
    } catch (e) { console.error(e); alert("No se pudo guardar. " + (e.code || e.message || "")); }
  };
  // Firmar y enviar directo desde la lista.
  window.reembolsoFirmarDesdeLista = function (id) {
    const r = lista.find(x => x.id === id); if (!r) return;
    actual = r; pintarUsuario(); window.reembolsoFirmar();
  };
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
    if (campo === "amount" && dividido(it)) pintarUsuario();
    const t = document.getElementById("reembolsoTotal"); if (t) t.textContent = dinero(total(actual));
    const t2 = document.getElementById("reembolsoTotalArriba"); if (t2) t2.textContent = dinero(total(actual));
    guardarLuego();
  };
  window.reembolsoEncabezado = function (campo, valor) {
    if (!actual) return;
    if (campo === "requestDate") actual.requestDate = isoAUs(valor);
    else actual[campo] = String(valor || "").trim();
    guardarLuego();
  };
  // ---------- Dividir un gasto entre varios centros de costos ----------
  const linea = id => actual && (actual.items || []).find(i => i.id === id);
  window.reembolsoDividir = function (id) {
    const it = linea(id); if (!it) return;
    // Antes de dividir, el gasto necesita su importe total.
    if (!(Number(it.amount) > 0)) {
      const v = prompt("¿Cuál es el importe total de este gasto (USD)?\nDespués lo repartes entre los centros de costos.");
      if (v === null) return;
      const n = Math.round(Number(String(v).replace(/[$,\s]/g, "")) * 100) / 100;
      if (!(n > 0)) { alert("Escribe un importe válido, por ejemplo 200.00"); return; }
      it.amount = n;
    }
    it.centerSplits = [{ center: it.center || "", amount: Number(it.amount || 0) }, { center: "", amount: 0 }];
    it.center = ""; pintarUsuario(); guardarLuego();
  };
  window.reembolsoSinDividir = function (id) {
    const it = linea(id); if (!it) return;
    it.center = (it.centerSplits || [])[0]?.center || ""; delete it.centerSplits; pintarUsuario(); guardarLuego();
  };
  window.reembolsoSplitAgregar = function (id) { const it = linea(id); if (!it) return; it.centerSplits.push({ center: "", amount: 0 }); pintarUsuario(); guardarLuego(); };
  window.reembolsoSplitQuitar = function (id, k) {
    const it = linea(id); if (!it) return;
    it.centerSplits.splice(k, 1);
    if (it.centerSplits.length < 2) { window.reembolsoSinDividir(id); return; }
    pintarUsuario(); guardarLuego();
  };
  window.reembolsoSplitCampo = function (id, k, campo, valor) {
    const it = linea(id); if (!it || !it.centerSplits[k]) return;
    it.centerSplits[k][campo] = campo === "amount" ? Math.round(Number(valor || 0) * 100) / 100 : valor;
    pintarUsuario(); guardarLuego();
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
    const f = [];
    if (!String(r.name || "").trim()) f.push("Escribe el nombre del reembolso.");
    if (!r.requestDate) f.push("Indica la fecha de solicitud.");
    if (!items.length) return f.concat(["Agrega al menos un gasto."]);
    items.forEach((i, k) => {
      const falta = [];
      if (!i.date) falta.push("fecha"); if (!i.place) falta.push("comercio"); if (!i.concept) falta.push("concepto");
      if (!i.account) falta.push("cuenta"); if (!(Number(i.amount) > 0)) falta.push("importe");
      if (dividido(i)) {
        if (i.centerSplits.some(c => !c.center)) falta.push("centro de costos en la división");
        if (i.centerSplits.some(c => !(Number(c.amount) > 0))) falta.push("importe en la división");
        if (Math.abs(sumaDivision(i) - Number(i.amount || 0)) > 0.005) falta.push("que la división sume exactamente " + dinero(i.amount));
      } else if (!i.center) falta.push("centro de costos");
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
      + `<p><b>${esc(actual.name)}</b><br>Fecha de solicitud: ${esc(actual.requestDate)}<br>${actual.items.length} gasto(s) · <b>USD ${dinero(total(actual))}</b></p>`
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
        const sj = session() || {};
        alert("Tu reembolso \"" + (datos.name || "") + "\" quedó firmado y enviado " + (sj.jefeEmail ? "a " + (sj.jefeNombre || "tu jefe") + " para su autorización. Cuando lo autorice, pasará a Cuentas por Pagar." : "a Cuentas por Pagar."));
      } catch (e) { console.error(e); mostrar("No se pudo enviar. " + (e.code || e.message || "")); boton.disabled = false; }
    };
    dlg.showModal();
  };

  function celdaCentro(i, ed, dis, centros, opc) {
    const txt = c => (c.code ? c.code + " - " : "") + c.name;
    if (!dividido(i)) {
      return `<div style="display:flex;gap:6px;align-items:center"><select ${dis} class="expense-select" onchange="reembolsoCampo('${q(i.id)}','center',this.value)">${opc(centros, i.center, txt)}</select>`
        + (ed ? `<button class="split-btn" title="Dividir entre varios centros" onclick="reembolsoDividir('${q(i.id)}')">✂️ Dividir</button>` : "") + `</div>`;
    }
    const sinImporte = !(Number(i.amount) > 0);
    const dif = Math.round((Number(i.amount || 0) - sumaDivision(i)) * 100) / 100;
    return i.centerSplits.map((c, k) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">`
        + `<select ${dis} class="expense-select" onchange="reembolsoSplitCampo('${q(i.id)}',${k},'center',this.value)">${opc(centros, c.center, txt)}</select>`
        + `<input type="number" step="0.01" min="0" ${dis} value="${c.amount || ""}" onchange="reembolsoSplitCampo('${q(i.id)}',${k},'amount',this.value)" style="width:90px;text-align:right">`
        + (ed ? `<button class="split-btn" title="Quitar centro" onclick="reembolsoSplitQuitar('${q(i.id)}',${k})">✕</button>` : "") + `</div>`).join("")
      + (sinImporte
        ? `<div style="font-size:12px;color:#A13A3A">Primero escribe el importe total del gasto en <b>Importe USD</b>.</div>`
        : `<div style="font-size:12px;${Math.abs(dif) > 0.005 ? "color:#A13A3A" : "color:#2F7A68"}">${dif > 0.005 ? "Falta distribuir: " + dinero(dif) : dif < -0.005 ? "La división se pasa por " + dinero(-dif) : "✓ La división cuadra"}</div>`)
      + (ed ? `<div style="display:flex;gap:6px;margin-top:4px"><button class="split-btn" onclick="reembolsoSplitAgregar('${q(i.id)}')">+ Centro</button><button class="split-btn" onclick="reembolsoSinDividir('${q(i.id)}')">Quitar división</button></div>` : "");
  }

  function pintarUsuario() {
    const box = document.getElementById("reembolsosBox");
    if (!box || !puede()) return;
    if (!actual) {
      const filas = [...lista].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      box.innerHTML = `<button class="primary" style="width:auto;display:inline-block" onclick="reembolsoNuevo()">+ Nuevo reembolso</button>`
        + (filas.length ? `<div style="overflow-x:auto"><table style="margin-top:14px"><thead><tr><th>Reembolso</th><th>Fecha de solicitud</th><th style="text-align:right">Gastos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`
          + filas.map(r => `<tr><td><b>${esc(r.name || "Sin nombre")}</b></td><td>${esc(r.requestDate || fechaHora(r.createdAt))}</td><td style="text-align:right">${(r.items || []).length}</td><td style="text-align:right">${dinero(total(r))}</td>`
            + `<td>${esc(r.signedName || "")}<br><small>${fechaHora(r.signedAt)}</small></td><td>${etiqueta(r.status, r)}${r.status === "Devuelto" && r.reviewComment ? "<br><small>" + esc(r.reviewComment) + "</small>" : ""}</td>`
            + `<td style="white-space:nowrap">${editable(r) ? `<button class="split-btn" onclick="reembolsoAbrir('${q(r.id)}')">✏️ Abrir</button> ` : `<button class="split-btn" onclick="reembolsoAbrir('${q(r.id)}')">👁️ Ver</button> `}`
            + `<button class="split-btn" onclick="reembolsoDescargar('${q(r.id)}','pdf')">⬇️ PDF</button>`
            + (editable(r) ? ` <button class="primary" style="width:auto;display:inline-block" onclick="reembolsoFirmarDesdeLista('${q(r.id)}')">✍️ Firmar y enviar</button>` : "")
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
      + `<span>${etiqueta(actual.status, actual)}</span>${actual.status === "Devuelto" && actual.reviewComment ? `<span style="color:#A13A3A">Motivo: ${esc(actual.reviewComment)}</span>` : ""}</div>`
      + `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">`
      + `<label style="flex:1 1 280px"><b>Nombre del reembolso</b><br><input ${dis} value="${esc(actual.name || "")}" placeholder="Ej. Viaje a Monterrey, comida con cliente..." onchange="reembolsoEncabezado('name',this.value)" style="width:100%;box-sizing:border-box"></label>`
      + `<label><b>Fecha de solicitud</b><br><input type="date" ${dis} value="${usAIso(actual.requestDate)}" onchange="reembolsoEncabezado('requestDate',this.value)" style="width:160px"></label>`
      + `<div><b>Monto total</b><br><span style="font-size:20px">USD <span id="reembolsoTotalArriba">${dinero(total(actual))}</span></span></div></div>`
      + `<div style="overflow-x:auto"><table style="margin-top:14px"><thead><tr><th>Fecha</th><th>Comercio</th><th>Concepto</th><th>Cuenta de gasto</th><th>Centro de costos</th><th style="text-align:right">Importe USD</th><th>Comprobante</th><th></th></tr></thead><tbody>`
      + actual.items.map(i => `<tr>`
        + `<td><input type="date" ${dis} value="${usAIso(i.date)}" onchange="reembolsoCampo('${q(i.id)}','date',this.value)" style="width:140px"></td>`
        + `<td><input ${dis} value="${esc(i.place || "")}" placeholder="Comercio" onchange="reembolsoCampo('${q(i.id)}','place',this.value)" style="min-width:150px"></td>`
        + `<td><input ${dis} value="${esc(i.concept || "")}" placeholder="Concepto" onchange="reembolsoCampo('${q(i.id)}','concept',this.value)" style="min-width:180px"></td>`
        + `<td><select ${dis} class="expense-select" onchange="reembolsoCampo('${q(i.id)}','account',this.value)">${opc(cuentas, i.account, a => (a.code ? a.code + " - " : "") + a.name)}</select></td>`
        + `<td>${celdaCentro(i, ed, dis, centros, opc)}</td>`
        + `<td><input type="number" step="0.01" min="0" ${dis} value="${i.amount || ""}" onchange="reembolsoCampo('${q(i.id)}','amount',this.value)" style="width:110px;text-align:right${dividido(i) && !(Number(i.amount) > 0) ? ";border:2px solid #A13A3A" : ""}" placeholder="${dividido(i) ? "Importe total" : ""}"></td>`
        + `<td style="white-space:nowrap">${i.receiptPath ? `<button class="split-btn" onclick="reembolsoVerPdf('${q(i.receiptPath)}')">👁️ Ver PDF</button> ` : ""}`
        + (ed ? `<label class="split-btn" style="display:inline-block">${i.receiptPath ? "🔄 Reemplazar" : "📎 Subir PDF"}<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="reembolsoSubir('${q(i.id)}',this)"></label>` : "") + `</td>`
        + `<td>${ed ? `<button class="split-btn" title="Quitar" onclick="reembolsoQuitarLinea('${q(i.id)}')">🗑️</button>` : ""}</td></tr>`).join("")
      + `<tr style="background:#eef2f7"><td colspan="5"><b>Total</b></td><td style="text-align:right"><b id="reembolsoTotal">${dinero(total(actual))}</b></td><td colspan="2"></td></tr></tbody></table></div>`
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">`
      + (ed ? `<button class="split-btn" onclick="reembolsoAgregar()">+ Agregar gasto</button>` : "")
      + (ed ? `<button class="split-btn" onclick="reembolsoGuardar()">💾 Guardar y terminar después</button>` : "")
      + `<button class="split-btn" onclick="reembolsoDescargar('${q(actual.id)}','pdf')">⬇️ PDF con comprobantes</button>`
      + (ed ? `<button class="primary" style="width:auto;display:inline-block" onclick="reembolsoFirmar()">✍️ Firmar y enviar</button>` : "")
      + `</div><p style="font-size:12px;color:#5F6E70">${ed ? "Los cambios se guardan solos como borrador. Puedes guardarlo y terminarlo después: lo encontrarás en Mis reembolsos." : "Este reembolso ya se envió; solo es de consulta."}</p>`
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
      + `<p>Gastos pagados por los usuarios que solicitan reembolso. Los de empleados con jefe asignado llegan aquí para revisión cuando el jefe los autoriza.</p>`
      + `<button class="split-btn" onclick="reembolsosActualizar()">🔄 Actualizar</button>`
      + (filas.length ? `<div style="overflow-x:auto"><table style="margin-top:10px"><thead><tr><th>Solicitante</th><th>Reembolso</th><th>Fecha de solicitud</th><th style="text-align:right">Gastos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`
        + filas.map(r => `<tr><td>${esc(r.ownerName || r.ownerEmail)}</td><td><b>${esc(r.name || "Sin nombre")}</b></td><td>${esc(r.requestDate || "")}</td><td style="text-align:right">${(r.items || []).length}</td><td style="text-align:right">${dinero(total(r))}</td>`
          + `<td>${esc(r.signedName || "")}<br><small>${fechaHora(r.signedAt)}</small></td><td>${etiqueta(r.status, r)}${r.bossApprovedName ? `<br><small style="color:#2F7A68">✔ Autorizó ${esc(r.bossApprovedName)} · ${fechaHora(r.bossApprovedAt)}</small>` : ""}${r.reviewComment ? "<br><small>" + (r.reviewedByName ? esc(r.reviewedByName) + ": " : "") + esc(r.reviewComment) + "</small>" : ""}</td>`
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

  // ---------- Jefe: reembolsos de su equipo por autorizar ----------
  async function cargarJefe() {
    try { delEquipo = window.reembolsosPorAutorizar ? await window.reembolsosPorAutorizar() : []; } catch (e) { console.error(e); delEquipo = []; }
    pintarJefe();
  }
  function pintarJefe() {
    if (!esJefe()) return;
    const sec = document.getElementById("autorizaciones"); if (!sec) return;
    let box = document.getElementById("reembolsosJefeBox");
    if (!box) {
      box = document.createElement("div"); box.className = "box"; box.id = "reembolsosJefeBox";
      const ref = document.getElementById("reportesJefeBox") || document.getElementById("approvals");
      if (ref && ref.id === "reportesJefeBox") ref.after(box); else if (ref) ref.before(box); else sec.appendChild(box);
    }
    const filas = [...delEquipo].sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
    const pend = filas.filter(r => r.status === CON_JEFE), hist = filas.filter(r => r.status !== CON_JEFE);
    const desc = r => `<button class="split-btn" onclick="reembolsoJefeDescargar('${q(r.id)}','pdf')">⬇️ PDF</button> <button class="split-btn" onclick="reembolsoJefeDescargar('${q(r.id)}','xlsx')">⬇️ Excel</button>`;
    const estado = r => r.status === "Devuelto" ? '<b style="color:#A13A3A">↩️ Devuelto</b>' + (r.reviewComment ? "<br><small>" + esc(r.reviewComment) + "</small>" : "")
      : r.status === "Aceptado" || r.status === "Pagado" ? etiqueta(r.status, r)
      : '<b style="color:#2F7A68">✔ Autorizado</b>' + (r.bossApprovedAt ? "<br><small>" + fechaHora(r.bossApprovedAt) + "</small>" : "");
    box.innerHTML = `<h3>💵 Reembolsos por autorizar ${pend.length ? `(${pend.length})` : ""}</h3>`
      + `<p>Reembolsos firmados por tu equipo. Revisa el PDF (incluye los comprobantes) y autorízalo para que pase a Cuentas por Pagar, o devuélvelo con un comentario.</p>`
      + `<button class="split-btn" onclick="reembolsosJefeActualizar()">🔄 Actualizar</button>`
      + (pend.length ? `<div style="overflow-x:auto"><table style="margin-top:10px"><thead><tr><th>Empleado</th><th>Reembolso</th><th>Fecha de solicitud</th><th style="text-align:right">Gastos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Acciones</th></tr></thead><tbody>`
        + pend.map(r => `<tr><td>${esc(r.ownerName || r.ownerEmail)}</td><td><b>${esc(r.name || "Sin nombre")}</b></td><td>${esc(r.requestDate || "")}</td><td style="text-align:right">${(r.items || []).length}</td><td style="text-align:right">${dinero(total(r))}</td>`
          + `<td>${esc(r.signedName || "")}<br><small>${fechaHora(r.signedAt)}</small></td>`
          + `<td style="white-space:nowrap">${desc(r)} <button class="primary" style="display:inline-block;width:auto" onclick="reembolsoJefeDecidir('${q(r.id)}',true)">✅ Autorizar</button> <button class="split-btn" onclick="reembolsoJefeDecidir('${q(r.id)}',false)">↩️ Devolver</button></td></tr>`).join("")
        + `</tbody></table></div>` : `<p style="margin-top:10px"><b>No tienes reembolsos pendientes de autorizar.</b></p>`)
      + (hist.length ? `<h4 style="margin-top:20px">Historial</h4><div style="overflow-x:auto"><table><thead><tr><th>Empleado</th><th>Reembolso</th><th style="text-align:right">Total USD</th><th>Estado</th><th>Descargar</th></tr></thead><tbody>`
        + hist.map(r => `<tr><td>${esc(r.ownerName || r.ownerEmail)}</td><td>${esc(r.name || "Sin nombre")}</td><td style="text-align:right">${dinero(total(r))}</td><td>${estado(r)}</td><td style="white-space:nowrap">${desc(r)}</td></tr>`).join("")
        + `</tbody></table></div>` : "")
      + `<div id="reembolsoJefeAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }
  window.reembolsosJefeActualizar = cargarJefe;
  window.reembolsoJefeDescargar = (id, tipo) => { const r = delEquipo.find(x => x.id === id); if (r) descargar(r, tipo, t => { const el = document.getElementById("reembolsoJefeAviso"); if (el) el.textContent = t; }); };
  window.reembolsoJefeDecidir = async function (id, autorizar) {
    const r = delEquipo.find(x => x.id === id); if (!r) return;
    let comentario = "";
    if (autorizar) {
      if (!confirm("¿Autorizar el reembolso \"" + (r.name || "") + "\" de " + (r.ownerName || r.ownerEmail) + " por USD " + dinero(total(r)) + "?\n\nPasará a Cuentas por Pagar con tu autorización.")) return;
    } else {
      comentario = prompt("Motivo para devolver el reembolso a " + (r.ownerName || r.ownerEmail) + " (lo verá el empleado):");
      if (comentario === null) return;
      if (!comentario.trim()) { alert("Escribe el motivo."); return; }
    }
    try { await window.decidirReembolsoJefe(id, autorizar, comentario.trim()); await cargarJefe(); }
    catch (e) { console.error(e); alert("No se pudo guardar. " + (e.code || e.message || "")); }
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
      if (esJefe() && document.getElementById("autorizaciones") && !document.getElementById("reembolsosJefeBox")) {
        pintarJefe();
        if (!cargadoJefe && window.firebaseAuth?.currentUser) { cargadoJefe = true; cargarJefe(); }
      }
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
      if (esJefe()) { pintarJefe(); if (!cargadoJefe && window.firebaseAuth?.currentUser) { cargadoJefe = true; cargarJefe(); } }
      if (esAdmin()) { pintarAdmin(); configReembolsos(); if (!cargadoAdmin && window.firebaseAuth?.currentUser) { cargadoAdmin = true; cargarAdmin(); } }
    } catch (e) { console.error("Reembolsos:", e); }
  };
})();
