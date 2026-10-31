import {empty,validateState,clone} from './model.js';
const BASE=new URL('../',import.meta.url);
export const DB_NAME='ne-krapiva:'+BASE.pathname+':v1';
let db=null;
export function openDB(){return new Promise((resolve,reject)=>{
 if(!('indexedDB' in globalThis)){reject(Error('Браузер не поддерживает локальное хранилище.'));return;}
 const r=indexedDB.open(DB_NAME,1);
 r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('images');};
 r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Закройте другие вкладки приложения и повторите открытие.'));
 r.onsuccess=()=>{db=r.result;db.onversionchange=()=>db.close();resolve(db);};
});}
export async function read(){if(!db)await openDB();return new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>{try{resolve(r.result?validateState(r.result):empty());}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}
export async function write(next,expected,{add=[],remove=[]}={}){if(!db)await openDB();validateState(next);return new Promise((resolve,reject)=>{
 const tx=db.transaction(['state','images'],'readwrite'),store=tx.objectStore('state');let failure=null;
 tx.oncomplete=()=>resolve(clone(next));tx.onabort=()=>reject(failure||tx.error||Error('Не удалось сохранить данные.'));tx.onerror=()=>{};
 const r=store.get('current');r.onsuccess=()=>{
  try { const revision=r.result?.revision||0;if(revision!==expected){failure=Error('Данные изменились в другой вкладке. Перечитайте данные; введённый текст останется на экране.');failure.code='CONFLICT';tx.abort();return;}
  next.revision=revision+1;next.updatedAt=new Date().toISOString();store.put(next,'current');
  const images=tx.objectStore('images');for(const id of remove)images.delete(id);for(const {id,blob} of add)images.put(blob,id);
  } catch(error) { failure=error;tx.abort(); }
 };r.onerror=()=>{failure=r.error;};
});}
export async function imageBlob(id){if(!db)await openDB();return new Promise((resolve,reject)=>{const r=db.transaction('images').objectStore('images').get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
export async function checkImage(blob){
 if(!(blob instanceof Blob)||blob.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw Error('Нужен PNG, JPEG или WebP размером до 5 МБ.');
 const a=new Uint8Array(await blob.slice(0,16).arrayBuffer());const ascii=(start,len)=>String.fromCharCode(...a.slice(start,start+len));
 if(blob.type==='image/png'&&!(a[0]===137&&ascii(1,3)==='PNG')||blob.type==='image/jpeg'&&!(a[0]===255&&a[1]===216&&a[2]===255)||blob.type==='image/webp'&&!(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'))throw Error('Содержимое файла не соответствует изображению.');
 try {
  if('createImageBitmap' in globalThis){const bitmap=await createImageBitmap(blob);const large=bitmap.width*bitmap.height>40000000;bitmap.close();if(large)throw Error('too large');}
  else {const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();if(img.naturalWidth*img.naturalHeight>40000000)throw Error('too large');}finally{URL.revokeObjectURL(url);}}
 }catch{throw Error('Не удалось прочитать изображение. Выберите исправный файл до 40 мегапикселей.');}
 return blob;
}
export const toDataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
export async function fromDataURL(s){if(typeof s!=='string'||s.length>8*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s))throw Error('Повреждена фотография в копии.');const [head,data]=s.split(',');let bytes;try{bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));}catch{throw Error('Повреждено изображение.');}return checkImage(new Blob([bytes],{type:head.slice(5,head.indexOf(';'))}));}
