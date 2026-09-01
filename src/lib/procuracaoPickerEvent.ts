// Event bus para abrir o seletor de procuração de qualquer lugar sem depender
// do ciclo de vida do WhatsAppChat — mesmo padrão de `zapsignDialogEvent`.

export interface ProcuracaoPickerPayload {
  leadId: string;
  /** Título do grupo/lead: é dele que sai o nome da mãe nas buscas iniciais. */
  leadName?: string | null;
  /** Nome no requerimento do INSS (em BPC e maternidade, é o da criança). */
  nomeSegurado?: string | null;
  cpfSegurado?: string | null;
  instanceName?: string | null;
}

const EVENT_NAME = 'procuracao:picker';

export function openProcuracaoPicker(payload: ProcuracaoPickerPayload) {
  window.dispatchEvent(new CustomEvent<ProcuracaoPickerPayload>(EVENT_NAME, { detail: payload }));
}

export function onProcuracaoPicker(handler: (payload: ProcuracaoPickerPayload) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<ProcuracaoPickerPayload>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
