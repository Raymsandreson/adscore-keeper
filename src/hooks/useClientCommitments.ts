/**
 * Pendências do CLIENTE de uma conversa (o que ELE ficou de fazer).
 *
 * Diferente de `lead_activities`, que é tarefa do assessor e entra em
 * cronômetro/banco de horas/ranking. Aqui fica "vai avaliar no Google",
 * "vai gravar o depoimento", "vai mandar o documento" — combinado no
 * WhatsApp e que hoje se perdia no meio da conversa.
 *
 * Tabela: `lead_client_commitments` (Externo).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/integrations/supabase';
import { useAuthContext } from '@/contexts/AuthContext';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import {
  isCommitmentOpen, isCommitmentOverdue, isCommitmentDismissed,
  type ClientCommitment, type CommitmentKind, type CommitmentStatus,
} from '@/lib/clientCommitments';

export type {
  ClientCommitment, CommitmentKind, CommitmentStatus, CommitmentOrigin,
} from '@/lib/clientCommitments';

interface Params {
  leadId?: string | null;
  phone?: string | null;
  instanceName?: string | null;
  contactId?: string | null;
  clientName?: string | null;
  /** Dispara a leitura pela IA ao abrir a conversa. Padrão: true. */
  autoAnalyze?: boolean;
}

const SELECT = `id, lead_id, process_id, contact_id, phone, instance_name, title, kind, status,
  due_date, promised_at, source_message_id, source_message_text, notes, last_reminded_at,
  reminder_count, done_at, done_by_name, created_by_name, created_at, origin, ai_confidence`;

