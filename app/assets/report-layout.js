(function(root){
 'use strict';const $=id=>document.getElementById(id);
 function mount({isAdmin}){
  if(!$('view-reports'))return null;
  const view=$('view-reports'),panels={overview:$('report-overview'),downloads:$('report-downloads'),teachers:$('report-manage')};let active='downloads',metricsPage=0,membersPage=0,downloadStep='dataset';
  const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
  const tabs=make('div',null,'report-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Reports');
  const names={overview:'Overview',downloads:'Downloads',teachers:'Teacher access'};
  for(const [key,name]of Object.entries(names)){const b=make('button',name,'button quiet');b.id='report-tab-'+key;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls',panels[key].id);panels[key].setAttribute('role','tabpanel');panels[key].setAttribute('aria-labelledby',b.id);b.onclick=()=>select(key);tabs.append(b)}
  view.querySelector('.section-title').after(tabs);
  const details=make('dialog',null,'report-notes-dialog');details.id='report-notes-dialog';details.setAttribute('aria-labelledby','report-notes-title');const dt=make('h3','Report evidence');dt.id='report-notes-title';const close=make('button','Close','button secondary');close.type='button';close.onclick=()=>{details.close?.();details.removeAttribute('open');notes.focus()};details.append(dt,$('report-caveat'),close);document.body.append(details);
  const overviewHeading=panels.overview.querySelector('.panel-heading');
  const notes=make('button','Evidence','button quiet');notes.id='report-notes-open';notes.type='button';notes.onclick=()=>details.showModal?details.showModal():details.setAttribute('open','');panels.overview.append(make('p','Includes organizer confirmations.','report-provenance'));panels.overview.querySelector('.panel-heading').append(notes);
  $('report-status').classList.add('report-download-status');panels.downloads.append($('report-status'));
  function pager(id,parent,change){const n=make('div',null,'compact-pager'),prev=make('button','←','button quiet'),state=make('span','1 / 1'),next=make('button','→','button quiet');prev.type=next.type='button';prev.setAttribute('aria-label','Previous page');next.setAttribute('aria-label','Next page');prev.id=id+'-previous';next.id=id+'-next';state.setAttribute('role','status');prev.onclick=()=>change(-1);next.onclick=()=>change(1);n.append(prev,state,next);parent.append(n);return{n,prev,next,state}}
  const mp=pager('report-metrics',panels.overview,d=>{metricsPage+=d;fit()}),tp=pager('report-members',panels.teachers,d=>{membersPage+=d;fit()});
  const dataset=make('div',null,'report-dataset');dataset.append(panels.downloads.querySelector('label'),$('report-kind'));panels.downloads.querySelector('h3').after(dataset);const nextFormat=make('button','Choose format →','button primary'),backDataset=make('button','← Dataset','button quiet');nextFormat.id='report-download-next';backDataset.id='report-download-back';nextFormat.type=backDataset.type='button';nextFormat.onclick=()=>{downloadStep='format';fit();if(!downloadOpen.hidden)downloadOpen.click()};backDataset.onclick=()=>{downloadStep='dataset';fit()};dataset.after(nextFormat);panels.downloads.prepend(backDataset);
  const formatBox=make('div',null,'report-format-choice'),format=make('select'),save=make('button','Download','button primary');format.id='report-format';format.setAttribute('aria-label','File format');save.id='report-download-selected';save.type='button';for(const [value,label]of [['csv','CSV'],['xlsx','Excel'],['pdf','PDF summary']]){const o=make('option',label);o.value=value;format.append(o)}formatBox.append(format,save);panels.downloads.querySelector('.report-actions').after(formatBox);
  const syncSave=()=>{if(!view.isConnected)return;save.disabled=$('report-'+format.value).disabled};format.onchange=syncSave;save.onclick=()=>{const canonical=$('report-'+format.value);if(!canonical.disabled)canonical.click()};const saveObserver=new MutationObserver(syncSave);for(const key of ['csv','xlsx','pdf'])saveObserver.observe($('report-'+key),{attributes:true,attributeFilter:['disabled']});
  const totals=make('dialog',null,'report-totals-dialog');totals.id='report-totals-dialog';totals.setAttribute('aria-labelledby','report-totals-title');const totalsTitle=make('h3','Attendance overview');totalsTitle.id='report-totals-title';const totalsClose=make('button','Close','button secondary'),openTotals=make('button','Totals','button primary');openTotals.id='report-totals-open';openTotals.type=totalsClose.type='button';totalsClose.onclick=()=>{totals.close?.();totals.removeAttribute('open');openTotals.focus()};totals.append(totalsTitle,totalsClose);document.body.append(totals);panels.overview.querySelector('.panel-heading').after(openTotals);openTotals.onclick=()=>totals.showModal?totals.showModal():totals.setAttribute('open','');
  const teacherSearch=make('input');teacherSearch.id='report-teacher-search';teacherSearch.type='search';teacherSearch.placeholder='Name or email';teacherSearch.setAttribute('aria-label','Search teacher accounts');panels.teachers.querySelector('h3').after(teacherSearch);teacherSearch.oninput=()=>{membersPage=0;if(teacherDialog.open){for(const n of $('report-teachers').children)n.hidden=!n.textContent.toLowerCase().includes(teacherSearch.value.trim().toLowerCase())}else fit()};
  const teacherDialog=make('dialog',null,'report-teacher-dialog');teacherDialog.id='report-teacher-dialog';teacherDialog.setAttribute('aria-labelledby','report-teacher-dialog-title');const teacherTitle=make('h3','Teacher access');teacherTitle.id='report-teacher-dialog-title';const teacherClose=make('button','Close','button secondary'),teacherOpen=make('button','Manage access','button primary');teacherOpen.id='report-teachers-open';teacherOpen.type=teacherClose.type='button';teacherOpen.onclick=()=>teacherDialog.showModal?teacherDialog.showModal():teacherDialog.setAttribute('open','');teacherClose.onclick=()=>{teacherDialog.close?.();teacherDialog.removeAttribute('open');teacherOpen.focus()};teacherDialog.append(teacherTitle,teacherClose);document.body.append(teacherDialog);teacherSearch.after(teacherOpen);
  const live=make('div',null,'sr-only');live.setAttribute('role','status');live.setAttribute('aria-live','polite');view.append(live);const messageDialog=make('dialog');messageDialog.id='report-message-dialog';messageDialog.setAttribute('aria-label','Report status');const message=make('p'),messageClose=make('button','Close','button secondary');messageClose.type='button';messageClose.onclick=()=>{messageDialog.close?.();messageDialog.removeAttribute('open')};messageDialog.append(message,messageClose);document.body.append(messageDialog);
  const downloadDialog=make('dialog');downloadDialog.id='report-download-dialog';downloadDialog.setAttribute('aria-label','Download data');const downloadOpen=make('button','Download data','button primary'),downloadClose=make('button','Close','button secondary');downloadOpen.id='report-download-open';downloadOpen.type=downloadClose.type='button';downloadClose.id='report-download-close';downloadOpen.onclick=()=>downloadDialog.showModal?downloadDialog.showModal():downloadDialog.setAttribute('open','');downloadClose.onclick=()=>{downloadDialog.close?.();downloadDialog.removeAttribute('open');downloadOpen.focus()};downloadDialog.append(downloadClose);document.body.append(downloadDialog);panels.downloads.append(downloadOpen);
  const description=panels.downloads.querySelector('.micro-note:not(#report-status)');if(description)description.textContent='CSV / Excel: selected data. PDF: statistical summary.';
  function applyPage(children,page,size,pager){const part=root.NavrangPages.pageItems(children,{page,size});for(const node of children)node.hidden=!part.items.includes(node);pager.prev.disabled=part.page===0;pager.next.disabled=part.page===part.pages-1;pager.state.textContent=(part.page+1)+' / '+part.pages;pager.n.hidden=part.pages===1;return part.page}
  function fit(){
   if(!view.isConnected)return;
   const grid=$('report-stats'),metrics=[...grid.children],allMembers=[...$('report-teachers').children],members=allMembers.filter(n=>n.textContent.toLowerCase().includes(teacherSearch.value.trim().toLowerCase())),panel=panels.overview;
   // Measure rendered cards; text scaling and notices change the space available.
   if(!panel.hidden&&!totals.open){
    if(overviewHeading.parentElement===totals)panel.prepend(overviewHeading);if(grid.parentElement===totals)openTotals.after(grid);const provenance=totals.querySelector('.report-provenance');if(provenance)panel.append(provenance);
    openTotals.hidden=true;grid.hidden=false;
    mp.n.hidden=false;for(const n of metrics)n.hidden=false;
    const bound=grid.getBoundingClientRect(),cardHeight=Math.max(0,...metrics.map(n=>n.getBoundingClientRect().height));
    const columns=root.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length||2;
    const size=cardHeight>0?Math.max(1,Math.floor(bound.height/cardHeight)*columns):4;
    metricsPage=applyPage(metrics,metricsPage,size,mp);
    const fits=()=>{const area=grid.getBoundingClientRect();return metrics.filter(n=>!n.hidden).every(n=>{const r=n.getBoundingClientRect();return r.top>=area.top-1&&r.bottom<=area.bottom+1})};
    // Large accessibility text can leave less room than even one card. Keep the
    // Reports screen fixed and expose the same totals in an explicit dialog.
    if(panel.clientHeight>0&&!fits()){
     totals.insertBefore(overviewHeading,totalsClose);totals.insertBefore(grid,totalsClose);totals.insertBefore(panel.querySelector('.report-provenance'),totalsClose);for(const n of metrics)n.hidden=false;
     openTotals.hidden=false;mp.n.hidden=true;
    }
   }
   if(!panels.teachers.hidden&&!teacherDialog.open){
    const list=$('report-teachers');if(teacherSearch.parentElement===teacherDialog)teacherOpen.before(teacherSearch);if(list.parentElement===teacherDialog)teacherOpen.after(list);teacherOpen.hidden=true;tp.n.hidden=false;
    for(const n of allMembers)n.hidden=!members.includes(n);
    const area=list.getBoundingClientRect(),height=Math.max(0,...members.map(n=>n.getBoundingClientRect().height));
    membersPage=applyPage(members,membersPage,height>0?Math.max(1,Math.floor(area.height/height)):3,tp);
    if(height>0&&members.filter(n=>!n.hidden).some(n=>n.getBoundingClientRect().bottom>list.getBoundingClientRect().bottom+1)){
     teacherDialog.insertBefore(teacherSearch,teacherClose);teacherDialog.insertBefore(list,teacherClose);for(const n of members)n.hidden=false;teacherOpen.hidden=false;tp.n.hidden=true;
    }
   }
   if(!panels.downloads.hidden&&!downloadDialog.open){
    for(const child of [...downloadDialog.children])if(child!==downloadClose)panels.downloads.insertBefore(child,downloadOpen);downloadOpen.hidden=true;
    const compact=panels.downloads.clientHeight>0&&panels.downloads.clientHeight<290;panels.downloads.dataset.downloadStep=compact?downloadStep:'all';dataset.hidden=compact&&downloadStep==='format';nextFormat.hidden=!compact||downloadStep!=='dataset';backDataset.hidden=!compact||downloadStep!=='format';panels.downloads.querySelector('.report-actions').hidden=compact;formatBox.hidden=!compact||downloadStep!=='format';if(description)description.hidden=compact;
    const area=panels.downloads.getBoundingClientRect();
    if(area.height>0&&[...panels.downloads.querySelectorAll('button,input,select')].filter(n=>!n.hidden&&n.getClientRects().length).some(n=>n.getBoundingClientRect().bottom>area.bottom-8)){
     panels.downloads.dataset.downloadStep='all';dataset.hidden=false;nextFormat.hidden=backDataset.hidden=formatBox.hidden=true;panels.downloads.querySelector('.report-actions').hidden=false;if(description)description.hidden=false;
     for(const child of [...panels.downloads.children])if(child!==downloadOpen)downloadDialog.insertBefore(child,downloadClose);downloadOpen.hidden=false;
    }
   }
   syncSave();
  }
  function select(key){if(!panels[key]||key==='teachers'&&!isAdmin())return;active=key;for(const [name,panel]of Object.entries(panels)){const selected=name===key;panel.hidden=!selected;const tab=$('report-tab-'+name);tab.hidden=name==='teachers'&&!isAdmin();tab.tabIndex=selected?0:-1;tab.setAttribute('aria-selected',String(selected));}fit()}
  function refreshAccess(){const p=root.GateClient?.profile();if(!isAdmin()){teacherDialog.close?.();teacherDialog.removeAttribute('open')}if(!p||p.role!=='admin'&&!(p.active&&p.reports)){for(const d of [totals,details,messageDialog,downloadDialog]){d.close?.();d.removeAttribute('open')}metricsPage=membersPage=0;downloadStep='dataset';}if(active==='teachers'&&!isAdmin())active='downloads';select(active)}
  tabs.addEventListener('keydown',e=>{const allowed=[...tabs.children].filter(b=>!b.hidden),index=allowed.indexOf(document.activeElement),key=e.key;let n;if(key==='Home')n=allowed[0];else if(key==='End')n=allowed.at(-1);else if(key==='ArrowRight')n=allowed[(index+1)%allowed.length];else if(key==='ArrowLeft')n=allowed[(index+allowed.length-1)%allowed.length];if(n){e.preventDefault();n.click();n.focus()}});
  const observer=new MutationObserver(fit);observer.observe($('report-stats'),{childList:true});observer.observe($('report-teachers'),{childList:true});if(root.ResizeObserver)new ResizeObserver(fit).observe(view);root.addEventListener('resize',fit);
  root.GateClient?.on(e=>{if(['auth','profile'].includes(e.type))refreshAccess()});
  const api={refreshAccess,fit,setStatus(value,{error=false}={}){fit();live.textContent=value;message.textContent=value;if(error&&!view.hidden&&active!=='downloads'){if(messageDialog.showModal)messageDialog.showModal();else messageDialog.setAttribute('open','')}},setMetrics(values){const nodes=values.map(([label,value])=>{const n=make('article',null,'report-stat');n.append(make('span',label),make('strong',String(value)));return n});$('report-stats').replaceChildren(...nodes);metricsPage=0;fit()}};refreshAccess();return api;
 }
 root.ReportLayout={mount};root.NavrangReportLayout=mount({isAdmin:()=>root.GateClient?.profile()?.role==='admin'});
})(globalThis);
