"""Real Chromium PWA integration tests; all profiles and photos are synthetic."""
import functools,http.server,threading,pathlib,tempfile,shutil,json,subprocess,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
work=pathlib.Path(tempfile.mkdtemp(prefix='ne-krapiva-test-'));shutil.copytree(ROOT,work/'site')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(work/'site')))
threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}/'
results=[]
def passed(name):results.append(name);print('PASS',name,flush=True)
def snapshot(page):return page.evaluate("async()=>{const d=await import('./src/storage.js');return await d.read()}")
def act(page,name):page.locator(f'[data-action="{name}"]').first.click()
def nav(page,route):page.locator(f'nav [data-route="{route}"]').click()
def create(page,name,dob,adult=True):
 if page.locator('#overlay').is_visible():page.locator('#overlay [data-action=profile]:not([data-id])').click()
 else:page.locator('[data-action=profile]').first.click()
 f=page.locator('#profile-form');f.locator('[name=name]').fill(name);f.locator('[name=dob]').fill(dob);f.locator('[name=respondent]').select_option('self' if adult else 'parent');f.locator('[name=urticaria]').check();f.locator('[name=angio]').check();f.locator('[name=confirmed]').check();f.locator('[name=diagnoses][value=csu]').check();f.get_by_role('button',name='Сохранить профиль',exact=True).click();page.wait_for_function("!document.querySelector('#overlay').open")
