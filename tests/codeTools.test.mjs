// Regras puras da aba Código (src/lib/codeTools.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  duplicateName,
  markdownSnippet,
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

test('duplicateName acrescenta "copy" antes da extensão e numera se já existir', () => {
  assert.equal(duplicateName('a.ts', () => false), 'a copy.ts');
  const taken = new Set(['a copy.ts', 'a copy 2.ts']);
  assert.equal(duplicateName('a.ts', (n) => taken.has(n)), 'a copy 3.ts');
  assert.equal(duplicateName('Makefile', () => false), 'Makefile copy');
  assert.equal(duplicateName('.env', () => false), '.env copy');
});

test('parseQuickOpen separa arquivo, linha e coluna', () => {
  assert.deepEqual(parseQuickOpen('app.ts:12:4'), { query: 'app.ts', line: 12, column: 4 });
  assert.deepEqual(parseQuickOpen('app.ts:12'), { query: 'app.ts', line: 12, column: undefined });
  assert.deepEqual(parseQuickOpen('app.ts'), { query: 'app.ts' });
  assert.deepEqual(parseQuickOpen(':12'), { query: ':12' });
  assert.deepEqual(parseQuickOpen('src/a b.ts:3,7 '), { query: 'src/a b.ts', line: 3, column: 7 });
});

test('tabsToClose: outros, à direita e salvos poupam as fixadas; todos fecha tudo', () => {
  const tabs = [
    { path: 'A', preview: false, pinned: true },
    { path: 'B', preview: false },
    { path: 'C', preview: true },
    { path: 'D', preview: false },
  ];
  const dirty = (p) => p === 'D';
  assert.deepEqual(tabsToClose(tabs, 'others', 'B', dirty), ['C', 'D']);
  assert.deepEqual(tabsToClose(tabs, 'right', 'b', dirty), ['C', 'D']);
  assert.deepEqual(tabsToClose(tabs, 'saved', 'B', dirty), ['B', 'C']);
  assert.deepEqual(tabsToClose(tabs, 'all', 'B', dirty), ['A', 'B', 'C', 'D']);
  assert.deepEqual(tabsToClose(tabs, 'right', 'X', dirty), []);
});

test('sortPinned põe as fixadas na frente sem mudar a ordem relativa', () => {
  const tabs = [{ path: 'a', preview: false }, { path: 'b', preview: false, pinned: true }, { path: 'c', preview: false }, { path: 'd', preview: false, pinned: true }];
  assert.deepEqual(sortPinned(tabs).map((t) => t.path), ['b', 'd', 'a', 'c']);
});

test('pushClosed não repete e limita o tamanho', () => {
  let stack = [];
  for (const p of ['a', 'b', 'A', 'c']) stack = pushClosed(stack, p, 2);
  assert.deepEqual(stack, ['c', 'A']);
});

test('NavHistory: salto longo grava ponto, movimento curto atualiza; voltar e avançar', () => {
  const nav = new NavHistory(10);
  nav.record({ path: 'a', line: 1, column: 1 });
  nav.record({ path: 'a', line: 5, column: 1 }); // perto: substitui
  nav.record({ path: 'a', line: 40, column: 2 });
  nav.record({ path: 'b', line: 1, column: 1 });
  assert.deepEqual(nav.back(), { path: 'a', line: 40, column: 2 });
  assert.deepEqual(nav.back(), { path: 'a', line: 5, column: 1 });
  assert.equal(nav.back(), null);
  assert.deepEqual(nav.forward(), { path: 'a', line: 40, column: 2 });
  // gravar depois de voltar descarta o "avançar"
  nav.record({ path: 'c', line: 1, column: 1 });
  assert.equal(nav.forward(), null);
  assert.ok(nav.canBack);
});

test('NavHistory.forget tira o arquivo e mantém a posição coerente', () => {
  const nav = new NavHistory();
  nav.record({ path: 'a', line: 1, column: 1 });
  nav.record({ path: 'b', line: 1, column: 1 });
  nav.record({ path: 'c', line: 1, column: 1 });
  nav.forget('B');
  assert.deepEqual(nav.back(), { path: 'a', line: 1, column: 1 });
  assert.deepEqual(nav.forward(), { path: 'c', line: 1, column: 1 });
});

test('trailingWhitespace e needsFinalNewline', () => {
  assert.deepEqual(trailingWhitespace(['a  ', 'b', '\t', 'c d']), [
    { line: 1, startColumn: 2, endColumn: 4 },
    { line: 3, startColumn: 1, endColumn: 2 },
  ]);
  assert.equal(needsFinalNewline('a'), true);
  assert.equal(needsFinalNewline('a\n'), false);
  assert.equal(needsFinalNewline('a\r\n'), false);
  assert.equal(needsFinalNewline(''), false);
});

test('markdownSnippet: cerca maior que as crases do código, linguagem e intervalo de linhas', () => {
  const out = markdownSnippet({ code: 'const a = `x`;\r\nconst b = 1;\n', language: 'typescript', path: 'src/a.ts', startLine: 3, endLine: 4 });
  assert.equal(out, '`src/a.ts:3-4`\n\n```typescript\nconst a = `x`;\nconst b = 1;\n```\n');
  const fenced = markdownSnippet({ code: '```js\n```', language: 'markdown', path: 'r.md', startLine: 1, endLine: 1 });
  assert.ok(fenced.includes('````markdown\n'));
  assert.ok(markdownSnippet({ code: 'x', language: 'plaintext', path: 'a.txt', startLine: 2, endLine: 2 }).includes('```\nx\n```'));
});

test('runCommandFor escolhe o executor e protege o caminho com aspas', () => {
  assert.equal(runCommandFor("C:\\a b\\it's.py"), "python 'C:\\a b\\it''s.py'");
  assert.equal(runCommandFor('/x/a.ts', 'posix'), "node --experimental-strip-types '/x/a.ts'");
  assert.equal(runCommandFor('C:\\x\\run.cmd'), "& 'C:\\x\\run.cmd'");
  assert.equal(runCommandFor('C:\\x\\a.css'), null);
  assert.equal(quoteArg("it's", 'posix'), "'it'\\''s'");
});

test('parseSavedEditors descarta lixo e garante um ativo válido', () => {
  assert.deepEqual(parseSavedEditors(null), { tabs: [], active: null });
  assert.deepEqual(parseSavedEditors({ tabs: [{ path: 'a', pinned: true }, { nope: 1 }, 'x', { path: 'b' }], active: 'zzz' }), {
    tabs: [
      { path: 'a', pinned: true },
      { path: 'b', pinned: false },
    ],
    active: 'a',
  });
  assert.equal(parseSavedEditors({ tabs: [{ path: 'a' }, { path: 'B' }], active: 'b' }).active, 'b');
});

test('workspaceKey e tabLabel', () => {
  assert.equal(workspaceKey(['D:\\Proj\\', 'E:/x']), 'd:/proj|e:/x');
  assert.equal(tabLabel('D:\\p\\src\\index.ts', ['D:\\p\\src\\index.ts', 'D:\\p\\lib\\index.ts']), 'index.ts · src');
  assert.equal(tabLabel('D:\\p\\a.ts', ['D:\\p\\a.ts']), 'a.ts');
});
