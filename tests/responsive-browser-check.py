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
CANDIDATE_VERSION = json.loads((ROOT/'release.json').read_text())['versionName']
RECORDS = [dict(id=f'DEMO{i:04d}',name=f'Synthetic Student {i:02d}',amount=100,quantity=1,refund=0,description='Transaction completed successfully',eligible=True,reason='') for i in range(1,61)]
ENTRIES = [dict(ticketId=r['id'],name=r['name'],checker='Demo Checker',checkerId='11111111-1111-4111-8111-111111111111',deviceId='synthetic-preview',at=STAMP,seq=i,source='Synthetic UI fixture') for i,r in enumerate(RECORDS[:40],1)]
PROFILE = {'admin':dict(role='admin',name='Synthetic Administrator',active=True,reports=True,scanner=True,helpdesk=True,station='',nameConfirmed=True),
 'faculty':dict(role='checker',name='Demo Faculty',checkerId='22222222-2222-4222-8222-222222222222',method='google',active=True,reports=True,scanner=False,helpdesk=False,station='',nameConfirmed=True),
 'checker':dict(role='checker',name='Demo Checker',checkerId='11111111-1111-4111-8111-111111111111',method='google',active=True,reports=False,scanner=True,helpdesk=False,station='checker',nameConfirmed=True)}
PROFILE.update({
 'helpdesk':dict(role='checker',name='Synthetic Help Desk',checkerId='33333333-3333-4333-8333-333333333333',method='google',active=True,reports=False,scanner=False,helpdesk=True,station='helpdesk',nameConfirmed=True),
 'pending':dict(role='checker',name='Synthetic New Staff',checkerId='44444444-4444-4444-8444-444444444444',method='google',active=True,reports=False,scanner=False,helpdesk=False,station='',nameConfirmed=True),
 'newstaff':dict(role='checker',name='Checker',checkerId='55555555-5555-4555-8555-555555555555',method='google',active=True,reports=False,scanner=False,helpdesk=False,station='',nameConfirmed=False)})
