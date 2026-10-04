// Resumen manual del estado de cuenta y conciliación mensual.
(function(){
const MONTHS=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const ROWS=[
 {field:"previousBalance",label:"Saldo ant."},
 {field:"payments",label:"Pagos"},
 {field:"purchases",label:"Compras"},
 {field:"other",label:"Otros"},
 {field:"newBalance",label:"Saldo nuevo"}
];
function num(v){const n=Number(String(v??"").replace(/[$,\s()]/g,""));return Number.isFinite(n)?n:0}
function parseDate(v){const m=String(v||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?{month:Number(m[1]),year:Number(m[3])}:null}
function expensePeriod(x){return parseDate(x.postingDate||x.date)}
function importedPurchases(year,month){return s.expenses.reduce((t,x)=>{const p=expensePeriod(x);return p&&p.year===year&&p.month===month?t+Number(x.amount||0):t},0)}
function ensureData(){if(!s.statementSummaries||typeof s.statementSummaries!=="object")s.statementSummaries={}}
function key(year,month){return year+"-"+String(month).padStart(2,"0")}
function getRow(year,month){ensureData();return s.statementSummaries[key(year,month)]||{previousBalance:0,payments:0,purchases:0,other:0,newBalance:0}}
function years(){const set=new Set([new Date().getFullYear()]);s.expenses.forEach(x=>{const p=expensePeriod(x);if(p)set.add(p.year)});Object.keys(s.statementSummaries||{}).forEach(k=>set.add(Number(k.slice(0,4))));return [...set].filter(Boolean).sort((a,b)=>b-a)}
function saveField(year,month,field,value){ensureData();const k=key(year,month),row=getRow(year,month);row[field]=num(value);s.statementSummaries[k]=row;save();renderStatementSummary()}
window.updateStatementSummary=saveField;
function input(year,month,field,value){return '<input type="number" step="0.01" style="width:86px" value="'+Number(value||0).toFixed(2)+'" onchange="updateStatementSummary('+year+','+month+',\''+field+'\',this.value)">'}
function renderStatementSummary(){const host=document.getElementById("statementSummaryHost");if(!host)return;ensureData();const select=document.getElementById("statementYear"),year=Number(select&&select.value)||years()[0];if(select&&!select.dataset.ready){select.innerHTML=years().map(y=>'<option value="'+y+'">'+y+'</option>').join("");select.value=year;select.dataset.ready="1"}const head=document.getElementById("statementSummaryHead"),body=document.getElementById("statementSummaryBody");if(!head||!body)return;head.innerHTML='<tr><th>Concepto</th>'+MONTHS.map(m=>'<th>'+m+'</th>').join('')+'</tr>';let html=ROWS.map(r=>'<tr><td><b>'+r.label+'</b></td>'+MONTHS.map((m,i)=>'<td>'+input(year,i+1,r.field,getRow(year,i+1)[r.field])+'</td>').join('')+'</tr>').join('');html+='<tr><td><b>Importado</b></td>'+MONTHS.map((m,i)=>'<td>'+money(importedPurchases(year,i+1))+'</td>').join('')+'</tr>';html+='<tr><td><b>Diferencia</b></td>'+MONTHS.map((m,i)=>{const app=importedPurchases(year,i+1),diff=Number(getRow(year,i+1).purchases||0)-app,balanced=Math.abs(diff)<0.005;return '<td style="font-weight:bold;'+(balanced?'color:#166534':'color:#b45309')+'">'+(balanced?'✓':' '+money(diff))+'</td>'}).join('')+'</tr>';body.innerHTML=html}
window.changeStatementYear=function(){const el=document.getElementById("statementYear");if(el)el.dataset.ready="1";renderStatementSummary()};
function install(){const dash=document.getElementById("dashboard");if(!dash||document.getElementById("statementSummaryHost"))return;ensureData();const box=document.createElement("div");box.className="box";box.id="statementSummaryHost";box.innerHTML='<h3>Resumen del estado de cuenta</h3><p>Captura los importes del corte y compáralos con los gastos importados.</p><label><b>Año:</b> <select id="statementYear" onchange="changeStatementYear()"></select></label><div style="overflow-x:auto;margin-top:12px"><table><thead id="statementSummaryHead"></thead><tbody id="statementSummaryBody"></tbody></table></div>';dash.appendChild(box);renderStatementSummary()}
const prev=window.render||render;window.render=render=function(){prev();install();renderStatementSummary()};install();
})();