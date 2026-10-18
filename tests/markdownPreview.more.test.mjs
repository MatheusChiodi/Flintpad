// Casos extras da prévia de Markdown (src/lib/markdownPreview.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkTarget, parseInline, parseMarkdown, plainText, slugify } from '../src/lib/markdownPreview.ts';

const types = (blocks) => blocks.map((b) => b.type);
const text = (s) => plainText(parseInline(s));

// ---------- âncoras e texto puro ----------

test('slugify: mantém letras, números, "_" e "-"; espaços repetidos viram um "-"', () => {
  assert.equal(slugify('  Passo 2:   Configurar_API-v2  '), 'passo-2-configurar_api-v2');
  assert.equal(slugify('Ñandú «Ölçü»'), 'ñandú-ölçü');
  assert.equal(slugify('!!!'), '');
});

test('plainText junta filhos aninhados, alt de imagem, apelido de wikilink e quebra como espaço', () => {
  const nodes = parseInline('**a [*b*](u)** ![alt](i.png) [[Nota|apelido]] `c`  \nd');
  assert.equal(plainText(nodes), 'a b alt apelido c d');
  assert.equal(plainText([]), '');
});

// ---------- blocos ----------

test('frontmatter não fechado vira linha horizontal + parágrafo', () => {
  assert.deepEqual(types(parseMarkdown('---\ntitle: x\n')), ['hr', 'paragraph']);
});

test('frontmatter só no começo; as linhas depois dele mantêm o número original', () => {
  const blocks = parseMarkdown('---\na: 1\nb: 2\n---\n\n# T');
  assert.equal(blocks[0].text, 'a: 1\nb: 2');
  assert.equal(blocks[1].line, 6);
  assert.deepEqual(types(parseMarkdown('x\n---\na: 1\n---')), ['paragraph', 'hr', 'paragraph', 'hr']);
});

test('quebras \\r\\n e \\r são normalizadas', () => {
  const blocks = parseMarkdown('# A\r\n\r\ntexto\r\nmais\r# B');
  assert.deepEqual(types(blocks), ['heading', 'paragraph', 'heading']);
  assert.equal(plainText(blocks[1].children), 'texto mais');
  assert.equal(blocks[2].line, 5);
});

test('títulos: "#" fecha só com espaço antes, sem espaço não é título, 7 "#" é parágrafo, vazio vira "secao"', () => {
  const blocks = parseMarkdown('# C#\n#tag\n# Fim ##\n#\n####### x\n###### Seis');
  assert.deepEqual(
    blocks.map((b) => [b.type, b.type === 'heading' ? b.id : plainText(b.children)]),
    [
      ['heading', 'c'],
      ['paragraph', '#tag'],
      ['heading', 'fim'],
      ['heading', 'secao'],
      ['paragraph', '####### x'],
      ['heading', 'seis'],
    ],
  );
  assert.equal(blocks[5].level, 6);
  assert.equal(plainText(blocks[0].children), 'C#');
});

test('título com até 3 espaços antes; com 4 já não é título', () => {
  assert.deepEqual(types(parseMarkdown('   ## ok')), ['heading']);
  assert.deepEqual(types(parseMarkdown('    ## não')), ['paragraph']);
});

test('âncoras repetidas nunca colidem com uma âncora já gerada', () => {
  const ids = parseMarkdown('## Uso\n## Uso\n## Uso 1').map((b) => b.id);
  assert.equal(new Set(ids).size, 3);
});

test('código cercado: fecha só com cerca do mesmo caractere e pelo menos o mesmo tamanho', () => {
  const [a] = parseMarkdown('````md\n```js\nx\n```\n````');
  assert.equal(a.lang, 'md');
  assert.equal(a.text, '```js\nx\n```');
  const [b, after] = parseMarkdown('~~~\n```\n~~~~\ndepois');
  assert.equal(b.text, '```');
  assert.equal(after.type, 'paragraph');
});

