// Validação de scripts SQL na aba Código: só sintaxe, pelo analisador do node-sql-parser no dialeto escolhido.
// O script é quebrado em comandos (";" e, no SQL Server, linhas "GO") para apontar um erro por comando,
// e não só o primeiro do arquivo.

export const SQL_DIALECTS = [
  ['mysql', 'MySQL'],
  ['mariadb', 'MariaDB'],
  ['postgresql', 'PostgreSQL'],
  ['transactsql', 'SQL Server (T-SQL)'],
  ['sqlite', 'SQLite'],
  ['bigquery', 'BigQuery'],
  ['snowflake', 'Snowflake'],
  ['redshift', 'Redshift'],
  ['db2', 'Db2'],
  ['hive', 'Hive'],
  ['trino', 'Trino'],
  ['athena', 'Athena'],
] as const;

export type SqlDialect = (typeof SQL_DIALECTS)[number][0];

export const isSqlDialect = (value: unknown): value is SqlDialect => SQL_DIALECTS.some(([id]) => id === value);
export const dialectLabel = (dialect: SqlDialect) => SQL_DIALECTS.find(([id]) => id === dialect)?.[1] ?? dialect;

export type SqlStatement = { text: string; offset: number };

// Abertura de texto com cifrão do PostgreSQL: "$$" ou "$tag$" (a etiqueta não começa com dígito, então "$1" fica de fora).
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Quebra o script em comandos, ignorando ";" dentro de textos, identificadores entre aspas e comentários. */
export function splitStatements(source: string, dialect: SqlDialect): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number, next: number) => {
    const text = source.slice(start, end);
    if (hasCode(text, dialect === 'mysql' || dialect === 'mariadb')) statements.push({ text, offset: start });
    start = next;
  };
  while (i < source.length) {
    const char = source[i];
    const pair = source.slice(i, i + 2);
    if (pair === '--' || (char === '#' && (dialect === 'mysql' || dialect === 'mariadb'))) {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (pair === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === "'" || char === '"' || char === '`' || (char === '[' && dialect === 'transactsql')) {
      const close = char === '[' ? ']' : char;
      i++;
      while (i < source.length) {
        if (source[i] === '\\' && char !== '[' && (dialect === 'mysql' || dialect === 'mariadb')) i += 2;
        else if (source[i] === close && source[i + 1] === close) i += 2;
        else if (source[i] === close) break;
        else i++;
      }
      i++;
    } else if (char === '$' && (dialect === 'postgresql' || dialect === 'redshift') && DOLLAR_TAG.test(source.slice(i, i + 66))) {
      // Corpo de função em $$ ... $$ ou $tag$ ... $tag$: os ";" de dentro são do corpo.
      const tag = DOLLAR_TAG.exec(source.slice(i, i + 66))![0];
      const end = source.indexOf(tag, i + tag.length);
      i = end < 0 ? source.length : end + tag.length;
    } else if (char === ';') {
      push(i, i + 1);
      i++;
    } else if (dialect === 'transactsql' && (i === 0 || source[i - 1] === '\n') && /^[ \t]*go[ \t]*(\r?\n|$)/i.test(source.slice(i, i + 12))) {
      // "GO" sozinho na linha separa lotes no SQL Server; não é SQL.
      const lineEnd = source.indexOf('\n', i);
      push(i, lineEnd < 0 ? source.length : lineEnd + 1);
      i = lineEnd < 0 ? source.length : lineEnd + 1;
    } else i++;
  }
  push(source.length, source.length);
  return statements;
}

// Só comentários e espaços não formam um comando.
function hasCode(text: string, hashComments: boolean): boolean {
  const code = text.replace(/--[^\n]*|\/\*[\s\S]*?(\*\/|$)/g, '');
  // No MySQL/MariaDB "#" também abre comentário de linha.
  return /\S/.test(hashComments ? code.replace(/#[^\n]*/g, '') : code);
}

export type SqlProblem = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** O que o analisador encontrou no lugar ("fim do texto" quando acabou antes da hora). */
  found: string | null;
  /** Algumas das palavras que caberiam ali, para orientar a correção. */
  expected: string[];
  message: string;
};

type PegError = { message: string; found?: string | null; expected?: { type: string; text?: string; description?: string }[]; location?: { start: { offset: number }; end: { offset: number } } };
type ParserLike = { astify(sql: string, options?: { database?: string }): unknown };

const EXPECTED_SHOWN = 6;

/** Analisa cada comando e devolve os erros de sintaxe com a posição no arquivo (linhas e colunas a partir de 1). */
export function lintSql(source: string, dialect: SqlDialect, parser: ParserLike): SqlProblem[] {
  const problems: SqlProblem[] = [];
  for (const statement of splitStatements(source, dialect)) {
    try {
      parser.astify(statement.text, { database: dialect });
    } catch (raw) {
      const error = raw as PegError;
      const start = statement.offset + (error.location?.start.offset ?? leadingSpace(statement.text));
      const end = Math.max(start + 1, statement.offset + (error.location?.end.offset ?? statement.text.length));
      const from = position(source, Math.min(start, source.length));
      const to = position(source, Math.min(end, source.length));
      // Palavras-chave primeiro: "SELECT" orienta mais que um símbolo solto.
      const expected = [...new Set((error.expected ?? []).filter((item) => item.type === 'literal' && item.text).map((item) => item.text!.toUpperCase()))]
        .sort((a, b) => Number(/^[A-Z_]{2,}$/.test(b)) - Number(/^[A-Z_]{2,}$/.test(a)))
        .slice(0, EXPECTED_SHOWN);
      problems.push({ line: from.line, column: from.column, endLine: to.line, endColumn: to.column, found: error.found ?? null, expected, message: error.message });
    }
  }
  return problems;
}

const leadingSpace = (text: string) => text.length - text.trimStart().length;

function position(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

// Um analisador por dialeto, carregado só quando um .sql é validado (cada um tem centenas de KB).
const loaders: Record<SqlDialect, () => Promise<unknown>> = {
  mysql: () => import('node-sql-parser/build/mysql.js'),
  mariadb: () => import('node-sql-parser/build/mariadb.js'),
  postgresql: () => import('node-sql-parser/build/postgresql.js'),
  transactsql: () => import('node-sql-parser/build/transactsql.js'),
  sqlite: () => import('node-sql-parser/build/sqlite.js'),
  bigquery: () => import('node-sql-parser/build/bigquery.js'),
  snowflake: () => import('node-sql-parser/build/snowflake.js'),
  redshift: () => import('node-sql-parser/build/redshift.js'),
  db2: () => import('node-sql-parser/build/db2.js'),
  hive: () => import('node-sql-parser/build/hive.js'),
  trino: () => import('node-sql-parser/build/trino.js'),
  athena: () => import('node-sql-parser/build/athena.js'),
};
const parsers = new Map<SqlDialect, Promise<ParserLike>>();

export function loadSqlParser(dialect: SqlDialect): Promise<ParserLike> {
  let parser = parsers.get(dialect);
  if (!parser) {
    parser = loaders[dialect]().then((mod) => {
      const exports = mod as { Parser?: new () => ParserLike; default?: { Parser: new () => ParserLike } };
      const Parser = exports.Parser ?? exports.default!.Parser;
      return new Parser();
    });
    parsers.set(dialect, parser);
    parser.catch(() => parsers.delete(dialect));
  }
  return parser;
}
