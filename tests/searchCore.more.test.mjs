// Busca e substituição em arquivos (electron/searchCore.mjs): bordas que tests/codeSearch.test.mjs não cobre.
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMatcher, findMatches, globMatcher, parseTodo, replaceInText, SEARCH_LIMITS, TODO_QUERY, TODO_TAGS } from '../electron/searchCore.mjs';

const lit = (query, extra = {}) => buildMatcher({ query, ...extra });
const re = (query, extra = {}) => buildMatcher({ query, isRegex: true, ...extra });

test('constantes congeladas: SEARCH_LIMITS e TODO_TAGS', () => {
  assert.ok(Object.isFrozen(SEARCH_LIMITS));
  assert.ok(Object.isFrozen(TODO_TAGS));
  assert.deepEqual([...TODO_TAGS], ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'NOTE']);
});

test('buildMatcher: sempre global; "i" só sem diferenciar caixa', () => {
  assert.equal(lit('a').flags, 'gi');
  assert.equal(lit('a', { matchCase: true }).flags, 'g');
  assert.ok(lit('a', { wholeWord: true }).flags.includes('u'));
});

test('buildMatcher: consulta que não é texto lança erro', () => {
  assert.throws(() => buildMatcher({ query: null }));
  assert.throws(() => buildMatcher({ query: 42 }));
});

test('buildMatcher: texto literal com todos os caracteres especiais de regex', () => {
  const special = '.*+?^${}()|[]\\';
  assert.equal(findMatches(`x${special}y`, lit(special)).length, 1);
  assert.equal(findMatches('xxxx', lit('.*')).length, 0);
});

test('palavra inteira com regex alternada só casa palavras completas', () => {
  const matcher = re('foo|bar', { wholeWord: true });
  assert.deepEqual(findMatches('foo foobar bar barra', matcher).map((m) => m.column), [1, 12]);
});

test('palavra inteira: expressão que só vale fora do modo unicode cai no \\b sem lançar', () => {
  // "\-" é escape inválido com a flag u.
  const matcher = re('a\\-b', { wholeWord: true });
  assert.ok(!matcher.flags.includes('u'));
  assert.equal(findMatches('a-b xa-b a-b', matcher).length, 2);
});

test('palavra inteira: dígitos e sublinhado contam como parte da palavra', () => {
  const matcher = lit('id', { wholeWord: true });
  assert.equal(findMatches('id id2 _id id_ (id)', matcher).length, 2);
});

test('findMatches: \\r sozinho também quebra linha', () => {
  const matches = findMatches('a\rfoo\r\n\nfoo', lit('foo'));
  assert.deepEqual(matches.map((m) => m.line), [2, 4]);
});

test('findMatches: coluna em unidades UTF-16 (emoji conta 2)', () => {
  const [match] = findMatches('😀foo', lit('foo'));
  assert.equal(match.column, 3);
  assert.equal(match.preview.slice(match.previewStart, match.previewStart + match.length), 'foo');
});

test('findMatches: limite 0 não devolve nada e lastIndex volta a 0', () => {
  const matcher = lit('a');
  assert.deepEqual(findMatches('aaa', matcher, 0), []);
  findMatches('aaa', matcher);
  assert.equal(matcher.lastIndex, 0);
});

test('findMatches: limite vale entre linhas', () => {
  assert.deepEqual(findMatches('a a\na a\na', lit('a'), 3).map((m) => [m.line, m.column]), [[1, 1], [1, 3], [2, 1]]);
});

test('findMatches: texto sem achados e texto vazio', () => {
  assert.deepEqual(findMatches('', lit('x')), []);
  assert.deepEqual(findMatches('abc', lit('x')), []);
});

test('findMatches: recuo com tab sai do trecho; achado dentro do recuo começa nele', () => {
  const [tab] = findMatches('\t\tfoo()', lit('foo'));
  assert.equal(tab.preview, 'foo()');
  assert.equal(tab.previewStart, 0);
  const [space] = findMatches('   x', re(' '));
  assert.equal(space.previewStart, 0);
  assert.equal(space.preview, '   x');
});

