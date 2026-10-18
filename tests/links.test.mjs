// Wikilinks, frontmatter e links para requests (src/lib/links.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as l from '../src/lib/links.ts';

const note = (path) => ({ path, name: path.split('/').pop().replace(/\.md$/, '') });

test('linkRegex devolve um regex novo a cada chamada (lastIndex não vaza)', () => {
  const a = l.linkRegex();
  a.exec('[[X]] [[Y]]');
  assert.notEqual(a.lastIndex, 0);
  assert.equal(l.linkRegex().lastIndex, 0);
  assert.notEqual(l.linkRegex(), l.linkRegex());
});

test('linkRegex captura alvo e apelido e descarta a seção', () => {
  const [m] = [...'[[Nota#Seção|apelido]]'.matchAll(l.linkRegex())];
  assert.equal(m[1], 'Nota');
  assert.equal(m[2], 'apelido');
  assert.equal([...'[[]] [[|x]] [[#só seção]]'.matchAll(l.linkRegex())].length, 0);
});

test('baseName tira pastas e a extensão .md sem distinguir maiúsculas', () => {
  assert.equal(l.baseName('Projetos/Casa/Reforma.md'), 'Reforma');
  assert.equal(l.baseName('Nota.MD'), 'Nota');
  assert.equal(l.baseName('Sem extensão'), 'Sem extensão');
  assert.equal(l.baseName('Requests/Listar.bru'), 'Listar.bru');
  assert.equal(l.baseName('a.md.md'), 'a.md');
  assert.equal(l.baseName(''), '');
});

test('dirName devolve a pasta com barra no fim, ou vazio na raiz', () => {
  assert.equal(l.dirName('a/b/c.md'), 'a/b/');
  assert.equal(l.dirName('c.md'), '');
  assert.equal(l.dirName('pasta/'), 'pasta/');
  assert.equal(l.dirName(''), '');
});

test('outgoingTargets: alvos únicos, aparados, na ordem em que aparecem', () => {
  const content = 'Veja [[ B ]], [[A#Intro]], [[B|outro nome]] e [[Ação]]. [[a]] conta à parte.';
  assert.deepEqual(l.outgoingTargets(content), ['B', 'A', 'Ação', 'a']);
  assert.deepEqual(l.outgoingTargets(''), []);
  assert.deepEqual(l.outgoingTargets('[[sem fim'), []);
});

test('resolveLink casa pelo nome ou pelo caminho, sem distinguir maiúsculas', () => {
  const notes = ['Inicio.md', 'Projetos/Ação.md', 'Outra/Ação.md'].map(note);
  assert.equal(l.resolveLink('inicio', notes), 'Inicio.md');
  assert.equal(l.resolveLink('  INICIO  ', notes), 'Inicio.md');
  assert.equal(l.resolveLink('Outra/ação', notes), 'Outra/Ação.md');
  // Nome repetido em pastas diferentes: vale a primeira da lista.
  assert.equal(l.resolveLink('Ação', notes), 'Projetos/Ação.md');
  assert.equal(l.resolveLink('Fantasma', notes), undefined);
  assert.equal(l.resolveLink('', []), undefined);
});

test('retargetLinks troca nome e caminho antigos, mantendo seção e apelido', () => {
  const content = '[[Velha]] [[velha#Parte|ali]] [[Pasta/Velha]] [[Velharia]] [[Outra]]';
  assert.equal(
    l.retargetLinks(content, 'Pasta/Velha.md', 'Nova'),
    '[[Nova]] [[Nova#Parte|ali]] [[Nova]] [[Velharia]] [[Outra]]',
  );
});

test('retargetLinks sem links para a página devolve o mesmo texto', () => {
  const content = 'Nada a trocar aqui: [[Outra]] e texto Velha.';
  assert.equal(l.retargetLinks(content, 'Velha.md', 'Nova'), content);
  assert.equal(l.retargetLinks('', 'Velha.md', 'Nova'), '');
});

test('retargetLinks aceita nomes com acento e espaços em volta do alvo', () => {
  assert.equal(l.retargetLinks('[[ Reunião ]] e [[REUNIÃO|r]]', 'Reunião.md', 'Encontro'), '[[Encontro]] e [[Encontro|r]]');
});

test('splitFrontmatter separa o bloco YAML do corpo (LF e CRLF)', () => {
  assert.deepEqual(l.splitFrontmatter('---\na: 1\n---\ncorpo'), ['---\na: 1\n---\n', 'corpo']);
  assert.deepEqual(l.splitFrontmatter('---\r\na: 1\r\n---\r\ncorpo'), ['---\r\na: 1\r\n---\r\n', 'corpo']);
  assert.deepEqual(l.splitFrontmatter('---\na: 1\n---'), ['---\na: 1\n---', '']);
});

