import { useState, useEffect, useMemo, useCallback } from 'react';
// `lead_financials` é tabela de NEGÓCIO: vive no Supabase Externo, com FK para
// leads/legal_cases/lead_processes/lead_activities de lá. A aba do lead usava o
// client Cloud — errado, e por isso silenciosamente vazia. Aqui vai pelo `db`
// (Externo), com `created_by` remapeado para o auth do Externo.
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { trackFinanceEntry } from '@/hooks/useFinanceTimeTracker';
import { toast } from 'sonner';
import { Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Edit2, Landmark, User } from 'lucide-react';
import { format } from 'date-fns';
import { cnjVariantes } from '@/lib/cnj';
import {
  classificarLancamento, CATEGORIAS_LANCAMENTO, ESPECIE_LABEL,
  type TitularLancamento, type EspecieLancamento,
} from '@/lib/lancamentoCategorias';

export interface EntityFinancialEntry {
  id: string;
  lead_id: string | null;
  case_id: string | null;
  process_id: string | null;
  activity_id: string | null;
  entry_type: 'entrada' | 'saida';
  amount: number;
  description: string | null;
  category: string | null;
  entry_date: string;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * De onde o painel está sendo aberto. Define QUAL filtro busca os lançamentos:
 *  - lead     -> tudo do lead (comportamento histórico da aba Financeiro do lead)
 *  - case     -> tudo do caso
 *  - process  -> tudo do processo, inclusive o que foi lançado dentro das atividades dele
 *  - activity -> só o que foi lançado dentro daquela atividade
 *
 * O INSERT sempre grava TODOS os vínculos conhecidos, então uma despesa criada
 * na atividade aparece também no processo, no caso e no lead sem consulta extra.
 */
export type FinancialScope = 'lead' | 'case' | 'process' | 'activity';

/**
 * Destino possível de um lançamento feito de dentro da atividade. A atividade
 * pode estar vinculada a processo, caso e lead ao mesmo tempo, e nem toda
 * despesa é do processo — deslocamento para conversar com o cliente é do lead.
 * Por isso o formulário pergunta em qual dos vínculos gravar, em vez de assumir.
 */
export interface FinancialLinkOption {
  key: string;
  label: string;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
}

/**
 * Monta os destinos de uma atividade, do mais específico ao menos: processo,
 * caso, lead. Só entram os que a atividade realmente tem vinculados.
 * Compartilhado entre a ActivitiesPage e o ActivityFullSheet — são duas telas
 * diferentes para a mesma atividade e precisam oferecer as mesmas opções.
 */
export function buildFinancialLinkOptions(input: {
  processId?: string | null; processLabel?: string | null;
  caseId?: string | null;    caseLabel?: string | null;
  leadId?: string | null;    leadLabel?: string | null;
}): FinancialLinkOption[] {
  const out: FinancialLinkOption[] = [];
  if (input.processId) {
    out.push({
      key: 'processo',
      label: `Processo — ${input.processLabel || 'sem número'}`,
      processId: input.processId,
      caseId: input.caseId || null,
      leadId: input.leadId || null,
    });
  }
  if (input.caseId) {
    out.push({
      key: 'caso',
      label: `Caso — ${input.caseLabel || 'sem título'}`,
      caseId: input.caseId,
      leadId: input.leadId || null,
    });
  }
  if (input.leadId) {
    out.push({
      key: 'lead',
      label: `Lead — ${input.leadLabel || 'sem nome'}`,
      leadId: input.leadId,
    });
  }
  return out;
}

interface EntityFinancialsPanelProps {
  scope: FinancialScope;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
  activityId?: string | null;
  /**
   * Nº CNJ do processo (scope 'process'). Com ele, o painel vira o EXTRATO do
   * processo: soma às linhas manuais as parcelas da jurimetria (jm_pagamentos)
   * e o extrato importado da planilha (jm_lancamentos), separando o que é do
   * escritório do que é do cliente.
   */
  processNumber?: string | null;
  /**
   * Destinos oferecidos no formulário. Com 2+ opções vira um seletor
   * obrigatório; com 1 o destino é usado direto. Vazio/ausente = usa os ids
   * passados nas props (comportamento das abas de lead e processo).
   */
  linkOptions?: FinancialLinkOption[];
  /** Texto curto mostrado acima da lista, explicando a que o lançamento fica vinculado. */
  contextLabel?: string;
  /** Altura máxima da lista. Padrão 300px (igual à aba do lead). */
  listMaxHeight?: string;
}

// As categorias do formulário e o significado de cada uma vivem em
// @/lib/lancamentoCategorias — a mesma régua classifica o lançamento manual e a
// linha importada da planilha, para as duas contarem a mesma história.
const CATEGORIES = CATEGORIAS_LANCAMENTO;

/**
 * Linha do EXTRATO do processo. Além dos lançamentos manuais (lead_financials),
 * a aba do processo mescla o que a jurimetria já sabe do CNJ:
 *  - `parcela`  -> jm_pagamentos (parcelas de acordo/execução, por parte)
 *  - `planilha` -> jm_lancamentos (extrato importado do financeiro antigo)
 * Linhas de jm_* são SÓ leitura — a fonte é a planilha/captura, não este form.
 */
interface LinhaExtrato {
  key: string;
  data: string | null;
  descricao: string;
  detalhe: string | null;
  categoria: string | null;
  /** null = valor bruto da parte (cliente + honorário juntos, sem separação). */
  titular: TitularLancamento | null;
  /** Contratual, sucumbencial, cota do cliente... null na parcela sem abertura. */
  especie: EspecieLancamento | null;
  direcao: 'entrada' | 'saida' | null;
  /** true = ainda não é caixa (parcela prevista, "a receber" da planilha). */
  previsto: boolean;
  /** Antecipação do FIDC: entrou caixa, mas o processo continua tramitando. */
  adiantado: boolean;
  /** null = a importação não trouxe o valor (mostrar "sem valor", nunca R$ 0). */
  valor: number | null;
  origem: 'manual' | 'planilha' | 'parcela';
  entry?: EntityFinancialEntry;
}

const EMPTY_MESSAGE: Record<FinancialScope, string> = {
  lead: 'Nenhum lançamento financeiro',
  case: 'Nenhum lançamento financeiro neste caso',
  process: 'Nenhum lançamento financeiro neste processo',
  activity: 'Nenhum lançamento financeiro nesta atividade',
};

export function EntityFinancialsPanel({
  scope,
  leadId,
  caseId,
  processId,
  activityId,
  processNumber,
  linkOptions,
  contextLabel,
  listMaxHeight = '300px',
}: EntityFinancialsPanelProps) {
  const [entries, setEntries] = useState<EntityFinancialEntry[]>([]);
  const [jmLinhas, setJmLinhas] = useState<LinhaExtrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntityFinancialEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [targetKey, setTargetKey] = useState<string>('');
  const [form, setForm] = useState({
    entry_type: 'saida' as 'entrada' | 'saida',
    amount: '',
    description: '',
    category: '',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    payment_method: '',
    notes: '',
  });

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    await ensureExternalSession().catch(() => {});
    let query = db
      .from('lead_financials' as any)
      .select('*')
      .order('entry_date', { ascending: false });

    if (scope === 'activity') {
      if (!activityId) { setEntries([]); setLoading(false); return; }
      query = query.eq('activity_id', activityId);
    } else if (scope === 'process') {
      if (!processId) { setEntries([]); setLoading(false); return; }
      query = query.eq('process_id', processId);
    } else if (scope === 'case') {
      if (!caseId) { setEntries([]); setLoading(false); return; }
      query = query.eq('case_id', caseId);
    } else {
      if (!leadId) { setEntries([]); setLoading(false); return; }
      // Aba do lead: mantém o comportamento histórico (lead OU caso vinculado).
      query = caseId
        ? query.or(`lead_id.eq.${leadId},case_id.eq.${caseId}`)
        : query.eq('lead_id', leadId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[EntityFinancialsPanel] erro ao carregar lançamentos:', error.message);
      toast.error('Erro ao carregar lançamentos: ' + error.message);
      setEntries([]);
    } else {
      setEntries((data as any[] || []) as EntityFinancialEntry[]);
    }
    setLoading(false);
  }, [scope, leadId, caseId, processId, activityId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  /** Extrato da jurimetria — só na aba do processo, e só leitura. */
  const fetchJm = useCallback(async () => {
    if (scope !== 'process' || !processNumber) { setJmLinhas([]); return; }
    const variantes = cnjVariantes(processNumber);
    if (!variantes.length) { setJmLinhas([]); return; }
    await ensureExternalSession().catch(() => {});
    // As tabelas jm_* vivem no Externo e não existem no schema tipado do client
    // — mesmo desvio do useConferenciaProcesso.
    type Linha = Record<string, unknown>;
    type Consulta = Promise<{ data: Linha[] | null; error: { message?: string } | null }>;
    const externo = db as unknown as {
      from: (t: string) => { select: (c: string) => { in: (col: string, vals: string[]) => Consulta } };
    };
    const [pag, lanc] = await Promise.all([
      externo.from('jm_pagamentos')
        .select('id, cliente, n_parcela, data_prevista, data_recebida, valor_pago, valor_previsto, forma')
        .in('processo_cnj', variantes),
      externo.from('jm_lancamentos')
        .select('id, data, pessoa, categoria, subcategoria, tipo, valor_caixa, valor_competencia, beneficiario, observacao')
        .in('processo_cnj', variantes),
    ]);
    // Falha aqui não derruba o painel manual — extrato importado fica de fora.
    if (pag.error || lanc.error) {
      console.error('[EntityFinancialsPanel] extrato jm:', pag.error?.message || lanc.error?.message);
      setJmLinhas([]);
      return;
    }
    const texto = (v: unknown) => (v == null ? null : String(v));
    const linhas: LinhaExtrato[] = [];
    for (const p of pag.data || []) {
      const recebida = !!p.data_recebida;
      const valor = recebida ? p.valor_pago : p.valor_previsto;
      linhas.push({
        key: `pg-${p.id}`,
        data: texto(p.data_recebida) || texto(p.data_prevista),
        descricao: `Parcela ${p.n_parcela ?? 1} — ${texto(p.cliente) || 'sem parte'}`,
        detalhe: [recebida ? 'recebida' : 'prevista', texto(p.forma)].filter(Boolean).join(' · '),
        categoria: 'Parcela do processo',
        // Parcela é o BRUTO da parte: cota do cliente + honorário juntos. Sem a
        // separação na base, o extrato não chuta de quem é — marca como bruto.
        titular: null,
        especie: null,
        direcao: 'entrada',
        previsto: !recebida,
        adiantado: false,
        valor: valor == null ? null : Number(valor),
        origem: 'parcela',
      });
    }
    for (const l of lanc.data || []) {
      const cat = texto(l.categoria) || '';
      const valor = l.valor_caixa ?? l.valor_competencia;
      const beneficiario = texto(l.beneficiario);
      const pessoa = texto(l.pessoa);
      // Titular, espécie e "é caixa?" saem do vocabulário — nunca de palpite
      // sobre o texto da categoria aqui dentro.
      const cls = classificarLancamento({ categoria: cat, pessoa });
      // PESSOA carrega HC/HS nas linhas de honorário: aí a espécie já diz isso e
      // repetir "HC" no detalhe é ruído. Quando é nome, é de quem decorre o valor.
      const pessoaEhRotulo = !!pessoa && /^h[cs]\b/i.test(pessoa);
      linhas.push({
        key: `lc-${l.id}`,
        data: texto(l.data),
        descricao: [cat || 'Lançamento', texto(l.subcategoria)].filter(Boolean).join(' · '),
        detalhe: [
          pessoaEhRotulo ? null : pessoa,
          beneficiario && `p/ ${beneficiario}`,
          texto(l.observacao),
        ].filter(Boolean).join(' · ') || null,
        categoria: cat || null,
        titular: cls.titular,
        especie: cls.especie,
        direcao: l.tipo === 'ENTRADA' ? 'entrada' : l.tipo === 'SAIDA' ? 'saida' : null,
        previsto: cls.previsto,
        adiantado: cls.adiantado,
        valor: valor == null ? null : Number(valor),
        origem: 'planilha',
      });
    }
    setJmLinhas(linhas);
  }, [scope, processNumber]);

  useEffect(() => { void fetchJm(); }, [fetchJm]);

  /** Só entram destinos que de fato têm vínculo — atividade sem processo não oferece "Processo". */
  const targets = useMemo(
    () => (linkOptions || []).filter(o => o.leadId || o.caseId || o.processId),
    [linkOptions],
  );
  const hasTargets = targets.length > 0;
  const target = targets.find(t => t.key === targetKey) || null;

  /** Destino que corresponde a um lançamento já gravado — do mais específico ao menos. */
  const targetKeyOf = useCallback((entry: EntityFinancialEntry) => {
    const match =
      (entry.process_id && targets.find(t => t.processId === entry.process_id)) ||
      (entry.case_id && targets.find(t => t.caseId === entry.case_id && !t.processId)) ||
      (entry.lead_id && targets.find(t => t.leadId === entry.lead_id && !t.processId && !t.caseId));
    return match ? match.key : (targets[0]?.key || '');
  }, [targets]);

  const totals = useMemo(() => {
    const receitas = entries.filter(e => e.entry_type === 'entrada').reduce((s, e) => s + Number(e.amount), 0);
    const despesas = entries.filter(e => e.entry_type === 'saida').reduce((s, e) => s + Number(e.amount), 0);
    return { receitas, despesas, lucro: receitas - despesas };
  }, [entries]);

  /** Extrato completo do processo: manuais + jurimetria, mais novo primeiro. */
  const extrato = useMemo<LinhaExtrato[]>(() => {
    const manuais: LinhaExtrato[] = entries.map(e => {
      const cls = classificarLancamento({ categoria: e.category });
      return {
        key: `mn-${e.id}`,
        data: e.entry_date,
        descricao: e.description || e.category || 'Sem descrição',
        detalhe: scope !== 'activity' && e.activity_id ? 'via atividade' : null,
        categoria: e.category,
        titular: cls.titular,
        especie: cls.especie,
        direcao: e.entry_type === 'entrada' ? 'entrada' as const : 'saida' as const,
        previsto: cls.previsto,
        adiantado: cls.adiantado,
        valor: Number(e.amount),
        origem: 'manual' as const,
        entry: e,
      };
    });
    return [...manuais, ...jmLinhas]
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  }, [entries, jmLinhas, scope]);

  /**
   * Totais do extrato, nas réguas que a pergunta "cadê o dinheiro deste
   * processo" exige. Cada valor entra em UMA linha só:
   *  - contratual/sucumbencial: honorário do escritório JÁ recebido;
   *  - cliente: a cota da parte já paga a ela;
   *  - despesas: saídas do escritório (repasse ao cliente NÃO é despesa);
   *  - aReceber*: o que está previsto para data futura — nunca somado ao caixa;
   *  - adiantado: antecipação do FIDC (Oriz). É caixa, mas NÃO é o processo
   *    pagando — o processo continua tramitando, então fica fora do recebido;
   *  - brutoParcelas: parcela de jm_pagamentos sem abertura cliente×honorário.
   * Linha sem valor importado não soma em lugar nenhum.
   */
  const totaisProcesso = useMemo(() => {
    let contratual = 0, sucumbencial = 0, outrosHonorarios = 0, cliente = 0;
    let despesas = 0, adiantado = 0, brutoParcelas = 0, semValor = 0;
    let aReceberEscritorio = 0, aReceberCliente = 0;
    for (const l of extrato) {
      if (l.valor == null) { semValor += 1; continue; }
      if (l.previsto) {
        if (l.origem === 'parcela') continue; // parcela prevista já aparece na linha
        if (l.titular === 'cliente') aReceberCliente += l.valor; else aReceberEscritorio += l.valor;
        continue;
      }
      if (l.adiantado) { adiantado += l.valor; continue; }
      if (l.origem === 'parcela') { brutoParcelas += l.valor; continue; }
      if (l.direcao === 'entrada') {
        if (l.titular === 'cliente') cliente += l.valor;
        else if (l.especie === 'honorario_contratual') contratual += l.valor;
        else if (l.especie === 'honorario_sucumbencial') sucumbencial += l.valor;
        else outrosHonorarios += l.valor;
      } else if (l.direcao === 'saida' && l.titular !== 'cliente') {
        despesas += l.valor;
      }
    }
    const escritorio = contratual + sucumbencial + outrosHonorarios;
    return {
      contratual, sucumbencial, outrosHonorarios, escritorio, cliente, despesas,
      resultado: escritorio - despesas,
      aReceberEscritorio, aReceberCliente, adiantado, brutoParcelas, semValor,
    };
  }, [extrato]);

  const ehExtrato = scope === 'process' && !!processNumber;

  const resetForm = () => {
    setForm({
      entry_type: 'saida',
      amount: '',
      description: '',
      category: '',
      entry_date: format(new Date(), 'yyyy-MM-dd'),
      payment_method: '',
      notes: '',
    });
  };

  const handleSave = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Informe o valor');
      return;
    }
    if (hasTargets && !target) {
      toast.error('Escolha onde registrar');
      return;
    }

    setSaving(true);
    try {
      // Com destino escolhido, gravam-se os vínculos DELE — uma despesa atribuída
      // ao lead não deve aparecer no financeiro do processo. Sem destino (abas de
      // lead e processo), valem os ids das props.
      const payload = {
        lead_id: (hasTargets ? target?.leadId : leadId) || null,
        case_id: (hasTargets ? target?.caseId : caseId) || null,
        process_id: (hasTargets ? target?.processId : processId) || null,
        activity_id: activityId || null,
        entry_type: form.entry_type,
        amount: parseFloat(form.amount),
        description: form.description || null,
        category: form.category || null,
        entry_date: form.entry_date,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
      };

      await ensureExternalSession().catch(() => {});

      if (editingEntry) {
        const { error } = await db.from('lead_financials' as any).update(payload).eq('id', editingEntry.id);
        if (error) throw error;
      } else {
        // O usuário autentica no Cloud; `created_by` referencia o auth do Externo.
        const { data: { user } } = await authClient.auth.getUser();
        const createdBy = await remapToExternal(user?.id).catch(() => null);
        const { error } = await db.from('lead_financials' as any).insert({ ...payload, created_by: createdBy });
        if (error) throw error;
      }

      // Lançamento gravado → conta o tempo no cronômetro (guarda-chuva do dia).
      void trackFinanceEntry();

      toast.success(editingEntry ? 'Registro atualizado' : 'Registro adicionado');
      setDialogOpen(false);
      setEditingEntry(null);
      resetForm();
      fetchEntries();
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await ensureExternalSession().catch(() => {});
    const { error } = await db.from('lead_financials' as any).delete().eq('id', id);
    if (error) { toast.error('Erro ao remover: ' + error.message); return; }
    toast.success('Removido');
    fetchEntries();
  };

  const openEdit = (entry: EntityFinancialEntry) => {
    setEditingEntry(entry);
    setTargetKey(targetKeyOf(entry));
    setForm({
      entry_type: entry.entry_type,
      amount: String(entry.amount),
      description: entry.description || '',
      category: entry.category || '',
      entry_date: entry.entry_date,
      payment_method: entry.payment_method || '',
      notes: entry.notes || '',
    });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-4">
      {contextLabel && (
        <p className="text-[11px] text-muted-foreground leading-snug">{contextLabel}</p>
      )}

      {/* Summary Cards. Na aba do processo os totais abrem por TITULAR —
          quanto é do escritório e quanto é do cliente — porque somar tudo numa
          "receita" só mistura dinheiro nosso com dinheiro que é dever de repasse. */}
      {ehExtrato ? (
        <>
          {/* Honorário do escritório aberto em contratual × sucumbencial: são
              recebíveis distintos e a planilha já separa (HC/HS na coluna
              PESSOA). A cota do cliente fica num card à parte porque nunca foi
              receita nossa — é dinheiro dele passando pela conta. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="p-3 text-center">
                <Landmark className="h-4 w-4 text-green-600 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Honorário contratual</p>
                <p className="text-sm font-bold text-green-600">{formatCurrency(totaisProcesso.contratual)}</p>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="p-3 text-center">
                <Landmark className="h-4 w-4 text-emerald-600 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Honorário sucumbencial</p>
                <p className="text-sm font-bold text-emerald-600">{formatCurrency(totaisProcesso.sucumbencial)}</p>
              </CardContent>
            </Card>
            <Card className="border-sky-200 bg-sky-50/50">
              <CardContent className="p-3 text-center">
                <User className="h-4 w-4 text-sky-600 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Cota do cliente</p>
                <p className="text-sm font-bold text-sky-600">{formatCurrency(totaisProcesso.cliente)}</p>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50/50">
              <CardContent className="p-3 text-center">
                <TrendingDown className="h-4 w-4 text-red-600 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Despesas</p>
                <p className="text-sm font-bold text-red-600">{formatCurrency(totaisProcesso.despesas)}</p>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="p-3 text-center">
                <TrendingUp className="h-4 w-4 text-amber-600 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">A receber</p>
                <p className="text-sm font-bold text-amber-600">
                  {formatCurrency(totaisProcesso.aReceberEscritorio + totaisProcesso.aReceberCliente)}
                </p>
              </CardContent>
            </Card>
            <Card className={totaisProcesso.resultado >= 0 ? 'border-blue-200 bg-blue-50/50' : 'border-amber-200 bg-amber-50/50'}>
              <CardContent className="p-3 text-center">
                <DollarSign className="h-4 w-4 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Resultado do escritório</p>
                <p className={`text-sm font-bold ${totaisProcesso.resultado >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>{formatCurrency(totaisProcesso.resultado)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-1 text-[11px] text-muted-foreground leading-snug">
            {(totaisProcesso.aReceberEscritorio > 0 || totaisProcesso.aReceberCliente > 0) && (
              <p>
                A receber é acordo com pagamento em data futura, ainda não é caixa:{' '}
                {formatCurrency(totaisProcesso.aReceberEscritorio)} do escritório e{' '}
                {formatCurrency(totaisProcesso.aReceberCliente)} do cliente. Quando a parcela é paga,
                a linha muda de "a receber" para recebida — é o mesmo lançamento, não um novo.
              </p>
            )}
            {totaisProcesso.adiantado > 0 && (
              <p className="text-amber-700">
                {formatCurrency(totaisProcesso.adiantado)} adiantados pelo FIDC (Oriz) — entrou caixa,
                mas não foi o processo que pagou: ele continua em tramitação. Fora do recebido.
              </p>
            )}
            {totaisProcesso.outrosHonorarios > 0 && (
              <p>
                {formatCurrency(totaisProcesso.outrosHonorarios)} em honorário sem HC/HS na planilha —
                entra no resultado, mas não dá para dizer se é contratual ou sucumbencial.
              </p>
            )}
            {totaisProcesso.brutoParcelas > 0 && (
              <p>
                Parcelas recebidas no bruto (cota do cliente + honorário juntos, sem separação na
                base): {formatCurrency(totaisProcesso.brutoParcelas)} — fora dos cards.
              </p>
            )}
            {totaisProcesso.semValor > 0 && (
              <p>{totaisProcesso.semValor} lançamento(s) sem valor importado não somam em nada.</p>
            )}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-3 text-center">
              <TrendingUp className="h-4 w-4 text-green-600 mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">Receitas</p>
              <p className="text-sm font-bold text-green-600">{formatCurrency(totals.receitas)}</p>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="p-3 text-center">
              <TrendingDown className="h-4 w-4 text-red-600 mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">Despesas</p>
              <p className="text-sm font-bold text-red-600">{formatCurrency(totals.despesas)}</p>
            </CardContent>
          </Card>
          <Card className={totals.lucro >= 0 ? 'border-blue-200 bg-blue-50/50' : 'border-amber-200 bg-amber-50/50'}>
            <CardContent className="p-3 text-center">
              <DollarSign className="h-4 w-4 text-primary mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">Resultado</p>
              <p className={`text-sm font-bold ${totals.lucro >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>{formatCurrency(totals.lucro)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Button */}
      <Button
        size="sm"
        onClick={() => { resetForm(); setEditingEntry(null); setTargetKey(targets[0]?.key || ''); setDialogOpen(true); }}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" /> Novo Lançamento
      </Button>

      {/* List */}
      <ScrollArea style={{ maxHeight: listMaxHeight }}>
        <div className="space-y-2">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground py-4">Carregando...</p>
          ) : extrato.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">{EMPTY_MESSAGE[scope]}</p>
          ) : extrato.map(linha => (
            <div key={linha.key} className={`flex items-center justify-between p-2 rounded border text-sm ${linha.previsto ? 'opacity-70' : ''}`}>
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant={linha.direcao === 'entrada' ? 'default' : linha.direcao === 'saida' ? 'destructive' : 'secondary'}
                  className="text-xs flex-shrink-0"
                >
                  {linha.direcao === 'entrada' ? '📥' : linha.direcao === 'saida' ? '📤' : '•'}
                </Badge>
                <div className="min-w-0">
                  <p className="font-medium truncate">{linha.descricao}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {linha.data || 'sem data'}
                    {linha.origem === 'manual' && linha.categoria && ` • ${linha.categoria}`}
                    {linha.detalhe && ` • ${linha.detalhe}`}
                    {linha.origem === 'planilha' && ' • planilha'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* De quem é o dinheiro e que espécie é — as duas perguntas que
                    o extrato responde em cada linha. A espécie já diz honorário
                    contratual/sucumbencial, então o titular vira só o ícone. */}
                {linha.titular === 'escritorio' && (
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] gap-1">
                    <Landmark className="h-2.5 w-2.5" />
                    {linha.especie && linha.especie !== 'operacao' ? ESPECIE_LABEL[linha.especie] : 'escritório'}
                  </Badge>
                )}
                {linha.titular === 'cliente' && (
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] gap-1 border-sky-300 text-sky-700">
                    <User className="h-2.5 w-2.5" />cota do cliente
                  </Badge>
                )}
                {linha.titular === null && (
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px]">bruto da parte</Badge>
                )}
                {linha.previsto && (
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">a receber</Badge>
                )}
                {linha.adiantado && (
                  <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800">antecipado</Badge>
                )}
                <span className={`font-bold text-sm ${linha.valor == null ? 'font-normal text-muted-foreground' : linha.direcao === 'entrada' ? 'text-green-600' : linha.direcao === 'saida' ? 'text-red-600' : 'text-foreground'}`}>
                  {linha.valor == null
                    ? 'sem valor'
                    : `${linha.direcao === 'entrada' ? '+' : linha.direcao === 'saida' ? '-' : ''}${formatCurrency(linha.valor)}`}
                </span>
                {linha.entry && (
                  <>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(linha.entry!)}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(linha.entry!.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEntry ? 'Editar Lançamento' : 'Novo Lançamento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Onde o lançamento fica pendurado. Com um vínculo só, não faz sentido
                perguntar — mostra qual é e segue. */}
            {hasTargets && (targets.length > 1 ? (
              <div>
                <Label className="text-xs">Registrar em *</Label>
                <Select value={targetKey} onValueChange={setTargetKey}>
                  <SelectTrigger><SelectValue placeholder="Escolha o processo ou lead..." /></SelectTrigger>
                  <SelectContent>
                    {targets.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Registrando em: <span className="font-medium text-foreground">{targets[0].label}</span>
              </p>
            ))}

            <div className="flex gap-2">
              <Button
                type="button"
                variant={form.entry_type === 'entrada' ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 ${form.entry_type === 'entrada' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                onClick={() => setForm(p => ({ ...p, entry_type: 'entrada' }))}
              >📥 Receita</Button>
              <Button
                type="button"
                variant={form.entry_type === 'saida' ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 ${form.entry_type === 'saida' ? 'bg-red-600 hover:bg-red-700' : ''}`}
                onClick={() => setForm(p => ({ ...p, entry_type: 'saida' }))}
              >📤 Despesa</Button>
            </div>
            <div>
              <Label className="text-xs">Valor *</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input placeholder="Descrição do lançamento" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (editingEntry ? 'Atualizar' : 'Salvar')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
