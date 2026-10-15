// Realce de sintaxe do jeito do VS Code: gramáticas TextMate das extensões, rodando no Oniguruma.
// O Monaco sozinho usa gramáticas Monarch próprias; aqui elas são trocadas pelas mesmas do VS Code.
import * as monaco from 'monaco-editor';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { INITIAL, parseRawGrammar, Registry, type IGrammar, type IOnigLib, type IRawTheme, type StateStack } from 'vscode-textmate';

import { filePattern, matchesFilePattern, type FilePattern } from './codeTools';
import { baseName, extName } from './paths';
import type { TokenColor, VsExtension, VsGrammarRef, VsLanguageRef, VsTheme } from './vscode';

// Layout dos metadados de token (igual no vscode-textmate e no Monaco).
const TOKEN_TYPE = (meta: number) => (meta >>> 8) & 0b11;
const FONT_STYLE = (meta: number) => (meta >>> 11) & 0b1111;
const FOREGROUND = (meta: number) => (meta >>> 15) & 0b1_1111_1111;
const TOKEN_TYPE_NAME = ['', '.comment', '.string', '.regex'];
// Linhas muito longas (minificados) não são tokenizadas, como no VS Code (editor.maxTokenizationLineLength).
const MAX_LINE_LENGTH = 20000;
const TOKENIZE_TIME_LIMIT_MS = 500;

let onig: Promise<IOnigLib> | null = null;

function onigLib() {
  onig ??= window.api.tmWasm().then(async (bytes) => {
    await loadWASM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    return { createOnigScanner: (sources: string[]) => createOnigScanner(sources), createOnigString: (text: string) => createOnigString(text) };
  });
  return onig;
}

// ---------- Linguagens: qual linguagem é cada arquivo ----------

type LanguageIndex = {
  byFilename: Map<string, string>;
  byPattern: [FilePattern, string][];
  byExtension: Map<string, string>;
  byFirstLine: [RegExp, string][];
};

let index: LanguageIndex = { byFilename: new Map(), byPattern: [], byExtension: new Map(), byFirstLine: [] };
const builtinLanguages = new Set(monaco.languages.getLanguages().map((language) => language.id));

const toRegExp = (source: string | { pattern: string; flags?: string } | undefined) => {
  if (!source) return undefined;
  try {
    return typeof source === 'string' ? new RegExp(source) : new RegExp(source.pattern, source.flags);
  } catch {
    return undefined; // padrão Oniguruma sem equivalente em JavaScript
  }
};

/** Linguagem de um arquivo pelas regras do VS Code: nome exato, padrão, extensão mais longa, primeira linha. */
export function languageForFile(path: string, firstLine?: string): string | undefined {
  const name = baseName(path).toLowerCase();
  const byName = index.byFilename.get(name);
  if (byName) return byName;
  for (const [pattern, id] of index.byPattern) if (matchesFilePattern(pattern, path)) return id;
  // "a.d.ts" tenta ".d.ts" antes de ".ts".
  for (let dot = name.indexOf('.'); dot >= 0; dot = name.indexOf('.', dot + 1)) {
    const id = index.byExtension.get(name.slice(dot));
    if (id) return id;
  }
  if (firstLine) for (const [pattern, id] of index.byFirstLine) if (pattern.test(firstLine)) return id;
  return undefined;
}

type LanguageConfigJson = {
  comments?: { lineComment?: string; blockComment?: [string, string] };
  brackets?: [string, string][];
  autoClosingPairs?: ([string, string] | { open: string; close: string; notIn?: string[] })[];
  surroundingPairs?: ([string, string] | { open: string; close: string })[];
  autoCloseBefore?: string;
  folding?: { offSide?: boolean; markers?: { start: string | { pattern: string }; end: string | { pattern: string } } };
  wordPattern?: string | { pattern: string; flags?: string };
  indentationRules?: Record<string, string | { pattern: string; flags?: string }>;
  onEnterRules?: {
    beforeText: string | { pattern: string; flags?: string };
    afterText?: string | { pattern: string; flags?: string };
    previousLineText?: string | { pattern: string; flags?: string };
    action: { indent: 'none' | 'indent' | 'indentOutdent' | 'outdent'; appendText?: string; removeText?: number };
  }[];
};