def modalclose(page):page.locator('#overlay .dialoghead [data-action=close]').click()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ctx=browser.new_context(accept_downloads=True);page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE);page.evaluate('navigator.serviceWorker.ready');page.reload();page.get_by_role('button',name='Создать профиль пациента').wait_for()
  # Full empty state, profile and a real day.
  create(page,'Тестовый взрослый','1990-01-01');patient_id=snapshot(page)['activePatient']
  f=page.locator('#day-form');f.locator('[name=q_wheals]').select_option('1');f.locator('[name=q_itch]').select_option('2');f.locator('[name=swelling][value=no]').check();f.locator('[name=comment]').fill('<img src=x onerror=alert(1)> тестовая запись');f.get_by_role('button',name='Сохранить запись',exact=True).click();page.wait_for_timeout(100);page.reload();page.locator('[name=q_wheals]').wait_for();assert page.locator('[name=q_wheals]').input_value()=='1';assert len(snapshot(page)['days'])==1;passed('IndexedDB persists profile and day after reload; no seeded patients')
  # Save a partial edited day: absent itch must be null.
  page.locator('[name=q_itch]').select_option('');page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(100);s=snapshot(page);assert s['days'][0]['uasRecord']['result']['score'] is None;passed('Partial daily record stays incomplete, not zero')
  # Draft survives emergency overlay and switching sections, then reload.
  page.locator('[name=comment]').fill('Черновик, который нельзя потерять');act(page,'emergency');assert page.locator('#overlay a[href="tel:112"]').count()==1;modalclose(page);assert page.locator('[name=comment]').input_value()=='Черновик, который нельзя потерять';nav(page,'guide');page.reload();nav(page,'today');assert page.locator('[name=comment]').input_value()=='Черновик, который нельзя потерять';passed('Draft survives emergency overlay, navigation and reload')
  # Submitting another form must not discard this draft.
  act(page,'intake');f=page.locator('#intake-form');f.locator('[name=drug]').fill('Тестовый препарат');f.locator('[name=amount]').fill('1');f.locator('[name=unit]').fill('таблетка');f.get_by_role('button',name='Сохранить приём').click();page.wait_for_timeout(100);assert page.locator('[name=comment]').input_value()=='Черновик, который нельзя потерять';page.locator('[name=q_itch]').select_option('2');page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(100);passed('Parallel modal save preserves the daily draft')
  # Prescriptions are versioned, actual intake linked to immutable version.
  nav(page,'guide');page.get_by_role('button',name='Индивидуальный план врача',exact=True).click();page.get_by_role('button',name='Добавить назначение',exact=True).click();f=page.locator('#plan-form');f.locator('[name=drug]').fill('Назначение A');f.locator('[name=dose]').fill('Тестовая доза A');f.get_by_role('button',name='Сохранить назначение').click();page.wait_for_timeout(100);plan_id=snapshot(page)['plans'][0]['id'];nav(page,'today');act(page,'intake');f=page.locator('#intake-form');f.locator('[name=planId]').select_option(plan_id);assert f.locator('[name=amount]').input_value()=='';f.locator('[name=drug]').fill('Назначение A');f.locator('[name=amount]').fill('2');f.get_by_role('button',name='Сохранить приём').click();page.wait_for_timeout(100)
  nav(page,'guide');page.get_by_role('button',name='Индивидуальный план врача',exact=True).click();page.get_by_role('button',name='Изменить назначение',exact=True).click();f=page.locator('#plan-form');f.locator('[name=dose]').fill('Тестовая доза B');f.get_by_role('button',name='Сохранить назначение').click();page.wait_for_timeout(100);s=snapshot(page);assert len(s['plans'])==2;assert s['intakes'][1]['planSnapshot']['dose']=='Тестовая доза A';passed('Plan versions and actual dose remain separate')
  # Questionnaire and missing answers.
  nav(page,'control');page.locator('[data-action=questionnaire][data-id=uct]').click();f=page.locator('#assessment-form');f.get_by_role('button',name='Сохранить результат').click();assert f.locator('.form-error').is_visible();assert len(snapshot(page)['assessments'])==0
  for name in ['symptoms','life','treatment','control']:f.locator(f'[name=q_{name}]').select_option('4')
  f.get_by_role('button',name='Сохранить результат').click();page.wait_for_timeout(100);assert snapshot(page)['assessments'][0]['result']['score']==16
  page.locator('[data-action=questionnaire][data-id=aas7]').click();f=page.locator('#assessment-form');f.locator('[name=q_presence]').select_option('no');f.get_by_role('button',name='Сохранить результат').click();page.wait_for_timeout(100);assert snapshot(page)['assessments'][1]['result']['score']==0;passed('UCT and daily AAS save correct results; incomplete UCT rejected')
  # Reject a file that only pretends to have a PNG signature.
  assert page.evaluate("async()=>{const d=await import('./src/storage.js');try{await d.checkImage(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}));return false}catch{return true}}")
  passed('Corrupt image with a PNG header rejected before saving')
  # A genuine photo in the same transaction, optional in report.
  nav(page,'diary');act(page,'photo');f=page.locator('#photo-form');f.locator('[name=image]').set_input_files(str(ROOT/'assets/icon-180.png'));f.locator('[name=caption]').fill('Тестовое изображение');f.get_by_role('button',name='Сохранить фотографию').click();page.wait_for_timeout(100);assert len(snapshot(page)['photos'])==1
  page.locator('[data-route=report]').click();assert not page.locator('[name=reportPhotos]').is_checked();f=page.locator('#questions-form');f.locator('[name=text]').fill('Тестовый вопрос врачу');f.get_by_role('button',name='Сохранить вопросы').click();page.wait_for_timeout(100);assert 'Тестовый вопрос врачу' in page.locator('#report-content').inner_text();assert page.locator('#report-content').get_by_text('Тестовый препарат',exact=False).count()>0
  page.evaluate('window.print=()=>{window.printCalled=true}');act(page,'print');assert page.locator('#report-images img').count()==0
  page.locator('[name=reportPhotos]').check();act(page,'print');page.wait_for_function('window.printCalled===true');page.locator('#report-images img').wait_for();page.pdf(path=str(work/'report.pdf'),format='A4');assert (work/'report.pdf').stat().st_size>5000;passed('Doctor report contains all entries and saved questions; photos opt in; PDF renders')
  # Backup with photos, add separate patient, no leakage; nested UAS reference remapped.
  nav(page,'guide');page.locator('[data-route=data]').click();act(page,'backup');page.locator('[data-action=download-backup]').wait_for()
  with page.expect_download() as info:act(page,'download-backup')
  backup=work/'backup.json';info.value.save_as(str(backup));b=json.loads(backup.read_text());assert len(b['images'])==1;modalclose(page);page.locator('[name=importFile]').set_input_files(str(backup));page.locator('[data-action=confirm-import][data-mode=add]').click();page.wait_for_timeout(150);s=snapshot(page);assert len(s['patients'])==2;new_id=next(x['id'] for x in s['patients'] if x['id']!=patient_id);new_day=next(x for x in s['days'] if x['patientId']==new_id);assert new_day['uasRecord']['patientId']==new_id;assert len(s['photos'])==2;passed('JSON round-trip includes photos and remaps all patient identities')
  # Corruption rejected without writing anything.
  before=s['revision'];b['state']['days'][0]['context']['patientId']='missing';bad=work/'bad.json';bad.write_text(json.dumps(b));page.locator('[name=importFile]').set_input_files(str(bad));page.wait_for_timeout(150);assert snapshot(page)['revision']==before;passed('Corrupt cross-patient backup rejected atomically')
  # Child profile auto excludes all formal scales in 0–3 and shows own empty day.
  act(page,'patients');create(page,'Малыш','2025-01-01',False);child_id=snapshot(page)['activePatient'];assert page.locator('[name=q_wheals]').count()==0;assert page.locator('textarea[name=description]').input_value()=='';nav(page,'control');assert 'Пока — описательный дневник' in page.locator('main').inner_text();assert page.locator('[data-action=questionnaire]').count()==0;passed('Multiple patients stay isolated; toddler gets descriptive diary')
  # Delete patient removes their own records and photos only.
  nav(page,'guide');page.locator('[data-route=data]').click();page.locator('[name=deletePatient]').select_option(new_id);act(page,'delete-patient');act(page,'confirm-patient-delete');page.wait_for_timeout(100);s=snapshot(page);assert len(s['patients'])==2;assert all(x['patientId']!=new_id for x in s['days']);assert len(s['photos'])==1;passed('Patient deletion is explicit and isolates other diaries')
  page.locator('#patient-select').select_option(patient_id);nav(page,'today');page.locator('[name=comment]').fill('Конфликтный черновик');page.wait_for_timeout(750)
  # Simulate an independent writer without BroadcastChannel to exercise revision guard.
  page.evaluate("async()=>{const d=await import('./src/storage.js');const s=await d.read();s.patients[0].notes='Из другой вкладки';await d.write(s,s.revision)}")
  page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(100);assert page.locator('#day-form .form-error').is_visible();assert page.locator('[name=comment]').input_value()=='Конфликтный черновик';assert snapshot(page)['patients'][0]['notes']=='Из другой вкладки';act(page,'reload-state');page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(150);assert snapshot(page)['days'][0]['comment']=='Конфликтный черновик';passed('Concurrent writes detected without overwriting or losing typed text')
  # Deliberate quota/storage failure returns error, no optimistic UI success.
  page.locator('[name=comment]').fill('Не должно сохраниться');page.evaluate("()=>{window.realPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Тест: место закончилось','QuotaExceededError')}}");page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(100);assert 'место закончилось' in page.locator('#day-form .form-error').inner_text();assert snapshot(page)['days'][0]['comment']=='Конфликтный черновик';page.evaluate('()=>{IDBObjectStore.prototype.put=window.realPut}');page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(100);passed('Write failure preserves existing data and unsaved form; no false success')
  # Offline cache holds UI and emergency; patient state still local.
  ctx.set_offline(True);page.reload();page.locator('[name=q_wheals]').wait_for();act(page,'emergency');assert page.locator('#overlay a[href="tel:103"]').count()==1;modalclose(page);assert len(snapshot(page)['patients'])==2;ctx.set_offline(False);passed('Installed shell and emergency plan work offline with persisted data')
  # Layout checks on phone and desktop; no horizontal scroll.
  page.set_viewport_size({'width':390,'height':844});nav(page,'today');page.screenshot(path=str(ROOT/'docs/today-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.evaluate('window.scrollTo(0,700)');assert page.locator('#patient-select').bounding_box()['y']>=0
  page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path=str(ROOT/'docs/today-desktop.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');passed('Mobile and desktop fit; patient picker stays fixed during scrolling')
  # Properly isolated manifest identity; update leaves state and unrelated caches intact.
  manifest=page.evaluate("async()=>await(await fetch('./manifest.webmanifest')).json()");assert manifest['id']=='./' and manifest['scope']=='./';page.evaluate("caches.open('em-moloko:test')")
  cfg=work/'site/src/config.js';cfg.write_text(cfg.read_text().replace('1.0.0','1.0.1'));sw=work/'site/sw.js';sw.write_text(sw.read_text().replace('const CACHE=PREFIX+','const CACHE=PREFIX+"test-update-"+'))
  page.evaluate("async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()}");page.wait_for_function("!document.getElementById('update').hidden")
  page.locator('[name=comment]').fill('Черновик перед обновлением');page.locator('#update-button').click();page.wait_for_timeout(100);assert page.locator('#update').is_visible();page.get_by_role('button',name='Сохранить изменения',exact=True).click();page.wait_for_timeout(100);
  with page.expect_navigation(wait_until='domcontentloaded'):page.locator('#update-button').click()
  page.wait_for_function("document.querySelector('[name=comment]')?.value==='Черновик перед обновлением'");assert (snapshot(page)['days'][0]['comment'])=='Черновик перед обновлением';assert page.evaluate("caches.has('em-moloko:test')");passed('Update waits for open edits, preserves records and unrelated app cache')
  assert not errors,errors
  browser.close()
 (ROOT/'docs/verification.json').write_text(json.dumps({'passed':results,'browserErrors':errors},ensure_ascii=False,indent=2))
 print('SUCCESS:',len(results),'integration scenarios')
finally:server.shutdown();shutil.rmtree(work)
