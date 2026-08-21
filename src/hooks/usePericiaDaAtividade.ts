// =============================================================================
// As perícias de uma atividade — leitura e escrita em `hearings`.
//
// A perícia é do BENEFÍCIO, não da atividade: quem marcar em qualquer atividade
// faz a data aparecer em todas as outras do mesmo processo/caso, inclusive nas
// criadas depois. Por isso a linha é procurada por uma ÂNCORA que degrada:
//
//   processo → caso → lead
//
// Degrada porque 30 das 93 atividades vivas de perícia (20/08/2026) não têm
// processo vinculado, e amarrar no processo deixaria um terço do serviço sem
// onde salvar. A mesma expressão é o índice único parcial criado na migration
// 20260819110000 (`coalesce(process_id, legal_case_id, lead_id), hearing_type`
// where origem='atividade'), então banco e tela concordam sobre o que é "a
// mesma perícia".
//
// A BUSCA TAMBÉM VAI PELO NÚMERO DO PROCESSO, e não filtra por origem.
// As 564 linhas vindas da planilha de audiências não têm `process_id` (1 de 566
// tem) — elas só casam por `process_number`. Sem esse segundo caminho o chip
// dizia "marcar" em 9 processos que JÁ tinham perícia no calendário, e marcar
// criava um segundo cartão para o mesmo exame.
//
// O QUE VEIO DA PLANILHA NÃO SE EDITA DAQUI. A chave com que o sync casa a
// linha é "número do processo + data" (sync-hearings-from-sheet): mudar a data
// aqui faria o sync seguinte não reconhecer mais a linha e reinserir a data
// antiga. Então o chip mostra a data, diz de onde ela veio, e marcar por cima
// cria uma linha nova e explícita — a perícia administrativa do INSS convive
// com a judicial da planilha.
//
// `activity_id` é gravado como rastro de quem marcou primeiro — nunca como
// chave de busca: a atividade some (concluída, clonada) e a perícia fica.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db, ensureExternalSession } from '@/integrations/supabase';
import {
  PERICIA_HEARING_TYPE,
  PERICIA_TIPOS,
  tipoDaPericia,
  type PericiaTipo,
} from '@/lib/periciaInss';

export interface PericiaMarcada {
  id: string;
  data: string;          // hearing_date  'YYYY-MM-DD'
  hora: string | null;   // hearing_time  'HH:MM:SS'
  status: string | null;
  /** 'atividade' | 'planilha' | 'manual' — de onde a linha veio. */
  origem: string | null;
  /** `hearing_type` como está no banco: pode ser "Perícia Judicial". */
  tipoNoBanco: string | null;
  /** Nasceu neste chip? Só então dá para remarcar e desmarcar por aqui. */
  doChip: boolean;
}

export interface AncoraPericia {
  processId?: string | null;
  caseId?: string | null;
  leadId?: string | null;
  /** Casa as linhas da planilha, que não têm process_id — e vai junto no insert. */
  processNumber?: string | null;
  /** Identificação do cartão no calendário ("CASO 394", nome do cliente). */
  caseRef?: string | null;
  activityId?: string | null;
  assignedTo?: string | null;
}

type Mapa = Partial<Record<PericiaTipo, PericiaMarcada>>;

interface LinhaHearing {
  id: string;
  hearing_type: string | null;
  hearing_date: string;
  hearing_time: string | null;
  status: string | null;
  origem: string | null;
}

const COLS = 'id, hearing_type, hearing_date, hearing_time, status, origem';

/** Qual campo ancora esta perícia. null = atividade solta, sem onde pendurar. */
export function campoDaAncora(a: AncoraPericia): 'process_id' | 'legal_case_id' | 'lead_id' | null {
  if (a.processId) return 'process_id';
  if (a.caseId) return 'legal_case_id';
  if (a.leadId) return 'lead_id';
  return null;
}

function valorDaAncora(a: AncoraPericia): string | null {
  return a.processId || a.caseId || a.leadId || null;
}

/**
 * Filtro que casa EXATAMENTE o `coalesce` do índice único: ancorada no caso, só
 * conta a linha que não tem processo — senão a perícia de um processo do mesmo
 * caso seria devolvida como se fosse a da atividade sem processo.
 */
function aplicarAncora(q: any, a: AncoraPericia) {
  const campo = campoDaAncora(a);
  if (campo === 'process_id') return q.eq('process_id', a.processId);
  if (campo === 'legal_case_id') return q.is('process_id', null).eq('legal_case_id', a.caseId);
  return q.is('process_id', null).is('legal_case_id', null).eq('lead_id', a.leadId);
}

/**
 * Entre as candidatas de um mesmo tipo, qual o chip mostra.
 *
 * A do próprio chip ganha sempre (é a única editável aqui). Entre as demais,
 * a data mais recente: em processo que já teve perícia adiada, o que interessa
 * é a convocação que está valendo, não a que passou.
 */
function melhorCandidata(linhas: PericiaMarcada[]): PericiaMarcada | undefined {
  return [...linhas].sort((a, b) => {
    if (a.doChip !== b.doChip) return a.doChip ? -1 : 1;
    return b.data.localeCompare(a.data);
  })[0];
}

function paraMarcada(l: LinhaHearing): PericiaMarcada {
  return {
    id: l.id,
    data: (l.hearing_date || '').slice(0, 10),
    hora: l.hearing_time,
    status: l.status,
    origem: l.origem,
    tipoNoBanco: l.hearing_type,
    doChip: l.origem === 'atividade',
  };
}

