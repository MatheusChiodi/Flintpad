// Teste de ponta a ponta do quadro branco no app real (Electron, build de produção em dist/).
// Usa os ganchos de teste que o app já tem (OBNOTION_SHOT/OBNOTION_EVAL: janela fora da tela, um script
// no renderer, captura e saída), sem dependências novas. Rodar com `npm run test:e2e` (faz o build antes).
//
// 1ª execução: cria um quadro, desenha duas formas, move uma, liga as duas com uma seta e exporta SVG e PNG.
// 2ª execução (app reaberto): abre o quadro e confere que a gravação automática guardou tudo.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electron = createRequire(import.meta.url)('electron');
const work = mkdtempSync(path.join(tmpdir(), 'obnotion-wb-e2e-'));
const vault = path.join(work, 'vault');
const downloads = path.join(work, 'downloads');
after(() => rmSync(work, { recursive: true, force: true }));

// Roda dentro da página. Devolve um texto: o resultado vai para o console como "E2E {...}".
const helpers = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, label, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await wait(50); }
    throw new Error('timeout: ' + label);
  };
  const report = (data) => console.log('E2E ' + JSON.stringify(data));
  const elements = () => [...document.querySelectorAll('[data-element-id]')].map((g) => ({
    id: g.dataset.elementId, kind: g.dataset.kind,
    x: g.dataset.x === undefined ? null : Number(g.dataset.x), y: g.dataset.y === undefined ? null : Number(g.dataset.y),
  }));
`;

const createScript = `(async () => { ${helpers}
  try {
    (await until(() => document.querySelector('[data-testid=wb-new]'), 'botão novo')).click();
    const canvas = await until(() => document.querySelector('[data-testid=wb-canvas]'), 'canvas');
    const svg = canvas.querySelector('svg');
    const box = svg.getBoundingClientRect();
    const fire = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: box.left + x, clientY: box.top + y,
    }));
    const drag = async (x1, y1, x2, y2) => {
      fire('pointerdown', x1, y1); await wait(40);
      fire('pointermove', (x1 + x2) / 2, (y1 + y2) / 2); await wait(40);
      fire('pointermove', x2, y2); await wait(40);
      fire('pointerup', x2, y2); await wait(120);
    };
    const key = (k) => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    key('r');                                   // atalho de teclado: retângulo
    await wait(60);
    await drag(100, 150, 260, 230);
    document.querySelector('[data-testid=wb-tool-ellipse]').click();   // barra de ferramentas: elipse
    await wait(60);
    await drag(500, 150, 660, 230);
    await drag(180, 190, 220, 290);             // move o retângulo 40 px para a direita e 100 px para baixo
    key('a');                                   // seta, do centro do retângulo ao centro da elipse
    await wait(60);
    await drag(220, 290, 580, 190);
    await until(() => document.querySelector('[data-testid=wb-status]')?.textContent === 'Saved', 'gravação automática');
    const drawn = elements();
    document.querySelector('[data-testid=wb-export-svg]').click();
    await wait(400);
    document.querySelector('[data-testid=wb-export-png]').click();
    await wait(2000);
    report({ ok: true, elements: drawn });
  } catch (error) { report({ ok: false, error: String(error) }); }
})()`;

const reopenScript = `(async () => { ${helpers}
  try {
    const row = await until(() => document.querySelector('[data-testid=wb-list] button[title$=".whiteboard.json"]'), 'quadro na lista');
    row.click();
    await until(() => document.querySelectorAll('[data-element-id]').length >= 3, 'elementos do quadro');
    report({ ok: true, name: row.textContent, elements: elements(), lines: document.querySelectorAll('[data-kind=arrow] line').length });
  } catch (error) { report({ ok: false, error: String(error) }); }
})()`;

function runApp(script, shot) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      OBNOTION_SHOT: path.join(work, shot),
      OBNOTION_SHOT_DELAY: '2500',
      OBNOTION_EVAL: script,
      OBNOTION_VAULT: vault,
      OBNOTION_OPEN: '::whiteboards',
      OBNOTION_LANG: 'en',
      OBNOTION_USER_DATA: path.join(work, 'userdata'),
      OBNOTION_DOWNLOAD_DIR: downloads,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    const child = spawn(electron, [root], { env, cwd: root });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`o app não terminou a tempo:\n${output}`));
    }, 60_000);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = output.split(/\r?\n/).find((l) => l.includes('E2E {'));
      if (!line) return reject(new Error(`o script de teste não respondeu:\n${output}`));
      resolve(JSON.parse(line.slice(line.indexOf('E2E ') + 4)));
    });
  });
}

test('quadro branco: criar, desenhar, mover, ligar, gravar sozinho, reabrir e exportar', { timeout: 150_000 }, async () => {
  assert.ok(existsSync(path.join(root, 'dist', 'index.html')), 'rode `npm run build` antes (o `npm run test:e2e` já faz isso)');
  mkdirSync(vault, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  writeFileSync(path.join(vault, 'Welcome.md'), '# Welcome\n');

  const first = await runApp(createScript, 'create.png');
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(first.elements.map((e) => e.kind), ['rectangle', 'ellipse', 'arrow']);
  assert.deepEqual([first.elements[0].x, first.elements[0].y], [140, 250]);

  // O arquivo no vault tem o formato versionado, a forma movida e a seta presa às duas formas.
  const folder = path.join(vault, 'Whiteboards');
  const [file] = readdirSync(folder).filter((name) => name.endsWith('.whiteboard.json'));
  assert.ok(file, 'arquivo do quadro criado em Whiteboards/');
  const saved = JSON.parse(readFileSync(path.join(folder, file), 'utf8'));
  assert.equal(saved.format, 'obnotion-whiteboard');
  assert.equal(saved.version, 1);
  const [rectangle, ellipse, arrow] = saved.elements;
  assert.deepEqual([rectangle.kind, rectangle.x, rectangle.y, rectangle.w, rectangle.h], ['rectangle', 140, 250, 160, 80]);
  assert.deepEqual([ellipse.kind, ellipse.x, ellipse.y], ['ellipse', 500, 150]);
  assert.deepEqual([arrow.kind, arrow.start, arrow.end], ['arrow', { shape: rectangle.id }, { shape: ellipse.id }]);

  // Exportações: SVG com as formas e a seta; PNG válido.
  const exported = readdirSync(downloads);
  const svgFile = exported.find((name) => name.endsWith('.svg'));
  const pngFile = exported.find((name) => name.endsWith('.png'));
  assert.ok(svgFile && pngFile, `arquivos exportados: ${exported.join(', ')}`);
  const svg = readFileSync(path.join(downloads, svgFile), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<rect x="140" y="250" width="160" height="80"/);
  assert.match(svg, /<ellipse /);
  assert.match(svg, /<line /);
  const png = readFileSync(path.join(downloads, pngFile));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.length > 1000);

  // App reaberto: o quadro volta igual.
  const second = await runApp(reopenScript, 'reopen.png');
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(second.elements, first.elements);
  assert.equal(second.lines, 1);
});
