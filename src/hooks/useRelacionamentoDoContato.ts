/**
 * Quem é essa pessoa para nós — resolvido ao ENTRAR na conversa do WhatsApp.
 *
 * A sugestão de resposta só via a transcrição, e por isso lia uma cobrança
 * nossa como se o escritório fosse pagar. O dado existia em três lugares e não
 * chegava ao prompt. Aqui ele é buscado uma vez por contato, em cascata:
 *
 *   1. o campo "Relacionamento Conosco" do contato (`contacts.classifications`) —
 *      confirmado por gente, vale mais que qualquer leitura;
 *   2. o nome do contato (`detectClassificationFromName`) — instantâneo e de graça;
 *   3. a IA lendo a própria conversa (`suggest-contact-classification`, que já
 *      foi escrita para isso).
 *
 * Vindo de 2 ou 3, é INDÍCIO: entra no prompt com ressalva e a barra da conversa
 * pede confirmação. Confirmar grava no contato e a conversa seguinte já nasce
 * sabendo — a IA só é chamada uma vez por contato.
 *
 * Junto vêm o caso ligado à conversa e o livro-caixa do lead (adiantamento /
 * empréstimo), que é o que diz de que lado está a obrigação.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';
import { useContactClassifications, classificationLabel } from '@/hooks/useContactClassifications';
import { detectClassificationFromName } from '@/lib/detectClassificationFromName';
import {
  montarLinhasDoRelacionamento,
  type CasoDaConversa,
  type LancamentoDoLead,
  type OrigemDoRelacionamento,
} from '@/lib/relacionamentoDoContato';

/** Mensagem no formato que a edge function lê. */
export interface MensagemParaLeitura {
  direction: 'in' | 'out';
  text: string;
  /** 'YYYY-MM-DD'. */
  at?: string;
}

interface Params {
  /** Só roda com a conversa aberta na tela. */
  ativo: boolean;
  contactId?: string | null;
  contactName?: string | null;
  leadId?: string | null;
  /** Últimas mensagens, para a IA ler quando não há nada cadastrado. */
  getMensagens: () => MensagemParaLeitura[];
}

/**
 * Já resolvido nesta sessão. Reabrir a conversa (ou alternar entre a caixa de
 * entrada e o telão) não gasta outra chamada de IA para o mesmo contato.
 */
const CACHE = new Map<string, { slugs: string[]; origem: OrigemDoRelacionamento; motivo: string }>();

/** Espera a conversa assentar antes de gastar IA em quem só passou pela tela. */
const ESPERA_IA_MS = 1200;

