if(typeof pdfjsLib!=='undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

let cvTextMain='', jmCvText='';
let cmpFiles=[], matCvFiles=[], matJobs=[];
let sessionCmpRequests=0;

let lastResult=null, lastMode='analiza', analyzeScorGeneral=null, blindMode=false, lastRejection=null;

const $=id=>document.getElementById(id);
const show=id=>{const e=$(id);if(e)e.style.display='block'};
const hide=id=>{const e=$(id);if(e)e.style.display='none'};
const scoreColor=s=>s>=80?'var(--accent)':s>=60?'var(--yellow)':'var(--red)';
const scoreLabel=s=>s>=80?'Excelent':s>=60?'Bun':'De îmbunătățit';

function showErr(id,msg){const e=$(id);if(e){e.textContent='⚠ '+msg;e.style.display='block'}}
function triggerFile(id){$(id).click()}

function setMode(mode){
  document.querySelectorAll('.mode-tab').forEach((t,i)=>{
    t.classList.toggle('active',['analiza','jobmatch','comparare','matching'][i]===mode);
  });
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  $('panel-'+mode).classList.add('active');
  // Auto-fill Îmbunătățire din Analiză dacă există rezultat

}

function setRTab(btn,tabId){
  const res=$('res-analiza');
  if(res){
    res.querySelectorAll('.rpanel').forEach(p=>p.classList.toggle('active',p.id===tabId));
    res.querySelectorAll('.rtab').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
  }
}

function onDrag(e,id,over){e.preventDefault();$(id)?.classList.toggle('drag',over)}
function onDrop(e,id,type){e.preventDefault();$(id)?.classList.remove('drag');
  const f=e.dataTransfer.files;
  if(type==='cmp'||type==='matcv')handleMulti(f,type);
  else if(f[0])processFile(f[0],type);}
function fileIn(inp,type){
  if(type==='cmp'||type==='matcv')handleMulti(inp.files,type);
  else if(inp.files[0])processFile(inp.files[0],type);}

async function extractText(file){
  if(file.type==='application/pdf'){
    if(typeof pdfjsLib==='undefined') throw new Error('PDF.js nu s-a încărcat — reîncarcă pagina sau folosește fișier TXT');
    const buf=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    let t='';
    for(let i=1;i<=pdf.numPages;i++){
      const pg=await pdf.getPage(i);
      const c=await pg.getTextContent();
      t+=c.items.map(x=>x.str).join(' ')+'\n';
    }
    if(!t.trim())throw new Error('PDF scanat — folosește un PDF cu text selectabil.');
    return t.trim();
  }else{
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=e=>res(e.target.result);
      r.onerror=()=>rej(new Error('Eroare la citire'));
      r.readAsText(file);
    });
  }
}

async function processFile(file,type){
  const icons={cva:['dz-a-icon','dz-a-lbl'],imp:['dz-imp-icon','dz-imp-lbl'],trcv:['dz-tr-icon','dz-tr-lbl']};
  try{
    if(icons[type])$(icons[type][1]).textContent='⏳ se extrage text...';
    const text=await extractText(file);
    if(type==='cva'){cvTextMain=text;$('cv-text').value=text;if(icons[type]){$(icons[type][0]).textContent=file.name.endsWith('.pdf')?'📕':'📄';$(icons[type][1]).textContent=file.name;}}
    else if(type==='jmcv'){jmCvText=text;$('jm-cv-t').value=text;$('jm-cv-name').textContent=file.name;$('jm-cv-chars').textContent=text.length.toLocaleString()+' caractere';show('jm-loaded');hide('jm-input');}
    else if(type==='clcv'){clCvText=text;$('cl-cv-t').value=text;$('cl-cv-name').textContent=file.name;$('cl-cv-chars').textContent=text.length.toLocaleString()+' caractere';}

    else if(type==='trcv'){trCvText=text;$('tr-text').value=text;if(icons[type]){$(icons[type][0]).textContent=file.name.endsWith('.pdf')?'📕':'📄';$(icons[type][1]).textContent=file.name;}}
  }catch(e){showErr('err-a',e.message);}
}

async function handleMulti(fileList,type){
  const files=Array.from(fileList).slice(0,50);
  const arr=[];
  for(const f of files){
    try{const text=await extractText(f);arr.push({name:f.name,text});}
    catch(e){showErr(type==='cmp'?'err-cmp':'err-mat','Eroare '+f.name+': '+e.message);}
  }
  if(type==='cmp'){cmpFiles=arr;renderCmpList();}
  else if(type==='matcv'){matCvFiles=arr;renderMatCvList();}
}

function renderCmpList(){
  if(!cmpFiles.length){hide('cmp-list');return;}
  show('cmp-list');
  $('cmp-items').innerHTML=cmpFiles.map((f,i)=>`<div style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:5px">
    <span>${f.name.endsWith('.pdf')?'📕':'📄'}</span>
    <span style="flex:1;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
    <span style="font-size:10px;color:var(--purple)">#${i+1}</span>
    <button onclick="removeCmpFile(${i})" style="background:none;border:none;color:var(--muted2);cursor:pointer;font-size:12px;padding:0 2px">✕</button>
  </div>`).join('');
  const btn=$('btn-cmp');
  btn.disabled=cmpFiles.length<2;
  const n=cmpFiles.length;
  const reqNeeded=n<2?1:Math.ceil(n/10);
  btn.textContent=n<2?'[ adaugă min. 2 cv-uri ]':`[ compară ${n} cv-uri — ${reqNeeded} request${reqNeeded>1?'uri':''} ]`;
  $('cmp-count').textContent=n+' CV-uri încărcate';
  if(n>=2){
    show('req-info');
    $('req-count-badge').textContent=reqNeeded;
    $('req-count-badge').style.background=reqNeeded<=2?'var(--green)':reqNeeded<=3?'var(--yellow)':'var(--red)';
    $('req-session-used').textContent=sessionCmpRequests;
  } else {
    hide('req-info');
  }
}

