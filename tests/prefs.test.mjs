// Preferências da interface (src/lib/prefs.ts) e busca nas Configurações (src/lib/settingsSearch.ts):
// casos que tests/home.test.mjs não cobre. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as prefs from '../src/lib/prefs.ts';
import { matchesSetting } from '../src/lib/settingsSearch.ts';

test('DEFAULT_PREFS passa por sanitizePrefs sem mudar e usa só valores válidos', () => {
  assert.deepEqual(prefs.sanitizePrefs(prefs.DEFAULT_PREFS), prefs.DEFAULT_PREFS);
  assert.ok(prefs.ACCENTS.includes(prefs.DEFAULT_PREFS.accent));
  assert.ok(prefs.MOTIONS.includes(prefs.DEFAULT_PREFS.motion));
  assert.ok(prefs.STARTUPS.includes(prefs.DEFAULT_PREFS.startup));
  assert.ok(prefs.FONT_SIZE_DEFAULT >= prefs.FONT_SIZE_MIN && prefs.FONT_SIZE_DEFAULT <= prefs.FONT_SIZE_MAX);
});

test('sanitizePrefs devolve objeto novo, sem campos extras', () => {
  const raw = { accent: 'rose', extra: 'x', __proto__evil: 1 };
  const out = prefs.sanitizePrefs(raw);
  assert.deepEqual(Object.keys(out).sort(), ['accent', 'editorFontSize', 'motion', 'spellcheck', 'startup', 'tips']);
  assert.notEqual(out, raw);
  assert.notEqual(prefs.sanitizePrefs({}), prefs.DEFAULT_PREFS);
});

test('sanitizePrefs aceita cada valor das listas e corrige campo a campo', () => {
  for (const accent of prefs.ACCENTS) assert.equal(prefs.sanitizePrefs({ accent }).accent, accent);
  for (const motion of prefs.MOTIONS) assert.equal(prefs.sanitizePrefs({ motion }).motion, motion);
  for (const startup of prefs.STARTUPS) assert.equal(prefs.sanitizePrefs({ startup }).startup, startup);
  const mixed = prefs.sanitizePrefs({ accent: 'BLUE', motion: 'full', tips: 0 });
  assert.equal(mixed.accent, 'sheen');
  assert.equal(mixed.motion, 'full');
  assert.equal(mixed.tips, true);
});

test('sanitizePrefs: tamanho da fonte em texto, fora dos limites ou ausente', () => {
  assert.equal(prefs.sanitizePrefs({ editorFontSize: '18' }).editorFontSize, 18);
  assert.equal(prefs.sanitizePrefs({ editorFontSize: 100 }).editorFontSize, prefs.FONT_SIZE_MAX);
  assert.equal(prefs.sanitizePrefs({ editorFontSize: null }).editorFontSize, prefs.FONT_SIZE_DEFAULT);
  assert.equal(prefs.sanitizePrefs({}).editorFontSize, prefs.FONT_SIZE_DEFAULT);
});

test('sanitizePrefs ignora o que vem por herança (prototype) quando a chave não existe', () => {
  const inherited = Object.create({ accent: 'violet', tips: false });
  const out = prefs.sanitizePrefs(inherited);
  // accent/tips são lidos como propriedade, então herança conta; o que importa é ser valor válido.
  assert.ok(prefs.ACCENTS.includes(out.accent));
  assert.equal(typeof out.tips, 'boolean');
});

test('clampFontSize: meio ponto mais próximo, limites exatos e entradas estranhas', () => {
  assert.equal(prefs.clampFontSize(16.25), 16.5);
  assert.equal(prefs.clampFontSize(16.24), 16);
  assert.equal(prefs.clampFontSize(16.75), 17);
  assert.equal(prefs.clampFontSize(prefs.FONT_SIZE_MIN), prefs.FONT_SIZE_MIN);
  assert.equal(prefs.clampFontSize(prefs.FONT_SIZE_MAX), prefs.FONT_SIZE_MAX);
  assert.equal(prefs.clampFontSize(-5), prefs.FONT_SIZE_MIN);
  assert.equal(prefs.clampFontSize(' 20 '), 20);
  assert.equal(prefs.clampFontSize('abc'), prefs.FONT_SIZE_DEFAULT);
  assert.equal(prefs.clampFontSize(''), prefs.FONT_SIZE_MIN);
  assert.equal(prefs.clampFontSize(undefined), prefs.FONT_SIZE_DEFAULT);
  assert.equal(prefs.clampFontSize(true), prefs.FONT_SIZE_DEFAULT);
  assert.equal(prefs.clampFontSize(-Infinity), prefs.FONT_SIZE_DEFAULT);
});

