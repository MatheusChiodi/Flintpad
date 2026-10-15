'use strict';

// Lista de vaults recentes e preferências guardadas no config.json.
// Funções puras: o processo principal grava o resultado; os testes importam este arquivo direto.

const MAX_RECENT_VAULTS = 8;
// Preferências da interface: o renderer valida campo a campo; aqui só se barra o que não é objeto ou é grande demais.
const MAX_PREFS_BYTES = 4096;

const sameFolder = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// O vault aberto vai para o topo; repetidos (inclusive com outra caixa no Windows) saem.
function pushRecentVault(list, folder, max = MAX_RECENT_VAULTS) {
  const clean = Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item) : [];
  if (typeof folder !== 'string' || !folder) return clean.slice(0, max);
  return [folder, ...clean.filter((item) => !sameFolder(item, folder))].slice(0, max);
}

function forgetRecentVault(list, folder) {
  const clean = Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item) : [];
  return clean.filter((item) => !sameFolder(item, folder));
}

function sanitizeStoredPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  try {
    return JSON.stringify(raw).length <= MAX_PREFS_BYTES ? raw : {};
  } catch {
    return {};
  }
}

module.exports = { MAX_RECENT_VAULTS, pushRecentVault, forgetRecentVault, sanitizeStoredPrefs };
