// Cores da área de trabalho e conversão de temas do VS Code (src/lib/workbenchTheme.ts e src/lib/vscode.ts).
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toMonacoTheme, toSnippetEntries } from '../src/lib/vscode.ts';
import { cssVariables, FLINTPAD_THEME, themeKind, workbenchColors, xtermTheme } from '../src/lib/workbenchTheme.ts';

const HEX = /^#[0-9a-f]{3,8}$/i;

test('themeKind traduz o uiTheme do VS Code; desconhecido vira escuro', () => {
  assert.equal(themeKind('vs'), 'light');
  assert.equal(themeKind('vs-dark'), 'dark');
  assert.equal(themeKind('hc-black'), 'hc-dark');
  assert.equal(themeKind('hc-light'), 'hc-light');
  assert.equal(themeKind(''), 'dark');
  assert.equal(themeKind('VS'), 'dark');
});

test('workbenchColors: tema vazio usa os padrões do VS Code, escuro ou claro', () => {
  const dark = workbenchColors({}, 'dark');
  const light = workbenchColors({}, 'light');
  assert.equal(dark['editor.background'], '#1e1e1e');
  assert.equal(light['editor.background'], '#ffffff');
  assert.equal(dark['sideBar.background'], '#252526');
  assert.equal(light['input.border'], '#cecece');
  assert.equal(dark['input.border'], 'transparent');
});

test('workbenchColors: alto contraste claro usa os padrões claros; escuro, os escuros', () => {
  assert.equal(workbenchColors({}, 'hc-light')['editor.background'], '#ffffff');
  assert.equal(workbenchColors({}, 'hc-dark')['editor.background'], '#1e1e1e');
});

test('workbenchColors: referências "@chave" seguem a cor do tema', () => {
  const colors = workbenchColors({ colors: { foreground: '#123456', 'editor.background': '#000001' } }, 'dark');
  assert.equal(colors['sideBar.foreground'], '#123456');
  // referência em cadeia: sideBarSectionHeader → sideBar.foreground → foreground
  assert.equal(colors['sideBarSectionHeader.foreground'], '#123456');
  assert.equal(colors['input.foreground'], '#123456');
  assert.equal(colors['tab.activeBackground'], '#000001');
  // terminal.background → panel.background → editor.background
  assert.equal(colors['terminal.background'], '#000001');
});

test('workbenchColors: valor explícito do tema vence a referência padrão', () => {
  const colors = workbenchColors({ colors: { foreground: '#111111', 'sideBar.foreground': '#222222' } }, 'dark');
  assert.equal(colors['sideBar.foreground'], '#222222');
  assert.equal(colors['sideBarSectionHeader.foreground'], '#222222');
});

test('workbenchColors: tema também pode usar "@chave"; chave inexistente vira transparente', () => {
  const colors = workbenchColors({ colors: { 'button.background': '@focusBorder', focusBorder: '#abcdef', 'badge.background': '@nada.aqui' } }, 'dark');
  assert.equal(colors['button.background'], '#abcdef');
  assert.equal(colors['badge.background'], 'transparent');
});

test('workbenchColors: referência circular termina sem estourar a pilha', () => {
  const colors = workbenchColors({ colors: { foreground: '@focusBorder', focusBorder: '@foreground' } }, 'dark');
  assert.equal(typeof colors.foreground, 'string');
  assert.equal(typeof colors.focusBorder, 'string');
});

test('workbenchColors: só as chaves usadas pela interface entram no resultado', () => {
  const colors = workbenchColors({ colors: { 'editorCursor.foreground': '#ff0000' } }, 'dark');
  assert.equal('editorCursor.foreground' in colors, false);
  assert.ok(Object.keys(colors).length > 50);
  assert.ok(Object.values(colors).every((value) => !value.startsWith('@')));
});

test('cssVariables troca "." por "-" e prefixa com --vsc-', () => {
  assert.deepEqual(cssVariables({ 'sideBar.background': '#111', 'terminal.ansiBrightRed': '#f00', foreground: '#fff' }), {
    '--vsc-sideBar-background': '#111',
    '--vsc-terminal-ansiBrightRed': '#f00',
    '--vsc-foreground': '#fff',
  });
  assert.deepEqual(cssVariables({}), {});
});

test('xtermTheme mapeia as 16 cores ANSI, fundo, texto, cursor e seleção', () => {
  const colors = workbenchColors({ colors: { 'terminal.foreground': '#010203', 'terminal.ansiRed': '#ff0001' } }, 'dark');
  const xterm = xtermTheme(colors);
  assert.equal(xterm.foreground, '#010203');
  // cursor herda terminal.foreground
  assert.equal(xterm.cursor, '#010203');
  assert.equal(xterm.red, '#ff0001');
  assert.equal(xterm.background, colors['terminal.background']);
  assert.equal(xterm.brightWhite, '#e5e5e5');
  const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const key of [...keys, ...keys.map((k) => `bright${k[0].toUpperCase()}${k.slice(1)}`)]) assert.match(xterm[key], HEX, key);
});

