// Busca e substituição em arquivos da aba Código (electron/searchCore.mjs). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMatcher, findMatches, globMatcher, parseTodo, replaceInText, TODO_QUERY } from '../electron/searchCore.mjs';

test('buildMatcher: texto literal escapa caracteres especiais e ignora caixa por padrão', () => {
  const matcher = buildMatcher({ query: 'a.b(' });
  assert.equal(findMatches('xA.B(y a.b( axb(', matcher).length, 2);
  assert.equal(findMatches('A.B(', buildMatcher({ query: 'a.b(', matchCase: true })).length, 0);
});

test('buildMatcher: expressão inválida lança erro e consulta vazia também', () => {
  assert.throws(() => buildMatcher({ query: '(', isRegex: true }));
  assert.throws(() => buildMatcher({ query: '' }));
});

test('palavra inteira respeita letras acentuadas', () => {
  const matcher = buildMatcher({ query: 'ação', wholeWord: true });
  assert.equal(findMatches('ação reação ação_x ação.', matcher).length, 2);
  const plain = buildMatcher({ query: 'cafe', wholeWord: true });
  assert.equal(findMatches('cafeína cafe café', plain).length, 1);
});

test('findMatches: linha e coluna a partir de 1, vários achados por linha e trecho sem recuo', () => {
  const matches = findMatches('um\n    foo bar foo\r\nfim', buildMatcher({ query: 'foo' }));
  assert.deepEqual(
    matches.map((m) => [m.line, m.column, m.length]),
    [
      [2, 5, 3],
      [2, 13, 3],
    ],
  );
  assert.equal(matches[0].preview, 'foo bar foo');
  assert.equal(matches[0].previewStart, 0);
  assert.equal(matches[1].preview.slice(matches[1].previewStart, matches[1].previewStart + 3), 'foo');
});

test('findMatches: linha longa corta o começo com reticências e respeita o limite', () => {
  const line = 'x'.repeat(300) + 'ALVO' + 'y'.repeat(300);
  const [match] = findMatches(line, buildMatcher({ query: 'alvo' }));
  assert.ok(match.preview.startsWith('…'));
  assert.equal(match.preview.slice(match.previewStart, match.previewStart + 4), 'ALVO');
  assert.ok(match.preview.length <= 221);
  assert.equal(findMatches('a a a a', buildMatcher({ query: 'a' }), 2).length, 2);
});

test('findMatches: achado vazio de expressão não trava', () => {
  assert.deepEqual(findMatches('abc\n', buildMatcher({ query: '^', isRegex: true })), []);
  assert.equal(findMatches('abc', buildMatcher({ query: 'x*', isRegex: true })).length, 0);
});

test('replaceInText: literal não interpreta $ e conta as trocas; quebras de linha ficam iguais', () => {
  const result = replaceInText('a.b\r\na.b\nfim', buildMatcher({ query: 'a.b' }), '$1');
  assert.equal(result.text, '$1\r\n$1\nfim');
  assert.equal(result.count, 2);
});

test('replaceInText: expressão com grupos, grupo nomeado e $&', () => {
  const matcher = buildMatcher({ query: '(\\w+)@(?<host>\\w+)', isRegex: true });
  assert.equal(replaceInText('ana@casa', matcher, '$2:$1 [$&] <$<host>> $$', true).text, 'casa:ana [ana@casa] <casa> $');
  // lookbehind continua valendo na troca
  const behind = buildMatcher({ query: '(?<=R\\$)\\d+', isRegex: true });
  assert.deepEqual(replaceInText('R$10 e 10', behind, 'X', true), { text: 'R$X e 10', count: 1 });
});

test('globMatcher: padrões sem barra casam em qualquer pasta; pasta casa o conteúdo', () => {
  assert.equal(globMatcher(''), null);
  const ts = globMatcher('*.ts, *.{md,txt}');
  assert.ok(ts('src/a.ts'));
  assert.ok(ts('a.ts'));
  assert.ok(ts('docs/x/readme.md'));
  assert.ok(!ts('src/a.tsx'));
  const folder = globMatcher('./src/lib');
  assert.ok(folder('src/lib/a.ts'));
  assert.ok(!folder('src/libx/a.ts'));
  const nm = globMatcher('node_modules, dist');
  assert.ok(nm('packages/x/node_modules/y/index.js'));
  assert.ok(nm('dist/app.js'));
  assert.ok(!nm('src/distance.ts'));
  assert.ok(globMatcher('src/**/*.test.ts')('src/a/b/c.test.ts'));
  assert.ok(globMatcher('src/**/*.test.ts')('src/c.test.ts'));
});

test('TODO: a consulta acha as marcas e parseTodo separa a marca do texto', () => {
  const matcher = buildMatcher({ query: TODO_QUERY, isRegex: true, matchCase: true });
  const found = findMatches('// TODO: tratar vazio\n/* FIXME(ana): arredondar */\nconst todo = 1;\n# NOTE lembrar', matcher);
  assert.equal(found.length, 3);
  assert.deepEqual(parseTodo(found[0].preview), { tag: 'TODO', text: 'tratar vazio' });
  assert.deepEqual(parseTodo(found[1].preview), { tag: 'FIXME', text: 'arredondar' });
  assert.deepEqual(parseTodo(found[2].preview), { tag: 'NOTE', text: 'lembrar' });
});
