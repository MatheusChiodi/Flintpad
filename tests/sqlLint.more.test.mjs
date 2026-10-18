// Casos extras da validação de SQL (src/lib/sqlLint.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dialectLabel, isSqlDialect, lintSql, loadSqlParser, splitStatements, SQL_DIALECTS } from '../src/lib/sqlLint.ts';

const texts = (sql, dialect) => splitStatements(sql, dialect).map((s) => s.text.trim());

// Analisador falso: lança o erro dado para o comando que contém `when`.
const fakeParser = (when, error) => {
  const calls = [];
  return {
    calls,
    astify(sql, options) {
      calls.push({ sql, options });
      if (sql.includes(when)) throw error;
      return {};
    },
  };
};

// ---------- dialetos ----------

test('SQL_DIALECTS: 12 dialetos com id único e rótulo', () => {
  assert.equal(SQL_DIALECTS.length, 12);
  assert.equal(new Set(SQL_DIALECTS.map(([id]) => id)).size, 12);
  for (const [id, label] of SQL_DIALECTS) assert.ok(id && label);
});

test('isSqlDialect só aceita os ids exatos', () => {
  assert.equal(isSqlDialect('postgresql'), true);
  assert.equal(isSqlDialect('transactsql'), true);
  assert.equal(isSqlDialect('MySQL'), false);
  assert.equal(isSqlDialect('oracle'), false);
  assert.equal(isSqlDialect(undefined), false);
  assert.equal(isSqlDialect(1), false);
});

test('dialectLabel devolve o rótulo legível', () => {
  assert.equal(dialectLabel('transactsql'), 'SQL Server (T-SQL)');
  assert.equal(dialectLabel('db2'), 'Db2');
  assert.equal(dialectLabel('naoexiste'), 'naoexiste');
});

// ---------- divisão em comandos ----------

test('splitStatements: offset aponta para o texto original de cada comando', () => {
  const sql = '  select 1;\n\nselect 2 ;select 3';
  for (const { text, offset } of splitStatements(sql, 'postgresql')) assert.equal(sql.slice(offset, offset + text.length), text);
  assert.deepEqual(texts(sql, 'postgresql'), ['select 1', 'select 2', 'select 3']);
});

test('splitStatements: vazio, só ";" e só comentários não geram comandos', () => {
  assert.deepEqual(splitStatements('', 'mysql'), []);
  assert.deepEqual(splitStatements(';;; \n ;', 'mysql'), []);
  assert.deepEqual(splitStatements('-- a\n/* b */\n', 'sqlite'), []);
  assert.deepEqual(splitStatements('/* nunca fecha; select 1', 'sqlite'), []);
});

test('splitStatements: aspas dobradas escapam dentro de texto e identificador', () => {
  assert.deepEqual(texts("select 'it''s; ok'; select 2", 'postgresql'), ["select 'it''s; ok'", 'select 2']);
  assert.deepEqual(texts('select "a"";b" from t; select 2', 'postgresql'), ['select "a"";b" from t', 'select 2']);
  assert.deepEqual(texts('select `a;b` from t; select 2', 'mysql'), ['select `a;b` from t', 'select 2']);
});

test('splitStatements: barra invertida escapa aspas só no MySQL/MariaDB', () => {
  assert.deepEqual(texts("select 'a\\';b'; select 2", 'mysql'), ["select 'a\\';b'", 'select 2']);
  assert.deepEqual(texts("select 'a\\';b'; select 2", 'mariadb'), ["select 'a\\';b'", 'select 2']);
  // no PostgreSQL a barra é literal: o texto termina em "a\"
  assert.deepEqual(texts("select 'a\\'; select 2", 'postgresql'), ["select 'a\\'", 'select 2']);
});

test('splitStatements: "#" é comentário só no MySQL/MariaDB', () => {
  assert.deepEqual(texts('select 1 # a;b\n;select 2', 'mysql'), ['select 1 # a;b', 'select 2']);
  assert.deepEqual(texts('select 1 # a;b', 'postgresql'), ['select 1 # a', 'b']);
});

test('splitStatements: "[" é identificador só no T-SQL', () => {
  assert.deepEqual(texts('select [a;b]', 'mysql'), ['select [a', 'b]']);
  assert.deepEqual(texts('select [a]]; b] from t; select 2', 'transactsql'), ['select [a]]; b] from t', 'select 2']);
});

test('splitStatements: texto não fechado engole o resto do arquivo', () => {
  assert.deepEqual(texts("select 'aberto; select 2", 'sqlite'), ["select 'aberto; select 2"]);
});

test('splitStatements: corpo $$ ... $$ no PostgreSQL e Redshift; outros dialetos dividem', () => {
  const fn = 'create function f() returns int as $$ begin; return 1; end; $$ language plpgsql; select 2';
  assert.equal(splitStatements(fn, 'postgresql').length, 2);
  assert.equal(splitStatements(fn, 'redshift').length, 2);
  assert.ok(splitStatements(fn, 'mysql').length > 2);
});

test('splitStatements: corpo com etiqueta $tag$ ... $tag$ também protege os ";"', { todo: 'BUG: sqlLint.ts:56 — só "$$" é reconhecido; "$body$ ...; $body$" é quebrado no meio da função' }, () => {
  assert.deepEqual(texts('select $tag$ a;b $tag$; select 2', 'postgresql'), ['select $tag$ a;b $tag$', 'select 2']);
});

