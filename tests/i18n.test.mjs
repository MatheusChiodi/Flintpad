// Traduções: src/lib/i18n.tsx (interface) e electron/i18n.cjs (menu, diálogos e erros do processo principal).
// O .tsx tem JSX e não carrega no Node: os dicionários são lidos do texto do arquivo e avaliados como objetos.
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronI18n = createRequire(import.meta.url)('../electron/i18n.cjs');

const source = fs.readFileSync(path.join(root, 'src/lib/i18n.tsx'), 'utf8');
function objectAfter(marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `achou ${marker}`);
  const open = source.indexOf('{', start + marker.length - 1);
  const close = source.indexOf('\n}', open);
  return new Function(`return ${source.slice(open, close + 2)}`)();
}
const ui = { 'pt-BR': objectAfter('const ptBR = {'), en: objectAfter('const en: Record<Key, Entry> = {') };

// Mesma regra de format(): `{nome}` é variável, `{{nome}}` é texto literal.
const placeholders = (entry) => {
  const texts = typeof entry === 'string' ? [entry] : [entry.one, entry.other];
  return [...new Set(texts.flatMap((text) => [...text.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1])))].sort();
};

function sourceFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, exts));
    else if (exts.test(entry.name)) out.push(full);
  }
  return out;
}

test('interface: en tem exatamente as mesmas chaves do português', () => {
  const pt = Object.keys(ui['pt-BR']);
  const en = Object.keys(ui.en);
  assert.ok(pt.length > 500, 'dicionário lido');
  assert.deepEqual(pt.filter((k) => !(k in ui.en)), [], 'faltando em en');
  assert.deepEqual(en.filter((k) => !(k in ui['pt-BR'])), [], 'sobrando em en');
});

