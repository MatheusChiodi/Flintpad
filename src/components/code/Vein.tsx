import { useLayoutEffect, useRef, useState } from 'react';

type Box = { pos: number; size: number };

// O veio: marca o filho com data-active="true" do contêiner (que precisa ser position: relative)
// e desliza até ele quando a seleção muda. A transição fica no CSS (.wb-vein).
export function Vein({ axis, inset = 10 }: { axis: 'x' | 'y'; inset?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [, setTick] = useState(0);

  // Mede a cada render: barato, e o estado só muda quando a posição muda de fato.
  useLayoutEffect(() => {
    const target = ref.current?.parentElement?.querySelector<HTMLElement>(':scope > [data-active="true"]');
    const next = !target
      ? null
      : axis === 'x'
        ? { pos: target.offsetLeft + inset, size: Math.max(0, target.offsetWidth - inset * 2) }
        : { pos: target.offsetTop + inset, size: Math.max(0, target.offsetHeight - inset * 2) };
    setBox((current) => (current?.pos === next?.pos && current?.size === next?.size ? current : next));
  });

  // Larguras mudam sem render (fonte carregando, janela redimensionada): remede.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => setTick((n) => n + 1));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const style =
    box === null
      ? { opacity: 0 }
      : axis === 'x'
        ? { transform: `translateX(${box.pos}px)`, width: box.size }
        : { transform: `translateY(${box.pos}px)`, height: box.size };
  return <span ref={ref} aria-hidden className="wb-vein" style={style} />;
}
