// Cores da área de trabalho da aba Código a partir das chaves de cor do tema do VS Code
// ("sideBar.background", "tab.activeBackground"...). O que o tema não define cai no padrão do VS Code.
import type { ITheme } from '@xterm/xterm';

import type { VsTheme } from './vscode';

export type ThemeKind = 'dark' | 'light' | 'hc-dark' | 'hc-light';

export const themeKind = (uiTheme: string): ThemeKind =>
  uiTheme === 'vs' ? 'light' : uiTheme === 'hc-black' ? 'hc-dark' : uiTheme === 'hc-light' ? 'hc-light' : 'dark';

// Chaves usadas pela interface; cada uma com o padrão do VS Code para escuro e claro
// (ou uma referência "@chave" a outra chave, como o VS Code faz).
const DEFAULTS: Record<string, [dark: string, light: string]> = {
  foreground: ['#cccccc', '#616161'],
  descriptionForeground: ['#ccccccb3', '#717171'],
  errorForeground: ['#f48771', '#a1260d'],
  focusBorder: ['#007fd4', '#0090f1'],
  'widget.shadow': ['#0000005c', '#00000029'],
  'editor.background': ['#1e1e1e', '#ffffff'],
  'editor.foreground': ['#d4d4d4', '#000000'],
  'activityBar.background': ['#333333', '#2c2c2c'],
  'activityBar.foreground': ['#ffffff', '#ffffff'],
  'activityBar.inactiveForeground': ['#ffffff66', '#ffffff66'],
  'activityBar.activeBorder': ['@activityBar.foreground', '@activityBar.foreground'],
  'activityBar.border': ['transparent', 'transparent'],
  'activityBarBadge.background': ['#007acc', '#007acc'],
  'activityBarBadge.foreground': ['#ffffff', '#ffffff'],
  'sideBar.background': ['#252526', '#f3f3f3'],
  'sideBar.foreground': ['@foreground', '@foreground'],
  'sideBar.border': ['transparent', 'transparent'],
  'sideBarTitle.foreground': ['#bbbbbb', '#6f6f6f'],
  'sideBarSectionHeader.background': ['transparent', 'transparent'],
  'sideBarSectionHeader.foreground': ['@sideBar.foreground', '@sideBar.foreground'],
  'editorGroupHeader.tabsBackground': ['#252526', '#f3f3f3'],
  'editorGroupHeader.tabsBorder': ['transparent', 'transparent'],
  'editorGroup.border': ['#444444', '#e7e7e7'],
  'tab.activeBackground': ['@editor.background', '@editor.background'],
  'tab.activeForeground': ['#ffffff', '#333333'],
  'tab.inactiveBackground': ['#2d2d2d', '#ececec'],
  'tab.inactiveForeground': ['#ffffff80', '#33333380'],
  'tab.border': ['#252526', '#f3f3f3'],
  'tab.activeBorder': ['transparent', 'transparent'],
  'tab.activeBorderTop': ['transparent', 'transparent'],
  'tab.hoverBackground': ['transparent', 'transparent'],
  'statusBar.background': ['#007acc', '#007acc'],
  'statusBar.foreground': ['#ffffff', '#ffffff'],
  'statusBar.border': ['transparent', 'transparent'],
  'statusBar.noFolderBackground': ['#68217a', '#68217a'],
  'statusBarItem.hoverBackground': ['#ffffff1f', '#ffffff1f'],
  'panel.background': ['@editor.background', '@editor.background'],
  'panel.border': ['#80808059', '#80808059'],
  'panelTitle.activeForeground': ['#e7e7e7', '#424242'],
  'panelTitle.inactiveForeground': ['#e7e7e799', '#424242bf'],
  'panelTitle.activeBorder': ['@panelTitle.activeForeground', '@panelTitle.activeForeground'],
  'list.activeSelectionBackground': ['#04395e', '#0060c0'],
  'list.activeSelectionForeground': ['#ffffff', '#ffffff'],
  'list.inactiveSelectionBackground': ['#37373d', '#e4e6f1'],
  'list.hoverBackground': ['#2a2d2e', '#f0f0f0'],
  'list.highlightForeground': ['#2aaaff', '#0066bf'],
  'list.focusOutline': ['@focusBorder', '@focusBorder'],
  'input.background': ['#3c3c3c', '#ffffff'],
  'input.foreground': ['@foreground', '@foreground'],
  'input.border': ['transparent', '#cecece'],
  'input.placeholderForeground': ['#a6a6a6', '#767676'],
  'quickInput.background': ['@editorWidget.background', '@editorWidget.background'],
  'quickInput.foreground': ['@foreground', '@foreground'],
  'quickInputList.focusBackground': ['@list.activeSelectionBackground', '@list.activeSelectionBackground'],
  'quickInputList.focusForeground': ['@list.activeSelectionForeground', '@list.activeSelectionForeground'],
  'pickerGroup.foreground': ['#3794ff', '#0066bf'],
  'pickerGroup.border': ['#3f3f46', '#cccedb'],
  'editorWidget.background': ['#252526', '#f3f3f3'],
  'editorWidget.border': ['#454545', '#c8c8c8'],
  'button.background': ['#0e639c', '#007acc'],
  'button.foreground': ['#ffffff', '#ffffff'],
  'button.hoverBackground': ['#1177bb', '#0062a3'],
  'badge.background': ['#4d4d4d', '#c4c4c4'],
  'badge.foreground': ['#ffffff', '#333333'],
  'scrollbarSlider.background': ['#79797966', '#64646466'],
  'editorError.foreground': ['#f14c4c', '#e51400'],
  'editorWarning.foreground': ['#cca700', '#bf8803'],
  'editorInfo.foreground': ['#3794ff', '#1a85ff'],
  'editor.findMatchHighlightBackground': ['#ea5c0055', '#ea5c0055'],
  'inputOption.activeBackground': ['#2489db82', '#bed6ed'],
  'inputOption.activeBorder': ['#007acc', '#007acc'],
  'inputOption.activeForeground': ['#ffffff', '#000000'],
  'diffEditor.insertedTextBackground': ['#9ccc2c33', '#9ccc2c40'],
  'diffEditor.removedTextBackground': ['#ff000033', '#ff000033'],
  'gitDecoration.untrackedResourceForeground': ['#73c991', '#007100'],
  'terminal.background': ['@panel.background', '@panel.background'],
  'terminal.foreground': ['#cccccc', '#333333'],
  'terminalCursor.foreground': ['@terminal.foreground', '@terminal.foreground'],
  'terminal.selectionBackground': ['#264f78', '#add6ff'],
  'terminal.ansiBlack': ['#000000', '#000000'],
  'terminal.ansiRed': ['#cd3131', '#cd3131'],
  'terminal.ansiGreen': ['#0dbc79', '#00bc00'],
  'terminal.ansiYellow': ['#e5e510', '#949800'],
  'terminal.ansiBlue': ['#2472c8', '#0451a5'],
  'terminal.ansiMagenta': ['#bc3fbc', '#bc05bc'],
  'terminal.ansiCyan': ['#11a8cd', '#0598bc'],
  'terminal.ansiWhite': ['#e5e5e5', '#555555'],
  'terminal.ansiBrightBlack': ['#666666', '#666666'],
  'terminal.ansiBrightRed': ['#f14c4c', '#cd3131'],
  'terminal.ansiBrightGreen': ['#23d18b', '#14ce14'],
  'terminal.ansiBrightYellow': ['#f5f543', '#b5ba00'],
  'terminal.ansiBrightBlue': ['#3b8eea', '#0451a5'],
  'terminal.ansiBrightMagenta': ['#d670d6', '#bc05bc'],
  'terminal.ansiBrightCyan': ['#29b8db', '#0598bc'],
  'terminal.ansiBrightWhite': ['#e5e5e5', '#a5a5a5'],
};

