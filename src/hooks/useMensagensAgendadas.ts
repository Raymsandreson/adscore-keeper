/**
 * Mensagens agendadas de UMA conversa do WhatsApp.
 *
 * Quem dispara é o banco (`wa_agendadas_tick()`, migration
 * 20260825170000_mensagem_agendada_com_recorrencia.sql, Supabase Externo). Este
 * hook só escreve a linha e acompanha a fila — nenhum timer no navegador, para
 * a mensagem sair mesmo com o computador desligado.
 *
 * Tabela: `whatsapp_mensagens_agendadas` (Externo).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import type { Repeticao, Unidade } from '@/lib/mensagemAgendada';

export interface MensagemAgendada {
  id: string;
  phone: string;
  chat_id: string | null;
  instance_name: string | null;
  contact_id: string | null;
  lead_id: string | null;
  contact_name: string | null;
  mensagem: string;
  mensagem_original: string | null;
  replyid: string | null;
  mentions: string[] | null;
  proximo_envio_at: string;
  repeticao: Repeticao;
  intervalo: number;
  unidade: Unidade;
  dias_da_semana: number[] | null;
  repetir_ate: string | null;
  max_envios: number | null;
  ativo: boolean;
  total_enviado: number;
  ultimo_envio_at: string | null;
  ultimo_erro: string | null;
  encerrado_motivo: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: string;
  cancelado_em: string | null;
  cancelado_por_nome: string | null;
}

/** O que a tela precisa passar para agendar. */
export interface NovoAgendamento {
  phone: string;
  chatId?: string | null;
  instanceName?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  contactName?: string | null;
  /** Texto final, já com o prefixo `*Nome:*` quando for o caso. */
  mensagem: string;
  /** O que a pessoa digitou, sem prefixo. */
  mensagemOriginal?: string | null;
  mentions?: string[] | null;
  quando: Date;
  repeticao: Repeticao;
  intervalo: number;
  unidade: Unidade;
  diasDaSemana: number[];
  repetirAte: Date | null;
  maxEnvios: number | null;
  criadoPor?: string | null;
  criadoPorNome?: string | null;
}

const SELECT = `id, phone, chat_id, instance_name, contact_id, lead_id, contact_name,
  mensagem, mensagem_original, replyid, mentions, proximo_envio_at, repeticao, intervalo,
  unidade, dias_da_semana, repetir_ate, max_envios, ativo, total_enviado, ultimo_envio_at,
  ultimo_erro, encerrado_motivo, criado_por, criado_por_nome, criado_em, cancelado_em,
  cancelado_por_nome`;

/** `repetir_ate` é DATE no banco — só o dia, sem fuso para atrapalhar. */
const soODia = (d: Date | null): string | null => {
  if (!d) return null;
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
};

interface Params {
  phone?: string | null;
  instanceName?: string | null;
}

export function useMensagensAgendadas({ phone, instanceName }: Params) {
  const [itens, setItens] = useState<MensagemAgendada[]>([]);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!phone) { setItens([]); return; }
    setLoading(true);
    try {
      let q = (db as any)
        .from('whatsapp_mensagens_agendadas')
        .select(SELECT)
        .eq('phone', phone)
        .order('proximo_envio_at', { ascending: true })
        .limit(50);
      // Conversa sem instância declarada é caso raro; sem o filtro ela veria a
      // fila de todas as instâncias do mesmo número.
      if (instanceName) q = q.eq('instance_name', instanceName);

      const { data, error } = await q;
      if (error) throw error;
      setItens((data as MensagemAgendada[]) || []);
    } catch {
      console.warn('[useMensagensAgendadas] falha ao carregar a fila de agendadas');
      setItens([]);
    } finally {
      setLoading(false);
    }
  }, [phone, instanceName]);

  useEffect(() => { carregar(); }, [carregar]);

  // Outra pessoa agendou/cancelou na mesma conversa — ou o tick acabou de
  // disparar e a linha saiu da fila.
  useEffect(() => {
    if (!phone) return;
    const channel = (db as any)
      .channel(`wa-agendadas-${phone}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_mensagens_agendadas', filter: `phone=eq.${phone}` },
        () => carregar(),
      )
      .subscribe();
    return () => { (db as any).removeChannel(channel); };
  }, [phone, carregar]);

  /** Na fila: ainda vai sair. */
  const pendentes = useMemo(() => itens.filter((i) => i.ativo), [itens]);
  /** Já saiu (ou foi cancelada) — o histórico recente da conversa. */
  const encerradas = useMemo(
    () => itens.filter((i) => !i.ativo).sort((a, b) => (b.proximo_envio_at > a.proximo_envio_at ? 1 : -1)),
    [itens],
  );

  const agendar = useCallback(async (novo: NovoAgendamento): Promise<MensagemAgendada | null> => {
    setSalvando(true);
    try {
      const { data, error } = await (db as any)
        .from('whatsapp_mensagens_agendadas')
        .insert({
          phone: novo.phone,
          chat_id: novo.chatId || null,
          instance_name: novo.instanceName || null,
          contact_id: novo.contactId || null,
          lead_id: novo.leadId || null,
          contact_name: novo.contactName || null,
          mensagem: novo.mensagem,
          mensagem_original: novo.mensagemOriginal || null,
          mentions: novo.mentions && novo.mentions.length ? novo.mentions : null,
          proximo_envio_at: novo.quando.toISOString(),
          repeticao: novo.repeticao,
          intervalo: novo.intervalo,
          unidade: novo.unidade,
          dias_da_semana: novo.repeticao === 'semanal' && novo.diasDaSemana.length ? novo.diasDaSemana : null,
          repetir_ate: soODia(novo.repetirAte),
          max_envios: novo.maxEnvios,
          criado_por: novo.criadoPor || null,
          criado_por_nome: novo.criadoPorNome || null,
        })
        .select(SELECT)
        .single();

      if (error) throw error;
      await carregar();
      return data as MensagemAgendada;
    } finally {
      setSalvando(false);
    }
  }, [carregar]);

  /**
   * Cancelar não apaga: a linha fica com `cancelado_em` para a conversa poder
   * mostrar depois que aquela cobrança foi tirada da fila, e por quem.
   */
  const cancelar = useCallback(async (id: string, porNome?: string | null) => {
    const { error } = await (db as any)
      .from('whatsapp_mensagens_agendadas')
      .update({
        ativo: false,
        cancelado_em: new Date().toISOString(),
        cancelado_por_nome: porNome || null,
        encerrado_motivo: 'cancelada',
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
    await carregar();
  }, [carregar]);

  return { itens, pendentes, encerradas, loading, salvando, agendar, cancelar, recarregar: carregar };
}
