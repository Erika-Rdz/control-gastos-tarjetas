// Vista para celular y fotos de comprobantes.
//  • En el celular, "Mis gastos" del empleado se muestra como tarjetas (una por gasto).
//    En la computadora todo se ve igual que siempre.
//  • Los comprobantes se pueden subir como foto (cámara o galería) o PDF.
//    La foto se convierte sola a PDF antes de guardarse, así todo lo demás sigue igual.
//  • Registra la app para poder "Agregar a pantalla de inicio".
(function () {
  const PDF_LIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  const esMovil = () => window.matchMedia("(max-width: 760px)").matches;
  function session() { try { return JSON.parse(sessionStorage.getItem("controlGastosSession") || "null"); } catch (e) { return null; } }
  const esEmpleado = () => session()?.role === "Empleado" && !!session()?.employee;
  const q = v => String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const dinero = n => (typeof money === "function" ? money(n) : "$" + Number(n || 0).toFixed(2));

  // ---------- Estilos ----------
  const css = document.createElement("style");
  css.textContent = `
  @media (max-width:760px){
    header.topbar{flex-wrap:wrap;padding:12px 14px}
    .user-area{flex-wrap:wrap;font-size:13px}
    nav{position:sticky;top:0;z-index:5;gap:4px;padding:8px;border-right:0;border-bottom:1px solid var(--linea,#ddd)}
    nav button{white-space:nowrap;width:auto;padding:10px 12px}
    main{padding:12px}
    input,select,textarea{font-size:16px}
    .box{padding:14px}
  }
  body.vc-activo .vc-tabla, body.vc-activo #hojaToggle{display:none !important}
  #vcTarjetas{display:flex;flex-direction:column;gap:12px;margin-top:12px}
  .vc-card{background:#fff;border:1px solid var(--linea,#D9E2E0);border-radius:14px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .vc-card.vc-cerrada{opacity:.75}
  .vc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .vc-comercio{font-weight:600;font-size:16px;color:var(--pizarra,#1D3B45)}
  .vc-fecha{font-size:13px;color:var(--texto-2,#5F6E70);margin-top:2px}
  .vc-monto{font-size:20px;font-weight:700;white-space:nowrap;color:var(--pizarra,#1D3B45)}
  .vc-estado{display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .vc-ok{background:#E6F1EE;color:#2F7A68}.vc-pend{background:#FFF4E5;color:#A9741F}.vc-mal{background:#FDECEC;color:#A13A3A}
  .vc-campo{margin-top:12px}
  .vc-campo > label{display:block;font-size:13px;font-weight:600;color:var(--texto-2,#5F6E70);margin-bottom:4px}
  .vc-campo input,.vc-campo select{width:100%;box-sizing:border-box;padding:11px}
  .vc-falta{border-color:#d97706 !important;background:#fff7ed !important}
  .vc-foto{display:block;text-align:center;padding:14px;border-radius:10px;background:var(--pizarra,#1D3B45);color:#fff;font-weight:600;font-size:16px;cursor:pointer}
  .vc-botones{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .vc-btn{display:inline-block;padding:10px 12px;border:1px solid #94a3b8;background:#fff;border-radius:8px;font-size:14px;cursor:pointer;text-align:center}
  .vc-btn.vc-ancho{flex:1}
  .vc-recibo{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:10px;border-radius:10px;background:#E6F1EE;color:#2F7A68;font-weight:600}
  .vc-split{border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#f8fafc}
  .vc-split-fila{display:flex;gap:6px;margin-bottom:8px}
  .vc-split-fila select{flex:1;min-width:0}
  .vc-split-fila input{width:95px;text-align:right}
  .vc-nota{font-size:13px;margin-top:6px}
  .vc-cerrado{margin-top:10px;font-size:13px;color:#5F6E70}
  .vc-vacio{padding:20px;text-align:center;color:#5F6E70;background:#fff;border-radius:12px;border:1px solid var(--linea,#D9E2E0)}
  #vcAviso{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1D3B45;color:#fff;padding:12px 18px;border-radius:10px;z-index:9999;font-size:15px;display:none;box-shadow:0 6px 20px rgba(0,0,0,.25)}
  `;
  document.head.appendChild(css);

  function aviso(texto) {
    let el = document.getElementById("vcAviso");
    if (!el) { el = document.createElement("div"); el.id = "vcAviso"; document.body.appendChild(el); }
    el.textContent = texto || ""; el.style.display = texto ? "block" : "none";
  }

  // ---------- Foto → PDF ----------
  function cargarPdfLib() {
    if (window.PDFLib) return Promise.resolve();
    return new Promise((ok, mal) => {
      const sc = document.createElement("script");
      sc.src = PDF_LIB; sc.onload = ok;
      sc.onerror = () => mal(new Error("No se pudo cargar el convertidor de PDF. Revisa tu conexión."));
      document.head.appendChild(sc);
    });
  }
  const esImagen = f => /^image\//i.test(f.type || "") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || "");

  async function fotoComoJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, mal) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => mal(new Error("No se pudo leer la foto. Intenta tomarla de nuevo con la cámara, o súbela como JPG o PDF."));
        im.src = url;
      });
      const max = 1800, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
    } finally { URL.revokeObjectURL(url); }
  }

  // Convierte una foto en un PDF de una página (tamaño carta). Si ya es PDF, lo regresa igual.
  window.comprobanteComoPdf = async function (file) {
    if (!file || !esImagen(file)) return file;
    await cargarPdfLib();
    const { bytes, w, h } = await fotoComoJpeg(file);
    const doc = await window.PDFLib.PDFDocument.create();
    const jpg = await doc.embedJpg(bytes);
    const horizontal = w > h, PW = horizontal ? 792 : 612, PH = horizontal ? 612 : 792, M = 24;
    const k = Math.min((PW - 2 * M) / w, (PH - 2 * M) / h);
    const pag = doc.addPage([PW, PH]);
    pag.drawImage(jpg, { x: (PW - w * k) / 2, y: (PH - h * k) / 2, width: w * k, height: h * k });
    const salida = await doc.save();
    const nombre = String(file.name || "ticket").replace(/\.[^.]+$/, "") + ".pdf";
    return new File([salida], nombre, { type: "application/pdf" });
  };

  // Envuelve las funciones que suben comprobantes para que acepten fotos.
  function conFotos(nombre) {
    const original = window[nombre];
    if (typeof original !== "function" || original._conFotos) return;
    const nueva = async function (a, input) {
      const f = input && input.files && input.files[0];
      if (!f || !esImagen(f)) return original(a, input);
      let pdf;
      try { aviso("📷 Preparando la foto..."); pdf = await window.comprobanteComoPdf(f); }
      catch (e) { console.error(e); aviso(""); alert(e.message || "No se pudo convertir la foto."); if (input) input.value = ""; return; }
      aviso("⬆️ Subiendo comprobante...");
      const falso = { files: [pdf], value: "", disabled: false };
      try { return await original(a, falso); }
      finally { aviso(""); try { if (input) input.value = ""; } catch (e) {} }
    };
    nueva._conFotos = true;
    window[nombre] = nueva;
  }
  function botonesConFotos() {
    const celda = window.receiptCell;
    if (typeof celda === "function" && !celda._conFotos) {
      const nueva = function (x, i) {
        return String(celda(x, i))
          .split('accept="application/pdf,.pdf"').join('accept="application/pdf,.pdf,image/*"')
          .split("📎 Subir PDF").join("📷 Foto / PDF");
      };
      nueva._conFotos = true;
      window.receiptCell = nueva;
    }
  }

  // ---------- Tarjetas de "Mis gastos" en el celular ----------
  const estadoDe = x => (window.expenseStatus || expenseStatus)(x);
  const claseEstado = st => st === "Completo" ? "vc-ok" : /Rechaz/i.test(st) ? "vc-mal" : "vc-pend";
  let pendiente = false;

  function seccionRecibo(x, i, dis) {
    const subir = (texto, accept, capture, clase) => `<label class="${clase}">${texto}<input type="file" accept="${accept}" ${capture ? 'capture="environment"' : ""} style="display:none" ${dis} onchange="uploadReceipt(${i},this)"></label>`;
    if (x.receiptPath) {
      return `<div class="vc-recibo"><span>✅ Comprobante cargado</span><span class="vc-botones" style="margin:0">`
        + `<button type="button" class="vc-btn" onclick="viewReceipt(${i})">👁️ Ver</button>`
        + (dis ? "" : subir("🔄 Cambiar", "image/*,application/pdf,.pdf", false, "vc-btn")) + `</span></div>`;
    }
    if (dis) return `<div class="vc-nota">Sin comprobante.</div>`;
    return subir("📷 Tomar foto del ticket", "image/*", true, "vc-foto")
      + `<div class="vc-botones">${subir("🖼️ Elegir foto o PDF", "image/*,application/pdf,.pdf", false, "vc-btn vc-ancho")}</div>`;
  }

  function seccionBebidas(x, dis) {
    if (!(window.requiereBebidas && window.requiereBebidas(x))) return "";
    const ops = ["Cliente", "Personal", "No aplica"].map(o => `<option value="${o}" ${x.alcohol === o ? "selected" : ""}>${o}</option>`).join("");
    let nota = "";
    if (x.alcohol === "Personal") {
      if (x.authStatus === "Autorizada") nota = `<div class="vc-nota" style="color:#2F7A68">✅ Autorizado por ${esc(x.authByName || x.authBy || "el jefe")}</div>`;
      else if (x.authStatus === "Solicitada") nota = `<div class="vc-nota" style="color:#A9741F">⏳ Esperando autorización de ${esc(x.bossName || "tu jefe")}</div>`;
      else nota = (x.authStatus === "Rechazada" ? `<div class="vc-nota" style="color:#A13A3A">❌ Rechazado por el jefe${x.authComment ? ": " + esc(x.authComment) : ""}</div>` : "")
        + (dis ? "" : `<div class="vc-botones"><button type="button" class="vc-btn vc-ancho" onclick="bebidasSolicitar('${q(x.id)}')">📨 Pedir autorización a ${esc(x.bossName || "mi jefe")}</button></div>`);
    }
    return `<div class="vc-campo"><label>🍷 Bebidas alcohólicas</label><select ${dis} class="${x.alcohol ? "" : "vc-falta"}" onchange="bebidasCambiar('${q(x.id)}',this.value)"><option value="">Seleccionar...</option>${ops}</select>${nota}</div>`;
  }

  function seccionCentro(x, i, dis) {
    const dividido = Array.isArray(x.centerSplits) && x.centerSplits.length > 0;
    if (x._splitOpen && !dis) {
      const filas = x._editingSplits || [];
      const suma = filas.reduce((a, p) => a + Number(p.amount || 0), 0);
      return `<div class="vc-campo"><label>Centro de costos (dividido)</label><div class="vc-split">`
        + filas.map((p, j) => `<div class="vc-split-fila"><select onchange="employeeSplitValue(${i},${j},'center',this.value)">${centerOptions(p.center)}</select>`
          + `<input type="number" inputmode="decimal" step="0.01" value="${esc(p.amount)}" placeholder="0.00" oninput="employeeSplitValue(${i},${j},'amount',this.value);vcSuma(${i})">`
          + `<button type="button" class="vc-btn" onclick="employeeRemoveSplitRow(${i},${j})">✕</button></div>`).join("")
        + `<button type="button" class="vc-btn" onclick="employeeAddSplitRow(${i})">+ Otro centro</button>`
        + `<div class="vc-nota"><b>Distribuido:</b> <span id="vcSuma${i}">${dinero(suma)}</span> de ${dinero(x.amount)}</div>`
        + `<div class="vc-botones"><button type="button" class="primary vc-ancho" onclick="employeeSaveSplits(${i})">Guardar división</button><button type="button" class="vc-btn" onclick="employeeCancelSplits(${i})">Cancelar</button></div>`
        + `</div></div>`;
    }
    if (dividido) {
      return `<div class="vc-campo"><label>Centro de costos (dividido)</label>`
        + `<div class="vc-split">${x.centerSplits.map(p => `<div>${esc(p.center)} — <b>${dinero(p.amount)}</b></div>`).join("")}</div>`
        + (dis ? "" : `<div class="vc-botones"><button type="button" class="vc-btn" onclick="employeeOpenSplits(${i})">✂️ Cambiar división</button></div>`) + `</div>`;
    }
    return `<div class="vc-campo"><label>Centro de costos</label><select ${dis} class="${x.center ? "" : "vc-falta"}" onchange="employeeUpdateField(${i},'center',this.value)">${centerOptions(x.center)}</select>`
      + (dis ? "" : `<div class="vc-botones"><button type="button" class="vc-btn" onclick="employeeOpenSplits(${i})">✂️ Dividir entre centros</button></div>`) + `</div>`;
  }

  function tarjeta(o) {
    const { x, i, cerrado } = o, dis = cerrado ? "disabled" : "", st = estadoDe(x);
    return `<div class="vc-card ${cerrado ? "vc-cerrada" : ""}">`
      + `<div class="vc-top"><div><div class="vc-comercio">${esc(x.supplier || x.merchant || "Sin comercio")}</div><div class="vc-fecha">${esc(x.date || "")}</div></div><div class="vc-monto">${dinero(x.amount)}</div></div>`
      + `<span class="vc-estado ${claseEstado(st)}">${esc(st)}</span>`
      + `<div class="vc-campo"><label>Comprobante</label>${seccionRecibo(x, i, dis)}</div>`
      + `<div class="vc-campo"><label>Concepto</label><input ${dis} class="${x.concept ? "" : "vc-falta"}" value="${esc(x.concept || "")}" placeholder="¿Para qué fue el gasto?" onchange="employeeUpdateField(${i},'concept',this.value)"></div>`
      + `<div class="vc-campo"><label>Cuenta de gasto</label><select ${dis} class="${x.account ? "" : "vc-falta"}" onchange="employeeUpdateField(${i},'account',this.value)">${accountOptions(x.account)}</select></div>`
      + seccionBebidas(x, dis)
      + seccionCentro(x, i, dis)
      + (cerrado ? `<div class="vc-cerrado">🔒 Este mes ya se envió firmado; no se puede modificar.</div>` : "")
      + `</div>`;
  }

  window.vcSuma = function (i) {
    const x = (s.expenses || [])[i], el = document.getElementById("vcSuma" + i);
    if (x && el) el.textContent = dinero((x._editingSplits || []).reduce((a, p) => a + Number(p.amount || 0), 0));
  };

  function pintarTarjetas() {
    const body = document.getElementById("expenses");
    const activo = !!(esEmpleado() && esMovil() && body);
    document.body.classList.toggle("vc-activo", activo);
    let cont = document.getElementById("vcTarjetas");
    if (!activo) { if (cont) cont.style.display = "none"; return; }
    const tabla = body.closest("table");
    const contenedor = (tabla && tabla.closest(".box")) || tabla;
    if (!contenedor) return;
    contenedor.classList.add("vc-tabla");
    if (!cont) { cont = document.createElement("div"); cont.id = "vcTarjetas"; contenedor.before(cont); }
    cont.style.display = "";
    // No repintar mientras la persona escribe, para no perder lo que está capturando.
    const foco = document.activeElement;
    if (foco && cont.contains(foco) && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) { pendiente = true; return; }
    pendiente = false;
    const filas = [...body.children];
    const items = (s.expenses || []).map((x, i) => ({ x, i, tr: filas[i] }))
      .filter(o => o.tr && o.tr.children.length > 1 && o.tr.style.display !== "none")
      .map(o => ({ ...o, cerrado: !!o.tr.querySelector("input[disabled],select[disabled]") }));
    cont.innerHTML = items.length ? items.map(tarjeta).join("") : `<div class="vc-vacio">No tienes gastos en este mes.</div>`;
  }

  let timer = null;
  const programar = () => { clearTimeout(timer); timer = setTimeout(() => { try { pintarTarjetas(); } catch (e) { console.error("Vista celular:", e); } }, 60); };
  document.addEventListener("focusout", e => { if (pendiente && e.target.closest && e.target.closest("#vcTarjetas")) setTimeout(programar, 150); });
  window.addEventListener("resize", programar);

  function vigilar() {
    const body = document.getElementById("expenses");
    if (!body || body._vcVigilado) return;
    body._vcVigilado = true;
    new MutationObserver(programar).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "style"] });
  }

  setInterval(() => {
    try {
      botonesConFotos();
      conFotos("uploadReceipt");
      conFotos("reembolsoSubir");
      vigilar();
      if (esEmpleado() && esMovil() && !document.getElementById("vcTarjetas")) programar();
    } catch (e) { console.error("Vista celular:", e); }
  }, 1000);

  const anterior = window.render || render;
  window.render = render = function () { anterior(); try { botonesConFotos(); programar(); } catch (e) { console.error(e); } };

  // ---------- App instalable ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(e => console.warn("App:", e)); });
  }
})();
