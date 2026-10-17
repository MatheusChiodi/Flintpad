// Regras do navegador embutido (src/lib/browser.ts). Rodar com `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { comboOf, displayUrl, resolveInput, suggest, topSites, INTERNAL } from '../src/lib/browser.ts';

test('resolveInput: endereços viram URL, o resto vira busca', () => {
  assert.equal(resolveInput('github.com', 'google'), 'https://github.com');
  assert.equal(resolveInput('github.com/anthropics?q=1', 'google'), 'https://github.com/anthropics?q=1');
  assert.equal(resolveInput('localhost:5173', 'google'), 'http://localhost:5173');
  assert.equal(resolveInput('192.168.0.1', 'google'), 'http://192.168.0.1');
  assert.equal(resolveInput('https://x.dev/a b', 'google'), 'https://x.dev/a b');
  assert.equal(resolveInput('mailto:a@b.com', 'google'), 'mailto:a@b.com');
  assert.equal(resolveInput('C:\\Users\\a\\f.pdf', 'google'), 'file:///C:/Users/a/f.pdf');
  assert.equal(resolveInput('como fazer pão', 'google'), 'https://www.google.com/search?q=como%20fazer%20p%C3%A3o');
  assert.equal(resolveInput('node.js tutorial', 'duckduckgo'), 'https://duckduckgo.com/?q=node.js%20tutorial');
  assert.equal(resolveInput('flintpad', 'bing'), 'https://www.bing.com/search?q=flintpad');
  assert.equal(resolveInput('   ', 'google'), INTERNAL.newTab);
});

test('displayUrl: sem https:// e sem a barra final da raiz', () => {
  assert.equal(displayUrl('https://www.google.com/'), 'www.google.com');
  assert.equal(displayUrl('https://x.dev/a/'), 'x.dev/a/');
  assert.equal(displayUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(displayUrl(INTERNAL.newTab), '');
});

test('suggest: digitado primeiro, depois favoritos e histórico mais visitado', () => {
  const history = [
    { url: 'https://react.dev/learn', title: 'Aprender React', time: 1 },
    { url: 'https://react.dev/learn', title: 'Aprender React', time: 5 },
    { url: 'https://reactrouter.com/', title: 'React Router', time: 9 },
  ];
  const bookmarks = [{ id: '1', url: 'https://react.dev/', title: 'React' }];
  const list = suggest('react', 'google', bookmarks, history);
  assert.deepEqual(list.map((s) => s.kind), ['search', 'bookmark', 'history', 'history']);
  assert.equal(list[2].url, 'https://react.dev/learn');
  const typed = suggest('react.dev', 'google', [], []);
  assert.deepEqual(typed.map((s) => [s.kind, s.url]), [['url', 'https://react.dev'], ['search', 'https://www.google.com/search?q=react.dev']]);
});

test('topSites: um por site, os mais visitados primeiro', () => {
  const sites = topSites([
    { url: 'https://a.com/1', title: 'A', time: 1 },
    { url: 'https://b.com/', title: 'B', time: 2 },
    { url: 'https://a.com/2', title: 'A2', time: 3 },
    { url: 'file:///x', title: 'X', time: 4 },
  ]);
  assert.deepEqual(sites.map((s) => s.url), ['https://a.com/2', 'https://b.com/']);
});

test('comboOf: nome do atalho igual para o DOM e para o before-input-event', () => {
  assert.equal(comboOf({ key: 't', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+T');
  assert.equal(comboOf({ key: 't', control: true }), 'Ctrl+T');
  assert.equal(comboOf({ key: 'ArrowLeft', alt: true }), 'Alt+ArrowLeft');
  assert.equal(comboOf({ key: '+', ctrlKey: true }), 'Ctrl+=');
});
