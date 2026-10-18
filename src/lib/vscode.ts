// Ponte entre o formato das extensões do VS Code e o editor Monaco.
import type * as Monaco from 'monaco-editor';

export type VsThemeRef = { label: string; uiTheme: string; path: string };
export type VsSnippetRef = { language: string; path: string };

export type VsIconThemeRef = { id: string; label: string; path: string };
export type VsGrammarRef = {
  language?: string;
  scopeName: string;
  path: string;
  embeddedLanguages: Record<string, string>;
  tokenTypes: Record<string, string>;
  injectTo: string[];
  balancedBracketScopes?: string[];
  unbalancedBracketScopes?: string[];
};
export type VsLanguageRef = {
  id: string;
  aliases: string[];
  extensions: string[];
  filenames: string[];
  filenamePatterns: string[];
  firstLine?: string;
  mimetypes: string[];
  configuration?: string;
};
export type VsJsonValidation = { fileMatch: string[]; url: string };

export type VsExtension = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  folder: string;
  builtin: boolean;
  hasCode: boolean;
  activationEvents: string[];
  commands: number;
  grammars: VsGrammarRef[];
  languages: VsLanguageRef[];
  themes: VsThemeRef[];
  iconThemes: VsIconThemeRef[];
  snippets: VsSnippetRef[];
  jsonValidation: VsJsonValidation[];
};

export type TokenColor = { name?: string; scope?: string | string[]; settings?: { foreground?: string; background?: string; fontStyle?: string } };
export type VsTheme = { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: TokenColor[] };
export type VsSnippet = { prefix?: string | string[]; body?: string | string[]; description?: string };

// O Monaco colore com tokens próprios; os temas do VS Code falam em escopos TextMate.
// Cada escopo é traduzido para o token mais próximo; o que não tem par é ignorado.
const SCOPE_TO_TOKENS: [scope: string, tokens: string[]][] = [
  ['comment', ['comment']],
  ['string.regexp', ['regexp']],
  ['string', ['string']],
  ['constant.numeric', ['number']],
  ['constant.language', ['keyword.json', 'constant']],
  ['constant.character.escape', ['string.escape']],
  ['keyword.operator', ['operator', 'delimiter']],
  ['keyword', ['keyword']],
  ['storage', ['keyword']],
  ['entity.name.type', ['type', 'type.identifier']],
  ['entity.name.class', ['type', 'type.identifier']],
  ['support.type.property-name', ['string.key.json', 'attribute.name']],
  ['support.type', ['type']],
  ['support.class', ['type.identifier']],
  ['entity.name.function', ['function', 'identifier.function']],
  ['support.function', ['function']],
  ['entity.name.tag', ['tag', 'metatag']],
  ['entity.other.attribute-name', ['attribute.name']],
  ['variable', ['variable', 'variable.name']],
  ['punctuation', ['delimiter']],
  ['meta.tag', ['delimiter.html', 'delimiter.xml']],
  ['markup.heading', ['keyword.md']],
];

const hex = (color?: string) => (color && /^#[0-9a-f]{3,8}$/i.test(color) ? color.slice(1) : undefined);

export function toMonacoTheme(theme: VsTheme, uiTheme: string): Monaco.editor.IStandaloneThemeData {
  const rules: Monaco.editor.ITokenThemeRule[] = [];
  // Regras mais específicas vêm depois e vencem, então a ordem do tema é preservada.
  for (const entry of theme.tokenColors ?? []) {
    const foreground = hex(entry.settings?.foreground);
    const fontStyle = entry.settings?.fontStyle;
    if (!foreground && !fontStyle) continue;
    const scopes = (Array.isArray(entry.scope) ? entry.scope : (entry.scope ?? '').split(',')).map((scope) => scope.trim()).filter(Boolean);
    for (const scope of scopes) {
      // O prefixo mais específico (mais longo) vence: "support.type.property-name" não cai em "support.type".
      let match: (typeof SCOPE_TO_TOKENS)[number] | undefined;
      for (const entry of SCOPE_TO_TOKENS) {
        const [prefix] = entry;
        if ((scope === prefix || scope.startsWith(`${prefix}.`)) && (!match || prefix.length > match[0].length)) match = entry;
      }
      if (!match) continue;
      for (const token of match[1]) rules.push({ token, foreground, fontStyle });
    }
  }
  const colors = Object.fromEntries(Object.entries(theme.colors ?? {}).filter(([, value]) => typeof value === 'string' && value.startsWith('#')));
  // "hc-light" é o alto contraste claro; os outros "hc*" são o escuro.
  const base = uiTheme === 'vs' ? 'vs' : uiTheme === 'hc-light' ? 'hc-light' : uiTheme.startsWith('hc') ? 'hc-black' : 'vs-dark';
  return { base, inherit: true, rules, colors };
}


export type SnippetEntry = { label: string; body: string; description: string };

export function toSnippetEntries(snippets: Record<string, VsSnippet>): SnippetEntry[] {
  const entries: SnippetEntry[] = [];
  for (const [name, snippet] of Object.entries(snippets)) {
    if (!snippet?.prefix || snippet.body === undefined) continue;
    const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
    for (const prefix of Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix]) {
      entries.push({ label: prefix, body, description: snippet.description ?? name });
    }
  }
  return entries;
}