const INDENT_ACTION = {
  none: monaco.languages.IndentAction.None,
  indent: monaco.languages.IndentAction.Indent,
  indentOutdent: monaco.languages.IndentAction.IndentOutdent,
  outdent: monaco.languages.IndentAction.Outdent,
};

function toLanguageConfiguration(json: LanguageConfigJson): monaco.languages.LanguageConfiguration {
  const pair = (entry: [string, string] | { open: string; close: string; notIn?: string[] }) =>
    Array.isArray(entry) ? { open: entry[0], close: entry[1] } : { open: entry.open, close: entry.close, notIn: entry.notIn };
  const markers = json.folding?.markers;
  const start = toRegExp(markers?.start);
  const end = toRegExp(markers?.end);
  const rules = json.indentationRules;
  const increase = toRegExp(rules?.increaseIndentPattern);
  const decrease = toRegExp(rules?.decreaseIndentPattern);
  return {
    comments: json.comments,
    brackets: json.brackets,
    autoClosingPairs: json.autoClosingPairs?.map(pair),
    surroundingPairs: json.surroundingPairs?.map(pair),
    autoCloseBefore: json.autoCloseBefore,
    folding: json.folding ? { offSide: json.folding.offSide, markers: start && end ? { start, end } : undefined } : undefined,
    wordPattern: toRegExp(json.wordPattern),
    indentationRules:
      increase && decrease
        ? { increaseIndentPattern: increase, decreaseIndentPattern: decrease, indentNextLinePattern: toRegExp(rules?.indentNextLinePattern), unIndentedLinePattern: toRegExp(rules?.unIndentedLinePattern) }
        : undefined,
    onEnterRules: json.onEnterRules
      ?.map((rule) => ({
        beforeText: toRegExp(rule.beforeText)!,
        afterText: toRegExp(rule.afterText),
        previousLineText: toRegExp(rule.previousLineText),
        action: { indentAction: INDENT_ACTION[rule.action.indent] ?? monaco.languages.IndentAction.None, appendText: rule.action.appendText, removeText: rule.action.removeText },
      }))
      .filter((rule) => rule.beforeText),
  };
}

// ---------- Gramáticas ----------

let grammarsByScope = new Map<string, VsGrammarRef>();
let grammarByLanguage = new Map<string, VsGrammarRef>();
let languageNumbers = new Map<string, number>();
let registry: Registry | null = null;
let currentTheme: IRawTheme = { settings: [] };
const providers = new Map<string, monaco.IDisposable>();
const loadedGrammars = new Map<string, Promise<IGrammar | null>>();

function createRegistry() {
  registry = new Registry({
    onigLib: onigLib(),
    theme: currentTheme,
    loadGrammar: async (scopeName) => {
      const ref = grammarsByScope.get(scopeName);
      if (!ref) return null;
      return parseRawGrammar(await window.api.extReadText(ref.path), ref.path);
    },
    getInjections: (scopeName) => [...grammarsByScope.values()].filter((ref) => ref.injectTo.includes(scopeName)).map((ref) => ref.scopeName),
  });
  loadedGrammars.clear();
}

const STANDARD_TOKEN_TYPES: Record<string, number> = { other: 0, comment: 1, string: 2, regex: 3 };

function loadGrammar(languageId: string) {
  const ref = grammarByLanguage.get(languageId);
  if (!ref || !registry) return Promise.resolve(null);
  let pending = loadedGrammars.get(languageId);
  if (!pending) {
    const embedded: Record<string, number> = {};
    for (const [scope, language] of Object.entries(ref.embeddedLanguages)) embedded[scope] = languageNumbers.get(language) ?? 0;
    const tokenTypes: Record<string, number> = {};
    for (const [scope, type] of Object.entries(ref.tokenTypes)) tokenTypes[scope] = STANDARD_TOKEN_TYPES[type] ?? 0;
    pending = registry
      .loadGrammarWithConfiguration(ref.scopeName, languageNumbers.get(languageId) ?? 1, {
        embeddedLanguages: embedded,
        tokenTypes,
        balancedBracketSelectors: ref.balancedBracketScopes ?? ['*'],
        unbalancedBracketSelectors: ref.unbalancedBracketScopes ?? [],
      })
      .catch((error) => {
        console.warn('[textmate]', ref.scopeName, error);
        return null;
      });
    loadedGrammars.set(languageId, pending);
  }
  return pending;
}