test('código cercado: linguagem é a primeira palavra da info; cerca recuada até 3 espaços', () => {
  const [code] = parseMarkdown('   ```js title="a.js"\nlet a;\n   ```');
  assert.equal(code.type, 'code');
  assert.equal(code.lang, 'js');
  assert.equal(code.text, 'let a;');
  assert.equal(parseMarkdown('```\n```')[0].text, '');
});

test('linhas horizontais: ***, _ _ _ e - - - (não lista)', () => {
  assert.deepEqual(types(parseMarkdown('***\n\n_ _ _\n\n- - -\n\n--')), ['hr', 'hr', 'hr', 'paragraph']);
});

test('parágrafo é interrompido por título, cerca, citação e lista sem linha vazia', () => {
  const blocks = parseMarkdown('a\n# T\nb\n```\nc\n```\nd\n> q\ne\n- item');
  assert.deepEqual(types(blocks), ['paragraph', 'heading', 'paragraph', 'code', 'paragraph', 'quote', 'paragraph', 'list']);
});

test('listas: "1)" é ordenada, início 0, e trocar o tipo de marcador abre outra lista', () => {
  const [ordered] = parseMarkdown('0) a\n1) b');
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.start, 0);
  assert.equal(ordered.items.length, 2);
  assert.deepEqual(types(parseMarkdown('1. a\n- b')), ['list', 'list']);
  const [bullets] = parseMarkdown('- a\n* b\n+ c');
  assert.equal(bullets.items.length, 3);
});

test('listas: linha vazia entre itens mantém uma lista só; texto sem recuo depois encerra', () => {
  const blocks = parseMarkdown('- x\n\n- y\n\ntexto');
  assert.deepEqual(types(blocks), ['list', 'paragraph']);
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[0].items[1].blocks[0].line, 3);
  assert.equal(blocks[1].line, 5);
});

test('listas: continuação preguiçosa junta ao parágrafo do item', () => {
  const [list] = parseMarkdown('- a\ncontinua\n- b');
  assert.equal(list.items.length, 2);
  assert.equal(plainText(list.items[0].blocks[0].children), 'a continua');
});

test('listas: item com parágrafos separados e código cercado recuado', () => {
  const [list] = parseMarkdown('- primeiro\n\n  segundo\n  ```js\n  x()\n  ```\n- outro');
  assert.equal(list.items.length, 2);
  assert.deepEqual(types(list.items[0].blocks), ['paragraph', 'paragraph', 'code']);
  assert.equal(list.items[0].blocks[2].text, 'x()');
  assert.equal(list.items[0].blocks[1].line, 3);
});

test('listas: item vazio e tarefa sem texto depois do colchete não é tarefa', () => {
  const [list] = parseMarkdown('-\n- [x]\n- [ ] ok');
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[0].blocks, []);
  assert.equal(list.items[1].checked, null);
  assert.equal(list.items[2].checked, false);
});

test('citações: aninhadas, linha da origem e fim na primeira linha sem ">"', () => {
  const blocks = parseMarkdown('intro\n\n> > dentro\n> fora\nsegue');
  assert.deepEqual(types(blocks), ['paragraph', 'quote', 'paragraph']);
  const quote = blocks[1];
  assert.equal(quote.line, 3);
  assert.equal(quote.blocks[0].type, 'quote');
  assert.equal(quote.blocks[0].line, 3);
  assert.equal(blocks[2].line, 5);
  assert.equal(plainText(blocks[2].children), 'segue');
});

test('tabelas: sem barras nas pontas, célula extra cortada, termina sem "|" ou em linha vazia', () => {
  const blocks = parseMarkdown('a | b\n--- | ---\n1 | 2 | 3\n4\nfim');
  assert.deepEqual(types(blocks), ['table', 'paragraph']);
  const [table] = blocks;
  assert.deepEqual(table.align, [null, null]);
  assert.equal(table.rows.length, 1);
  assert.deepEqual(table.rows[0].map(plainText), ['1', '2']);
  assert.equal(blocks[1].line, 4);
  assert.deepEqual(types(parseMarkdown('|a|\n|-|\n|1|\n\n|2|')), ['table', 'paragraph']);
});

