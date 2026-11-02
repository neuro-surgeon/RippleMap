'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { analyzeWorkspace, findImpact, findDependencies } = require('./analyzer');
let panel;
let graph;

function activate(context) {
  const run = async () => runAnalysis(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('ripplemap.analyzeWorkspace', run),
    vscode.commands.registerCommand('ripplemap.refresh', run),
    vscode.commands.registerCommand('ripplemap.analyzeCurrentFile', () => showImpactForFile(vscode.window.activeTextEditor?.document.uri)),
    vscode.commands.registerCommand('ripplemap.analyzeFileImpact', resource => showImpactForFile(resource || vscode.window.activeTextEditor?.document.uri))
  );
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => {
    if (panel) panel.webview.postMessage({ type: 'stale' });
  }));
  context.subscriptions.push(vscode.workspace.onDidCreateFiles(() => { if (panel) panel.webview.postMessage({type:'stale'}); }));
  context.subscriptions.push(vscode.workspace.onDidDeleteFiles(() => { if (panel) panel.webview.postMessage({type:'stale'}); }));
}
async function runAnalysis(context) {
  try {
    const result = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'RippleMap: анализ зависимостей…',cancellable:false}, () => analyzeWorkspace(vscode));
    graph = result;
    if (!panel) {
      panel = vscode.window.createWebviewPanel('rippleMapGraph','RippleMap — Dependencies',vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
      panel.onDidDispose(()=>{panel=undefined;},null,context.subscriptions);
      panel.webview.onDidReceiveMessage(async message => {
        if (!graph || !message || typeof message !== 'object') return;
        if (message.type === 'refresh') return runAnalysis(context);
        if (typeof message.file !== 'string' || !graph.files.some(f=>f.key===message.file)) return;
        if (message.type === 'open') return openProjectFile(message.file);
        if (message.type === 'impact') panel?.webview.postMessage({type:'impactResult',file:message.file,files:findImpact(graph,message.file)});
      },undefined,context.subscriptions);
    } else panel.reveal(vscode.ViewColumn.Beside);
    panel.webview.html = renderHtml(result);
    vscode.window.showInformationMessage(`RippleMap: найдено ${result.files.length} файлов и ${result.edges.length} связей.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`RippleMap: ${message}`);
    console.error('[RippleMap]', error);
  }
}
async function openProjectFile(key) {
  const file = graph?.files.find(f=>f.key===key);
  if (!file) return;
  try { const doc=await vscode.workspace.openTextDocument(vscode.Uri.parse(file.uri)); await vscode.window.showTextDocument(doc,{preview:false}); }
  catch (error) { vscode.window.showWarningMessage(`Не удалось открыть ${key}: ${String(error)}`); }
}
async function showImpactForFile(uri) {
  if (!uri) { vscode.window.showWarningMessage('Сначала откройте файл исходного кода.'); return; }
  try {
    const result = await analyzeWorkspace(vscode);
    const selected = result.files.find(f=>path.normalize(vscode.Uri.parse(f.uri).fsPath)===path.normalize(uri.fsPath));
    if (!selected) { vscode.window.showWarningMessage('Файл не входит в список поддерживаемых файлов RippleMap.'); return; }
    const impact = findImpact(result,selected.key);
    const deps = findDependencies(result,selected.key);
    const options = [
      ...impact.map(key=>({label:`$(warning) ${key}`,description:'Потенциально зависит от выбранного файла',key})),
      ...deps.map(key=>({label:`$(references) ${key}`,description:'Прямая зависимость выбранного файла',key}))
    ];
    if (!options.length) { vscode.window.showInformationMessage(`RippleMap: для ${selected.key} не найдено локальных связей.`); return; }
    const choice=await vscode.window.showQuickPick(options,{title:`RippleMap — влияние: ${selected.key}`,placeHolder:'Выберите файл, чтобы открыть его'});
    if (choice) await openUriFromResult(result,choice.key);
  } catch(error) { vscode.window.showErrorMessage(`RippleMap: ${error instanceof Error?error.message:String(error)}`); }
}
async function openUriFromResult(result,key) {
  const file=result.files.find(f=>f.key===key); if(!file)return;
  const doc=await vscode.workspace.openTextDocument(vscode.Uri.parse(file.uri)); await vscode.window.showTextDocument(doc,{preview:false});
}
function renderHtml(data) {
  const nonce = Array.from({length:32},()=> 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*62)]).join('');
  const payload = JSON.stringify(data).replace(/</g,'\\u003c');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>RippleMap</title><style nonce="${nonce}">
*{box-sizing:border-box}body{padding:20px 24px;color:var(--vscode-foreground);font:13px var(--vscode-font-family);background:var(--vscode-editor-background)}h1{font-size:22px;margin:0 0 5px}.sub,.muted{color:var(--vscode-descriptionForeground)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}.toolbar input,.toolbar select{padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:5px}.toolbar input{min-width:220px;flex:1}.toolbar button,.action{padding:8px 11px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:5px;cursor:pointer}.stats{display:flex;gap:9px;flex-wrap:wrap;margin:13px 0}.stat,.panel{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:11px}.stat b{display:block;font-size:19px}.stat span{color:var(--vscode-descriptionForeground)}.tabs{display:flex;gap:8px;border-bottom:1px solid var(--vscode-panel-border);margin:16px 0 12px}.tab{padding:9px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--vscode-foreground);cursor:pointer}.tab.active{border-color:var(--vscode-focusBorder);font-weight:600}.view{display:none}.view.active{display:block}.columns{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(360px,1.6fr);gap:14px}.panel h2{font-size:15px;margin:0 0 10px}.scroll{max-height:60vh;overflow:auto}.file{display:flex;justify-content:space-between;gap:8px;width:100%;padding:7px;text-align:left;color:var(--vscode-foreground);background:transparent;border:0;border-bottom:1px solid var(--vscode-panel-border);cursor:pointer;overflow-wrap:anywhere}.file:hover,.file.selected{background:var(--vscode-list-hoverBackground)}.pill{font-size:10px;padding:2px 6px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:8px;white-space:nowrap}.graph-wrap{height:520px;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:7px}.graph-wrap svg{display:block}.node{cursor:pointer}.node rect{fill:var(--vscode-editorWidget-background);stroke:var(--vscode-panel-border);stroke-width:1.4}.node text{fill:var(--vscode-foreground);font-size:12px}.node.selected rect{stroke:var(--vscode-focusBorder);stroke-width:3}.node.impacted rect{stroke:var(--vscode-editorWarning-foreground);stroke-width:2}.edge{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:1.4}.details{margin-top:10px;padding:12px;border:1px solid var(--vscode-panel-border);border-radius:7px}.empty{padding:20px;text-align:center;color:var(--vscode-descriptionForeground)}.stale{display:none;color:var(--vscode-editorWarning-foreground)}.stale.show{display:inline}@media(max-width:850px){.columns{grid-template-columns:1fr}}
</style></head><body><h1>RippleMap</h1><div class="sub">Карта локальных зависимостей. Стрелка A → B означает, что файл A использует файл B.</div>
<div class="toolbar"><input id="filter" placeholder="Поиск файла…"><select id="language"><option value="all">Все языки</option>${Object.keys(data.languages).map(x=>`<option>${x}</option>`).join('')}</select><button id="refresh">Обновить анализ</button><span id="stale" class="stale">Данные изменились — обновите анализ</span></div>
<div class="stats"><div class="stat"><b>${data.files.length}</b><span>файлов</span></div><div class="stat"><b>${data.edges.length}</b><span>связей</span></div><div class="stat"><b>${data.unresolved.length}</b><span>неразрешённых локальных импортов</span></div><div class="stat"><b>${data.files.length?Math.round(data.edges.length/data.files.length*100)/100:0}</b><span>связей на файл</span></div></div>
<div class="stats">${Object.entries(data.languages).map(([k,v])=>`<div class="stat"><b>${v}</b><span>${escapeHtml(k)}</span></div>`).join('')}</div>
<div class="tabs"><button class="tab active" data-tab="map">Карта зависимостей</button><button class="tab" data-tab="files">Файлы</button><button class="tab" data-tab="unresolved">Неразрешённые (${data.unresolved.length})</button></div>
<section id="map" class="view active"><div class="columns"><div class="panel"><h2>Файлы проекта</h2><div id="fileList" class="scroll"></div></div><div class="panel"><h2>Граф зависимостей</h2><p class="muted">Выберите узел для просмотра зависимостей и анализа влияния.</p><div class="graph-wrap"><svg id="graphSvg" role="img" aria-label="Граф зависимостей"></svg></div><div id="details" class="details">Выберите файл в списке или на графе.</div></div></div></section>
<section id="files" class="view"><div class="panel"><h2>Все файлы</h2><div id="allFiles" class="scroll"></div></div></section><section id="unresolved" class="view"><div class="panel"><h2>Неразрешённые локальные импорты</h2><div id="unresolvedList"></div></div></section>
<script nonce="${nonce}">
const graph=${payload};const vscodeApi=acquireVsCodeApi();let selected=null,impacted=[];const el=id=>document.getElementById(id);const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function language(file){const f=String(file||'').toLowerCase();if(f.endsWith('.py')||f.endsWith('.pyw'))return 'Python';if(['.ts','.tsx','.mts','.cts'].some(x=>f.endsWith(x)))return 'TypeScript';if(['.js','.jsx','.mjs','.cjs'].some(x=>f.endsWith(x)))return 'JavaScript';if(['.cpp','.cc','.cxx','.c','.h','.hh','.hpp','.hxx','.ipp','.tpp'].some(x=>f.endsWith(x)))return 'C++';return 'Other'}
function visible(){const q=el('filter').value.toLowerCase(),l=el('language').value;return graph.files.filter(f=>(!q||f.key.toLowerCase().includes(q))&&(l==='all'||f.language===l))}
function drawFiles(){const files=visible();for(const id of ['fileList','allFiles']){const box=el(id);box.replaceChildren();for(const f of files){const b=document.createElement('button');b.className='file'+(selected===f.key?' selected':'');const name=document.createElement('span');name.textContent=f.key;const badge=document.createElement('span');badge.className='pill';badge.textContent=f.language;b.append(name,badge);b.addEventListener('click',()=>selectFile(f.key));box.append(b)}if(!files.length){const p=document.createElement('div');p.className='empty';p.textContent='Файлы не найдены';box.append(p)}}}
function drawGraph(){const svg=el('graphSvg');svg.replaceChildren();const nodes=graph.files;const cols=Math.max(1,Math.floor(Math.max(700,Math.ceil(Math.sqrt(nodes.length||1))*220)/220));const width=Math.max(700,cols*220),rows=Math.ceil(nodes.length/cols),height=Math.max(300,rows*100);svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox','0 0 '+width+' '+height);const ns='http://www.w3.org/2000/svg',pos=new Map();nodes.forEach((f,i)=>pos.set(f.key,{x:20+(i%cols)*220,y:20+Math.floor(i/cols)*100}));const make=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n};for(const edge of graph.edges){const a=pos.get(edge.from),b=pos.get(edge.to);if(!a||!b)continue;svg.append(make('path',{d:'M '+(a.x+180)+' '+(a.y+27)+' C '+(a.x+200)+' '+(a.y+27)+','+(b.x-20)+' '+(b.y+27)+','+b.x+' '+(b.y+27),class:'edge'}))}for(const f of nodes){const p=pos.get(f.key),g=make('g',{class:'node'+(selected===f.key?' selected':'')+(impacted.includes(f.key)?' impacted':'')});g.append(make('rect',{x:p.x,y:p.y,width:180,height:55,rx:7}));const t=make('text',{x:p.x+9,y:p.y+22});t.textContent=f.key.length>25?'…'+f.key.slice(-23):f.key;g.append(t);const sub=make('text',{x:p.x+9,y:p.y+42,opacity:.7});sub.textContent=f.language;g.append(sub);g.addEventListener('click',()=>selectFile(f.key));svg.append(g)}if(!nodes.length){const t=make('text',{x:20,y:35});t.textContent='Поддерживаемые файлы не найдены.';svg.append(t)}}
function selectFile(key){selected=key;impacted=[];drawFiles();drawGraph();const deps=graph.edges.filter(e=>e.from===key),users=graph.edges.filter(e=>e.to===key);el('details').replaceChildren();const h=document.createElement('h3');h.textContent=key;const p=document.createElement('p');p.className='muted';p.textContent='Прямые зависимости: '+deps.length+' · Импортируют этот файл: '+users.length;const impact=document.createElement('button');impact.className='action';impact.textContent='Показать потенциальное влияние';impact.addEventListener('click',()=>vscodeApi.postMessage({type:'impact',file:key}));const open=document.createElement('button');open.className='action';open.textContent='Открыть файл';open.addEventListener('click',()=>vscodeApi.postMessage({type:'open',file:key}));el('details').append(h,p,impact,open)}
function drawUnresolved(){const box=el('unresolvedList');box.replaceChildren();if(!graph.unresolved.length){const p=document.createElement('div');p.className='empty';p.textContent='Неразрешённых локальных импортов не обнаружено.';box.append(p);return}for(const item of graph.unresolved){const p=document.createElement('p');p.textContent=item.from+' → '+item.specifier+' ('+item.language+')';box.append(p)}}
function showImpact(key,files){if(selected!==key)return;impacted=files;drawGraph();const box=el('details'),h=document.createElement('h3');h.textContent='Потенциально затронутые файлы ('+files.length+')';box.append(h);if(!files.length){const p=document.createElement('p');p.textContent='Другие файлы не зависят от выбранного файла.';box.append(p)}for(const file of files){const b=document.createElement('button');b.className='file';b.textContent=file;b.addEventListener('click',()=>vscodeApi.postMessage({type:'open',file}));box.append(b)}}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===t.dataset.tab))}));el('filter').addEventListener('input',drawFiles);el('language').addEventListener('change',drawFiles);el('refresh').addEventListener('click',()=>vscodeApi.postMessage({type:'refresh'}));drawFiles();drawGraph();drawUnresolved();window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='impactResult')showImpact(m.file,m.files||[]);if(m.type==='stale')el('stale').classList.add('show')});
</script></body></html>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function deactivate() { panel=undefined; graph=undefined; }
module.exports={activate,deactivate};