test('findMatches: exatamente 50 caracteres antes não ganham reticências; 51 sim', () => {
  const [fifty] = findMatches(`${'x'.repeat(50)}ALVO`, lit('alvo'));
  assert.ok(!fifty.preview.startsWith('…'));
  assert.equal(fifty.previewStart, 50);
  const [more] = findMatches(`${'x'.repeat(51)}ALVO`, lit('alvo'));
  assert.ok(more.preview.startsWith('…'));
  assert.equal(more.previewStart, 1 + SEARCH_LIMITS.previewLead);
  assert.equal(more.preview.slice(more.previewStart, more.previewStart + 4), 'ALVO');
});

test('findMatches: trecho corta em maxPreview e previewLength não passa do fim', () => {
  const [match] = findMatches('a'.repeat(300), re('a+'));
  assert.equal(match.length, 300);
  assert.equal(match.preview.length, SEARCH_LIMITS.maxPreview);
  assert.equal(match.previewLength, SEARCH_LIMITS.maxPreview);
  const [tail] = findMatches(`${'x'.repeat(40)}${'A'.repeat(400)}`, re('A+'));
  assert.ok(tail.previewStart + tail.previewLength <= tail.preview.length);
});

test('findMatches: expressão não atravessa linhas', () => {
  assert.deepEqual(findMatches('a\nb', re('a\\nb')), []);
  assert.equal(findMatches('fim\ncomeço', re('^\\w')).length, 2);
});

test('replaceInText: $` e $\' valem o texto antes e depois do achado na linha', () => {
  assert.equal(replaceInText('abc', re('b'), "[$`|$']", true).text, 'a[a|c]c');
});

test('replaceInText: $10 com um grupo vira grupo 1 seguido de "0"; $2 inexistente fica literal', () => {
  assert.equal(replaceInText('a', re('(a)'), '$10', true).text, 'a0');
  assert.equal(replaceInText('a', re('(a)'), '$2', true).text, '$2');
  assert.equal(replaceInText('a', re('(a)'), '$0', true).text, '$0');
  assert.equal(replaceInText('a', re('(a)'), '$01', true).text, 'a');
});