export function useRelacionamentoDoContato({ ativo, contactId, contactName, leadId, getMensagens }: Params) {
  const { classifications: disponiveis } = useContactClassifications();
  const [slugs, setSlugs] = useState<string[]>([]);
  const [origem, setOrigem] = useState<OrigemDoRelacionamento>('desconhecido');
  const [motivo, setMotivo] = useState('');
  const [lendo, setLendo] = useState(false);
  const [caso, setCaso] = useState<CasoDaConversa | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoDoLead[]>([]);

  // A lista de mensagens muda a cada mensagem nova; entra por ref para o efeito
  // depender só do contato — senão a IA seria chamada a cada bolha que chega.
  const mensagensRef = useRef(getMensagens);
  mensagensRef.current = getMensagens;

  const opcoes = useMemo(
    () => (disponiveis || []).map((c: any) => ({ name: c.name as string, label: classificationLabel(c.name) })),
    [disponiveis]
  );

  // ===== 1) o que já está gravado no contato =====
  useEffect(() => {
    if (!ativo || !contactId) {
      setSlugs([]);
      setOrigem('desconhecido');
      setMotivo('');
      return;
    }
    const doCache = CACHE.get(contactId);
    if (doCache) {
      setSlugs(doCache.slugs);
      setOrigem(doCache.origem);
      setMotivo(doCache.motivo);
      return;
    }
    let cancelado = false;
    (async () => {
      const { data } = await (db as any)
        .from('contacts')
        .select('classifications')
        .eq('id', contactId)
        .maybeSingle();
      if (cancelado) return;
      const salvos: string[] = Array.isArray(data?.classifications) ? data.classifications.filter(Boolean) : [];
      if (salvos.length) {
        CACHE.set(contactId, { slugs: salvos, origem: 'salvo', motivo: '' });
        setSlugs(salvos);
        setOrigem('salvo');
        setMotivo('');
      } else {
        setSlugs([]);
        setOrigem('desconhecido');
        setMotivo('');
      }
    })();
    return () => { cancelado = true; };
  }, [ativo, contactId]);

  // ===== 2) o nome, e só então 3) a IA lendo a conversa =====
  useEffect(() => {
    if (!ativo || !contactId) return;
    if (origem !== 'desconhecido') return; // já temos de onde tirar
    if (!opcoes.length) return; // lista de status ainda carregando
    const nome = (contactName || '').trim();

    // 2) o nome entrega o papel — sem custo e sem chance de alucinar.
    if (nome.length >= 3) {
      const doNome = detectClassificationFromName(nome, opcoes.map((o) => o.name));
      if (doNome.length) {
        const achado = { slugs: doNome.map((h) => h.slug), origem: 'nome' as const, motivo: `o nome traz "${doNome.map((h) => h.matched).join('", "')}"` };
        CACHE.set(contactId, achado);
        setSlugs(achado.slugs);
        setOrigem('nome');
        setMotivo(achado.motivo);
        return;
      }
    }

    // 3) a IA lê a conversa. Sem mensagem suficiente, não vale a chamada.
    let cancelado = false;
    const timer = setTimeout(async () => {
      const mensagens = (mensagensRef.current?.() || []).filter((m) => m?.text?.trim());
      if (mensagens.length < 3) return;
      setLendo(true);
      try {
        const { data, error } = await cloudFunctions.invoke('suggest-contact-classification', {
          body: {
            contact: { name: nome || 'Contato do WhatsApp' },
            allowed: opcoes,
            messages: mensagens.slice(-40),
          },
        });
        if (cancelado || error) return;
        const sugeridos: string[] = Array.isArray(data?.suggested) ? data.suggested : [];
        // Confiança baixa não vira contexto: prompt sem relacionamento é melhor
        // que prompt com o relacionamento errado.
        if (!sugeridos.length || data?.confidence === 'baixa') return;
        const achado = { slugs: sugeridos, origem: 'ia' as const, motivo: String(data?.reason || '') };
        CACHE.set(contactId, achado);
        setSlugs(sugeridos);
        setOrigem('ia');
        setMotivo(achado.motivo);
      } catch {
        /* silencioso: a conversa segue exatamente como estava */
      } finally {
        if (!cancelado) setLendo(false);
      }
    }, ESPERA_IA_MS);
    return () => { cancelado = true; clearTimeout(timer); };
  }, [ativo, contactId, contactName, origem, opcoes]);

  // ===== caso ligado à conversa + livro-caixa do lead =====
  useEffect(() => {
    if (!ativo || !leadId) {
      setCaso(null);
      setLancamentos([]);
      return;
    }
    let cancelado = false;
    (async () => {
      const [lead, financeiro] = await Promise.all([
        (db as any).from('leads').select('lead_name, lead_status, case_type, case_number').eq('id', leadId).maybeSingle(),
        (db as any)
          .from('lead_financials')
          .select('entry_type, category, description, amount, entry_date')
          .eq('lead_id', leadId)
          .order('entry_date', { ascending: false })
          .limit(50),
      ]);
      if (cancelado) return;
      const l = lead?.data;
      setCaso(
        l
          ? {
            nome: l.lead_name || null,
            status: l.lead_status || null,
            tipoDoCaso: l.case_type || null,
            numeroDoProcesso: l.case_number || null,
          }
          : null
      );
      setLancamentos(Array.isArray(financeiro?.data) ? (financeiro.data as LancamentoDoLead[]) : []);
    })();
    return () => { cancelado = true; };
  }, [ativo, leadId]);

  const rotulos = useMemo(
    () => slugs.map((s) => opcoes.find((o) => o.name === s)?.label || classificationLabel(s)),
    [slugs, opcoes]
  );

  /** As linhas que vão no prompt da sugestão. */
  const linhas = useMemo(
    () => montarLinhasDoRelacionamento({ relacionamento: rotulos, origem, caso, lancamentos }),
    [rotulos, origem, caso, lancamentos]
  );

  /** Grava no contato o que está valendo (ou o que a pessoa corrigiu na barra). */
  const gravar = useCallback(async (novos: string[]) => {
    if (!contactId) return;
    const limpos = novos.filter(Boolean);
    const { error } = await (db as any)
      .from('contacts')
      .update({ classifications: limpos.length ? limpos : null })
      .eq('id', contactId);
    if (error) throw error;
    CACHE.set(contactId, { slugs: limpos, origem: 'salvo', motivo: '' });
    setSlugs(limpos);
    setOrigem(limpos.length ? 'salvo' : 'desconhecido');
    setMotivo('');
  }, [contactId]);

  return {
    /** Slugs em uso agora. */
    slugs,
    /** Rótulos legíveis ("Cliente", "Parceiro"). */
    rotulos,
    origem,
    /** Por que a IA/nome concluiu isso — só para a tela. */
    motivo,
    /** IA lendo a conversa agora. */
    lendo,
    /** Linhas de contexto para o prompt da IA. */
    linhas,
    /** Status que existem neste workspace (para a correção na barra). */
    opcoes,
    /** Confirma o que está na tela, gravando no contato. */
    confirmar: useCallback(() => gravar(slugs), [gravar, slugs]),
    /** Corrige para outra escolha e grava. */
    definir: gravar,
  };
}
