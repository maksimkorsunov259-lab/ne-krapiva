"""Build a dependency-free static PWA. QR is generated at build time, never remotely."""
import hashlib,json,pathlib,argparse,shutil
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--url',default='https://maksimkorsunov259-lab.github.io/ne-krapiva/');args=parser.parse_args()
if not args.url.startswith('https://') or not args.url.endswith('/'):raise SystemExit('Use the final HTTPS directory URL ending in /.')
version=json.loads((ROOT/'package.json').read_text())['version']
(ROOT/'src/config.js').write_text('export const VERSION='+json.dumps(version)+';\nexport const APP_URL='+json.dumps(args.url)+';\n')
import qrcode
qrcode.make(args.url,error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=8,border=4).save(ROOT/'assets/app-qr.png')
files=['index.html','style.css','manifest.webmanifest']+[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'src').glob('*.js'))]+[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'assets').glob('*.png'))]
build=hashlib.sha256(b''.join((ROOT/f).read_bytes() for f in files)).hexdigest()[:12]
sw='''const PREFIX='ne-krapiva:'+new URL(self.registration.scope).pathname+':';
const CACHE=PREFIX+BUILD;
const FILES=ASSETS;
const URLS=FILES.map(f=>new URL(f,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(URLS);})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const u=new URL(event.request.url);const shell=new URL('index.html',self.registration.scope).href;let target=u.href;
if(event.request.mode==='navigate'&&(u.href.split('?')[0]===self.registration.scope||u.pathname===new URL(shell).pathname))target=shell;
if(!URLS.includes(target))return;event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(target)||fetch(event.request);})());});
'''.replace('BUILD',json.dumps(build)).replace('ASSETS',json.dumps(files))
(ROOT/'sw.js').write_text(sw)
(ROOT/'version.json').write_text(json.dumps({'version':version,'build':build,'url':args.url},ensure_ascii=False,indent=2))
print('Built',version,build,len(files),'files')

dist=ROOT/'dist'
if dist.exists():shutil.rmtree(dist)
for f in files+['sw.js','version.json']:
 target=dist/f;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/f,target)
(dist/'.nojekyll').touch()
