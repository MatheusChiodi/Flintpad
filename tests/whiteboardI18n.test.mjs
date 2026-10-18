// Quadro branco (src/whiteboard/i18n.ts): paridade dos dicionários pt-BR e en, placeholders e plurais.
// O módulo importa React e ../lib/i18n (TSX), então os dicionários são lidos do código-fonte e avaliados
// como literais de objeto. Rodar com `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/whiteboard/i18n.ts', import.meta.url), 'utf8');

/** Avalia o literal de objeto que começa em `start` (termina no `}` da linha que fecha). */
function literal(start, end) {
  const i = source.indexOf(start);
  assert.notEqual(i, -1, `início não encontrado: ${start}`);
  const j = source.indexOf(end, i);
  assert.notEqual(j, -1, `fim não encontrado: ${end}`);
  return new Function(`return (${source.slice(i + start.length - 1, j + 2)})`)();
}

const ptBR = literal('const ptBR = {', '\n} as const;');
const en = literal('const en: Record<Key, Entry> = {', '\n};');
const dictionaries = { 'pt-BR': ptBR, en };

const texts = (entry) => (typeof entry === 'string' ? [entry] : [entry.one, entry.other]);
const placeholders = (entry) => [...new Set(texts(entry).flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();

// Mesma lógica de useWbT, sem React, para testar a interpolação com os dicionários reais.
const translate = (language, key, vars) => {
  const entry = dictionaries[language][key] ?? ptBR[key];
  const text = typeof entry === 'string' ? entry : Number(vars?.count) === 1 ? entry.one : entry.other;
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text;
};

test('i18n: os dois dicionários foram lidos e não estão vazios', () => {
  assert.ok(Object.keys(ptBR).length > 100);
  assert.ok(Object.keys(en).length > 100);
});

test('i18n: en tem exatamente as mesmas chaves que pt-BR', () => {
  const pt = new Set(Object.keys(ptBR));
  const english = new Set(Object.keys(en));
  assert.deepEqual([...pt].filter((k) => !english.has(k)), [], 'faltando em en');
  assert.deepEqual([...english].filter((k) => !pt.has(k)), [], 'sobrando em en');
});

test('i18n: nenhuma chave repetida no código-fonte de cada dicionário', () => {
  for (const [start, end] of [
    ['const ptBR = {', '\n} as const;'],
    ['const en: Record<Key, Entry> = {', '\n};'],
  ]) {
    const i = source.indexOf(start);
    const body = source.slice(i, source.indexOf(end, i));
    const keys = [...body.matchAll(/^\s{2}(?:'([^']+)'|"([^"]+)"|([\w.#-]+)):/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
    const dupes = keys.filter((k, idx) => keys.indexOf(k) !== idx);
    assert.deepEqual(dupes, [], `chaves repetidas em ${start}`);
  }
});

test('i18n: cada entrada tem o mesmo formato (texto ou plural) nos dois idiomas', () => {
  for (const key of Object.keys(ptBR)) assert.equal(typeof en[key], typeof ptBR[key], key);
});

test('i18n: placeholders iguais em pt-BR e en para cada chave', () => {
  for (const key of Object.keys(ptBR)) assert.deepEqual(placeholders(en[key]), placeholders(ptBR[key]), key);
});

test('i18n: plurais têm one/other não vazios e usam {count}', () => {
  for (const [name, dict] of Object.entries(dictionaries))
    for (const [key, entry] of Object.entries(dict)) {
      if (typeof entry === 'string') continue;
      assert.deepEqual(Object.keys(entry).sort(), ['one', 'other'], `${name}:${key}`);
      assert.ok(entry.one.trim() && entry.other.trim(), `${name}:${key}`);
      assert.ok(entry.other.includes('{count}'), `${name}:${key} sem {count} no plural`);
    }
});

test('i18n: nenhum texto vazio e nenhuma chave malformada', () => {
  for (const [name, dict] of Object.entries(dictionaries))
    for (const [key, entry] of Object.entries(dict)) {
      for (const text of texts(entry)) {
        assert.equal(typeof text, 'string', `${name}:${key}`);
        assert.ok(text.trim().length > 0, `${name}:${key} vazio`);
        assert.equal(text, text.trim(), `${name}:${key} com espaço sobrando nas pontas`);
      }
    }
});

test('i18n: chaves usadas no código (error.<ParseError>) existem para todos os erros de leitura', () => {
  for (const error of ['too-large', 'invalid-json', 'not-a-board', 'newer-version', 'too-many-elements'])
    for (const dict of Object.values(dictionaries)) assert.ok(`error.${error}` in dict, `error.${error}`);
});

test('i18n: chaves de ferramenta cobrem todas as formas do modelo', () => {
  for (const kind of ['rectangle', 'ellipse', 'diamond', 'text', 'select', 'arrow'])
    for (const dict of Object.values(dictionaries)) assert.ok(`tool.${kind}` in dict, `tool.${kind}`);
});

test('i18n: chaves só com letras, números, ponto, hífen, sublinhado e # (cores)', () => {
  for (const key of Object.keys(ptBR)) assert.match(key, /^[\w.#-]+$/);
});

test('i18n: toda opção do modelo (cores, espessuras, estilos, pontas, tamanhos, fontes) tem rótulo', async () => {
  const m = await import('../src/whiteboard/model.ts');
  const wanted = [
    ...new Set([...m.STROKES, ...m.FILLS].map((c) => `color.${c}`)),
    ...m.STROKE_WIDTHS.map((w) => `width.${w}`),
    ...m.STROKE_STYLES.map((s) => `style.${s}`),
    ...m.ARROW_HEADS.map((h) => `head.${h}`),
    ...m.FONT_SIZES.map((s) => `size.${s}`),
    ...m.FONTS.map((f) => `font.${f}`),
    ...['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map((a) => `align.${a}`),
  ];
  for (const [name, dict] of Object.entries(dictionaries)) for (const key of wanted) assert.ok(key in dict, `${name}: ${key}`);
});

test('i18n: chaves com chaves balanceadas (nenhum "{" sem "}" e vice-versa)', () => {
  for (const [name, dict] of Object.entries(dictionaries))
    for (const [key, entry] of Object.entries(dict))
      for (const text of texts(entry)) {
        const stripped = text.replace(/\{\w+\}/g, '');
        assert.ok(!/[{}]/.test(stripped), `${name}:${key}: ${text}`);
      }
});

test('i18n: interpolação substitui variáveis e mantém as desconhecidas', () => {
  assert.equal(translate('pt-BR', 'duplicateNamed', { name: 'Plano' }), 'Duplicar Plano');
  assert.equal(translate('en', 'copyName', { name: 'X' }).includes('X'), true);
  assert.equal(translate('pt-BR', 'duplicateNamed', {}), 'Duplicar {name}');
  assert.equal(translate('pt-BR', 'duplicateNamed'), 'Duplicar {name}');
});

test('i18n: plural escolhe one só para count === 1', () => {
  assert.equal(translate('pt-BR', 'dropped', { count: 1 }), '1 item inválido foi ignorado.');
  assert.equal(translate('pt-BR', 'dropped', { count: 2 }), '2 itens inválidos foram ignorados.');
  assert.equal(translate('pt-BR', 'dropped', { count: 0 }), '0 itens inválidos foram ignorados.');
  assert.equal(translate('pt-BR', 'dropped', { count: '1' }), '1 item inválido foi ignorado.');
  assert.ok(translate('en', 'dropped', { count: 1 }).startsWith('1 '));
  assert.notEqual(translate('en', 'dropped', { count: 1 }), translate('en', 'dropped', { count: 3 }).replace('3', '1'));
});

test('i18n: en realmente traduz (a maioria dos textos difere de pt-BR)', () => {
  const keys = Object.keys(ptBR).filter((k) => typeof ptBR[k] === 'string');
  const same = keys.filter((k) => en[k] === ptBR[k]);
  // Siglas e termos iguais nas duas línguas (SVG, PNG, JSON, Link, M) são esperados, mas poucos.
  assert.ok(same.length <= 10, `iguais: ${same.join(', ')}`);
});

test('i18n: limites citados nos textos batem com o modelo (5 MB e 5000 elementos)', async () => {
  const m = await import('../src/whiteboard/model.ts');
  assert.equal(m.MAX_BOARD_BYTES, 5 * 1024 * 1024);
  for (const dict of Object.values(dictionaries)) {
    assert.match(dict['error.too-large'], /5\s?MB/);
    assert.match(dict['error.too-many-elements'], new RegExp(String(m.MAX_ELEMENTS)));
  }
});
