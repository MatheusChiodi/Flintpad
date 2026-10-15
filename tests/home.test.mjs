// Tela inicial, Configurações e vaults recentes (src/lib/home.ts, prefs.ts, settingsSearch.ts, pins.ts e electron/vaults.cjs).
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import * as home from '../src/lib/home.ts';
import * as pins from '../src/lib/pins.ts';
import * as prefs from '../src/lib/prefs.ts';
import { matchesSetting } from '../src/lib/settingsSearch.ts';

const vaults = createRequire(import.meta.url)('../electron/vaults.cjs');

test('greetingFor divide o dia em manhã, tarde, noite e madrugada', () => {
  assert.equal(home.greetingFor(0), 'night');
  assert.equal(home.greetingFor(4), 'night');
  assert.equal(home.greetingFor(5), 'morning');
  assert.equal(home.greetingFor(11), 'morning');
  assert.equal(home.greetingFor(12), 'afternoon');
  assert.equal(home.greetingFor(17), 'afternoon');
  assert.equal(home.greetingFor(18), 'evening');
  assert.equal(home.greetingFor(23), 'evening');
});

test('vaultStats conta páginas, pastas, tarefas e palavras', () => {
  const notes = [
    { path: 'A.md', name: 'A' },
    { path: 'Projetos/B.md', name: 'B' },
    { path: 'Projetos/Casa/C.md', name: 'C' },
  ];
  const contents = {
    'A.md': '# Título\n\nUma frase curta.\n\n- [ ] abrir\n- [x] feita\n',
    'Projetos/B.md': '```\n- [ ] dentro de código não conta\n```\n',
    // C.md não carregado (arquivo grande): conta como página, sem palavras.
  };
  const stats = home.vaultStats(notes, contents, 4);
  assert.equal(stats.pages, 3);
  assert.equal(stats.folders, 2);
  assert.equal(stats.openTasks, 1);
  assert.equal(stats.doneTasks, 1);
  assert.equal(stats.tags, 4);
  assert.ok(stats.words >= 5);
  assert.deepEqual(home.vaultStats([], {}), { pages: 0, folders: 0, openTasks: 0, doneTasks: 0, words: 0, tags: 0 });
});

test('tipIndex fica igual no mesmo dia, muda no seguinte e avança com o deslocamento', () => {
  const morning = new Date(2026, 9, 14, 8);
  const night = new Date(2026, 9, 14, 23);
  const next = new Date(2026, 9, 15, 8);
  assert.equal(home.tipIndex(morning, 10), home.tipIndex(night, 10));
  assert.equal(home.tipIndex(next, 10), (home.tipIndex(morning, 10) + 1) % 10);
  assert.equal(home.tipIndex(morning, 10, 3), (home.tipIndex(morning, 10) + 3) % 10);
  assert.equal(home.tipIndex(morning, 10, -1), (home.tipIndex(morning, 10) + 9) % 10);
  assert.equal(home.tipIndex(morning, 0), 0);
});

test('removeRecent e clearRecents mexem só nas recentes', () => {
  const base = { favorites: ['a.md'], recents: ['a.md', 'b.md'] };
  assert.deepEqual(pins.removeRecent(base, 'a.md'), { favorites: ['a.md'], recents: ['b.md'] });
  assert.equal(pins.removeRecent(base, 'x.md'), base);
  assert.deepEqual(pins.clearRecents(base), { favorites: ['a.md'], recents: [] });
  const empty = { favorites: ['a.md'], recents: [] };
  assert.equal(pins.clearRecents(empty), empty);
});

test('sanitizePrefs aceita o válido e devolve o padrão para o resto', () => {
  assert.deepEqual(prefs.sanitizePrefs(undefined), prefs.DEFAULT_PREFS);
  assert.deepEqual(prefs.sanitizePrefs([1, 2]), prefs.DEFAULT_PREFS);
  assert.deepEqual(
    prefs.sanitizePrefs({ accent: 'violet', editorFontSize: 18, motion: 'reduce', spellcheck: false, startup: 'home', tips: false }),
    { accent: 'violet', editorFontSize: 18, motion: 'reduce', spellcheck: false, startup: 'home', tips: false },
  );
  const bad = prefs.sanitizePrefs({ accent: 'neon', editorFontSize: 'grande', motion: 3, spellcheck: 'sim', startup: 'x', tips: null, extra: 1 });
  assert.deepEqual(bad, prefs.DEFAULT_PREFS);
  assert.equal('extra' in bad, false);
});

