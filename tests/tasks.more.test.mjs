// Mais casos da lógica de tarefas (src/lib/tasks.ts): datas, bordas e entradas inválidas. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as t from '../src/lib/tasks.ts';

const TODAY = '2026-10-14'; // quarta-feira
const OPTS = { today: TODAY, stampDone: true };
const task = (over) => ({ path: 'a.md', line: 0, index: 0, text: 'x', done: false, depth: 0, parent: null, title: 'x', priority: 'none', tags: [], ...over });

// ---------------------------------------------------------------------------------------------
// Datas

test('isIsoDate: anos bissextos, meses e dias fora do calendário e formato', () => {
  assert.equal(t.isIsoDate('2024-02-29'), true);
  assert.equal(t.isIsoDate('2000-02-29'), true);
  assert.equal(t.isIsoDate('2023-02-29'), false);
  assert.equal(t.isIsoDate('1900-02-29'), false);
  assert.equal(t.isIsoDate('2026-13-01'), false);
  assert.equal(t.isIsoDate('2026-00-10'), false);
  assert.equal(t.isIsoDate('2026-04-31'), false);
  assert.equal(t.isIsoDate('2026-1-01'), false);
  assert.equal(t.isIsoDate(' 2026-01-01'), false);
  assert.equal(t.isIsoDate(''), false);
});

