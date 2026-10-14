import { Component, createRef, useEffect, useRef, useState, type ReactNode } from 'react';

// Só apresentação: nada aqui muda o estado do app, apenas adia a saída visual do que já foi fechado.

const EXIT_FALLBACK_MS = 420;

type PresenceProps = { when: boolean; name: string; children: ReactNode };

// Mantém o conteúdo montado enquanto a animação de saída toca (data-motion="out") e só então o remove.
// O CSS decide o movimento a partir de [data-presence][data-motion]; a saída termina num keyframe "*-out".
export function Presence({ when, name, children }: PresenceProps) {
  const [state, setState] = useState<'idle' | 'in' | 'out' | 'gone'>(when ? 'idle' : 'gone');
  const last = useRef(children);
  const generation = useRef(0);
  if (when) last.current = children;

  if (when && (state === 'gone' || state === 'out')) {
    // Reabrir durante a saída remonta o conteúdo, como se tivesse sido fechado de fato.
    generation.current++;
    setState('in');
  } else if (!when && (state === 'idle' || state === 'in')) {
    setState('out');
  }

  useEffect(() => {
    if (state !== 'out') return;
    const timer = window.setTimeout(() => setState('gone'), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === 'gone') return null;

  return (
    <div
      key={generation.current}
      className="contents"
      data-presence={name}
      data-motion={state}
      inert={state === 'out'}
      onAnimationEnd={(event) => {
        const direct = (event.target as HTMLElement).parentElement === event.currentTarget;
        if (state === 'out' && direct && event.animationName.endsWith('-out')) setState('gone');
      }}
    >
      {when ? children : last.current}
    </div>
  );
}

function snapshot(element: Element) {
  const ghost = element.cloneNode(true) as HTMLElement;
  // Um canvas clonado nasce vazio: copia os pixels do original.
  const drawn = element.querySelectorAll('canvas');
  ghost.querySelectorAll('canvas').forEach((canvas, i) => {
    try {
      canvas.getContext('2d')?.drawImage(drawn[i], 0, 0);
    } catch {
      // canvas sem tamanho ainda: o fantasma fica sem o desenho
    }
  });
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.classList.add('ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  return ghost;
}

type StageProps = { swapKey: string; material: 'sheet' | 'well'; className?: string; children: ReactNode };

// A área de conteúdo. Ao trocar de página no mesmo material, a página anterior sai como um
// "fantasma" (cópia estática do DOM) enquanto a nova entra; o componente antigo desmonta na hora,
// então salvamento e demais efeitos seguem exatamente como antes.
export class Stage extends Component<StageProps> {
  private root = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: StageProps) {
    if (previous.swapKey === this.props.swapKey || previous.material !== this.props.material) return null;
    const current = [...(this.root.current?.children ?? [])].find((child) => !child.classList.contains('ghost'));
    return current ? snapshot(current) : null;
  }

  componentDidUpdate(_props: StageProps, _state: unknown, ghost: HTMLElement | null) {
    const root = this.root.current;
    if (!ghost || !root) return;
    root.querySelectorAll(':scope > .ghost').forEach((old) => old.remove());
    root.append(ghost);
    const remove = () => ghost.remove();
    ghost.addEventListener('animationend', (event) => event.target === ghost && remove());
    window.setTimeout(remove, EXIT_FALLBACK_MS);
  }

  render() {
    const { material, className = '', children } = this.props;
    return (
      <div ref={this.root} className={`stage ${material} ${className}`}>
        {children}
      </div>
    );
  }
}