export type WorkbenchColors = Record<string, string>;

/** Resolve todas as chaves usadas pela interface. */
export function workbenchColors(theme: VsTheme, kind: ThemeKind): WorkbenchColors {
  const own = theme.colors ?? {};
  const light = kind === 'light' || kind === 'hc-light';
  const resolved: WorkbenchColors = {};
  const resolve = (key: string, depth = 0): string => {
    if (resolved[key]) return resolved[key];
    const value = own[key] ?? DEFAULTS[key]?.[light ? 1 : 0] ?? 'transparent';
    const color = value.startsWith('@') && depth < 8 ? resolve(value.slice(1), depth + 1) : value;
    resolved[key] = color;
    return color;
  };
  for (const key of Object.keys(DEFAULTS)) resolve(key);
  return resolved;
}

/** Variáveis CSS: "sideBar.background" vira "--vsc-sideBar-background". */
export function cssVariables(colors: WorkbenchColors) {
  return Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--vsc-${key.replace(/\./g, '-')}`, value]));
}

export function xtermTheme(colors: WorkbenchColors): ITheme {
  const c = (key: string) => colors[key];
  return {
    background: c('terminal.background'),
    foreground: c('terminal.foreground'),
    cursor: c('terminalCursor.foreground'),
    selectionBackground: c('terminal.selectionBackground'),
    black: c('terminal.ansiBlack'),
    red: c('terminal.ansiRed'),
    green: c('terminal.ansiGreen'),
    yellow: c('terminal.ansiYellow'),
    blue: c('terminal.ansiBlue'),
    magenta: c('terminal.ansiMagenta'),
    cyan: c('terminal.ansiCyan'),
    white: c('terminal.ansiWhite'),
    brightBlack: c('terminal.ansiBrightBlack'),
    brightRed: c('terminal.ansiBrightRed'),
    brightGreen: c('terminal.ansiBrightGreen'),
    brightYellow: c('terminal.ansiBrightYellow'),
    brightBlue: c('terminal.ansiBrightBlue'),
    brightMagenta: c('terminal.ansiBrightMagenta'),
    brightCyan: c('terminal.ansiBrightCyan'),
    brightWhite: c('terminal.ansiBrightWhite'),
  };
}

// Tema da casa, no formato do VS Code: a obsidiana com o veio verde-água.
export const FLINTPAD_THEME: VsTheme = {
  name: 'Flintpad',
  type: 'dark',
  colors: {
    foreground: '#aeb8c7',
    descriptionForeground: '#7f8a9b',
    focusBorder: '#4fbfb4',
    'editor.background': '#0a0d13',
    'editor.foreground': '#e7ecf3',
    'editorLineNumber.foreground': '#2d3648',
    'editorLineNumber.activeForeground': '#aeb8c7',
    'editor.lineHighlightBackground': '#10141c',
    'editor.selectionBackground': '#4fbfb455',
    'editorCursor.foreground': '#4fbfb4',
    'editorWidget.background': '#10141c',
    'editorWidget.border': '#202736',
    'editorSuggestWidget.background': '#10141c',
    'activityBar.background': '#05070b',
    'activityBar.foreground': '#e7ecf3',
    'activityBar.inactiveForeground': '#7f8a9b',
    'activityBar.activeBorder': '#4fbfb4',
    'activityBarBadge.background': '#0c6c64',
    'sideBar.background': '#0a0d13',
    'sideBar.border': '#171c27',
    'sideBarTitle.foreground': '#7f8a9b',
    'editorGroupHeader.tabsBackground': '#05070b',
    'editorGroup.border': '#171c27',
    'tab.activeBackground': '#0a0d13',
    'tab.activeForeground': '#e7ecf3',
    'tab.inactiveBackground': '#05070b',
    'tab.inactiveForeground': '#7f8a9b',
    'tab.border': '#05070b',
    'tab.activeBorderTop': '#4fbfb4',
    'statusBar.background': '#05070b',
    'statusBar.foreground': '#aeb8c7',
    'statusBar.border': '#171c27',
    'statusBar.noFolderBackground': '#05070b',
    'panel.background': '#0a0d13',
    'panel.border': '#171c27',
    'panelTitle.activeBorder': '#4fbfb4',
    'panelTitle.activeForeground': '#e7ecf3',
    'list.activeSelectionBackground': '#0c6c6466',
    'list.activeSelectionForeground': '#e7ecf3',
    'list.inactiveSelectionBackground': '#171c27',
    'list.hoverBackground': '#10141c',
    'list.highlightForeground': '#86d9cd',
    'input.background': '#05070b',
    'input.border': '#202736',
    'input.placeholderForeground': '#7f8a9b',
    'quickInput.background': '#10141c',
    'pickerGroup.foreground': '#86d9cd',
    'pickerGroup.border': '#202736',
    'button.background': '#0c6c64',
    'button.hoverBackground': '#0f8178',
    'badge.background': '#202736',
    'terminal.background': '#0a0d13',
    'terminal.foreground': '#e7ecf3',
    'terminalCursor.foreground': '#4fbfb4',
    'terminal.selectionBackground': '#4fbfb455',
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#7f8a9b', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type', 'keyword.control'], settings: { foreground: '#86d9cd' } },
    { scope: ['keyword.operator', 'punctuation'], settings: { foreground: '#aeb8c7' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#e6c07b' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character'], settings: { foreground: '#c8a6f2' } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'], settings: { foreground: '#8fb4ff' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: '#9fd3ff' } },
    { scope: ['variable', 'meta.definition.variable'], settings: { foreground: '#e7ecf3' } },
    { scope: ['variable.parameter'], settings: { foreground: '#f0c3a8' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#86d9cd' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#c8a6f2' } },
    { scope: ['support.type.property-name', 'meta.object-literal.key'], settings: { foreground: '#9fd3ff' } },
    { scope: ['markup.heading', 'entity.name.section'], settings: { foreground: '#86d9cd', fontStyle: 'bold' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.inline.raw', 'markup.fenced_code'], settings: { foreground: '#e6c07b' } },
    { scope: ['invalid'], settings: { foreground: '#f0908d' } },
  ],
};
