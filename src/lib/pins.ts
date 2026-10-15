// Favoritos e páginas recentes de um vault. Funções puras: quem chama decide quando gravar.
// Toda função devolve o mesmo objeto quando nada muda, para o chamador poder comparar por referência.

export type Pins = { favorites: string[]; recents: string[] };

// O mínimo de Storage que usamos: nos testes entra um objeto em memória.
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export const MAX_RECENTS = 20;

export const emptyPins: Pins = { favorites: [], recents: [] };

// Uma chave por vault: cada pasta tem suas próprias listas.
export const pinsKey = (vault: string) => `obnotion:pins:${vault}`;

const unique = (paths: string[]) => [...new Set(paths)];

const cleanList = (value: unknown) =>
  Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === 'string' && item !== '')) : [];

// Aceita qualquer coisa que venha do armazenamento: texto inválido vira listas vazias.
export function parsePins(raw: string | null | undefined): Pins {
  if (!raw) return emptyPins;
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof Pins, unknown>> | null;
    return { favorites: cleanList(data?.favorites), recents: cleanList(data?.recents).slice(0, MAX_RECENTS) };
  } catch {
    return emptyPins;
  }
}

export const isFavorite = (pins: Pins, path: string) => pins.favorites.includes(path);

export function addFavorite(pins: Pins, path: string): Pins {
  if (!path || isFavorite(pins, path)) return pins;
  return { ...pins, favorites: [...pins.favorites, path] };
}

export function removeFavorite(pins: Pins, path: string): Pins {
  if (!isFavorite(pins, path)) return pins;
  return { ...pins, favorites: pins.favorites.filter((p) => p !== path) };
}

export const toggleFavorite = (pins: Pins, path: string) =>
  isFavorite(pins, path) ? removeFavorite(pins, path) : addFavorite(pins, path);

// A página aberta vai para o começo da lista, sem repetir; as mais antigas saem pelo fim.
export function touchRecent(pins: Pins, path: string): Pins {
  if (!path || pins.recents[0] === path) return pins;
  return { ...pins, recents: [path, ...pins.recents.filter((p) => p !== path)].slice(0, MAX_RECENTS) };
}

// Tira uma página só das recentes (o favorito, se houver, fica).
export function removeRecent(pins: Pins, path: string): Pins {
  if (!pins.recents.includes(path)) return pins;
  return { ...pins, recents: pins.recents.filter((p) => p !== path) };
}

export const clearRecents = (pins: Pins): Pins => (pins.recents.length ? { ...pins, recents: [] } : pins);

// A página renomeada mantém o lugar nas duas listas.
export function renamePath(pins: Pins, from: string, to: string): Pins {
  if (from === to || !(pins.favorites.includes(from) || pins.recents.includes(from))) return pins;
  const swap = (paths: string[]) => (paths.includes(from) ? unique(paths.map((p) => (p === from ? to : p))) : paths);
  return { favorites: swap(pins.favorites), recents: swap(pins.recents) };
}

export function removePath(pins: Pins, path: string): Pins {
  if (!(pins.favorites.includes(path) || pins.recents.includes(path))) return pins;
  return { favorites: pins.favorites.filter((p) => p !== path), recents: pins.recents.filter((p) => p !== path) };
}

// Tira das listas o que não existe mais no vault (apagado ou movido por fora do app).
export function prunePins(pins: Pins, existing: Iterable<string>): Pins {
  const known = new Set(existing);
  const favorites = pins.favorites.filter((p) => known.has(p));
  const recents = pins.recents.filter((p) => known.has(p));
  if (favorites.length === pins.favorites.length && recents.length === pins.recents.length) return pins;
  return { favorites, recents };
}

export function loadPins(vault: string, store: Store = localStorage): Pins {
  try {
    return parsePins(store.getItem(pinsKey(vault)));
  } catch {
    // armazenamento indisponível: começa sem listas
    return emptyPins;
  }
}

export function savePins(vault: string, pins: Pins, store: Store = localStorage) {
  try {
    store.setItem(pinsKey(vault), JSON.stringify(pins));
  } catch (error) {
    // As listas ainda valem nesta sessão; o erro fica no console.
    console.error('pins:save', error);
  }
}
