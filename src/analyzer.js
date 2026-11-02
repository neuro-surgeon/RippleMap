'use strict';
const path = require('node:path');

const EXTENSIONS = {
  Python: ['.py', '.pyw'],
  JavaScript: ['.js', '.jsx', '.mjs', '.cjs'],
  TypeScript: ['.ts', '.tsx', '.mts', '.cts'],
  'C++': ['.cpp', '.cc', '.cxx', '.c', '.h', '.hh', '.hpp', '.hxx', '.ipp', '.tpp']
};
const ALL_EXTS = Object.values(EXTENSIONS).flat();
const EXCLUDE = '**/{node_modules,.git,.venv,venv,__pycache__,.mypy_cache,.pytest_cache,dist,build,out,coverage,.next,.tox,.idea}/**';

function languageOf(file) {
  const ext = path.extname(file).toLowerCase();
  for (const [language, extensions] of Object.entries(EXTENSIONS)) {
    if (extensions.includes(ext)) return language;
  }
  return undefined;
}
function rel(root, uri) { return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/'); }
function uniq(values) { return [...new Set(values)]; }

function extractJsImports(source) {
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  const found = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"\n]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g
  ];
  for (const re of patterns) { re.lastIndex = 0; let m; while ((m = re.exec(cleaned))) found.push(m[1]); }
  return uniq(found);
}
function extractPythonImports(source) {
  const lines = source.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const found = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    let m = line.match(/^from\s+([.\w]+)\s+import\s+/);
    if (m) { found.push(m[1]); continue; }
    m = line.match(/^import\s+(.+)$/);
    if (m) for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (/^[.\w]+$/.exec(name)) found.push(name);
    }
  }
  return uniq(found);
}
function extractCppIncludes(source) {
  const found = [];
  const re = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
  let m;
  while ((m = re.exec(source))) found.push({ specifier: m[1], local: source.slice(m.index, re.lastIndex).includes('\"') });
  const seen = new Set();
  return found.filter(item => { const key = item.specifier + '\0' + item.local; if (seen.has(key)) return false; seen.add(key); return true; });
}
async function isFile(vscode, uri) {
  try { return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File; } catch { return false; }
}
async function resolveCandidates(vscode, candidates, allowedLanguages) {
  for (const candidate of uniq(candidates)) {
    const uri = vscode.Uri.file(candidate);
    if (allowedLanguages.includes(languageOf(candidate)) && await isFile(vscode, uri)) return uri;
  }
  return undefined;
}
async function resolveJs(vscode, from, spec) {
  if (!spec.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(from.fsPath), spec);
  const candidates = [base, ...ALL_EXTS.filter(e => ['.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts'].includes(e)).map(e => base + e), ...['index.ts','index.tsx','index.js','index.jsx','index.mjs','index.cjs'].map(e => path.join(base,e))];
  return resolveCandidates(vscode, candidates, ['JavaScript','TypeScript']);
}
async function resolvePython(vscode, root, from, spec) {
  const dots = (spec.match(/^\.+/) || [''])[0].length;
  const moduleName = spec.slice(dots).replace(/\./g, path.sep);
  const bases = [];
  if (dots > 0) {
    let dir = path.dirname(from.fsPath);
    for (let i = 1; i < dots; i++) dir = path.dirname(dir);
    bases.push(path.join(dir, moduleName));
  } else {
    bases.push(path.join(root.fsPath, moduleName), path.join(root.fsPath, 'src', moduleName), path.join(path.dirname(from.fsPath), moduleName));
  }
  const candidates = [];
  for (const base of bases) candidates.push(base, base + '.py', base + '.pyw', path.join(base, '__init__.py'), path.join(base, '__init__.pyw'));
  return resolveCandidates(vscode, candidates, ['Python']);
}
async function resolveCpp(vscode, root, from, include) {
  const includeDirs = vscode.workspace.getConfiguration('ripplemap').get('cppIncludeDirectories', []);
  const bases = [path.resolve(path.dirname(from.fsPath), include), path.resolve(root.fsPath, include)];
  if (Array.isArray(includeDirs)) for (const dir of includeDirs) {
    if (typeof dir === 'string' && dir.trim()) bases.push(path.resolve(root.fsPath, dir, include));
  }
  return resolveCandidates(vscode, bases, ['C++']);
}

