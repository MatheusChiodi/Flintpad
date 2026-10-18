// Caminhos absolutos do disco no renderer (Windows aceita \ e /; a grafia devolvida usa o separador da raiz).

const SEPARATORS = /[\\/]+/;

export const separatorOf = (path: string) => (path.includes('\\') || /^[a-z]:/i.test(path) ? '\\' : '/');

export function baseName(path: string) {
  const parts = path.split(SEPARATORS).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function dirName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, '');
  // A própria raiz ("C:\", "/") não tem pasta acima: continua sendo a raiz.
  if (trimmed !== path && /^[a-z]:$/i.test(trimmed)) return trimmed + separatorOf(path);
  if (!trimmed && path) return path[0];
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (index < 0) return '';
  const dir = trimmed.slice(0, index);
  // "C:" sozinho não é pasta: a raiz do disco é "C:\".
  return /^[a-z]:$/i.test(dir) ? dir + separatorOf(path) : dir || '/';
}

export function joinPath(base: string, ...parts: string[]) {
  const sep = separatorOf(base);
  // Sem o separador final da base: "C:\" + "a" é "C:\a" (não "C:\\a") e "/" + "a" é "/a".
  const out: string[] = base.replace(/[\\/]+$/, '').split(SEPARATORS);
  for (const part of parts) {
    for (const segment of part.split(SEPARATORS)) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (out.length > 1) out.pop();
      } else out.push(segment);
    }
  }
  // Só a unidade ("C:") volta a ser a raiz do disco ("C:\").
  const joined = out.length === 1 && /^[a-z]:$/i.test(out[0]) ? out[0] + sep : out.join(sep);
  return base.startsWith('/') && !joined.startsWith('/') ? '/' + joined : joined;
}

/** Extensão com o ponto, em minúsculas: ".ts". Arquivos como ".gitignore" não têm extensão. */
export function extName(path: string) {
  const name = baseName(path);
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index).toLowerCase() : '';
}

const key = (path: string) => path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

export const samePath = (a: string, b: string) => key(a) === key(b);

export function isInside(child: string, parent: string) {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(p + '/');
}

/** Caminho relativo à raiz, com "/" (como o VS Code mostra na busca de arquivos). */
export function relativePath(root: string | null, path: string) {
  if (!root || !isInside(path, root)) return path;
  return path.replace(/\\/g, '/').slice(root.replace(/[\\/]+$/, '').length + 1);
}