test('replaceInText: $N igual ao String.replace do JavaScript', () => {
  const cases = [
    ['ana@casa', '(\\w+)@(\\w+)', '$2-$1-$3-$&'],
    ['x1y2', '(\\d)', '<$1$1>'],
    ['b', '(a)|(b)', '[$1][$2]'],
    ['abcdefghijk', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', '$11$10$1'],
  ];
  for (const [text, pattern, template] of cases) {
    const expected = text.replace(new RegExp(pattern, 'g'), template);
    assert.equal(replaceInText(text, re(pattern, { matchCase: true }), template, true).text, expected, `${pattern} → ${template}`);
  }
});

test('replaceInText: $<nome> sem grupos nomeados fica literal; nome inexistente vira vazio', () => {
  assert.equal(replaceInText('a', re('(a)'), '$<x>', true).text, '$<x>');
  assert.equal(replaceInText('a', re('(?<n>a)'), '[$<m>]', true).text, '[]');
});

test('replaceInText: achado vazio não conta nem insere texto', () => {
  assert.deepEqual(replaceInText('abc', re('x*'), 'Y', true), { text: 'abc', count: 0 });
});

test('replaceInText: sem achado devolve o mesmo texto; \\r sozinho preservado', () => {
  assert.deepEqual(replaceInText('a\rb', lit('z'), 'y'), { text: 'a\rb', count: 0 });
  assert.deepEqual(replaceInText('a\rb\ra', lit('a'), 'Z'), { text: 'Z\rb\rZ', count: 2 });
});

test('replaceInText: sem diferenciar caixa troca todas as grafias; lastIndex volta a 0', () => {
  const matcher = lit('Foo');
  assert.deepEqual(replaceInText('foo FOO Foo', matcher, 'x'), { text: 'x x x', count: 3 });
  assert.equal(matcher.lastIndex, 0);
});

test('replaceInText conta o mesmo que findMatches acha', () => {
  const text = 'foo bar\r\n  foo foo\nbaz FOO\rfoo';
  for (const matcher of [lit('foo'), lit('foo', { matchCase: true }), lit('foo', { wholeWord: true }), re('o+'), re('^\\s*\\w')]) {
    assert.equal(replaceInText(text, matcher, '#', true).count, findMatches(text, matcher).length, String(matcher));
  }
});

test('globMatcher: barra no começo prende à raiz', () => {
  const rooted = globMatcher('/src');
  assert.ok(rooted('src/a.ts'));
  assert.ok(!rooted('lib/src/a.ts'));
  const anywhere = globMatcher('src');
  assert.ok(anywhere('lib/src/a.ts'));
});

test('globMatcher: "?" casa um caractere sem atravessar pasta', () => {
  const matcher = globMatcher('a?.ts');
  assert.ok(matcher('ab.ts'));
  assert.ok(matcher('x/a1.ts'));
  assert.ok(!matcher('a.ts'));
  assert.ok(!matcher('abc.ts'));
});

test('globMatcher: "*" não atravessa pasta; "**" sozinho casa tudo', () => {
  const star = globMatcher('src/*.ts');
  assert.ok(star('src/a.ts'));
  assert.ok(!star('src/a/b.ts'));
  assert.ok(globMatcher('**')('qualquer/coisa.bin'));
});

test('globMatcher: ponto é literal e caixa é ignorada', () => {
  const matcher = globMatcher('*.TS');
  assert.ok(matcher('a.ts'));
  assert.ok(!matcher('axts'));
});

test('globMatcher: vírgula dentro de chaves não separa padrões; espaços e vazios somem', () => {
  const matcher = globMatcher(' src/{a,b}/*.md , , *.txt ');
  assert.ok(matcher('src/a/x.md'));
  assert.ok(matcher('src/b/y.md'));
  assert.ok(!matcher('src/c/y.md'));
  assert.ok(matcher('notas/z.txt'));
  assert.equal(globMatcher(' , , '), null);
  assert.equal(globMatcher(undefined), null);
});

test('globMatcher: barras invertidas e barra final valem como "/"', () => {
  const matcher = globMatcher('src\\lib\\');
  assert.ok(matcher('src/lib/a.ts'));
  assert.ok(matcher('src\\lib\\a.ts'));
});

test('globMatcher: chave sem fechar vira literal', () => {
  const matcher = globMatcher('a{b');
  assert.ok(matcher('a{b'));
  assert.ok(!matcher('ab'));
});

test('parseTodo: marcas de comentário HTML e de template saem do fim', () => {
  assert.deepEqual(parseTodo('<!-- TODO: revisar -->'), { tag: 'TODO', text: 'revisar' });
  assert.deepEqual(parseTodo('{# HACK contorno #}'), { tag: 'HACK', text: 'contorno' });
  assert.deepEqual(parseTodo('XXX - remover depois'), { tag: 'XXX', text: 'remover depois' });
  assert.deepEqual(parseTodo('// BUG(#12): falha no Windows'), { tag: 'BUG', text: 'falha no Windows' });
});

test('parseTodo: só a marca, sem texto', () => {
  assert.deepEqual(parseTodo('// TODO'), { tag: 'TODO', text: '' });
  assert.deepEqual(parseTodo('// FIXME:'), { tag: 'FIXME', text: '' });
});

test('parseTodo: palavra maior, minúsculas ou sem marca não contam', () => {
  assert.equal(parseTodo('TODOS os itens'), null);
  assert.equal(parseTodo('// todo: minúsculo'), null);
  assert.equal(parseTodo('const x = 1;'), null);
});

test('parseTodo: a primeira marca da linha vence', () => {
  assert.deepEqual(parseTodo('NOTE: ver o TODO acima'), { tag: 'NOTE', text: 'ver o TODO acima' });
});

test('TODO_QUERY diferenciando caixa acha todas as marcas e nenhuma em minúsculas', () => {
  const matcher = re(TODO_QUERY, { matchCase: true });
  const text = TODO_TAGS.map((tag) => `// ${tag} x`).join('\n') + '\n// todo x\n// TODOS';
  assert.deepEqual(findMatches(text, matcher).map((m) => text.split('\n')[m.line - 1].slice(m.column - 1, m.column - 1 + m.length)), [...TODO_TAGS]);
});
