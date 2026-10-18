// Casos extras de caminhos e busca aproximada (src/lib/paths.ts e src/lib/fuzzy.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fuzzyFilter, fuzzyMatch } from '../src/lib/fuzzy.ts';
import { baseName, dirName, extName, isInside, joinPath, relativePath, samePath, separatorOf } from '../src/lib/paths.ts';

// ---------- paths ----------

test('separatorOf: barra invertida ou letra de unidade indicam Windows', () => {
  assert.equal(separatorOf('D:\\a'), '\\');
  assert.equal(separatorOf('c:/a/b'), '\\');
  assert.equal(separatorOf('/home/u'), '/');
  assert.equal(separatorOf('rel/a'), '/');
  assert.equal(separatorOf('a\\b'), '\\');
});

test('baseName ignora separadores no fim e repetidos', () => {
  assert.equal(baseName('D:\\proj\\src\\'), 'src');
  assert.equal(baseName('/a//b///'), 'b');
  assert.equal(baseName('arquivo.txt'), 'arquivo.txt');
  assert.equal(baseName('C:\\'), 'C:');
  assert.equal(baseName(''), '');
});

test('dirName: separador no fim, caminho relativo e unidade com barra normal', () => {
  assert.equal(dirName('/a/b/'), '/a');
  assert.equal(dirName('D:\\proj\\src\\'), 'D:\\proj');
  assert.equal(dirName('a.ts'), '');
  assert.equal(dirName('src/a.ts'), 'src');
  assert.equal(dirName('C:/x'), 'C:\\');
});

test('dirName da própria raiz continua sendo a raiz', () => {
  assert.equal(dirName('C:\\'), 'C:\\');
  assert.equal(dirName('/'), '/');
});

test('joinPath: ".." não sobe acima da raiz e partes vazias ou "." são ignoradas', () => {
  assert.equal(joinPath('D:\\a', '..', '..', 'b'), 'D:\\b');
  assert.equal(joinPath('/a', '../../..', 'b'), '/b');
  assert.equal(joinPath('D:\\a', '', '.', 'b'), 'D:\\a\\b');
  assert.equal(joinPath('/x', 'a\\b'), '/x/a/b');
  assert.equal(joinPath('D:\\a'), 'D:\\a');
});

test('joinPath com raiz ou base terminada em separador não duplica a barra', () => {
  assert.equal(joinPath('C:\\', 'a'), 'C:\\a');
  assert.equal(joinPath('/', 'a'), '/a');
  assert.equal(joinPath('D:\\proj\\', 'a.ts'), 'D:\\proj\\a.ts');
});

test('extName: arquivo sem extensão dentro de pasta com ponto e extensão composta', () => {
  assert.equal(extName('C:\\x.y\\Makefile'), '');
  assert.equal(extName('/a/archive.tar.GZ'), '.gz');
  assert.equal(extName('/a/.env.local'), '.local');
  assert.equal(extName('README'), '');
});

test('samePath: separador no fim e repetido não importam; nomes diferentes sim', () => {
  assert.ok(samePath('D:\\proj\\', 'd:/PROJ'));
  assert.ok(samePath('D:\\\\proj//a', 'D:/proj/a'));
  assert.ok(!samePath('D:\\proj\\a', 'D:\\proj\\b'));
  assert.ok(!samePath('/a/b', '/a/bc'));
});

test('isInside: raiz do disco, próprio caminho e prefixo de nome que não é pasta', () => {
  assert.ok(isInside('D:\\a\\b.ts', 'D:\\'));
  assert.ok(isInside('/home/u', '/home/u'));
  assert.ok(!isInside('/home/user2/a', '/home/user'));
  assert.ok(!isInside('/home', '/home/u'));
  assert.ok(isInside('d:/A/B', 'D:\\a'));
});

