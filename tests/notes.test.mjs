// Lógica da tela de notas (src/lib/notes.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as n from '../src/lib/notes.ts';

test('sanitizeNoteName tira o que o Windows recusa e o que quebra um wikilink', () => {
  assert.equal(n.sanitizeNoteName('  Plano: v2? '), 'Plano v2');
  assert.equal(n.sanitizeNoteName('a#b^c[d]e|f'), 'abcdef');
  assert.equal(n.sanitizeNoteName('Fim com ponto...'), 'Fim com ponto');
  assert.equal(n.sanitizeNoteName('con'), 'con_');
  assert.equal(n.sanitizeNoteName('///'), '');
});

test('sanitizeNotePath mantém subpastas e não sai do vault', () => {
  assert.equal(n.sanitizeNotePath('Projetos/Casa: nova'), 'Projetos/Casa nova');
  assert.equal(n.sanitizeNotePath('../../fora'), 'fora');
  assert.equal(n.sanitizeNotePath('a\\b'), 'a/b');
});
