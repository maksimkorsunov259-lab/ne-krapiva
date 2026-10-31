'use strict';
(function (root) {
  const missing = value => value === undefined || value === null || value === '';
  const fail = (status, details) => ({status, score: null, details});
  function sumSingles(answers, keys, max) {
    if (keys.some(key => missing(answers[key]))) return fail('incomplete', 'Заполнены не все ответы.');
    if (keys.some(key => !Number.isInteger(answers[key]) || answers[key] < 0 || answers[key] > max))
      return fail('invalid', 'Недопустимый ответ.');
    return {status: 'complete', score: keys.reduce((sum, key) => sum + answers[key], 0)};
  }
  function score(id, answers = {}) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return fail('invalid', 'Некорректный набор ответов.');
    if (id === 'uas24') return sumSingles(answers, ['wheals', 'itch'], 3);
    if (id === 'uct4w') return sumSingles(answers, ['symptoms', 'life', 'treatment', 'control'], 4);
    if (id === 'aect3m' || id === 'aect4w-working')
      return sumSingles(answers, ['frequency', 'life', 'unpredictability', 'control'], 4);
    if (id === 'aeqol4w') {
      const keys=Array.from({length:17},(_,i)=>'q'+(i+1));
      const known=keys.filter(k=>!missing(answers[k]));
      if(known.some(k=>!Number.isInteger(answers[k])||answers[k]<0||answers[k]>4))return fail('invalid','Недопустимый ответ AE-QoL.');
      const domainKeys={functioning:[1,2,3,4],fatigueMood:[6,7,8,9,10],fearsShame:[12,13,14,15,16,17],nutrition:[5,11]};
      const normalized=ks=>{
        const answered=ks.filter(k=>!missing(answers[k]));
        return {score:answered.length?Math.round(answered.reduce((s,k)=>s+answers[k],0)*1000/(4*answered.length))/10:null,answered:answered.length,total:ks.length};
      };
      const domains=Object.fromEntries(Object.entries(domainKeys).map(([name,nums])=>{
        const result=normalized(nums.map(n=>'q'+n));
        if(result.total-result.answered>1)result.score=null;
        return [name,result];
      }));
      if(known.length<13)return {...fail('incomplete','Для общего результата AE-QoL нужно минимум 13 из 17 ответов.'),answered:known.length,total:17,domains};
      return {status:known.length===17?'complete':'complete_with_missing',...normalized(keys),maximum:100,domains};
    }
    if (id !== 'aas24') return fail('invalid', 'Неизвестный инструмент.');
    if (missing(answers.presence) || answers.presence === 'unknown') return fail('incomplete', 'Не указано наличие или отсутствие отёка.');
    const detailKeys = ['severity', 'activity', 'appearance', 'overall'];
    if (answers.presence === 'no') {
      // A stored contradiction is rejected; the UI clears the hidden answers when switching to No.
      if ((Array.isArray(answers.intervals) && answers.intervals.length) || detailKeys.some(key => !missing(answers[key])))
        return fail('conflict', 'Отёк отрицается, но его подробности заполнены.');
      return {status: 'complete', score: 0};
    }
    if (answers.presence !== 'yes') return fail('invalid', 'Недопустимый ответ о наличии отёка.');
    if (missing(answers.intervals) || (Array.isArray(answers.intervals) && !answers.intervals.length))
      return fail('incomplete', 'Не выбраны промежутки времени.');
    if (!Array.isArray(answers.intervals) || new Set(answers.intervals).size !== answers.intervals.length ||
        answers.intervals.some(v => !['00-08', '08-16', '16-24'].includes(v)))
      return fail('invalid', 'Некорректные промежутки времени.');
    const subtotal = sumSingles(answers, detailKeys, 3);
    return subtotal.status === 'complete' ? {status: 'complete', score: subtotal.score + answers.intervals.length} : subtotal;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function ageOn(dob, on) {
    if (!validDate(dob) || !validDate(on) || dob > on) return null;
    return Number(on.slice(0, 4)) - Number(dob.slice(0, 4)) - (on.slice(5) < dob.slice(5) ? 1 : 0);
  }
  function aggregate(id, entries, endDate, patientId) {
    const config = {uas7: ['uas24', 7, 42], aas7: ['aas24', 7, 105], aas28: ['aas24', 28, 420]}[id];
    if (!config || !Array.isArray(entries) || !validDate(endDate) || typeof patientId !== 'string' || !patientId)
      return fail('invalid', 'Некорректные параметры периода.');
    const [source, days, maximum] = config;
    const endMs = new Date(endDate + 'T00:00:00Z').getTime();
    const dates = Array.from({length: days}, (_, i) => new Date(endMs - (days - i - 1) * 86400000).toISOString().slice(0, 10));
    const relevant = [];
    for (const entry of entries) {
      if (!entry || !validDate(entry.date)) return fail('invalid', 'Некорректная дата записи.');
      if (!dates.includes(entry.date)) continue;
      if (entry.patientId !== patientId) return fail('conflict', 'В периоде смешаны пациенты.');
      if (entry.instrumentId !== source) return fail('conflict', 'В периоде смешаны инструменты.');
      relevant.push(entry);
    }
    if (new Set(relevant.map(e => e.date)).size !== relevant.length) return fail('conflict', 'Есть несколько записей за одни сутки.');
    for (const key of ['instrumentVersion', 'respondentRole', 'timezone']) {
      if (relevant.some(e => typeof e[key] !== 'string' || !e[key])) return fail('invalid', 'Не заполнены сведения о версии или способе заполнения.');
      if (new Set(relevant.map(e => e[key])).size > 1) return fail('conflict', 'Изменилась версия, способ заполнения или часовой пояс; период требует проверки.');
    }
    const results = relevant.map(e => score(source, e.answers));
    if (results.some(r => ['invalid', 'conflict'].includes(r.status))) return fail('invalid', 'Есть некорректная суточная запись.');
    const complete = results.filter(r => r.status === 'complete');
    if (complete.length !== days) return {...fail('incomplete', `Полностью заполнено ${complete.length} из ${days} суток.`), completedDays: complete.length, expectedDays: days};
    return {status: 'complete', score: complete.reduce((sum, r) => sum + r.score, 0), maximum, completedDays: days, startDate: dates[0], endDate};
  }
  const api = {score, aggregate, ageOn};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NKQuestionnaireScoring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
