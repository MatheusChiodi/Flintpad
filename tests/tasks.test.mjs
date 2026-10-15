// Lógica da tela de tarefas (src/lib/tasks.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as t from '../src/lib/tasks.ts';

const TODAY = '2026-10-14'; // quarta-feira

test('extractTasks ignora frontmatter e blocos de código e calcula a hierarquia', () => {
  const content = [
    '---',
    'x: - [ ] não',
    '---',
    '- [ ] mãe',
    '  - [x] filha',
    '    - [ ] neta',
    '  - item comum',
    '    - [ ] sob item comum',
    '```',
    '- [ ] código',
    '```',
    'Parágrafo',
    '  - [ ] nova lista',
    '- [ ]',
  ].join('\n');
  const tasks = t.extractTasks('a.md', content);
  assert.deepEqual(
    tasks.map((task) => [task.line, task.text, task.done, task.depth, task.parent, task.index]),
    [
      [3, 'mãe', false, 0, null, 0],
      [4, 'filha', true, 1, 3, 1],
      [5, 'neta', false, 2, 4, 2],
      [7, 'sob item comum', false, 1, 3, 3],
      [12, 'nova lista', false, 0, null, 4],
    ],
  );
});

test('parseTaskMeta separa datas, prioridade, repetição e tags', () => {
  const meta = t.parseTaskMeta('Pagar conta #casa ⏫ 🔁 every month 📅 2026-10-20 ⏳ 2026-10-18 ✅ 2026-10-01 #Fin/2026');
  assert.equal(meta.title, 'Pagar conta #casa #Fin/2026');
  assert.equal(meta.priority, 'high');
  assert.equal(meta.recurrence, 'every month');
  assert.equal(meta.due, '2026-10-20');
  assert.equal(meta.scheduled, '2026-10-18');
  assert.equal(meta.completion, '2026-10-01');
  assert.deepEqual(meta.tags, ['casa', 'fin/2026']);
  // Data impossível continua no texto; #123 sozinho não é tag.
  const bad = t.parseTaskMeta('Item 📅 2026-02-30 #123');
  assert.equal(bad.due, undefined);
  assert.equal(bad.title, 'Item 📅 2026-02-30 #123');
  assert.deepEqual(bad.tags, []);
});

test('updateTaskMeta reescreve um campo e preserva o resto', () => {
  assert.equal(t.updateTaskMeta('Ler #livro 📅 2026-01-01', { due: '2026-02-02' }), 'Ler #livro 📅 2026-02-02');
  assert.equal(t.updateTaskMeta('Ler 🔼', { priority: 'none' }), 'Ler');
  assert.equal(t.updateTaskMeta('Ler 📅 2026-01-01', { title: 'Escrever' }), 'Escrever 📅 2026-01-01');
});

test('toggleTaskLine e rewriteTaskLine preservam o arquivo byte a byte', () => {
  const content = 'a\r\n1. [ ] um\r\n  * [X] dois\r\n';
  assert.equal(t.toggleTaskLine(content, 1), 'a\r\n1. [x] um\r\n  * [X] dois\r\n');
  assert.equal(t.toggleTaskLine(content, 2), 'a\r\n1. [ ] um\r\n  * [ ] dois\r\n');
  assert.equal(t.toggleTaskLine(content, 0), content);
  assert.equal(t.rewriteTaskLine(content, 1, () => ({ text: 'novo' })), 'a\r\n1. [ ] novo\r\n  * [X] dois\r\n');
});

