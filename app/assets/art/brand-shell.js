/* Presentation only. Role buttons express intent; server approval remains authoritative. */
(function(root){
 'use strict';
 const C=root.GateClient,$=id=>document.getElementById(id);
 if(!C||!$('view-login'))return;
 const el=(tag,content,cls)=>{const n=document.createElement(tag);if(content!=null)n.textContent=content;if(cls)n.className=cls;return n;};
 const identity=()=>{const p=C.profile();return [p?.role||'',p?.checkerId||'',p?.active===true,p?.reports===true].join(':');};
 const reportsAllowed=()=>{const p=C.profile();return p?.role==='admin'||p?.active===true&&p?.reports===true;};
 let requestBusy=false,requestGeneration=0,lastIdentity=identity(),requestedFor='';
 function eventMark(size){
  const mark=el('span',null,'event-wordmark classic-event-mark '+(size||''));mark.setAttribute('role','img');mark.setAttribute('aria-label','Navrang');
  const image=el('img');image.src='art/navrang-transparent.png';image.alt='Navrang';image.className='classic-event-logo';image.draggable=false;mark.append(image);return mark;
 }
 function universityMark(){const image=el('img');image.src='art/parul-goa.svg';image.alt='Parul University Goa';image.className='institution-wordmark';return image;}
 function brandLine(target){if(!target)return;target.replaceChildren(el('span','Navrang · Parul University Goa','compact-brand-copy'));target.classList.add('official-brand-line');}
 const intro=document.querySelector('.intro-content'),heading=intro?.querySelector('h1');
 if(heading)heading.hidden=true;
 // The approved combined artwork is present in static HTML before first paint.
 // Supporting copy stays in normal flow; no extra university mark or lettering is overlaid.
 const dancerRow=el('div',null,'intro-dancers');dancerRow.setAttribute('aria-hidden','true');document.querySelector('.intro-content')?.after(dancerRow);
 for(const side of ['left','right']){
  const dancer=document.querySelector('.intro>.dancer-'+side);if(!dancer)continue;
  const stage=el('div',null,'dancer-stage dancer-stage-'+side);dancerRow.append(stage);stage.append(dancer);
 }
 const header=document.querySelector('.brand'),oldIcon=header?.querySelector(':scope>img');
 if(oldIcon){oldIcon.src='art/navrang-transparent.png';oldIcon.classList.add('classic-header-logo');header.classList.add('official-header');}
 for(const target of document.querySelectorAll('.app-footer,.login-foot')){target.textContent='Made by Namdev';target.classList.add('creator-credit');}
 document.querySelector('.login-card>.official-logo')?.remove();
 for(const target of document.querySelectorAll('.section-title>.eyebrow,.station-heading>.eyebrow,#view-desk>.panel-heading>div>.eyebrow')){
  if(/PARUL UNIVERSITY GOA/i.test(target.textContent)){const title=el('span',null,'institution-label');title.append(universityMark());target.replaceChildren(title);}
 }
 document.querySelector('.login-card')?.classList.add('crafted-login');
 const adminTitle=document.querySelector('#admin-signin h2');if(adminTitle)adminTitle.textContent='Administration';
 const accountCopy=document.querySelector('#signedin-panel>.micro-note');if(accountCopy)accountCopy.textContent='Your assigned permissions are checked by the server. An account choice never grants access by itself.';
 const introSkip=$('skip-intro');if(introSkip)introSkip.setAttribute('aria-label','Skip opening animation and open the app');
 const faculty=el('button',null,'station-card faculty-station');faculty.id='station-faculty';faculty.type='button';
 const facultyTitle=el('strong','Faculty'),facultyCopy=el('span','Read-only attendance and issue reports'),facultyState=el('small','Administrator approval required'),facultyAction=el('span','Request reports','station-action');
 const facultyBody=el('span',null,'station-card-copy');facultyBody.append(facultyTitle,facultyCopy,facultyState);faculty.append(facultyBody,facultyAction);
 document.querySelector('.station-options')?.append(faculty);
 const accountReports=el('button','Faculty reports','button secondary');accountReports.id='account-faculty';accountReports.type='button';$('signedin-panel')?.append(accountReports);
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
  paint();
 }});
 // Copy-only changes never rebuild scanner rows or reset gate/session state.
 paint();paintPageTitle();
 root.NavrangBrand={eventMark,paint};
})(globalThis);