export function usePericiaDaAtividade(ancora: AncoraPericia) {
  const qc = useQueryClient();
  const [pericias, setPericias] = useState<Mapa>({});
  const [carregou, setCarregou] = useState(false);
  const chave = valorDaAncora(ancora);
  const numero = ancora.processNumber?.trim() || null;

  useEffect(() => {
    if (!chave) { setCarregou(false); setPericias({}); return; }
    let cancelled = false;
    (async () => {
      await ensureExternalSession();
      const base = () => (db as any).from('hearings').select(COLS).is('deleted_at', null);

      const buscas: PromiseLike<{ data: LinhaHearing[] | null; error: unknown }>[] = [
        aplicarAncora(base(), ancora),
      ];
      // A planilha não grava process_id: sem esta segunda busca a perícia que
      // já está no calendário fica invisível para o chip.
      if (numero) buscas.push(base().eq('process_number', numero));

      const respostas = await Promise.all(buscas);
      if (cancelled) return;
      if (respostas.some(r => r.error)) { setCarregou(false); return; }

      const porId = new Map<string, LinhaHearing>();
      respostas.forEach(r => (r.data || []).forEach(l => porId.set(l.id, l)));

      const candidatas: Record<string, PericiaMarcada[]> = {};
      for (const linha of porId.values()) {
        const tipo = tipoDaPericia(linha.hearing_type);
        // Cancelada não é perícia marcada — mostrar a data seria dizer que o
        // cliente tem compromisso que não existe mais.
        if (!tipo || linha.status === 'cancelada') continue;
        (candidatas[tipo] = candidatas[tipo] || []).push(paraMarcada(linha));
      }

      const mapa: Mapa = {};
      for (const t of PERICIA_TIPOS) {
        const escolhida = melhorCandidata(candidatas[t] || []);
        if (escolhida) mapa[t] = escolhida;
      }
      setPericias(mapa);
      setCarregou(true);
    })();
    return () => { cancelled = true; };
    // `chave` resume a âncora: mudou a âncora (ou o número), recarrega.
  }, [chave, numero]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidar = useCallback(() => {
    // O calendário e a aba Eventos leem a mesma tabela por outras chaves.
    qc.invalidateQueries({ queryKey: ['hearings'] });
    qc.invalidateQueries({ queryKey: ['eventos-da-janela'] });
  }, [qc]);

  /** Marca ou remarca. Devolve mensagem de erro, ou null se deu certo. */
  const salvar = useCallback(async (tipo: PericiaTipo, data: string, hora: string): Promise<string | null> => {
    if (!chave) return 'Esta atividade não tem processo, caso nem cliente para pendurar a perícia.';
    await ensureExternalSession();
    const existente = pericias[tipo];

    if (existente?.doChip) {
      // Remarcação: a data nova entra e o evento volta a valer. Sem forçar
      // 'ativa', uma perícia marcada como adiada ficaria fora do calendário
      // mesmo depois de remarcada — que é exatamente o caso do "REMARCAR
      // PERÍCIA" que aparece aos montes nos títulos das atividades.
      const { error } = await (db as any)
        .from('hearings')
        .update({ hearing_date: data, hearing_time: hora, status: 'ativa' })
        .eq('id', existente.id);
      if (error) return error.message;
      setPericias(p => ({ ...p, [tipo]: { ...existente, data, hora, status: 'ativa' } }));
      invalidar();
      return null;
    }

    // Sem linha própria — inclusive quando existe uma da planilha, que não se
    // edita daqui (o sync a reinseriria com a data antiga).
    const { data: inserida, error } = await (db as any)
      .from('hearings')
      .insert({
        process_id: ancora.processId || null,
        legal_case_id: ancora.caseId || null,
        lead_id: ancora.leadId || null,
        activity_id: ancora.activityId || null,
        process_number: ancora.processNumber || null,
        // Sem isto o cartão no calendário nasce anônimo: sem número (a perícia
        // administrativa costuma vir de atividade sem processo) e sem case_ref,
        // sobra só "Perícia Médica (INSS)" e a hora.
        case_ref: ancora.caseRef?.trim() || null,
        assigned_user_id: ancora.assignedTo || null,
        hearing_type: PERICIA_HEARING_TYPE[tipo],
        category: 'previdenciario',
        hearing_date: data,
        hearing_time: hora,
        timezone_label: 'Padrão Brasília',
        status: 'ativa',
        origem: 'atividade',
      })
      .select(COLS)
      .single();
    if (error) {
      // 23505 = o índice único parcial. Acontece quando outra aba/pessoa marcou
      // a mesma perícia enquanto esta tela estava aberta; o texto do Postgres
      // ("duplicate key value violates unique constraint…") não ajuda ninguém.
      if ((error as any).code === '23505') {
        return 'Esta perícia já foi marcada em outro lugar. Recarregue a atividade para ver a data.';
      }
      return error.message;
    }
    setPericias(p => ({ ...p, [tipo]: paraMarcada(inserida as LinhaHearing) }));
    invalidar();
    return null;
  }, [chave, pericias, ancora, invalidar]);

  /** Desmarca (soft delete — o histórico do evento não se perde). */
  const remover = useCallback(async (tipo: PericiaTipo): Promise<string | null> => {
    const existente = pericias[tipo];
    if (!existente) return null;
    if (!existente.doChip) {
      return 'Esta data veio da planilha de audiências. Remova no calendário (Audiências e Perícias) ou na própria planilha.';
    }
    await ensureExternalSession();
    const { error } = await (db as any)
      .from('hearings')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existente.id);
    if (error) return error.message;
    setPericias(p => ({ ...p, [tipo]: undefined }));
    invalidar();
    return null;
  }, [pericias, invalidar]);

  return { pericias, carregou, temAncora: !!chave, salvar, remover };
}