test('clampFontSize limita e arredonda em meio ponto', () => {
  assert.equal(prefs.clampFontSize(5), prefs.FONT_SIZE_MIN);
  assert.equal(prefs.clampFontSize(99), prefs.FONT_SIZE_MAX);
  assert.equal(prefs.clampFontSize(17.3), 17.5);
  assert.equal(prefs.clampFontSize('15'), 15);
  assert.equal(prefs.clampFontSize(NaN), prefs.FONT_SIZE_DEFAULT);
  assert.equal(prefs.clampFontSize(Infinity), prefs.FONT_SIZE_DEFAULT);
});

test('prefsToRoot traduz a cor de destaque, a fonte e o movimento', () => {
  const root = prefs.prefsToRoot({ ...prefs.DEFAULT_PREFS, accent: 'blue', editorFontSize: 18, motion: 'reduce' });
  assert.equal(root.vars['--color-sheen-400'], prefs.ACCENT_TONES.blue[400]);
  assert.equal(root.vars['--editor-font-size'], '18px');
  assert.equal(root.attrs['data-motion-pref'], 'reduce');
  assert.equal(prefs.prefsToRoot(prefs.DEFAULT_PREFS).attrs['data-motion-pref'], null);
  for (const accent of prefs.ACCENTS) assert.match(prefs.ACCENT_TONES[accent][700], /^#[0-9a-f]{6}$/);
});

test('sanitizeFolder não deixa sair do vault nem usar pastas ocultas', () => {
  assert.equal(prefs.sanitizeFolder(''), '');
  assert.equal(prefs.sanitizeFolder('Inbox'), 'Inbox/');
  assert.equal(prefs.sanitizeFolder('Inbox/'), 'Inbox/');
  assert.equal(prefs.sanitizeFolder('\\Projetos\\Casa\\'), 'Projetos/Casa/');
  assert.equal(prefs.sanitizeFolder('../fora/./x'), 'fora/x/');
  assert.equal(prefs.sanitizeFolder('.obnotion'), '');
  assert.equal(prefs.sanitizeFolder('a:b*c'), 'abc/');
  assert.equal(prefs.sanitizeFolder(null), '');
  assert.equal(prefs.sanitizeFolder(42), '');
});

test('matchesSetting exige todas as palavras, sem caixa nem acento', () => {
  assert.equal(matchesSetting('', ['Idioma']), true);
  assert.equal(matchesSetting('idioma', ['Idioma', 'Língua da interface']), true);
  assert.equal(matchesSetting('lingua', ['Idioma', 'Língua da interface']), true);
  assert.equal(matchesSetting('cor destaque', ['Cor de destaque', '', 'Aparência']), true);
  assert.equal(matchesSetting('cor fonte', ['Cor de destaque']), false);
  assert.equal(matchesSetting('aparencia', ['Animações', '', 'Aparência']), true);
});

test('pushRecentVault põe no topo, tira repetidos e limita a lista', () => {
  assert.deepEqual(vaults.pushRecentVault(['/a', '/b'], '/b'), ['/b', '/a']);
  assert.deepEqual(vaults.pushRecentVault(undefined, '/a'), ['/a']);
  assert.deepEqual(vaults.pushRecentVault(['/a', 3, null, ''], '/c'), ['/c', '/a']);
  assert.deepEqual(vaults.pushRecentVault(['/a'], ''), ['/a']);
  const many = Array.from({ length: 20 }, (_, i) => `/v${i}`);
  assert.equal(vaults.pushRecentVault(many, '/novo').length, vaults.MAX_RECENT_VAULTS);
  assert.equal(vaults.pushRecentVault(many, '/novo')[0], '/novo');
});

test('forgetRecentVault tira só a pasta pedida', () => {
  assert.deepEqual(vaults.forgetRecentVault(['/a', '/b'], '/a'), ['/b']);
  assert.deepEqual(vaults.forgetRecentVault('x', '/a'), []);
});

test('sanitizeStoredPrefs aceita só objetos pequenos', () => {
  assert.deepEqual(vaults.sanitizeStoredPrefs({ accent: 'blue' }), { accent: 'blue' });
  assert.deepEqual(vaults.sanitizeStoredPrefs([1]), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs('x'), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs(null), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs({ big: 'x'.repeat(5000) }), {});
});
