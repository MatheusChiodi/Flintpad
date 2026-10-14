// Caminhos e busca aproximada da aba Código (src/lib/paths.ts e src/lib/fuzzy.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fuzzyFilter, fuzzyMatch } from '../src/lib/fuzzy.ts';
import { baseName, dirName, extName, isInside, joinPath, relativePath, samePath } from '../src/lib/paths.ts';

test('baseName e dirName aceitam \\ e /, e a raiz do disco continua pasta', () => {
  assert.equal(baseName('D:\\proj\\src\\App.tsx'), 'App.tsx');
  assert.equal(baseName('/home/u/a.ts'), 'a.ts');
  assert.equal(dirName('D:\\proj\\src\\App.tsx'), 'D:\\proj\\src');
  assert.equal(dirName('D:\\App.tsx'), 'D:\\');
  assert.equal(dirName('/a.ts'), '/');
});

test('joinPath usa o separador da base e resolve . e ..', () => {
  assert.equal(joinPath('D:\\proj', 'src/lib', 'a.ts'), 'D:\\proj\\src\\lib\\a.ts');
  assert.equal(joinPath('D:\\proj\\src', '../README.md'), 'D:\\proj\\README.md');
  assert.equal(joinPath('/home/u', './a/b'), '/home/u/a/b');
});

test('extName: só a última extensão, em minúsculas; arquivo com ponto no início não tem', () => {
  assert.equal(extName('x/Arquivo.D.TS'), '.ts');
  assert.equal(extName('.gitignore'), '');
  assert.equal(extName('Makefile'), '');
});

test('samePath e isInside ignoram caixa e separador (Windows)', () => {
  assert.ok(samePath('D:\\Proj\\a.ts', 'd:/proj/A.ts'));
  assert.ok(isInside('D:\\proj\\src\\a.ts', 'd:/PROJ'));
  assert.ok(isInside('D:\\proj', 'D:\\proj\\'));
  assert.ok(!isInside('D:\\project\\a.ts', 'D:\\proj'));
});

test('relativePath devolve o caminho com / a partir da raiz, ou o absoluto fora dela', () => {
  assert.equal(relativePath('D:\\proj', 'D:\\proj\\src\\a.ts'), 'src/a.ts');
  assert.equal(relativePath('D:\\proj', 'E:\\outro\\a.ts'), 'E:\\outro\\a.ts');
  assert.equal(relativePath(null, 'D:\\a.ts'), 'D:\\a.ts');
});

test('fuzzyMatch exige as letras em ordem e marca as posições', () => {
  assert.equal(fuzzyMatch('xyz', 'App.tsx'), null);
  assert.deepEqual(fuzzyMatch('apt', 'App.tsx')?.positions, [0, 1, 4]);
  assert.deepEqual(fuzzyMatch('', 'qualquer'), { score: 0, positions: [] });
});

test('fuzzyFilter prefere o nome do arquivo e o começo de palavra', () => {
  const files = ['src/editor/index.ts', 'src/components/Editor.tsx', 'src/lib/textmate.ts', 'electron/main.cjs'];
  const ranked = fuzzyFilter('editor', files, (f) => f).map((r) => r.item);
  assert.equal(ranked.length, 2);
  // Casar no nome do arquivo vale mais que casar no nome da pasta.
  assert.equal(ranked[0], 'src/components/Editor.tsx');
  assert.deepEqual(
    fuzzyFilter('tm', files, (f) => f).map((r) => r.item)[0],
    'src/lib/textmate.ts',
  );
});

test('fuzzyFilter sem consulta devolve a lista na ordem, até o limite', () => {
  assert.deepEqual(
    fuzzyFilter('', ['a', 'b', 'c'], (x) => x, 2).map((r) => r.item),
    ['a', 'b'],
  );
});
