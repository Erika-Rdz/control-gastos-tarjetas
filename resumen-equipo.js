// Resumen del equipo (solo consulta) para el jefe inmediato:
// cuentas de gasto en filas, empleados en columnas, con importes por mes según la Tran Date.
(function () {
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  let mesElegido = "";
  let detalle = null; // { cuenta, empleado }

  function session() { try { return JSON.parse(sessionStorage.getItem("controlGastosSession") || "null"); } catch (e) { return null; } }
  const q = v => String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  function periodo(x) {
    const t = String(x.date || "").trim();
    let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + "-" + m[1].padStart(2, "0");
    m = t.match(/^(\d{4})-(\d{1,2})/);
    if (m) return m[1] + "-" + m[2].padStart(2, "0");
    return "";
  }
  const etiquetaMes = p => { const [y, m] = p.split("-"); return (MESES[Number(m) - 1] || m) + " " + y; };
  const SIN = "__sin__";

  function asegurarPagina() {
    const main = document.querySelector("main");
    if (main && !document.getElementById("resumenEquipo")) {
      const sec = document.createElement("section");
      sec.id = "resumenEquipo";
      sec.className = "page";
      sec.innerHTML = '<h2>Resumen de mi equipo</h2><p>Consulta de lo que tu equipo ha clasificado en cada cuenta de gasto. Esta pantalla es solo de lectura.</p><div class="box" id="resumenEquipoBox"></div>';
      main.appendChild(sec);
    }
    const nav = document.querySelector("nav");
    let boton = document.getElementById("navResumenEquipo");
    if (nav && !boton) {
      boton = document.createElement("button");
      boton.id = "navResumenEquipo";
      boton.innerHTML = "📊 Resumen del equipo";
      boton.setAttribute("onclick", "showEmployeePage('resumenEquipo',this)");
      nav.appendChild(boton);
    }
    if (boton) boton.style.display = session()?.isBoss ? "block" : "none";
  }

  window.resumenElegirMes = function (v) { mesElegido = v || ""; detalle = null; window.renderResumenEquipo(); };
  window.resumenVerDetalle = function (cuenta, empleado) { detalle = { cuenta, empleado }; window.renderResumenEquipo(); };

  window.renderResumenEquipo = function () {
    const box = document.getElementById("resumenEquipoBox");
    if (!box || !session()?.isBoss) return;
    const todos = s.teamExpenses || [];
    const meses = [...new Set(todos.map(periodo).filter(Boolean))].sort().reverse();
    if (mesElegido && !meses.includes(mesElegido)) mesElegido = "";
    const lista = todos.filter(x => !mesElegido || periodo(x) === mesElegido);

    const empleados = [...new Set(lista.map(x => x.employee).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const claveCuenta = x => x.account || SIN;
    const usadas = new Set(lista.map(claveCuenta));
    const cuentas = (s.accounts || []).filter(a => usadas.has(a.name)).map(a => ({ clave: a.name, codigo: a.code || "", nombre: a.name }));
    usadas.forEach(c => { if (c !== SIN && !cuentas.some(a => a.clave === c)) cuentas.push({ clave: c, codigo: "", nombre: c }); });
    if (usadas.has(SIN)) cuentas.push({ clave: SIN, codigo: "", nombre: "Sin clasificar" });

    const suma = (cuenta, empleado) => lista
      .filter(x => (!cuenta || claveCuenta(x) === cuenta) && (!empleado || x.employee === empleado))
      .reduce((t, x) => t + Number(x.amount || 0), 0);
    const celda = (cuenta, empleado, negrita) => {
      const v = suma(cuenta, empleado);
      if (!v) return '<td style="text-align:right;color:#cbd5e1">—</td>';
      return `<td style="text-align:right;${negrita ? "font-weight:bold;" : ""}"><a href="#" style="color:inherit" onclick="resumenVerDetalle('${q(cuenta)}','${q(empleado)}');return false">${money(v)}</a></td>`;
    };

    let html = `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><b>Mes:</b>`
      + `<select onchange="resumenElegirMes(this.value)" style="width:auto"><option value="">Todos los meses</option>`
      + meses.map(p => `<option value="${p}" ${p === mesElegido ? "selected" : ""}>${etiquetaMes(p)}</option>`).join("")
      + `</select><span><b>Total del equipo:</b> ${money(suma("", ""))} <span style="color:#64748b">(${lista.length} movimientos)</span></span></div>`;

    if (!lista.length) {
      box.innerHTML = html + "<p>No hay gastos de tu equipo para este periodo.</p>";
      return;
    }

    html += `<div style="overflow-x:auto"><table><thead><tr><th>Código</th><th>Cuenta</th>`
      + empleados.map(e => `<th style="text-align:right">${esc(e)}</th>`).join("")
      + `<th style="text-align:right">Total</th></tr></thead><tbody>`
      + cuentas.map(c => `<tr${c.clave === SIN ? ' style="color:#b45309"' : ""}><td>${esc(c.codigo)}</td><td>${esc(c.nombre)}</td>`
        + empleados.map(e => celda(c.clave, e)).join("") + celda(c.clave, "", true) + `</tr>`).join("")
      + `<tr style="background:#eef2f7"><td></td><td><b>Total</b></td>`
      + empleados.map(e => celda("", e, true)).join("") + celda("", "", true) + `</tr></tbody></table></div>`;

    if (detalle) {
      const filas = lista.filter(x => (!detalle.cuenta || claveCuenta(x) === detalle.cuenta) && (!detalle.empleado || x.employee === detalle.empleado));
      const nombreCuenta = detalle.cuenta === SIN ? "Sin clasificar" : (detalle.cuenta || "Todas las cuentas");
      html += `<h3 style="margin-top:24px">Detalle: ${esc(nombreCuenta)} · ${esc(detalle.empleado || "Todo el equipo")}</h3>`
        + `<div style="overflow-x:auto"><table><thead><tr><th>Fecha</th><th>Empleado</th><th>Comercio</th><th style="text-align:right">Importe</th><th>Concepto</th><th>Cuenta</th><th>Centro de costos</th><th>Estado</th></tr></thead><tbody>`
        + filas.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.employee)}</td><td>${esc(x.supplier || "")}</td><td style="text-align:right">${money(x.amount)}</td><td>${esc(x.concept || "")}</td><td>${esc(x.account || "")}</td>`
          + `<td>${(x.centerSplits && x.centerSplits.length) ? x.centerSplits.map(p => esc(p.center) + " " + money(p.amount)).join(" + ") : esc(x.center || "")}</td><td>${esc(expenseStatus(x))}</td></tr>`).join("")
        + `</tbody></table></div>`;
    }
    box.innerHTML = html;
  };

  // Se actualiza en tiempo real junto con Autorizaciones.
  const autorizacionesAnterior = window.renderAutorizaciones;
  if (typeof autorizacionesAnterior === "function") {
    window.renderAutorizaciones = function () { autorizacionesAnterior(); window.renderResumenEquipo(); };
  }

  const anterior = window.render || render;
  window.render = render = function () { anterior(); asegurarPagina(); window.renderResumenEquipo(); };
  asegurarPagina();
})();