class TokenState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new TokenState(this.stack);
  }
  equals(other: monaco.languages.IState) {
    return other instanceof TokenState && other.stack.equals(this.stack);
  }
}

// Cada token vira "f<cor>s<estilo>[.string|.comment|.regex]": a cor é o índice no mapa de cores do tema,
// e o sufixo deixa o Monaco saber o que é string ou comentário (auto-fechamento de aspas, por exemplo).
function tokensProvider(grammar: IGrammar): monaco.languages.TokensProvider {
  return {
    getInitialState: () => new TokenState(INITIAL),
    tokenize(line, state) {
      const stack = (state as TokenState).stack;
      if (line.length > MAX_LINE_LENGTH) return { tokens: [{ startIndex: 0, scopes: 'f1s0' }], endState: state };
      const result = grammar.tokenizeLine2(line, stack, TOKENIZE_TIME_LIMIT_MS);
      const tokens: monaco.languages.IToken[] = [];
      for (let i = 0; i < result.tokens.length; i += 2) {
        const meta = result.tokens[i + 1];
        tokens.push({ startIndex: result.tokens[i], scopes: `f${FOREGROUND(meta)}s${FONT_STYLE(meta)}${TOKEN_TYPE_NAME[TOKEN_TYPE(meta)]}` });
      }
      return { tokens, endState: new TokenState(result.ruleStack) };
    },
  };
}

const plainProvider: monaco.languages.TokensProvider = {
  getInitialState: () => new TokenState(INITIAL),
  tokenize: (_line, state) => ({ tokens: [], endState: state }),
};

// Dois registros: a fábrica (promessa) toma o lugar da fábrica Monarch antes de a linguagem aparecer;
// o registro direto vale na hora para linguagens já em uso. Registrar de novo retokeniza os arquivos abertos.
function registerProvider(languageId: string) {
  providers.get(languageId)?.dispose();
  const disposables: monaco.IDisposable[] = [];
  let disposed = false;
  const ready = loadGrammar(languageId).then((loaded) => (loaded ? tokensProvider(loaded) : null));
  disposables.push(monaco.languages.setTokensProvider(languageId, ready.then((provider) => provider ?? plainProvider)));
  void ready.then((provider) => {
    if (provider && !disposed) disposables.push(monaco.languages.setTokensProvider(languageId, provider));
  });
  providers.set(languageId, {
    dispose() {
      disposed = true;
      disposables.forEach((disposable) => disposable.dispose());
    },
  });
}

/**
 * Registra linguagens, configurações e gramáticas de todas as extensões.
 * Chamar antes de criar os primeiros modelos: o provedor TextMate precisa chegar antes do Monarch.
 */
export async function installExtensions(extensions: VsExtension[]) {
  const languages = new Map<string, VsLanguageRef[]>();
  const nextIndex: LanguageIndex = { byFilename: new Map(), byPattern: [], byExtension: new Map(), byFirstLine: [] };
  for (const extension of extensions) {
    for (const language of extension.languages) {
      languages.set(language.id, [...(languages.get(language.id) ?? []), language]);
      for (const name of language.filenames) nextIndex.byFilename.set(name.toLowerCase(), language.id);
      for (const pattern of language.filenamePatterns) nextIndex.byPattern.push([filePattern(pattern), language.id]);
      for (const ext of language.extensions) nextIndex.byExtension.set(ext.toLowerCase(), language.id);
      const firstLine = toRegExp(language.firstLine);
      if (firstLine) nextIndex.byFirstLine.push([firstLine, language.id]);
    }
  }
  index = nextIndex;

  languageNumbers = new Map();
  for (const id of [...builtinLanguages, ...languages.keys()]) if (!languageNumbers.has(id)) languageNumbers.set(id, languageNumbers.size + 1);

  for (const [id, contributions] of languages) {
    if (!monaco.languages.getLanguages().some((language) => language.id === id)) {
      const aliases = contributions.flatMap((c) => c.aliases);
      monaco.languages.register({ id, aliases: aliases.length ? aliases : undefined });
    }
    // Linguagens que o Monaco já conhece mantêm a configuração dele (testada com os workers internos).
    const configuration = contributions.find((c) => c.configuration)?.configuration;
    if (configuration && !builtinLanguages.has(id)) {
      void window.api.extReadJsonc<LanguageConfigJson>(configuration).then(
        (json) => json && monaco.languages.setLanguageConfiguration(id, toLanguageConfiguration(json)),
        () => {},
      );
    }
  }

  grammarsByScope = new Map();
  grammarByLanguage = new Map();
  for (const extension of extensions) {
    for (const grammar of extension.grammars) {
      grammarsByScope.set(grammar.scopeName, grammar);
      if (grammar.language) grammarByLanguage.set(grammar.language, grammar);
    }
  }
  // O realce de JSON embutido no Monaco registraria um tokenizador próprio por cima do TextMate.
  if (grammarByLanguage.has('json')) monaco.json.jsonDefaults.setModeConfiguration({ ...monaco.json.jsonDefaults.modeConfiguration, tokens: false });

  createRegistry();
  for (const languageId of grammarByLanguage.keys()) {
    if (monaco.languages.getLanguages().some((language) => language.id === languageId)) registerProvider(languageId);
  }
}

