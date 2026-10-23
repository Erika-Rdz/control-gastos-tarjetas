// Resumen por cuenta y empleado (solo consulta).
// - Jefe inmediato: "Resumen del equipo" con los gastos de su equipo.
// - Administradora: "Resumen por empleado" con todos los empleados, filtrable por mes y departamento.
// Solo se suman los gastos que ya tienen cuenta asignada; los demás se indican aparte.
(function () {
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const estado = {
    equipo: { mes: "", depto: "", detalle: null },
    admin: { mes: "", depto: "", detalle: null }
  };

  function session() { try { return JSON.parse(sessionStorage.getItem("controlGastosSession") || "null"); } catch (e) { return null; } }
  const esJefe = () => !!session()?.isBoss;
  const esAdmin = () => session()?.role === "Administrador";
  const q = v => String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const sinAcentos = v => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const num = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function periodo(x) {
    const t = String(x.date || "").trim();
    let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + "-" + m[1].padStart(2, "0");
    m = t.match(/^(\d{4})-(\d{1,2})/);
    if (m) return m[1] + "-" + m[2].padStart(2, "0");
    return "";
  }
  const etiquetaMes = p => { const [y, m] = p.split("-"); return (MESES[Number(m) - 1] || m) + " " + y; };
  const deptoDe = nombre => ((s.employees || []).find(e => e.name === nombre) || {}).dept || "";

  // ---------- Páginas y botones del menú ----------
  function asegurar(id, titulo, texto, boxId, botonId, etiqueta, accion, visible) {
    const main = document.querySelector("main");
    if (main && !document.getElementById(id)) {
      const sec = document.createElement("section");
      sec.id = id; sec.className = "page";
      sec.innerHTML = `<h2>${titulo}</h2><p>${texto}</p><div class="box" id="${boxId}"></div>`;
      main.appendChild(sec);
    }
    const nav = document.querySelector("nav");
    let b = document.getElementById(botonId);
    if (nav && !b) {
      b = document.createElement("button");
      b.id = botonId; b.innerHTML = etiqueta; b.setAttribute("onclick", accion);
      nav.appendChild(b);
    }
    if (b) b.style.display = visible ? "block" : "none";
  }
  function asegurarPaginas() {
    asegurar("resumenEquipo", "Resumen de mi equipo", "Lo que tu equipo ha clasificado en cada cuenta de gasto. Pantalla solo de consulta.",
      "resumenEquipoBox", "navResumenEquipo", "📊 Resumen del equipo", "showEmployeePage('resumenEquipo',this)", esJefe());
    asegurar("resumenAdmin", "Resumen por empleado", "Lo que cada empleado ha clasificado en cada cuenta de gasto. Pantalla solo de consulta.",
      "resumenAdminBox", "navResumenAdmin", "📊 Resumen por empleado", "show('resumenAdmin',this);renderResumenAdmin()", esAdmin());
  }

  // ---------- Tabla ----------
  function tabla(clave, todos, conDepto) {
    const st = estado[clave];
    const meses = [...new Set(todos.map(periodo).filter(Boolean))].sort().reverse();
    if (st.mes && !meses.includes(st.mes)) st.mes = "";
    const deptos = [];
    if (conDepto) todos.forEach(x => { const d = deptoDe(x.employee); if (d && !deptos.some(z => sinAcentos(z) === sinAcentos(d))) deptos.push(d); });
    deptos.sort((a, b) => a.localeCompare(b));

    const delPeriodo = todos.filter(x => (!st.mes || periodo(x) === st.mes) && (!st.depto || sinAcentos(deptoDe(x.employee)) === sinAcentos(st.depto)));
    const lista = delPeriodo.filter(x => x.account);
    const pendientes = delPeriodo.filter(x => !x.account);

    const empleados = [...new Set(lista.map(x => x.employee).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const usadas = new Set(lista.map(x => x.account));
    const cuentas = (s.accounts || []).filter(a => usadas.has(a.name)).map(a => ({ clave: a.name, codigo: a.code || "", nombre: a.name }));
    usadas.forEach(c => { if (!cuentas.some(a => a.clave === c)) cuentas.push({ clave: c, codigo: "", nombre: c }); });
    cuentas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));

    const suma = (cuenta, emp) => lista.filter(x => (!cuenta || x.account === cuenta) && (!emp || x.employee === emp)).reduce((t, x) => t + Number(x.amount || 0), 0);
    const celda = (cuenta, emp, negrita) => {
      const v = suma(cuenta, emp);
      if (!v) return '<td style="text-align:right;color:#cbd5e1">—</td>';
      return `<td style="text-align:right;white-space:nowrap;${negrita ? "font-weight:bold;" : ""}"><a href="#" style="color:inherit" onclick="resumenDetalle('${clave}','${q(cuenta)}','${q(emp)}');return false">${num(v)}</a></td>`;
    };

    let html = `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><b>Mes:</b>`
      + `<select style="width:auto" onchange="resumenFiltro('${clave}','mes',this.value)"><option value="">Todos los meses</option>`
      + meses.map(p => `<option value="${p}" ${p === st.mes ? "selected" : ""}>${etiquetaMes(p)}</option>`).join("") + `</select>`
      + (conDepto ? `<b>Departamento:</b><select style="width:auto" onchange="resumenFiltro('${clave}','depto',this.value)"><option value="">Todos</option>`
        + deptos.map(d => `<option value="${esc(d)}" ${sinAcentos(d) === sinAcentos(st.depto) ? "selected" : ""}>${esc(d)}</option>`).join("") + `</select>` : "")
      + `<span><b>Total clasificado:</b> USD ${num(suma("", ""))} <span style="color:#64748b">(${lista.length} movimientos)</span></span></div>`;
    if (pendientes.length) {
      html += `<p style="color:#A9741F;margin-top:0">⏳ ${pendientes.length} movimiento(s) por USD ${num(pendientes.reduce((t, x) => t + Number(x.amount || 0), 0))} todavía sin cuenta asignada (no se incluyen en la tabla).</p>`;
    }
    if (!lista.length) return html + "<p>No hay gastos clasificados para este filtro.</p>";

    html += `<div style="overflow-x:auto"><table><thead><tr><th>Código cuenta</th><th>Cuenta de gastos</th>`
      + empleados.map(e => `<th style="text-align:right;white-space:nowrap">${esc(e)}</th>`).join("")
      + `<th style="text-align:right">Total</th></tr></thead><tbody>`
      + cuentas.map(c => `<tr><td>${esc(c.codigo)}</td><td style="white-space:nowrap">${esc(c.nombre)}</td>` + empleados.map(e => celda(c.clave, e)).join("") + celda(c.clave, "", true) + `</tr>`).join("")
      + `<tr style="background:#eef2f7"><td></td><td><b>Total</b></td>` + empleados.map(e => celda("", e, true)).join("") + celda("", "", true) + `</tr></tbody></table></div>`;

    if (st.detalle) {
      const d = st.detalle;
      const filas = lista.filter(x => (!d.cuenta || x.account === d.cuenta) && (!d.emp || x.employee === d.emp));
      html += `<h3 style="margin-top:24px">Detalle: ${esc(d.cuenta || "Todas las cuentas")} · ${esc(d.emp || "Todos")}</h3>`
        + `<div style="overflow-x:auto"><table><thead><tr><th>Fecha</th><th>Empleado</th><th>Comercio</th><th style="text-align:right">Importe</th><th>Concepto</th><th>Cuenta</th><th>Centro de costos</th><th>Estado</th></tr></thead><tbody>`
        + filas.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.employee)}</td><td>${esc(x.supplier || "")}</td><td style="text-align:right">${num(x.amount)}</td><td>${esc(x.concept || "")}</td><td>${esc(x.account || "")}</td>`
          + `<td>${(x.centerSplits && x.centerSplits.length) ? x.centerSplits.map(p => esc(p.center) + " " + num(p.amount)).join(" + ") : esc(x.center || "")}</td><td>${esc(expenseStatus(x))}</td></tr>`).join("")
        + `</tbody></table></div>`;
    }
    return html;
  }

  window.resumenFiltro = function (clave, campo, valor) { estado[clave][campo] = valor || ""; estado[clave].detalle = null; pintar(clave); };
  window.resumenDetalle = function (clave, cuenta, emp) { estado[clave].detalle = { cuenta, emp }; pintar(clave); };

  function pintar(clave) {
    if (clave === "equipo") {
      const box = document.getElementById("resumenEquipoBox");
      if (box && esJefe()) box.innerHTML = tabla("equipo", s.teamExpenses || [], false);
    } else {
      const box = document.getElementById("resumenAdminBox");
      if (box && esAdmin()) box.innerHTML = tabla("admin", s.expenses || [], true);
    }
  }
  window.renderResumenEquipo = () => pintar("equipo");
  window.renderResumenAdmin = () => pintar("admin");

  // Se actualiza en tiempo real junto con Autorizaciones (jefe).
  const autorizacionesAnterior = window.renderAutorizaciones;
  if (typeof autorizacionesAnterior === "function") {
    window.renderAutorizaciones = function () { autorizacionesAnterior(); window.renderResumenEquipo(); };
  }

  const anterior = window.render || render;
  window.render = render = function () {
    anterior(); asegurarPaginas();
    window.renderResumenEquipo();
    if (document.getElementById("resumenAdmin")?.classList.contains("active")) window.renderResumenAdmin();
  };
  asegurarPaginas();
})();
