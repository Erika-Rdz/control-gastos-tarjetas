// Comprobantes PDF privados en Supabase Storage usando la sesión de Firebase.
(function(){
let supabaseClient=null;
function ready(){return window.SUPABASE_CONFIG&&window.supabase&&window.firebaseAuth}
function client(){
 if(supabaseClient)return supabaseClient;
 if(!ready())throw new Error("El almacenamiento de comprobantes aún no está listo.");
 const cfg=window.SUPABASE_CONFIG;
 supabaseClient=window.supabase.createClient(cfg.url,cfg.publishableKey,{accessToken:async()=>{
   const user=window.firebaseAuth.currentUser;
   return user?await user.getIdToken(false):null;
 }});
 return supabaseClient;
}
function safeName(name){return String(name||"comprobante.pdf").replace(/[^a-zA-Z0-9._-]/g,"_")}
window.uploadReceipt=async function(i,input){
 const x=s.expenses[i],file=input&&input.files&&input.files[0];
 if(!x||!file)return;
 if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){alert("El comprobante debe ser un archivo PDF.");input.value="";return}
 if(file.size>10*1024*1024){alert("El PDF no puede pesar más de 10 MB.");input.value="";return}
 const user=window.firebaseAuth&&window.firebaseAuth.currentUser;
 if(!user){alert("Tu sesión no está activa. Vuelve a iniciar sesión.");return}
 input.disabled=true;
 try{
   // Fuerza una renovación para que Firebase incluya el claim role=authenticated recién configurado.
   await user.getIdToken(true);
   const path=user.uid+"/"+(x.id||("gasto-"+i))+"/"+Date.now()+"-"+safeName(file.name);
   const {error}=await client().storage.from("comprobantes").upload(path,file,{contentType:"application/pdf",upsert:false});
   if(error)throw error;
   x.receipt=true;x.receiptPath=path;x.receiptName=file.name;
   save();render();alert("Comprobante guardado correctamente.");
 }catch(err){console.error("Error al subir comprobante:",err);alert("No se pudo subir el comprobante. "+(err&&err.message?err.message:""));input.disabled=false}
};
window.viewReceipt=async function(i){
 const x=s.expenses[i];if(!x||!x.receiptPath)return;
 try{
   const {data,error}=await client().storage.from("comprobantes").createSignedUrl(x.receiptPath,300);
   if(error)throw error;
   window.open(data.signedUrl,"_blank","noopener");
 }catch(err){console.error("Error al abrir comprobante:",err);alert("No se pudo abrir el comprobante. "+(err&&err.message?err.message:""))}
};
function receiptCell(x,i){
 if(x.receiptPath)return '<div><b>PDF cargado</b><br><button class="split-btn" onclick="viewReceipt('+i+')">👁️ Ver PDF</button><br><label class="split-btn" style="display:inline-block">🔄 Reemplazar<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="uploadReceipt('+i+',this)"></label></div>';
 return '<label class="split-btn" style="display:inline-block">📎 Subir PDF<input type="file" accept="application/pdf,.pdf" style="display:none" onchange="uploadReceipt('+i+',this)"></label>';
}
function installReceiptEditors(){
 const body=document.getElementById("expenses");if(!body)return;
 body.querySelectorAll("tr").forEach((tr,i)=>{const td=tr.children[7],x=s.expenses[i];if(!td||!x)return;td.innerHTML=receiptCell(x,i)})
}
const previousRender=window.render||render;
window.render=render=function(){previousRender();installReceiptEditors()};
installReceiptEditors();
})();