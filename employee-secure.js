// Acceso seguro por empleado usando documentos separados en Firestore.
// Se activa después de que el administrador publique los datos para empleados.
(function(){
const ADMIN='accountspayable@peninsulasteel.com';
const FIREBASE_VERSION='12.9.0';
const norm=v=>String(v||'').trim().toLowerCase();
const safeId=v=>encodeURIComponent(norm(v));
let fs=null;
async function api(){if(fs)return fs;const mod=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);const appmod=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);const app=appmod.getApps()[0];fs={...mod,db:mod.getFirestore(app)};return fs}
function accessForEmployee(name){return (s.userAccess||[]).find(a=>a.employee===name&&a.enabled!==false&&a.email)}
function expenseId(x,i){return x.id||x.importId||[x.date,x.employee,x.supplier||x.merchant,x.amount,i].join('|').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,180)}
window.publicarDatosEmpleados=async function(){try{const A=await api();const batch=A.writeBatch(A.db);let count=0;(s.userAccess||[]).filter(a=>a.enabled!==false&&a.email).forEach(a=>{batch.set(A.doc(A.db,'accesos',safeId(a.email)),{email:norm(a.email),employee:a.employee,role:'Empleado',enabled:true},{merge:true});count++});(s.expenses||[]).forEach((x,i)=>{const a=accessForEmployee(x.employee);if(!a)return;batch.set(A.doc(A.db,'gastos',expenseId(x,i)),{...x,employeeEmail:norm(a.email),employee:x.employee},{merge:true});count++});batch.set(A.doc(A.db,'catalogos','empleados'),{accounts:s.accounts||[],centers:s.centers||[]},{merge:true});await batch.commit();alert('Datos para empleados publicados correctamente.\n\nRegistros preparados: '+count)}catch(e){console.error(e);alert('No se pudieron publicar los datos: '+(e.code||e.message))}};
window.cargarSesionEmpleado=async function(email){const A=await api();const acc=await A.getDoc(A.doc(A.db,'accesos',safeId(email)));if(!acc.exists()||acc.data().enabled===false)throw new Error('Este usuario no tiene acceso habilitado.');const info=acc.data();const cat=await A.getDoc(A.doc(A.db,'catalogos','empleados'));const q=A.query(A.collection(A.db,'gastos'),A.where('employeeEmail','==',norm(email)));const snap=await A.getDocs(q);s.expenses=snap.docs.map(d=>({...d.data(),_firestoreId:d.id}));if(cat.exists()){s.accounts=cat.data().accounts||[];s.centers=cat.data().centers||[]}return {user:email,name:info.employee,employee:info.employee,role:'Empleado'}};
window.guardarGastoEmpleado=async function(x){if(!x?._firestoreId)return;const A=await api();const data={...x};delete data._firestoreId;await A.setDoc(A.doc(A.db,'gastos',x._firestoreId),data,{merge:true})};
window.esAdministrador=email=>norm(email)===norm(ADMIN);
})();
