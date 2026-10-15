// Prévia de Markdown da aba Código (src/lib/markdownPreview.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkTarget, parseInline, parseMarkdown, plainText, slugify } from '../src/lib/markdownPreview.ts';

const types = (blocks) => blocks.map((b) => b.type);

test('blocos: título, parágrafo, regra, código cercado e frontmatter, com a linha de origem', () => {
  const blocks = parseMarkdown('---\ntitle: x\n---\n# Olá *mundo*\n\ntexto\ncontinua\n\n---\n```ts\nconst a = 1;\n\n```\n');
  assert.deepEqual(types(blocks), ['frontmatter', 'heading', 'paragraph', 'hr', 'code']);
  assert.equal(blocks[0].text, 'title: x');
  assert.equal(blocks[1].level, 1);
  assert.equal(blocks[1].line, 4);
  assert.equal(blocks[1].id, 'olá-mundo');
  assert.equal(plainText(blocks[2].children), 'texto continua');
  assert.equal(blocks[2].line, 6);
  assert.deepEqual([blocks[4].lang, blocks[4].text], ['ts', 'const a = 1;\n']);
});

test('código cercado sem fim vai até o fim do arquivo e não interpreta Markdown dentro', () => {
  const [code] = parseMarkdown('~~~\n# não é título\n**nada**');
  assert.equal(code.type, 'code');
  assert.equal(code.text, '# não é título\n**nada**');
});

test('títulos repetidos ganham âncoras distintas', () => {
  const ids = parseMarkdown('## Uso\n## Uso\n## Uso').map((b) => b.id);
  assert.deepEqual(ids, ['uso', 'uso-1', 'uso-2']);
  assert.equal(slugify('Configuração & Uso!'), 'configuração-uso');
});

test('listas: ordenada com início, tarefas e aninhamento', () => {
  const [list] = parseMarkdown('3. um\n4. dois\n   - a\n   - [x] b\n');
  assert.equal(list.type, 'list');
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 2);
  const nested = list.items[1].blocks[1];
  assert.equal(nested.type, 'list');
  assert.equal(nested.items[1].checked, true);
  assert.equal(nested.items[0].checked, null);
  const [tasks] = parseMarkdown('- [ ] fazer\n- [X] feito');
  assert.deepEqual(tasks.items.map((i) => i.checked), [false, true]);
});

test('citação com blocos dentro e tabela com alinhamento e barra escapada', () => {
  const [quote, table] = parseMarkdown('> # T\n> texto\n\n| a | b \\| c | d |\n|:--|:-:|--:|\n| 1 | 2 |\n');
  assert.equal(quote.type, 'quote');
  assert.deepEqual(types(quote.blocks), ['heading', 'paragraph']);
  assert.equal(table.type, 'table');
  assert.deepEqual(table.align, ['left', 'center', 'right']);
  assert.equal(plainText(table.head[1]), 'b | c');
  assert.equal(table.rows[0].length, 3);
  assert.equal(plainText(table.rows[0][2]), '');
});

test('texto: ênfases, código, links, imagens, wikilinks, escapes e quebra de linha', () => {
  const nodes = parseInline('**forte** e *ênfase* ~~riscado~~ `a*b` [site](https://x.dev "t") ![logo](img.png) [[Nota|apelido]] \\*literal\\* fim  \nnova');
  const kinds = nodes.filter((n) => n.type !== 'text').map((n) => n.type);
  assert.deepEqual(kinds, ['strong', 'em', 'del', 'code', 'link', 'image', 'wikilink', 'br']);
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.href, 'https://x.dev');
  const wiki = nodes.find((n) => n.type === 'wikilink');
  assert.deepEqual([wiki.target, wiki.label], ['Nota', 'apelido']);
  assert.ok(plainText(nodes).includes('*literal*'));
});

test('sublinhado no meio de palavra não vira ênfase; HTML fica como texto', () => {
  assert.deepEqual(parseInline('nome_de_variavel'), [{ type: 'text', text: 'nome_de_variavel' }]);
  const html = parseInline('<script>alert(1)</script>');
  assert.deepEqual(html, [{ type: 'text', text: '<script>alert(1)</script>' }]);
});

test('linkTarget: externo, âncora, arquivo relativo e esquemas perigosos bloqueados', () => {
  assert.deepEqual(linkTarget('https://a.b/c'), { kind: 'external', url: 'https://a.b/c' });
  assert.deepEqual(linkTarget('#uso'), { kind: 'anchor', id: 'uso' });
  assert.deepEqual(linkTarget('docs/Guia%20rápido.md#instalar'), { kind: 'file', path: 'docs/Guia rápido.md', anchor: 'instalar' });
  assert.equal(linkTarget('javascript:alert(1)'), null);
  assert.equal(linkTarget('data:text/html,x'), null);
  assert.equal(linkTarget(''), null);
});