test('splitStatements: comentário só com "#" no fim não vira comando (MySQL)', { todo: 'BUG: sqlLint.ts:75-77 — hasCode só remove "--" e "/* */"; "# fim" sozinho conta como comando' }, () => {
  assert.deepEqual(texts('select 1;\n# fim\n', 'mysql'), ['select 1']);
});

test('splitStatements: GO sem caixa, com \\r\\n, só no T-SQL e não dentro de texto', () => {
  assert.deepEqual(texts('select 1\r\nGo\r\nselect 2', 'transactsql'), ['select 1', 'select 2']);
  assert.deepEqual(texts('select 1\nGO\nselect 2', 'mysql'), ['select 1\nGO\nselect 2']);
  assert.deepEqual(texts("select '\nGO\n'", 'transactsql'), ["select '\nGO\n'"]);
  assert.deepEqual(texts('select 1\nGO', 'transactsql'), ['select 1']);
  assert.deepEqual(texts('GO\nselect 1', 'transactsql'), ['select 1']);
});

// ---------- lintSql com analisador falso ----------

test('lintSql: posição do erro convertida para linha/coluna do arquivo e dialeto repassado', () => {
  const parser = fakeParser('ruim', { message: 'Erro', found: 'ruim', expected: [], location: { start: { offset: 8 }, end: { offset: 12 } } });
  // o comando é "\nselect ruim" (começa logo depois do ";"): "ruim" está no offset 8 dele
  const problems = lintSql('select 1;\nselect ruim;', 'sqlite', parser);
  assert.deepEqual(problems, [{ line: 2, column: 8, endLine: 2, endColumn: 12, found: 'ruim', expected: [], message: 'Erro' }]);
  assert.deepEqual(parser.calls.map((c) => c.options), [{ database: 'sqlite' }, { database: 'sqlite' }]);
  assert.deepEqual(parser.calls.map((c) => c.sql), ['select 1', '\nselect ruim']);
});

test('lintSql: sem localização, o erro cobre o comando a partir do primeiro caractere não vazio', () => {
  const parser = fakeParser('x', { message: 'm' });
  const [problem] = lintSql('select 1;\n\n  x y', 'mysql', parser);
  assert.deepEqual([problem.line, problem.column, problem.endLine, problem.endColumn], [3, 3, 3, 6]);
  assert.equal(problem.found, null);
  assert.deepEqual(problem.expected, []);
});

test('lintSql: intervalo vazio ganha ao menos um caractere', () => {
  const parser = fakeParser('a', { message: 'm', location: { start: { offset: 2 }, end: { offset: 2 } } });
  const [problem] = lintSql('a b c', 'mysql', parser);
  assert.deepEqual([problem.column, problem.endColumn], [3, 4]);
});

test('lintSql: esperado só com literais, sem repetição, em maiúsculas, palavras-chave primeiro, até 6', () => {
  const expected = [
    { type: 'literal', text: '(' },
    { type: 'literal', text: 'select' },
    { type: 'other', description: 'identifier' },
    { type: 'literal', text: 'SELECT' },
    { type: 'literal', text: ',' },
    { type: 'literal', text: 'from' },
    { type: 'literal' },
    { type: 'literal', text: 'where' },
    { type: 'literal', text: 'group_by' },
    { type: 'literal', text: 'x' },
    { type: 'literal', text: 'limit' },
    { type: 'literal', text: 'order' },
  ];
  const [problem] = lintSql('q', 'mysql', fakeParser('q', { message: 'm', expected }));
  assert.deepEqual(problem.expected, ['SELECT', 'FROM', 'WHERE', 'GROUP_BY', 'LIMIT', 'ORDER']);
});

test('lintSql: um problema por comando ruim e nenhum para comandos bons', () => {
  const parser = fakeParser('bad', { message: 'm' });
  assert.equal(lintSql('bad 1; ok; bad 2; ok', 'mysql', parser).length, 2);
  assert.deepEqual(lintSql('ok; ok', 'mysql', parser), []);
  assert.deepEqual(lintSql('', 'mysql', parser), []);
});

// ---------- lintSql com o analisador de verdade ----------

test('lintSql real: SQLite e PostgreSQL válidos, com comentários no meio', async () => {
  const sqlite = await loadSqlParser('sqlite');
  assert.deepEqual(lintSql('-- cria\nCREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT);\nINSERT INTO t (nome) VALUES (\'a;b\');', 'sqlite', sqlite), []);
  const pg = await loadSqlParser('postgresql');
  assert.deepEqual(lintSql('SELECT id FROM t /* ; */ WHERE id = 1;\nDELETE FROM t WHERE id = 2;', 'postgresql', pg), []);
});

test('lintSql real: erro no segundo comando aponta a linha do arquivo e traz sugestões', async () => {
  const parser = await loadSqlParser('postgresql');
  const problems = lintSql('SELECT 1;\n\nSELECT * FORM t;', 'postgresql', parser);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 3);
  assert.ok(problems[0].column >= 1);
  assert.ok(problems[0].message.length > 0);
});

test('loadSqlParser devolve o mesmo analisador para o mesmo dialeto', async () => {
  const a = await loadSqlParser('mysql');
  const b = await loadSqlParser('mysql');
  assert.equal(typeof a.astify, 'function');
  assert.equal(a, b);
});
