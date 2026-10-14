// Temas de ícones de arquivo do VS Code (Seti, Minimal, Modern e os instalados).
// Dois formatos: fonte de ícones (fontCharacter + fontColor) ou imagem por ícone (iconPath, SVG/PNG).
import { baseName, dirName, joinPath } from './paths';

type IconDefinition = { fontCharacter?: string; fontColor?: string; fontId?: string; fontSize?: string; iconPath?: string };

type Associations = {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  rootFolder?: string;
  rootFolderExpanded?: string;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
};

type IconThemeJson = Associations & {
  iconDefinitions?: Record<string, IconDefinition>;
  fonts?: { id: string; src: { path: string; format?: string }[]; weight?: string; style?: string; size?: string }[];
  hidesExplorerArrows?: boolean;
  light?: Associations;
  highContrast?: Associations;
};

export type FileIcon = { kind: 'font'; char: string; color?: string; fontFamily: string; size?: string } | { kind: 'image'; path: string };

export type IconTheme = {
  hidesExplorerArrows: boolean;
  forFile(path: string, languageId?: string): FileIcon | null;
  forFolder(path: string, expanded: boolean, root?: boolean): FileIcon | null;
};

let fontSerial = 0;

// "\E001" no JSON vira o caractere U+E001.
const decodeCharacter = (value: string) => value.replace(/\\([0-9a-f]{1,6})/gi, (_all, hex: string) => String.fromCodePoint(parseInt(hex, 16)));

export async function loadIconTheme(path: string, light: boolean): Promise<IconTheme> {
  const json = (await window.api.extReadJsonc<IconThemeJson>(path)) ?? {};
  const folder = dirName(path);
  const definitions = json.iconDefinitions ?? {};

  const fontFamilies = new Map<string, string>();
  await Promise.all(
    (json.fonts ?? []).map(async (font) => {
      const src = font.src?.[0];
      if (!src) return;
      try {
        const bytes = await window.api.extReadBinary(joinPath(folder, src.path));
        const family = `obnotion-icons-${++fontSerial}`;
        const face = new FontFace(family, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { weight: font.weight ?? 'normal', style: font.style ?? 'normal' });
        await face.load();
        document.fonts.add(face);
        fontFamilies.set(font.id, family);
      } catch {
        // fonte ausente: os ícones desse tema ficam de fora
      }
    }),
  );
  const defaultFont = json.fonts?.[0]?.id;
  const defaultSize = json.fonts?.[0]?.size;

  const toIcon = (id: string | undefined): FileIcon | null => {
    const definition = id ? definitions[id] : undefined;
    if (!definition) return null;
    if (definition.iconPath) return { kind: 'image', path: joinPath(folder, definition.iconPath) };
    if (definition.fontCharacter) {
      const fontFamily = fontFamilies.get(definition.fontId ?? defaultFont ?? '');
      if (!fontFamily) return null;
      return { kind: 'font', char: decodeCharacter(definition.fontCharacter), color: definition.fontColor, fontFamily, size: definition.fontSize ?? defaultSize };
    }
    return null;
  };

  // No tema claro, as associações de "light" vêm primeiro; o que faltar cai nas gerais.
  const layers = light && json.light ? [json.light, json] : [json];
  const lookup = (pick: (layer: Associations) => string | undefined) => {
    for (const layer of layers) {
      const id = pick(layer);
      if (id) return id;
    }
    return undefined;
  };

  return {
    hidesExplorerArrows: Boolean(json.hidesExplorerArrows),
    forFile(file, languageId) {
      const name = baseName(file).toLowerCase();
      const byName = lookup((layer) => layer.fileNames?.[name]);
      if (byName) return toIcon(byName);
      // "a.test.ts" procura "test.ts" e depois "ts".
      for (let dot = name.indexOf('.'); dot >= 0; dot = name.indexOf('.', dot + 1)) {
        const ext = name.slice(dot + 1);
        const byExt = lookup((layer) => layer.fileExtensions?.[ext]);
        if (byExt) return toIcon(byExt);
      }
      const byLanguage = languageId ? lookup((layer) => layer.languageIds?.[languageId]) : undefined;
      return toIcon(byLanguage ?? lookup((layer) => layer.file));
    },
    forFolder(dir, expanded, root) {
      const name = baseName(dir).toLowerCase();
      const byName = lookup((layer) => (expanded ? layer.folderNamesExpanded?.[name] ?? layer.folderNames?.[name] : layer.folderNames?.[name]));
      if (byName) return toIcon(byName);
      if (root) {
        const rootIcon = lookup((layer) => (expanded ? layer.rootFolderExpanded : layer.rootFolder));
        if (rootIcon) return toIcon(rootIcon);
      }
      return toIcon(lookup((layer) => (expanded ? layer.folderExpanded ?? layer.folder : layer.folder)));
    },
  };
}

// Imagens dos ícones: lidas uma vez e servidas como blob.
const imageCache = new Map<string, Promise<string>>();

export function iconImageUrl(path: string) {
  let url = imageCache.get(path);
  if (!url) {
    const type = path.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : path.toLowerCase().endsWith('.png') ? 'image/png' : 'application/octet-stream';
    url = window.api.extReadBinary(path).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type })));
    imageCache.set(path, url);
  }
  return url;
}
