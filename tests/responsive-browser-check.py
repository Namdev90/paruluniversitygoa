#!/usr/bin/env python3
"""Render the real web DOM/CSS/JS with fixture-only transport and storage.
Uses set_content because this environment restricts URL navigation. Production
CSP is omitted only from the in-memory test wrapper, never from shipped files.
Requires Python Playwright and a local Chromium (NAVRANG_CHROMIUM overrides).
No live accounts, attendee records, or server mutations are used.
"""
import argparse, base64, json, mimetypes, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
STAMP = '2026-10-17T11:00:00Z'
RECORDS = [dict(id=f'DEMO{i:04d}',name=f'Synthetic Student {i:02d}',amount=100,quantity=1,refund=0,description='Transaction completed successfully',eligible=True,reason='') for i in range(1,61)]
ENTRIES = [dict(ticketId=r['id'],name=r['name'],checker='Demo Checker',checkerId='11111111-1111-4111-8111-111111111111',deviceId='synthetic-preview',at=STAMP,seq=i,source='Synthetic UI fixture') for i,r in enumerate(RECORDS[:40],1)]
PROFILE = {'admin':dict(role='admin',name='Synthetic Administrator',active=True,reports=True,scanner=True,helpdesk=True,station='',nameConfirmed=True),
 'faculty':dict(role='checker',name='Demo Faculty',checkerId='22222222-2222-4222-8222-222222222222',method='google',active=True,reports=True,scanner=False,helpdesk=False,station='',nameConfirmed=True),
 'checker':dict(role='checker',name='Demo Checker',checkerId='11111111-1111-4111-8111-111111111111',method='google',active=True,reports=False,scanner=True,helpdesk=False,station='checker',nameConfirmed=True)}
