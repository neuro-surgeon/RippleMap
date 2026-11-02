'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { languageOf, extractJsImports, extractPythonImports, extractCppIncludes } = require('../out/analyzer');

test('recognizes supported source extensions', () => {
  assert.equal(languageOf('pkg/mod.py'), 'Python');
  assert.equal(languageOf('main.cpp'), 'C++');
  assert.equal(languageOf('include/api.hpp'), 'C++');
  assert.equal(languageOf('src/app.tsx'), 'TypeScript');
  assert.equal(languageOf('src/app.jsx'), 'JavaScript');
  assert.equal(languageOf('README.md'), undefined);
});
test('extracts Python imports', () => {
  assert.deepEqual(extractPythonImports('import os\nimport pkg.mod as m\nfrom .utils import f\nfrom ..core.base import X\n'), ['os','pkg.mod','.utils','..core.base']);
});
test('extracts JavaScript and TypeScript imports', () => {
  assert.deepEqual(extractJsImports("import x from './x'; export { y } from '../y'; const z=require('./z'); import('./lazy')"), ['./x','../y','./lazy','./z']);
});
test('extracts C++ include directives', () => {
  assert.deepEqual(extractCppIncludes('#include "local.hpp"\n#include <vector>\n # include "detail/item.h"'), [{specifier:'local.hpp',local:true},{specifier:'vector',local:false},{specifier:'detail/item.h',local:true}]);
});

test('analyzes a mixed-language workspace and resolves local edges', async () => {
  const path = require('node:path');
  const { analyzeWorkspace } = require('../out/analyzer');
  const rootPath = path.resolve('/workspace/demo');
  const source = new Map([
    ['app.py', 'from .utils import run\n'],
    ['utils.py', 'def run(): pass\n'],
    ['main.cpp', '#include "thing.hpp"\n'],
    ['thing.hpp', '#pragma once\n'],
    ['index.js', "import './module.js';\n"],
    ['module.js', 'export const value = 1;\n'],
    ['app.ts', "import './helper';\n"],
    ['helper.ts', 'export const helper = 1;\n']
  ]);
  class Uri {
    constructor(fsPath) { this.fsPath = fsPath; }
    toString() { return 'file://' + this.fsPath; }
    static file(p) { return new Uri(path.resolve(p)); }
    static parse(s) { return new Uri(s.replace(/^file:\/\//,'')); }
  }
  class RelativePattern { constructor(base, pattern) { this.base=base; this.pattern=pattern; } }
  const folder = { name:'demo', uri:Uri.file(rootPath) };
  const fake = {
    Uri, RelativePattern, FileType:{File:1},
    workspace:{
      workspaceFolders:[folder],
      getConfiguration:()=>({get:(key, fallback)=>fallback}),
      findFiles:async pattern=>{
        const ext=pattern.pattern.slice(4);
        return [...source.keys()].filter(name=>name.endsWith(ext)).map(name=>Uri.file(path.join(rootPath,name)));
      },
      fs:{
        stat:async uri=>{const name=path.relative(rootPath,uri.fsPath);if(source.has(name))return {type:1};throw new Error('missing');},
        readFile:async uri=>Buffer.from(source.get(path.relative(rootPath,uri.fsPath)))
      }
    }
  };
  const result=await analyzeWorkspace(fake);
  assert.equal(result.files.length,8);
  assert.equal(result.languages.Python,2);
  assert.equal(result.languages['C++'],2);
  assert.equal(result.edges.length,4);
});