function removeCmpFile(idx){
  cmpFiles.splice(idx,1);
  renderCmpList();
  if(!cmpFiles.length)hide('cmp-list');
}

function renderMatCvList(){
  if(!matCvFiles.length){hide('mat-cv-list');return;}
  show('mat-cv-list');
  $('mat-cv-items').innerHTML=matCvFiles.map(f=>`<div style="display:flex;gap:8px;align-items:center;padding:5px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:4px">
    <span style="font-size:12px">${f.name.endsWith('.pdf')?'📕':'📄'}</span>
    <span style="flex:1;font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis">${f.name}</span>
  </div>`).join('');
  updateMatBtn();
}

function addJobField(){
  if(matJobs.length>=5)return;
  const idx=matJobs.length;
  matJobs.push({title:'',text:''});
  const div=document.createElement('div');
  div.id=`mat-job-${idx}`;
  div.style.cssText='margin-bottom:8px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:4px';
  div.innerHTML=`<div style="display:flex;justify-content:space-between;margin-bottom:5px">
    <span style="font-size:10px;color:var(--blue);font-weight:700">Job #${idx+1}</span>
    <button onclick="removeJob(${idx})" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:12px">✕</button>
  </div>
  <input type="text" placeholder="Titlu job (ex: Senior Developer)" oninput="updateJob(${idx},'title',this.value)" style="margin-bottom:5px;height:32px;resize:none">
  <textarea style="height:70px" placeholder="Cerințe și responsabilități..." oninput="updateJob(${idx},'text',this.value)"></textarea>`;
  $('mat-job-fields').appendChild(div);
  updateMatJobCount();updateMatBtn();
}

function updateJob(idx,field,val){if(matJobs[idx])matJobs[idx][field]=val;updateMatBtn();}
function removeJob(idx){const el=$(`mat-job-${idx}`);if(el)el.remove();matJobs.splice(idx,1);updateMatJobCount();updateMatBtn();}
function updateMatJobCount(){$('mat-job-count').textContent=matJobs.filter(j=>j.title||j.text).length+' joburi adăugate';}
function updateMatBtn(){
  const validJobs=matJobs.filter(j=>j.title.trim()||j.text.trim());
  const ok=matCvFiles.length>=1&&validJobs.length>=1;
  $('btn-mat').disabled=!ok;
  $('btn-mat').textContent=ok?`[ matching ${matCvFiles.length} cv x ${validJobs.length} job${validJobs.length>1?'uri':''} ]`:'[ calculează matching ]';
}

// ── API — returnează direct JSON de la backend ──────────
async function api(endpoint,body){
  const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const ct=res.headers.get('content-type')||'';
  if(!ct.includes('application/json')){
    // Server a returnat HTML (eroare 500 etc)
    throw new Error('Eroare server '+res.status+'. Verifică că CLAUDE_API_KEY e setat corect pe Render.');
  }
  const data=await res.json();
  if(!res.ok||data.error)throw new Error(data.error||'Eroare server '+res.status);
  return data;
}

async function shareResult(result,mode,title,urlInputId,shareBarId){
  try{
    const res=await fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({result,mode,title})});
    const data=await res.json();
    if(data.share_id){
      const url=`${window.location.origin}/share/${data.share_id}`;
      $(urlInputId).value=url;
      $(shareBarId).style.display='flex';
    }
  }catch(e){console.warn('Share failed:',e);}
}

function copyShare(inputId){
  $(inputId).select();document.execCommand('copy');
  const btn=document.querySelector(`button[onclick="copyShare('${inputId}')"]`);
  if(btn){const orig=btn.textContent;btn.textContent='✓ copiat!';setTimeout(()=>btn.textContent=orig,2000);}
}

function copyText(id){
  const el=$(id);
  const text=el.innerText||el.textContent||el.value;
  navigator.clipboard.writeText(text).then(()=>{
    const btn=el.nextElementSibling;
    if(btn){const orig=btn.textContent;btn.textContent='✓ copiat!';setTimeout(()=>btn.textContent=orig,2000);}
  });
}

window.addEventListener('DOMContentLoaded',()=>{
  const path=window.location.pathname;
  const match=path.match(/\/share\/([a-f0-9\-]+)/i);
  if(match){
    fetch(`/api/share/${match[1]}`).then(r=>r.json()).then(data=>{
      if(data.result){
        if(data.mode==='analiza'){setMode('analiza');renderAnalyze(data.result);show('res-analiza');$('grid-analiza').style.gridTemplateColumns='360px 1fr';}
        else if(data.mode==='jobmatch'){setMode('jobmatch');renderJobMatch(data.result);show('res-jm');$('grid-jm').style.gridTemplateColumns='360px 1fr';}
      }
    });
  }
  addJobField();
});

// ── Analyze ────────────────────────────────────────────
async function doAnalyze(){
  let text=$('cv-text').value.trim()||cvTextMain;
  if(!text){showErr('err-a','Adaugă un CV mai întâi.');return;}
  if(blindMode){
    text=text
      .replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi,'[EMAIL]')
      .replace(/(\+?\d[\d\s\-().]{8,}\d)/g,'[TELEFON]')
      .replace(/\b(Nume|Name|Prenume|Adresa|Address|LinkedIn|GitHub|Gen|Gender|Sex|Varsta|Age)\s*:?\s*[^\n]+/gi,'[REDACTAT]');
  }
  $('btn-a').disabled=true;$('btn-a').textContent='[ analizează... ]';
  hide('err-a');show('ld-a');hide('res-analiza');$('scoreBadge').style.display='none';
  try{
    const r=await api('/api/analyze',{cv_text:text});
    lastResult=r;lastMode='analiza';
    renderAnalyze(r);show('res-analiza');
    if(window.innerWidth>800)$('grid-analiza').style.gridTemplateColumns='360px 1fr';
    show('export-btns');show('btn-a-reset');
    shareResult(r,'analiza',r.nume||'Analiză CV','share-url-a','share-a');
  }catch(e){showErr('err-a',e.message);}
  finally{hide('ld-a');$('btn-a').disabled=false;$('btn-a').textContent='[ analizează cv ]';}
}

