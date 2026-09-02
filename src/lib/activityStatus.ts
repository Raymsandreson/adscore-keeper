// Situação da atividade — rótulo, ícone e cor num lugar só.
//
// As cores são as mesmas que a ActivitiesPage já usava no `statusColors` dos
// cards; extraídas aqui em 02/09/2026 porque a situação passou a aparecer em
// mais lugares (gatilho do formulário, cabeçalho da ficha, pergunta pós-
// avaliação do feedback). Antes cada tela escrevia a sua própria paleta e a
// mesma atividade aparecia amarela num canto e cinza no outro.

export type StatusAtividade = 'pendente' | 'em_andamento' | 'concluida' | 'reagendada';

export interface StatusAtividadeDef {
  value: StatusAtividade;
  label: string;
  /** Ícone do rótulo — a situação tem que ser reconhecível antes de ler. */
  icon: string;
  /** Fundo + texto (badge, gatilho do select, botão escolhido). */
  className: string;
  /** Borda combinando, pra quando o elemento tiver contorno próprio. */
  border: string;
}

export const STATUS_ATIVIDADE: StatusAtividadeDef[] = [
  {
    value: 'pendente',
    label: 'Pendente',
    icon: '⏳',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    border: 'border-yellow-400 dark:border-yellow-700',
  },
  {
    value: 'em_andamento',
    label: 'Em Andamento',
    icon: '🔄',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    border: 'border-blue-400 dark:border-blue-700',
  },
  {
    value: 'concluida',
    label: 'Concluída',
    icon: '✅',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    border: 'border-green-500 dark:border-green-700',
  },
  {
    value: 'reagendada',
    label: 'Reagendada',
    icon: '🔁',
    className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    border: 'border-purple-400 dark:border-purple-700',
  },
];

/** Definição da situação. Valor desconhecido/vazio cai em "Pendente" (o padrão do banco). */
export function statusAtividadeDef(v?: string | null): StatusAtividadeDef {
  return STATUS_ATIVIDADE.find(s => s.value === v) || STATUS_ATIVIDADE[0];
}

/** "✅ Concluída" — para textos corridos (toast, corpo do aviso). */
export function statusAtividadeLabel(v?: string | null): string {
  const d = statusAtividadeDef(v);
  return `${d.icon} ${d.label}`;
}