export const hasGrammar = (languageId: string) => grammarByLanguage.has(languageId);

/** Linguagens conhecidas, para o seletor "Mudar o modo de linguagem". */
export function allLanguages() {
  return monaco.languages
    .getLanguages()
    .map((language) => ({ id: language.id, label: language.aliases?.[0] ?? language.id, extensions: language.extensions ?? [] }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------- Tema ----------

const normalizeColor = (color?: string) => {
  if (!color || !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return undefined;
  if (color.length === 4 || color.length === 5) return '#' + [...color.slice(1)].map((c) => c + c).join('');
  return color;
};

/** Tema de cores do VS Code convertido para o registro TextMate (as "settings" sem escopo são o padrão). */
function toRawTheme(theme: VsTheme): IRawTheme {
  const colors = theme.colors ?? {};
  const settings: TokenColor[] = [
    { settings: { foreground: normalizeColor(colors['editor.foreground']) ?? normalizeColor(colors.foreground), background: normalizeColor(colors['editor.background']) } },
    ...(theme.tokenColors ?? []).map((rule) => ({ ...rule, settings: { ...rule.settings, foreground: normalizeColor(rule.settings?.foreground), background: normalizeColor(rule.settings?.background) } })),
  ];
  return { name: theme.name, settings } as IRawTheme;
}

const FONT_STYLE_NAMES: [number, string][] = [
  [1, 'italic'],
  [2, 'bold'],
  [4, 'underline'],
  [8, 'strikethrough'],
];

/**
 * Aplica o tema ao realce TextMate e devolve as regras de token para o tema do Monaco.
 * As regras cobrem cada cor do mapa combinada com cada estilo de fonte.
 */
export function applyTokenTheme(theme: VsTheme): monaco.editor.ITokenThemeRule[] {
  currentTheme = toRawTheme(theme);
  if (!registry) createRegistry();
  registry!.setTheme(currentTheme);
  const colorMap = registry!.getColorMap();
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (let color = 1; color < colorMap.length; color++) {
    const foreground = colorMap[color]?.replace('#', '');
    for (let style = 0; style < 16; style++) {
      const fontStyle = FONT_STYLE_NAMES.filter(([bit]) => style & bit)
        .map(([, name]) => name)
        .join(' ');
      rules.push({ token: `f${color}s${style}`, foreground, fontStyle });
    }
  }
  // O estado de cada linha depende do tema: as gramáticas são recarregadas e os arquivos, retokenizados.
  loadedGrammars.clear();
  for (const languageId of providers.keys()) registerProvider(languageId);
  return rules;
}

export const fileLanguage = (path: string, content: string) => languageForFile(path, content.split('\n', 1)[0].slice(0, 300)) ?? languageFromMonaco(path);

// Sem extensão do VS Code instalada, quem decide é o próprio Monaco.
function languageFromMonaco(path: string) {
  const ext = extName(path);
  const name = baseName(path).toLowerCase();
  const found = monaco.languages.getLanguages().find((language) => language.filenames?.some((f) => f.toLowerCase() === name) || (ext && language.extensions?.some((e) => e.toLowerCase() === ext)));
  return found?.id ?? 'plaintext';
}