test('interface: chaves não se repetem dentro do mesmo dicionário', () => {
  for (const marker of ['const ptBR = {', 'const en: Record<Key, Entry> = {']) {
    const start = source.indexOf(marker);
    const end = source.indexOf('\n}', start);
    const keys = [...source.slice(start, end).matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
    const dupes = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(dupes, [], marker);
  }
});

test('interface: as mesmas variáveis {x} nas duas línguas', () => {
  const diff = [];
  for (const [key, entry] of Object.entries(ui['pt-BR'])) {
    const a = placeholders(entry).join(',');
    const b = placeholders(ui.en[key]).join(',');
    if (a !== b) diff.push(`${key}: pt[${a}] en[${b}]`);
  }
  assert.deepEqual(diff, []);
});

test('interface: plural tem one e other nas duas línguas, e as duas formas usam as mesmas variáveis', () => {
  for (const language of ['pt-BR', 'en']) {
    for (const [key, entry] of Object.entries(ui[language])) {
      if (typeof entry === 'string') continue;
      assert.equal(typeof entry.one, 'string', `${language} ${key}.one`);
      assert.equal(typeof entry.other, 'string', `${language} ${key}.other`);
      assert.deepEqual(Object.keys(entry).sort(), ['one', 'other'], `${language} ${key}`);
      const vars = (text) => [...text.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort().join(',');
      assert.equal(vars(entry.one), vars(entry.other), `${language} ${key}`);
    }
  }
});

test('interface: se uma língua usa plural na chave, a outra também', () => {
  const mismatch = Object.keys(ui['pt-BR']).filter((key) => typeof ui['pt-BR'][key] !== typeof ui.en[key]);
  assert.deepEqual(mismatch, []);
});

test('interface: nenhum texto vazio nem com chaves desbalanceadas', () => {
  const bad = [];
  for (const language of ['pt-BR', 'en']) {
    for (const [key, entry] of Object.entries(ui[language])) {
      for (const text of typeof entry === 'string' ? [entry] : [entry.one, entry.other]) {
        if (!text.trim()) bad.push(`${language} ${key}: vazio`);
        const opens = (text.match(/\{/g) ?? []).length;
        const closes = (text.match(/\}/g) ?? []).length;
        if (opens !== closes) bad.push(`${language} ${key}: chaves`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('interface: toda chave literal usada em t(...), translate(...) ou <Trans k="..."> existe', () => {
  const missing = [];
  // O quadro branco tem dicionário próprio (src/whiteboard/i18n.ts, useWbT).
  for (const file of sourceFiles(path.join(root, 'src'), /\.(tsx?|mts)$/).filter((f) => !f.includes(`${path.sep}whiteboard${path.sep}`))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\b(?:t|translate)\(\s*'([a-zA-Z][\w.-]*)'/g)) if (!(match[1] in ui['pt-BR'])) missing.push(`${path.relative(root, file)}: ${match[1]}`);
    for (const match of text.matchAll(/\bk="([\w.-]+)"/g)) if (!(match[1] in ui['pt-BR'])) missing.push(`${path.relative(root, file)}: ${match[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('as duas camadas oferecem as mesmas línguas', () => {
  const uiLanguages = [...source.matchAll(/\['([\w-]+)', '[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(uiLanguages, ['pt-BR', 'en']);
  assert.deepEqual(electronI18n.LANGUAGES, uiLanguages);
  assert.deepEqual(Object.keys(electronI18n.strings), uiLanguages);
});

test('processo principal: en tem as mesmas chaves do português', () => {
  const pt = Object.keys(electronI18n.strings['pt-BR']);
  const en = Object.keys(electronI18n.strings.en);
  assert.deepEqual(pt.filter((k) => !en.includes(k)), []);
  assert.deepEqual(en.filter((k) => !pt.includes(k)), []);
});

test('processo principal: mesmas variáveis e nenhum texto vazio', () => {
  for (const [key, text] of Object.entries(electronI18n.strings['pt-BR'])) {
    assert.ok(text.trim(), `pt-BR ${key}`);
    assert.ok(electronI18n.strings.en[key].trim(), `en ${key}`);
    assert.deepEqual(placeholders(text), placeholders(electronI18n.strings.en[key]), key);
  }
});

test('processo principal: toda chave usada em t(...) nos módulos do electron existe', () => {
  const missing = [];
  for (const file of sourceFiles(path.join(root, 'electron'), /\.(c|m)?js$/)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([\w.-]+)'/g)) if (!(match[1] in electronI18n.strings['pt-BR'])) missing.push(`${path.basename(file)}: ${match[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('translator: língua escolhida, variáveis trocadas e variável desconhecida mantida', () => {
  const pt = electronI18n.translator('pt-BR');
  const en = electronI18n.translator('en');
  assert.equal(pt('menu.file'), 'Arquivo');
  assert.equal(en('menu.file'), electronI18n.strings.en['menu.file']);
  assert.notEqual(en('menu.file'), pt('menu.file'));
  const key = Object.keys(electronI18n.strings['pt-BR']).find((k) => placeholders(electronI18n.strings['pt-BR'][k]).length);
  assert.ok(key, 'há ao menos um texto com variável');
  const [name] = placeholders(electronI18n.strings['pt-BR'][key]);
  assert.ok(pt(key, { [name]: 'XYZ' }).includes('XYZ'));
  assert.ok(pt(key, { outra: 1 }).includes(`{${name}}`));
  assert.ok(pt(key).includes(`{${name}}`));
});

test('translator: língua desconhecida cai no português; chave desconhecida volta a própria chave', () => {
  const fr = electronI18n.translator('fr');
  assert.equal(fr('menu.edit'), electronI18n.strings['pt-BR']['menu.edit']);
  assert.equal(fr('nao.existe'), 'nao.existe');
  assert.equal(electronI18n.translator('en')('nao.existe', { a: 1 }), 'nao.existe');
});

test('translator: valor numérico e zero viram texto', () => {
  const t = electronI18n.translator('pt-BR');
  const key = Object.keys(electronI18n.strings['pt-BR']).find((k) => placeholders(electronI18n.strings['pt-BR'][k]).length);
  const [name] = placeholders(electronI18n.strings['pt-BR'][key]);
  assert.ok(t(key, { [name]: 0 }).includes('0'));
});
