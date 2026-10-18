// Casos extras das regras puras da aba Código (src/lib/codeTools.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  duplicateName,
  filePattern,
  markdownSnippet,
  matchesFilePattern,
  matchFileNames,
  NavHistory,
  needsFinalNewline,
  parseQuickOpen,
  parseSavedEditors,
  pushClosed,
  quoteArg,
  runCommandFor,
  sortPinned,
  tabLabel,
  tabsToClose,
  trailingWhitespace,
  workspaceKey,
} from '../src/lib/codeTools.ts';

test('duplicateName: só a última extensão fica depois do "copy"; esgotado, usa número único', () => {
  assert.equal(duplicateName('a.tar.gz', () => false), 'a.tar copy.gz');
  assert.equal(duplicateName('Ação.md', () => false), 'Ação copy.md');
  assert.match(duplicateName('a.ts', () => true), /^a copy \d+\.ts$/);
});

test('filePattern: "?" e "*" não atravessam pastas; "**/" no meio aceita zero ou mais pastas', () => {
  const p = filePattern('src/**/test.ts');
  assert.equal(matchesFilePattern(p, 'C:\\proj\\src\\test.ts'), true);
  assert.equal(matchesFilePattern(p, '/proj/src/a/b/test.ts'), true);
  assert.equal(matchesFilePattern(p, '/proj/xsrc/test.ts'), false);
  const one = filePattern('docs/?.md');
  assert.equal(matchesFilePattern(one, '/r/docs/a.md'), true);
  assert.equal(matchesFilePattern(one, '/r/docs/ab.md'), false);
  assert.equal(matchesFilePattern(filePattern('src/*.ts'), '/r/src/a/b.ts'), false);
});

test('filePattern: sem caixa e caracteres especiais de regex tratados como literais', () => {
  assert.equal(matchesFilePattern(filePattern('*.TS'), 'D:\\a\\b.ts'), true);
  assert.equal(matchesFilePattern(filePattern('*.ts'), 'D:\\a\\b.tsx'), false);
  assert.equal(matchesFilePattern(filePattern('a(1).txt'), '/x/a(1).txt'), true);
  assert.equal(matchesFilePattern(filePattern('a(1).txt'), '/x/a1.txt'), false);
  assert.equal(matchesFilePattern(filePattern('[ab].txt'), '/x/[ab].txt'), true);
  assert.equal(matchesFilePattern(filePattern('[ab].txt'), '/x/a.txt'), false);
  assert.equal(matchesFilePattern(filePattern('$x^.txt'), '/x/$x^.txt'), true);
});

test('filePattern: padrão de nome compara só o nome, mesmo com pastas que casariam', () => {
  const p = filePattern('*.md');
  assert.equal(p.fullPath, false);
  assert.equal(matchesFilePattern(p, 'D:\\notas.md\\arquivo.txt'), false);
  assert.equal(filePattern('a/b').fullPath, true);
});

test('parseQuickOpen: linha/coluna 0 viram 1, caminho com unidade e sufixo não numérico', () => {
  assert.deepEqual(parseQuickOpen('a.ts:0'), { query: 'a.ts', line: 1, column: undefined });
  assert.deepEqual(parseQuickOpen('a.ts:5:0'), { query: 'a.ts', line: 5, column: 1 });
  assert.deepEqual(parseQuickOpen('C:\\a.ts:3'), { query: 'C:\\a.ts', line: 3, column: undefined });
  assert.deepEqual(parseQuickOpen('a.ts:x'), { query: 'a.ts:x' });
  assert.deepEqual(parseQuickOpen('   '), { query: '' });
  assert.deepEqual(parseQuickOpen('  b.ts:10:2  '), { query: 'b.ts', line: 10, column: 2 });
});

test('tabsToClose: "salvos" poupa as sujas e as fixadas; caminho comparado sem caixa nem separador', () => {
  const tabs = [
    { path: 'D:\\p\\a.ts', preview: false, pinned: true },
    { path: 'D:\\p\\b.ts', preview: false },
    { path: 'D:\\p\\c.ts', preview: false },
  ];
  const dirty = (p) => p.endsWith('c.ts');
  assert.deepEqual(tabsToClose(tabs, 'saved', 'x', dirty), ['D:\\p\\b.ts']);
  assert.deepEqual(tabsToClose(tabs, 'right', 'd:/P/A.TS', dirty), ['D:\\p\\b.ts', 'D:\\p\\c.ts']);
  assert.deepEqual(tabsToClose(tabs, 'others', 'd:/p/c.ts', dirty), ['D:\\p\\b.ts']);
  // guia desconhecida: "outros" fecha todas as não fixadas
  assert.deepEqual(tabsToClose(tabs, 'others', 'zzz', dirty), ['D:\\p\\b.ts', 'D:\\p\\c.ts']);
  assert.deepEqual(tabsToClose([], 'all', 'x', dirty), []);
});

