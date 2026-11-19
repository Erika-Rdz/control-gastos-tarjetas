// Reporte mensual de tarjeta de crédito (Monthly Credit Card Report).
// Empleado: descarga su reporte en Excel o PDF, lo firma electrónicamente y lo envía.
// Administradora: recibe los reportes en el sistema y descarga un solo PDF con el reporte y todos los comprobantes.
// El PDF se arma al momento de descargarlo con los comprobantes que ya están guardados: no se guarda ningún archivo extra.
(function () {
  const LIBS = {
    exceljs: "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
    pdflib: "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"
  };
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const PIZARRA = [0x1D, 0x3B, 0x45];
  let mesElegido = "";
  let misEnvios = [];
  let recibidos = [];
  let cargado = false;
  let delEquipo = [];
  let cargadoJefe = false;
  const CON_JEFE = "Por autorizar jefe";

  // ---------- Utilidades ----------
  function session() { try { return JSON.parse(sessionStorage.getItem("controlGastosSession") || "null"); } catch (e) { return null; } }
  const esEmpleado = () => session()?.role === "Empleado" && !!session()?.employee;
  const esAdmin = () => session()?.role === "Administrador";
  const esJefe = () => session()?.role === "Empleado" && !!session()?.isBoss;
  const q = v => String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  function cargarScript(url) {
    return new Promise((ok, mal) => {
      if (document.querySelector(`script[src="${url}"]`)) {
        const esperar = () => (url.includes("exceljs") ? window.ExcelJS : window.PDFLib) ? ok() : setTimeout(esperar, 100);
        return esperar();
      }
      const sc = document.createElement("script");
      sc.src = url; sc.onload = () => ok(); sc.onerror = () => mal(new Error("No se pudo cargar " + url));
      document.head.appendChild(sc);
    });
  }

  // Mes según la Posting Date del estado de cuenta (si no la tiene, usa la Tran Date).
  function periodo(x) {
    const t = String(x.postingDate || x.date || "").trim();
    let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + "-" + m[1].padStart(2, "0");
    m = t.match(/^(\d{4})-(\d{1,2})/);
    if (m) return m[1] + "-" + m[2].padStart(2, "0");
    return "";
  }
  const etiquetaMes = p => { const [y, m] = p.split("-"); return (MESES[Number(m) - 1] || m) + " " + y; };
  function fechaOrden(d) {
    const m = String(d || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? m[3] + m[1].padStart(2, "0") + m[2].padStart(2, "0") : String(d || "");
  }
  function ultimoDia(p) { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  const mmddyyyy = (p, d) => { const [y, m] = p.split("-"); return m + "/" + String(d).padStart(2, "0") + "/" + y; };
  const dinero = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fechaHora(iso) { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString("es-MX") + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }

  function codigoCuenta(nombre) { const a = (s.accounts || []).find(a => a.name === nombre); return a ? String(a.code || "") : ""; }
  function ubicacion(lineas) {
    let fl = 0, tx = 0;
    lineas.forEach(l => (l.centers || "").split(" + ").forEach(c => { if (/\bFL\b/i.test(c)) fl++; if (/\bTX\b/i.test(c)) tx++; }));
    return fl > tx ? "Florida" : tx > fl ? "Texas" : (fl ? "Florida / Texas" : "");
  }

  // Arma los datos del reporte a partir de los gastos del mes.
  function armarReporte(p) {
    const sess = session() || {};
    const gastos = (s.expenses || []).filter(x => periodo(x) === p).sort((a, b) => fechaOrden(a.date).localeCompare(fechaOrden(b.date)));
    const lineas = gastos.map(x => ({
      id: x.id || x._firestoreId || "",
      date: x.date || "",
      amount: Number(x.amount || 0),
      place: x.supplier || x.merchant || "",
      description: x.concept || "",
      accountCode: codigoCuenta(x.account),
      accountName: x.account || "",
      centers: (x.centerSplits && x.centerSplits.length) ? x.centerSplits.map(c => c.center).join(" + ") : (x.center || ""),
      receiptPath: x.receiptPath || "",
      status: expenseStatus(x)
    }));
    return {
      period: p,
      from: mmddyyyy(p, 1),
      to: mmddyyyy(p, ultimoDia(p)),
      employee: sess.employee || sess.name || "",
      email: sess.user || "",
      supervisor: (gastos.find(x => x.bossName) || {}).bossName || "",
      department: sess.dept || "",
      location: ubicacion(lineas),
      purpose: "All",
      lines: lineas,
      count: lineas.length,
      total: Math.round(lineas.reduce((t, l) => t + l.amount, 0) * 100) / 100
    };
  }

  function revisar(rep) {
    const sinClasificar = rep.lines.filter(l => l.status === "Pendiente de clasificar").length;
    const autorizacion = rep.lines.filter(l => /autorizaci|Rechazado/i.test(l.status)).length;
    const sinPdf = rep.lines.filter(l => !l.receiptPath && l.amount > 0).length;
    return { sinClasificar, autorizacion, sinPdf, bloquea: sinClasificar > 0 || autorizacion > 0 };
  }

  async function logo() {
    try { const r = await fetch("logo.jpg"); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); } catch (e) { return null; }
  }
  function nombreArchivo(rep, ext) {
    return ((rep.fileTitle || "Credit Card Report") + " " + rep.employee + " " + rep.period).replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_") + "." + ext;
  }
  function descargar(bytes, nombre, tipo) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function aFecha(d) {
    const m = String(d || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : d;
  }

  // ---------- Excel ----------
  async function excel(rep) {
    await cargarScript(LIBS.exceljs);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Credit Card Report", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .3, footer: .3 } } });
    ws.columns = [{ width: 17 }, { width: 14 }, { width: 32 }, { width: 46 }, { width: 16 }];
    const fuente = { name: "Arial", size: 10 };
    const negrita = { ...fuente, bold: true };
    const borde = { style: "thin", color: { argb: "FFD9E2E0" } };
    const img = await logo();
    if (img) {
      const id = wb.addImage({ buffer: img, extension: "jpeg" });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 220, height: 61 } });
    }
    ws.getRow(1).height = 26; ws.getRow(2).height = 26;
    ws.getCell("D1").value = rep.title || "Monthly Credit Card Report";
    ws.getCell("D1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FF1D3B45" } };
    ws.getCell("D2").value = "Period: " + rep.from + " to " + rep.to;
    ws.getCell("D2").font = negrita;

    const info = [["Employee Name:", rep.employee, "Supervisor Name:", rep.supervisor],
                  ["Email:", rep.email, "Department:", rep.department],
                  ["Purpose:", rep.purpose, "Location:", rep.location]];
    info.forEach((f, i) => {
      const r = ws.getRow(4 + i);
      r.getCell(1).value = f[0]; r.getCell(1).font = negrita;
      r.getCell(2).value = f[1]; ws.mergeCells(4 + i, 2, 4 + i, 3);
      r.getCell(4).value = f[2] + " " + (f[3] || ""); r.getCell(4).font = fuente;
      r.getCell(2).font = fuente;
    });

    const enc = ws.getRow(8);
    ["Date", "Amount", "Place", "Description", "Account #"].forEach((t, i) => {
      const c = enc.getCell(i + 1);
      c.value = t; c.font = { ...negrita, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D3B45" } };
      c.alignment = { horizontal: i === 1 ? "right" : "left", vertical: "middle" };
    });
    enc.height = 20;
    const primera = 9;
    rep.lines.forEach((l, i) => {
      const r = ws.getRow(primera + i);
      r.getCell(1).value = aFecha(l.date); r.getCell(1).numFmt = "mm/dd/yyyy";
      r.getCell(2).value = l.amount; r.getCell(2).numFmt = "#,##0.00;[Red]-#,##0.00";
      r.getCell(3).value = l.place; r.getCell(3).alignment = { indent: 1 };
      r.getCell(4).value = l.description;
      r.getCell(5).value = l.accountCode && /^\d+$/.test(l.accountCode) ? Number(l.accountCode) : l.accountCode;
      for (let c = 1; c <= 5; c++) { r.getCell(c).font = fuente; r.getCell(c).border = { bottom: borde }; if (i % 2) r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FAF9" } }; }
    });
    const ultima = primera + Math.max(rep.lines.length, 1) - 1;
    const tot = ws.getRow(ultima + 1);
    tot.getCell(1).value = "Total"; tot.getCell(1).font = negrita;
    tot.getCell(2).value = { formula: `SUM(B${primera}:B${ultima})`, result: rep.total };
    tot.getCell(2).numFmt = "#,##0.00"; tot.getCell(2).font = negrita;
    tot.getCell(1).border = tot.getCell(2).border = { top: { style: "medium", color: { argb: "FF1D3B45" } } };

    let f = ultima + 3;
    ws.getCell(f, 1).value = "I certify that the above information is accurate and complete."; ws.getCell(f, 1).font = negrita;
    ws.getCell(f, 5).value = "All amounts in USD"; ws.getCell(f, 5).font = { ...fuente, italic: true };
    f += 2;
    const firma = rep.signedName ? `Signed electronically by ${rep.signedName} (${rep.email}) on ${fechaHora(rep.signedAt)}` : "";
    ws.getCell(f, 1).value = firma || rep.employee; ws.getCell(f, 1).font = { ...negrita, color: { argb: firma ? "FF2F7A68" : "FF1F2B2E" } };
    if (rep.bossApprovedName) {
      ws.getCell(f, 4).value = `Approved electronically by ${rep.bossApprovedName}`;
      ws.getCell(f, 4).font = { ...negrita, color: { argb: "FF2F7A68" } };
      ws.getCell(f, 5).value = fechaHora(rep.bossApprovedAt);
      ws.getCell(f, 5).font = { ...fuente, color: { argb: "FF2F7A68" } };
    }
    ws.getCell(f + 1, 1).value = "Employee Signature"; ws.getCell(f + 1, 4).value = "Supervisor Approval";
    ws.getCell(f + 1, 5).value = "Date";
    f += 4;
    ws.getCell(f + 1, 1).value = "Finance"; ws.getCell(f + 1, 4).value = "Director of Administration"; ws.getCell(f + 1, 5).value = "Date";
    [f - 3, f + 1].forEach(r => [1, 4, 5].forEach(c => { const cel = ws.getCell(r, c); cel.font = negrita; cel.border = { top: { style: "thin", color: { argb: "FF5F6E70" } } }; }));

    const buf = await wb.xlsx.writeBuffer();
    descargar(buf, nombreArchivo(rep, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  // ---------- PDF con comprobantes ----------
  // Descarga el comprobante igual que el botón "Ver PDF": pide un enlace firmado y lo baja.
  async function comprobante(path) {
    const cfg = window.SUPABASE_CONFIG;
    const u = window.firebaseAuth && window.firebaseAuth.currentUser;
    if (!cfg || !u) throw new Error("Sesión no activa");
    const token = await u.getIdToken(false);
    const h = { apikey: cfg.publishableKey, Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const r = await fetch(cfg.url + "/storage/v1/object/sign/comprobantes/" + path, { method: "POST", headers: h, body: JSON.stringify({ expiresIn: 120 }) });
    if (!r.ok) throw new Error("Permiso " + r.status + " " + (await r.text()).slice(0, 120));
    const data = await r.json();
    let url = data.signedURL || data.signedUrl || "";
    if (!url) throw new Error("Sin enlace firmado");
    if (!/^https?:/.test(url)) url = cfg.url + "/storage/v1" + (url.startsWith("/") ? "" : "/") + url;
    const archivo = await fetch(url);
    if (!archivo.ok) throw new Error("Descarga " + archivo.status);
    return new Uint8Array(await archivo.arrayBuffer());
  }

  async function pdf(rep, conComprobantes, aviso) {
    await cargarScript(LIBS.pdflib);
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const docu = await PDFDocument.create();
    docu.setTitle((rep.title || "Monthly Credit Card Report") + " - " + rep.employee + " - " + rep.period);
    const reg = await docu.embedFont(StandardFonts.Helvetica);
    const neg = await docu.embedFont(StandardFonts.HelveticaBold);
    const piz = rgb(PIZARRA[0] / 255, PIZARRA[1] / 255, PIZARRA[2] / 255);
    const gris = rgb(.37, .43, .44), linea = rgb(.85, .89, .88), verde = rgb(.18, .48, .41);
    const limpio = t => String(t ?? "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\xFF]/g, "?");
    const corto = (t, f, tam, ancho) => { t = limpio(t); if (f.widthOfTextAtSize(t, tam) <= ancho) return t; while (t.length && f.widthOfTextAtSize(t + "...", tam) > ancho) t = t.slice(0, -1); return t + "..."; };
    const W = 612, H = 792, M = 40;
    const cols = [{ t: "Date", x: M, w: 62 }, { t: "Amount", x: M + 62, w: 66, der: true }, { t: "Place", x: M + 140, w: 132 }, { t: "Description", x: M + 276, w: 172 }, { t: "Account #", x: M + 452, w: 80 }];
    const imgBytes = await logo();
    const img = imgBytes ? await docu.embedJpg(imgBytes) : null;
    let pag, y, n = 0;

    function pie(p) {
      n++;
      p.drawText("All amounts listed in USD", { x: M, y: 24, size: 8, font: reg, color: gris });
      p.drawText("Page " + n, { x: W - M - 40, y: 24, size: 8, font: reg, color: gris });
      if (!rep.signedName) p.drawText("DRAFT - NOT SIGNED", { x: W / 2 - 60, y: 24, size: 8, font: neg, color: rgb(.66, .45, .12) });
    }
    function encabezadoTabla() {
      pag.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: piz });
      cols.forEach(c => {
        const ancho = neg.widthOfTextAtSize(c.t, 9);
        pag.drawText(c.t, { x: c.der ? c.x + c.w - ancho - 4 : c.x + 4, y: y + 1, size: 9, font: neg, color: rgb(1, 1, 1) });
      });
      y -= 20;
    }
    function nuevaPagina(primera, sinTabla) {
      if (pag) pie(pag);
      pag = docu.addPage([W, H]);
      y = H - M;
      if (primera) {
        if (img) { const e = img.scale(110 / img.width); pag.drawImage(img, { x: M, y: y - e.height, width: e.width, height: e.height }); }
        pag.drawText(rep.title || "Monthly Credit Card Report", { x: W - M - neg.widthOfTextAtSize(rep.title || "Monthly Credit Card Report", 16), y: y - 16, size: 16, font: neg, color: piz });
        const per = "Period: " + rep.from + " to " + rep.to;
        pag.drawText(per, { x: W - M - reg.widthOfTextAtSize(per, 10), y: y - 32, size: 10, font: reg, color: gris });
        y -= 50;
        pag.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: rgb(.72, .58, .35) });
        y -= 18;
        const datos = [["Employee Name", rep.employee, "Supervisor Name", rep.supervisor], ["Email", rep.email, "Department", rep.department], ["Purpose", rep.purpose, "Location", rep.location]];
        datos.forEach(d => {
          pag.drawText(d[0] + ":", { x: M, y, size: 9, font: neg, color: piz });
          pag.drawText(corto(d[1], reg, 9, 170), { x: M + 82, y, size: 9, font: reg });
          pag.drawText(d[2] + ":", { x: M + 280, y, size: 9, font: neg, color: piz });
          pag.drawText(corto(d[3], reg, 9, 160), { x: M + 372, y, size: 9, font: reg });
          y -= 15;
        });
        y -= 10;
        pag.drawText("Explanation by day of business purpose", { x: M, y, size: 11, font: neg, color: piz });
        y -= 20;
      } else {
        pag.drawText((rep.title || "Monthly Credit Card Report") + " - " + limpio(rep.employee) + (rep.period ? " - " + etiquetaMes(rep.period) : ""), { x: M, y: y - 10, size: 9, font: neg, color: piz });
        y -= 30;
      }
      if (!sinTabla) encabezadoTabla();
    }

    nuevaPagina(true);
    rep.lines.forEach((l, i) => {
      if (y < 70) nuevaPagina(false);
      if (i % 2) pag.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: rgb(.97, .98, .98) });
      const vals = [l.date, dinero(l.amount), l.place, l.description, l.accountCode];
      cols.forEach((c, k) => {
        const t = corto(vals[k], reg, 8.5, c.w - 8);
        const ancho = reg.widthOfTextAtSize(t, 8.5);
        pag.drawText(t, { x: c.der ? c.x + c.w - ancho - 4 : c.x + 4, y, size: 8.5, font: reg, color: l.amount < 0 && k === 1 ? rgb(.63, .23, .23) : rgb(.12, .17, .18) });
      });
      y -= 15;
    });
    if (y < 230) nuevaPagina(false, true);
    pag.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 1, color: piz });
    pag.drawText("Total", { x: M + 4, y: y - 6, size: 10, font: neg, color: piz });
    const totTxt = dinero(rep.total);
    pag.drawText(totTxt, { x: cols[1].x + cols[1].w - neg.widthOfTextAtSize(totTxt, 10) - 4, y: y - 6, size: 10, font: neg, color: piz });
    pag.drawText(rep.count + " transactions", { x: cols[2].x + 4, y: y - 6, size: 9, font: reg, color: gris });
    y -= 40;
    pag.drawText("I certify that the above information is accurate and complete.", { x: M, y, size: 10, font: neg });
    y -= 36;
    if (rep.signedName) {
      pag.drawText(corto("Signed electronically by " + rep.signedName, neg, 9, 280), { x: M, y: y + 16, size: 9, font: neg, color: verde });
      pag.drawText(corto(rep.email, reg, 8, 280), { x: M, y: y + 5, size: 8, font: reg, color: verde });
      pag.drawText(limpio(fechaHora(rep.signedAt)), { x: M + 330, y: y + 5, size: 9, font: reg, color: verde });
    }
    const firmas = (yy, a, b) => {
      [[M, 280, a], [M + 330, 90, "Date"]].forEach(([x, w, t]) => { pag.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: .6, color: gris }); pag.drawText(t, { x, y: yy - 11, size: 8, font: neg, color: gris }); });
      if (b) [[M + 440, 92, b]].forEach(([x, w, t]) => { pag.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: .6, color: gris }); pag.drawText(t, { x, y: yy - 11, size: 8, font: neg, color: gris }); });
    };
    firmas(y, "Employee Signature", "");
    y -= 42;
    if (rep.bossApprovedName) {
      pag.drawText(corto("Approved electronically by " + rep.bossApprovedName, neg, 9, 280), { x: M, y: y + 16, size: 9, font: neg, color: verde });
      pag.drawText(corto(rep.bossApprovedBy, reg, 8, 280), { x: M, y: y + 5, size: 8, font: reg, color: verde });
      pag.drawText(limpio(fechaHora(rep.bossApprovedAt)), { x: M + 330, y: y + 5, size: 9, font: reg, color: verde });
    }
    firmas(y, "Supervisor Approval", "");
    y -= 42; firmas(y, "Finance", "");
    y -= 42; firmas(y, "Director of Administration", "");
    pie(pag);

    if (conComprobantes) {
      const conPdf = rep.lines.filter(l => l.receiptPath);
      for (let i = 0; i < conPdf.length; i++) {
        const l = conPdf[i];
        if (aviso) aviso("Agregando comprobante " + (i + 1) + " de " + conPdf.length + "...");
        const etiqueta = "Receipt: " + l.date + "  " + l.place + "  USD " + dinero(l.amount);
        try {
          const origen = await PDFDocument.load(await comprobante(l.receiptPath), { ignoreEncryption: true });
          const paginas = await docu.copyPages(origen, origen.getPageIndices());
          paginas.forEach((p, k) => {
            docu.addPage(p);
            if (k === 0) {
              const ancho = reg.widthOfTextAtSize(limpio(etiqueta), 8) + 10;
              p.drawRectangle({ x: 8, y: 8, width: Math.min(ancho, p.getWidth() - 16), height: 14, color: rgb(1, 1, 1), opacity: .9 });
              p.drawText(corto(etiqueta, reg, 8, p.getWidth() - 26), { x: 13, y: 12, size: 8, font: reg, color: piz });
            }
          });
        } catch (e) {
          console.error("Comprobante no incluido", l, e);
          const p = docu.addPage([W, H]);
          p.drawText("No se pudo incluir este comprobante:", { x: M, y: H - 80, size: 12, font: neg, color: rgb(.63, .23, .23) });
          p.drawText(corto(etiqueta, reg, 10, W - 2 * M), { x: M, y: H - 100, size: 10, font: reg });
          p.drawText(corto("Detalle: " + (e && e.message ? e.message : e), reg, 8, W - 2 * M), { x: M, y: H - 118, size: 8, font: reg, color: gris });
        }
      }
    }
    return await docu.save();
  }

  // ---------- Empleado ----------
  function estadoEnvio(p) { return misEnvios.find(r => r.period === p); }
  function bloqueados() { return new Set(misEnvios.filter(r => r.status === "Enviado" || r.status === "Aceptado" || r.status === CON_JEFE).map(r => r.period)); }

  // Los gastos de un mes ya enviado quedan solo de lectura para el empleado.
  function bloquearFilas() {
    if (!esEmpleado()) return;
    const meses = bloqueados();
    const body = document.getElementById("expenses");
    if (!body) return;
    [...body.children].forEach((tr, i) => {
      const x = s.expenses[i];
      const cerrado = !!(x && meses.has(periodo(x)));
      tr.querySelectorAll("input,select,button").forEach(el => { el.disabled = cerrado; el.title = cerrado ? "Este mes ya se envió firmado" : ""; });
      tr.querySelectorAll("label").forEach(el => { el.style.pointerEvents = cerrado ? "none" : ""; el.style.opacity = cerrado ? ".45" : ""; });
      tr.style.opacity = cerrado ? ".8" : "";
    });
    // Aviso arriba de la tabla con los meses cerrados
    const sec = document.getElementById("gastos");
    if (!sec) return;
    let aviso = document.getElementById("avisoMesCerrado");
    if (!meses.size) { if (aviso) aviso.remove(); return; }
    if (!aviso) { aviso = document.createElement("div"); aviso.id = "avisoMesCerrado"; aviso.className = "box"; aviso.style.cssText = "border-left:4px solid #B8955A;padding:10px 14px"; const h = sec.querySelector("p"); if (h) h.after(aviso); else sec.prepend(aviso); }
    aviso.innerHTML = "🔒 <b>" + [...meses].sort().map(etiquetaMes).join(", ") + "</b>: reporte ya firmado y enviado. Esos gastos ya no se pueden modificar; si necesitas corregir algo, pide que te devuelvan el reporte.";
  }

  async function refrescarEnvios() {
    try { misEnvios = window.misReportesMensuales ? await window.misReportesMensuales() : []; } catch (e) { console.error(e); misEnvios = []; }
    pintarEmpleado(); pintarInicio(); bloquearFilas();
  }

  function pintarEmpleado() {
    if (!esEmpleado()) return;
    const sec = document.getElementById("employeeReports");
    if (!sec) return;
    let box = document.getElementById("reporteMensualBox");
    if (!box) { box = document.createElement("div"); box.className = "box"; box.id = "reporteMensualBox"; sec.appendChild(box); }
    const meses = [...new Set((s.expenses || []).map(periodo).filter(Boolean))].sort().reverse();
    if (!mesElegido || !meses.includes(mesElegido)) mesElegido = meses[0] || "";
    if (!mesElegido) { box.innerHTML = "<h3>Reporte mensual de tarjeta</h3><p>Todavía no tienes gastos.</p>"; return; }
    const rep = armarReporte(mesElegido), rev = revisar(rep), envio = estadoEnvio(mesElegido);
    const enviado = envio && (envio.status === "Enviado" || envio.status === "Aceptado" || envio.status === CON_JEFE);
    const avisos = [];
    if (rev.sinClasificar) avisos.push(`<li style="color:#A13A3A">${rev.sinClasificar} gasto(s) sin clasificar (concepto, cuenta o centro de costos).</li>`);
    if (rev.autorizacion) avisos.push(`<li style="color:#A13A3A">${rev.autorizacion} gasto(s) con autorización pendiente o rechazada.</li>`);
    if (rev.sinPdf) avisos.push(`<li style="color:#A9741F">${rev.sinPdf} gasto(s) sin comprobante PDF.</li>`);
    let estado = "";
    if (envio && envio.status === CON_JEFE) estado = `<p style="color:#A9741F"><b>⏳ Firmado y enviado a ${esc(envio.bossName || "tu jefe")} para su autorización</b> el ${fechaHora(envio.signedAt)}. Cuando lo autorice, pasará a Cuentas por Pagar. Ya no se pueden modificar los gastos de este mes.</p>`;
    else if (envio && envio.status === "Enviado") estado = `<p style="color:#2F7A68"><b>✅ Enviado y firmado</b> el ${fechaHora(envio.signedAt)}${envio.bossApprovedName ? `, autorizado por ${esc(envio.bossApprovedName)} el ${fechaHora(envio.bossApprovedAt)}` : ""}. Ya no se pueden modificar los gastos de este mes.</p>`;
    else if (envio && envio.status === "Aceptado") estado = `<p style="color:#2F7A68"><b>✅ Aceptado por Cuentas por Pagar</b> el ${fechaHora(envio.reviewedAt)}.</p>`;
    else if (envio && envio.status === "Devuelto") estado = `<p style="color:#A13A3A"><b>↩️ Devuelto para corrección${envio.reviewedByName ? " por " + esc(envio.reviewedByName) : ""}:</b> ${esc(envio.reviewComment || "")}<br>Corrige lo necesario y vuelve a firmar y enviar.</p>`;
    box.innerHTML = `<h3>Reporte mensual de tarjeta (Monthly Credit Card Report)</h3>`
      + `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><b>Mes:</b><select style="width:auto" onchange="reporteElegirMes(this.value)">`
      + meses.map(p => `<option value="${p}" ${p === mesElegido ? "selected" : ""}>${etiquetaMes(p)}</option>`).join("")
      + `</select><span><b>${rep.count}</b> movimientos · <b>USD ${dinero(rep.total)}</b></span></div>`
      + (avisos.length ? `<ul style="margin:12px 0">${avisos.join("")}</ul>` : `<p style="color:#2F7A68;margin:12px 0">Todo está clasificado y con comprobante. ✔</p>`)
      + estado
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">`
      + `<button class="split-btn" onclick="reporteDescargar('xlsx')">⬇️ Descargar Excel</button>`
      + `<button class="split-btn" onclick="reporteDescargar('pdf')">⬇️ Descargar PDF con comprobantes</button>`
      + (enviado ? "" : `<button class="primary" style="width:auto;display:inline-block;${rev.bloquea ? "opacity:.55" : ""}" ${rev.bloquea ? "title=\"Primero clasifica todos los gastos y resuelve las autorizaciones\"" : ""} onclick="reporteFirmar()">✍️ Firmar y enviar</button>`)
      + `</div><div id="reporteAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }

  window.reporteElegirMes = v => { mesElegido = v; pintarEmpleado(); };

  // Lista de reportes ya enviados en la página de Inicio del empleado.
  function pintarInicio() {
    if (!esEmpleado()) return;
    const sec = document.getElementById("employeeHome");
    if (!sec) return;
    let box = document.getElementById("misReportesInicio");
    if (!box) { box = document.createElement("div"); box.className = "box"; box.id = "misReportesInicio"; box.style.marginTop = "20px"; sec.appendChild(box); }
    const lista = [...misEnvios].sort((a, b) => String(b.period).localeCompare(String(a.period)));
    const etiqueta = st => st === "Aceptado" ? '<b style="color:#2F7A68">✅ Aceptado</b>' : st === "Devuelto" ? '<b style="color:#A13A3A">↩️ Devuelto</b>' : st === CON_JEFE ? '<b style="color:#A9741F">⏳ Con tu jefe para autorizar</b>' : '<b style="color:#A9741F">📨 Enviado, en revisión</b>';
    box.innerHTML = "<h3>Mis reportes enviados</h3>"
      + (lista.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Mes</th><th style="text-align:right">Movimientos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Estado</th><th>Descargar</th></tr></thead><tbody>`
        + lista.map(r => `<tr><td><b>${etiquetaMes(r.period)}</b></td><td style="text-align:right">${r.count}</td><td style="text-align:right">${dinero(r.total)}</td>`
          + `<td>${esc(r.signedName || "")}<br><small>${fechaHora(r.signedAt)}</small></td>`
          + `<td>${etiqueta(r.status)}${r.status === "Devuelto" && r.reviewComment ? "<br><small>" + esc(r.reviewComment) + "</small>" : ""}</td>`
          + `<td style="white-space:nowrap"><button class="split-btn" onclick="reporteInicio('${q(r.id)}','pdf')">⬇️ PDF</button> <button class="split-btn" onclick="reporteInicio('${q(r.id)}','xlsx')">⬇️ Excel</button></td></tr>`).join("")
        + `</tbody></table></div>` : "<p>Todavía no has enviado ningún reporte. Cuando termines de clasificar un mes, fírmalo y envíalo desde <b>Reportes</b>.</p>")
      + `<div id="inicioReporteAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }
  window.reporteInicio = async function (id, tipo) {
    const r = misEnvios.find(x => x.id === id); if (!r) return;
    const aviso = t => { const el = document.getElementById("inicioReporteAviso"); if (el) el.textContent = t; };
    try {
      aviso("Preparando archivo...");
      if (tipo === "xlsx") await excel(r);
      else descargar(await pdf(r, true, aviso), nombreArchivo(r, "pdf"), "application/pdf");
      aviso("");
    } catch (e) { console.error(e); aviso(""); alert("No se pudo generar el archivo. " + (e.message || "")); }
  };

  window.reporteDescargar = async function (tipo) {
    const aviso = t => { const el = document.getElementById("reporteAviso"); if (el) el.textContent = t; };
    try {
      const envio = estadoEnvio(mesElegido);
      const rep = envio && envio.status !== "Devuelto" ? envio : armarReporte(mesElegido);
      aviso("Preparando archivo...");
      if (tipo === "xlsx") await excel(rep);
      else descargar(await pdf(rep, true, aviso), nombreArchivo(rep, "pdf"), "application/pdf");
      aviso("");
    } catch (e) { console.error(e); aviso(""); alert("No se pudo generar el archivo. " + (e.message || "")); }
  };

  window.reporteFirmar = function () {
    const rep = armarReporte(mesElegido), rev = revisar(rep);
    if (rev.bloquea) {
      const partes = [];
      if (rev.sinClasificar) partes.push("- " + rev.sinClasificar + " gasto(s) sin clasificar (falta concepto, cuenta o centro de costos).");
      if (rev.autorizacion) partes.push("- " + rev.autorizacion + " gasto(s) con autorización del jefe pendiente o rechazada.");
      alert("Todavía no puedes firmar el reporte de " + etiquetaMes(mesElegido) + ":\n\n" + partes.join("\n") + "\n\nCorrígelos en Mis gastos (filtra por este mes) y vuelve aquí.");
      return;
    }
    let dlg = document.getElementById("dlgFirma");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "dlgFirma";
      dlg.style.cssText = "border:0;border-radius:12px;padding:26px;width:min(460px,92vw);box-shadow:0 20px 55px rgba(0,0,0,.25)";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<h3 style="margin-top:0">Firmar y enviar reporte</h3>`
      + `<p><b>${etiquetaMes(rep.period)}</b> · ${rep.count} movimientos · <b>USD ${dinero(rep.total)}</b></p>`
      + (rev.sinPdf ? `<p style="color:#A9741F">Atención: ${rev.sinPdf} gasto(s) no tienen comprobante PDF.</p>` : "")
      + `<label style="display:flex;gap:8px;align-items:flex-start;margin:14px 0"><input type="checkbox" id="firmaCertifico" style="width:auto;margin-top:3px"> <span>Certifico que la información es correcta y completa (<i>I certify that the above information is accurate and complete</i>).</span></label>`
      + `<label>Escribe tu nombre completo como firma</label><input id="firmaNombre" style="width:100%;box-sizing:border-box" value="">`
      + `<p style="font-size:12px;color:#5F6E70">${session()?.jefeEmail ? `Tu reporte irá primero a <b>${esc(session().jefeNombre || "tu jefe")}</b> para su autorización y después a Cuentas por Pagar.` : "Tu reporte irá a Cuentas por Pagar."} Al enviar, los gastos de este mes quedarán bloqueados. Si hay que corregir algo, te lo devolverán.</p>`
      + `<div id="firmaError" class="login-error"></div>`
      + `<div style="display:flex;gap:10px;margin-top:14px"><button class="primary" id="firmaEnviar" style="width:auto">Firmar y enviar</button><button class="split-btn" onclick="document.getElementById('dlgFirma').close()">Cancelar</button></div>`;
    dlg.querySelector("#firmaEnviar").onclick = async () => {
      const err = dlg.querySelector("#firmaError");
      const nombre = dlg.querySelector("#firmaNombre").value.trim();
      const mostrar = m => { err.textContent = m; err.style.display = "block"; };
      if (!dlg.querySelector("#firmaCertifico").checked) return mostrar("Marca la casilla de certificación.");
      if (nombre.split(/\s+/).length < 2) return mostrar("Escribe tu nombre y apellido.");
      const boton = dlg.querySelector("#firmaEnviar"); boton.disabled = true;
      try {
        const datos = { ...armarReporte(mesElegido), signedName: nombre, signedAt: new Date().toISOString() };
        await window.enviarReporteMensual(datos);
        dlg.close();
        await refrescarEnvios();
        const sj = session() || {};
        alert("Tu reporte de " + etiquetaMes(datos.period) + " quedó firmado y enviado " + (sj.jefeEmail ? "a " + (sj.jefeNombre || "tu jefe") + " para su autorización." : "a Cuentas por Pagar."));
      } catch (e) { console.error(e); mostrar("No se pudo enviar. " + (e.code || e.message || "")); boton.disabled = false; }
    };
    dlg.showModal();
  };

  // ---------- Administradora ----------
  async function refrescarRecibidos() {
    try { recibidos = window.reportesMensualesRecibidos ? await window.reportesMensualesRecibidos() : []; } catch (e) { console.error(e); recibidos = []; }
    pintarAdmin();
  }

  function pintarAdmin() {
    if (!esAdmin()) return;
    const sec = document.getElementById("reportes");
    if (!sec) return;
    let box = document.getElementById("reportesRecibidosBox");
    if (!box) { box = document.createElement("div"); box.className = "box"; box.id = "reportesRecibidosBox"; sec.insertBefore(box, sec.children[1] || null); }
    const lista = [...recibidos].sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
    const pendientes = lista.filter(r => r.status === "Enviado").length;
    const etiqueta = (st, r) => st === "Aceptado" ? '<b style="color:#2F7A68">Aceptado</b>' : st === "Devuelto" ? '<b style="color:#A13A3A">Devuelto</b>' : st === CON_JEFE ? `<b style="color:#5F6E70">⏳ Esperando autorización de ${esc(r.bossName || "su jefe")}</b>` : '<b style="color:#A9741F">Por revisar</b>';
    const aprobacion = r => r.bossApprovedName ? `<br><small style="color:#2F7A68">✔ Autorizó ${esc(r.bossApprovedName)} · ${fechaHora(r.bossApprovedAt)}</small>` : "";
    box.innerHTML = `<h3>📨 Reportes mensuales recibidos ${pendientes ? `(${pendientes} por revisar)` : ""}</h3>`
      + `<p>Reportes firmados por los empleados. Los de empleados con jefe asignado llegan aquí para revisión cuando el jefe los autoriza. El PDF incluye el reporte y todos sus comprobantes.</p>`
      + `<button class="split-btn" onclick="reportesActualizar()">🔄 Actualizar</button>`
      + (lista.length ? `<div style="overflow-x:auto"><table style="margin-top:10px"><thead><tr><th>Empleado</th><th>Mes</th><th style="text-align:right">Movimientos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`
        + lista.map(r => `<tr><td>${esc(r.employee)}</td><td>${etiquetaMes(r.period)}</td><td style="text-align:right">${r.count}</td><td style="text-align:right">${dinero(r.total)}</td>`
          + `<td>${esc(r.signedName)}<br><small>${fechaHora(r.signedAt)}</small>${aprobacion(r)}</td><td>${etiqueta(r.status, r)}${r.reviewComment ? "<br><small>" + (r.reviewedByName ? esc(r.reviewedByName) + ": " : "") + esc(r.reviewComment) + "</small>" : ""}</td>`
          + `<td style="white-space:nowrap"><button class="split-btn" onclick="reporteAdmin('${q(r.id)}','pdf')">⬇️ PDF</button> <button class="split-btn" onclick="reporteAdmin('${q(r.id)}','xlsx')">⬇️ Excel</button>`
          + (r.status === "Enviado" ? ` <button class="split-btn" onclick="reporteRevisar('${q(r.id)}','Aceptado')">✅ Aceptar</button> <button class="split-btn" onclick="reporteRevisar('${q(r.id)}','Devuelto')">↩️ Devolver</button>` : "")
          + ` <button class="split-btn" title="Eliminar" onclick="reporteEliminar('${q(r.id)}')">🗑️</button>`
          + `</td></tr>`).join("") + `</tbody></table></div>`
        : "<p>Todavía no hay reportes enviados.</p>")
      + `<div id="reporteAdminAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }

  window.reportesActualizar = refrescarRecibidos;
  window.reporteAdmin = async function (id, tipo) {
    const r = recibidos.find(x => x.id === id); if (!r) return;
    const aviso = t => { const el = document.getElementById("reporteAdminAviso"); if (el) el.textContent = t; };
    try {
      aviso("Preparando archivo...");
      if (tipo === "xlsx") await excel(r);
      else descargar(await pdf(r, true, aviso), nombreArchivo(r, "pdf"), "application/pdf");
      aviso("");
    } catch (e) { console.error(e); aviso(""); alert("No se pudo generar el archivo. " + (e.message || "")); }
  };
  window.reporteEliminar = async function (id) {
    const r = recibidos.find(x => x.id === id); if (!r) return;
    if (!confirm("¿Eliminar el reporte de " + r.employee + " de " + etiquetaMes(r.period) + " por USD " + dinero(r.total) + "?\n\nSe borra para todos y no se puede recuperar. El empleado podrá volver a firmar y enviar ese mes.")) return;
    try { await window.eliminarReporteMensual(id); await refrescarRecibidos(); }
    catch (e) { console.error(e); alert("No se pudo eliminar. " + (e.code || e.message || "")); }
  };
  window.reporteRevisar = async function (id, status) {
    let comentario = "";
    if (status === "Devuelto") {
      comentario = prompt("Motivo para devolver el reporte (el empleado lo verá):");
      if (comentario === null) return;
      if (!comentario.trim()) { alert("Escribe el motivo."); return; }
    }
    try { await window.cambiarEstadoReporte(id, status, comentario.trim()); await refrescarRecibidos(); }
    catch (e) { console.error(e); alert("No se pudo actualizar. " + (e.code || e.message || "")); }
  };

  // ---------- Jefe: reportes de su equipo por autorizar ----------
  async function refrescarEquipo() {
    try { delEquipo = window.reportesPorAutorizar ? await window.reportesPorAutorizar() : []; } catch (e) { console.error(e); delEquipo = []; }
    pintarJefe();
  }

  function pintarJefe() {
    if (!esJefe()) return;
    const sec = document.getElementById("autorizaciones");
    if (!sec) return;
    let box = document.getElementById("reportesJefeBox");
    if (!box) {
      box = document.createElement("div"); box.className = "box"; box.id = "reportesJefeBox";
      const ap = document.getElementById("approvals");
      if (ap) ap.before(box); else sec.appendChild(box);
    }
    const lista = [...delEquipo].sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
    const pendientes = lista.filter(r => r.status === CON_JEFE);
    const historial = lista.filter(r => r.status !== CON_JEFE);
    const botones = r => `<button class="split-btn" onclick="reporteJefeDescargar('${q(r.id)}','pdf')">⬇️ PDF</button> <button class="split-btn" onclick="reporteJefeDescargar('${q(r.id)}','xlsx')">⬇️ Excel</button>`;
    const estado = r => r.status === "Devuelto" ? '<b style="color:#A13A3A">↩️ Devuelto</b>' + (r.reviewComment ? "<br><small>" + (r.reviewedByName ? esc(r.reviewedByName) + ": " : "") + esc(r.reviewComment) + "</small>" : "")
      : r.status === "Aceptado" ? '<b style="color:#2F7A68">✅ Aceptado por Cuentas por Pagar</b>'
      : '<b style="color:#2F7A68">✔ Autorizado</b>' + (r.bossApprovedAt ? "<br><small>" + fechaHora(r.bossApprovedAt) + "</small>" : "");
    box.innerHTML = `<h3>📋 Reportes mensuales por autorizar ${pendientes.length ? `(${pendientes.length})` : ""}</h3>`
      + `<p>Reportes de tarjeta firmados por tu equipo. Revisa el PDF (incluye los comprobantes) y autorízalo para que pase a Cuentas por Pagar, o devuélvelo al empleado con un comentario.</p>`
      + `<button class="split-btn" onclick="reportesJefeActualizar()">🔄 Actualizar</button>`
      + (pendientes.length ? `<div style="overflow-x:auto"><table style="margin-top:10px"><thead><tr><th>Empleado</th><th>Mes</th><th style="text-align:right">Movimientos</th><th style="text-align:right">Total USD</th><th>Firmado</th><th>Acciones</th></tr></thead><tbody>`
        + pendientes.map(r => `<tr><td>${esc(r.employee)}</td><td>${etiquetaMes(r.period)}</td><td style="text-align:right">${r.count}</td><td style="text-align:right">${dinero(r.total)}</td>`
          + `<td>${esc(r.signedName)}<br><small>${fechaHora(r.signedAt)}</small></td>`
          + `<td style="white-space:nowrap">${botones(r)} <button class="primary" style="display:inline-block;width:auto" onclick="reporteJefeDecidir('${q(r.id)}',true)">✅ Autorizar</button> <button class="split-btn" onclick="reporteJefeDecidir('${q(r.id)}',false)">↩️ Devolver</button></td></tr>`).join("")
        + `</tbody></table></div>` : "<p style=\"margin-top:10px\"><b>No tienes reportes pendientes de autorizar.</b></p>")
      + (historial.length ? `<h4 style="margin-top:20px">Historial</h4><div style="overflow-x:auto"><table><thead><tr><th>Empleado</th><th>Mes</th><th style="text-align:right">Total USD</th><th>Estado</th><th>Descargar</th></tr></thead><tbody>`
        + historial.map(r => `<tr><td>${esc(r.employee)}</td><td>${etiquetaMes(r.period)}</td><td style="text-align:right">${dinero(r.total)}</td><td>${estado(r)}</td><td style="white-space:nowrap">${botones(r)}</td></tr>`).join("")
        + `</tbody></table></div>` : "")
      + `<div id="reporteJefeAviso" style="margin-top:8px;color:#5F6E70"></div>`;
  }

  window.reportesJefeActualizar = refrescarEquipo;
  window.reporteJefeDescargar = async function (id, tipo) {
    const r = delEquipo.find(x => x.id === id); if (!r) return;
    const aviso = t => { const el = document.getElementById("reporteJefeAviso"); if (el) el.textContent = t; };
    try {
      aviso("Preparando archivo...");
      if (tipo === "xlsx") await excel(r);
      else descargar(await pdf(r, true, aviso), nombreArchivo(r, "pdf"), "application/pdf");
      aviso("");
    } catch (e) { console.error(e); aviso(""); alert("No se pudo generar el archivo. " + (e.message || "")); }
  };
  window.reporteJefeDecidir = async function (id, autorizar) {
    const r = delEquipo.find(x => x.id === id); if (!r) return;
    let comentario = "";
    if (autorizar) {
      if (!confirm("¿Autorizar el reporte de " + r.employee + " de " + etiquetaMes(r.period) + " por USD " + dinero(r.total) + "?\n\nPasará a Cuentas por Pagar con tu autorización.")) return;
    } else {
      comentario = prompt("Motivo para devolver el reporte a " + r.employee + " (lo verá el empleado):");
      if (comentario === null) return;
      if (!comentario.trim()) { alert("Escribe el motivo."); return; }
    }
    try { await window.decidirReporteJefe(id, autorizar, comentario.trim()); await refrescarEquipo(); }
    catch (e) { console.error(e); alert("No se pudo guardar. " + (e.code || e.message || "")); }
  };

  // Para que otros módulos (reembolsos) generen el mismo formato.
  window.ReporteAPI = { pdf, excel, descargar, nombreArchivo };

  // ---------- Integración ----------
  function vigilar() {
    const body = document.getElementById("expenses");
    if (!body || body._reporteMensual) return;
    body._reporteMensual = true;
    new MutationObserver(() => setTimeout(bloquearFilas, 0)).observe(body, { childList: true });
  }
  // La página de Reportes del empleado se crea después de iniciar sesión: pintar en cuanto aparezca.
  const main = document.querySelector("main");
  if (main) new MutationObserver(() => {
    if (esEmpleado() && document.getElementById("employeeReports") && !document.getElementById("reporteMensualBox")) pintarEmpleado();
  }).observe(main, { childList: true });

  // Respaldo: revisa cada segundo que el recuadro exista (por si la página se creó antes que este archivo).
  setInterval(() => {
    try {
      if (esEmpleado() && document.getElementById("employeeHome") && !document.getElementById("misReportesInicio")) pintarInicio();
      if (esEmpleado() && document.getElementById("employeeReports") && !document.getElementById("reporteMensualBox")) {
        pintarEmpleado();
        if (!cargado && window.firebaseAuth && window.firebaseAuth.currentUser) { cargado = true; refrescarEnvios(); }
      }
      if (esJefe() && document.getElementById("autorizaciones") && !document.getElementById("reportesJefeBox")) {
        pintarJefe();
        if (!cargadoJefe && window.firebaseAuth && window.firebaseAuth.currentUser) { cargadoJefe = true; refrescarEquipo(); }
      }
      if (esAdmin() && document.getElementById("reportes") && !document.getElementById("reportesRecibidosBox")) {
        pintarAdmin();
        if (!cargado && window.firebaseAuth && window.firebaseAuth.currentUser) { cargado = true; refrescarRecibidos(); }
      }
    } catch (e) { console.error("Reporte mensual:", e); }
  }, 1000);

  const anterior = window.render || render;
  window.render = render = function () {
    anterior(); vigilar();
    if (!cargado && (esEmpleado() || esAdmin()) && window.firebaseAuth && window.firebaseAuth.currentUser) {
      cargado = true;
      if (esEmpleado()) refrescarEnvios(); else refrescarRecibidos();
    }
    if (!cargadoJefe && esJefe() && window.firebaseAuth && window.firebaseAuth.currentUser) { cargadoJefe = true; refrescarEquipo(); }
    try { if (esEmpleado()) { pintarEmpleado(); bloquearFilas(); } else pintarAdmin(); if (esJefe()) pintarJefe(); }
    catch (e) { console.error("Reporte mensual:", e); }
  };
})();
