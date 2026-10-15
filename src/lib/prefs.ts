// Preferências da interface (Configurações). Ficam no config.json do processo principal,
// que guarda o objeto como veio; tudo que se lê de lá passa por sanitizePrefs.

export const ACCENTS = ['sheen', 'blue', 'violet', 'amber', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

// Tons de cada cor de destaque: 300/400 sobre a obsidiana, 700 sobre a folha.
export const ACCENT_TONES: Record<Accent, { 300: string; 400: string; 700: string }> = {
  sheen: { 300: '#86d9cd', 400: '#4fbfb4', 700: '#0c6c64' },
  blue: { 300: '#a9c6ff', 400: '#78a6f6', 700: '#1f56b3' },
  violet: { 300: '#cfbcff', 400: '#ab8ff2', 700: '#5b3db0' },
  amber: { 300: '#f5d08c', 400: '#e5ac52', 700: '#8a5a0f' },
  rose: { 300: '#f6b0c6', 400: '#e8809f', 700: '#9c2f55' },
};

// Ao abrir o app: as guias da última vez, essas mais a nota de hoje, ou a tela inicial limpa.
export const STARTUPS = ['restore', 'daily', 'home'] as const;
export type Startup = (typeof STARTUPS)[number];

// Movimento: seguir o sistema, reduzir sempre ou animar sempre.
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];

export const FONT_SIZE_MIN = 13;
export const FONT_SIZE_MAX = 22;
export const FONT_SIZE_DEFAULT = 16.5;

export type Prefs = {
  accent: Accent;
  editorFontSize: number;
  motion: Motion;
  spellcheck: boolean;
  startup: Startup;
  tips: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  accent: 'sheen',
  editorFontSize: FONT_SIZE_DEFAULT,
  motion: 'system',
  spellcheck: true,
  startup: 'restore',
  tips: true,
};

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;

// Fonte em passos de meio ponto, dentro dos limites.
export function clampFontSize(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(number * 2) / 2));
}

// Lê preferências de origem externa (config.json editado à mão, versão antiga): campo inválido volta ao padrão.
export function sanitizePrefs(raw: unknown): Prefs {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    accent: oneOf(ACCENTS, data.accent, DEFAULT_PREFS.accent),
    editorFontSize: 'editorFontSize' in data ? clampFontSize(data.editorFontSize) : DEFAULT_PREFS.editorFontSize,
    motion: oneOf(MOTIONS, data.motion, DEFAULT_PREFS.motion),
    spellcheck: typeof data.spellcheck === 'boolean' ? data.spellcheck : DEFAULT_PREFS.spellcheck,
    startup: oneOf(STARTUPS, data.startup, DEFAULT_PREFS.startup),
    tips: typeof data.tips === 'boolean' ? data.tips : DEFAULT_PREFS.tips,
  };
}

// Variáveis CSS e atributos que a folha de estilos lê na raiz do documento.
export function prefsToRoot(prefs: Prefs): { vars: Record<string, string>; attrs: Record<string, string | null> } {
  const tones = ACCENT_TONES[prefs.accent];
  return {
    vars: {
      '--color-sheen-300': tones[300],
      '--color-sheen-400': tones[400],
      '--color-sheen-700': tones[700],
      '--editor-font-size': `${prefs.editorFontSize}px`,
    },
    attrs: { 'data-accent': prefs.accent, 'data-motion-pref': prefs.motion === 'system' ? null : prefs.motion },
  };
}

// Pasta padrão das páginas novas: caminho relativo ao vault, sem subir nem sair dele, terminado em "/" (ou vazio = raiz).
export function sanitizeFolder(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim())
    .filter((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'));
  return parts.length ? `${parts.join('/')}/` : '';
}