function renderAnalyze(r){
  const col=scoreColor(r.scorGeneral);
  $('badgeNum').textContent=r.scorGeneral;$('badgeNum').style.color=col;
  $('badgeLbl').textContent=scoreLabel(r.scorGeneral);$('badgeLbl').style.color=col;
  $('scoreBadge').style.display='flex';
  [$('sc1'),$('sc2')].forEach(el=>{if(el){el.style.borderColor=col;el.style.background=col+'18';}});
  [$('sc1n'),$('sc2n')].forEach(el=>{if(el){el.textContent=r.scorGeneral;el.style.color=col;}});
  $('sc-name').textContent=r.nume||'-';
  $('sc-title').textContent=r.titlu||'';
  $('sc-contact').innerHTML=[r.email,r.telefon,r.locatie].filter(Boolean).map(x=>`<span style="margin-right:10px">${x}</span>`).join('');
  $('sc-summary').textContent=r.rezumat||'';
  $('sc-skills').innerHTML=(r.skills||[]).map(s=>`<span class="tag tg">${s}</span>`).join('');
  $('sc-limbi').innerHTML=(r.limbi||[]).map(l=>`<span class="tag tp">🌐 ${l}</span>`).join('');
  $('sc-forte').innerHTML=(r.puncteFoarte||[]).map(p=>`<li><span style="color:var(--accent)">✓</span> ${p}</li>`).join('');
  $('sc-slabe').innerHTML=(r.puncteSlabe||[]).map(p=>`<li><span style="color:var(--red)">›</span> ${p}</li>`).join('');
  $('sc-overall').textContent=`Scor General — ${scoreLabel(r.scorGeneral)}`;$('sc-overall').style.color=col;
  const cats=[{k:'skills',l:'Skills',i:'⚡',c:'var(--accent)'},{k:'experienta',l:'Experiență',i:'💼',c:'var(--blue)'},
    {k:'educatie',l:'Educație',i:'🎓',c:'var(--purple)'},{k:'prezentare',l:'Prezentare',i:'✍️',c:'var(--yellow)'}];
  $('sc-cats').innerHTML=cats.map(cat=>{
    const s=r.scoruri?.[cat.k];if(!s)return'';
    return`<div class="card" style="border-left:3px solid ${cat.c}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:7px"><span style="font-size:16px">${cat.i}</span>
          <span style="font-size:12px;font-weight:700;color:var(--text)">${cat.l}</span></div>
        <span style="font-size:20px;font-weight:900;color:${cat.c}">${s.nota}</span>
      </div>
      <div class="bar-bg"><div class="bar-fill" style="width:${s.nota}%;background:${cat.c}"></div></div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px;line-height:1.5">${s.comentariu}</div>
    </div>`;}).join('');
  $('sc-exp').innerHTML=(r.experienta||[]).map(e=>`<div class="exp-item">
    <div class="exp-role">${e.rol||''}</div>
    <div class="exp-co">${e.companie||''}${e.perioada?`<span class="exp-per">— ${e.perioada}</span>`:''}</div>
    ${e.descriere?`<div class="exp-desc">${e.descriere}</div>`:''}
  </div>`).join('');
  $('sc-edu').textContent=r.educatie||'-';
  $('sc-rec').textContent=`"${r.recomandare||''}"`;

  // Red Flags
  const flags=r.redFlags||[];
  const ret=r.riscRetentie||{};
  if(flags.length===0){
    $('rf-clean').style.display='block';
    $('rf-list').innerHTML='';
    $('tab-btn-flags').style.color='var(--green)';
    $('tab-btn-flags').textContent='✅ Red Flags';
  } else {
    $('rf-clean').style.display='none';
    $('tab-btn-flags').style.color='var(--red)';
    $('tab-btn-flags').textContent=`🚩 Red Flags (${flags.length})`;
    $('rf-list').innerHTML=flags.map(f=>`
      <div style="display:flex;gap:10px;align-items:flex-start;padding:11px 14px;background:rgba(220,38,38,.05);border:1.5px solid rgba(220,38,38,.2);border-radius:9px;margin-bottom:7px">
        <span style="color:var(--red);font-size:16px;flex-shrink:0">🚩</span>
        <span style="font-size:12px;color:var(--text);line-height:1.6">${f}</span>
      </div>`).join('');
  }
  if(ret.nivel){
    $('rf-retention').style.display='block';
    const rc=ret.nivel==='Ridicat'?'var(--red)':ret.nivel==='Mediu'?'var(--yellow)':'var(--green)';
    $('rf-ret-badge').textContent=ret.nivel;
    $('rf-ret-badge').style.cssText=`background:${rc}18;border:1px solid ${rc}50;color:${rc};padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700`;
    $('rf-ret-scor').textContent=(ret.scor||0)+'/100';
    $('rf-ret-scor').style.color=rc;
    $('rf-ret-bar').style.width=(ret.scor||0)+'%';
    $('rf-ret-bar').style.background=rc;
    $('rf-ret-motive').innerHTML=(ret.motive||[]).map(m=>`<li><span style="color:var(--yellow)">›</span> ${m}</li>`).join('');
    $('rf-ret-rec').textContent=ret.recomandare||'';
  }

  renderInsights(r);
  renderManager(r);
  const res=$('res-analiza');
  res.querySelectorAll('.rtab').forEach((t,i)=>t.classList.toggle('active',i===0));
  res.querySelectorAll('.rpanel').forEach((p,i)=>p.classList.toggle('active',i===0));
}

function resetA(){
  cvTextMain='';$('cv-text').value='';
  $('dz-a-icon').textContent='📁';$('dz-a-lbl').textContent='drag & drop sau click';
  hide('res-analiza');hide('export-btns');hide('btn-a-reset');hide('err-a');hide('share-a');
  $('grid-analiza').style.gridTemplateColumns='';$('scoreBadge').style.display='none';lastResult=null;
}

