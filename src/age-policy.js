'use strict';
(function(root){
  const scoring = typeof module !== 'undefined' && module.exports ? require('./scoring.js') : root.NKQuestionnaireScoring;
  const copy = value => JSON.parse(JSON.stringify(value));
  const roles = ['self','parent','assisted'];
  function hasIndication(condition, context) {
    const diagnosed = context.diagnosisConfirmed === true ? new Set(context.diagnoses || []) : new Set();
    const chronic = ['csu','cindu','cold','cholinergic'].some(id => diagnosed.has(id));
    const urticaria = chronic || context.urticariaReported === true;
    switch(condition){
      case 'any': return true;
      case 'csu': return diagnosed.has('csu');
      case 'chronic_urticaria': return chronic;
      case 'angioedema': return context.recurrentAngioedema === true;
      case 'urticaria_or_angioedema': return urticaria || context.recurrentAngioedema === true;
      case 'cold_confirmed': return diagnosed.has('cold');
      case 'cholinergic_confirmed': return diagnosed.has('cholinergic');
      default: return false;
    }
  }
  function select(context, registry=root.NKInstrumentRegistry){
    const age=scoring.ageOn(context.dob,context.assessmentDate);
    const mode=age===null?null:registry.modes.find(m=>age>=m.min&&(m.maxExclusive===null||age<m.maxExclusive));
    const selected=[],excluded=[];
    for(const tool of registry.instruments){
      let reason='';
      if(age===null)reason='Для автоматического выбора нужна корректная дата рождения и дата оценки.';
      else if(age<tool.age.min||(tool.age.maxExclusive!==null&&age>=tool.age.maxExclusive))reason='Не входит в возрастной режим.';
      else if(!tool.conditions.some(c=>hasIndication(c,context)))reason='Нет подходящей формы заболевания или необходимых сведений.';
      if(reason){excluded.push({id:tool.id,reason});continue;}
      const warnings=[];
      if(age<18)warnings.push(tool.pediatricValidation.note);
      if(tool.id==='uas7'||tool.id==='uct')warnings.push(tool.age.note);
      if(tool.id==='pedsql-proxy'&&context.respondentRole!=='parent')warnings.push('Эта версия предназначена для ответа родителя; источник оценки должен быть указан как «Родитель».');
      if(!tool.calculationAvailable)warnings.push('Форма и расчёт ещё не подготовлены: доступно описание инструмента.');
      warnings.push('Используется для наблюдения и подготовки к консультации; не определяет диагноз и не меняет лечение.');
      selected.push({id:tool.id,tool,age,warnings,canCalculate:tool.calculationAvailable && roles.includes(context.respondentRole) &&
        (tool.id!=='pedsql-proxy'||context.respondentRole==='parent')});
    }
    return {age,mode:mode?.label||'Возраст не определён',descriptiveDiary:age===null||age<4,selected,excluded};
  }
  function interpretation(id,value,age,role){
    const limitations=['Рабочая языковая версия; независимая проверка применимости не завершена.'];
    if(role!=='self')limitations.push('Ответ получен от родителя или с его помощью; ограничения такого способа заполнения сохраняются.');
    if(age===null||!Number.isFinite(value))return {status:'unavailable',text:'Нет данных для интерпретации.',limitations};
    if(id==='uct'){
      if(age<18){
        limitations.push('Педиатрическая интерпретация по заданию автора; точные границы исследования и применимость родительского ответа требуют сверки.');
        if(value<=10)return {status:'pediatric_limited',rule:'pediatric-uct-le10',text:'Значение соответствует порогу недостаточного контроля ≤10, указанному в детском исследовании. Обсудите результат с врачом.',limitations};
        if(value===11)return {status:'uncertain',rule:'pediatric-uct-11',text:'11 баллов: результат между указанным детским порогом ≤10 и международным ориентиром ≥12. Однозначная оценка контроля не присваивается.',limitations};
        return {status:'pediatric_limited',rule:'pediatric-uct-ge12-reference',text:'Достигнут международный ориентир ≥12. Для ребёнка результат рассматривается с ограничениями педиатрической валидации и с учётом того, кто отвечал.',limitations};
      }
      return {status:'adult_reference',rule:'adult-uct-ge12',text:value>=12?'По международному ориентиру ≥12 результат соответствует контролируемому течению.':'Результат ниже международного ориентира 12: контроль недостаточен.',limitations};
    }
    if(id.startsWith('aect')){
      if(age<18)return {status:'pediatric_limited',rule:'aect-pediatric-no-cutoff',text:'Показан результат без взрослой классификации контроля. Детская валидация ограничена и требует сверки.',limitations};
      return {status:'adult_reference',rule:'adult-aect-ge10',text:value>=10?'По ориентиру сборника ≥10 результат соответствует хорошему контролю.':'Результат ниже ориентира 10 по сборнику.',limitations};
    }
    if(id==='ae-qol')return {status:age<18?'pediatric_limited':'descriptive',rule:'aeqol-continuous',
      text:'Чем выше результат, тем больше влияние отёков на качество жизни. Диагностический порог не назначается.'+(age<18?' Детская применимость ограничена и требует сверки.':''),limitations};
    return {status:'descriptive',rule:'no-invented-cutoffs',text:'Показатель наблюдения; автоматический диагноз или изменение лечения не предлагаются.',limitations};
  }
  function record(toolId,answers,context,registry=root.NKInstrumentRegistry){
    const selection=select(context,registry), item=selection.selected.find(s=>s.id===toolId);
    if(!item)return {status:'ineligible',score:null,details:'Инструмент не выбран для этого возраста и клинической ситуации.'};
    if(!item.canCalculate)return {status:'unavailable',score:null,details:'Нужны подготовленная форма и указание того, кто отвечает.'};
    if(typeof context.patientId!=='string'||!context.patientId.trim()||typeof context.timezone!=='string'||!context.timezone.trim())
      return {status:'invalid',score:null,details:'Не указан пациент или часовой пояс.'};
    const result=scoring.score(item.tool.definitionId,answers);
    const effectiveId=['uas7','aas7','aas28'].includes(toolId)?item.tool.definitionId:toolId;
    return {status:result.status,score:result.score,details:result.details,record:{
      patientId:context.patientId,instrumentId:effectiveId,requestedAggregate:effectiveId!==toolId?toolId:null,
      instrumentVersion:item.tool.languageVersion.version,language:item.tool.languageVersion.language,
      policyVersion:registry.version,assessmentDate:context.assessmentDate,dobAtAssessment:context.dob,
      ageAtAssessment:selection.age,ageModeAtAssessment:selection.mode,respondentRole:context.respondentRole,
      timezone:context.timezone,period:effectiveId!==toolId?'Последние 24 часа':item.tool.period,
      answers:copy(answers),result:copy(result),interpretation:result.score===null?null:interpretation(effectiveId,result.score,selection.age,context.respondentRole),
      pregnancy:context.pregnancy===true,lactation:context.lactation===true,
      validationStatus:copy(item.tool.pediatricValidation),sourceIds:[...item.tool.sourceIds],
      workingTranslation:true
    }};
  }
  function historyGroups(records){
    const groups=new Map();
    for(const record of records){
      const fields=['patientId','instrumentId','instrumentVersion','language','period','respondentRole','policyVersion','timezone'];
      const key=JSON.stringify(fields.map(k=>record[k]??null).concat(record.ageAtAssessment<18?'child':'adult'));
      if(!groups.has(key))groups.set(key,{key,records:[]});
      groups.get(key).records.push(copy(record));
    }
    return {groups:[...groups.values()],notice:groups.size>1?'Разные инструменты, версии, периоды, возрастные режимы или способы заполнения показаны отдельно. Баллы не пересчитываются.':''};
  }
  const api={select,hasIndication,interpretation,record,historyGroups};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.NKAgePolicy=api;
})(typeof globalThis!=='undefined'?globalThis:this);