test('completeTaskLine carimba a data, tira ao reabrir e cria a próxima repetição', () => {
  const plain = '- [ ] simples';
  assert.equal(t.completeTaskLine(plain, 0, { today: TODAY, stampDone: true }), `- [x] simples ✅ ${TODAY}`);
  assert.equal(t.completeTaskLine(plain, 0, { today: TODAY, stampDone: false }), '- [x] simples');
  assert.equal(t.completeTaskLine(`- [x] simples ✅ ${TODAY}`, 0, { today: TODAY, stampDone: true }), '- [ ] simples');
  const recurring = 'x\n  - [ ] Regar 🔁 every week 📅 2026-10-10\ny';
  assert.equal(
    t.completeTaskLine(recurring, 1, { today: TODAY, stampDone: true }),
    `x\n  - [ ] Regar 🔁 every week 📅 2026-10-17\n  - [x] Regar 🔁 every week 📅 2026-10-10 ✅ ${TODAY}\ny`,
  );
  // Sem datas, a próxima vence a partir de hoje.
  assert.equal(t.completeTaskLine('- [ ] Backup 🔁 todo dia', 0, { today: TODAY, stampDone: false }), `- [ ] Backup 🔁 todo dia 📅 2026-10-15\n- [x] Backup 🔁 todo dia`);
});

test('parseRecurrence e nextOccurrence', () => {
  assert.deepEqual(t.parseRecurrence('every 3 days'), { unit: 'day', every: 3 });
  assert.deepEqual(t.parseRecurrence('a cada 2 semanas'), { unit: 'week', every: 2 });
  assert.deepEqual(t.parseRecurrence('todo mês'), { unit: 'month', every: 1 });
  assert.deepEqual(t.parseRecurrence('every weekday'), { unit: 'weekday', every: 1 });
  assert.equal(t.parseRecurrence('quando der'), null);
  assert.equal(t.nextOccurrence('2026-01-31', { unit: 'month', every: 1 }), '2026-02-28');
  assert.equal(t.nextOccurrence('2024-02-29', { unit: 'year', every: 1 }), '2025-02-28');
  assert.equal(t.nextOccurrence('2026-10-16', { unit: 'weekday', every: 1 }), '2026-10-19');
});