DESK_RECORDS = [dict(id=f'synthetic-case-{i}',ticket_id=f'DESK{i:04d}',status=status,version=1,created_at=STAMP,created_by_name='Synthetic Help Desk',details=dict(name=f'Synthetic Visitor {i}',email=f'visitor{i}@example.invalid',phone='0000000000',quantity=1)) for i,status in ((1,'pending'),(2,'approved'))]
STATS = dict(total=60,eligible=60,admitted=40,remaining=20,blocked=0,lastMinute=0,lastFiveMinutes=0,duplicateAttempts=2,blockedAttempts=1)
SUMMARY = dict(registered=12,eligible=12,blocked=0,attended=9,registeredAttended=8,organizerConfirmed=1,noShow=4,serverIssues=1,issueTickets=1,duplicateAttempts=2,pendingHelpDesk=0,generatedAt=STAMP)
def run():
 parser=argparse.ArgumentParser();parser.add_argument('--output',default=str(ROOT/'.build/responsive-review'));parser.add_argument('--baseline',action='store_true');parser.add_argument('--report-stress',action='store_true');parser.add_argument('--sizes',default='320x640,360x800,390x844,768x1024,1024x768,1366x768,1920x1080,640x360');args=parser.parse_args()
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
 reports=[]; failures=[]; errors=[]; unexpected=[]; review_shots=[]
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path=os.getenv('NAVRANG_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
   def open_source(page,role,mocked_native=False):
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
      window.fixtureCalls=[];window.fixtureUnexpected=[];window.fixtureReportMode='normal';window.fixtureDeskPopulated=false;
      window.fetch=async(url,options)=>{
       const body=options?.body?JSON.parse(options.body):{};const action=body.action||'config';window.fixtureCalls.push(action);
       let value;
       if(action==='notifications-feed')value={revision:5,serverTime:new Date().toISOString(),items:Array.from({length:5},(_,i)=>({id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),revision:5-i,kind:'announcement',title:'Synthetic staff update '+(i+1),body:'Fixture-only notification. No production message.',at:new Date().toISOString(),read:false,destination:'account'})),activeIds:Array.from({length:5},(_,i)=>'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0')),dashboard:{revision:5,generatedAt:new Date().toISOString(),status:'live',totals:{attended:9},hidden:false,announcement:{id:'22222222-2222-4222-8222-222222222222',title:'Synthetic pinned announcement',body:'Fixture-only live card.',at:new Date().toISOString()}}};
       else if(action==='notifications-preview')value={recipientCount:3,previewHash:'a'.repeat(64)};
       else if(action==='config')value={eventId:'O9KL3',googleEnabled:true,pollMs:2000};
       else if(action==='me')value=f.profile;
       else if(action==='sync')value=f.role==='admin'?{dataRevision:1,records:f.records,entries:f.entries,cursor:8,hasMore:false,source:'Synthetic UI fixture',stats:f.stats,checkers:[{id:'11111111-1111-4111-8111-111111111111',name:'Demo Checker',method:'google',email:'checker@example.invalid',active:true,scanner:true,helpdesk:false,station:'checker',entries:8}]}:{staffSummary:true,scanner:f.role==='checker',dataRevision:-1,cursor:0,hasMore:false,records:null,entries:[],stats:{ownScans:f.role==='checker'?8:0,totalEntries:9}};
       else if(action==='reports-summary'||action==='reports-summary-prepare'){
        if(['unavailable','denied'].includes(window.fixtureReportMode))return new Response(JSON.stringify({ok:false,error:window.fixtureReportMode==='denied'?'Reporting access is not approved for this account.':'Report service temporarily unavailable. Refresh to retry.'}),{status:window.fixtureReportMode==='denied'?403:503});
        value={operationId:'11111111-1111-4111-8111-111111111111',stats:window.fixtureReportMode==='empty'?Object.fromEntries(Object.entries(f.summary).map(([k,v])=>[k,typeof v==='number'?0:v])):f.summary};
       }
       else if(action==='reports-members'&&window.fixtureReportMode==='members-unavailable')return new Response(JSON.stringify({ok:false,error:'Synthetic member service unavailable'}),{status:503});
       else if(action==='reports-members')value={members:window.fixtureLongMembers||[{id:'22222222-2222-4222-8222-222222222222',name:'Demo Faculty',email:'faculty@example.invalid',nameConfirmed:true,active:true,teacher:true,scanner:false,helpdesk:false}]};
       else if(action==='helpdesk-list')value=window.fixtureDeskPopulated?{records:f.deskRecords,total:f.deskRecords.length,stats:{total:2,pending:1,approved:1,rejected:0}}:{records:[],total:0,stats:{total:0,pending:0,approved:0,rejected:0}};
       else if(action==='reports-save-outcome')value={operationId:body.payload.operationId,outcome:body.payload.outcome,deviceReported:true};
       else if(action==='reports-export')value={operationId:'11111111-1111-4111-8111-111111111111',kind:body.payload.kind,rows:window.fixtureReportMode==='empty'?[]:f.records.slice(0,8).map(r=>({'Ticket ID':r.id,'Name':r.name,'Attendance':'Attended'})),count:window.fixtureReportMode==='empty'?0:8,generatedAt:f.summary.generatedAt};
       else if(action==='logout')value={signedOut:true};
       else {window.fixtureUnexpected.push(action);return new Response(JSON.stringify({ok:false,error:'Disallowed fixture request'}),{status:400});}
       return new Response(JSON.stringify({ok:true,...value}),{status:200});
      };
      window.fixtureNativeBridge=!!f.nativeBridge;
      if(f.nativeBridge){
       // Read-only bridge fixture: actual shared UI chooses its own native-only
       // controls. No permissions, picker, credentials, camera or device APIs run.
       const blocked=action=>{window.fixtureUnexpected.push('Native.'+action);throw Error('Disallowed native fixture operation: '+action);};
       window.Native={
        local(action){
         if(action==='session')return JSON.stringify({ok:true,data:{profile:f.profile}});
         if(action==='snapshot')return JSON.stringify({ok:true,data:{deviceId:'synthetic-native-preview',dataRevision:1,cursor:40,source:'Synthetic UI fixture',lastSync:f.summary.generatedAt,stats:f.stats,localCount:f.records.length,pending:0,legacyCount:0,entries:f.entries.slice(0,15)}});
         return blocked('local:'+action);
        },
        api(action,payload,id){
         window.fetch('fixture://native-api',{body:JSON.stringify({action,payload:JSON.parse(payload)})}).then(async response=>{
          window.onApiResponse(JSON.stringify({id,status:response.status,body:await response.json()}));
         }).catch(()=>window.onApiResponse(JSON.stringify({id,status:500,body:{ok:false,error:'Synthetic bridge failure'}})));
        },
        readiness(action){if(!['status','startup'].includes(action))return blocked('readiness:'+action);return JSON.stringify({native:true,camera:false,notifications:false,fullVolume:true,vibration:true,adaptiveBrightness:true});},
        update(action){if(!['status','background'].includes(action))return blocked('update:'+action);return JSON.stringify({currentVersion:f.candidateVersion,available:false,ready:false,automatic:true,notifications:false,message:'Synthetic preview: no update is available.'});},
        destination(value){if(value)return blocked('destination');return f.role==='admin'?'admin':'login';},
        feedback(){},
        googleLoginRequest(operationId){queueMicrotask(()=>window.onGateEvent(JSON.stringify({type:'credential',data:{operationId,phase:'cancelled',generation:1}})));},
        googleLogin(){return blocked('googleLogin');},googleBrowserLogin(){return blocked('googleBrowserLogin');},
        scan(){return blocked('scan');},submit(){return blocked('submit');},importRegistrations(){return blocked('importRegistrations');}
       };
      }
    }""",dict(role=role,profile=PROFILE.get(role),records=RECORDS,entries=ENTRIES,stats=STATS,summary=SUMMARY,images=images,deskRecords=DESK_RECORDS,nativeBridge=mocked_native,candidateVersion=CANDIDATE_VERSION))
    for script in scripts:page.evaluate((assets/script).read_text())
    page.wait_for_function("[...document.querySelectorAll('.combined-brand-mark>img')].every(e=>e.complete&&e.naturalWidth===2400)")
    page.wait_for_timeout(50)
   def measure(page,role,view,width,height):
    result=page.evaluate(r'''() => {
      const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden]');};
      const over=[...document.querySelectorAll('button,input,select,.topbar,.brand,.top-actions,.login-role-picker,.panel-heading,.report-member,.mobile-nav')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,left:r.left,right:r.right};}).filter(r=>r.left < -1 || r.right > innerWidth+1);
      const logos=[...document.querySelectorAll('.institution-wordmark,.header-logo,.crafted-login>.official-logo,.combined-brand-mark>img')].filter(visible);
      const distortedBrand=[...document.querySelectorAll('.combined-brand-mark>img')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width/r.height-15/8)>.02||getComputedStyle(e).objectFit!=='contain'||e.naturalWidth!==2400||e.naturalHeight!==1280}).map(e=>e.className||e.parentElement.className);
      const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
      const placeholderContrast=[...document.querySelectorAll('input[placeholder]')].filter(visible).map(e=>{const a=luminance(getComputedStyle(e,'::placeholder').color),b=luminance(getComputedStyle(e).backgroundColor);return {id:e.id,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}}).filter(x=>x.ratio<4.5);
      const lowContrast=logos.filter(e=>getComputedStyle(e).backgroundColor==='rgb(252, 243, 224)').map(e=>e.className);
      const smallEntryText=[...document.querySelectorAll('#recent-entries td,#all-entry-rows td')].filter(visible).filter(e=>parseFloat(getComputedStyle(e).fontSize)<12).map(e=>e.textContent);
      return {distortedBrand,smallEntryText,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,overflow:over,lowContrastMarks:lowContrast,placeholderContrast,navHeight:document.querySelector('.mobile-nav').getBoundingClientRect().height};
    }''')
    item=dict(role=role,view=view,width=width,height=height,**result);reports.append(item)
    (out/'partial.json').write_text(json.dumps(reports,indent=2))
    if result['documentWidth']>width+1 or result['overflow'] or result['lowContrastMarks'] or result['placeholderContrast'] or result['smallEntryText'] or result['distortedBrand']:failures.append(item)
   def measure_control(page,selector,label,minimum=43,scroll=True):
    control=page.locator(selector).first
    if scroll:control.scroll_into_view_if_needed()
    result=control.evaluate("""e=>{
      const r=e.getBoundingClientRect();let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);
      // showModal places the dialog in the top layer: outer DOM overflow cannot clip it.
      // https://drafts.csswg.org/css-position-4/#top-layer-styling
      for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}if(p.matches('dialog:modal'))break}
      const x=(r.left+r.right)/2;const hitTarget=[r.top+2,(r.top+r.bottom)/2,r.bottom-2].every(y=>e.contains(document.elementFromPoint(x,y)));
      return {height:r.height,width:r.width,visibleHeight:Math.max(0,bottom-top),visibleWidth:Math.max(0,right-left),hitTarget,viewport:{width:innerWidth,height:innerHeight}};
    }""")
    reports.append(dict(control=label,**result))
    required_height=result['height']-.5 if minimum==0 else min(minimum,result['height'])
    if result['height']<minimum or result['visibleHeight']<required_height or result['visibleWidth']<min(43,result['width']) or not result['hitTarget']:failures.append(dict(unreachableControl=label,**result))
   def measure_report_downloads(page):
    page.wait_for_function("!document.getElementById('report-csv').disabled")
    page.locator('#report-tab-downloads').click();page.wait_for_timeout(40)
    in_dialog=page.locator('#report-download-open').is_visible()
    if in_dialog:page.locator('#report-download-open').click()
    if page.locator('#report-download-back').is_visible():page.locator('#report-download-back').click()
    measure_control(page,'#report-kind','Dataset without page scrolling',minimum=40,scroll=in_dialog)
    if page.locator('#report-download-next').is_visible():page.locator('#report-download-next').click()
    in_dialog=page.locator('#report-download-dialog').is_visible()
    if page.locator('#report-download-open').is_visible() and not in_dialog:
     page.locator('#report-download-open').click();in_dialog=True
    if page.locator('#report-format').is_visible():
     measure_control(page,'#report-format','File format without scrolling',minimum=40,scroll=False)
     for kind in ('csv','xlsx','pdf'):
      page.locator('#report-format').select_option(kind)
      measure_control(page,'#report-download-selected','Reachable report '+kind,minimum=40,scroll=False)
    else:
     for selector in ('#report-csv','#report-xlsx','#report-pdf'):
      measure_control(page,selector,'Reachable report '+selector,minimum=40,scroll=in_dialog)
    if in_dialog:page.locator('#report-download-close').click()
    page.locator('#report-tab-overview').click();page.wait_for_timeout(40)
    for _ in range(11):
     if page.locator('#report-metrics-previous').is_visible() and not page.locator('#report-metrics-previous').is_disabled():page.locator('#report-metrics-previous').click()
     else:break
    seen=set()
    for _ in range(11):
     page.evaluate('NavrangReportLayout.fit()')
     if page.locator('#report-totals-open').is_visible():
      measure_control(page,'#report-totals-open','Accessible totals without page scroll',minimum=40,scroll=False)
      page.locator('#report-totals-open').click()
      seen.update(page.locator('#report-stats article').all_text_contents())
      for i in range(page.locator('#report-stats article').count()):
       measure_control(page,f'#report-stats article:nth-child({i+1})','Accessible total in dialog',minimum=0,scroll=True)
      page.locator('#report-totals-dialog > button').click()
     else:
      seen.update(page.locator('#report-stats article:not([hidden])').all_text_contents())
     result=page.evaluate("""()=>{
      const view=document.getElementById('view-reports'),main=document.querySelector('main'),r=view.getBoundingClientRect(),m=main.getBoundingClientRect();
      const bad=[...view.querySelectorAll('button,article.report-stat')].filter(e=>e.getClientRects().length&&!e.hidden).filter(e=>{const b=e.getBoundingClientRect();return b.height<=0||b.top<r.top-1||b.bottom>r.bottom+1}).map(e=>e.id||e.className);
      return {height:view.clientHeight,scrollHeight:view.scrollHeight,mainHeight:main.clientHeight,mainScroll:main.scrollHeight,bounded:r.height>0&&r.top>=m.top-1&&r.bottom<=m.bottom+1,bad};
     }""")
     reports.append(dict(reportConsolidatedLayout=result))
     if not result['bounded'] or result['scrollHeight']>result['height']+1 or result['mainScroll']>result['mainHeight']+1 or result['bad']:failures.append(dict(reportConsolidationFailure=result))
     if page.locator('#report-totals-open').is_visible() or page.locator('#report-metrics-next').is_disabled():break
     page.locator('#report-metrics-next').click()
    if len(seen)!=11:failures.append(dict(unreachableReportMetrics=len(seen),viewport=page.viewport_size,seen=list(seen)))
    page.locator('#report-tab-downloads').click()
   def measure_teacher_access(page):
    page.locator('#report-tab-teachers').click();page.wait_for_timeout(40)
    if page.locator('#report-teacher-search').is_visible():measure_control(page,'#report-teacher-search','Teacher search without scrolling',minimum=40,scroll=False)
    seen=set()
    for _ in range(20):
     page.evaluate('NavrangReportLayout.fit()')
     if page.locator('#report-teachers-open').is_visible():
      measure_control(page,'#report-teachers-open','Teacher access without page scroll',minimum=40,scroll=False)
      page.locator('#report-teachers-open').click()
      for i in range(page.locator('#report-teachers .report-member').count()):
       seen.add(page.locator(f'#report-teachers .report-member:nth-child({i+1}) strong').inner_text())
       measure_control(page,f'#report-teachers .report-member:nth-child({i+1}) button','Teacher action in accessible dialog',minimum=40,scroll=True)
      page.locator('#report-teacher-dialog > button').click()
      break
     for row in page.locator('#report-teachers .report-member:not([hidden])').all():
      seen.add(row.locator('strong').inner_text())
     for selector in ('#report-members-previous','#report-members-next'):
      if page.locator(selector).is_visible():measure_control(page,selector,'Teacher pages without scroll',minimum=40,scroll=False)
     for i in range(page.locator('#report-teachers .report-member:not([hidden])').count()):
      control=page.locator('#report-teachers .report-member:not([hidden]) button').nth(i)
      control.evaluate("e=>e.dataset.fixtureVisibleAction='true'")
      measure_control(page,'[data-fixture-visible-action]','Visible teacher action',minimum=40,scroll=False)
      control.evaluate("e=>delete e.dataset.fixtureVisibleAction")
     if page.locator('#report-members-next').is_disabled():break
     page.locator('#report-members-next').click()
    if len(seen)!=9:failures.append(dict(unreachableTeacherAccounts=len(seen)))
    search_in_dialog=page.locator('#report-teachers-open').is_visible()
    if search_in_dialog:page.locator('#report-teachers-open').click()
    page.locator('#report-teacher-search').fill('Synthetic Teacher 8')
    page.wait_for_timeout(40)
    visible=page.locator('#report-teachers .report-member:not([hidden]) strong').all_text_contents()
    if len(visible)!=1 or 'Synthetic Teacher 8' not in visible[0]:failures.append(dict(teacherSearch=visible))
    page.locator('#report-teacher-search').fill('')
    if search_in_dialog:page.locator('#report-teacher-dialog > button').click()
   def measure_scroll(page,view):
    result=page.evaluate("""view=>{
      const root=document.querySelector(view==='students'?'#admin-registrations':'#view-entries');
      const scroller=root.querySelector('.rows-scroll');
      const controls=[document.querySelector('.topbar'),document.querySelector('.mobile-nav'),root.querySelector('.list-status'),...(view==='students'?[root.querySelector('.table-toolbar'),document.querySelector('.admin-tabs')]:[])];
      const bounds=()=>controls.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
      const before=bounds();scroller.scrollTop=scroller.scrollHeight;
      return {view,before,after:bounds(),offset:scroller.scrollTop,height:scroller.clientHeight,scrollHeight:scroller.scrollHeight};
    }""",view)
    if result['scrollHeight']>result['height']+1:failures.append(dict(paginatedListOverflow=result))
    if result['height']<=0 or any(abs(a-b)>1 for x,y in zip(result['before'],result['after']) for a,b in zip(x,y)):failures.append(dict(stabilityFailure=result))
    reports.append(dict(scroll=result))
    root='#admin-registrations' if view=='students' else '#view-entries'
    page.locator(root+' .rows-scroll').hover()
    parent=page.locator(root if view=='students' else root+' .table-panel')
    parent_before=parent.evaluate('e=>e.scrollTop')
    page.mouse.wheel(0,300);page.wait_for_timeout(80)
    parent_after=parent.evaluate('e=>e.scrollTop')
    if abs(parent_after-parent_before)>1:failures.append(dict(scrollEscapedRows=view,before=parent_before,after=parent_after))
   def capture_review_states(width,height):
    """Actual UI clicks/scrolls and fixture responses only; no visual substitutions.
    Extra states use fresh contexts so existing geometry assertions stay unchanged.
    No form that mutates staff, registrations, payments or credentials is submitted.
    """
    def fresh(role,mocked_native=False):
     ctx=browser.new_context(viewport=dict(width=width,height=height),reduced_motion='reduce',accept_downloads=True)
     ctx.route('**/*',lambda route:route.abort())
     page=ctx.new_page();page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append(str(e)));open_source(page,role,mocked_native)
     page.evaluate("if(!document.getElementById('intro').hidden)document.getElementById('skip-intro').click()")
     page.wait_for_timeout(650)
     return ctx,page
    def shot(page,role,state,anchor=None):
     if anchor:page.locator(anchor).first.scroll_into_view_if_needed()
     page.wait_for_timeout(100)
     filename=f'review-{role}-{state}-{width}.png'
     page.screenshot(path=str(out/filename))
     review_shots.append(dict(file=filename,role=role,state=state,width=width,height=height,synthetic=True,renderer='Chromium source UI with read-only mocked Android bridge' if page.evaluate('window.fixtureNativeBridge') else 'Chromium source UI',capture='viewport after real UI navigation/scroll'))
     (out/'review-shots.json').write_text(json.dumps(review_shots,indent=2))
    def finish(ctx,page):
     unexpected.extend(page.evaluate('window.fixtureUnexpected'));ctx.close()
    def dialog(page,trigger,dialog_id,state,close_id,lower=None):
     page.locator(trigger).first.click();page.locator(dialog_id).wait_for(state='visible')
     shot(page,'admin',state)
     if lower:shot(page,'admin',state+'-lower',lower)
     page.locator(close_id).click();page.locator(dialog_id).wait_for(state='hidden')
    ctx,page=fresh('login')
    for role in ('helpdesk','faculty'):
     page.locator('#auth-staff').click()
     page.locator(f'[data-login-role="{role}"]').click()
     shot(page,'login',role)
     page.locator('#auth-back').click();page.locator('#auth-back').click()
    page.locator('#show-admin-login').click();shot(page,'login','administrator')
    page.locator('#auth-back').click();finish(ctx,page)
    ctx,page=fresh('admin')
    dialog(page,'#registration-rows .table-link','#student-dialog','registration-details','#close-student','#dialog-details dd:last-child')
    page.locator('#registration-rows .table-link').first.click();page.locator('#edit-student').click()
    shot(page,'admin','edit-registration');shot(page,'admin','edit-registration-lower','#ticket-editor button')
    page.locator('#close-editor').click()
    page.locator('#reports-nav').click();page.wait_for_function("document.getElementById('report-status').textContent.includes('Live report ready')")
    page.locator('#report-tab-overview').click();page.locator('#report-notes-open').click()
    shot(page,'admin','reports-evidence-caveat','#report-caveat')
    page.locator('#report-notes-dialog button').click();page.locator('#report-tab-downloads').click()
    shot(page,'admin','reports-download-controls','#report-kind')
    page.locator('#report-tab-teachers').click()
    shot(page,'admin','reports-access-management','#report-teachers')
    page.locator('#report-tab-downloads').click()
    page.evaluate("window.fixtureReportMode='empty';NavrangReports.refresh()")
    page.wait_for_function("document.getElementById('report-status').textContent.includes('Live report ready')")
    page.locator('#report-tab-overview').click()
    shot(page,'admin','reports-empty-summary','#report-tab-overview')
    page.locator('#report-tab-downloads').click()
    page.locator('#report-kind').select_option('pending')
    if page.locator('#report-download-next').is_visible():page.locator('#report-download-next').click()
    if page.locator('#report-format').is_visible():page.locator('#report-format').select_option('csv')
    with page.expect_download() as waiting:page.locator('#report-download-selected' if page.locator('#report-format').is_visible() else '#report-csv').click()
    assert waiting.value.failure() is None
    page.wait_for_function("document.getElementById('report-status').textContent.includes('Column headers prepared')")
    shot(page,'admin','reports-empty-download','#report-status')
    for mode in ('members-unavailable','unavailable','denied'):
     page.evaluate("mode=>{window.fixtureReportMode=mode;return NavrangReports.refresh()}",mode)
     if page.locator('#report-message-dialog').is_visible():
      shot(page,'admin','reports-error-message','#report-message-dialog');page.locator('#report-message-dialog button').click()
     if mode=='members-unavailable':page.locator('#report-tab-teachers').click()
     else:page.locator('#report-tab-downloads').click()
     shot(page,'admin','reports-'+mode,'#report-teachers' if mode=='members-unavailable' else '#report-status')
     if mode!='members-unavailable':assert page.locator('#report-csv').is_disabled()
    page.evaluate("window.fixtureReportMode='normal';NavrangReports.refresh()")
    page.locator('#desk-nav').click();shot(page,'admin','helpdesk-form-lower','#desk-submit')
    page.locator('#desk-saved').click();page.wait_for_function("document.getElementById('desk-records').textContent.includes('No saved records')")
    shot(page,'admin','helpdesk-saved-empty')
    page.evaluate('window.fixtureDeskPopulated=true;NavrangDesk.refresh(true)')
    page.wait_for_function("document.querySelectorAll('#desk-records .desk-record').length===2")
    shot(page,'admin','helpdesk-saved-list')
    dialog(page,'#desk-records .button','#desk-review-dialog','helpdesk-payment-review','#desk-review-close','#desk-reject')
    page.locator('#desk-records .desk-record-info').first.click()
    shot(page,'admin','helpdesk-saved-record');shot(page,'admin','helpdesk-saved-record-lower','#desk-submit')
    page.locator('#desk-close-record').click()
    page.locator('[data-view="account"]').click()
    # Android readiness is deliberately hidden in the browser and is not fabricated.
    if page.locator('#readiness-panel').is_visible():shot(page,'admin','account-readiness','#readiness-panel')
    shot(page,'admin','account-update-settings','#automatic-updates')
    page.locator('#notifications-button').click();page.wait_for_function("document.querySelectorAll('#notifications-items li').length===5");shot(page,'admin','notifications-pinned-and-five','#notifications-live');page.locator('#notifications-compose-toggle').click();page.locator('#notification-title').fill('Synthetic emergency meeting');page.locator('#notification-body').fill('Fixture-only preview.');page.locator('#notification-preview').click();page.wait_for_function("!document.getElementById('notification-preview-result').hidden");shot(page,'admin','notification-composer-preview','#notification-preview-result');page.locator('#notifications-close').click()
    page.locator('#admin-nav').click();page.locator('[data-admin-tab="checkers"]').click()
    dialog(page,'#checker-list .checker-row button','#staff-dialog','staff-access','#close-staff','#staff-access-form button')
    dialog(page,'#open-code','#code-dialog','new-staff-code','#close-code','#create-checker-form button')
    page.locator('[data-admin-tab="updates"]').click()
    dialog(page,'#add-registration','#edit-dialog','add-registration','#close-editor','#ticket-editor button')
    dialog(page,'#password-open','#password-dialog','password-dialog','#close-password')
    finish(ctx,page)
    ctx,page=fresh('faculty')
    page.wait_for_function("document.getElementById('report-status').textContent.includes('Live report ready')")
    shot(page,'faculty','reports-download-controls','#report-kind')
    page.locator('#report-tab-overview').click();page.locator('#report-notes-open').click()
    shot(page,'faculty','reports-evidence-caveat','#report-caveat')
    page.locator('#report-notes-dialog button').click()
    page.locator('[data-view="account"]').click();shot(page,'faculty','account')
    finish(ctx,page)
    # Native-only shared-web controls, with a separately labelled mocked bridge.
    # Android OS permission prompts, file pickers and real camera remain excluded.
    ctx,page=fresh('admin',mocked_native=True)
    page.locator('[data-view="account"]').click()
    assert page.locator('#readiness-panel').is_visible()
    shot(page,'mock-native-admin','account-readiness','#readiness-panel')
    shot(page,'mock-native-admin','account-update-settings','#automatic-updates')
    page.locator('#admin-nav').click();page.locator('[data-admin-tab="updates"]').click()
    assert page.locator('#import-registration').is_visible()
    shot(page,'mock-native-admin','import-controls','#import-registration')
    finish(ctx,page)
    ctx,page=fresh('login',mocked_native=True)
    page.locator('#auth-staff').click();page.locator('[data-login-role=checker]').click()
    assert not page.locator('#google-browser-signin').is_visible()
    page.locator('#google-signin').click()
    page.locator('#google-browser-signin').wait_for(state='visible')
    shot(page,'mock-native-login','browser-sign-in','#google-browser-signin')
    finish(ctx,page)
    for role in ('helpdesk','pending','newstaff'):
     ctx,page=fresh(role);shot(page,role,'initial')
     if role=='helpdesk':
      shot(page,role,'form-lower','#desk-submit');page.locator('#desk-saved').click()
      page.wait_for_function("document.getElementById('desk-records').textContent.includes('No saved records')")
      shot(page,role,'saved-empty')
     finish(ctx,page)
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
       return {brand:box('.combined-brand-hero'),content:box('.intro-content'),children,figures:box('.intro-dancers'),cta:box('#skip-intro'),width:innerWidth,height:innerHeight};
      }""")
      if abs(launch['brand']['width']/launch['brand']['height']-15/8)>.02:failures.append(dict(distortedLaunchBrand=launch['brand']))
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
     if role=='faculty':
      measure_report_downloads(page)
      if args.report_stress:
       page.evaluate("""()=>{window.fixtureTextStyles=[...document.querySelectorAll('body *')].map(e=>[e,e.style.fontSize,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,,size]of fixtureTextStyles)if(Number.isFinite(size))e.style.fontSize=(size*2)+'px';const n=document.getElementById('notice');n.textContent='Synthetic expanded connection notice: changes remain saved on the server.';n.hidden=false;NavrangReportLayout.fit()}""")
       page.wait_for_timeout(100);measure_report_downloads(page)
       page.evaluate("for(const [e,old]of fixtureTextStyles)e.style.fontSize=old;document.getElementById('notice').hidden=true;NavrangReportLayout.fit()")
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
       if target=='reports':
        measure_report_downloads(page)
        if args.report_stress:
         page.evaluate("""()=>{window.fixtureLongMembers=Array.from({length:9},(_,i)=>({id:'22222222-2222-4222-8222-'+String(i).padStart(12,'0'),name:'Synthetic Teacher '+i+' With A Very Long Display Name',email:'synthetic.long.address.'+i+'@example.invalid',nameConfirmed:i%2===0,requested:true,active:true,teacher:false,scanner:i%2!==0,helpdesk:false}));return NavrangReports.refresh()}""")
         measure_teacher_access(page)
         page.evaluate("""()=>{window.fixtureTextStyles=[...document.querySelectorAll('body *')].map(e=>[e,e.style.fontSize,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,,size]of fixtureTextStyles)if(Number.isFinite(size))e.style.fontSize=(size*2)+'px';const n=document.getElementById('notice');n.textContent='Synthetic expanded connection notice: changes remain saved on the server.';n.hidden=false;NavrangReportLayout.fit()}""")
         measure_teacher_access(page)
         page.screenshot(path=str(out/f'teacher-access-large-text-{width}x{height}.png'))
         page.evaluate("for(const [e,old]of fixtureTextStyles)e.style.fontSize=old;document.getElementById('notice').hidden=true;NavrangReportLayout.fit()")
         page.locator('#report-tab-downloads').click()
       if target=='desk':
        page.evaluate('window.fixtureDeskPopulated=true')
        page.locator('#desk-saved').click()
        page.wait_for_function("document.querySelectorAll('#desk-records .desk-record').length===2")
        measure(page,role,'desk-saved',width,height)
        measure_control(page,'#desk-refresh','Help Desk refresh')
        measure_control(page,'#desk-records .button','Help Desk Review')
        list_height=page.locator('#desk-records').evaluate('e=>e.clientHeight')
        if list_height<111:failures.append(dict(collapsedHelpDeskList=list_height,width=width,height=height))
        if width in (320,390,640,1366):page.screenshot(path=str(out/f'admin-desk-saved-{width}.png'))
        # Real pointer interaction catches clipping/overlays that DOM visibility misses.
        page.locator('#desk-records .button').first.click()
        page.locator('#desk-review-dialog').wait_for(state='visible')
        measure_control(page,'#desk-approve','Help Desk approve')
        measure_control(page,'#desk-reject','Help Desk reject')
        if width in (320,390,640,1366):page.screenshot(path=str(out/f'admin-desk-review-{width}.png'))
        page.locator('#desk-review-close').click()
        page.locator('#desk-new').click()
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
   for width,height in sizes:
    if width in (390,1366):capture_review_states(width,height)
   (out/'review-shots.json').write_text(json.dumps(review_shots,indent=2))
   browser.close()
 except Exception as exc:
  (out/'failure.json').write_text(json.dumps(dict(error=str(exc),type=type(exc).__name__,cases=len(reports),failures=failures,errors=errors,unexpected=unexpected),indent=2))
  raise
 finally:
  (out/'review-shots.json').write_text(json.dumps(review_shots,indent=2))
 result=dict(cases=len(reports),failures=failures,errors=errors,unexpected=unexpected,measurements=reports)
 (out/'results.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(dict(cases=len(reports),failures=len(failures),errors=errors,unexpected=unexpected),indent=2))
 if failures:print(json.dumps(failures[:8],indent=2))
 if (failures or errors or unexpected) and not args.baseline:raise SystemExit(1)
if __name__=='__main__':run()
