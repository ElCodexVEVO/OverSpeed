(function(root){
'use strict';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const quantity=value=>{const n=Number(value);return Number.isInteger(n)&&n>0&&n<=9999?n:null};
const clean=value=>String(value??'').trim();
function calculate(catalog,cart,discount=0,commission=0){
 if(!Number.isFinite(+discount)||discount<0||discount>100)throw Error('Descuento inválido');
 if(!Number.isFinite(+commission)||commission<0||commission>100)throw Error('Comisión inválida');
 const lines=Object.entries(cart).map(([id,q])=>{const item=catalog.find(s=>s.id===id&&s.active);if(!item)throw Error('Servicio no disponible');if(!quantity(q))throw Error('La cantidad debe ser un entero entre 1 y 9999');return {...item,qty:+q,line_total:round(item.price*q),line_cost:round(item.cost*q)}});
 const subtotal=round(lines.reduce((s,l)=>s+l.line_total,0)),cost=round(lines.reduce((s,l)=>s+l.line_cost,0)),reduction=round(subtotal*discount/100),total=round(subtotal-reduction),earning=round(total*commission/100);
 return {lines,subtotal,cost,discount:reduction,total,earning,net:round(total-cost-earning),costConfirmed:lines.every(l=>l.cost_confirmed!==false)};
}
function validateOrder(x){
 if(clean(x.client).length<1||clean(x.client).length>120)throw Error('Escribe el nombre o ID del cliente (máximo 120 caracteres)');
 if(!/^[A-Z0-9 -]{1,16}$/i.test(clean(x.plate)))throw Error('Escribe una matrícula válida (letras, números, espacios o guiones)');
 if(!clean(x.model)||clean(x.model).length>100)throw Error('Escribe el modelo del vehículo');
 if(!['Efectivo','Transferencia','Tarjeta','Otro'].includes(x.payment))throw Error('Selecciona un método de pago');
 if(!Array.isArray(x.lines)||!x.lines.length)throw Error('Agrega al menos un servicio');
 if(clean(x.note).length>1000)throw Error('La nota es demasiado larga');
 return {...x,client:clean(x.client),plate:clean(x.plate).toUpperCase(),model:clean(x.model),note:clean(x.note)};
}
const money=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:2}).format(Number(n)||0);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csv=x=>'"'+String(/^[=+\-@\t\r]/.test(String(x))?"'"+x:x??'').replace(/"/g,'""')+'"';
const month=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')};
const api={round,quantity,calculate,validateOrder,money,esc,csv,month};
if(typeof module!=='undefined')module.exports=api;else root.OS=api;
})(typeof window!=='undefined'?window:globalThis);
