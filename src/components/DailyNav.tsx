import { useLanguage, useT } from '../lib/i18n';
import { baseName } from '../lib/links';
import { isoDate } from '../lib/notes';
import { CalendarIcon, ChevronIcon } from './Icons';

// Faixa acima do título de uma nota diária: dia anterior, hoje e dia seguinte (entre as que existem),
// com a data por extenso na língua do app.

type Props = {
  path: string;
  neighbors: { previous?: string; next?: string };
  onOpen: (path: string) => void;
  onToday: () => void;
};

export function DailyNav({ path, neighbors, onOpen, onToday }: Props) {
  const t = useT();
  const { language } = useLanguage();
  const day = baseName(path);
  const [year, month, date] = day.split('-').map(Number);
  const when = new Date(year, month - 1, date);
  const long = Number.isNaN(when.getTime())
    ? day
    : when.toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Só a primeira letra em maiúscula ("Quarta-feira, 14 de outubro"), não cada palavra.
  const label = long.charAt(0).toLocaleUpperCase(language) + long.slice(1);
  const isToday = day === isoDate(new Date());

  return (
    <nav className="daily-nav" aria-label={t('daily.nav')}>
      <button
        className="daily-nav-button"
        disabled={!neighbors.previous}
        title={neighbors.previous ? baseName(neighbors.previous) : t('daily.noPrevious')}
        aria-label={t('daily.previous')}
        onClick={() => neighbors.previous && onOpen(neighbors.previous)}
      >
        <ChevronIcon size={13} className="rotate-180" />
      </button>
      <span className="daily-nav-label">
        <CalendarIcon size={13} />
        {label}
      </span>
      <button
        className="daily-nav-button"
        disabled={!neighbors.next}
        title={neighbors.next ? baseName(neighbors.next) : t('daily.noNext')}
        aria-label={t('daily.next')}
        onClick={() => neighbors.next && onOpen(neighbors.next)}
      >
        <ChevronIcon size={13} />
      </button>
      {!isToday && (
        <button className="daily-nav-today" onClick={onToday}>
          {t('daily.today')}
        </button>
      )}
    </nav>
  );
}
