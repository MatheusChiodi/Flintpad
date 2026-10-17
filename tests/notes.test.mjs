// Lógica da tela de notas (src/lib/notes.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as n from '../src/lib/notes.ts';

test('sanitizeNoteName tira o que o Windows recusa e o que quebra um wikilink', () => {
  assert.equal(n.sanitizeNoteName('  Plano: v2? '), 'Plano v2');
  assert.equal(n.sanitizeNoteName('a#b^c[d]e|f'), 'abcdef');
  assert.equal(n.sanitizeNoteName('Fim com ponto...'), 'Fim com ponto');
  assert.equal(n.sanitizeNoteName('con'), 'con_');
  assert.equal(n.sanitizeNoteName('///'), '');
});

test('sanitizeNotePath mantém subpastas e não sai do vault', () => {
  assert.equal(n.sanitizeNotePath('Projetos/Casa: nova'), 'Projetos/Casa nova');
  assert.equal(n.sanitizeNotePath('../../fora'), 'fora');
  assert.equal(n.sanitizeNotePath('a\\b'), 'a/b');
});

const note = (path) => ({ path, name: path.split('/').pop().replace(/\.md$/, '') });

test('parseLinkTarget e linkMarkdown preservam seção e apelido', () => {
  assert.deepEqual(n.parseLinkTarget('Casa nova#Tarefas|ver'), { target: 'Casa nova', section: 'Tarefas', alias: 'ver' });
  assert.deepEqual(n.parseLinkTarget('Casa'), { target: 'Casa', section: '', alias: '' });
  assert.equal(n.linkMarkdown({ target: 'A', section: 'B', alias: '' }), '[[A#B]]');
  assert.equal(n.linkMarkdown({ target: 'A', section: '', alias: 'x' }), '[[A|x]]');
});

test('textStats conta palavras do texto visível, sem marcas, código nem frontmatter', () => {
  const md = '---\ntags: [a]\n---\n# Título aqui\n\nUm **dois** [[Três|quatro]] cinco-seis.\n\n```\ncodigo nao conta\n```\n- [ ] item';
  const stats = n.textStats(md);
  assert.equal(stats.words, 7);
  assert.equal(stats.minutes, 1);
  assert.equal(n.textStats('').words, 0);
  assert.equal(n.textStats('').minutes, 0);
});

test('extractHeadings ignora código cercado e limpa marcas', () => {
  const md = '# Um\ntexto\n```\n# não\n```\n## **Dois** [[X|y]]\n####### sete não';
  assert.deepEqual(n.extractHeadings(md), [
    { level: 1, text: 'Um' },
    { level: 2, text: 'Dois y' },
  ]);
  assert.equal(n.headingKey('  Ação   Rápida '), 'acao rapida');
});

test('extractTags lê frontmatter e #tags no texto, fora de código e links (título conta, como no Obsidian)', () => {
  const md = '---\ntags:\n  - Casa\n  - "obra/2026"\n---\n# Título #nao\nTexto #ideia e #Casa, `#codigo`, [[Nota#Seção]], cor #123 e #a/b.';
  assert.deepEqual(n.extractTags(md), ['casa', 'obra/2026', 'nao', 'ideia', 'a/b']);
  assert.deepEqual(n.extractTags('---\ntags: [x, "y"]\n---\n'), ['x', 'y']);
});

test('tagIndex soma subtags na tag mãe e ordena por quantidade', () => {
  const notes = [note('a.md'), note('b.md')];
  const index = n.tagIndex(notes, { 'a.md': '#obra/casa', 'b.md': '#obra #x' });
  assert.deepEqual(index[0], { tag: 'obra', paths: ['a.md', 'b.md'] });
  assert.ok(index.some((entry) => entry.tag === 'obra/casa'));
  assert.equal(n.hasTag('#obra/casa', 'obra'), true);
  assert.equal(n.hasTag('#obras', 'obra'), false);
});

test('linkContexts mostra o texto em volta do link, com o apelido no lugar', () => {
  const source = 'Primeira linha.\nVer [[Casa nova|a casa]] amanhã.\nE [[Outra]].';
  const [context] = n.linkContexts(source, note('Projetos/Casa nova.md'));
  assert.deepEqual(context, { before: 'Ver ', match: 'a casa', after: ' amanhã.' });
});

test('unlinkedMentions acha o nome solto e ignora links, código e palavras maiores', () => {
  const notes = [note('Casa.md'), note('a.md'), note('b.md'), note('c.md')];
  const contents = {
    'a.md': 'Comprei a casa ontem. Casamento não conta.',
    'b.md': 'Só [[Casa]] e `Casa`.',
    'c.md': 'Casa também aqui.',
  };
  const found = n.unlinkedMentions(notes[0], notes, contents, new Set(['c.md']));
  assert.deepEqual(found.map((m) => [m.path, m.count]), [['a.md', 1]]);
  assert.equal(found[0].excerpt.match, 'casa');
});

