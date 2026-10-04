// Agrupa catálogos administrativos bajo una sola opción de Configuración.
(function(){
function navButtonFor(id){return [...document.querySelectorAll('nav button')].find(b=>(b.getAttribute('onclick')||'').includes("'"+id+"'"))}
function openConfigSection(id){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));const page=document.getElementById(id);if(page)page.classList.add('active');document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));const cfg=document.getElementById('configNavButton');if(cfg)cfg.classList.add('active')}
window.openConfigSection=openConfigSection;
function install(){const nav=document.querySelector('nav'),main=document.querySelector('main');if(!nav||!main||document.getElementById('configNavButton'))return;
 const emp=navButtonFor('empleados'),cards=navButtonFor('tarjetas');
 if(emp)emp.style.display='none';if(cards)cards.style.display='none';
 const cfg=document.createElement('button');cfg.id='configNavButton';cfg.innerHTML='⚙️ Configuración';cfg.onclick=function(){openConfigSection('configuracion')};
 const auth=navButtonFor('autorizaciones');nav.insertBefore(cfg,auth?auth.nextSibling:null);
 const sec=document.createElement('section');sec.id='configuracion';sec.className='page';sec.innerHTML='<h2>Configuración</h2><p>Administra aquí los datos que utiliza la aplicación para identificar empleados, tarjetas y accesos.</p><div class="cards" style="grid-template-columns:repeat(3,minmax(220px,1fr))"><div class="card"><h3>👥 Empleados</h3><p>Datos del empleado, correo, departamento y jefe.</p><button class="primary" onclick="openConfigSection(\'empleados\')">Administrar empleados</button></div><div class="card"><h3>💳 Tarjetas</h3><p>Relaciona cada tarjeta con su empleado y conserva su límite.</p><button class="primary" onclick="openConfigSection(\'tarjetas\')">Administrar tarjetas</button></div><div class="card"><h3>🔐 Usuarios y accesos</h3><p>Próximamente: vincular el correo de cada empleado para que solo pueda consultar sus propios gastos.</p><button class="primary" disabled style="opacity:.55;cursor:not-allowed">Configurar accesos</button></div></div>';
 main.appendChild(sec);
}
install();
})();