test('addDays atravessa meses, anos e aceita negativos', () => {
  assert.equal(t.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(t.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(t.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(t.addDays('2026-10-14', 0), '2026-10-14');
});

test('addMonths prende no último dia do mês e aceita negativos e anos', () => {
  assert.equal(t.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(t.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(t.addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(t.addMonths('2026-11-15', 2), '2027-01-15');
  assert.equal(t.addMonths('2024-02-29', 12), '2025-02-28');
});

test('daysBetween é simétrico e atravessa horário de verão sem erro', () => {
  assert.equal(t.daysBetween('2026-10-14', '2026-10-14'), 0);
  assert.equal(t.daysBetween('2026-10-14', '2026-10-10'), -4);
  assert.equal(t.daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(t.daysBetween('2026-03-01', '2026-04-01'), 31);
});

// ---------------------------------------------------------------------------------------------
// Metadados

test('parseTaskMeta: texto sem metadados e vazio', () => {
  assert.deepEqual(t.parseTaskMeta('Comprar pão'), { title: 'Comprar pão', priority: 'none', tags: [] });
  assert.deepEqual(t.parseTaskMeta(''), { title: '', priority: 'none', tags: [] });
});

test('parseTaskMeta: 🗓 vale como vencimento, data inválida fica no título, primeira prioridade vence', () => {
  const meta = t.parseTaskMeta('Prova 🗓️ 2026-11-02 ⏬ 🔺 ⏳ 2026-02-30');
  assert.equal(meta.due, '2026-11-02');
  assert.equal(meta.priority, 'lowest');
  assert.equal(meta.scheduled, undefined);
  assert.equal(meta.title, 'Prova ⏳ 2026-02-30');
});

test('parseTaskMeta: seletor de variação depois da marca e datas grudadas', () => {
  const meta = t.parseTaskMeta('Tarefa 📅️2026-10-20 🛫2026-10-01 ➕ 2026-09-30');
  assert.equal(meta.due, '2026-10-20');
  assert.equal(meta.start, '2026-10-01');
  assert.equal(meta.created, '2026-09-30');
  assert.equal(meta.title, 'Tarefa');
});

test('parseTaskMeta: repetição para na próxima marca ou tag, e 🔁 vazio não grava regra', () => {
  assert.equal(t.parseTaskMeta('X 🔁 every 2 weeks #casa').recurrence, 'every 2 weeks');
  assert.deepEqual(t.parseTaskMeta('X 🔁 every 2 weeks #casa').tags, ['casa']);
  assert.equal(t.parseTaskMeta('X 🔁 todo mês 📅 2026-10-20').recurrence, 'todo mês');
  assert.equal(t.parseTaskMeta('X 🔁 ').recurrence, undefined);
});

test('parseTaskMeta: tags com acento, caixa, subtags e sem repetir; # colado não é tag', () => {
  const meta = t.parseTaskMeta('Ver #Ação #ação #proj/web email#x #123');
  assert.deepEqual(meta.tags, ['ação', 'proj/web']);
});

test('formatTaskText: ordem fixa, título vazio e nada além do título', () => {
  assert.equal(
    t.formatTaskText({ title: 'T', priority: 'low', recurrence: 'every day', due: '2026-10-20', created: '2026-10-01', completion: '2026-10-21', scheduled: '2026-10-18', start: '2026-10-02' }),
    'T 🔽 🔁 every day ➕ 2026-10-01 🛫 2026-10-02 ⏳ 2026-10-18 📅 2026-10-20 ✅ 2026-10-21',
  );
  assert.equal(t.formatTaskText({ title: '  ', priority: 'high', due: '2026-10-20' }), '⏫ 📅 2026-10-20');
  assert.equal(t.formatTaskText({ title: ' Só ', priority: 'none' }), 'Só');
});

test('formatTaskText e parseTaskMeta fazem ida e volta', () => {
  const text = 'Pagar #casa 🔼 🔁 every month ⏳ 2026-10-18 📅 2026-10-20';
  const meta = t.parseTaskMeta(text);
  assert.equal(t.formatTaskText(meta), text);
});

test('updateTaskMeta: tirar data e trocar prioridade', () => {
  assert.equal(t.updateTaskMeta('A 📅 2026-10-20 ⏫', { due: undefined }), 'A ⏫');
  assert.equal(t.updateTaskMeta('A ⏫', { priority: 'none' }), 'A');
  assert.equal(t.updateTaskMeta('A', { title: 'B', due: '2026-12-01' }), 'B 📅 2026-12-01');
});

// ---------------------------------------------------------------------------------------------
// Extração

test('extractTasks: vazio, sem tarefas e caixa sem espaço depois', () => {
  assert.deepEqual(t.extractTasks('a.md', ''), []);
  assert.deepEqual(t.extractTasks('a.md', 'texto\n- item\n- [ ]x\n- [] y\n[ ] solto'), []);
});

test('extractTasks: marcadores *, +, numerados, X maiúsculo e CRLF', () => {
  const content = '* [ ] um\r\n+ [X] dois\r\n1. [x] três\r\n2) [ ] quatro\r\n';
  const tasks = t.extractTasks('a.md', content);
  assert.deepEqual(tasks.map((x) => [x.line, x.text, x.done]), [
    [0, 'um', false],
    [1, 'dois', true],
    [2, 'três', true],
    [3, 'quatro', false],
  ]);
});

test('extractTasks: tab conta como 4 espaços na hierarquia', () => {
  const tasks = t.extractTasks('a.md', '- [ ] mãe\n\t- [ ] filha\n    - [ ] irmã');
  assert.deepEqual(tasks.map((x) => [x.depth, x.parent]), [[0, null], [1, 0], [1, 0]]);
});

test('extractTasks: cerca de til e cerca maior só fecham com a mesma marca e tamanho', () => {
  const content = ['~~~', '- [ ] a', '```', '- [ ] b', '~~~', '````', '```', '- [ ] c', '````', '- [ ] d'].join('\n');
  assert.deepEqual(t.extractTasks('a.md', content).map((x) => x.text), ['d']);
});

test('extractTasks: crases com código na mesma linha não abrem bloco', () => {
  const content = '```js `x` ```\n- [ ] continua valendo';
  assert.deepEqual(t.extractTasks('a.md', content).map((x) => x.text), ['continua valendo']);
});

test('extractTasks: linhas em branco não encerram a lista, texto sem recuo encerra', () => {
  const content = '- [ ] mãe\n\n  - [ ] filha\ntexto\n  - [ ] órfã';
  const tasks = t.extractTasks('a.md', content);
  assert.deepEqual(tasks.map((x) => [x.text, x.parent]), [['mãe', null], ['filha', 0], ['órfã', null]]);
});

test('extractTasks: frontmatter sem quebra final e com CRLF mantém o número das linhas', () => {
  assert.deepEqual(t.extractTasks('a.md', '---\r\na: 1\r\n---\r\n- [ ] t').map((x) => x.line), [3]);
  assert.deepEqual(t.extractTasks('a.md', '---\na: 1\n---').map((x) => x.line), []);
});

test('extractTasks guarda os metadados e o caminho em cada tarefa', () => {
  const [x] = t.extractTasks('Pasta/n.md', '- [ ] Ligar #trabalho 📅 2026-10-15 ⏫');
  assert.equal(x.path, 'Pasta/n.md');
  assert.equal(x.title, 'Ligar #trabalho');
  assert.equal(x.due, '2026-10-15');
  assert.equal(x.priority, 'high');
  assert.deepEqual(x.tags, ['trabalho']);
});

// ---------------------------------------------------------------------------------------------
// Edição de linhas

test('rewriteTaskLine: linha inexistente, negativa ou que não é tarefa devolve o mesmo texto', () => {
  const content = '- [ ] a\ntexto';
  assert.equal(t.rewriteTaskLine(content, 5, () => ({ done: true })), content);
  assert.equal(t.rewriteTaskLine(content, -1, () => ({ done: true })), content);
  assert.equal(t.rewriteTaskLine(content, 1, () => ({ done: true })), content);
});

test('rewriteTaskLine: texto vazio tira o conteúdo e preserva recuo, marcador e CRLF', () => {
  assert.equal(t.rewriteTaskLine('  1. [x] velho\r\nfim', 0, () => ({ text: '  ' })), '  1. [x]\r\nfim');
  assert.equal(t.rewriteTaskLine('  * [ ] velho\r\n', 0, () => ({ text: ' novo ', done: true })), '  * [x] novo\r\n');
});

test('rewriteTaskLine passa o texto e o estado atuais para a função', () => {
  let seen;
  t.rewriteTaskLine('- [X]   Ação  ', 0, (text, done) => {
    seen = [text, done];
    return {};
  });
  assert.deepEqual(seen, ['Ação', true]);
});

test('toggleTaskLine ida e volta devolve o original (X maiúsculo vira x)', () => {
  const content = '- [ ] a\n- [X] b';
  assert.equal(t.toggleTaskLine(t.toggleTaskLine(content, 0), 0), content);
  assert.equal(t.toggleTaskLine(content, 1), '- [ ] a\n- [ ] b');
  assert.equal(t.toggleTaskLine(t.toggleTaskLine(content, 1), 1), '- [ ] a\n- [x] b');
});

test('completeTaskLine sem carimbo só marca a caixa', () => {
  assert.equal(t.completeTaskLine('- [ ] a 📅 2026-10-14', 0, { today: TODAY, stampDone: false }), '- [x] a 📅 2026-10-14');
});

test('completeTaskLine: linha que não é tarefa ou tarefa vazia não muda', () => {
  assert.equal(t.completeTaskLine('texto', 0, OPTS), 'texto');
  assert.equal(t.completeTaskLine('- [ ]', 0, OPTS), '- [ ]');
  assert.equal(t.completeTaskLine('- [ ] a', 3, OPTS), '- [ ] a');
});

test('completeTaskLine: repetição sem datas vence a partir de hoje', () => {
  assert.equal(
    t.completeTaskLine('- [ ] regar 🔁 every 3 days', 0, OPTS),
    '- [ ] regar 🔁 every 3 days 📅 2026-10-17\n- [x] regar 🔁 every 3 days ✅ 2026-10-14',
  );
});

test('completeTaskLine: repetição mensal avança todas as datas e prende no fim do mês', () => {
  const out = t.completeTaskLine('  - [ ] aluguel 🔁 every month ⏳ 2026-01-30 📅 2026-01-31', 0, OPTS);
  assert.equal(out, '  - [ ] aluguel 🔁 every month ⏳ 2026-02-28 📅 2026-02-28\n  - [x] aluguel 🔁 every month ⏳ 2026-01-30 📅 2026-01-31 ✅ 2026-10-14');
});

test('completeTaskLine: regra que não se entende não cria cópia; CRLF vai para a cópia', () => {
  assert.equal(t.completeTaskLine('- [ ] x 🔁 quando der', 0, OPTS), '- [x] x 🔁 quando der ✅ 2026-10-14');
  const crlf = t.completeTaskLine('- [ ] x 🔁 every day 📅 2026-10-14\r\nfim', 0, OPTS);
  assert.equal(crlf, '- [ ] x 🔁 every day 📅 2026-10-15\r\n- [x] x 🔁 every day 📅 2026-10-14 ✅ 2026-10-14\r\nfim');
});

test('completeTaskLine: reabrir sem ✅ mantém o texto', () => {
  assert.equal(t.completeTaskLine('- [x] feito 📅 2026-10-14', 0, OPTS), '- [ ] feito 📅 2026-10-14');
});

test('deleteTaskLine: só apaga tarefas e linhas que existem', () => {
  assert.equal(t.deleteTaskLine('a\n- [ ] b\nc', 1), 'a\nc');
  assert.equal(t.deleteTaskLine('a\n- [ ] b\nc', 0), 'a\n- [ ] b\nc');
  assert.equal(t.deleteTaskLine('a', 9), 'a');
  assert.equal(t.deleteTaskLine('- [x] b\r\nc', 0), 'c');
});

test('appendTask: nota vazia, texto vazio, várias linhas e quebras finais', () => {
  assert.equal(t.appendTask('', 'nova'), '- [ ] nova\n');
  assert.equal(t.appendTask('a', '   '), 'a');
  assert.equal(t.appendTask('a\n\n\n', 'x\ny'), 'a\n- [ ] x y\n');
  assert.equal(t.appendTask('a\r\nb\r\n', 'z'), 'a\r\nb\r\n- [ ] z\r\n');
});

// ---------------------------------------------------------------------------------------------
// Repetição

test('parseRecurrence: formas em português e inglês', () => {
  assert.deepEqual(t.parseRecurrence('todos os dias'), { unit: 'day', every: 1 });
  assert.deepEqual(t.parseRecurrence('todas as semanas'), { unit: 'week', every: 1 });
  assert.deepEqual(t.parseRecurrence('todo ano'), { unit: 'year', every: 1 });
  assert.deepEqual(t.parseRecurrence('a cada 3 meses'), { unit: 'month', every: 3 });
  assert.deepEqual(t.parseRecurrence('  EVERY   2   Years '), { unit: 'year', every: 2 });
  assert.deepEqual(t.parseRecurrence('dias úteis'), { unit: 'weekday', every: 1 });
  assert.deepEqual(t.parseRecurrence('todo dias uteis'), { unit: 'weekday', every: 1 });
  assert.deepEqual(t.parseRecurrence('every weekday'), { unit: 'weekday', every: 1 });
});

test('parseRecurrence entende o singular "dia útil"', () => {
  assert.deepEqual(t.parseRecurrence('todo dia útil'), { unit: 'weekday', every: 1 });
  assert.deepEqual(t.parseRecurrence('dia util'), { unit: 'weekday', every: 1 });
});

test('parseRecurrence: zero, mais de 999, unidade desconhecida e vazio dão null', () => {
  assert.equal(t.parseRecurrence('every 0 days'), null);
  assert.equal(t.parseRecurrence('every 1000 days'), null);
  assert.equal(t.parseRecurrence('every fortnight'), null);
  assert.equal(t.parseRecurrence('quando der'), null);
  assert.equal(t.parseRecurrence(''), null);
  assert.deepEqual(t.parseRecurrence('every 999 days'), { unit: 'day', every: 999 });
});

test('nextOccurrence: dias úteis pulam o fim de semana', () => {
  const rule = { unit: 'weekday', every: 1 };
  assert.equal(t.nextOccurrence('2026-10-16', rule), '2026-10-19'); // sexta → segunda
  assert.equal(t.nextOccurrence('2026-10-17', rule), '2026-10-19'); // sábado → segunda
  assert.equal(t.nextOccurrence('2026-10-14', rule), '2026-10-15');
});

test('nextOccurrence: semanas e anos', () => {
  assert.equal(t.nextOccurrence('2026-12-28', { unit: 'week', every: 1 }), '2027-01-04');
  assert.equal(t.nextOccurrence('2024-02-29', { unit: 'year', every: 1 }), '2025-02-28');
});

// ---------------------------------------------------------------------------------------------
// Prazos

test('dueBucket: limites da semana e agendada quando não há vencimento', () => {
  assert.equal(t.dueBucket({}, TODAY), 'none');
  assert.equal(t.dueBucket({ due: '2026-10-21' }, TODAY), 'week');
  assert.equal(t.dueBucket({ due: '2026-10-22' }, TODAY), 'later');
  assert.equal(t.dueBucket({ scheduled: '2026-10-13' }, TODAY), 'overdue');
  assert.equal(t.dueBucket({ due: '2026-10-30', scheduled: '2026-10-13' }, TODAY), 'later');
});

test('taskDate prefere o vencimento', () => {
  assert.equal(t.taskDate({ due: 'a', scheduled: 'b' }), 'a');
  assert.equal(t.taskDate({ scheduled: 'b' }), 'b');
  assert.equal(t.taskDate({}), undefined);
});

// ---------------------------------------------------------------------------------------------
// Adição rápida

test('parseQuickAdd: hoje, depois de amanhã e próxima semana', () => {
  assert.equal(t.parseQuickAdd('Ler hoje', TODAY), 'Ler 📅 2026-10-14');
  assert.equal(t.parseQuickAdd('Ler depois-de-amanhã', TODAY), 'Ler 📅 2026-10-16');
  assert.equal(t.parseQuickAdd('Ler Próxima Semana', TODAY), 'Ler 📅 2026-10-21');
  assert.equal(t.parseQuickAdd('Ler next week', TODAY), 'Ler 📅 2026-10-21');
});

test('parseQuickAdd: dia da semana igual a hoje vai para a semana seguinte', () => {
  assert.equal(t.parseQuickAdd('Treino quarta', TODAY), 'Treino 📅 2026-10-21');
  assert.equal(t.parseQuickAdd('Missa domingo', TODAY), 'Missa 📅 2026-10-18');
  assert.equal(t.parseQuickAdd('Feira SEXTA', TODAY), 'Feira 📅 2026-10-16');
  assert.equal(t.parseQuickAdd('Aula terca', TODAY), 'Aula 📅 2026-10-20');
});

test('parseQuickAdd: só a primeira data e a primeira prioridade valem', () => {
  assert.equal(t.parseQuickAdd('A amanhã hoje !1 !4', TODAY), 'A hoje !4 🔺 📅 2026-10-15');
});

test('parseQuickAdd: data ISO, data inválida e metadados já escritos', () => {
  assert.equal(t.parseQuickAdd('Prova 2026-12-01', TODAY), 'Prova 📅 2026-12-01');
  assert.equal(t.parseQuickAdd('Prova 2026-02-30', TODAY), 'Prova 2026-02-30');
  assert.equal(t.parseQuickAdd('Prova 🔽', TODAY), 'Prova 🔽');
});

test('parseQuickAdd preserva metadados já escritos (📅 data)', () => {
  assert.equal(t.parseQuickAdd('Prova 📅 2026-11-11 🔽', TODAY), 'Prova 🔽 📅 2026-11-11');
  assert.equal(t.parseQuickAdd('Prova ⏳ 2026-11-11', TODAY), 'Prova ⏳ 2026-11-11');
});

test('parseQuickAdd: vazio e quebras de linha', () => {
  assert.equal(t.parseQuickAdd('', TODAY), '');
  assert.equal(t.parseQuickAdd('   ', TODAY), '');
  assert.equal(t.parseQuickAdd('linha\num !3', TODAY), 'linha um 🔼');
});

// ---------------------------------------------------------------------------------------------
// Consulta

test('parseTaskQuery: vazio, # sozinho, campos vazios e aspas', () => {
  assert.deepEqual(t.parseTaskQuery(''), []);
  assert.deepEqual(t.parseTaskQuery('#'), [{ field: 'text', value: '#', negate: false }]);
  assert.deepEqual(t.parseTaskQuery('due: tag:'), []);
  assert.deepEqual(t.parseTaskQuery('"duas palavras" -path:"Pasta X"'), [
    { field: 'text', value: 'duas palavras', negate: false },
    { field: 'path', value: 'pasta x', negate: true },
  ]);
  assert.deepEqual(t.parseTaskQuery('-#Casa PRIORITY:High'), [
    { field: 'tag', value: 'casa', negate: true },
    { field: 'priority', value: 'high', negate: false },
  ]);
});

test('matchTask: faixas de data com before/after/</>, any e none', () => {
  const dated = task({ due: '2026-10-20' });
  const undated = task({});
  const m = (q, x) => t.matchTask(t.parseTaskQuery(q), x, TODAY);
  assert.equal(m('due:before2026-10-21', dated), true);
  assert.equal(m('due:<2026-10-20', dated), false);
  assert.equal(m('due:after2026-10-19', dated), true);
  assert.equal(m('due:>2026-10-20', dated), false);
  assert.equal(m('due:2026-10-20', dated), true);
  assert.equal(m('due:any', dated), true);
  assert.equal(m('due:none', dated), false);
  assert.equal(m('due:none', undated), true);
  assert.equal(m('due:before2026-12-01', undated), false);
  assert.equal(m('due:week', dated), true);
});

test('matchTask: priority:high+, is:recurring, is:subtask e is desconhecido', () => {
  const m = (q, x) => t.matchTask(t.parseTaskQuery(q), x, TODAY);
  assert.equal(m('priority:high+', task({ priority: 'highest' })), true);
  assert.equal(m('priority:high+', task({ priority: 'medium' })), false);
  assert.equal(m('is:recurring', task({ recurrence: 'every day' })), true);
  assert.equal(m('is:subtask', task({ parent: 3 })), true);
  assert.equal(m('is:subtask', task({ parent: null })), false);
  assert.equal(m('is:qualquer', task({})), false);
  assert.equal(m('-is:qualquer', task({})), true);
  assert.equal(m('is:overdue', task({ due: '2026-10-01', done: true })), false);
});

test('matchTask: texto procura no texto e no caminho; lista vazia aceita tudo', () => {
  const x = task({ path: 'Projetos/Casa.md', text: 'Pintar parede' });
  assert.equal(t.matchTask(t.parseTaskQuery('casa'), x, TODAY), true);
  assert.equal(t.matchTask(t.parseTaskQuery('PAREDE'), x, TODAY), true);
  assert.equal(t.matchTask([], x, TODAY), true);
});

// ---------------------------------------------------------------------------------------------
// Visões, ordem e grupos

test('inView: upcoming é de amanhã até 7 dias, today inclui atrasadas, all aceita tudo', () => {
  assert.equal(t.inView('upcoming', task({ due: '2026-10-15' }), TODAY), true);
  assert.equal(t.inView('upcoming', task({ due: '2026-10-21' }), TODAY), true);
  assert.equal(t.inView('upcoming', task({ due: '2026-10-22' }), TODAY), false);
  assert.equal(t.inView('upcoming', task({ due: '2026-10-14' }), TODAY), false);
  assert.equal(t.inView('upcoming', task({}), TODAY), false);
  assert.equal(t.inView('today', task({ due: '2026-10-01' }), TODAY), true);
  assert.equal(t.inView('today', task({ due: '2026-10-01', done: true }), TODAY), false);
  assert.equal(t.inView('all', task({ done: true }), TODAY), true);
});

test('sortTasks não altera a entrada e file mantém a ordem', () => {
  const list = [task({ title: 'b', line: 1 }), task({ title: 'a', line: 0 })];
  const copy = [...list];
  const sorted = t.sortTasks(list, 'alpha');
  assert.deepEqual(list, copy);
  assert.deepEqual(sorted.map((x) => x.title), ['a', 'b']);
  assert.notEqual(t.sortTasks(list, 'file'), list);
  assert.deepEqual(t.sortTasks(list, 'file'), list);
});

test('sortTasks alpha ignora acentos e caixa; empate cai na ordem do arquivo', () => {
  const list = [task({ title: 'Ébano', path: 'b.md' }), task({ title: 'abacate', path: 'a.md' }), task({ title: 'ebano', path: 'a.md', line: 3 })];
  assert.deepEqual(t.sortTasks(list, 'alpha').map((x) => `${x.title}@${x.path}`), ['abacate@a.md', 'ebano@a.md', 'Ébano@b.md']);
});

test('sortTasks due: sem data no fim, empate pela prioridade; priority: empate pela data', () => {
  const list = [
    task({ title: 'sem', priority: 'highest' }),
    task({ title: 'b', due: '2026-10-20', priority: 'low' }),
    task({ title: 'a', due: '2026-10-20', priority: 'high' }),
    task({ title: 'c', scheduled: '2026-10-15' }),
  ];
  assert.deepEqual(t.sortTasks(list, 'due').map((x) => x.title), ['c', 'a', 'b', 'sem']);
  assert.deepEqual(t.sortTasks(list, 'priority').map((x) => x.title), ['sem', 'a', 'c', 'b']);
});

test('groupTasks: none vazio, pasta raiz no fim e tarefa com várias tags em vários grupos', () => {
  assert.deepEqual(t.groupTasks([], 'none', TODAY), []);
  const list = [task({ path: 'raiz.md', tags: ['b', 'a'] }), task({ path: 'P/x.md', tags: [] })];
  assert.deepEqual(t.groupTasks(list, 'folder', TODAY).map((g) => g.key), ['P', '']);
  const byTag = t.groupTasks(list, 'tag', TODAY);
  assert.deepEqual(byTag.map((g) => [g.key, g.tasks.length]), [['a', 1], ['b', 1], ['', 1]]);
  assert.deepEqual(t.groupTasks(list, 'note', TODAY).map((g) => g.key), ['raiz.md', 'P/x.md']);
});

test('groupTasks priority e due seguem a ordem das listas fixas', () => {
  const list = [task({ priority: 'low' }), task({ priority: 'highest', due: '2026-10-01' }), task({ priority: 'none', due: TODAY })];
  assert.deepEqual(t.groupTasks(list, 'priority', TODAY).map((g) => g.key), ['highest', 'none', 'low']);
  assert.deepEqual(t.groupTasks(list, 'due', TODAY).map((g) => g.key), ['overdue', 'today', 'none']);
});

test('tasksToMarkdown: lista vazia e caminho com pasta e .MD', () => {
  assert.equal(t.tasksToMarkdown([]), '');
  assert.equal(t.tasksToMarkdown([task({ path: 'P/Nota.MD', text: 'Ação', done: true })]), '- [x] Ação ([[P/Nota]])');
});

// ---------------------------------------------------------------------------------------------
// Preferências

test('sanitizeTaskPrefs: entrada inválida devolve padrões novos a cada vez', () => {
  for (const raw of [null, undefined, 1, 'x', []]) assert.deepEqual(t.sanitizeTaskPrefs(raw), t.DEFAULT_TASK_PREFS);
  const a = t.sanitizeTaskPrefs(null);
  a.collapsed.push('mudou');
  assert.deepEqual(t.DEFAULT_TASK_PREFS.collapsed, []);
});

test('sanitizeTaskPrefs: valores válidos passam; collapsed sem repetir, só textos curtos', () => {
  const prefs = t.sanitizeTaskPrefs({
    view: 'done',
    groupBy: 'tag',
    sortBy: 'due',
    stampDone: false,
    target: 'Tarefas.md',
    collapsed: ['a', 'a', 5, 'x'.repeat(501), 'b'],
  });
  assert.deepEqual(prefs, { view: 'done', groupBy: 'tag', sortBy: 'due', stampDone: false, target: 'Tarefas.md', collapsed: ['a', 'b'] });
  assert.equal(t.sanitizeTaskPrefs({ target: 'x'.repeat(501) }).target, '');
  assert.equal(t.sanitizeTaskPrefs({ collapsed: Array.from({ length: 300 }, (_, i) => `k${i}`) }).collapsed.length, 200);
});

// ---------------------------------------------------------------------------------------------
// Título

test('titleParts: vazio, só texto, link com seção e tag colada não conta', () => {
  assert.deepEqual(t.titleParts(''), []);
  assert.deepEqual(t.titleParts('só texto'), [{ kind: 'text', value: 'só texto' }]);
  assert.deepEqual(t.titleParts('[[Nota#Parte]]'), [{ kind: 'link', value: 'Nota', label: 'Nota' }]);
  assert.deepEqual(t.titleParts('a#b'), [{ kind: 'text', value: 'a#b' }]);
});

test('titleParts: tag no início, acentos e texto entre as partes', () => {
  assert.deepEqual(t.titleParts('#Ação ver [[ A |x]] fim'), [
    { kind: 'tag', value: 'Ação' },
    { kind: 'text', value: ' ver ' },
    { kind: 'link', value: 'A', label: 'x' },
    { kind: 'text', value: ' fim' },
  ]);
});
