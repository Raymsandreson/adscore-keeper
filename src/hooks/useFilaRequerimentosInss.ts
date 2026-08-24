// =============================================================================
// A fila de requerimentos do INSS que ainda não são de ninguém.
//
// Por que existe (24/08/2026): o e-mail do INSS virou a quinta fonte de marco,
// mas ele não traz CNJ — traz PROTOCOLO. E não havia chave nenhuma ligando os
// dois lados. As alternativas foram medidas e reprovadas antes de escolher:
//
//   leads.cpf ......... preenchido em 673 de 21.425 leads
//   leads.lead_name ... é o título do card ("PREV 1556 | ... - KAROLYNE"):
//                       0 de 1.127 nomes do INSS casaram
//   contacts.full_name  78 de 522 (15%)
//
// Por isso a ligação é ANOTADA, nunca adivinhada. Anotada uma vez, todo e-mail
// futuro daquele protocolo vira marco sozinho — incluindo os que já chegaram.
//
// A seção só aparece em POP que tenha sinal de e-mail cadastrado, e só mostra
// requerimento do SERVIÇO que aquele POP escuta: os mesmos 1.165 e-mails
// carregam BPC, salário-maternidade, auxílio-acidente e benefício por
// incapacidade misturados.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';

export interface RequerimentoSemDono {
  protocolo: string;
  nome_segurado: string | null;
  servico: string | null;
  data_protocolo: string | null;
  ultimo_evento: string | null;
  eventos: number;
  status_atual: string | null;
  lead_sugerido_id: string | null;
  lead_sugerido_rotulo: string | null;
}

export interface ProcessoDoPop {
  id: string;
  titulo: string;
  process_number: string | null;
}

/** O que o vínculo produziu, para a tela poder dizer mais que "salvo". */
export interface ResultadoVinculo {
  protocolo: string;
  eventos_do_protocolo: number;
  marcos: number;
  fases_movidas: number;
}

export function useFilaRequerimentosInss(boardId: string | null) {
  const [fila, setFila] = useState<RequerimentoSemDono[]>([]);
  const [servicos, setServicos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [temSinalDeEmail, setTemSinalDeEmail] = useState(false);

  const carregar = useCallback(async () => {
    if (!boardId) { setFila([]); setServicos([]); setTemSinalDeEmail(false); return; }
    setLoading(true);
    try {
      await ensureExternalSession();

      // Quais serviços do INSS este POP escuta. Vem de pop_marco_sinais, que é
      // onde a configuração de detecção mora — a tela não decide isso.
      //
      // Duas consultas em vez de um embed `pop_marcos!inner`: é o mesmo padrão
      // de usePopMarcos, e não depende de o PostgREST ter recarregado o schema
      // depois das colunas novas.
      const { data: ms } = await (db as any)
        .from('pop_marcos')
        .select('id')
        .eq('board_id', boardId);
      const marcoIds = ((ms || []) as { id: string }[]).map((m) => m.id);

      if (marcoIds.length === 0) {
        setTemSinalDeEmail(false); setServicos([]); setFila([]); return;
      }

      const { data: sinais } = await (db as any)
        .from('pop_marco_sinais')
        .select('email_servico')
        .eq('tipo', 'email')
        .in('pop_marco_id', marcoIds);

      const lista = (sinais || []) as { email_servico: string | null }[];
      setTemSinalDeEmail(lista.length > 0);

      const regexes = Array.from(
        new Set(lista.map((s) => s.email_servico).filter((v): v is string => !!v)),
      );
      setServicos(regexes);

      if (lista.length === 0) { setFila([]); return; }

      const { data, error } = await (db as any)
        .from('vw_inss_requerimento_sem_dono')
        .select('*')
        .order('ultimo_evento', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      setFila((data || []) as RequerimentoSemDono[]);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { void carregar(); }, [carregar]);

  /**
   * Só o que este POP escuta. Sem sinal com serviço definido, o POP escuta
   * tudo — que é o que `email_servico is null` significa no banco.
   */
  const filaDoPop = useMemo(() => {
    if (servicos.length === 0) return fila;
    const testes = servicos.map((r) => {
      try { return new RegExp(r, 'i'); } catch { return null; }
    }).filter((r): r is RegExp => !!r);
    if (testes.length === 0) return fila;
    return fila.filter((f) => f.servico && testes.some((t) => t.test(f.servico!)));
  }, [fila, servicos]);

  /** Processos deste POP, para escolher o dono. Busca por nome do lead ou CNJ. */
  const buscarProcessos = useCallback(async (termo: string): Promise<ProcessoDoPop[]> => {
    if (!boardId) return [];
    await ensureExternalSession();
    const t = termo.trim();
    let q = (db as any)
      .from('lead_processes')
      .select('id, title, process_number, leads(lead_name)')
      .eq('workflow_id', boardId)
      .is('deleted_at', null)
      .is('protocolo_administrativo', null)
      .limit(20);
    if (t) q = q.or(`title.ilike.%${t}%,process_number.ilike.%${t}%`);
    const { data } = await q;
    return ((data || []) as any[]).map((p) => ({
      id: p.id as string,
      titulo: (p.leads?.lead_name || p.title || '(sem título)') as string,
      process_number: (p.process_number || null) as string | null,
    }));
  }, [boardId]);

  const vincular = useCallback(async (processId: string, protocolo: string): Promise<ResultadoVinculo> => {
    await ensureExternalSession();
    const { data, error } = await (db.rpc as unknown as (
      f: string, a: Record<string, unknown>,
    ) => PromiseLike<{ data?: ResultadoVinculo | null; error?: { message?: string } | null }>)(
      'inss_vincular_protocolo',
      { p_process_id: processId, p_protocolo: protocolo },
    );
    if (error) throw new Error(error.message || 'inss_vincular_protocolo falhou');
    await carregar();
    return data as ResultadoVinculo;
  }, [carregar]);

  return { fila: filaDoPop, total: fila.length, temSinalDeEmail, loading, buscarProcessos, vincular, recarregar: carregar };
}