test('splitFrontmatter: sem bloco no início, tudo é corpo', () => {
  assert.deepEqual(l.splitFrontmatter('texto\n---\na\n---\n'), ['', 'texto\n---\na\n---\n']);
  assert.deepEqual(l.splitFrontmatter(' ---\na\n---\n'), ['', ' ---\na\n---\n']);
  assert.deepEqual(l.splitFrontmatter('---\nsem fechamento'), ['', '---\nsem fechamento']);
  assert.deepEqual(l.splitFrontmatter(''), ['', '']);
});

test('splitFrontmatter para no primeiro fechamento', () => {
  const [front, body] = l.splitFrontmatter('---\na\n---\nb\n---\nc');
  assert.equal(front, '---\na\n---\n');
  assert.equal(body, 'b\n---\nc');
});

test('splitFrontmatter reconhece frontmatter vazio ("---" seguido de "---")', { todo: 'BUG: links.ts:34 — o regex exige uma quebra de linha extra, então "---\\n---\\n" (frontmatter vazio, válido no Obsidian) vira corpo' }, () => {
  assert.deepEqual(l.splitFrontmatter('---\n---\ncorpo'), ['---\n---\n', 'corpo']);
});

test('restoreWikilinks desfaz o escape do serializador', () => {
  assert.equal(l.restoreWikilinks('Veja \\[\\[Nota\\]\\] aqui'), 'Veja [[Nota]] aqui');
  assert.equal(l.restoreWikilinks('\\[\\[A\\_b\\#S\\|x\\]\\]'), '[[A_b#S|x]]');
  assert.equal(l.restoreWikilinks('\\[\\[Um\\]\\] e \\[\\[Dois\\]\\]'), '[[Um]] e [[Dois]]');
});

test('restoreWikilinks não mexe em escapes fora de wikilinks', () => {
  assert.equal(l.restoreWikilinks('\\*negrito\\* \\[só um\\]'), '\\*negrito\\* \\[só um\\]');
  assert.equal(l.restoreWikilinks('[[Já certo]]'), '[[Já certo]]');
  assert.equal(l.restoreWikilinks(''), '');
});

test('isRequestTarget reconhece .bru sem distinguir maiúsculas', () => {
  assert.equal(l.isRequestTarget('Requests/Listar.bru'), true);
  assert.equal(l.isRequestTarget(' X.BRU '), true);
  assert.equal(l.isRequestTarget('Listar.bru.md'), false);
  assert.equal(l.isRequestTarget('Nota'), false);
  assert.equal(l.isRequestTarget(''), false);
});

test('resolveRequestTarget normaliza barras, barra inicial e maiúsculas', () => {
  const requests = [{ path: 'Requests/Listar.bru' }, { path: 'Requests/Criar Usuário.bru' }];
  assert.equal(l.resolveRequestTarget('requests/listar.bru', requests), 'Requests/Listar.bru');
  assert.equal(l.resolveRequestTarget('\\Requests\\Listar.bru', requests), 'Requests/Listar.bru');
  assert.equal(l.resolveRequestTarget('//Requests/criar usuário.bru ', requests), 'Requests/Criar Usuário.bru');
  assert.equal(l.resolveRequestTarget('Requests/Apagar.bru', requests), undefined);
  assert.equal(l.resolveRequestTarget('x.bru', []), undefined);
});

test('requestMentions devolve as notas que ligam para a request, na ordem da lista', () => {
  const notes = ['b.md', 'a.md', 'c.md', 'd.md'].map(note);
  const contents = {
    'a.md': 'Usa [[Requests/Listar.bru|Listar]].',
    'b.md': 'Também [[requests/LISTAR.bru]]',
    'c.md': 'Outra [[Requests/Criar.bru]] e o texto Requests/Listar.bru sem link',
  };
  assert.deepEqual(
    l.requestMentions('Requests/Listar.bru', notes, contents).map((n) => n.path),
    ['b.md', 'a.md'],
  );
  assert.deepEqual(l.requestMentions('Requests/Nada.bru', notes, contents), []);
});

test('requestLinkMarkdown monta o link e tira ] e | do apelido', () => {
  assert.equal(l.requestLinkMarkdown('Requests/Listar.bru', 'Listar'), '[[Requests/Listar.bru|Listar]]');
  assert.equal(l.requestLinkMarkdown('R/x.bru', 'a|b]c'), '[[R/x.bru|abc]]');
  assert.equal(l.requestLinkMarkdown('R/ç.bru', 'Ação'), '[[R/ç.bru|Ação]]');
});