// ── Job Match ──────────────────────────────────────────
function clearJmCv(){jmCvText='';$('jm-cv-t').value='';hide('jm-loaded');show('jm-input');}

async function doJobMatch(){
  const cv=$('jm-cv-t').value.trim()||jmCvText;
  const job=$('jm-job-t').value.trim();
  if(!cv||!job){showErr('err-jm','Adaugă CV-ul și descrierea jobului.');return;}
  $('btn-jm').disabled=true;$('btn-jm').textContent='[ se analizează... ]';
  hide('err-jm');show('ld-jm');hide('res-jm');
  try{
    const r=await api('/api/jobmatch',{cv_text:cv,job_text:job});
    renderJobMatch(r);show('res-jm');
    if(window.innerWidth>800)$('grid-jm').style.gridTemplateColumns='360px 1fr';
    shareResult(r,'jobmatch','Job Match','share-url-jm','share-jm');
  }catch(e){showErr('err-jm',e.message);}
  finally{hide('ld-jm');$('btn-jm').disabled=false;$('btn-jm').textContent='[ calculează job match ]';}
}

function renderJobMatch(r){
  const col=scoreColor(r.scor);
  $('jm-big').style.borderColor=col;
  $('jm-num').textContent=r.scor;$('jm-num').style.color=col;
  $('jm-verd').textContent=r.verdict||'';
  $('jm-summ').textContent=r.rezumat||'';
  const dec=r.decizie||'';
  const dc=dec==='Recomandat'?'var(--accent)':dec.includes('Nu')?'var(--red)':'var(--yellow)';
  $('jm-dec').textContent=(dec==='Recomandat'?'✓ ':dec.includes('Nu')?'✗ ':'⚡ ')+dec;
  $('jm-dec').style.cssText=`background:${dc}18;border:1px solid ${dc}50;color:${dc}`;
  $('jm-match').innerHTML=(r.skillsMatch||[]).map(s=>`<div style="margin-bottom:4px"><span class="tag tg">${s}</span></div>`).join('');
  $('jm-lipsa').innerHTML=(r.skillsLipsa||[]).map(s=>`<div style="margin-bottom:4px"><span class="tag tr">${s}</span></div>`).join('');
  $('jm-forte').innerHTML=(r.puncteFoarte||[]).map(p=>`<li><span style="color:var(--blue)">›</span> ${p}</li>`).join('');
  $('jm-risc').innerHTML=(r.riscuri||[]).map(p=>`<li><span style="color:var(--yellow)">›</span> ${p}</li>`).join('');
  $('jm-sfat').innerHTML=(r.sfaturi||[]).map((s,i)=>`<li><span style="color:var(--blue)">${i+1}.</span> ${s}</li>`).join('');
}

// ── Compare ────────────────────────────────────────────
async function doCompare(){
  if(cmpFiles.length<2){showErr('err-cmp','Adaugă minim 2 CV-uri.');return;}
  const reqUsed=Math.ceil(cmpFiles.length/10);
  $('btn-cmp').disabled=true;$('btn-cmp').textContent='[ se compară... ]';
  hide('err-cmp');show('ld-cmp');hide('res-cmp');
  try{
    const r=await api('/api/compare',{cvs:cmpFiles});
    sessionCmpRequests+=reqUsed;
    if($('req-session-used')) $('req-session-used').textContent=sessionCmpRequests;
    renderCompare(r);show('res-cmp');
    if(window.innerWidth>800)$('grid-cmp').style.gridTemplateColumns='360px 1fr';
  }catch(e){showErr('err-cmp',e.message);}
  finally{hide('ld-cmp');$('btn-cmp').disabled=false;$('btn-cmp').textContent=`[ compară ${cmpFiles.length} cv-uri ]`;}
}

function renderCompare(r){
  window._lastCmpResult=r;
  $('cmp-win-name').textContent=r.castigator||'-';
  $('cmp-win-mot').textContent=(r.motivCastigator||'')+' '+(r.comparatie||'');
  // Shortlist top 3
  const top3=(r.candidati||[]).slice(0,3);
  if(top3.length){
    const medals=['🥇','🥈','🥉'];
    const scols=['var(--accent)','var(--blue)','var(--purple)'];
    $('cmp-shortlist-cards').innerHTML=top3.map((c,i)=>`
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border-radius:8px;border:1px solid rgba(5,150,105,.2)">
        <span style="font-size:18px">${medals[i]}</span>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--text)">${c.nume||''}</div>
          <div style="font-size:10px;color:${scols[i]}">${c.titlu||''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:900;color:${scols[i]};line-height:1">${c.scor}</div>
          <div style="font-size:8px;color:var(--muted2)">/ 100</div>
        </div>
      </div>`).join('');
    $('cmp-shortlist').style.display='block';
  }
  const medals=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
  const palette=['var(--accent)','var(--blue)','var(--purple)','var(--yellow)','var(--green)'];
  const col=i=>palette[i]||'var(--muted)';
  const candidati=r.candidati||[];
  $('cmp-cards').innerHTML=candidati.slice(0,5).map((c,i)=>`
    <div class="cand-card" style="border-left:4px solid ${col(i)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:${i<3?'20':'14'}px;font-weight:700;color:${col(i)}">${medals(i)}</span>
          <div><div style="font-size:13px;font-weight:700;color:var(--text)">${c.nume||''}</div>
          <div style="font-size:10px;margin-top:2px;color:${col(i)}">${c.titlu||''}</div></div>
        </div>
        <div style="text-align:right"><div style="font-size:24px;font-weight:900;color:${col(i)};line-height:1">${c.scor}</div>
        <div style="font-size:9px;color:var(--muted)">/100</div></div>
      </div>
      <div class="bar-bg"><div class="bar-fill" style="width:${c.scor}%;background:${col(i)}"></div></div>
      <div class="tags" style="margin-top:8px">${(c.topSkills||[]).map(s=>`<span class="tag" style="background:${col(i)}15;border:1px solid ${col(i)}30;color:${col(i)};font-size:10px">${s}</span>`).join('')}</div>
      <div style="font-size:10px;color:var(--muted);font-style:italic;margin-top:6px">"${c.recomandare||''}"</div>
    </div>`).join('');

  window._lastCmpResult=r;
}

