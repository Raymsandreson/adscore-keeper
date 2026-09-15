import { useCallback, useEffect, useState } from 'react';
import { externalSupabase } from '@/integrations/supabase/external-client';

/**
 * Risco de banimento por instância, em tempo real.
 *
 * Lê o snapshot que `wa_risco_tick()` reescreve de 15 em 15 min no projeto
 * externo, e assina Realtime na mesma tabela. Não calcula nada aqui: a conta
 * roda em SQL porque `whatsapp_messages` tem 7,8 GB — trazer isso para o
 * navegador seria travar o painel e o banco junto.
 */
export type ClassificacaoRisco =
  | 'OK'
  | 'ATENÇÃO'
  | 'CRÍTICO'
  | 'SILÊNCIO SUSPEITO'
  | 'PROVAVELMENTE BANIDA'
  | 'ABANDONADA'
  | 'NUNCA USADA'
  | 'SEM DADOS';

export interface RiscoDaInstancia {
  instance_name: string;
  owner_name: string | null;
  enviadas_7d: number;
  recebidas_7d: number;
  razao_env_rec: number | null;
  conversas_7d: number;
  iniciadas_por_nos: number;
  frias_sem_resposta: number;
  pct_fria_sem_resposta: number | null;
  novos_hoje: number;
  novos_pico_7d: number;
  gap_mediano_seg: number | null;
  gap_minimo_seg: number | null;
  abordagens_em_rajada: number;
  primeiras_msgs: number;
  textos_distintos: number;
  pct_texto_repetido: number | null;
  ultima_msg: string | null;
  horas_sem_atividade: number | null;
  inativa: boolean;
  score: number;
  classificacao: ClassificacaoRisco;
  motivos: string[];
  calculado_em: string;
}

/** Ordem de urgência da lista: quem está pior aparece primeiro. */
const PESO_CLASSIFICACAO: Record<string, number> = {
  'PROVAVELMENTE BANIDA': 0,
  'CRÍTICO': 1,
  'SILÊNCIO SUSPEITO': 2,
  'ATENÇÃO': 3,
  'ABANDONADA': 4,
  'OK': 5,
  'NUNCA USADA': 6,
  'SEM DADOS': 7,
};

/**
 * Ordem da lista: quem está pior no topo. A banida vem antes da crítica porque
 * banida é prejuízo já consumado — a crítica ainda dá para salvar. Dentro da
 * mesma classificação, maior score primeiro.
 */
export function ordenarPorUrgencia(linhas: RiscoDaInstancia[]): RiscoDaInstancia[] {
  return linhas.slice().sort((a, b) => {
    const pa = PESO_CLASSIFICACAO[a.classificacao] ?? 9;
    const pb = PESO_CLASSIFICACAO[b.classificacao] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

export function useRiscoDeBanimento(enabled = true) {
  const [instancias, setInstancias] = useState<RiscoDaInstancia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!enabled) return;
    try {
      // `wa_instancia_risco` só existe no projeto externo e não está no
      // `Database` gerado (que é o schema do Cloud), então o `from` tipado a
      // recusa — mesma situação de `whatsapp_groups_index` em
      // useVinculoDespesas. O cast fica aqui, estreito e comentado, em vez de
      // espalhar `any` pelo arquivo.
      const cliente = externalSupabase as unknown as {
        from: (t: string) => { select: (c: string) => Promise<{ data: unknown; error: { message: string } | null }> };
      };
      const { data, error } = await cliente.from('wa_instancia_risco').select('*');
      if (error) throw error;
      setInstancias(ordenarPorUrgencia((data || []) as unknown as RiscoDaInstancia[]));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha ao ler o risco das instâncias');
    } finally {
      setCarregando(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void carregar();

    // Realtime, não setInterval: o tick reescreve a tabela e a tela recebe o
    // empurrão. É a regra da casa desde a Fase 3.
    const canal = externalSupabase
      .channel('wa-risco-banimento')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_instancia_risco' },
        () => { void carregar(); },
      )
      .subscribe();

    return () => { void externalSupabase.removeChannel(canal); };
  }, [enabled, carregar]);

  const emRisco = instancias.filter(
    (i) => i.classificacao === 'CRÍTICO' || i.classificacao === 'ATENÇÃO',
  );
  const foraDoAr = instancias.filter(
    (i) => i.classificacao === 'PROVAVELMENTE BANIDA' || i.classificacao === 'SILÊNCIO SUSPEITO',
  );
  const abandonadas = instancias.filter((i) => i.classificacao === 'ABANDONADA');

  return { instancias, emRisco, foraDoAr, abandonadas, carregando, erro, recarregar: carregar };
}