test('tabelas: separador precisa de "-"; células com Markdown', () => {
  assert.deepEqual(types(parseMarkdown('a | b\n: | :')), ['paragraph']);
  const [table] = parseMarkdown('| **x** | `y` |\n|---|---|\n| [l](u) | ~~z~~ |');
  assert.equal(table.head[0][0].type, 'strong');
  assert.equal(table.head[1][0].type, 'code');
  assert.equal(table.rows[0][0][0].type, 'link');
  assert.equal(table.rows[0][1][0].type, 'del');
});

test('documento vazio ou só de espaços não gera blocos', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('\n  \n\t\n'), []);
});

// ---------- texto ----------

test('autolinks <https://> e <mailto:>; outros esquemas ficam como texto', () => {
  assert.deepEqual(parseInline('<https://a.dev/x>'), [{ type: 'link', href: 'https://a.dev/x', children: [{ type: 'text', text: 'https://a.dev/x' }] }]);
  assert.equal(parseInline('<mailto:a@b.c>')[0].href, 'mailto:a@b.c');
  assert.deepEqual(parseInline('<ftp://x>'), [{ type: 'text', text: '<ftp://x>' }]);
});

test('links: título descartado, parênteses no destino, destino entre <> com espaço e rótulo aninhado', () => {
  assert.equal(parseInline("[a](u.md 'título')")[0].href, 'u.md');
  assert.equal(parseInline('[w](https://pt.wikipedia.org/wiki/Rio_(cidade))')[0].href, 'https://pt.wikipedia.org/wiki/Rio_(cidade)');
  assert.equal(parseInline('[a](<meu arquivo.md>)')[0].href, 'meu arquivo.md');
  const [nested] = parseInline('[a [b] c](u)');
  assert.equal(nested.type, 'link');
  assert.equal(plainText(nested.children), 'a [b] c');
  assert.equal(parseInline('[**forte**](u)')[0].children[0].type, 'strong');
  assert.equal(parseInline('[a]()')[0].href, '');
});

test('não são links: colchete solto, espaço antes do parêntese e destino com espaço', () => {
  assert.deepEqual(parseInline('[a] (b)'), [{ type: 'text', text: '[a] (b)' }]);
  assert.deepEqual(parseInline('[sem fim'), [{ type: 'text', text: '[sem fim' }]);
  assert.deepEqual(parseInline('[a](b c d)'), [{ type: 'text', text: '[a](b c d)' }]);
  assert.deepEqual(parseInline('![só alt]'), [{ type: 'text', text: '![só alt]' }]);
});

test('imagem: alt é o texto cru do rótulo', () => {
  assert.deepEqual(parseInline('![logo *x*](a/b.png "t")'), [{ type: 'image', src: 'a/b.png', alt: 'logo *x*' }]);
});

test('wikilinks: espaços aparados, sem apelido o rótulo é o alvo; quebra de linha não vale', () => {
  assert.deepEqual(parseInline('[[  Pasta/Nota  ]]'), [{ type: 'wikilink', target: 'Pasta/Nota', label: 'Pasta/Nota' }]);
  assert.deepEqual(parseInline('[[a| b ]]'), [{ type: 'wikilink', target: 'a', label: 'b' }]);
  assert.ok(!parseInline('[[a\nb]]').some((n) => n.type === 'wikilink'));
});

test('código em linha: crases duplas aceitam crase dentro, um espaço de cada lado sai, quebra vira espaço', () => {
  assert.deepEqual(parseInline('`` a ` b ``'), [{ type: 'code', text: 'a ` b' }]);
  assert.deepEqual(parseInline('`a\nb`'), [{ type: 'code', text: 'a b' }]);
  assert.deepEqual(parseInline('`  x  `'), [{ type: 'code', text: ' x ' }]);
  assert.deepEqual(parseInline('`sem fim'), [{ type: 'text', text: '`sem fim' }]);
  assert.deepEqual(parseInline('`**não**`'), [{ type: 'code', text: '**não**' }]);
});