test('relativePath: raiz com barra no fim, raiz igual ao caminho e caminhos POSIX', () => {
  assert.equal(relativePath('D:\\proj\\', 'D:\\proj\\src\\a.ts'), 'src/a.ts');
  assert.equal(relativePath('/home/u', '/home/u/x/y.md'), 'x/y.md');
  assert.equal(relativePath('D:\\proj', 'D:\\proj'), '');
  assert.equal(relativePath('D:\\proj', 'D:\\project\\a.ts'), 'D:\\project\\a.ts');
  assert.equal(relativePath('', 'D:\\a.ts'), 'D:\\a.ts');
});

// ---------- fuzzy ----------

test('fuzzyMatch ignora caixa, acentos e espaços da consulta', () => {
  assert.deepEqual(fuzzyMatch('titulo', 'Título.md')?.positions, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(fuzzyMatch('ÁPP', 'app.ts')?.positions, [0, 1, 2]);
  assert.deepEqual(fuzzyMatch('a p p', 'App.tsx')?.positions, [0, 1, 2]);
  assert.deepEqual(fuzzyMatch('   ', 'x'), { score: 0, positions: [] });
});

test('fuzzyMatch: letras fora de ordem ou ausentes não casam', () => {
  assert.equal(fuzzyMatch('ba', 'ab'), null);
  assert.equal(fuzzyMatch('aa', 'a'), null);
  assert.equal(fuzzyMatch('a', ''), null);
});

test('fuzzyMatch prefere início de palavra (camelCase, _, -, /, .)', () => {
  assert.deepEqual(fuzzyMatch('fb', 'fooBar')?.positions, [0, 3]);
  assert.deepEqual(fuzzyMatch('b', 'abc_b')?.positions, [4]);
  assert.deepEqual(fuzzyMatch('nm', 'src/node-modules')?.positions, [4, 9]);
  assert.deepEqual(fuzzyMatch('t', 'a.test')?.positions, [2]);
});

test('fuzzyMatch: letras seguidas e acerto no nome do arquivo pontuam mais', () => {
  assert.ok(fuzzyMatch('abc', 'abc').score > fuzzyMatch('abc', 'a_b_c').score);
  assert.ok(fuzzyMatch('ab', 'x/ab.ts').score > fuzzyMatch('ab', 'ab/x.ts').score);
  assert.ok(fuzzyMatch('app', 'src/App.tsx').score > fuzzyMatch('app', 'src/myapp.tsx').score);
  // caminho mais curto desempata
  assert.ok(fuzzyMatch('a', 'a.ts').score > fuzzyMatch('a', 'a.tsx').score);
});

test('fuzzyMatch acha a sequência mesmo quando a letra seguinte começa palavra mais adiante', () => {
  const match = fuzzyMatch('abc', 'xa-bc-ab');
  assert.notEqual(match, null);
  assert.deepEqual(match.positions, [1, 3, 4]);
});

test('fuzzyFilter: limita os resultados, ordena por pontuação e devolve as posições', () => {
  const files = ['lib/util.ts', 'src/App.tsx', 'src/app/routes.ts', 'README.md', 'src/apps.ts'];
  const ranked = fuzzyFilter('app', files, (f) => f, 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].item, 'src/App.tsx');
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.deepEqual(ranked[0].positions, [4, 5, 6]);
  assert.ok(!fuzzyFilter('app', files, (f) => f).some((r) => r.item === 'README.md'));
});

test('fuzzyFilter usa o acessor de texto em objetos e consulta só de espaços lista tudo', () => {
  const items = [{ name: 'Ação.ts' }, { name: 'b.ts' }];
  assert.deepEqual(fuzzyFilter('acao', items, (i) => i.name).map((r) => r.item), [items[0]]);
  assert.deepEqual(fuzzyFilter('  ', items, (i) => i.name), [
    { item: items[0], positions: [] },
    { item: items[1], positions: [] },
  ]);
  assert.deepEqual(fuzzyFilter('zz', items, (i) => i.name), []);
});