async function analyzeWorkspace(vscode) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) throw new Error('Откройте папку проекта (workspace), чтобы запустить анализ.');
  const files = [], edges = [], unresolved = [];
  const languages = { Python: 0, JavaScript: 0, TypeScript: 0, 'C++': 0 };
  const seen = new Set();
  const maxFiles = vscode.workspace.getConfiguration('ripplemap').get('maxFiles', 10000);
  for (const folder of folders) {
    const root = folder.uri;
    const patterns = ALL_EXTS.map(ext => `**/*${ext}`);
    const urisByPattern = await Promise.all(patterns.map(pattern => vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), EXCLUDE, maxFiles)));
    const uris = uniq(urisByPattern.flat().map(uri => uri.toString())).map(value => vscode.Uri.parse(value));
    for (const uri of uris) {
      const relative = rel(root, uri);
      const key = `${folder.name}/${relative}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ key, relative, root: root.fsPath, uri: uri.toString(), language: languageOf(relative), folder: folder.name });
    }
  }
  files.sort((a,b) => a.key.localeCompare(b.key));
  const byUri = new Map(files.map(f => [path.normalize(vscode.Uri.parse(f.uri).fsPath), f]));
  for (const file of files) {
    const uri = vscode.Uri.parse(file.uri);
    const rootFolder = folders.find(f => f.name === file.folder) || folders[0];
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    languages[file.language]++;
    let imports = [];
    if (file.language === 'Python') imports = extractPythonImports(content).map(specifier => ({specifier, kind:'Python'}));
    else if (file.language === 'C++') imports = extractCppIncludes(content).map(item => ({specifier:item.specifier, local:item.local, kind:'C++'}));
    else imports = extractJsImports(content).map(specifier => ({specifier, kind:'JS'}));
    for (const item of imports) {
      let target;
      if (item.kind === 'Python') target = await resolvePython(vscode, rootFolder.uri, uri, item.specifier);
      else if (item.kind === 'C++') target = await resolveCpp(vscode, rootFolder.uri, uri, item.specifier);
      else target = await resolveJs(vscode, uri, item.specifier);
      if (!target) {
        const external = item.kind === 'JS' ? !item.specifier.startsWith('.') : item.kind === 'C++' ? !item.specifier.startsWith('.') : !item.specifier.startsWith('.');
        if (item.kind === 'C++' ? item.local : !external) unresolved.push({from:file.key, specifier:item.specifier, language:file.language});
        continue;
      }
      const targetFile = byUri.get(path.normalize(target.fsPath));
      if (targetFile) edges.push({from:file.key, to:targetFile.key, specifier:item.specifier, language:file.language});
    }
  }
  const edgeMap = new Map(edges.map(e => [`${e.from}\0${e.to}\0${e.specifier}`, e]));
  return { files, edges:[...edgeMap.values()], unresolved, languages, roots:folders.map(f=>({name:f.name,path:f.uri.fsPath})) };
}
function findImpact(graph, selected) {
  const reverse = new Map();
  for (const edge of graph.edges) { if (!reverse.has(edge.to)) reverse.set(edge.to,new Set()); reverse.get(edge.to).add(edge.from); }
  const seen = new Set([selected]), queue=[selected], result=[];
  for (let i=0;i<queue.length;i++) for (const importer of reverse.get(queue[i]) || []) if (!seen.has(importer)) { seen.add(importer); queue.push(importer); result.push(importer); }
  return result.sort((a,b)=>a.localeCompare(b));
}
function findDependencies(graph, selected) { return graph.edges.filter(e=>e.from===selected).map(e=>e.to).sort((a,b)=>a.localeCompare(b)); }
module.exports = { analyzeWorkspace, findImpact, findDependencies, languageOf, extractJsImports, extractPythonImports, extractCppIncludes };
