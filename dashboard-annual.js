// Resumen anual de gastos por empleado en el Dashboard.
(function(){
const MONTHS=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
function parseExpenseDate(v){
  const t=String(v||"").trim();
  let m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m)return {month:Number(m[1])-1,year:Number(m[3])};
  m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return {month:Number(m[2])-1,year:Number(m[1])};
  const d=new Date(t);
  return isNaN(d)?null:{month:d.getMonth(),year:d.getFullYear()};
}
function availableYears(){
  const years=[...new Set(s.expenses.map(x=>parseExpenseDate(x.date||x.postingDate)).filter(Boolean).map(d=>d.year))].sort((a,b)=>b-a);
  return years.length?years:[new Date().getFullYear()];
}
function employeeNames(){
  const names=[];
  s.employees.forEach(e=>{if(e.name&&!names.includes(e.name))names.push(e.name)});
  s.expenses.forEach(x=>{if(x.employee&&!names.includes(x.employee))names.push(x.employee)});
  return names;
}
function cardFor(name){
  const e=s.employees.find(e=>e.name===name);
  if(e&&e.card)return String(e.card).replace(/^\*+/,"");
  const x=s.expenses.find(x=>x.employee===name&&(x.card||x.last4));
  return x?String(x.card||x.last4).replace(/^\*+/,""):"";
}
function annualData(year){
  const names=employeeNames(),totals=Array(12).fill(0),rows=[];
  names.forEach(name=>{
    const months=Array(12).fill(0);
    s.expenses.filter(x=>x.employee===name).forEach(x=>{
      const d=parseExpenseDate(x.date||x.postingDate);
      if(d&&d.year===year&&d.month>=0&&d.month<12)months[d.month]+=Number(x.amount||0);
    });
    months.forEach((v,i)=>totals[i]+=v);
    rows.push({name,card:cardFor(name),months,total:months.reduce((a,v)=>a+v,0)});
  });
  return {rows,totals,grand:totals.reduce((a,v)=>a+v,0)};
}
function draw(){
  const body=document.getElementById("control");if(!body)return;
  const table=body.closest("table"),box=table&&table.closest(".box");if(!table||!box)return;
  const title=box.querySelector("h3");if(title)title.textContent="Gasto anual por empleado";
  let controls=box.querySelector("#annualDashboardControls");
  if(!controls){
    controls=document.createElement("div");controls.id="annualDashboardControls";controls.style.margin="10px 0 16px";
    controls.innerHTML='<label><b>Año:</b> <select id="dashboardYear"></select></label>';
    table.parentNode.insertBefore(controls,table);
    controls.querySelector("#dashboardYear").addEventListener("change",draw);
  }
  const select=controls.querySelector("#dashboardYear"),years=availableYears(),previous=Number(select.value)||years[0];
  select.innerHTML=years.map(y=>'<option value="'+y+'" '+(y===previous?'selected':'')+'>'+y+'</option>').join("");
  if(!select.value)select.value=years[0];
  const year=Number(select.value),data=annualData(year),thead=table.querySelector("thead");
  thead.innerHTML='<tr><th>Empleado</th><th>Tarjeta</th>'+MONTHS.map(m=>'<th>'+m+' '+year+'</th>').join('')+'<th>Total anual</th></tr>';
  body.innerHTML=data.rows.map(r=>'<tr><td><b>'+esc(r.name)+'</b></td><td>'+esc(r.card)+'</td>'+r.months.map(v=>'<td style="text-align:right">'+(v?money(v):'—')+'</td>').join('')+'<td style="text-align:right"><b>'+money(r.total)+'</b></td></tr>').join('')+'<tr><td colspan="2"><b>TOTAL MES</b></td>'+data.totals.map(v=>'<td style="text-align:right"><b>'+money(v)+'</b></td>').join('')+'<td style="text-align:right"><b>'+money(data.grand)+'</b></td></tr>';
  table.style.minWidth="1650px";
  box.style.overflowX="auto";
}
const previousRender=window.render||render;
window.render=render=function(){previousRender();draw()};
draw();
})();