test('FLINTPAD_THEME: escuro, cores hexadecimais válidas e terminal com o veio verde-água', () => {
  assert.equal(FLINTPAD_THEME.type, 'dark');
  for (const [key, value] of Object.entries(FLINTPAD_THEME.colors)) assert.match(value, HEX, key);
  for (const entry of FLINTPAD_THEME.tokenColors) {
    assert.ok(entry.scope.length > 0);
    if (entry.settings.foreground) assert.match(entry.settings.foreground, HEX);
  }
  const colors = workbenchColors(FLINTPAD_THEME, themeKind('vs-dark'));
  assert.equal(colors['sideBar.foreground'], FLINTPAD_THEME.colors.foreground);
  assert.equal(xtermTheme(colors).cursor, '#4fbfb4');
});

test('toMonacoTheme: base conforme o uiTheme e só cores "#" passam', () => {
  const theme = { colors: { 'editor.background': '#000000', 'editor.foreground': 'red', bad: 3 } };
  assert.equal(toMonacoTheme(theme, 'vs').base, 'vs');
  assert.equal(toMonacoTheme(theme, 'vs-dark').base, 'vs-dark');
  assert.equal(toMonacoTheme(theme, 'hc-black').base, 'hc-black');
  const out = toMonacoTheme(theme, 'vs-dark');
  assert.equal(out.inherit, true);
  assert.deepEqual(out.colors, { 'editor.background': '#000000' });
  assert.deepEqual(toMonacoTheme({}, 'vs').rules, []);
});

test('toMonacoTheme: alto contraste claro usa a base hc-light do Monaco', () => {
  assert.equal(toMonacoTheme({}, 'hc-light').base, 'hc-light');
});

test('toMonacoTheme: escopos em lista ou separados por vírgula, por prefixo, sem "#" na cor', () => {
  const { rules } = toMonacoTheme(
    {
      tokenColors: [
        { scope: 'comment.line.double-slash, string.regexp', settings: { foreground: '#00FF00', fontStyle: 'italic' } },
        { scope: ['keyword.operator.assignment', 'commentary', ''], settings: { foreground: '#123' } },
      ],
    },
    'vs-dark',
  );
  assert.deepEqual(rules, [
    { token: 'comment', foreground: '00FF00', fontStyle: 'italic' },
    { token: 'regexp', foreground: '00FF00', fontStyle: 'italic' },
    { token: 'operator', foreground: '123', fontStyle: undefined },
    { token: 'delimiter', foreground: '123', fontStyle: undefined },
  ]);
});

test('toMonacoTheme: entrada sem cor nem estilo é ignorada; cor inválida some mas o estilo fica', () => {
  const { rules } = toMonacoTheme(
    {
      tokenColors: [
        { scope: 'comment', settings: {} },
        { scope: 'keyword', settings: { foreground: 'blue', fontStyle: 'bold' } },
        { settings: { foreground: '#ffffff' } },
        { scope: 'meta.desconhecido', settings: { foreground: '#ffffff' } },
      ],
    },
    'vs',
  );
  assert.deepEqual(rules, [{ token: 'keyword', foreground: undefined, fontStyle: 'bold' }]);
});

test('toMonacoTheme: "support.type.property-name" vira chave de JSON', () => {
  const { rules } = toMonacoTheme({ tokenColors: [{ scope: 'support.type.property-name', settings: { foreground: '#aaaaaa' } }] }, 'vs-dark');
  assert.deepEqual(
    rules.map((rule) => rule.token),
    ['string.key.json', 'attribute.name'],
  );
});

test('toSnippetEntries: um item por prefixo, corpo em lista vira linhas, descrição cai no nome', () => {
  const entries = toSnippetEntries({
    'Log no console': { prefix: ['log', 'cl'], body: ['console.log($1);', '$0'] },
    Vazio: { prefix: 'nada', body: '' },
    'Sem prefixo': { body: 'x' },
    'Sem corpo': { prefix: 'y' },
    Nulo: null,
    Fn: { prefix: 'fn', body: 'function $1() {}', description: 'Função' },
  });
  assert.deepEqual(entries, [
    { label: 'log', body: 'console.log($1);\n$0', description: 'Log no console' },
    { label: 'cl', body: 'console.log($1);\n$0', description: 'Log no console' },
    { label: 'nada', body: '', description: 'Vazio' },
    { label: 'fn', body: 'function $1() {}', description: 'Função' },
  ]);
  assert.deepEqual(toSnippetEntries({}), []);
});
