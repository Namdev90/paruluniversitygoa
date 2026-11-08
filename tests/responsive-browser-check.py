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
 parser=argparse.ArgumentParser();parser.add_argument('--output',default=str(ROOT/'.build/responsive-review'));parser.add_argument('--baseline',action='store_true');parser.add_argument('--report-stress',action='store_true');parser.add_argument('--interactions-only',action='store_true');parser.add_argument('--login-only',action='store_true');parser.add_argument('--sizes',default='320x640,360x800,390x844,768x1024,1024x768,1366x768,1920x1080,640x360');args=parser.parse_args()
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
   images['art/'+path.name]='data:'+(mimetypes.guess_type(path.name)[0] or {'.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'}[path.suffix])+';base64,'+base64.b64encode(path.read_bytes()).decode()
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
      window.fixtureCalls=[];window.fixtureUnexpected=[];window.fixtureReportMode='normal';window.fixtureDeskPopulated=false;window.fixtureProfile=f.profile;window.fixtureAuthLost=false;
      window.fetch=async(url,options)=>{
       const body=options?.body?JSON.parse(options.body):{};const action=body.action||'config';window.fixtureCalls.push(action);
       let value;
       if(window.fixtureAuthLost&&action!=='config')return new Response(JSON.stringify({ok:false,error:'Session expired.'}),{status:401});
       if(action==='config')value={eventId:'O9KL3',googleEnabled:true,pollMs:2000};
       else if(action==='me')value=window.fixtureProfile;
       else if(action==='notifications-feed')value={revision:0,serverTime:new Date().toISOString(),items:[],activeIds:[],dashboard:null};
       else if(action==='locator-status')value=f.role==='admin'?{eventId:'O9KL3',administrator:true,assigned:false}:{eventId:'O9KL3',disclosureVersion:1,location:false,findMe:false,onDuty:false,version:0,expiresAt:null};
       else if(action==='locator-inbox'||action==='locator-roster')value={items:[]};
       else if(action==='sync')value=f.role==='admin'?{dataRevision:1,records:f.records,entries:f.entries,cursor:8,hasMore:false,source:'Synthetic UI fixture',stats:f.stats,checkers:[{id:'11111111-1111-4111-8111-111111111111',name:'Demo Checker',method:'google',email:'checker@example.invalid',active:true,scanner:true,helpdesk:false,station:'checker',entries:8}]}:{staffSummary:true,scanner:f.role==='checker',dataRevision:-1,cursor:0,hasMore:false,records:null,entries:[],stats:{ownScans:f.role==='checker'?8:0,totalEntries:9}};
       else if(action==='reports-summary'){
        if(['unavailable','denied'].includes(window.fixtureReportMode))return new Response(JSON.stringify({ok:false,error:window.fixtureReportMode==='denied'?'Reporting access is not approved for this account.':'Report service temporarily unavailable. Refresh to retry.'}),{status:window.fixtureReportMode==='denied'?403:503});
        value={stats:window.fixtureReportMode==='empty'?Object.fromEntries(Object.entries(f.summary).map(([k,v])=>[k,typeof v==='number'?0:v])):f.summary};
       }
       else if(action==='reports-members'&&window.fixtureReportMode==='members-unavailable')return new Response(JSON.stringify({ok:false,error:'Synthetic member service unavailable'}),{status:503});
       else if(action==='reports-members')value={members:window.fixtureLongMembers||[{id:'22222222-2222-4222-8222-222222222222',name:'Demo Faculty',email:'faculty@example.invalid',nameConfirmed:true,active:true,teacher:true,scanner:false,helpdesk:false}]};
       else if(action==='helpdesk-list')value=window.fixtureDeskPopulated?{records:f.deskRecords,total:f.deskRecords.length,stats:{total:2,pending:1,approved:1,rejected:0}}:{records:[],total:0,stats:{total:0,pending:0,approved:0,rejected:0}};
       else if(action==='reports-export')value={kind:body.payload.kind,rows:window.fixtureReportMode==='empty'?[]:f.records.slice(0,8).map(r=>({'Ticket ID':r.id,'Name':r.name,'Attendance':'Attended'})),count:window.fixtureReportMode==='empty'?0:8,generatedAt:f.summary.generatedAt};
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
         if(action==='session')return JSON.stringify({ok:true,data:{profile:f.profile,generation:1}});
         if(action==='snapshot')return JSON.stringify({ok:true,data:{deviceId:'synthetic-native-preview',dataRevision:1,cursor:40,source:'Synthetic UI fixture',lastSync:f.summary.generatedAt,stats:f.stats,localCount:f.records.length,pending:0,legacyCount:0,entries:f.entries.slice(0,15)}});
         if(action==='admin-snapshot')return JSON.stringify({ok:true,data:{ownerGeneration:1,dataRevision:1,records:f.records,entries:f.entries,cursor:40,hasMore:false,source:'Synthetic UI fixture',lastSync:f.summary.generatedAt,stats:f.stats,checkers:[]}});
         if(action==='refresh')return JSON.stringify({ok:true,data:{scheduled:true}});
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
   def navigate(page,view):
    if view in ('settings','admin') or view=='reports' and page.evaluate("GateClient.profile()?.role==='admin'"):
     if page.evaluate('document.body.dataset.route')!='account':page.locator('#main-nav [data-view="account"]').click()
     page.locator({'settings':'#account-settings','admin':'#admin-nav','reports':'#admin-account-reports'}[view]).click()
    else:page.locator(f'#main-nav [data-view="{view}"]').click()
    assert page.evaluate('document.body.dataset.route')==view
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
      const x=(r.left+r.right)/2,hits=[r.top+2,(r.top+r.bottom)/2,r.bottom-2].map(y=>document.elementFromPoint(x,y));
      const hitTarget=hits.every(t=>e.contains(t));
      return {height:r.height,width:r.width,visibleHeight:Math.max(0,bottom-top),visibleWidth:Math.max(0,right-left),hitTarget,coveredByNavigation:hits.some(t=>!e.contains(t)&&t?.closest('#main-nav')),viewport:{width:innerWidth,height:innerHeight}};
    }""")
    reports.append(dict(control=label,**result))
    required_height=result['height']-.5 if minimum==0 else min(minimum,result['height'])
    if result['height']<minimum or result['visibleHeight']<required_height or result['visibleWidth']<min(43,result['width']) or not result['hitTarget']:failures.append(dict(unreachableControl=label,**result))
   def measure_report_downloads(page):
    page.wait_for_function("!document.getElementById('report-csv').disabled")
    page.locator('#report-tab-downloads').click()
    for selector in ('#report-kind','#report-csv','#report-xlsx','#report-pdf'):
     measure_control(page,selector,'Reachable report '+selector,minimum=40)
    page.locator('#report-tab-overview').click()
    metrics=page.locator('#report-stats article:not([hidden])')
    if metrics.count()!=11:failures.append(dict(unreachableReportMetrics=metrics.count()))
    for i in range(metrics.count()):measure_control(page,f'#report-stats article:nth-child({i+1})','Report metric',minimum=0)
    if page.locator('.compact-pager').count():failures.append(dict(unwantedPager=True))
    page.locator('#report-tab-downloads').click()
   def measure_teacher_access(page):
    page.locator('#report-tab-teachers').click()
    measure_control(page,'#report-teacher-search','Teacher search',minimum=40)
    rows=page.locator('#report-teachers .report-member:not([hidden])')
    if rows.count()!=9:failures.append(dict(unreachableTeacherAccounts=rows.count()))
    for i in range(rows.count()):measure_control(page,f'#report-teachers .report-member:nth-child({i+1}) button','Teacher action',minimum=40)
    page.locator('#report-teacher-search').fill('Synthetic Teacher 8')
    visible=page.locator('#report-teachers .report-member:not([hidden]) strong').all_text_contents()
    if len(visible)!=1 or 'Synthetic Teacher 8' not in visible[0]:failures.append(dict(teacherSearch=visible))
    page.locator('#report-teacher-search').fill('')
   def measure_scroll(page,view):
    selector='#registration-rows' if view=='students' else '#recent-entries'
    expected=60 if view=='students' else 40
    if page.locator(selector+' tr').count()!=expected:failures.append(dict(inaccessibleRows=view,count=page.locator(selector+' tr').count()))
    page.evaluate('window.scrollTo(0,0)')
    before=page.locator('.topbar').bounding_box()['y']
    page.locator(selector+' tr').last.scroll_into_view_if_needed()
    after=page.locator('.topbar').bounding_box()['y']
    if after>=before:failures.append(dict(headerDidNotScroll=view))
    measure_control(page,selector+' tr:last-child button','Last record action',minimum=40)
    reports.append(dict(allRowsReachable=view,count=expected,headerScrolled=after<before))
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
    navigate(page,'admin')
    dialog(page,'#registration-rows .table-link','#student-dialog','registration-details','#close-student','#dialog-details dd:last-child')
    page.locator('#registration-rows .table-link').first.click();page.locator('#edit-student').click()
    shot(page,'admin','edit-registration');shot(page,'admin','edit-registration-lower','#ticket-editor button')
    page.locator('#close-editor').click()
    navigate(page,'reports');page.wait_for_function("document.getElementById('report-status').textContent.includes('Live report ready')")
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
    navigate(page,'account');shot(page,'admin','account-tools','#admin-account-tools')
    navigate(page,'settings')
    assert page.locator('#app-updates').is_hidden()
    shot(page,'admin','settings','#settings-location-audio summary')
    page.locator('#settings-location-audio summary').click()
    shot(page,'admin','settings-location-audio')
    if width>=960:
     page.locator('#portal-menu-toggle').click()
     shot(page,'admin','portal-menu-collapsed')
     page.locator('#portal-menu-toggle').click()
    navigate(page,'account')
    dialog(page,'#notifications-button','#notifications-center','notifications','#notifications-close')
    navigate(page,'admin');page.locator('[data-admin-tab="checkers"]').click()
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
    navigate(page,'account');shot(page,'faculty','account')
    finish(ctx,page)
    # Native-only shared-web controls, with a separately labelled mocked bridge.
    # Android OS permission prompts, file pickers and real camera remain excluded.
    ctx,page=fresh('admin',mocked_native=True)
    navigate(page,'settings')
    assert page.locator('#readiness-panel').is_visible()
    shot(page,'mock-native-admin','account-readiness','#readiness-panel')
    shot(page,'mock-native-admin','account-update-settings','#automatic-updates')
    navigate(page,'admin');page.locator('[data-admin-tab="updates"]').click()
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
   def interaction_review(width,height):
    ctx=browser.new_context(viewport=dict(width=width,height=height),reduced_motion='reduce')
    ctx.route('**/*',lambda route:route.abort())
    page=ctx.new_page();page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append(str(e)))
    def check(name,passed,details=None):
     item=dict(interaction=name,width=width,height=height,passed=bool(passed),details=details);reports.append(item)
     if not passed:failures.append(item)
    def ready():
     open_source(page,'admin');page.evaluate("document.getElementById('skip-intro').click()")
     page.wait_for_function("document.getElementById('intro').hidden")
     if page.evaluate('document.body.dataset.route')!='admin':navigate(page,'admin')
     page.wait_for_function("document.querySelectorAll('#registration-rows tr').length===60")
    ready()
    last=page.locator('#registration-rows tr:last-child button').first;last.focus();last.scroll_into_view_if_needed()
    before=page.evaluate("window.fixtureFocused=document.activeElement;window.fixturePollCount=fixtureCalls.filter(a=>a==='sync').length;({scroll:scrollY,row:fixtureFocused.closest('tr').dataset.listKey})")
    page.evaluate("document.getElementById('admin-refresh').click()")
    page.wait_for_function("fixtureCalls.filter(a=>a==='sync').length>fixturePollCount")
    page.wait_for_timeout(100)
    after=page.evaluate("({scroll:scrollY,same:document.activeElement===fixtureFocused,connected:fixtureFocused.isConnected})")
    check('poll preserves focused row and document scroll',after['same'] and after['connected'] and abs(after['scroll']-before['scroll'])<2,dict(before=before,after=after))
    check('header scrolls naturally',page.locator('.topbar').bounding_box()['y']<0)
    page.keyboard.press('Enter');page.locator('#student-dialog').wait_for(state='visible')
    check('keyboard opens final registration',page.locator('#dialog-name').inner_text()=='Synthetic Student 60')
    page.keyboard.press('Escape')
    check('escape restores row focus',page.evaluate("document.activeElement===fixtureFocused&&!document.getElementById('student-dialog').open"))
    page.locator('#student-search').fill('DEMO0060')
    check('search includes final record',page.locator('#registration-rows tr').count()==1)
    page.locator('#student-search').fill('')
    page.locator('[data-admin-tab="registrations"]').focus();page.keyboard.press('End')
    check('admin tabs support End',page.evaluate("document.activeElement.dataset.adminTab==='updates'&&!document.getElementById('admin-updates').hidden"))
    page.keyboard.press('Home')
    check('admin tabs support Home',page.evaluate("document.activeElement.dataset.adminTab==='registrations'"))
    navigate(page,'reports');page.locator('#report-tab-downloads').focus();page.keyboard.press('Home')
    check('report tabs support Home',page.evaluate("document.activeElement.id==='report-tab-overview'&&!document.getElementById('report-overview').hidden"))
    page.keyboard.press('End')
    check('report tabs support End',page.evaluate("document.activeElement.id==='report-tab-teachers'&&!document.getElementById('report-manage').hidden"))
    page.locator('#report-tab-overview').click();page.locator('#report-notes-open').focus();page.keyboard.press('Enter')
    page.locator('#report-notes-dialog').wait_for(state='visible');page.keyboard.press('Escape')
    check('report dialog restores keyboard focus',page.evaluate("document.activeElement.id==='report-notes-open'"))
    page.locator('#account-tool-back').focus();page.keyboard.press('Enter')
    check('keyboard returns from admin Reports to Account tools',page.evaluate("document.body.dataset.route==='account'&&!document.getElementById('admin-account-tools').hidden&&document.querySelector('#main-nav [aria-current=page]')?.dataset.view==='account'"))
    check('admin bottom navigation omits Admin and Reports',page.locator('#main-nav [data-view="admin"]:visible,#main-nav [data-view="reports"]:visible').count()==0)
    page.locator('[data-section-info="account"]').focus();page.keyboard.press('Enter')
    page.locator('#section-info').wait_for(state='visible');page.keyboard.press('Escape')
    check('Account information restores keyboard focus',page.evaluate("document.activeElement.dataset.sectionInfo==='account'&&!document.getElementById('section-info').open"))
    page.emulate_media(reduced_motion='no-preference')
    motion=page.evaluate("""() => {
      for(const selector of ['#entries-nav','#main-nav [data-view="account"]','#admin-nav','#account-tool-back','#admin-account-reports','#account-tool-back'])document.querySelector(selector).click();
      const active=[...document.querySelectorAll('main .view')].filter(e=>!e.hidden).map(e=>e.id);
      const animations=document.getAnimations().filter(a=>a.effect?.target?.closest('main .view'));
      return {route:document.body.dataset.route,active,animations:animations.length,frames:animations.map(a=>a.effect.getKeyframes().map(k=>({opacity:k.opacity,transform:k.transform}))),snapshots:document.querySelectorAll('[data-motion-snapshot]').length};
    }""")
    check('rapid navigation leaves only latest authorized view',motion['route']=='account' and motion['active']==['view-account'] and motion['snapshots']==0,motion)
    page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(50)
    check('system reduced motion cancels transitions',page.evaluate("document.getAnimations().filter(a=>a.effect?.target?.closest('main .view')&&a.playState==='running').length===0"))
    page.emulate_media(reduced_motion='no-preference')
    navigate(page,'admin');check('native reduced motion cancels transitions',page.evaluate("NavrangMotion.setReducedMotion(true);document.getAnimations().filter(a=>a.effect?.target?.closest('main .view')&&a.playState==='running').length===0"))
    page.evaluate("NavrangMotion.setReducedMotion(false)")
    navigate(page,'reports');page.locator('#report-tab-overview').click();page.locator('#report-notes-open').click()
    page.evaluate("""async p=>{window.fixtureProfile=p;await GateClient.api('me');onGateEvent(JSON.stringify({type:'profile'}));}""",PROFILE['faculty'])
    role=page.evaluate("""() => ({route:document.body.dataset.route,rows:[...document.querySelectorAll('#registration-rows tr,#recent-entries tr,#all-entry-rows tr,#checker-list .checker-row,#report-teachers .report-member')].length,teacherTabHidden:document.getElementById('report-tab-teachers').hidden,dialogOpen:document.getElementById('report-notes-dialog').open})""")
    # Faculty keeps report access, so the report evidence dialog remains authorized.
    check('admin loss removes private lists and teacher controls',role['rows']==0 and role['teacherTabHidden'] and page.locator('#admin-account-tools:visible').count()==0 and page.locator('#reports-nav').is_visible(),role)
    page.evaluate("""async p=>{window.fixtureProfile=p;await GateClient.api('me');onGateEvent(JSON.stringify({type:'profile'}));}""",PROFILE['checker'])
    lost=page.evaluate("""() => ({route:document.body.dataset.route,dialogs:document.querySelectorAll('#report-notes-dialog[open],#report-totals-dialog[open],#report-teacher-dialog[open],#report-download-dialog[open]').length,metrics:document.getElementById('report-stats').children.length,animations:document.getAnimations().filter(a=>a.effect?.target?.closest('main .view')&&a.playState==='running'&&!(a instanceof CSSAnimation)).length,cssAnimations:document.getAnimations().filter(a=>a instanceof CSSAnimation&&a.playState==='running').map(a=>({name:a.animationName,target:a.effect?.target?.className,private:!!a.effect?.target?.closest('.view[hidden]')}))})""")
    check('report access loss closes evidence and clears metrics',lost['route']=='home' and lost['dialogs']==0 and lost['metrics']==0 and lost['animations']==0 and not any(a['private'] for a in lost['cssAnimations']),lost)
    page.screenshot(path=str(out/f'role-loss-{width}x{height}.png'))
    unexpected.extend(page.evaluate('fixtureUnexpected'));ctx.close()
    ctx=browser.new_context(viewport=dict(width=width,height=height),reduced_motion='no-preference');ctx.route('**/*',lambda route:route.abort())
    page=ctx.new_page();page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append(str(e)));ready()
    page.locator('#registration-rows tr:last-child button').first.click()
    page.evaluate("window.fixtureAuthLost=true;GateClient.api('sync').catch(()=>{})")
    page.wait_for_function("GateClient.profile()===null")
    auth=page.evaluate("""() => ({route:document.body.dataset.route,rows:document.querySelectorAll('#registration-rows tr,#recent-entries tr,#all-entry-rows tr').length,dialogs:document.querySelectorAll('dialog[open]').length,animations:document.getAnimations().filter(a=>a.effect?.target?.closest('main .view')&&a.playState==='running').length})""")
    check('401 clears private rows and dialogs without an exit snapshot',auth['route']=='login' and auth['rows']==0 and auth['dialogs']==0 and auth['animations']==0,auth)
    page.screenshot(path=str(out/f'auth-loss-{width}x{height}.png'));unexpected.extend(page.evaluate('fixtureUnexpected'));ctx.close()
   sizes=[tuple(map(int,size.split('x'))) for size in args.sizes.split(',')]
   if args.login_only:
    for width,height in sizes:
     for scale in (1,1.6):
      ctx=browser.new_context(viewport=dict(width=width,height=height),reduced_motion='reduce')
      ctx.route('**/*',lambda route:route.abort())
      page=ctx.new_page();page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append(str(e)))
      open_source(page,'login')
      page.evaluate("if(!document.getElementById('intro').hidden)document.getElementById('skip-intro').click()")
      page.wait_for_timeout(650)
      if scale!=1:
       # Synthetic text enlargement, not an Android OS font setting or actual IME.
       page.evaluate("scale=>{const items=[...document.querySelectorAll('#view-login *')].map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,size]of items)e.style.fontSize=(size*scale)+'px'}",scale)
      def login_shot(state,anchor):
       page.locator(anchor).scroll_into_view_if_needed()
       page.wait_for_timeout(100)
       data=page.evaluate("""() => {
        const root=document.querySelector('#view-login');
        const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
        const controls=[...root.querySelectorAll('button,input,summary')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.textContent.trim(),height:r.height,left:r.left,right:r.right}});
        const textMetrics=[...root.querySelectorAll('h2,button')].filter(visible).map(e=>({id:e.id||e.textContent.trim(),overflowY:getComputedStyle(e).overflowY,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));
        const textOverflow=textMetrics.filter(e=>e.scrollWidth>e.clientWidth+1||(e.overflowY!=='visible'&&e.scrollHeight>e.clientHeight+1));
        const visibleVerticalExtents=textMetrics.filter(e=>e.overflowY==='visible'&&e.scrollHeight>e.clientHeight+1);
        const f=document.activeElement,s=f?getComputedStyle(f):null;
        return {controls,textOverflow,visibleVerticalExtents,focus:f?.id,outline:s?.outlineWidth,outlineColor:s?.outlineColor,background:s?.backgroundColor,masked:[...root.querySelectorAll('input[type=password]')].map(e=>e.type)};
       }""")
       for control in data['controls']:
        if control['height']<47.9 or control['left'] < -1 or control['right']>width+1:failures.append(dict(loginControl=control,width=width,scale=scale,state=state))
       if data['textOverflow']:failures.append(dict(loginTextOverflow=data['textOverflow'],width=width,scale=scale,state=state))
       if state.endswith('focused') and (data['outline']!='2px' or data['outlineColor']!='rgb(246, 242, 245)'):failures.append(dict(loginFocus=data,state=state))
       filename=f'classic-login-{state}-{width}x{height}-text{scale}.png'
       page.screenshot(path=str(out/filename))
       reports.append(dict(classicLogin=state,width=width,height=height,textScale=scale,details=data))
       review_shots.append(dict(file=filename,state=state,synthetic=True,renderer='Chromium production DOM/CSS/JS with fixture transport'))
      login_shot('welcome','#auth-staff')
      page.locator('#auth-staff').click();login_shot('roles','[data-login-role=checker]')
      page.locator('[data-login-role=checker]').click();login_shot('google','#google-signin')
      page.locator('#code-login summary').click();page.locator('#checker-code').fill('SYNTHETIC');page.locator('#checker-code').focus()
      login_shot('staff-focused','#checker-code')
      page.locator('#auth-back').click();page.locator('#auth-back').click();page.locator('#show-admin-login').click()
      page.locator('#admin-password').fill('SYNTHETIC');page.locator('#admin-password').focus()
      login_shot('admin-focused','#admin-password')
      unexpected.extend(page.evaluate('window.fixtureUnexpected'));ctx.close()
    sizes=[]
   if args.interactions_only:
    for width,height in sizes:interaction_review(width,height)
    sizes=[]
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
     if role=='admin':navigate(page,'admin')
     measure(page,role,view,width,height)
     if role=='faculty':
      measure_report_downloads(page)
      if args.report_stress:
       page.evaluate("""()=>{window.fixtureTextStyles=[...document.querySelectorAll('body *')].map(e=>[e,e.style.fontSize,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,,size]of fixtureTextStyles)if(Number.isFinite(size))e.style.fontSize=(size*2)+'px';const n=document.getElementById('notice');n.textContent='Synthetic expanded connection notice: changes remain saved on the server.';n.hidden=false;NavrangReportLayout.fit()}""")
       page.wait_for_timeout(100);measure_report_downloads(page)
       page.evaluate("for(const [e,old]of fixtureTextStyles)e.style.fontSize=old;document.getElementById('notice').hidden=true;NavrangReportLayout.fit()")
     if role=='admin':measure_control(page,'#registration-count','Student list footer',minimum=0,scroll=True)
     if role=='login':
      page.evaluate("document.getElementById('google-browser-signin').hidden=false")
      measure(page,role,'login-native-browser-fallback',width,height)
     if width in (320,390,640,1366):
      page.screenshot(path=str(out/f'{role}-{width}.png'))
     if role=='admin':
      measure_scroll(page,'students')
      for target in ('reports','desk','account','settings','entries','station'):
       if target=='station':
        navigate(page,'account');page.locator('#switch-station').click()
       else:navigate(page,target)
       page.wait_for_timeout(70);measure(page,role,target,width,height)
       if width in (320,390,640,1366):page.screenshot(path=str(out/f'admin-{target}-{width}.png'))
       if target=='settings':
        summary=page.locator('#settings-location-audio summary')
        measure_control(page,'#settings-location-audio summary','Location & audio settings')
        assert not page.locator('#settings-location-audio').evaluate('e=>e.open')
        summary.click();assert page.locator('#settings-location-audio').evaluate('e=>e.open')
        measure(page,role,'settings-location-audio',width,height)
        if width>=960:
         toggle=page.locator('#portal-menu-toggle')
         assert page.locator('#main-nav').bounding_box()['x'] < page.locator('main').bounding_box()['x']
         toggle.click()
         assert toggle.get_attribute('aria-expanded')=='false' and page.locator('#main-nav').is_hidden()
         toggle.click()
         assert toggle.get_attribute('aria-expanded')=='true' and page.locator('#main-nav').is_visible()
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
        measure_control(page,'#desk-records .desk-record:last-child button','Last saved Help Desk record')
        records_bottom=page.locator('#desk-records .desk-record').last.bounding_box()['y']+page.locator('#desk-records .desk-record').last.bounding_box()['height']
        footer_top=page.locator('#desk-list-panel .list-footer').bounding_box()['y']
        if footer_top<records_bottom-.5:failures.append(dict(helpDeskFooterOverlapsRecords=True,width=width,height=height,footerTop=footer_top,recordsBottom=records_bottom))
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
        measure_control(page,'#entry-coverage','Entry list footer',minimum=0,scroll=True)
        measure_scroll(page,'entries')
      navigate(page,'admin')
      for tab in ('registrations','admissions','checkers','updates'):
       page.locator(f'[data-admin-tab="{tab}"]').click();measure(page,role,'admin-'+tab,width,height)
       if tab=='checkers':
        measure_control(page,'#checker-list .checker-row button','Manage access')
        measure_control(page,'#staff-count','Staff list footer',minimum=0,scroll=True)
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