test('clampFontSize: resultado sempre múltiplo de 0,5 dentro dos limites', () => {
  for (let value = 10; value <= 25; value += 0.13) {
    const size = prefs.clampFontSize(value);
    assert.ok(size >= prefs.FONT_SIZE_MIN && size <= prefs.FONT_SIZE_MAX, String(value));
    assert.equal((size * 2) % 1, 0, String(value));
  }
});

test('prefsToRoot: as três variáveis de cor seguem a cor de destaque, a fonte vai em px', () => {
  for (const accent of prefs.ACCENTS) {
    const { vars, attrs } = prefs.prefsToRoot({ ...prefs.DEFAULT_PREFS, accent, editorFontSize: 14.5 });
    assert.equal(vars['--color-sheen-300'], prefs.ACCENT_TONES[accent][300]);
    assert.equal(vars['--color-sheen-400'], prefs.ACCENT_TONES[accent][400]);
    assert.equal(vars['--color-sheen-700'], prefs.ACCENT_TONES[accent][700]);
    assert.equal(vars['--editor-font-size'], '14.5px');
    assert.equal(attrs['data-accent'], accent);
  }
});

test('prefsToRoot: movimento "full" e "reduce" viram atributo; "system" remove', () => {
  assert.equal(prefs.prefsToRoot({ ...prefs.DEFAULT_PREFS, motion: 'full' }).attrs['data-motion-pref'], 'full');
  assert.equal(prefs.prefsToRoot({ ...prefs.DEFAULT_PREFS, motion: 'reduce' }).attrs['data-motion-pref'], 'reduce');
  assert.equal(prefs.prefsToRoot({ ...prefs.DEFAULT_PREFS, motion: 'system' }).attrs['data-motion-pref'], null);
});

test('ACCENT_TONES: uma entrada por cor de destaque, tons hexadecimais distintos', () => {
  assert.deepEqual(Object.keys(prefs.ACCENT_TONES).sort(), [...prefs.ACCENTS].sort());
  for (const accent of prefs.ACCENTS) {
    const tones = prefs.ACCENT_TONES[accent];
    for (const tone of [300, 400, 700]) assert.match(tones[tone], /^#[0-9a-f]{6}$/);
    assert.equal(new Set([tones[300], tones[400], tones[700]]).size, 3);
  }
});

test('sanitizeFolder: pastas ocultas no meio, "..", espaços e caracteres de controle saem', () => {
  assert.equal(prefs.sanitizeFolder('a/.git/b'), 'a/b/');
  assert.equal(prefs.sanitizeFolder('a/../../b'), 'a/b/');
  assert.equal(prefs.sanitizeFolder('  Diário  /  2024 '), 'Diário/2024/');
  assert.equal(prefs.sanitizeFolder('a\u0000b/c\u001fd'), 'ab/cd/');
  assert.equal(prefs.sanitizeFolder('a//b///c'), 'a/b/c/');
  assert.equal(prefs.sanitizeFolder('C:\\Users\\x'), 'C/Users/x/');
  assert.equal(prefs.sanitizeFolder('<>|?*'), '');
  assert.equal(prefs.sanitizeFolder('/'), '');
});

test('sanitizeFolder é idempotente', () => {
  for (const raw of ['Inbox', '../a/./b', '\\x\\y\\', 'a/.oculta/b', 'Notas da Casa']) {
    const once = prefs.sanitizeFolder(raw);
    assert.equal(prefs.sanitizeFolder(once), once, raw);
  }
});

test('matchesSetting: espaços sobrando e só espaços', () => {
  assert.equal(matchesSetting('   ', ['Qualquer']), true);
  assert.equal(matchesSetting('  cor   destaque ', ['Cor de destaque']), true);
});

test('matchesSetting: acento e caixa na consulta também são ignorados', () => {
  assert.equal(matchesSetting('APARÊNCIA', ['Aparencia']), true);
  assert.equal(matchesSetting('Animações', ['animacoes']), true);
  assert.equal(matchesSetting('ç', ['Começo']), true);
});

test('matchesSetting: palavras podem vir de textos diferentes, mas pedaço de palavra também casa', () => {
  assert.equal(matchesSetting('fonte editor', ['Tamanho da fonte', 'Texto do editor']), true);
  assert.equal(matchesSetting('ont', ['Fonte']), true);
  assert.equal(matchesSetting('fonte', []), false);
});

test('matchesSetting: a união dos textos não cria palavra que não existe', () => {
  // "Cor" + "de" juntos com espaço não formam "corde".
  assert.equal(matchesSetting('corde', ['Cor', 'de destaque']), false);
});
