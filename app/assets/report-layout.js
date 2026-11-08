(function(root){
 'use strict';const $=id=>document.getElementById(id);
 function mount({isAdmin}){
  const view=$('view-reports');if(!view)return null;
  const panels={overview:$('report-overview'),downloads:$('report-downloads'),teachers:$('report-manage')};let active='downloads';
  const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
  const tabs=make('div',null,'report-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Reports');
  for(const [key,name]of Object.entries({overview:'Overview',downloads:'Downloads',teachers:'Teacher access'})){
   const b=make('button',name,'button quiet');b.id='report-tab-'+key;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls',panels[key].id);panels[key].setAttribute('role','tabpanel');panels[key].setAttribute('aria-labelledby',b.id);b.onclick=()=>select(key);tabs.append(b);
  }
  view.querySelector('.section-title').after(tabs);
  $('report-status').classList.add('report-download-status');panels.downloads.append($('report-status'));
  const dialogs=[];
  function dialog(id,title){const d=make('dialog');d.id=id;d.setAttribute('aria-label',title);const h=make('h3',title),close=make('button','Close','button secondary');close.type='button';let opener;d.append(h,close);close.onclick=()=>{d.close?.();d.removeAttribute('open');if(opener?.isConnected)opener.focus()};document.body.append(d);dialogs.push(d);return {node:d,open(){opener=document.activeElement;root.NavrangMotion?.cancel();if(d.showModal)d.showModal();else d.setAttribute('open','');root.NavrangMotion?.enter(d)}}}
  const notesDialog=dialog('report-notes-dialog','Report evidence'),notes=make('button','Evidence','button quiet');notes.id='report-notes-open';notes.type='button';notes.onclick=()=>notesDialog.open();notesDialog.node.append($('report-caveat'));panels.overview.querySelector('.panel-heading').append(notes);
  panels.overview.append(make('p','Includes organizer confirmations.','report-provenance'));
  const messageDialog=dialog('report-message-dialog','Report status'),message=make('p');messageDialog.node.append(message);
  const live=make('div',null,'sr-only');live.setAttribute('role','status');live.setAttribute('aria-live','polite');view.append(live);
  const teacherSearch=make('input');teacherSearch.id='report-teacher-search';teacherSearch.type='search';teacherSearch.placeholder='Name or email';teacherSearch.setAttribute('aria-label','Search teacher accounts');teacherSearch.setAttribute('aria-controls','report-teachers');panels.teachers.querySelector('h3').after(teacherSearch);teacherSearch.oninput=fit;
  function fit(){if(!view.isConnected)return;const query=teacherSearch.value.trim().toLowerCase();for(const n of $('report-teachers').children)n.hidden=!n.textContent.toLowerCase().includes(query);for(const n of $('report-stats').children)n.hidden=false}
  function select(key){if(!panels[key]||key==='teachers'&&!isAdmin())return;active=key;for(const [name,panel]of Object.entries(panels)){const selected=name===key;panel.hidden=!selected;const tab=$('report-tab-'+name);tab.hidden=name==='teachers'&&!isAdmin();tab.tabIndex=selected?0:-1;tab.setAttribute('aria-selected',String(selected))}fit()}
  function refreshAccess(){const p=root.GateClient?.profile(),admin=isAdmin();if(!admin){teacherSearch.value='';$('report-teachers').replaceChildren();if(active==='teachers')active='downloads'}if(!admin&&!(p?.role==='checker'&&p.active===true&&p.reports===true&&!root.GateClient?.sessionExpired?.(p))){for(const d of dialogs){d.close?.();d.removeAttribute('open')}message.textContent=live.textContent='';$('report-stats').replaceChildren();$('report-caveat').textContent=''}select(active)}
  tabs.addEventListener('keydown',e=>{const allowed=[...tabs.children].filter(b=>!b.hidden),index=allowed.indexOf(document.activeElement);let n;if(e.key==='Home')n=allowed[0];else if(e.key==='End')n=allowed.at(-1);else if(e.key==='ArrowRight')n=allowed[(index+1)%allowed.length];else if(e.key==='ArrowLeft')n=allowed[(index+allowed.length-1)%allowed.length];if(n){e.preventDefault();n.click();n.focus()}});
  new MutationObserver(fit).observe($('report-teachers'),{childList:true});
  root.GateClient?.on(e=>{if(['auth','profile'].includes(e.type))refreshAccess()});
  const api={refreshAccess,fit,setStatus(value,{error=false}={}){live.textContent=message.textContent=value;if(error&&!view.hidden&&active!=='downloads')messageDialog.open()},setMetrics(values){const grid=$('report-stats');values.forEach(([label,value],i)=>{let n=grid.children[i];if(!n){n=make('article',null,'report-stat');n.append(make('span'),make('strong'));grid.append(n)}n.children[0].textContent=label;n.children[1].textContent=String(value)});while(grid.children.length>values.length)grid.lastElementChild.remove();fit()}};refreshAccess();return api;
 }
 root.ReportLayout={mount};root.NavrangReportLayout=mount({isAdmin:()=>{const p=root.GateClient?.profile();return p?.role==='admin'&&p.active===true&&!root.GateClient?.sessionExpired?.(p);}});
})(globalThis);