test('sortPinned não altera a lista original', () => {
  const tabs = [{ path: 'a', preview: false }, { path: 'b', preview: false, pinned: true }];
  const copy = structuredClone(tabs);
  const sorted = sortPinned(tabs);
  assert.deepEqual(tabs, copy);
  assert.notEqual(sorted, tabs);
  assert.deepEqual(sorted.map((t) => t.path), ['b', 'a']);
});

test('pushClosed: mais recente no topo, repetição sem caixa nem separador, limite padrão 20', () => {
  assert.deepEqual(pushClosed(['D:\\a', 'b'], 'd:/A'), ['d:/A', 'b']);
  let stack = [];
  for (let i = 0; i < 25; i++) stack = pushClosed(stack, `f${i}`);
  assert.equal(stack.length, 20);
  assert.equal(stack[0], 'f24');
  assert.equal(stack.at(-1), 'f5');
});

test('NavHistory: limite máximo descarta os mais antigos', () => {
  const nav = new NavHistory(10, 3);
  for (const path of ['a', 'b', 'c', 'd']) nav.record({ path, line: 1, column: 1 });
  assert.deepEqual(nav.back()?.path, 'c');
  assert.deepEqual(nav.back()?.path, 'b');
  assert.equal(nav.back(), null);
});

test('NavHistory: mesmo arquivo com outra caixa/separador e perto atualiza; distância configurável', () => {
  const nav = new NavHistory(3);
  nav.record({ path: 'D:\\p\\a.ts', line: 1, column: 1 });
  nav.record({ path: 'd:/p/A.ts', line: 3, column: 9 });
  assert.equal(nav.canBack, false);
  nav.record({ path: 'd:/p/A.ts', line: 6, column: 1 });
  assert.equal(nav.canBack, true);
  assert.deepEqual(nav.back(), { path: 'd:/p/A.ts', line: 3, column: 9 });
});

test('NavHistory: canForward, histórico vazio e esquecer tudo', () => {
  const nav = new NavHistory();
  assert.equal(nav.back(), null);
  assert.equal(nav.forward(), null);
  assert.equal(nav.canBack, false);
  assert.equal(nav.canForward, false);
  nav.record({ path: 'a', line: 1, column: 1 });
  nav.record({ path: 'b', line: 1, column: 1 });
  nav.back();
  assert.equal(nav.canForward, true);
  nav.forget('a');
  nav.forget('b');
  assert.equal(nav.canBack, false);
  assert.equal(nav.canForward, false);
  assert.equal(nav.back(), null);
  // depois de esvaziado, volta a gravar normalmente
  nav.record({ path: 'c', line: 1, column: 1 });
  nav.record({ path: 'd', line: 1, column: 1 });
  assert.deepEqual(nav.back(), { path: 'c', line: 1, column: 1 });
});

test('NavHistory.forget do ponto atual mantém a posição no anterior', () => {
  const nav = new NavHistory();
  for (const path of ['a', 'b', 'c']) nav.record({ path, line: 1, column: 1 });
  nav.forget('c');
  assert.equal(nav.canForward, false);
  assert.deepEqual(nav.back(), { path: 'a', line: 1, column: 1 });
});

test('trailingWhitespace: tabs e espaços misturados, linha só de espaços, nada a apagar', () => {
  assert.deepEqual(trailingWhitespace(['x \t ', '   ', '', 'ok']), [
    { line: 1, startColumn: 2, endColumn: 5 },
    { line: 2, startColumn: 1, endColumn: 4 },
  ]);
  assert.deepEqual(trailingWhitespace(['a', 'b']), []);
  assert.deepEqual(trailingWhitespace([]), []);
});

test('needsFinalNewline aceita \\r sozinho como fim de linha', () => {
  assert.equal(needsFinalNewline('a\r'), false);
  assert.equal(needsFinalNewline('a\nb'), true);
  assert.equal(needsFinalNewline(' '), true);
});

test('markdownSnippet: linha única, quebras finais removidas, \\r antigo e linguagem inválida', () => {
  assert.equal(markdownSnippet({ code: 'x\n\n\n', language: 'c++', path: 'a.cpp', startLine: 7, endLine: 7 }), '`a.cpp:7`\n\n```c++\nx\n```\n');
  assert.equal(markdownSnippet({ code: 'a\rb', language: 'minha linguagem', path: 'p', startLine: 1, endLine: 2 }), '`p:1-2`\n\n```\na\nb\n```\n');
  const four = markdownSnippet({ code: 'x ```` y', language: 'md', path: 'r.md', startLine: 1, endLine: 1 });
  assert.ok(four.includes('\n`````md\n'));
  assert.ok(four.endsWith('\n`````\n'));
});