function showAllCmp(r){
  const candidati=r.candidati||[];
  const medals=i=>i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
  const palette=['var(--accent)','var(--blue)','var(--purple)','var(--yellow)','var(--green)'];
  const col=i=>palette[i]||'var(--muted)';
  $('cmp-cards').innerHTML=candidati.map((c,i)=>`
    <div class="cand-card" style="border-left:4px solid ${col(i)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:${i<3?'20':'14'}px;font-weight:700;color:${col(i)}">${medals(i)}</span>
          <div><div style="font-size:13px;font-weight:700;color:var(--text)">${c.nume||''}</div>
          <div style="font-size:10px;margin-top:2px;color:${col(i)}">${c.titlu||''}</div></div>
        </div>
        <div style="text-align:right"><div style="font-size:24px;font-weight:900;color:${col(i)};line-height:1">${c.scor}</div>
        <div style="font-size:9px;color:var(--muted)">/100</div></div>
      </div>
      <div class="bar-bg"><div class="bar-fill" style="width:${c.scor}%;background:${col(i)}"></div></div>
      <div class="tags" style="margin-top:8px">${(c.topSkills||[]).map(s=>`<span class="tag" style="background:${col(i)}15;border:1px solid ${col(i)}30;color:${col(i)};font-size:10px">${s}</span>`).join('')}</div>
      <div style="font-size:10px;color:var(--muted);font-style:italic;margin-top:6px">"${c.recomandare||''}"</div>
    </div>`).join('');
}

