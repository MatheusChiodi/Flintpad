// Validação de SQL da aba Código (src/lib/sqlLint.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintSql, loadSqlParser, splitStatements } from '../src/lib/sqlLint.ts';

test('splitStatements: ";" dentro de texto, comentário e identificador não separa comandos', () => {
  const sql = "select ';' as a; -- fim; aqui\nselect 2 /* ; */;\n\n-- só comentário\n";
  assert.deepEqual(
    splitStatements(sql, 'mysql').map((s) => s.text.trim()),
    ["select ';' as a", '-- fim; aqui\nselect 2 /* ; */'],
  );
  assert.deepEqual(splitStatements('select [a;b] from t', 'transactsql').map((s) => s.text), ['select [a;b] from t']);
});

test('splitStatements: GO sozinho na linha separa lotes do SQL Server', () => {
  const parts = splitStatements('select 1\nGO\nselect 2\n  go  \nselect gone', 'transactsql');
  assert.deepEqual(parts.map((s) => s.text.trim()), ['select 1', 'select 2', 'select gone']);
  assert.equal(parts[1].offset, 'select 1\nGO\n'.length);
});

test('lintSql: script válido não tem problemas', async () => {
  const parser = await loadSqlParser('mysql');
  assert.deepEqual(lintSql('SELECT id, name FROM users WHERE id = 1;\nUPDATE users SET name = "x" WHERE id = 2;', 'mysql', parser), []);
});

test('lintSql: um erro por comando, na linha certa do arquivo', async () => {
  const parser = await loadSqlParser('mysql');
  const problems = lintSql('SELECT 1;\nSELEC * FROM t;\nselect a,, b from t;', 'mysql', parser);
  assert.equal(problems.length, 2);
  assert.equal(problems[0].line, 2);
  assert.equal(problems[1].line, 3);
  assert.ok(problems[0].expected.length > 0);
});

test('lintSql: texto não fechado aponta o fim do arquivo', async () => {
  const parser = await loadSqlParser('postgresql');
  const [problem] = lintSql("select * from t where a = 'x", 'postgresql', parser);
  assert.equal(problem.found, null);
  assert.equal(problem.line, 1);
});

test('lintSql: T-SQL com TOP e GO', async () => {
  const parser = await loadSqlParser('transactsql');
  assert.deepEqual(lintSql('SELECT TOP 10 * FROM dbo.Users;\nGO\nSELECT 1', 'transactsql', parser), []);
});
