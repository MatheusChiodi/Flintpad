// Tipos de searchCore.mjs para o renderer (TypeScript).

export type SearchOptions = { query: string; isRegex?: boolean; matchCase?: boolean; wholeWord?: boolean };
export type SearchMatch = { line: number; column: number; length: number; preview: string; previewStart: number; previewLength: number };

export declare const SEARCH_LIMITS: Readonly<{ maxResults: number; maxFileBytes: number; maxPreview: number; previewLead: number }>;
export declare function buildMatcher(options: SearchOptions): RegExp;
export declare function findMatches(text: string, matcher: RegExp, limit?: number): SearchMatch[];
export declare function replaceInText(text: string, matcher: RegExp, replacement: string, isRegex?: boolean): { text: string; count: number };
export declare function globMatcher(input: string): ((relPath: string) => boolean) | null;
export declare const TODO_TAGS: readonly string[];
export declare const TODO_QUERY: string;
export declare function parseTodo(preview: string): { tag: string; text: string } | null;