STATS = dict(total=60,eligible=60,admitted=40,remaining=20,blocked=0,lastMinute=0,lastFiveMinutes=0,duplicateAttempts=2,blockedAttempts=1)
SUMMARY = dict(registered=12,eligible=12,blocked=0,attended=9,registeredAttended=8,organizerConfirmed=1,noShow=4,serverIssues=1,issueTickets=1,duplicateAttempts=2,pendingHelpDesk=0,generatedAt=STAMP)
def run():
 parser=argparse.ArgumentParser();parser.add_argument('--output',default=str(ROOT/'.build/responsive-review'));parser.add_argument('--baseline',action='store_true');parser.add_argument('--sizes',default='320x640,360x800,390x844,768x1024,1024x768,1366x768,1920x1080,640x360');args=parser.parse_args()
 out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
 assets=ROOT/'app/assets'
 markup=(assets/'index.html').read_text()
 scripts=re.findall(r'<script[^>]+src="([^"]+)"',markup)
 styles=re.findall(r'<link[^>]+href="([^"]+\.css)"',markup)
 markup=re.sub(r'<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>','',markup)
 markup=re.sub(r'<script.*?</script>|<link[^>]+rel="stylesheet"[^>]*>','',markup,flags=re.S)
 images={}
 for path in (assets/'art').iterdir():
  if path.suffix in ('.png','.jpg','.webp','.svg'):
   images['art/'+path.name]='data:'+mimetypes.guess_type(path.name)[0]+';base64,'+base64.b64encode(path.read_bytes()).decode()
 for src,data in images.items():markup=markup.replace('src="'+src+'"','src="'+data+'"')
 reports=[]; failures=[]; errors=[]; unexpected=[]
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path=os.getenv('NAVRANG_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
   def open_source(page,role):
    # Host navigation is restricted here. This local render uses the unchanged
    # DOM/CSS/JS source with fixture-only storage/transport, not production login.
    page.set_content(markup)
    for style in styles:page.add_style_tag(content=(assets/style).read_text())
    page.evaluate("""f=>{
      const mem=new Map();const storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k),clear:()=>mem.clear()};
      Object.defineProperty(window,'sessionStorage',{value:storage});
      Object.defineProperty(window,'localStorage',{value:storage});
      if(f.profile)storage.setItem('navrang-session',JSON.stringify({token:'a'.repeat(64),profile:f.profile}));
      const prop=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
      Object.defineProperty(HTMLImageElement.prototype,'src',{get:prop.get,set(value){prop.set.call(this,f.images[value]||value);}});
      const realTimeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>fn?.name==='endIntro'?0:realTimeout(fn,ms,...args);
      window.AudioContext=undefined;window.webkitAudioContext=undefined;
      window.fixtureCalls=[];window.fixtureUnexpected=[];
      window.fetch=async(url,options)=>{
       const body=options?.body?JSON.parse(options.body):{};const action=body.action||'config';window.fixtureCalls.push(action);
       let value;
       if(action==='config')value={eventId:'O9KL3',googleEnabled:true,pollMs:2000};
       else if(action==='me')value=f.profile;
       else if(action==='sync')value=f.role==='admin'?{dataRevision:1,records:f.records,entries:f.entries,cursor:8,hasMore:false,source:'Synthetic UI fixture',stats:f.stats,checkers:[{id:'11111111-1111-4111-8111-111111111111',name:'Demo Checker',method:'google',email:'checker@example.invalid',active:true,scanner:true,helpdesk:false,station:'checker',entries:8}]}:{staffSummary:true,scanner:f.role==='checker',dataRevision:-1,cursor:0,hasMore:false,records:null,entries:[],stats:{ownScans:f.role==='checker'?8:0,totalEntries:9}};
       else if(action==='reports-summary')value={stats:f.summary};
       else if(action==='reports-members')value={members:[{id:'22222222-2222-4222-8222-222222222222',name:'Demo Faculty',email:'faculty@example.invalid',nameConfirmed:true,active:true,teacher:true,scanner:false,helpdesk:false}]};
       else if(action==='helpdesk-list')value={records:[],total:0,stats:{total:0,pending:0,approved:0,rejected:0}};
       else if(action==='reports-export')value={kind:body.payload.kind,rows:f.records.slice(0,8).map(r=>({'Ticket ID':r.id,'Name':r.name,'Attendance':'Attended'})),count:8,generatedAt:f.summary.generatedAt};
       else if(action==='logout')value={signedOut:true};
       else {window.fixtureUnexpected.push(action);return new Response(JSON.stringify({ok:false,error:'Disallowed fixture request'}),{status:400});}
       return new Response(JSON.stringify({ok:true,...value}),{status:200});
      };
    }""",dict(role=role,profile=PROFILE.get(role),records=RECORDS,entries=ENTRIES,stats=STATS,summary=SUMMARY,images=images))
    for script in scripts:page.evaluate((assets/script).read_text())
    page.wait_for_timeout(50)
   def measure(page,role,view,width,height):
    result=page.evaluate(r'''() => {
      const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden]');};
      const over=[...document.querySelectorAll('button,input,select,.topbar,.brand,.top-actions,.login-role-picker,.panel-heading,.report-member,.mobile-nav')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,left:r.left,right:r.right};}).filter(r=>r.left < -1 || r.right > innerWidth+1);
      const logos=[...document.querySelectorAll('.institution-wordmark,.header-logo,.crafted-login>.official-logo')].filter(visible);
      const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
      const placeholderContrast=[...document.querySelectorAll('input[placeholder]')].filter(visible).map(e=>{const a=luminance(getComputedStyle(e,'::placeholder').color),b=luminance(getComputedStyle(e).backgroundColor);return {id:e.id,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}}).filter(x=>x.ratio<4.5);
      const lowContrast=logos.filter(e=>getComputedStyle(e).backgroundColor==='rgb(252, 243, 224)').map(e=>e.className);
      const smallEntryText=[...document.querySelectorAll('#recent-entries td,#all-entry-rows td')].filter(visible).filter(e=>parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.textContent);
      return {smallEntryText,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,overflow:over,lowContrastMarks:lowContrast,placeholderContrast,navHeight:document.querySelector('.mobile-nav').getBoundingClientRect().height};
    }''')
    item=dict(role=role,view=view,width=width,height=height,**result);reports.append(item)
    (out/'partial.json').write_text(json.dumps(reports,indent=2))
    if result['documentWidth']>width+1 or result['overflow'] or result['lowContrastMarks'] or result['placeholderContrast'] or result['smallEntryText']:failures.append(item)
   def measure_control(page,selector,label,minimum=43,scroll=True):
    control=page.locator(selector).first
    if scroll:control.scroll_into_view_if_needed()
    result=control.evaluate("""e=>{
      const r=e.getBoundingClientRect();let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);
      for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}}
      return {height:r.height,width:r.width,visibleHeight:Math.max(0,bottom-top),visibleWidth:Math.max(0,right-left)};
    }""")
    reports.append(dict(control=label,**result))
    required_height=result['height']-.5 if minimum==0 else min(minimum,result['height'])
    if result['height']<minimum or result['visibleHeight']<required_height or result['visibleWidth']<min(43,result['width']):failures.append(dict(unreachableControl=label,**result))
   def measure_scroll(page,view):
    result=page.evaluate("""view=>{
      const root=document.querySelector(view==='students'?'#admin-registrations':'#view-entries');
      const scroller=root.querySelector('.rows-scroll');
      const controls=[document.querySelector('.topbar'),document.querySelector('.mobile-nav'),root.querySelector('.list-status'),...(view==='students'?[root.querySelector('.table-toolbar'),document.querySelector('.admin-tabs')]:[])];
      const bounds=()=>controls.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
      const before=bounds();scroller.scrollTop=scroller.scrollHeight;
      return {view,before,after:bounds(),offset:scroller.scrollTop,height:scroller.clientHeight,scrollHeight:scroller.scrollHeight};
    }""",view)
    if result['scrollHeight']>result['height'] and result['offset']<=0:failures.append(dict(scrollFailure=result))
    if result['height']<111 or any(abs(a-b)>1 for x,y in zip(result['before'],result['after']) for a,b in zip(x,y)):failures.append(dict(stabilityFailure=result))
    reports.append(dict(scroll=result))
    root='#admin-registrations' if view=='students' else '#view-entries'
    page.locator(root+' .rows-scroll').hover()
    parent=page.locator(root if view=='students' else root+' .table-panel')
    parent_before=parent.evaluate('e=>e.scrollTop')
    page.mouse.wheel(0,300);page.wait_for_timeout(80)
    parent_after=parent.evaluate('e=>e.scrollTop')
    if abs(parent_after-parent_before)>1:failures.append(dict(scrollEscapedRows=view,before=parent_before,after=parent_after))
   sizes=[tuple(map(int,size.split('x'))) for size in args.sizes.split(',')]
   for width,height in sizes:
    for role in ('login','admin','faculty','checker'):
     ctx=browser.new_context(viewport=dict(width=width,height=height),reduced_motion='reduce')
     ctx.route('**/*',lambda route:route.abort())
     page=ctx.new_page();page.set_default_timeout(4000);page.on('pageerror',lambda e:errors.append(str(e)));open_source(page,role);
     if role=='login':
      page.evaluate("const i=document.getElementById('intro');i.hidden=false;i.classList.remove('leaving')")
      launch=page.evaluate("""() => {
       const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
       const children=[...document.querySelector('.intro-content').children].filter(e=>!e.hidden&&getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect();return {name:e.className||e.tagName,left:r.left,right:r.right,top:r.top,bottom:r.bottom}});
       return {content:box('.intro-content'),children,figures:box('.intro-dancers'),cta:box('#skip-intro'),width:innerWidth,height:innerHeight};
      }""")
      overlap=lambda a,b:a['left']<b['right']-1 and a['right']>b['left']+1 and a['top']<b['bottom']-1 and a['bottom']>b['top']+1
      if overlap(launch['content'],launch['figures']) or overlap(launch['content'],launch['cta']) or overlap(launch['figures'],launch['cta']):failures.append(dict(launchOverlap=launch))
      if any(b['left'] < -1 or b['right'] > width+1 or b['top'] < -1 or b['bottom'] > height+1 for b in (launch['content'],launch['figures'],launch['cta'])):failures.append(dict(launchOverflow=launch))
      for i,a in enumerate(launch['children']):
       for b in launch['children'][i+1:]:
        if overlap(a,b):failures.append(dict(launchChildOverlap=[a,b],width=width,height=height))
       if a['top']<launch['content']['top']-1 or a['bottom']>launch['content']['bottom']+1:failures.append(dict(launchChildOutsideContent=a,width=width,height=height))
      reports.append(dict(launch=launch))
      page.screenshot(path=str(out/f'launch-{width}x{height}.png'))
      if width in (390,640):
       page.emulate_media(reduced_motion='no-preference')
       for frame in (0,350,1100,2600):
        page.evaluate('ms=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms})',frame)
        if page.locator('#skip-intro').evaluate('e=>Number(getComputedStyle(e).opacity)')<1:failures.append(dict(hiddenLaunchActionAtMs=frame,width=width))
        page.screenshot(path=str(out/f'launch-{width}x{height}-motion-{frame}.png'))
       page.emulate_media(reduced_motion='reduce')
     page.evaluate("if(!document.getElementById('intro').hidden)document.getElementById('skip-intro').click()");page.wait_for_timeout(650)
     view={'login':'login','admin':'admin','faculty':'reports','checker':'home'}[role]
     measure(page,role,view,width,height)
     if role=='admin':measure_control(page,'#registration-count','Student list footer',minimum=0,scroll=False)
     if role=='login':
      page.evaluate("document.getElementById('google-browser-signin').hidden=false")
      measure(page,role,'login-native-browser-fallback',width,height)
     if width in (320,390,640,1366):
      page.screenshot(path=str(out/f'{role}-{width}.png'))
     if role=='admin':
      measure_scroll(page,'students')
      for target in ('reports','desk','account','entries','station'):
       selector=f'[data-view="{target}"]'
       if target=='station':page.locator('#switch-station').click() if page.locator('#switch-station').is_visible() else page.evaluate("document.querySelector('[data-view=station]').click()")
       else:page.locator(selector).click()
       page.wait_for_timeout(70);measure(page,role,target,width,height)
       if width in (320,390,640,1366):page.screenshot(path=str(out/f'admin-{target}-{width}.png'))
       if target=='entries':
        measure_control(page,'#entry-coverage','Entry list footer',minimum=0,scroll=False)
        measure_scroll(page,'entries')
      for tab in ('registrations','admissions','checkers','updates'):
       page.locator('#admin-nav').click();page.locator(f'[data-admin-tab="{tab}"]').click();measure(page,role,'admin-'+tab,width,height)
       if tab=='checkers':
        measure_control(page,'#checker-list .checker-row button','Manage access')
        measure_control(page,'#staff-count','Staff list footer',minimum=0,scroll=False)
       if tab=='updates':measure_control(page,'#password-open','Change admin password')
       if width in (320,390,640,1366):page.screenshot(path=str(out/f'admin-tab-{tab}-{width}.png'))
       if tab=='updates':
        # The Android bridge exposes this same control. Exercise its layout
        # without opening a real device picker or sending an import request.
        page.evaluate("document.getElementById('import-registration').hidden=false")
        measure(page,role,'admin-updates-native-import',width,height)
     unexpected.extend(page.evaluate('window.fixtureUnexpected'));ctx.close()
   browser.close()
 finally:pass
 result=dict(cases=len(reports),failures=failures,errors=errors,unexpected=unexpected,measurements=reports)
 (out/'results.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(dict(cases=len(reports),failures=len(failures),errors=errors,unexpected=unexpected),indent=2))
 if failures:print(json.dumps(failures[:8],indent=2))
 if (failures or errors or unexpected) and not args.baseline:raise SystemExit(1)
if __name__=='__main__':run()