test('linkMentions liga as menções e mantém o texto original como apelido', () => {
  const md = '---\ntitle: Casa\n---\nA casa e a Casa. [[Casa]] e `Casa`.';
  assert.equal(n.linkMentions(md, 'Casa'), '---\ntitle: Casa\n---\nA [[Casa|casa]] e a [[Casa]]. [[Casa]] e `Casa`.');
});

test('parseSearchQuery separa tag:, path:, #tag e o texto livre', () => {
  assert.deepEqual(n.parseSearchQuery('tag:Casa path:proj plano #ideia'), { text: 'plano', tags: ['casa', 'ideia'], paths: ['proj'] });
  assert.deepEqual(n.parseSearchQuery('#'), { text: '#', tags: [], paths: [] });
});

test('searchNotes: nome aproximado primeiro, depois conteúdo; filtros valem para tudo', () => {
  const notes = [note('Projetos/Casa nova.md'), note('Finanças.md'), note('Ideias.md')];
  const contents = { 'Projetos/Casa nova.md': '#casa', 'Finanças.md': 'orçamento da casa nova', 'Ideias.md': '' };
  const hits = n.searchNotes('casa', notes, contents);
  assert.deepEqual(hits.map((h) => h.note.name), ['Casa nova', 'Finanças']);
  assert.ok(hits[1].excerpt);
  assert.deepEqual(n.searchNotes('cn', notes, contents)[0].positions, [0, 5]);
  assert.deepEqual(n.searchNotes('tag:casa', notes, contents).map((h) => h.note.name), ['Casa nova']);
  assert.deepEqual(n.searchNotes('path:proj', notes, contents).map((h) => h.note.name), ['Casa nova']);
});

test('applyTemplate troca as variáveis e deixa o resto', () => {
  const date = new Date(2026, 9, 14, 9, 5);
  assert.equal(
    n.applyTemplate('# {{title}}\n{{date}} {{time}} {{date:DD/MM/YYYY}} {{outra}}', { title: 'Reunião', date }),
    '# Reunião\n2026-10-14 09:05 14/10/2026 {{outra}}',
  );
});

test('dailyNeighbors anda pelas notas diárias pela data', () => {
  const notes = ['Diário/2026-10-12.md', 'Diário/2026-10-14.md', 'Diário/2026-10-10.md', 'Diário/x.md', 'a.md'].map(note);
  assert.deepEqual(n.dailyNeighbors('Diário/2026-10-12.md', notes, 'Diário'), { previous: 'Diário/2026-10-10.md', next: 'Diário/2026-10-14.md' });
  assert.deepEqual(n.dailyNeighbors('a.md', notes, 'Diário'), {});
  assert.equal(n.isDailyNote('Diário/2026-10-12.md', 'Diário'), true);
});

test('folderList, ancestorFolders e filterNotes', () => {
  const notes = [note('a/b/c.md'), note('x.md'), note('Ação/d.md')];
  assert.deepEqual(n.folderList(notes), ['', 'a/', 'a/b/', 'Ação/']);
  assert.deepEqual(n.ancestorFolders('a/b/c.md'), ['a/', 'a/b/']);
  assert.deepEqual(n.filterNotes(notes, 'acao').map((x) => x.path), ['Ação/d.md']);
  assert.equal(n.filterNotes(notes, ' ').length, 3);
});

test('previewLines começa na seção, tira marcas e classifica as linhas', () => {
  const md = '---\na: 1\n---\n# Um\ntexto **forte**\n## Dois\n- item [[X|y]]\n\n```\n# código\n```\nfim';
  assert.deepEqual(n.previewLines(md, 'dois'), [
    { kind: 'heading', text: 'Dois' },
    { kind: 'item', text: 'item y' },
    { kind: 'text', text: '# código' },
    { kind: 'text', text: 'fim' },
  ]);
  assert.equal(n.previewLines(md, '', 2).length, 2);
});

test('busca aproximada ignora acentos e mantém as posições', () => {
  const notes = [note('Título longo.md'), note('Ação.md')];
  assert.deepEqual(n.searchNotes('titulo', notes, {})[0].positions, [0, 1, 2, 3, 4, 5]);
  assert.equal(n.searchNotes('acao', notes, {})[0].note.name, 'Ação');
});

test('noteToText: página vira texto legível, com título, marcadores, tarefas, links e código', () => {
  const md = '---\ntags: [a]\n---\n# Plano\n\nTexto **forte**, _itálico_ e `código` com snake_case_var.\n\n- item\n- [ ] fazer\n- [x] feito\n\nVeja [[Outra Nota|a outra]] e [site](https://x.dev).\n\n```js\nconst a = 1;\n```\n\n---\n';
  assert.equal(
    n.noteToText(md, 'Plano'),
    'Plano\n\nTexto forte, itálico e código com snake_case_var.\n\n• item\n[ ] fazer\n[x] feito\n\nVeja a outra e site (https://x.dev).\n\nconst a = 1;\n\n----------\n',
  );
  assert.equal(n.noteToText('Só texto', ''), 'Só texto\n');
  assert.equal(n.noteToText('Corpo', 'Ideias'), 'Ideias\n======\n\nCorpo\n');
});
