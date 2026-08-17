// =============================================================================
// Carga diária de atividades por assessor — regras puras.
//
// O escritório pediu (ago/2026) um LIMITE de 30 atividades por dia, com bloqueio
// de quem estourasse. O que entrou foi ALERTA, não bloqueio, e a medição no
// Externo em 17/08/2026 é a razão:
//
//  - 11,7% dos pares (dia, assessor) desde 01/06 já passam de 30 (p90 = 32,
//    máximo 87). Não é exceção, é o topo da rotina normal.
//  - Nos dias que estouram 30, 72,3% das atividades foram criadas pelo PRÓPRIO
//    dono (created_by == assigned_to). Um bloqueio impediria o assessor de
//    registrar o trabalho dele, não o gestor de empurrar trabalho.
//  - As pessoas CONCLUEM mais de 30 num dia em 11,8% dos dias-pessoa (p90 = 33,
//    máximo 62). O teto ficaria abaixo da entrega comprovada nos dias de pico.
//  - 15,3% das atividades já nascem 'urgente' e qualquer um marca urgente sem
//    aprovação — a válvula de escape pedida ("urgente conta como extra") esvazia
//    a regra sozinha.
//
// Então 30 vira o número que ACENDE o vermelho (ele bate quase exatamente no
// p90 — é um ótimo limiar de aviso), e nada impede salvar. Se o alerta não
// resolver, o bloqueio de verdade tem que ser trigger em `lead_activities` no
// Externo: `assigned_to` é gravado em ~20 lugares (front, 8 edge functions e o
// railway-server), então trava no front não trava nada.
//
// Aqui fica só o que dá pra testar sem banco e sem React.
// =============================================================================

/** Onde acende o vermelho. É o número que o escritório pediu. */
export const LIMITE_DIARIO_ATIVIDADES = 30;

/** Onde acende o âmbar: 80% do teto, pra avisar antes de encostar nele. */
export const ATENCAO_DIARIO_ATIVIDADES = 24;

export type NivelCarga = 'tranquilo' | 'cheio' | 'estourado';

/**
 * Em que faixa o dia da pessoa está. `null` quando não há contagem (ainda
 * carregando, ou sem responsável/data escolhidos) — quem chama não deve pintar
 * nada nesse caso.
 */
export function nivelCarga(total: number | null | undefined): NivelCarga | null {
  if (total === null || total === undefined || !Number.isFinite(total)) return null;
  if (total >= LIMITE_DIARIO_ATIVIDADES) return 'estourado';
  if (total >= ATENCAO_DIARIO_ATIVIDADES) return 'cheio';
  return 'tranquilo';
}

/**
 * Classes do badge por faixa. Segue a paleta que o formulário já usava
 * (success/warning), só que agora o verde significa "tem folga" em vez de
 * "zero atividades" — antes o badge ficava âmbar com UMA atividade no dia, o
 * que fazia dele enfeite: quase todo dia útil tem mais de uma.
 */
export function classesCarga(nivel: NivelCarga): string {
  switch (nivel) {
    case 'estourado':
      return 'bg-destructive/15 text-destructive border-destructive/40 ring-1 ring-destructive/30';
    case 'cheio':
      return 'bg-warning/15 text-warning border-warning/40 ring-1 ring-warning/30';
    default:
      return 'bg-success/15 text-success border-success/40 ring-1 ring-success/30';
  }
}

/** Texto curto do badge: "12/30". */
export function rotuloCarga(total: number): string {
  return `${total}/${LIMITE_DIARIO_ATIVIDADES}`;
}

/**
 * Frase do tooltip/aviso. Fala em quantas cabem ainda, e deixa explícito que
 * passar do teto é permitido — senão o vermelho é lido como erro de sistema.
 */
export function descreveCarga(total: number | null | undefined, nome?: string | null): string {
  const nivel = nivelCarga(total);
  if (nivel === null) return '';
  const quem = nome?.trim() ? nome.trim().split(' ')[0] : 'A pessoa';
  const n = total as number;
  if (nivel === 'estourado') {
    const excedente = n - LIMITE_DIARIO_ATIVIDADES;
    return excedente === 0
      ? `${quem} bate o limite de ${LIMITE_DIARIO_ATIVIDADES} atividades nesse dia. Dá para salvar mesmo assim — é aviso, não bloqueio.`
      : `${quem} fica com ${n} atividades nesse dia, ${excedente} acima do limite de ${LIMITE_DIARIO_ATIVIDADES}. Dá para salvar mesmo assim — é aviso, não bloqueio.`;
  }
  if (nivel === 'cheio') {
    return `${quem} fica com ${n} atividades nesse dia — faltam ${LIMITE_DIARIO_ATIVIDADES - n} para o limite de ${LIMITE_DIARIO_ATIVIDADES}.`;
  }
  return `${quem} tem ${n} atividade${n === 1 ? '' : 's'} nesse dia (limite ${LIMITE_DIARIO_ATIVIDADES}).`;
}
