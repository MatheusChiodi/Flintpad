import { useEffect } from 'react';

const OK_MS = 4000;
const ERROR_MS = 8000;

export type ToastMessage = { id: number; kind: 'ok' | 'error'; text: string; detail?: string };

type Props = { message: ToastMessage | null; onClose: () => void };

// Aviso discreto e temporário no rodapé da janela. Some sozinho; um erro fica mais tempo na tela.
// Quem usa guarda uma mensagem por vez no estado e envolve em <Presence name="toast"> para a saída animada.
export function Toast({ message, onClose }: Props) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, message.kind === 'error' ? ERROR_MS : OK_MS);
    return () => window.clearTimeout(timer);
    // Uma mensagem nova (id) reinicia a contagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id]);

  if (!message) return null;

  return (
    <div className="toast" data-kind={message.kind} role={message.kind === 'error' ? 'alert' : 'status'} onClick={onClose}>
      <span className="toast-dot" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium text-frost-100">{message.text}</span>
        {message.detail && (
          // O caminho do arquivo cabe numa linha; o motivo de um erro precisa ser lido inteiro.
          <span className={`block text-[12px] text-frost-500 ${message.kind === 'error' ? 'break-words' : 'truncate'}`} title={message.detail}>
            {message.detail}
          </span>
        )}
      </span>
    </div>
  );
}