test('dueBucket, daysBetween e inView', () => {
  const task = (due) => ({ due, done: false });
  assert.equal(t.dueBucket(task('2026-10-13'), TODAY), 'overdue');
  assert.equal(t.dueBucket(task(TODAY), TODAY), 'today');
  assert.equal(t.dueBucket(task('2026-10-15'), TODAY), 'tomorrow');
  assert.equal(t.dueBucket(task('2026-10-21'), TODAY), 'week');
  assert.equal(t.dueBucket(task('2026-10-22'), TODAY), 'later');
  assert.equal(t.dueBucket({ scheduled: TODAY }, TODAY), 'today');
  assert.equal(t.dueBucket({}, TODAY), 'none');
  assert.equal(t.daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(t.inView('today', task('2026-10-01'), TODAY), true);
  assert.equal(t.inView('upcoming', task('2026-10-15'), TODAY), true);
  assert.equal(t.inView('upcoming', task(TODAY), TODAY), false);
});

test('parseQuickAdd entende datas, dias da semana e prioridade', () => {
  assert.equal(t.parseQuickAdd('Ligar para Ana amanhã !2 #trabalho', TODAY), 'Ligar para Ana #trabalho ⏫ 📅 2026-10-15');
  assert.equal(t.parseQuickAdd('Revisar next week', TODAY), 'Revisar 📅 2026-10-21');
  assert.equal(t.parseQuickAdd('Feira sexta', TODAY), 'Feira 📅 2026-10-16');
  assert.equal(t.parseQuickAdd('Reunião quarta', TODAY), 'Reunião 📅 2026-10-21');
  assert.equal(t.parseQuickAdd('Prazo 2026-12-01 hoje', TODAY), `Prazo hoje 📅 2026-12-01`);
  assert.equal(t.parseQuickAdd('  só texto  ', TODAY), 'só texto');
});

test('consulta: palavras, #tag, path:, due:, priority:, is: e negação', () => {
  const tasks = t.extractTasks(
    'Projetos/App.md',
    ['- [ ] Login #backend ⏫ 📅 2026-10-10', '- [x] Testes', '  - [ ] Deploy 📅 2026-10-30 🔁 every month'].join('\n'),
  );
  const run = (query) => tasks.filter((task) => t.matchTask(t.parseTaskQuery(query), task, TODAY)).map((task) => task.title);
  assert.deepEqual(run('login'), ['Login #backend']);
  assert.deepEqual(run('#backend'), ['Login #backend']);
  assert.deepEqual(run('-tag:backend'), ['Testes', 'Deploy']);
  assert.deepEqual(run('path:projetos is:open'), ['Login #backend', 'Deploy']);
  assert.deepEqual(run('due:overdue'), ['Login #backend']);
  assert.deepEqual(run('due:none'), ['Testes']);
  assert.deepEqual(run('due:after2026-10-15'), ['Deploy']);
  assert.deepEqual(run('priority:high+'), ['Login #backend']);
  assert.deepEqual(run('is:recurring is:subtask'), ['Deploy']);
  assert.deepEqual(run('"login #back"'), ['Login #backend']);
});

test('sortTasks e groupTasks', () => {
  const a = t.extractTasks('B/a.md', '- [ ] zeta 📅 2026-10-20\n- [ ] alfa ⏬\n- [ ] meio 🔺 📅 2026-10-01 #x');
  const b = t.extractTasks('b.md', '- [ ] beta #x #y');
  const all = [...a, ...b];
  assert.deepEqual(t.sortTasks(all, 'due').map((task) => task.title), ['meio #x', 'zeta', 'beta #x #y', 'alfa']);
  assert.deepEqual(t.sortTasks(all, 'priority').map((task) => task.title), ['meio #x', 'zeta', 'beta #x #y', 'alfa']);
  assert.deepEqual(t.sortTasks(all, 'alpha').map((task) => task.title), ['alfa', 'beta #x #y', 'meio #x', 'zeta']);
  assert.deepEqual(t.groupTasks(all, 'due', TODAY).map((group) => [group.key, group.tasks.length]), [['overdue', 1], ['week', 1], ['none', 2]]);
  assert.deepEqual(t.groupTasks(all, 'priority', TODAY).map((group) => group.key), ['highest', 'none', 'lowest']);
  assert.deepEqual(t.groupTasks(all, 'tag', TODAY).map((group) => [group.key, group.tasks.length]), [['x', 2], ['y', 1], ['', 2]]);
  assert.deepEqual(t.groupTasks(all, 'folder', TODAY).map((group) => group.key), ['B', '']);
  assert.deepEqual(t.groupTasks([], 'none', TODAY), []);
});

test('appendTask, deleteTaskLine e tasksToMarkdown', () => {
  assert.equal(t.appendTask('# Nota\n\n', 'nova'), '# Nota\n- [ ] nova\n');
  assert.equal(t.appendTask('', 'a\nb'), '- [ ] a b\n');
  assert.equal(t.appendTask('x\r\n', 'y'), 'x\r\n- [ ] y\r\n');
  assert.equal(t.appendTask('x', '   '), 'x');
  assert.equal(t.deleteTaskLine('a\n- [ ] b\nc', 1), 'a\nc');
  assert.equal(t.deleteTaskLine('a\nb', 1), 'a\nb');
  const tasks = t.extractTasks('Pasta/N.md', '- [x] feito');
  assert.equal(t.tasksToMarkdown(tasks), '- [x] feito ([[Pasta/N]])');
});

test('sanitizeTaskPrefs descarta valores inválidos', () => {
  assert.deepEqual(t.sanitizeTaskPrefs(null), t.DEFAULT_TASK_PREFS);
  const prefs = t.sanitizeTaskPrefs({ view: 'today', groupBy: 'hack', sortBy: 'due', stampDone: 'yes', collapsed: ['a', 'a', 3, 'b'], target: 'x.md' });
  assert.deepEqual(prefs, { view: 'today', groupBy: 'note', sortBy: 'due', stampDone: true, collapsed: ['a', 'b'], target: 'x.md' });
});

test('titleParts separa texto, tags e links', () => {
  assert.deepEqual(t.titleParts('Ver [[Inicio|início]] e #docs/api agora'), [
    { kind: 'text', value: 'Ver ' },
    { kind: 'link', value: 'Inicio', label: 'início' },
    { kind: 'text', value: ' e ' },
    { kind: 'tag', value: 'docs/api' },
    { kind: 'text', value: ' agora' },
  ]);
  assert.deepEqual(t.titleParts('#a'), [{ kind: 'tag', value: 'a' }]);
});