test('runCommandFor: extensão sem caixa, .bat só no Windows e executores conhecidos', () => {
  assert.equal(runCommandFor('C:\\x\\A.PY'), "python 'C:\\x\\A.PY'");
  assert.equal(runCommandFor('/x/run.bat', 'posix'), null);
  assert.equal(runCommandFor('/x/s.sh', 'posix'), "bash '/x/s.sh'");
  assert.equal(runCommandFor('C:\\x\\s.ps1'), "powershell -ExecutionPolicy Bypass -File 'C:\\x\\s.ps1'");
  assert.equal(runCommandFor('C:\\x\\main.go'), "go run 'C:\\x\\main.go'");
  assert.equal(runCommandFor('C:\\x\\Makefile'), null);
  assert.equal(runCommandFor('C:\\x\\.py'), null);
});

test('quoteArg: aspas simples dobradas no PowerShell e fechadas/reabertas no sh', () => {
  assert.equal(quoteArg("a'b'c"), "'a''b''c'");
  assert.equal(quoteArg('sem aspas', 'posix'), "'sem aspas'");
  assert.equal(quoteArg('$HOME `x`', 'posix'), "'$HOME `x`'");
  assert.equal(quoteArg(''), "''");
});

test('parseSavedEditors: tabs inválidas, limite de 50, pinned só true e ativo sem caixa', () => {
  assert.deepEqual(parseSavedEditors({ tabs: 'x', active: 'a' }), { tabs: [], active: null });
  assert.deepEqual(parseSavedEditors([]), { tabs: [], active: null });
  assert.deepEqual(parseSavedEditors('lixo'), { tabs: [], active: null });
  const many = parseSavedEditors({ tabs: Array.from({ length: 60 }, (_, i) => ({ path: `f${i}` })) });
  assert.equal(many.tabs.length, 50);
  assert.equal(many.active, 'f0');
  assert.deepEqual(parseSavedEditors({ tabs: [{ path: 'a', pinned: 'true' }, { path: 'b', pinned: 1 }] }).tabs, [
    { path: 'a', pinned: false },
    { path: 'b', pinned: false },
  ]);
  assert.equal(parseSavedEditors({ tabs: [{ path: 'D:\\a.ts' }], active: 'd:/A.ts' }).active, 'd:/A.ts');
  assert.equal(parseSavedEditors({ tabs: [{ path: 'a' }], active: 5 }).active, 'a');
});

test('workspaceKey: lista vazia, barras repetidas e ordem preservada', () => {
  assert.equal(workspaceKey([]), '');
  assert.equal(workspaceKey(['C:\\\\A\\\\b\\\\']), 'c:/a/b');
  assert.equal(workspaceKey(['/b', '/a']), '/b|/a');
});

test('tabLabel: nomes iguais com outra caixa conflitam; o mesmo arquivo com outra grafia não', () => {
  assert.equal(tabLabel('/p/src/App.ts', ['/p/src/App.ts', '/p/lib/app.ts']), 'App.ts · src');
  assert.equal(tabLabel('D:\\p\\a.ts', ['D:\\p\\a.ts', 'd:/P/A.TS']), 'a.ts');
  assert.equal(tabLabel('/p/a.ts', []), 'a.ts');
});

test('matchFileNames: nome igual, depois começo, depois o resto; acentos ignorados', () => {
  const files = ['x/minhaacao.ts', 'x/acaoes.ts', 'x/Ação.ts', 'y/acao'];
  assert.deepEqual(matchFileNames('acao', files), ['y/acao', 'x/Ação.ts', 'x/acaoes.ts', 'x/minhaacao.ts']);
});

test('matchFileNames: sem caixa por padrão; com matchCase exige a caixa', () => {
  const files = ['src/App.tsx', 'src/app.css'];
  assert.deepEqual(matchFileNames('APP', files), ['src/app.css', 'src/App.tsx']);
  assert.deepEqual(matchFileNames('App', files, true), ['src/App.tsx']);
  assert.deepEqual(matchFileNames('APP', files, true), []);
});

test('matchFileNames: consulta com "/" vale o caminho; sem "/", só o nome', () => {
  const files = ['C:\\p\\src\\util.ts', 'C:\\p\\lib\\util.ts', 'C:\\p\\src\\main.ts'];
  assert.deepEqual(matchFileNames('src\\util', files), ['C:\\p\\src\\util.ts']);
  assert.deepEqual(matchFileNames('src', files), []);
  assert.deepEqual(matchFileNames('util', files), ['C:\\p\\lib\\util.ts', 'C:\\p\\src\\util.ts']);
});

test('matchFileNames: consulta vazia não lista nada; resultado limitado a 50; desempate pelo tamanho', () => {
  assert.deepEqual(matchFileNames('   ', ['a']), []);
  const files = Array.from({ length: 80 }, (_, i) => `d/file${i}.txt`);
  assert.equal(matchFileNames('file', files).length, 50);
  assert.deepEqual(matchFileNames('b', ['long/dir/b.ts', 'd/b.ts']), ['d/b.ts', 'long/dir/b.ts']);
});
