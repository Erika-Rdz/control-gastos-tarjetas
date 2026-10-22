// Vista tipo hoja de cálculo para la tabla de gastos (administradora y empleados).
// Filas compactas, cuadrícula, encabezado fijo y colores por estado. Se puede alternar con la vista normal.
(function () {
  const CLAVE = "vistaHojaGastos";
  function preferida() { try { return localStorage.getItem(CLAVE) !== "no"; } catch (e) { return true; } }
  function recordar(v) { try { localStorage.setItem(CLAVE, v ? "si" : "no"); } catch (e) {} }

  const css = document.createElement("style");
  css.textContent = `
  body.vista-hoja .hoja-box{padding:0;overflow:auto;max-height:calc(100vh - 230px);border-radius:6px}
  body.vista-hoja .hoja-box table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%}
  body.vista-hoja .hoja-box th,body.vista-hoja .hoja-box td{padding:2px 6px;font-size:12px;border-right:1px solid #dfe3e8;border-bottom:1px solid #dfe3e8;white-space:nowrap;vertical-align:middle;line-height:1.3}
  body.vista-hoja .hoja-box th{position:sticky;top:0;z-index:3;background:#e8edf3;font-weight:600;padding:6px;border-bottom:2px solid #c5ccd6}
  body.vista-hoja .hoja-box td:first-child,body.vista-hoja .hoja-box th:first-child{position:sticky;left:0;z-index:2;background:#f7f9fb}
  body.vista-hoja .hoja-box th:first-child{z-index:4;background:#e8edf3}
  body.vista-hoja .hoja-box tbody tr:nth-child(even) td{background:#fbfcfd}
  body.vista-hoja .hoja-box tbody tr:nth-child(even) td:first-child{background:#f3f6f9}
  body.vista-hoja .hoja-box tbody tr:hover td{background:#eef5ff}
  body.vista-hoja .hoja-box td:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}
  body.vista-hoja .hoja-box td br{display:none}
  body.vista-hoja .hoja-box input,body.vista-hoja .hoja-box select{border:1px solid transparent;border-radius:0;background:transparent;padding:3px 4px;font-size:12px;height:24px;box-sizing:border-box}
  body.vista-hoja .hoja-box input:hover,body.vista-hoja .hoja-box select:hover{border-color:#cbd5e1;background:white}
  body.vista-hoja .hoja-box input:focus,body.vista-hoja .hoja-box select:focus{outline:2px solid #2563eb;outline-offset:-2px;background:white}
  body.vista-hoja .hoja-box .concept-input{min-width:190px}
  body.vista-hoja .hoja-box .expense-select{min-width:210px}
  body.vista-hoja .hoja-box .pending-field{background:#fff4e5;border-color:transparent}
  body.vista-hoja .hoja-box .split-btn,body.vista-hoja .hoja-box button{margin:0 0 0 4px;padding:2px 6px;font-size:11px;display:inline-block;width:auto;vertical-align:middle;line-height:1.3}
  body.vista-hoja .hoja-box .split-summary{display:inline-block;margin:0 0 0 6px;font-size:11px}
  body.vista-hoja .hoja-box td:nth-child(8) *{display:inline-block;margin-top:0;margin-bottom:0;font-size:11px}
  body.vista-hoja .hoja-box .alcohol-box{display:inline-flex;align-items:center;gap:4px;margin:0 0 0 6px;padding:1px 4px;border-style:solid}
  body.vista-hoja .hoja-box .alcohol-box label{display:inline;margin:0;font-size:11px}
  body.vista-hoja .hoja-box .alcohol-box select{min-width:105px}
  body.vista-hoja .hoja-box .auth-msg{display:inline;margin:0 0 0 4px;font-size:11px}
  .estado-ok{color:#166534;font-weight:600}.estado-pend{color:#b45309;font-weight:600}.estado-mal{color:#991b1b;font-weight:600}
  .hoja-toggle{display:flex;justify-content:flex-end;margin-top:12px}
  .hoja-toggle button{display:inline-block;width:auto;padding:6px 12px;border:1px solid #94a3b8;border-radius:6px;background:white;font-size:12px;cursor:pointer}`;
  document.head.appendChild(css);

  function colorearEstados() {
    const body = document.getElementById("expenses");
    if (!body) return;
    [...body.children].forEach(tr => {
      const td = tr.children[8];
      if (!td) return;
      const t = td.textContent.trim();
      td.classList.remove("estado-ok", "estado-pend", "estado-mal");
      if (!t) return;
      td.classList.add(t === "Completo" ? "estado-ok" : /rechaz/i.test(t) ? "estado-mal" : "estado-pend");
    });
  }

  function aplicar() {
    const activa = preferida();
    document.body.classList.toggle("vista-hoja", activa);
    const body = document.getElementById("expenses");
    const box = body && body.closest(".box");
    if (box) box.classList.add("hoja-box");
    const seccion = document.getElementById("gastos");
    if (seccion && box && !document.getElementById("hojaToggle")) {
      const barra = document.createElement("div");
      barra.className = "hoja-toggle";
      barra.id = "hojaToggle";
      barra.innerHTML = '<button type="button" onclick="alternarVistaHoja()"></button>';
      box.before(barra);
    }
    const boton = document.querySelector("#hojaToggle button");
    if (boton) boton.textContent = activa ? "🗂️ Cambiar a vista normal" : "📊 Cambiar a vista de hoja de cálculo";
    colorearEstados();
  }

  window.alternarVistaHoja = function () { recordar(!preferida()); aplicar(); };

  function vigilar() {
    const body = document.getElementById("expenses");
    if (!body || body._hoja) return;
    body._hoja = true;
    // Se ejecuta después de que los demás módulos terminan de dibujar las filas.
    new MutationObserver(() => setTimeout(colorearEstados, 0)).observe(body, { childList: true, subtree: true, characterData: true });
  }

  const anterior = window.render || render;
  window.render = render = function () { anterior(); vigilar(); aplicar(); };
  vigilar();
  aplicar();
})();