test('código em linha só fecha com sequência de crases do mesmo tamanho', () => {
  assert.deepEqual(parseInline('`a``b`'), [{ type: 'code', text: 'a``b' }]);
});

test('escapes: todo caractere da lista vira literal; barra antes de letra fica', () => {
  assert.equal(text('\\*\\_\\`\\[\\]\\#\\|\\~\\\\'), '*_`[]#|~\\');
  assert.equal(text('C:\\pasta'), 'C:\\pasta');
  assert.equal(text('\\[[nota]]'), '[[nota]]');
});

test('ênfases: __forte__, _ênfase_, aninhadas, e marcador com espaço depois não abre', () => {
  assert.equal(parseInline('__f__')[0].type, 'strong');
  assert.equal(parseInline('_e_')[0].type, 'em');
  const [outer] = parseInline('**a *b* c**');
  assert.equal(outer.type, 'strong');
  assert.equal(outer.children[1].type, 'em');
  assert.equal(parseInline('*a **b** c*')[0].type, 'em');
  assert.deepEqual(parseInline('* a*'), [{ type: 'text', text: '* a*' }]);
  assert.deepEqual(parseInline('**sem fim'), [{ type: 'text', text: '**sem fim' }]);
  assert.deepEqual(parseInline('_a_b'), [{ type: 'text', text: '_a_b' }]);
  assert.equal(parseInline('~~x y~~')[0].type, 'del');
});

test('quebra suave vira espaço e apara os espaços antes dela', () => {
  assert.deepEqual(parseInline('a \nb'), [{ type: 'text', text: 'a b' }]);
  assert.deepEqual(parseInline('a   \nb'), [{ type: 'text', text: 'a' }, { type: 'br' }, { type: 'text', text: 'b' }]);
});

test('barra invertida no fim da linha é quebra de linha', () => {
  assert.deepEqual(parseInline('a\\\nb'), [{ type: 'text', text: 'a' }, { type: 'br' }, { type: 'text', text: 'b' }]);
});

// ---------- destinos ----------

test('linkTarget: caminho absoluto do Windows é arquivo; esquemas perigosos e file: bloqueados', () => {
  assert.deepEqual(linkTarget('C:\\docs\\a.md'), { kind: 'file', path: 'C:\\docs\\a.md', anchor: '' });
  assert.deepEqual(linkTarget('d:/docs/a.md#x'), { kind: 'file', path: 'd:/docs/a.md', anchor: 'x' });
  assert.equal(linkTarget('file:///etc/passwd'), null);
  assert.equal(linkTarget('vbscript:msgbox'), null);
  assert.equal(linkTarget('JavaScript:alert(1)'), null);
  assert.equal(linkTarget('  javascript:alert(1)'), null);
});

test('linkTarget: http/https/mailto sem caixa, espaços aparados e âncora decodificada', () => {
  assert.deepEqual(linkTarget('MAILTO:a@b.c'), { kind: 'external', url: 'MAILTO:a@b.c' });
  assert.deepEqual(linkTarget('  HTTP://x.y  '), { kind: 'external', url: 'HTTP://x.y' });
  assert.deepEqual(linkTarget('#se%C3%A7%C3%A3o'), { kind: 'anchor', id: 'seção' });
  assert.equal(linkTarget('   '), null);
});

test('linkTarget: escape % inválido fica como está; arquivo sem âncora', () => {
  assert.deepEqual(linkTarget('%E0%A4%A.md'), { kind: 'file', path: '%E0%A4%A.md', anchor: '' });
  assert.deepEqual(linkTarget('../a.md'), { kind: 'file', path: '../a.md', anchor: '' });
  assert.deepEqual(linkTarget('a.md#'), { kind: 'file', path: 'a.md', anchor: '' });
});