// ── Compare exports ───────────────────────────────────
function exportCmpExcel(){
  if(!window._lastCmpResult) return;
  const r=window._lastCmpResult;
  const XLSX=window.XLSX;
  if(!XLSX){ const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=exportCmpExcel;document.head.appendChild(s);return; }
  const wb=XLSX.utils.book_new();
  // Sheet 1: Shortlist
  const shortlist=(r.candidati||[]).slice(0,5).map((c,i)=>({
    'Loc': i===0?'#1 Aur':i===1?'#2 Argint':i===2?'#3 Bronz':i===3?'#4':'#5',
    'Nume': c.nume||'', 'Titlu': c.titlu||'',
    'Scor': c.scor||0, 'Recomandare': c.recomandare||'',
    'Status': 'Recomandat interviu'
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shortlist), 'Shortlist Top 5');
  // Sheet 2: Ranking complet
  const ranking=(r.candidati||[]).map((c,i)=>({
    'Loc': `#${i+1}`, 'Nume': c.nume||'', 'Titlu': c.titlu||'',
    'Scor': c.scor||0, 'Skills': (c.topSkills||[]).join(', '),
    'Puncte forte': (c.puncteFoarte||[]).join(' | '),
    'Recomandare': c.recomandare||''
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ranking), 'Ranking Complet');
  XLSX.writeFile(wb, `Shortlist_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function exportCmpPDF(){
  if(!window._lastCmpResult) return;
  if(!window.jspdf){ const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=exportCmpPDF;document.head.appendChild(s);return; }
  const r=window._lastCmpResult;
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,ML=18,TW=W-ML*2;let y=20;
  const fix=str=>String(str||'').replace(/[ăĂ]/g,'a').replace(/[âÂ]/g,'a').replace(/[îÎ]/g,'i').replace(/[șşȘŞ]/g,'s').replace(/[țţȚŢ]/g,'t').replace(/[^\x00-\x7f]/g,'?');
  const chk=n=>{if(y+n>275){doc.addPage();y=20;}};

  // Header
  doc.setFillColor(15,23,42);doc.rect(0,0,W,38,'F');
  doc.setFillColor(5,150,105);doc.rect(0,0,5,38,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(18);doc.setFont('helvetica','bold');
  doc.text('SHORTLIST CANDIDATI',ML+4,15);
  doc.setFontSize(9);doc.setTextColor(167,243,208);doc.setFont('helvetica','normal');
  doc.text('Top 3 recomandati pentru interviu — CV.Scanner',ML+4,23);
  doc.setFontSize(7);doc.setTextColor(100,116,139);
  doc.text('Generat: '+new Date().toLocaleDateString('ro-RO'),ML+4,33);
  y=48;

  // Winner highlight
  const w=(r.candidati||[])[0];
  if(w){
    doc.setFillColor(240,253,244);doc.rect(ML,y-4,TW,22,'F');
    doc.setFillColor(5,150,105);doc.rect(ML,y-4,4,22,'F');
    doc.setFontSize(8);doc.setTextColor(5,150,105);doc.setFont('helvetica','bold');
    doc.text('CASTIGATOR',ML+8,y+2);
    doc.setFontSize(13);doc.setTextColor(15,23,42);
    doc.text(fix(w.nume||''),ML+8,y+9);
    doc.setFontSize(8);doc.setTextColor(5,150,105);doc.setFont('helvetica','normal');
    doc.text(fix(w.titlu||''),ML+8,y+15);
    doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(5,150,105);
    doc.text(String(w.scor||0),W-ML-8,y+10,{align:'right'});
    doc.setFontSize(7);doc.setTextColor(100,116,139);
    doc.text('/100',W-ML-8,y+15,{align:'right'});
    y+=30;
  }

  // Top 3
  const medals=['#1','#2','#3'];
  const mcolors=[[5,150,105],[37,99,235],[124,58,237]];
  (r.candidati||[]).slice(0,3).forEach((c,i)=>{
    chk(35);
    doc.setFillColor(248,250,252);doc.rect(ML,y-3,TW,32,'F');
    doc.setFillColor(...mcolors[i]);doc.rect(ML,y-3,3,32,'F');
    doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...mcolors[i]);
    doc.text(medals[i],ML+7,y+4);
    doc.setTextColor(15,23,42);doc.setFontSize(11);
    doc.text(fix(c.nume||''),ML+18,y+4);
    doc.setFontSize(8);doc.setTextColor(100,116,139);doc.setFont('helvetica','normal');
    doc.text(fix(c.titlu||''),ML+18,y+10);
    doc.setFontSize(8);doc.setTextColor(...mcolors[i]);doc.setFont('helvetica','bold');
    doc.text('Scor: '+String(c.scor||0),W-ML-5,y+4,{align:'right'});
    doc.setFontSize(7.5);doc.setTextColor(60,60,80);doc.setFont('helvetica','normal');
    const rec=doc.splitTextToSize(fix(c.recomandare||''),TW-25);
    doc.text(rec.slice(0,2),ML+18,y+17);
    if((c.topSkills||[]).length){
      doc.setFontSize(7);doc.setTextColor(...mcolors[i]);
      doc.text('Skills: '+fix((c.topSkills||[]).join(', ')),ML+18,y+26);
    }
    y+=37;
  });

  // Full ranking table
  chk(20);y+=5;
  doc.setFillColor(240,245,250);doc.rect(ML,y-4,TW,10,'F');
  doc.setFillColor(37,99,235);doc.rect(ML,y-4,3,10,'F');
  doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(30,30,50);
  doc.text('RANKING COMPLET',ML+7,y+2);y+=12;
  (r.candidati||[]).forEach((c,i)=>{
    chk(8);
    doc.setFontSize(8);doc.setFont('helvetica',i<3?'bold':'normal');
    doc.setTextColor(i<3?15:80,i<3?23:80,i<3?42:80);
    doc.text(`${i+1}. ${fix(c.nume||'')}`,ML+2,y);
    doc.setTextColor(37,99,235);
    doc.text(String(c.scor||0),W-ML-5,y,{align:'right'});
    doc.setTextColor(150,150,150);doc.setFontSize(7);doc.setFont('helvetica','normal');
    doc.text(fix(c.titlu||''),ML+35,y);
    y+=7;
  });

  // Footer
  const pages=doc.internal.getNumberOfPages();
  for(let p=1;p<=pages;p++){
    doc.setPage(p);doc.setFillColor(248,250,252);doc.rect(0,285,W,12,'F');
    doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(148,163,184);
    doc.text('CV.Scanner — Shortlist Recrutare',ML,291);
    doc.text(`Pagina ${p}/${pages}`,W-ML,291,{align:'right'});
  }
  doc.save(`Shortlist_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ── Matching Auto ──────────────────────────────────────
async function doMatching(){
  const validJobs=matJobs.filter(j=>j.title.trim()||j.text.trim());
  if(matCvFiles.length<1||validJobs.length<1){showErr('err-mat','Adaugă minim 1 CV și 1 job.');return;}
  $('btn-mat').disabled=true;$('btn-mat').textContent='[ se calculează... ]';
  hide('err-mat');show('ld-mat');hide('res-mat');
  try{
    const r=await api('/api/matching',{cvs:matCvFiles,jobs:validJobs});
    renderMatching(r,validJobs);show('res-mat');
    if(window.innerWidth>800)$('grid-mat').style.gridTemplateColumns='360px 1fr';
  }catch(e){showErr('err-mat',e.message);}
  finally{hide('ld-mat');$('btn-mat').disabled=false;updateMatBtn();}
}

function renderMatching(r,jobs){
  $('mat-rez').textContent=r.rezumat||'-';
  const colors=['var(--accent)','var(--blue)','var(--purple)','var(--yellow)','var(--muted)'];
  $('mat-best').innerHTML=(r.bestMatchuri||[]).map((b,i)=>`
    <div class="card" style="border-left:3px solid ${colors[i]};margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:11px;font-weight:700;color:var(--text)">🎯 ${b.jobTitlu||''}</div>
        <span class="score-chip" style="background:${colors[i]}18;color:${colors[i]};border:1px solid ${colors[i]}40">${b.scor}/100</span>
      </div>
      <div style="font-size:11px;color:${colors[i]};font-weight:700">👤 ${b.candidatOptim||''}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;line-height:1.5">${b.motiv||''}</div>
    </div>`).join('');
  $('mat-rows').innerHTML=(r.matches||[]).map(m=>{
    const col=scoreColor(m.scor);
    return`<tr>
      <td style="color:var(--text);font-weight:600">${m.cvNume||''}</td>
      <td style="color:var(--blue)">${m.jobTitlu||''}</td>
      <td><span class="score-chip" style="background:${col}18;color:${col};border:1px solid ${col}40">${m.scor}</span></td>
      <td style="color:var(--muted)">${m.verdict||''}</td>
      <td style="color:var(--muted);font-size:10px">${m.recomandare||''}</td>
    </tr>`;}).join('');
}

// ── Blind Recruitment ─────────────────────────────────
function toggleBlind(on){
  blindMode=on;
  const track=$('blind-track'),thumb=$('blind-thumb');
  if(on){track.style.background='var(--purple)';thumb.style.left='20px';}
  else{track.style.background='#cbd5e1';thumb.style.left='2px';}
}

// ── Render Insights ────────────────────────────────────
function renderInsights(r){
  const h=r.scorHype||{};
  const hS=h.scor||0;
  const hC=hS>=70?'var(--green)':hS>=40?'var(--yellow)':'var(--red)';
  $('hype-scor').textContent=hS+'/100'; $('hype-scor').style.color=hC;
  $('hype-bar').style.width=hS+'%'; $('hype-bar').style.background=hC;
  $('hype-verdict').textContent=h.verdict||'';
  $('hype-buzz').innerHTML=(h.buzzwords||[]).map(b=>`<span style="display:inline-block;padding:2px 7px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:12px;font-size:10px;color:var(--red);margin:2px">${b}</span>`).join('');
  $('hype-real').innerHTML=(h.realizariConcrete||[]).map(b=>`<span style="display:inline-block;padding:2px 7px;background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.2);border-radius:12px;font-size:10px;color:var(--green);margin:2px">${b}</span>`).join('');
  const ats=r.simulareATS||{};
  $('ats-scores').innerHTML=[['workday','Workday','var(--blue)'],['greenhouse','Greenhouse','var(--green)'],['bamboohr','BambooHR','var(--yellow)']].map(([k,name,col])=>{
    const s=ats[k]||{};
    return `<div style="flex:1;text-align:center;padding:10px 6px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)"><div style="font-size:18px;font-weight:900;color:${col}">${s.scor||0}</div><div style="font-size:8px;color:var(--muted);margin-top:2px">${name}</div>${(s.probleme||[]).slice(0,1).map(p=>`<div style="font-size:8px;color:var(--red);margin-top:3px;line-height:1.3">${p}</div>`).join('')}</div>`;
  }).join('');
  $('ats-recs').innerHTML=(ats.recomandari||[]).map(r=>`<div style="margin-bottom:4px"><span style="color:var(--blue)">› </span>${r}</div>`).join('');
  const pred=r.predictieSchimbare||{};
  $('pred-luni').textContent=pred.luni||'-';
  $('pred-interval').textContent=pred.interval||'';
  $('pred-incredere').textContent=pred.incredere||'';
  $('pred-rationale').textContent=pred.rationale||'';
  $('pred-semne').innerHTML=(pred.semne||[]).map(s=>`<li><span style="color:var(--purple)">› </span>${s}</li>`).join('');
  const cb=r.costBeneficiu||{};
  const sal=cb.salariuEstimat||{};
  $('cb-salariu').textContent=sal.minim&&sal.maxim?`${sal.minim}-${sal.maxim} ${sal.moneda||'EUR'}`:'N/A';
  $('cb-roi').textContent=(cb.scoreROI||0)+'/100';
  $('cb-roi').style.color=(cb.scoreROI||0)>=70?'var(--green)':(cb.scoreROI||0)>=50?'var(--yellow)':'var(--red)';
  $('cb-onboard').textContent=cb.timpOnboarding||'-';
  $('cb-prod').textContent=cb.timpProductivitate||'-';
  $('cb-sumar').textContent=cb.sumar||'';
}

function renderManager(r){
  $('mgr-bullets').innerHTML=(r.rezumatManager||[]).map((b,i)=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:rgba(37,99,235,.05);border:1px solid rgba(37,99,235,.15);border-radius:8px;margin-bottom:6px"><span style="font-size:16px;flex-shrink:0">${['1️⃣','2️⃣','3️⃣'][i]||'•'}</span><span style="font-size:12px;color:var(--text);line-height:1.6">${b}</span></div>`).join('');
}

function copyManagerSummary(){
  if(!lastResult) return;
  const t=(lastResult.rezumatManager||[]).map((b,i)=>(i+1)+'. '+b).join('\n');

  navigator.clipboard.writeText(`Candidat: ${lastResult.nume||''}

`+t).then(()=>{event.target.textContent='✅ Copiat!';setTimeout(()=>event.target.textContent='📋 Copiază',2000);});
}

function emailManagerSummary(){
  if(!lastResult) return;
  const r=lastResult;
  const sub='Candidat: '+(r.nume||'')+' — '+(r.titlu||'');
  const bullets=(r.rezumatManager||[]).map((b,i)=>(i+1)+'. '+b).join('\n');
  const bod='Buna ziua,\n\nCandidatura spre evaluare:\n\nNume: '+(r.nume||'-')+'\nScor: '+r.scorGeneral+'/100\nSeniority: '+(r.seniority||'-')+'\n\n'+bullets+'\n\nRisc retentie: '+((r.riscRetentie||{}).nivel||'-')+'\n\nCu stima,\nEchipa HR';
  window.location.href='mailto:?subject='+encodeURIComponent(sub)+'&body='+encodeURIComponent(bod);
}
async function generateRejection(){
  if(!lastResult){alert('Analizează un CV mai întâi.');return;}
  const btn=$('btn-rejection');
  btn.disabled=true;btn.textContent='[ se generează... ]';
  hide('rej-result');
  try{
    const r=await api('/api/rejection',{cv_text:$('cv-text').value.trim()||cvTextMain,name:lastResult.nume||'candidat',job_text:$('rej-job').value.trim()});
    lastRejection=r;
    $('rej-subject').textContent=r.subiect||'';
    $('rej-body').textContent=r.scrisoare||'';
    show('rej-result');
  }catch(e){alert('Eroare: '+e.message);}
  finally{btn.disabled=false;btn.textContent='[ generează scrisoare respingere ]';}
}

function copyRejection(){
  if(!lastRejection) return;
  navigator.clipboard.writeText(lastRejection.scrisoare||'').then(()=>{event.target.textContent='✅ Copiat!';setTimeout(()=>event.target.textContent='📋 Copiază',2000);});
}

function emailRejection(){
  if(!lastRejection) return;
  window.location.href=`mailto:?subject=${encodeURIComponent(lastRejection.subiect||'')}&body=${encodeURIComponent(lastRejection.scrisoare||'')}`;
}

function detectDuplicates(files,texts){
  const dups=[];
  for(let i=0;i<texts.length;i++){
    for(let j=i+1;j<texts.length;j++){
      const a=texts[i].slice(0,300).toLowerCase().split(' ').filter(w=>w.length>4);
      const b=new Set(texts[j].slice(0,300).toLowerCase().split(' ').filter(w=>w.length>4));
      const common=a.filter(w=>b.has(w)).length;
      const sim=common/Math.max(a.length,b.size,1);
      if(sim>0.6) dups.push({i,j,sim:Math.round(sim*100),nameA:files[i].name,nameB:files[j].name});
    }
  }
  return dups;
}

// ── Share pe Email ────────────────────────────────────
function shareEmail(){
  if(!lastResult) return;
  const r=lastResult;
  const flags=(r.redFlags||[]);
  const ret=r.riscRetentie||{};
  const subject=`Raport CV — ${r.nume||'Candidat'} | Scor: ${r.scorGeneral}/100`;
  const body=`Buna ziua,

Va trimit raportul de analiza CV generat cu CV.Scanner AI.

━━━━━━━━━━━━━━━━━━━━━━━━
CANDIDAT: ${r.nume||'-'}
TITLU: ${r.titlu||'-'}
SCOR GENERAL: ${r.scorGeneral}/100
SENIORITY: ${r.seniority||'-'}
INDUSTRIE: ${r.industrie||'-'}
━━━━━━━━━━━━━━━━━━━━━━━━

REZUMAT:
${r.rezumat||'-'}

PUNCTE FORTE:
${(r.puncteFoarte||[]).map((p,i)=>`${i+1}. ${p}`).join('\n')}

DE IMBUNATATIT:
${(r.puncteSlabe||[]).map((p,i)=>`${i+1}. ${p}`).join('\n')}

SKILLS: ${(r.skills||[]).join(', ')}

${flags.length>0?`RED FLAGS DETECTATE (${flags.length}):\n${flags.map(f=>`⚠ ${f}`).join('\n')}\n`:'✅ Niciun red flag detectat\n'}
${ret.nivel?`RISC RETENTIE: ${ret.nivel} (${ret.scor}/100)\n${(ret.motive||[]).map(m=>`- ${m}`).join('\n')}\n`:''}
RECOMANDARE HR:
"${r.recomandare||'-'}"

━━━━━━━━━━━━━━━━━━━━━━━━
Generat cu CV.Scanner — Claude AI
${window.location.origin}`;

  const mailto=`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href=mailto;
}

// ── Export PDF ─────────────────────────────────────────
async function exportPDF(){
  if(!lastResult)return;
  if(!window.jspdf){
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=doExport;document.head.appendChild(s);
  }else doExport();
}
function doExport(){
  const r=lastResult;
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,ML=18,TW=W-ML*2;let y=20;
  const fix=str=>String(str||'').replace(/[ăĂ]/g,'a').replace(/[âÂ]/g,'a').replace(/[îÎ]/g,'i').replace(/[șşȘŞ]/g,'s').replace(/[țţȚŢ]/g,'t').replace(/[^\x00-\x7f]/g,'?');
  const chk=n=>{if(y+n>275){doc.addPage();y=20;}};
  const secH=t=>{chk(14);doc.setFillColor(240,245,250);doc.rect(ML,y-4,TW,10,'F');
    doc.setFillColor(37,99,235);doc.rect(ML,y-4,3,10,'F');
    doc.setTextColor(30,30,50);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text(fix(t).toUpperCase(),ML+7,y+2);y+=10;};
  doc.setFillColor(15,23,42);doc.rect(0,0,W,42,'F');
  doc.setFillColor(37,99,235);doc.rect(0,0,5,42,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(20);doc.setFont('helvetica','bold');
  doc.text(fix(r.nume)||'Candidat',ML+4,16);
  doc.setFontSize(10);doc.setTextColor(147,197,253);doc.setFont('helvetica','normal');
  doc.text(fix(r.titlu)||'',ML+4,24);
  const sc=r.scorGeneral||0;
  doc.setFillColor(37,99,235);doc.roundedRect(W-ML-22,8,22,16,2,2,'F');
  doc.setFontSize(14);doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');
  doc.text(String(sc),W-ML-11,19,{align:'center'});
  doc.setFontSize(6);doc.text('SCOR',W-ML-11,23,{align:'center'});
  doc.setFontSize(7);doc.setTextColor(100,116,139);doc.setFont('helvetica','normal');
  doc.text('CV.Scanner | '+new Date().toLocaleDateString('ro-RO'),ML+4,39);
  y=52;
  secH('Profil Profesional');y+=2;
  doc.setTextColor(60,60,80);doc.setFontSize(9);doc.setFont('helvetica','normal');
  const rezLines=doc.splitTextToSize(fix(r.rezumat||''),TW);doc.text(rezLines,ML,y);y+=rezLines.length*5+6;
  if(r.skills?.length){secH('Skills');y+=2;
    doc.setTextColor(60,60,80);doc.setFontSize(9);doc.setFont('helvetica','normal');
    const skLines=doc.splitTextToSize(fix((r.skills||[]).join(', ')),TW);doc.text(skLines,ML,y);y+=skLines.length*5+6;}
  if(r.experienta?.length){secH('Experienta');y+=2;
    r.experienta.forEach((e,i)=>{chk(18);
      doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(30,30,50);doc.text(fix(e.rol)||'',ML+2,y);y+=5;
      doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(37,99,235);
      doc.text([fix(e.companie),fix(e.perioada)].filter(Boolean).join('  •  '),ML+2,y);y+=5;
      if(e.descriere){doc.setTextColor(100,100,120);const l=doc.splitTextToSize(fix(e.descriere),TW-4);doc.text(l,ML+2,y);y+=l.length*4.5;}
      if(i<r.experienta.length-1){doc.setDrawColor(220,225,230);doc.line(ML,y+2,ML+TW,y+2);y+=6;}else{y+=4;}
    });}
  secH('Recomandare HR');y+=2;
  doc.setTextColor(60,60,80);doc.setFontSize(9);doc.setFont('helvetica','italic');
  const recLines=doc.splitTextToSize(fix(r.recomandare||''),TW);doc.text(recLines,ML,y);
  const total=doc.internal.getNumberOfPages();
  for(let p=1;p<=total;p++){doc.setPage(p);doc.setFillColor(248,250,252);doc.rect(0,285,W,12,'F');
    doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(148,163,184);
    doc.text('CV.Scanner — Claude AI',ML,291);doc.text(`Pagina ${p}/${total}`,W-ML,291,{align:'right'});}
  const blob=doc.output('blob'),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`Analiza_${fix(r.nume||'CV').replace(/\s+/g,'_')}.pdf`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}