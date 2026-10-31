export const FORMAT='ne-krapiva.backup';
export const SCHEMA=1;
export const clone=value=>structuredClone(value);
export const uid=()=>crypto.randomUUID();
export const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const TABLES=['patients','days','plans','intakes','edema','factors','assessments','photos','emergency','questions','drafts'];
export const empty=()=>({schema:SCHEMA,revision:0,updatedAt:new Date().toISOString(),activePatient:null,...Object.fromEntries(TABLES.map(k=>[k,[]]))});
export function patient(s,id){return s.patients.find(p=>p.id===id);}
export function context(p,date=today(),role=p.respondent){return {patientId:p.id,dob:p.dob,assessmentDate:date,respondentRole:role,
 diagnosisConfirmed:p.confirmed===true,diagnoses:p.diagnoses||[],urticariaReported:p.urticaria===true,recurrentAngioedema:p.angio===true,pregnancy:p.pregnancy===true,lactation:p.lactation===true,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'};}
export function own(s,table,id){return s[table].filter(r=>r.patientId===id);}
export function put(s,table,item,expected=null){
 const index=s[table].findIndex(r=>r.id===item.id);
 if(index>=0&&expected!==null&&s[table][index].updatedAt!==expected)throw Error('Запись изменена в другой вкладке. Откройте её заново; введённый текст пока сохранён на экране.');
 const next={...clone(item),updatedAt:new Date().toISOString()};
 if(index<0)s[table].push(next);else s[table][index]=next;return next;
}
export function erasePatient(s,id){
 const photoIds=own(s,'photos',id).map(p=>p.id);
 for(const k of TABLES)s[k]=s[k].filter(r=>k==='patients'?r.id!==id:r.patientId!==id);
 if(s.activePatient===id)s.activePatient=s.patients[0]?.id||null;return photoIds;
}
export function activePlans(s,id,date){
 const map=new Map();for(const p of own(s,'plans',id).filter(p=>p.start<=date)){
  const old=map.get(p.lineage);if(!old||p.start>old.start||(p.start===old.start&&p.createdAt>old.createdAt))map.set(p.lineage,p);
 }return [...map.values()].filter(p=>!p.end||p.end>=date);
}
export function savePlan(s,p){
 if(!p.drug?.trim()||!dateOK(p.start))throw Error('Укажите препарат и дату действия назначения.');
 if(p.end&&(!dateOK(p.end)||p.end<p.start))throw Error('Дата окончания раньше начала.');
 if(p.supersedes&&!own(s,'plans',p.patientId).some(x=>x.id===p.supersedes))throw Error('Исходное назначение не найдено.');
 const row={...clone(p),id:uid(),lineage:p.lineage||uid(),createdAt:new Date().toISOString()};s.plans.push(row);return row;
}
export function saveDay(s,row){
 if(!dateOK(row.date)||row.date>today())throw Error('Проверьте дату записи.');
 const duplicate=own(s,'days',row.patientId).find(r=>r.date===row.date&&r.id!==row.id);
 if(duplicate)throw Error('За этот день уже есть запись. Откройте её для изменения.');
 return put(s,'days',row,row.expected??null);
}
export function period(s,id,from,to){
 if(!dateOK(from)||!dateOK(to)||from>to)throw Error('Начало периода должно быть не позднее окончания.');
 const inside=d=>d>=from&&d<=to;
 const rows={};for(const k of ['days','intakes','edema','factors','assessments','photos'])rows[k]=own(s,k,id).filter(r=>inside(r.date)).sort((a,b)=>a.date.localeCompare(b.date));
 const changes=own(s,'plans',id).filter(r=>inside(r.start));
 rows.plans=[...new Map([...activePlans(s,id,from),...changes].map(r=>[r.id,r])).values()];
 const factors=new Map();for(const r of rows.factors){const key=r.name.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');if(!factors.has(key))factors.set(key,{name:r.name,yes:0,no:0,unknown:0});factors.get(key)[['yes','no'].includes(r.outcome)?r.outcome:'unknown']++;}
 rows.factorSummary=[...factors.values()].map(f=>({...f,repeat:f.yes+f.no>=3&&f.yes>=2}));
 return {...rows,from,to,totalDays:Math.round((Date.parse(to)-Date.parse(from))/86400000)+1,treatmentChanged:changes.length>0,questions:own(s,'questions',id)[0]?.text||''};
}
const SAFE_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/;
const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function validateState(value){
 if(!isObject(value)||value.schema!==SCHEMA)throw Error('Неподдерживаемая версия данных.');
 for(const k of TABLES){if(!Array.isArray(value[k])||value[k].length>100000)throw Error('Повреждён раздел: '+k);const ids=new Set();for(const r of value[k]){if(!isObject(r)||!SAFE_ID.test(r.id||'')||ids.has(r.id))throw Error('Некорректные идентификаторы: '+k);ids.add(r.id);}}
 const ids=new Set(value.patients.map(p=>p.id));
 for(const p of value.patients){if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.dob!=='string'||(p.dob&&!dateOK(p.dob))||!Array.isArray(p.diagnoses)||!['self','parent','assisted',''].includes(p.respondent))throw Error('Некорректный профиль пациента.');}
 for(const k of TABLES.filter(k=>k!=='patients'))for(const r of value[k]){if(!ids.has(r.patientId))throw Error('Запись ссылается на отсутствующего пациента.');if(['days','intakes','edema','factors','assessments','photos'].includes(k)&&!dateOK(r.date))throw Error('Некорректная дата записи.');}
 for(const r of value.days)if(!isObject(r.answers)||!isObject(r.context))throw Error('Повреждена суточная запись.');
 const dayKeys=value.days.map(r=>r.patientId+':'+r.date);if(new Set(dayKeys).size!==dayKeys.length)throw Error('В копии несколько суточных записей за одну дату.');
 for(const r of value.plans)if(typeof r.drug!=='string'||!r.drug.trim()||!dateOK(r.start)||!SAFE_ID.test(r.lineage||'')||(r.end&&(!dateOK(r.end)||r.end<r.start)))throw Error('Повреждено назначение.');
 for(const r of value.intakes)if(typeof r.drug!=='string'||!['taken','skipped','unknown'].includes(r.status))throw Error('Повреждена запись о препарате.');
 for(const r of value.factors)if(typeof r.name!=='string'||!r.name.trim()||!['yes','no','unknown'].includes(r.outcome))throw Error('Повреждена запись о факторе.');
 for(const r of value.assessments)if(typeof r.instrumentId!=='string'||!isObject(r.answers)||!isObject(r.result)||!Number.isFinite(r.result.score)||!Number.isInteger(r.ageAtAssessment)||r.ageAtAssessment<0||r.ageAtAssessment>150||!['self','parent','assisted'].includes(r.respondentRole))throw Error('Повреждена оценка.');
 for(const r of value.photos)if(!['image/png','image/jpeg','image/webp'].includes(r.mime)||!['symptoms','emergency'].includes(r.kind))throw Error('Неподдерживаемая фотография.');
 const textFields={patients:['name','dob','respondent','onset','notes'],days:['description','swelling','swellingText','comment'],plans:['drug','dose','schedule','note','start','end','createdAt'],intakes:['drug','status','time','amount','unit','note'],edema:['location','duration','details'],factors:['name','outcome','note'],photos:['caption'],emergency:['text','date'],questions:['text']};
 for(const [table,fields] of Object.entries(textFields))for(const r of value[table])for(const key of fields)if(r[key]!==undefined&&r[key]!==null&&(typeof r[key]!=='string'||r[key].length>20000))throw Error('Некорректный текст в разделе '+table);
 for(const p of value.patients)if(p.dob>today()||p.diagnoses.some(x=>!['csu','cindu','cold','cholinergic'].includes(x)))throw Error('Некорректные сведения о пациенте.');
 for(const r of value.days){if(r.context.patientId!==r.patientId||(r.uasRecord&&r.uasRecord.patientId!==r.patientId))throw Error('Суточная запись ссылается на другого пациента.');if(!['','yes','no','unknown'].includes(r.swelling||''))throw Error('Некорректная отметка об отёке.');}
 for(const r of value.intakes){if(r.planId&&!value.plans.some(p=>p.id===r.planId&&p.patientId===r.patientId))throw Error('Назначение относится к другому пациенту.');if(r.planSnapshot&&r.planSnapshot.patientId!==r.patientId)throw Error('Копия назначения относится к другому пациенту.');}
 for(const r of value.emergency)if(r.photoId&&!value.photos.some(p=>p.id===r.photoId&&p.patientId===r.patientId))throw Error('Фотография плана относится к другому пациенту.');
 for(const r of value.drafts)if(typeof r.key!=='string'||!isObject(r.values))throw Error('Повреждён черновик.');
 if(value.activePatient!==null&&!ids.has(value.activePatient))throw Error('Не найден выбранный пациент.');
 const clean=empty();for(const k of TABLES)clean[k]=clone(value[k]);clean.activePatient=value.activePatient;clean.revision=Number.isSafeInteger(value.revision)?value.revision:0;
 return clean;
}
export function subset(s,ids,withPhotos){
 const out=empty();out.patients=s.patients.filter(p=>ids.includes(p.id));for(const k of TABLES.filter(k=>k!=='patients'))out[k]=s[k].filter(r=>ids.includes(r.patientId));
 out.drafts=[];if(!withPhotos){out.photos=[];out.emergency=out.emergency.map(r=>({...r,photoId:null}));}
 out.activePatient=out.patients[0]?.id||null;return clone(out);
}
export function mergeBackup(s,incoming,replace){
 const data=validateState(incoming),map=new Map(),removed=[];
 if(replace){for(const p of data.patients)if(patient(s,p.id))removed.push(...erasePatient(s,p.id));}
 else{for(const k of TABLES)for(const r of data[k])map.set(r.id,uid());for(const r of data.plans)if(!map.has(r.lineage))map.set(r.lineage,uid());}
 const remap=id=>map.get(id)||id;
 for(const k of TABLES)for(const original of data[k]){
  const r=clone(original);if(!replace){r.id=remap(r.id);if(r.patientId)r.patientId=remap(r.patientId);for(const key of ['lineage','supersedes','planId','photoId'])if(r[key])r[key]=remap(r[key]);if(r.context?.patientId)r.context.patientId=remap(r.context.patientId);if(r.uasRecord?.patientId)r.uasRecord.patientId=remap(r.uasRecord.patientId);if(r.planSnapshot){r.planSnapshot.id=remap(r.planSnapshot.id);r.planSnapshot.patientId=remap(r.planSnapshot.patientId);r.planSnapshot.lineage=remap(r.planSnapshot.lineage);}}
  if(s[k].some(x=>x.id===r.id))throw Error('Совпадают идентификаторы разных дневников. Выберите добавление отдельными пациентами.');s[k].push(r);
 }
 s.activePatient=s.activePatient||remap(data.activePatient);validateState(s);return {removed,map};
}
