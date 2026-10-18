/* Presentation only. Role buttons express intent; server approval remains authoritative. */
(function(root){
 'use strict';
 const C=root.GateClient,$=id=>document.getElementById(id);
 if(!C||!$('view-login'))return;
 const el=(tag,content,cls)=>{const n=document.createElement(tag);if(content!=null)n.textContent=content;if(cls)n.className=cls;return n;};
 const identity=()=>{const p=C.profile();return [p?.role||'',p?.checkerId||'',p?.active===true,p?.reports===true].join(':');};
 const reportsAllowed=()=>{const p=C.profile();return p?.role==='admin'||p?.active===true&&p?.reports===true;};
 let role='checker',requestBusy=false,requestGeneration=0,lastIdentity=identity(),requestedFor='';
 try{const saved=sessionStorage.getItem('navrang-login-intent');if(['checker','helpdesk','faculty'].includes(saved))role=saved;}catch{}
 function eventMark(size){
  const mark=el('span',null,'event-wordmark classic-event-mark '+(size||''));mark.setAttribute('role','img');mark.setAttribute('aria-label','Navrang');
  const image=el('img');image.src='art/app-icon.png';image.alt='Navrang';image.className='classic-event-logo';image.draggable=false;mark.append(image);return mark;
 }
 function universityMark(){const image=el('img');image.src='art/parul-goa.svg';image.alt='Parul University Goa';image.className='institution-wordmark';return image;}
 function brandLine(target){if(!target)return;target.replaceChildren(universityMark(),eventMark('event-wordmark-small'));target.classList.add('official-brand-line');}
 const intro=document.querySelector('.intro-content'),heading=intro?.querySelector('h1');
 if(heading){heading.hidden=true;heading.before(eventMark('event-wordmark-hero'));}
 // The authentic event artwork already includes the university and event names.
 // Keep supporting copy in normal flow, without painting duplicate names over it.
 for(const duplicate of intro?.querySelectorAll(':scope>.official-logo,:scope>.eyebrow')||[])duplicate.hidden=true;
 const dancerRow=el('div',null,'intro-dancers');dancerRow.setAttribute('aria-hidden','true');document.querySelector('.intro-content')?.after(dancerRow);
 for(const side of ['left','right']){
  const dancer=document.querySelector('.intro>.dancer-'+side);if(!dancer)continue;
  const stage=el('div',null,'dancer-stage dancer-stage-'+side);dancerRow.append(stage);stage.append(dancer);
 }
 const header=document.querySelector('.brand'),oldIcon=header?.querySelector(':scope>img');
 if(oldIcon){oldIcon.classList.add('classic-header-logo');header.classList.add('official-header');}
 for(const target of document.querySelectorAll('.app-footer,.login-foot'))brandLine(target);
 for(const target of document.querySelectorAll('.section-title>.eyebrow,.station-heading>.eyebrow,#view-desk>.panel-heading>div>.eyebrow')){
  if(/PARUL UNIVERSITY GOA/i.test(target.textContent)){const title=el('span',null,'institution-label');title.append(universityMark());target.replaceChildren(title);}
 }
 const card=document.querySelector('.login-card');card?.classList.add('crafted-login');
 const sign=$('signin-panel'),roleGroup=el('div',null,'login-role-picker');roleGroup.setAttribute('aria-label','Choose how you are working');roleGroup.setAttribute('role','group');
 const descriptions={checker:['Checker','Scan and verify entry'],helpdesk:['Help Desk','Resolve registration cases'],faculty:['Faculty','View and download reports']};
 for(const name of ['checker','helpdesk','faculty']){
  const b=el('button',null,'login-role');b.type='button';b.dataset.loginRole=name;
  b.append(el('strong',descriptions[name][0]),el('small',descriptions[name][1]));
  b.onclick=()=>{role=name;try{sessionStorage.setItem('navrang-login-intent',role);}catch{}paintIntent();};roleGroup.append(b);
 }
 $('signin-copy')?.after(roleGroup);
 const admin=$('show-admin-login'),adminEntry=el('div',null,'administrator-entry');
 if(admin){admin.before(adminEntry);adminEntry.append(el('span','EVENT CONTROL','administrator-label'));admin.className='administrator-button';admin.textContent='Administrator';admin.append(el('span','Full access to every station and report','administrator-caption'));adminEntry.append(admin);}
 const adminTitle=document.querySelector('#admin-signin h2');if(adminTitle)adminTitle.textContent='Administration';
 const accountCopy=document.querySelector('#signedin-panel>.micro-note');if(accountCopy)accountCopy.textContent='Your assigned permissions are checked by the server. An account choice never grants access by itself.';
 const introSkip=$('skip-intro');if(introSkip)introSkip.setAttribute('aria-label','Skip opening animation and open the app');
 const faculty=el('button',null,'station-card faculty-station');faculty.id='station-faculty';faculty.type='button';
 const facultyTitle=el('strong','Faculty'),facultyCopy=el('span','Read-only attendance and issue reports'),facultyState=el('small','Administrator approval required'),facultyAction=el('span','Request reports','station-action');
 const facultyBody=el('span',null,'station-card-copy');facultyBody.append(facultyTitle,facultyCopy,facultyState);faculty.append(facultyBody,facultyAction);
 document.querySelector('.station-options')?.append(faculty);
 const accountReports=el('button','Faculty reports','button secondary');accountReports.id='account-faculty';accountReports.type='button';$('signedin-panel')?.append(accountReports);
 function paintIntent(){
  for(const b of roleGroup.children){const selected=b.dataset.loginRole===role;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('selected',selected);}
  if($('signin-title'))$('signin-title').textContent='Welcome to the event team';
  if($('signin-copy'))$('signin-copy').textContent=role==='faculty'?'Sign in with your Google account. The administrator approves report access.':'Choose your station, then sign in. Existing assignments remain unchanged.';
  if($('code-login'))$('code-login').hidden=role==='faculty';
 }
 function paint(){
  const p=C.profile(),admin=p?.role==='admin',allowed=reportsAllowed(),staffStation=!!p?.scanner||!!p?.helpdesk;
  document.body.classList.toggle('administrator-session',!!admin);
  if($('reports-nav'))$('reports-nav').hidden=!allowed;
  faculty.hidden=!!p&&!admin&&staffStation&&!allowed;
  accountReports.hidden=!p||(!allowed&&(p.method!=='google'||staffStation));
  accountReports.textContent=allowed?'Open faculty reports':'Request faculty reports';
  const requested=p?.reportsRequested===true||requestedFor===(p?.checkerId||'');
  facultyState.textContent=allowed?(admin?'Administrator · all reports included':'Report access approved'):requested?'Access requested · awaiting administrator approval':'Administrator approval required';
  facultyAction.textContent=allowed?'Open reports':requested?'Access requested':'Request reports';
  faculty.disabled=requestBusy||(!allowed&&p?.method!=='google');
 }
 async function openFaculty(){
  const p=C.profile();if(reportsAllowed()){$('reports-nav')?.click();return;}
  if(!p||p.method!=='google'||requestBusy)return;
  if(p.scanner||p.helpdesk){const n=$('notice');if(n){n.textContent='Ask the administrator to change your existing station before requesting faculty access.';n.hidden=false;}return;}
  const who=identity(),version=++requestGeneration;requestBusy=true;paint();
  try{await C.api('reports-request',{});if(version!==requestGeneration||identity()!==who)return;requestedFor=p.checkerId||'';facultyState.textContent='Access requested · awaiting administrator approval';facultyAction.textContent='Access requested';}
  catch(e){if(version===requestGeneration&&who===identity())facultyState.textContent=e.message||'Request could not be saved. Try again.';}
  finally{if(version===requestGeneration){requestBusy=false;faculty.disabled=false;}}
 }
 faculty.onclick=accountReports.onclick=openFaculty;
 const title=$('page-title');
 function paintPageTitle(){/* Original page titles are retained. */}
 if(title&&root.MutationObserver)new MutationObserver(paintPageTitle).observe(title,{childList:true,characterData:true,subtree:true});
 const docVisibility=()=>document.body.classList.toggle('motion-paused',document.hidden);
 document.addEventListener('visibilitychange',docVisibility);docVisibility();
 C.on(e=>{if(['auth','profile','sync'].includes(e.type)){
  const now=identity();if(now!==lastIdentity){requestGeneration++;requestBusy=false;requestedFor='';lastIdentity=now;}
  paint();paintIntent();
 }});
 // Copy-only changes never rebuild scanner rows or reset gate/session state.
 paintIntent();paint();paintPageTitle();
 root.NavrangBrand={eventMark,paint};
})(globalThis);
