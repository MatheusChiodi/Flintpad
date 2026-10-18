// Mais casos da lógica de notas (src/lib/notes.ts): bordas, acentos e entradas vazias. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as n from '../src/lib/notes.ts';

const note = (path) => ({ path, name: path.split('/').pop().replace(/\.md$/, '') });

// ---------------------------------------------------------------------------------------------
// Nomes e caminhos

test('sanitizeNoteName: vazio, só proibidos e espaços viram vazio', () => {
  assert.equal(n.sanitizeNoteName(''), '');
  assert.equal(n.sanitizeNoteName('   '), '');
  assert.equal(n.sanitizeNoteName('[[]]#^|'), '');
  assert.equal(n.sanitizeNoteName('...'), '');
});

test('sanitizeNoteName junta espaços, tira pontos finais e controles, mantém acentos e emoji', () => {
  assert.equal(n.sanitizeNoteName('  Reunião   de  segunda  '), 'Reunião de segunda');
  assert.equal(n.sanitizeNoteName('Fim. . .'), 'Fim');
  assert.equal(n.sanitizeNoteName('a\u0000b\u001fc'), 'abc');
  assert.equal(n.sanitizeNoteName('Ideias 💡 / rascunho'), 'Ideias 💡 rascunho');
  assert.equal(n.sanitizeNoteName('Versão 1.2'), 'Versão 1.2');
});

test('sanitizeNoteName trata tab e quebra de linha como espaço', { todo: 'BUG: notes.ts:14 — os controles (tab, quebra de linha) são apagados antes de juntar espaços, então "de<TAB>segunda" vira "desegunda"' }, () => {
  assert.equal(n.sanitizeNoteName('Reunião de\tsegunda'), 'Reunião de segunda');
  assert.equal(n.sanitizeNoteName('linha um\nlinha dois'), 'linha um linha dois');
});

test('sanitizeNoteName protege nomes reservados do Windows em qualquer caixa', () => {
  for (const name of ['con', 'PRN', 'Aux', 'nul', 'COM1', 'lpt9']) assert.equal(n.sanitizeNoteName(name), `${name}_`);
  assert.equal(n.sanitizeNoteName('console'), 'console');
  assert.equal(n.sanitizeNoteName('con.'), 'con_');
});

