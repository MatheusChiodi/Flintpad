// Vaults recentes e preferências guardadas (electron/vaults.cjs): casos que tests/home.test.mjs não cobre.
// Rodar com `npm test`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const vaults = createRequire(import.meta.url)('../electron/vaults.cjs');
const win = process.platform === 'win32';

test('pushRecentVault: no Windows a mesma pasta com outra caixa não se repete', { skip: !win && 'só no Windows' }, () => {
  assert.deepEqual(vaults.pushRecentVault(['C:\\Notas', 'D:\\X'], 'c:\\notas'), ['c:\\notas', 'D:\\X']);
});

test('pushRecentVault: fora do Windows caixa diferente é outra pasta', { skip: win && 'só fora do Windows' }, () => {
  assert.deepEqual(vaults.pushRecentVault(['/Notas'], '/notas'), ['/notas', '/Notas']);
});

test('pushRecentVault: limite personalizado e pasta inválida só limpa a lista', () => {
  assert.deepEqual(vaults.pushRecentVault(['/a', '/b', '/c'], '/d', 2), ['/d', '/a']);
  assert.deepEqual(vaults.pushRecentVault(['/a', '/b', '/c'], null, 2), ['/a', '/b']);
  assert.deepEqual(vaults.pushRecentVault(['/a', 7], 42), ['/a']);
  assert.deepEqual(vaults.pushRecentVault('nao-lista', '/a'), ['/a']);
});

test('pushRecentVault não altera a lista recebida', () => {
  const list = ['/a', '/b'];
  vaults.pushRecentVault(list, '/c');
  assert.deepEqual(list, ['/a', '/b']);
});

test('pushRecentVault: reabrir o mais recente mantém a ordem', () => {
  assert.deepEqual(vaults.pushRecentVault(['/a', '/b', '/c'], '/a'), ['/a', '/b', '/c']);
});

test('forgetRecentVault: limpa itens inválidos e, no Windows, ignora a caixa', () => {
  assert.deepEqual(vaults.forgetRecentVault(['/a', null, '', 5, '/b'], '/x'), ['/a', '/b']);
  assert.deepEqual(vaults.forgetRecentVault(['/a', '/a', '/b'], '/a'), ['/b']);
  if (win) assert.deepEqual(vaults.forgetRecentVault(['C:\\Notas', 'D:\\X'], 'c:\\NOTAS'), ['D:\\X']);
});

test('sanitizeStoredPrefs: limite de 4096 bytes em JSON, inclusive', () => {
  const fits = { k: 'x'.repeat(4096 - JSON.stringify({ k: '' }).length) };
  assert.equal(JSON.stringify(fits).length, 4096);
  assert.equal(vaults.sanitizeStoredPrefs(fits), fits);
  const over = { k: `${fits.k}x` };
  assert.deepEqual(vaults.sanitizeStoredPrefs(over), {});
});

test('sanitizeStoredPrefs: objeto circular ou com BigInt vira vazio em vez de quebrar', () => {
  const circular = { a: 1 };
  circular.self = circular;
  assert.deepEqual(vaults.sanitizeStoredPrefs(circular), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs({ n: 10n }), {});
});

test('sanitizeStoredPrefs: número, booleano e função não são objetos de preferência', () => {
  assert.deepEqual(vaults.sanitizeStoredPrefs(3), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs(true), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs(() => {}), {});
  assert.deepEqual(vaults.sanitizeStoredPrefs({}), {});
});

test('MAX_RECENT_VAULTS é 8', () => {
  assert.equal(vaults.MAX_RECENT_VAULTS, 8);
});
