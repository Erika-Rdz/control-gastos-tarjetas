// Avisos por correo (solo notificación, sin adjuntos). Usa EmailJS (https://www.emailjs.com).
//  • Empleado con jefe envía su reporte mensual  → correo al jefe para que lo autorice.
//  • Empleado sin jefe envía su reporte          → correo a Cuentas por Pagar.
//  • El jefe autoriza un reporte                  → correo a Cuentas por Pagar.
//  • Alguien envía un reembolso                   → correo a Cuentas por Pagar.
// Llena los tres datos de abajo con los de tu cuenta de EmailJS. Mientras estén vacíos,
// el sistema funciona igual, solo que no manda correos.
window.AVISOS_CORREO = {
  serviceId: "service_xxxxxxx",   // Email Services → Service ID   (ej. "service_abc123")
  templateId: "template_xxxxxxx",  // Email Templates → Template ID (ej. "template_xyz789")
  publicKey: "xxxxxxxxxxxxxxx"    // Account → General → Public Key
};

(function () {
  const SDK = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js";
  const SITIO = "https://erika-rdz.github.io/control-gastos-tarjetas/";
  const ADMIN = "accountspayable@peninsulasteel.com";
  let cargando = null;

  function cargarSDK() {
    if (window.emailjs) return Promise.resolve();
    if (!cargando) {
      cargando = new Promise((ok, mal) => {
        const sc = document.createElement("script");
        sc.src = SDK; sc.onload = ok; sc.onerror = () => { cargando = null; mal(new Error("No cargó EmailJS")); };
        document.head.appendChild(sc);
      });
    }
    return cargando;
  }

  const dinero = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const mes = p => { const [a, m] = String(p || "").split("-"); return MESES[Number(m) - 1] ? MESES[Number(m) - 1] + " " + a : String(p || ""); };

  function armar(evento, d) {
    const total = "USD " + dinero(d.total);
    if (evento === "reporte_jefe") return {
      to_email: d.bossEmail, to_name: d.bossName || "",
      asunto: `Reporte de ${d.employee} por autorizar`,
      mensaje: `${d.employee} firmó y te envió su reporte de tarjeta de ${mes(d.period)} por ${total} (${d.count || 0} movimientos) para tu autorización.\n\nEntra al sistema, abre "Autorizaciones" y da clic en Autorizar o Devolver.`
    };
    if (evento === "reporte_admin") return {
      to_email: ADMIN, to_name: "Cuentas por Pagar",
      asunto: `Reporte de ${d.employee} recibido`,
      mensaje: `${d.employee} firmó y envió su reporte de tarjeta de ${mes(d.period)} por ${total} (${d.count || 0} movimientos).\n\nRevísalo en el sistema, en "Reportes".`
    };
    if (evento === "reporte_autorizado") return {
      to_email: ADMIN, to_name: "Cuentas por Pagar",
      asunto: `Reporte de ${d.employee} autorizado por ${d.bossApprovedName || "su jefe"}`,
      mensaje: `${d.bossApprovedName || "El jefe"} autorizó el reporte de tarjeta de ${d.employee} de ${mes(d.period)} por ${total}.\n\nYa está en tu bandeja de "Reportes" para revisión.`
    };
    if (evento === "reembolso") return {
      to_email: ADMIN, to_name: "Cuentas por Pagar",
      asunto: `Reembolso "${d.name || "Sin nombre"}" de ${d.ownerName || d.ownerEmail}`,
      mensaje: `${d.ownerName || d.ownerEmail} firmó y envió el reembolso "${d.name || "Sin nombre"}" (solicitado el ${d.requestDate || ""}) por ${total}, con ${(d.items || []).length} gasto(s).\n\nRevísalo en el sistema, en "Reportes" → "Reembolsos recibidos".`
    };
    return null;
  }

  // Nunca lanza error: si el correo falla, lo que se envió en el sistema ya quedó guardado.
  window.avisarCorreo = async function (evento, datos) {
    const cfg = window.AVISOS_CORREO || {};
    if (!cfg.serviceId || !cfg.templateId || !cfg.publicKey) return;
    try {
      const p = armar(evento, datos || {});
      if (!p || !p.to_email) return;
      await cargarSDK();
      await window.emailjs.send(cfg.serviceId, cfg.templateId, { ...p, enlace: SITIO }, { publicKey: cfg.publicKey });
    } catch (e) {
      console.warn("No se pudo enviar el aviso por correo:", e);
    }
  };
})();
