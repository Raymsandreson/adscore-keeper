import { addBusinessDays, addDays, format, nextMonday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Opções do "Adiar" da atividade.
 *
 * Existe porque até 14/08/2026 não havia NENHUM caminho de adiar: para mudar o
 * prazo era preciso abrir a ficha, trocar o campo e clicar em Salvar — que
 * passa pelo pop-up "Quanto tempo isso vai levar?" e, se a pessoa fechasse o
 * pop-up, descartava a edição em silêncio. Sem conseguir adiar, a equipe usava
 * o "Concluir + próxima", que conclui a atividade no dia velho e cria um clone
 * na data nova (incidente PREV 180: 8 conclusões em 10 minutos).
 *
 * A base é sempre HOJE, não o prazo atual da atividade: quem adia está dizendo
 * "não vou fazer isto hoje". Com base no prazo, adiar uma atividade vencida há
 * duas semanas jogaria para uma data que continua no passado.
 */

export interface PostponeOption {
  key: string;
  /** Rótulo curto do botão ("Próximo dia útil"). */
  label: string;
  /** Data por extenso curta, para o botão ("seg, 17/08"). */
  when: string;
  /** `yyyy-MM-dd` — o que vai para `deadline` e `notification_date`. */
  dateStr: string;
}

const CANDIDATOS: { key: string; label: string; calc: (base: Date) => Date }[] = [
  { key: 'next_business', label: 'Próximo dia útil', calc: (b) => addBusinessDays(b, 1) },
  { key: 'three_business', label: 'Em 3 dias úteis', calc: (b) => addBusinessDays(b, 3) },
  { key: 'next_monday', label: 'Próxima segunda', calc: (b) => nextMonday(b) },
  { key: 'one_week', label: 'Em 1 semana', calc: (b) => addDays(b, 7) },
];

/**
 * Opções de adiamento a partir de `now`. Datas repetidas são removidas mantendo
 * a primeira ocorrência — numa sexta-feira "próximo dia útil" e "próxima
 * segunda" caem no mesmo dia, e dois botões com a mesma data só confundem.
 */
export function buildPostponeOptions(now: Date = new Date()): PostponeOption[] {
  const vistos = new Set<string>();
  const opcoes: PostponeOption[] = [];
  for (const c of CANDIDATOS) {
    const d = c.calc(now);
    const dateStr = format(d, 'yyyy-MM-dd');
    if (vistos.has(dateStr)) continue;
    vistos.add(dateStr);
    opcoes.push({
      key: c.key,
      label: c.label,
      when: format(d, "EEEEEE, dd/MM", { locale: ptBR }),
      dateStr,
    });
  }
  return opcoes;
}

/** `2026-08-18` → `18/08/2026`. Devolve a própria string se não for uma data. */
export function formatPostponeDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd/MM/yyyy');
  } catch {
    return dateStr;
  }
}

/** Data mínima aceita no seletor manual: hoje. Adiar para trás não é adiar. */
export function minPostponeDate(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd');
}