test('sanitizeNotePath descarta partes vazias, ".", ".." e limpa cada parte', () => {
  assert.equal(n.sanitizeNotePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(n.sanitizeNotePath('./a//b\\\\c/'), 'a/b/c');
  assert.equal(n.sanitizeNotePath('Pasta:/Nota?'), 'Pasta/Nota');
  assert.equal(n.sanitizeNotePath('con/aux'), 'con_/aux_');
  assert.equal(n.sanitizeNotePath(''), '');
  assert.equal(n.sanitizeNotePath('/ / /'), '');
});

// ---------------------------------------------------------------------------------------------
// Links com seção

test('parseLinkTarget com só alvo, só seção e só apelido', () => {
  assert.deepEqual(n.parseLinkTarget('Nota'), { target: 'Nota', section: '', alias: '' });
  assert.deepEqual(n.parseLinkTarget('  Nota  #  Parte  '), { target: 'Nota', section: 'Parte', alias: '' });
  assert.deepEqual(n.parseLinkTarget('Nota|  Apelido '), { target: 'Nota', section: '', alias: 'Apelido' });
  assert.deepEqual(n.parseLinkTarget('Ação#Seção é|Rótulo'), { target: 'Ação', section: 'Seção é', alias: 'Rótulo' });
});

test('parseLinkTarget com texto inválido cai no alvo aparado', () => {
  assert.deepEqual(n.parseLinkTarget(''), { target: '', section: '', alias: '' });
  // Só espaços antes do "#": link para a seção da própria página.
  assert.deepEqual(n.parseLinkTarget('  #só seção '), { target: '', section: 'só seção', alias: '' });
  assert.deepEqual(n.parseLinkTarget('#x'), { target: '#x', section: '', alias: '' });
});

test('linkMarkdown omite seção e apelido vazios e faz ida e volta com parseLinkTarget', () => {
  assert.equal(n.linkMarkdown({ target: 'A', section: '', alias: '' }), '[[A]]');
  assert.equal(n.linkMarkdown({ target: 'A', section: 'S', alias: '' }), '[[A#S]]');
  assert.equal(n.linkMarkdown({ target: 'A', section: '', alias: 'x' }), '[[A|x]]');
  for (const raw of ['Nota', 'Nota#Parte', 'Nota|x', 'Pasta/Nota#Título|apelido']) {
    assert.equal(n.linkMarkdown(n.parseLinkTarget(raw)), `[[${raw}]]`);
  }
});

test('detailedLinkRegex guarda a seção', () => {
  const [m] = [...'[[A#B|c]]'.matchAll(n.detailedLinkRegex())];
  assert.deepEqual([m[1], m[2], m[3]], ['A', 'B', 'c']);
});

// ---------------------------------------------------------------------------------------------
// Texto corrido

test('plainText tira imagens, links, títulos, citações, listas, tarefas, ênfase e HTML', () => {
  const md = [
    '# Título',
    '> citação',
    '- [x] feita',
    '* item',
    '1. primeiro',
    '2) segundo',
    '**negrito** _itálico_ ~~riscado~~ `código`',
    '![alt](img.png) [texto](http://x) [[Nota|apelido]] [[Outra#Seção]]',
    '<b>html</b>',
  ].join('\n');
  assert.equal(
    n.plainText(md),
    ['Título', 'citação', 'feita', 'item', 'primeiro', 'segundo', 'negrito itálico riscado código', 'alt texto apelido Outra', 'html'].join('\n'),
  );
});

test('plainText mantém o número de linhas ao apagar código cercado e ignora frontmatter', () => {
  const md = '---\na: 1\n---\nantes\n```\nsegredo\n```\ndepois';
  assert.equal(n.plainText(md), 'antes\n\n\n\ndepois');
  assert.equal(n.plainText(''), '');
  assert.equal(n.plainText('~~~\nx\n~~~'), '\n\n');
});

test('textStats: vazio é zero e leitura mínima é 1 minuto', () => {
  assert.deepEqual(n.textStats(''), { words: 0, characters: 0, minutes: 0 });
  assert.deepEqual(n.textStats('# \n\n```\ncódigo\n```'), { words: 0, characters: 0, minutes: 0 });
  assert.equal(n.textStats('uma').minutes, 1);
});

test('textStats conta palavras com acento, apóstrofo, hífen e números', () => {
  const stats = n.textStats("Pão-de-ló d'água 2026 ação, isso!");
  assert.equal(stats.words, 5);
  assert.equal(stats.characters, "Pão-de-ló d'água 2026 ação, isso!".replace(/\s+/g, '').length);
});

test('textStats arredonda os minutos pelo ritmo de 200 palavras', () => {
  const words = (count) => Array.from({ length: count }, () => 'palavra').join(' ');
  assert.equal(n.textStats(words(299)).minutes, 1);
  assert.equal(n.textStats(words(300)).minutes, 2);
  assert.equal(n.textStats(words(1000)).minutes, 5);
});

// ---------------------------------------------------------------------------------------------
// noteToText

test('noteToText: título igual ao começo do texto não se repete', () => {
  assert.equal(n.noteToText('# Plano\ncorpo', 'Plano'), 'Plano\ncorpo\n');
});

test('noteToText: sem título nem texto devolve só a quebra de linha', () => {
  assert.equal(n.noteToText('', ''), '\n');
  assert.equal(n.noteToText('---\na: 1\n---\n', '  '), '\n');
});

test('noteToText sublinha o título com no máximo 60 sinais', () => {
  const title = 'T'.repeat(80);
  const out = n.noteToText('corpo', title);
  assert.equal(out, `${title}\n${'='.repeat(60)}\n\ncorpo\n`);
  assert.equal(n.noteToText('x', 'Ação'), 'Ação\n====\n\nx\n');
});

test('noteToText: régua, CRLF, links iguais ao endereço e imagens sem texto', () => {
  const md = 'a\r\n***\r\n[http://x](http://x) ![](foto.png) [site](http://s "título")\r\n\r\n\r\n\r\nfim';
  assert.equal(n.noteToText(md, ''), 'a\n----------\nhttp://x foto.png site (http://s)\n\nfim\n');
});

test('noteToText: tarefa com X maiúsculo vira [x] e recuo é mantido', () => {
  assert.equal(n.noteToText('  - [X] feito\n  + item', ''), '[x] feito\n  • item\n');
});

// ---------------------------------------------------------------------------------------------
// Títulos

test('extractHeadings: fecho de #, recuo de até 3 espaços e títulos vazios', () => {
  const md = ['# Um ##', '   ## Dois', '    ### recuado demais', '#sem espaço', '####### sete', '## ', '### **Três** [[A|link]]'].join('\n');
  assert.deepEqual(n.extractHeadings(md), [
    { level: 1, text: 'Um' },
    { level: 2, text: 'Dois' },
    { level: 3, text: 'Três link' },
  ]);
  assert.deepEqual(n.extractHeadings(''), []);
});

test('extractHeadings ignora títulos dentro do frontmatter', () => {
  assert.deepEqual(n.extractHeadings('---\n# não\n---\n# Sim'), [{ level: 1, text: 'Sim' }]);
});

test('headingKey ignora acentos, caixa e espaços extras', () => {
  assert.equal(n.headingKey('  Ação   Rápida  '), 'acao rapida');
  assert.equal(n.headingKey('ÇÃO'), 'cao');
  assert.equal(n.headingKey('Ação'), n.headingKey('acao'));
  assert.equal(n.headingKey(''), '');
});

// ---------------------------------------------------------------------------------------------
// Prévia

test('previewLines respeita o máximo e começa do início se a seção não existe', () => {
  const md = Array.from({ length: 30 }, (_, i) => `linha ${i}`).join('\n');
  assert.equal(n.previewLines(md).length, 16);
  assert.equal(n.previewLines(md, '', 3).length, 3);
  assert.deepEqual(n.previewLines('# A\ntexto', 'Inexistente').map((l) => l.text), ['A', 'texto']);
});

test('previewLines acha a seção sem acento e mantém o código cercado cru', () => {
  const md = '# Intro\nantes\n## Configuração\n```\n  const x = 1;\n```\n3. numerado';
  assert.deepEqual(n.previewLines(md, 'configuracao'), [
    { kind: 'heading', text: 'Configuração' },
    { kind: 'text', text: '  const x = 1;' },
    { kind: 'item', text: 'numerado' },
  ]);
  assert.deepEqual(n.previewLines(''), []);
});

// ---------------------------------------------------------------------------------------------
// Tags

test('extractTags: lista YAML com "-", aspas, "tag:" singular e # no frontmatter', () => {
  const md = '---\ntags:\n  - "Casa"\n  - \'#trabalho\'\n  - 123\ntag: solo\n---\ncorpo';
  assert.deepEqual(n.extractTags(md), ['casa', 'trabalho', 'solo']);
});

test('extractTags: acentos, parênteses, barra final e números puros', () => {
  const md = 'Texto #Ação e (#dentro) e #123 e #proj/ e #a-b_c e email@x.com#não e #';
  assert.deepEqual(n.extractTags(md), ['ação', 'dentro', 'proj', 'a-b_c']);
});

test('extractTags ignora código em linha, links e URLs de links', () => {
  const md = '`#codigo` [[Nota#seção]] [texto](http://x/#ancora) #real';
  assert.deepEqual(n.extractTags(md), ['real']);
  assert.deepEqual(n.extractTags(''), []);
});

test('extractTags não repete a tag que aparece com caixas diferentes', () => {
  assert.deepEqual(n.extractTags('#Casa #casa #CASA'), ['casa']);
});

test('tagIndex: empate em quantidade vai pela ordem alfabética, e notas sem conteúdo não quebram', () => {
  const notes = ['a.md', 'b.md', 'c.md'].map(note);
  const index = n.tagIndex(notes, { 'a.md': '#zeta #alfa', 'b.md': '#zeta' });
  assert.deepEqual(index, [
    { tag: 'zeta', paths: ['a.md', 'b.md'] },
    { tag: 'alfa', paths: ['a.md'] },
  ]);
  assert.deepEqual(n.tagIndex([], {}), []);
});

test('hasTag aceita # na frente, subtags e caixa diferente, mas não prefixo solto', () => {
  const md = '#projeto/web';
  assert.equal(n.hasTag(md, '#Projeto'), true);
  assert.equal(n.hasTag(md, 'projeto/web'), true);
  assert.equal(n.hasTag(md, 'proj'), false);
  assert.equal(n.hasTag('', 'x'), false);
});

// ---------------------------------------------------------------------------------------------
// Trechos e menções

test('excerptAround põe reticências só onde o texto foi cortado e achata espaços', () => {
  assert.deepEqual(n.excerptAround('abc XYZ def', 4, 3), { before: 'abc ', match: 'XYZ', after: ' def' });
  const long = `${'a'.repeat(50)}MEIO${'b'.repeat(100)}`;
  const ex = n.excerptAround(long, 50, 4);
  assert.equal(ex.before, `…${'a'.repeat(40)}`);
  assert.equal(ex.match, 'MEIO');
  assert.equal(ex.after, `${'b'.repeat(80)}…`);
  assert.deepEqual(n.excerptAround('  x\n\ny  ', 2, 1, 5, 5), { before: '', match: 'x', after: ' y' });
});

test('linkContexts respeita o limite e casa pelo caminho', () => {
  const target = note('Pasta/Alvo.md');
  const source = '[[Alvo]] um\n[[pasta/alvo|dois]]\n[[Alvo]] três\n[[Outra]]';
  const all = n.linkContexts(source, target, 10);
  assert.deepEqual(all.map((e) => e.match), ['Alvo', 'dois', 'Alvo']);
  assert.equal(n.linkContexts(source, target, 1).length, 1);
  assert.deepEqual(n.linkContexts('', target), []);
});

test('linkContexts ignora links no frontmatter', () => {
  assert.deepEqual(n.linkContexts('---\nrel: "[[Alvo]]"\n---\nnada', note('Alvo.md')), []);
});

test('unlinkedMentions: nome curto não procura e páginas já ligadas ficam de fora', () => {
  const notes = ['Ab.md', 'Casa.md', 'x.md', 'y.md'].map(note);
  const contents = { 'x.md': 'Ab Ab Casa', 'y.md': 'na Casa' };
  assert.deepEqual(n.unlinkedMentions(notes[0], notes, contents, new Set()), []);
  const found = n.unlinkedMentions(notes[1], notes, contents, new Set(['y.md']));
  assert.deepEqual(found.map((m) => m.path), ['x.md']);
});

test('unlinkedMentions conta várias menções, ignora títulos, URLs e acentos fazem parte da palavra', () => {
  const notes = ['Ação.md', 'z.md'].map(note);
  const contents = { 'z.md': '# Ação no título\nAção, ação e AÇÃO.\nhttps://x.com/Ação\nAçãozinha' };
  const [mention] = n.unlinkedMentions(notes[0], notes, contents, new Set());
  assert.equal(mention.count, 3);
  assert.equal(mention.excerpt.match, 'Ação');
  assert.equal(mention.name, 'z');
});

test('linkMentions mantém o frontmatter e não liga dentro de código nem de links', () => {
  const md = '---\ntitle: Casa\n---\nCasa `Casa` [[Casa]] [Casa](x) casa';
  assert.equal(n.linkMentions(md, 'Casa'), '---\ntitle: Casa\n---\n[[Casa]] `Casa` [[Casa]] [Casa](x) [[Casa|casa]]');
});

test('linkMentions escapa caracteres especiais do nome', () => {
  assert.equal(n.linkMentions('Use C++ hoje', 'C++'), 'Use [[C++]] hoje');
  assert.equal(n.linkMentions('a.b e axb', 'a.b'), '[[a.b]] e axb');
  assert.equal(n.linkMentions('', 'Nada'), '');
});

// ---------------------------------------------------------------------------------------------
// Busca

test('parseSearchQuery: vazio, # sozinho e prefixos em maiúsculas', () => {
  assert.deepEqual(n.parseSearchQuery(''), { text: '', tags: [], paths: [] });
  assert.deepEqual(n.parseSearchQuery('   '), { text: '', tags: [], paths: [] });
  assert.deepEqual(n.parseSearchQuery('# ## TAG:#Casa PATH:Projetos/A'), { text: '# ##', tags: ['casa'], paths: ['projetos/a'] });
  assert.deepEqual(n.parseSearchQuery('tag: path: livre'), { text: 'tag: path: livre', tags: [], paths: [] });
});

test('searchNotes sem texto devolve o filtro inteiro até o limite', () => {
  const notes = ['a.md', 'b.md', 'c.md'].map(note);
  assert.deepEqual(n.searchNotes('', notes, {}, 2).map((h) => h.note.path), ['a.md', 'b.md']);
  assert.deepEqual(n.searchNotes('tag:x', notes, { 'b.md': '#x' }).map((h) => h.note.path), ['b.md']);
});

test('searchNotes com uma letra só procura no nome', () => {
  const notes = ['zeta.md', 'outra.md'].map(note);
  assert.deepEqual(n.searchNotes('z', notes, { 'outra.md': 'z z z' }).map((h) => h.note.path), ['zeta.md']);
});

test('searchNotes: nome exato vem primeiro e conteúdo traz trecho', () => {
  const notes = ['Plano de casa.md', 'Plano.md', 'Diário.md'].map(note);
  const hits = n.searchNotes('plano', notes, { 'Diário.md': 'Hoje revi o PLANO inteiro.' });
  assert.deepEqual(hits.map((h) => h.note.path), ['Plano.md', 'Plano de casa.md', 'Diário.md']);
  assert.equal(hits[2].excerpt.match, 'PLANO');
  assert.deepEqual(n.searchNotes('nada', [], {}), []);
});

// ---------------------------------------------------------------------------------------------
// Datas e modelos

test('isoDate e formatDate preenchem com zeros e deixam o resto do texto', () => {
  const date = new Date(2026, 0, 5, 7, 3);
  assert.equal(n.isoDate(date), '2026-01-05');
  assert.equal(n.formatDate(date, 'DD/MM/YYYY HH:mm'), '05/01/2026 07:03');
  assert.equal(n.formatDate(date, 'Dia DD às HHh'), 'Dia 05 às 07h');
  assert.equal(n.formatDate(date, ''), '');
});

test('applyTemplate: caixa, espaços, formato e chaves desconhecidas', () => {
  const values = { title: 'Ação', date: new Date(2026, 9, 18, 9, 5) };
  assert.equal(n.applyTemplate('{{ TITLE }} {{Date}} {{time}}', values), 'Ação 2026-10-18 09:05');
  assert.equal(n.applyTemplate('{{date:DD/MM}} {{time:HH}}', values), '18/10 09');
  assert.equal(n.applyTemplate('{{autor}} {{ }} {title}', values), '{{autor}} {{ }} {title}');
  assert.equal(n.applyTemplate('', values), '');
});

test('applyTemplate não reprocessa o título que contém variáveis', () => {
  const values = { title: '{{date}}', date: new Date(2026, 9, 18) };
  assert.equal(n.applyTemplate('{{title}}', values), '{{date}}');
});

test('templatesIn pega todas as páginas dentro da pasta, em qualquer nível, e só ela', () => {
  const notes = ['Modelos/A.md', 'Modelos/sub/B.md', 'ModelosX/C.md', 'Modelos.md'].map(note);
  assert.deepEqual(n.templatesIn(notes, 'Modelos').map((x) => x.path), ['Modelos/A.md', 'Modelos/sub/B.md']);
});

test('isDailyNote exige a pasta e o nome AAAA-MM-DD', () => {
  assert.equal(n.isDailyNote('Diário/2026-10-18.md', 'Diário'), true);
  assert.equal(n.isDailyNote('Diário/sub/2026-10-18.md', 'Diário'), true);
  assert.equal(n.isDailyNote('Diário/2026-10-18 extra.md', 'Diário'), false);
  assert.equal(n.isDailyNote('Outra/2026-10-18.md', 'Diário'), false);
});

test('dailyNeighbors: primeira, última, fora da pasta e subpastas', () => {
  const notes = ['D/2026-10-01.md', 'D/2026-10-03.md', 'D/sub/2026-10-02.md', 'D/Leia.md'].map(note);
  assert.deepEqual(n.dailyNeighbors('D/2026-10-01.md', notes, 'D'), { previous: undefined, next: 'D/2026-10-03.md' });
  assert.deepEqual(n.dailyNeighbors('D/2026-10-03.md', notes, 'D'), { previous: 'D/2026-10-01.md', next: undefined });
  assert.deepEqual(n.dailyNeighbors('D/Leia.md', notes, 'D'), {});
  assert.deepEqual(n.dailyNeighbors('X/2026-10-01.md', notes, 'D'), {});
  // Diária ainda não salva na lista: não tem vizinhas.
  assert.deepEqual(n.dailyNeighbors('D/2026-10-02.md', notes, 'D'), { previous: undefined, next: undefined });
});

// ---------------------------------------------------------------------------------------------
// Pastas

test('folderList inclui pastas intermediárias, sem repetir, e a raiz', () => {
  const notes = ['a/b/c/x.md', 'a/y.md', 'z.md'].map(note);
  assert.deepEqual(n.folderList(notes), ['', 'a/', 'a/b/', 'a/b/c/']);
  assert.deepEqual(n.folderList([]), ['']);
});

test('ancestorFolders da raiz é vazio', () => {
  assert.deepEqual(n.ancestorFolders('x.md'), []);
  assert.deepEqual(n.ancestorFolders('a/b/x.md'), ['a/', 'a/b/']);
});

test('filterNotes: consulta vazia devolve a mesma lista; casa caminho sem acento nem .md', () => {
  const notes = ['Projetos/Reunião.md', 'Casa.md'].map(note);
  assert.equal(n.filterNotes(notes, '   '), notes);
  assert.deepEqual(n.filterNotes(notes, 'projetos/reuniao').map((x) => x.path), ['Projetos/Reunião.md']);
  assert.deepEqual(n.filterNotes(notes, '.md'), []);
  assert.deepEqual(n.filterNotes(notes, 'CASA').map((x) => x.path), ['Casa.md']);
});