export function useClientCommitments({
  leadId, phone, instanceName, contactId, clientName, autoAnalyze = true,
}: Params) {
  const { profile, user } = useAuthContext();
  const [items, setItems] = useState<ClientCommitment[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);
  /** Resumo do contexto da conversa, escrito pela IA na última varredura. */
  const [summary, setSummary] = useState<string | null>(null);
  /** Motivo real da última falha — o toast genérico escondia se era rede, deploy ou IA. */
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  /** Conversas já varridas nesta sessão — evita reanalisar a cada re-render/troca de aba. */
  const analyzedKeys = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!leadId && !phone) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      // A pendência pode ter nascido antes do lead existir (conversa em
      // captação), por isso o OR: casa por lead OU por telefone+instância.
      const filters: string[] = [];
      if (leadId) filters.push(`lead_id.eq.${leadId}`);
      if (phone) {
        filters.push(
          instanceName
            ? `and(phone.eq.${phone},instance_name.eq.${instanceName})`
            : `phone.eq.${phone}`
        );
      }

      const { data, error } = await (db as any)
        .from('lead_client_commitments')
        .select(SELECT)
        .or(filters.join(','))
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems((data as ClientCommitment[]) || []);
    } catch (e) {
      console.warn('[useClientCommitments] falha ao carregar pendências');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [leadId, phone, instanceName]);

  useEffect(() => {
    load();
  }, [load]);

  // Outro assessor marcou "Feito" na mesma conversa — a barra reflete na hora.
  useEffect(() => {
    if (!phone && !leadId) return;
    const key = phone || leadId;
    const channel = (db as any)
      .channel(`client-commitments-${key}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lead_client_commitments',
          ...(phone ? { filter: `phone=eq.${phone}` } : { filter: `lead_id=eq.${leadId}` }),
        },
        () => load()
      )
      .subscribe();
    return () => { (db as any).removeChannel(channel); };
  }, [phone, leadId, load]);

  /**
   * A IA lê a conversa e registra o que o cliente ficou de fazer.
   * O servidor tem cache por última mensagem analisada: sem mensagem nova,
   * a chamada volta na hora sem gastar IA.
   */
  const analyze = useCallback(async (force = false) => {
    if (!phone) return { success: false as const, created: 0, error: 'conversa sem telefone' };
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { data, error } = await cloudFunctions.invoke('detect-client-commitments', {
        body: {
          phone,
          instance_name: instanceName || '',
          lead_id: leadId || null,
          contact_id: contactId || null,
          client_name: clientName || null,
          force,
        },
      });
      if (error) throw error;

      const payload = (data || {}) as {
        success?: boolean; created?: number; closed?: number;
        cached?: boolean; summary?: string | null; error?: string;
      };

      // A função responde 200 com success:false quando a IA falha — isso não
      // vira exception, e sem tratar aqui o painel dizia "nada em aberto".
      if (payload.success === false) {
        setAnalyzeError(payload.error || 'a IA não conseguiu ler a conversa');
        return { success: false as const, created: 0, error: payload.error };
      }

      const created = Number(payload.created || 0);
      const closed = Number(payload.closed || 0);
      if (created > 0 || closed > 0) await load();
      if (payload.summary) setSummary(payload.summary);
      setLastAnalyzedAt(new Date().toISOString());
      return { success: true as const, created, closed, cached: Boolean(payload.cached) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Função ainda não publicada no Railway é o caso mais comum logo após um
      // deploy — a mensagem crua ("404") não dizia nada a quem está usando.
      const friendly = /40[34]|not found|failed to fetch|networkerror/i.test(msg)
        ? 'o servidor ainda não respondeu a esta função (deploy em andamento?)'
        : msg;
      setAnalyzeError(friendly);
      return { success: false as const, created: 0, error: friendly };
    } finally {
      setAnalyzing(false);
    }
  }, [phone, instanceName, leadId, contactId, clientName, load]);

  // Resumo já gravado numa varredura anterior (outra sessão, outro assessor).
  useEffect(() => {
    if (!phone) { setSummary(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (db as any)
        .from('lead_client_commitment_scans')
        .select('summary')
        .eq('phone', phone)
        .eq('instance_name', instanceName || '')
        .maybeSingle();
      if (!cancelled && data?.summary) setSummary(data.summary as string);
    })();
    return () => { cancelled = true; };
  }, [phone, instanceName]);

  // Abrir a conversa já dispara a leitura da IA (uma vez por conversa por sessão).
  useEffect(() => {
    if (!autoAnalyze || !phone) return;
    const key = `${phone}|${instanceName || ''}`;
    if (analyzedKeys.current.has(key)) return;
    analyzedKeys.current.add(key);
    analyze(false);
  }, [autoAnalyze, phone, instanceName, analyze]);

  const open = useMemo(
    () => items.filter((i) => isCommitmentOpen(i.status)),
    [items]
  );

  // Descartada não é "resolvida": some da tela toda, fica só no banco para a
  // IA não registrar de novo o que já foi recusado.
  const done = useMemo(
    () => items.filter((i) => !isCommitmentOpen(i.status) && !isCommitmentDismissed(i.status)),
    [items]
  );

  const overdue = useMemo(() => open.filter((i) => isCommitmentOverdue(i)), [open]);

  /** Pendências indexadas pela mensagem que as originou (selo na bolha). */
  const byMessageId = useMemo(() => {
    const map: Record<string, ClientCommitment> = {};
    for (const i of items) {
      if (i.source_message_id && !isCommitmentDismissed(i.status)) map[i.source_message_id] = i;
    }
    return map;
  }, [items]);

  const create = useCallback(
    async (input: {
      title: string;
      kind: CommitmentKind;
      dueDate?: string | null;
      notes?: string | null;
      sourceMessageId?: string | null;
      sourceMessageText?: string | null;
      processId?: string | null;
    }) => {
      const extUserId = await remapToExternal(user?.id);
      const payload = {
        lead_id: leadId || null,
        process_id: input.processId || null,
        contact_id: contactId || null,
        phone: phone || null,
        instance_name: instanceName || null,
        title: input.title.trim(),
        kind: input.kind,
        status: 'combinado' as CommitmentStatus,
        due_date: input.dueDate || null,
        notes: input.notes || null,
        source_message_id: input.sourceMessageId || null,
        source_message_text: input.sourceMessageText?.slice(0, 400) || null,
        created_by: extUserId,
        created_by_name: profile?.full_name || null,
      };

      const { data, error } = await (db as any)
        .from('lead_client_commitments')
        .insert(payload)
        .select(SELECT)
        .single();

      if (error) throw error;
      setItems((prev) => [data as ClientCommitment, ...prev]);
      return data as ClientCommitment;
    },
    [leadId, phone, instanceName, contactId, user?.id, profile?.full_name]
  );

  const patch = useCallback(async (id: string, changes: Record<string, unknown>) => {
    const { data, error } = await (db as any)
      .from('lead_client_commitments')
      .update(changes)
      .eq('id', id)
      .select(SELECT)
      .single();
    if (error) throw error;
    setItems((prev) => prev.map((i) => (i.id === id ? (data as ClientCommitment) : i)));
    return data as ClientCommitment;
  }, []);

  /**
   * Conclui a pendência creditando QUEM resolveu — não necessariamente quem
   * está clicando. A instância costuma ser compartilhada (a de atendimento tem
   * 42 pessoas com acesso), então gravar sempre o usuário logado apagava a
   * informação de quem realmente tratou o cliente.
   */
  const markDone = useCallback(
    async (id: string, resolver?: { userId?: string | null; name?: string | null }) => {
      const cloudId = resolver?.userId ?? user?.id;
      const extUserId = await remapToExternal(cloudId);
      return patch(id, {
        status: 'feito',
        done_at: new Date().toISOString(),
        done_by: extUserId,
        done_by_name: resolver?.name || profile?.full_name || null,
      });
    },
    [patch, user?.id, profile?.full_name]
  );

  const markGivenUp = useCallback((id: string) => patch(id, { status: 'desistiu' }), [patch]);

  /** "Não era pendência" — a IA errou. Fica gravado para ela não registrar de novo. */
  const dismiss = useCallback(
    (id: string) => patch(id, { status: 'descartada', dismissed_at: new Date().toISOString() }),
    [patch]
  );

  const reopen = useCallback(
    (id: string) => patch(id, { status: 'combinado', done_at: null, done_by: null, done_by_name: null }),
    [patch]
  );

  /** Registra que o cliente foi cobrado (não envia nada — quem envia é o assessor). */
  const registerReminder = useCallback(
    async (item: ClientCommitment) =>
      patch(item.id, {
        status: 'cobrado',
        last_reminded_at: new Date().toISOString(),
        reminder_count: (item.reminder_count || 0) + 1,
      }),
    [patch]
  );

  const remove = useCallback(async (id: string) => {
    const { error } = await (db as any).from('lead_client_commitments').delete().eq('id', id);
    if (error) throw error;
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return {
    items, open, done, overdue, byMessageId, loading, analyzing, lastAnalyzedAt,
    summary, analyzeError,
    reload: load, analyze,
    create, patch, markDone, markGivenUp, dismiss, reopen, registerReminder, remove,
  };
}
