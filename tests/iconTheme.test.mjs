// Temas de ícones de arquivo (src/lib/iconTheme.ts). Rodar com `npm test`.
// O módulo importa './paths' sem extensão (o Vite resolve) e usa window.api, FontFace e document.fonts:
// aqui um resolvedor só deste teste acrescenta ".ts" e os globais do navegador são simulados.
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { register } from 'node:module';
import { test } from 'node:test';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context);
    throw error;
  }
}`),
);

const files = new Map();
const reads = [];
const fontsAdded = [];
globalThis.window = {
  api: {
    extReadJsonc: async (path) => (files.has(path) ? structuredClone(files.get(path)) : null),
    extReadBinary: async (path) => {
      reads.push(path);
      if (path.includes('missing')) throw new Error('ENOENT');
      return new Uint8Array([1, 2, 3]);
    },
  },
};
globalThis.FontFace = class {
  constructor(family, buffer, descriptors) {
    this.family = family;
    this.descriptors = descriptors;
  }
  async load() {}
};
globalThis.document = { fonts: { add: (face) => fontsAdded.push(face) } };

const { iconImageUrl, loadIconTheme } = await import('../src/lib/iconTheme.ts');

const ROOT = 'D:\\ext\\seti';
const imageTheme = {
  hidesExplorerArrows: true,
  iconDefinitions: {
    _file: { iconPath: './img/file.svg' },
    _ts: { iconPath: './img/ts.svg' },
    _test: { iconPath: './img/test.svg' },
    _pkg: { iconPath: 'img/pkg.svg' },
    _lang: { iconPath: 'img/lang.svg' },
    _folder: { iconPath: 'img/folder.svg' },
    _folderOpen: { iconPath: 'img/folder-open.svg' },
    _src: { iconPath: 'img/src.svg' },
    _srcOpen: { iconPath: 'img/src-open.svg' },
    _root: { iconPath: 'img/root.svg' },
    _rootOpen: { iconPath: 'img/root-open.svg' },
    _light_ts: { iconPath: 'img/ts-light.svg' },
  },
  file: '_file',
  folder: '_folder',
  folderExpanded: '_folderOpen',
  rootFolder: '_root',
  rootFolderExpanded: '_rootOpen',
  folderNames: { src: '_src', lib: '_src' },
  folderNamesExpanded: { src: '_srcOpen' },
  fileExtensions: { ts: '_ts', 'test.ts': '_test', md: '_nao_existe' },
  fileNames: { 'package.json': '_pkg' },
  languageIds: { python: '_lang' },
  light: { fileExtensions: { ts: '_light_ts' } },
};
files.set(`${ROOT}\\icons.json`, imageTheme);

const img = (name) => ({ kind: 'image', path: `${ROOT}\\img\\${name}` });

test('loadIconTheme: ícone de imagem com caminho resolvido a partir da pasta do tema', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.equal(theme.hidesExplorerArrows, true);
  assert.deepEqual(theme.forFile('D:\\p\\a.ts'), img('ts.svg'));
  assert.deepEqual(theme.forFile('/home/u/x.unknown'), img('file.svg'));
});

test('forFile: nome exato vence extensão e ignora caixa', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.deepEqual(theme.forFile('D:\\p\\Package.JSON'), img('pkg.svg'));
  assert.deepEqual(theme.forFile('D:\\p\\APP.TS'), img('ts.svg'));
});

test('forFile: extensão composta ("test.ts") é procurada antes da simples ("ts")', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.deepEqual(theme.forFile('D:\\p\\a.test.ts'), img('test.svg'));
  assert.deepEqual(theme.forFile('D:\\p\\a.spec.ts'), img('ts.svg'));
});

test('forFile: sem nome nem extensão usa o languageId e, por fim, o ícone padrão', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.deepEqual(theme.forFile('D:\\p\\script', 'python'), img('lang.svg'));
  assert.deepEqual(theme.forFile('D:\\p\\script', 'rust'), img('file.svg'));
  assert.deepEqual(theme.forFile('D:\\p\\script'), img('file.svg'));
});

test('forFile: associação para definição inexistente devolve null', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.equal(theme.forFile('D:\\p\\README.md'), null);
});

test('tema claro: associações de "light" primeiro, o resto cai nas gerais', async () => {
  const light = await loadIconTheme(`${ROOT}\\icons.json`, true);
  assert.deepEqual(light.forFile('D:\\p\\a.ts'), img('ts-light.svg'));
  assert.deepEqual(light.forFile('D:\\p\\package.json'), img('pkg.svg'));
  const dark = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.deepEqual(dark.forFile('D:\\p\\a.ts'), img('ts.svg'));
});

test('forFolder: nome da pasta, versão aberta e recuo para a fechada', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.deepEqual(theme.forFolder('D:\\p\\SRC', false), img('src.svg'));
  assert.deepEqual(theme.forFolder('D:\\p\\src', true), img('src-open.svg'));
  // "lib" não tem versão aberta: usa a fechada
  assert.deepEqual(theme.forFolder('D:\\p\\lib', true), img('src.svg'));
  assert.deepEqual(theme.forFolder('D:\\p\\outra', false), img('folder.svg'));
  assert.deepEqual(theme.forFolder('D:\\p\\outra', true), img('folder-open.svg'));
});

test('forFolder: raiz tem ícone próprio, mas nome conhecido ainda vence', async () => {
  const theme = await loadIconTheme(`${ROOT}\\icons.json`, false);
  assert.deepEqual(theme.forFolder('D:\\proj', false, true), img('root.svg'));
  assert.deepEqual(theme.forFolder('D:\\proj', true, true), img('root-open.svg'));
  assert.deepEqual(theme.forFolder('D:\\src', false, true), img('src.svg'));
});

test('forFolder: sem folderExpanded, a pasta aberta usa o ícone da fechada', async () => {
  files.set('D:\\ext\\min\\t.json', { iconDefinitions: { f: { iconPath: 'f.svg' } }, folder: 'f' });
  const theme = await loadIconTheme('D:\\ext\\min\\t.json', false);
  assert.deepEqual(theme.forFolder('/x/y', true), { kind: 'image', path: 'D:\\ext\\min\\f.svg' });
  assert.equal(theme.forFile('/x/y.ts'), null);
});

test('tema ausente ou ilegível: nada de ícones e setas visíveis', async () => {
  const theme = await loadIconTheme('D:\\nao\\existe.json', false);
  assert.equal(theme.hidesExplorerArrows, false);
  assert.equal(theme.forFile('a.ts'), null);
  assert.equal(theme.forFolder('src', true, true), null);
});

test('fonte de ícones: caractere "\\E001" decodificado, cor e tamanho padrão da fonte', async () => {
  files.set('D:\\ext\\font\\t.json', {
    fonts: [{ id: 'seti', src: [{ path: './seti.woff' }], size: '150%' }],
    iconDefinitions: {
      _ts: { fontCharacter: '\\E001', fontColor: '#519aba' },
      _big: { fontCharacter: '\\e00a', fontSize: '200%' },
      _other: { fontCharacter: '\\E002', fontId: 'sem-fonte' },
    },
    fileExtensions: { ts: '_ts', big: '_big', o: '_other' },
  });
  const before = fontsAdded.length;
  const theme = await loadIconTheme('D:\\ext\\font\\t.json', false);
  assert.ok(reads.includes('D:\\ext\\font\\seti.woff'));
  assert.equal(fontsAdded.length, before + 1);
  const icon = theme.forFile('a.ts');
  assert.equal(icon.kind, 'font');
  assert.equal(icon.char, '\uE001');
  assert.equal(icon.color, '#519aba');
  assert.equal(icon.size, '150%');
  assert.equal(icon.fontFamily, fontsAdded.at(-1).family);
  assert.equal(theme.forFile('a.big').char, '\uE00A');
  assert.equal(theme.forFile('a.big').size, '200%');
  // fontId que não foi carregada: sem ícone
  assert.equal(theme.forFile('a.o'), null);
});

test('fonte que falha ao carregar deixa os ícones dela de fora sem derrubar o tema', async () => {
  files.set('D:\\ext\\broken\\t.json', {
    fonts: [{ id: 'f', src: [{ path: 'missing.woff' }] }],
    iconDefinitions: { _ts: { fontCharacter: '\\E001' }, _img: { iconPath: 'a.png' } },
    fileExtensions: { ts: '_ts', png: '_img' },
  });
  const theme = await loadIconTheme('D:\\ext\\broken\\t.json', false);
  assert.equal(theme.forFile('a.ts'), null);
  assert.deepEqual(theme.forFile('x.png'), { kind: 'image', path: 'D:\\ext\\broken\\a.png' });
});

test('famílias de fonte são únicas a cada carga do tema', async () => {
  const a = await loadIconTheme('D:\\ext\\font\\t.json', false);
  const b = await loadIconTheme('D:\\ext\\font\\t.json', false);
  assert.notEqual(a.forFile('a.ts').fontFamily, b.forFile('a.ts').fontFamily);
});

test('iconImageUrl: lê uma vez por caminho e serve como blob com o tipo certo', async () => {
  const count = () => reads.filter((p) => p === 'D:\\i\\a.SVG').length;
  const first = iconImageUrl('D:\\i\\a.SVG');
  const second = iconImageUrl('D:\\i\\a.SVG');
  assert.equal(first, second);
  const url = await first;
  assert.equal(count(), 1);
  assert.ok(url.startsWith('blob:'));
  assert.equal(resolveObjectURL(url).type, 'image/svg+xml');
  assert.equal(resolveObjectURL(await iconImageUrl('D:\\i\\b.png')).type, 'image/png');
  assert.equal(resolveObjectURL(await iconImageUrl('D:\\i\\c.ico')).type, 'application/octet-stream');
});
