import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import {
  Plus, Trash2, DollarSign, TrendingUp, TrendingDown, Edit2, Landmark, User, Handshake,
  CalendarClock, CheckCircle2, Repeat, Paperclip, Sparkles, Loader2, X, Mic, Square,
} from 'lucide-react';
import { format } from 'date-fns';
import { cnjVariantes } from '@/lib/cnj';
// TODA edge function passa pelo roteador — é ele que sabe se a função vive no
// Externo, no Cloud ou no Railway. Chamar `.functions.invoke` direto de um
// client bate no projeto errado e falha calada.
import { cloudFunctions } from '@/lib/functionRouter';
// Imagem e PDF NUNCA abrem página nova (regra de interface do projeto):
// o comprovante abre no lightbox, por cima da ficha.
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import {
  classificarLancamento, CATEGORIAS_LANCAMENTO, ESPECIE_LABEL, mesclarCategorias,
  type TitularLancamento, type EspecieLancamento,
} from '@/lib/lancamentoCategorias';
import {
  montarParteValor, resumirValorProcesso, honorarioDaParte, cotaClienteDaParte,
  parteSemValor, type ParteValor,
} from '@/lib/valorProcesso';
import {
  reguaDoProcesso, competenciaDe, atualizarValor, REGUA_LABEL, PORQUE_LABEL,
} from '@/lib/atualizacaoMonetaria';
import {
  gerarParcelas, antecipar, totalAntecipacao, PERIODICIDADE_LABEL,
  type Parcela, type Periodicidade, type ModoParcelamento,
} from '@/lib/antecipacao';

/** Chave em `system_settings` (Cloud) com o deságio padrão, em % ao mês. */
const CHAVE_DESAGIO = 'desagio_mes_padrao';

/** Bucket do Storage onde comprovante e áudio do ditado ficam — o da nota fiscal. */
const BUCKET_COMPROVANTE = 'invoices';

/** Sem acento e em minúscula, para casar o nome falado com o nome da parte. */
const normalizarNome = (v: string) =>
  v.normalize('NFD')
    .split('')
    .filter(c => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f)
    .join('')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .join(' ');

/**
 * Acima disto a imagem não vai para a IA. Não é limite de banco: é que
 * comprovante de celular passa fácil de 5 MB e a chamada estoura antes de
 * responder. Melhor dizer "reduza" que deixar girando até dar erro feio.
 */
const LIMITE_COMPROVANTE_MB = 4;

/**
 * UM lançamento que a IA leu no documento. Um comprovante devolve um; uma
 * planilha de cálculo devolve vários, e cada um tem natureza própria.
 */
interface ItemIa {
  valor: number | null;
  /** Principal sem juros. null quando o documento não separa. */
  valorNominal: number | null;
  juros: number | null;
  data: string | null;
  tipo: 'entrada' | 'saida' | null;
  descricao: string | null;
  /** Natureza jurídica: dano moral, sucumbência, pensionamento... */
  verba: string | null;
  categoria: string | null;
  /** Nome proposto quando NENHUMA categoria existente serve. */
  categoriaNova: string | null;
  /** Pessoa a quem o valor se refere, como escrita no documento. */
  parte: string | null;
  /** true = o documento mostra que este valor JÁ foi pago. */
  jaPago: boolean;
}

/** O que a edge function `sugerir-lancamento` devolve. Tudo pode ser null. */
interface SugestaoIa {
  documento: string | null;
  lancamentos: ItemIa[];
  valor: number | null;
  data: string | null;
  tipo: 'entrada' | 'saida' | null;
  descricao: string | null;
  categoria: string | null;
  categoriaNova: string | null;
  pagador: string | null;
  beneficiario: string | null;
  confianca: 'alta' | 'media' | 'baixa';
  observacao: string | null;
}

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
  /** VENCIMENTO: quando o dinheiro está previsto para entrar ou sair. */
  entry_date: string;
  /**
   * De QUEM veio (ou para quem foi) o dinheiro. `contact_id` é a pessoa no CRM e
   * vale em qualquer objeto; `parte_id` é a parte do processo em `jm_partes`, que
   * é onde a planilha calculou a cota e o honorário dela. `parte_nome` é o
   * retrato do nome, para o extrato sobreviver a uma reimportação da planilha.
   */
  contact_id: string | null;
  parte_id: string | null;
  parte_nome: string | null;
  /** Comprovante no bucket `invoices`. null = lançamento sem prova. */
  receipt_url: string | null;
  /** Natureza jurídica do valor: dano moral, sucumbência, pensionamento... */
  verba: string | null;
  /** Principal sem juros, quando o documento separa. `amount` é o total. */
  valor_nominal: number | null;
  juros: number | null;
  /** false = sugestão de IA esperando alguém olhar. NÃO entra em total nenhum. */
  conferido: boolean;
  /**
   * Quando entrou/saiu DE FATO. null = ainda é recebível — "a receber" enquanto
   * o vencimento não chega, VENCIDO depois dele. Data que passa não é prova de
   * pagamento: a linha só vira caixa quando alguém baixa.
   */
  settled_at: string | null;
  /** Parcelas do mesmo plano compartilham o grupo. null = lançamento avulso. */
  parcela_grupo: string | null;
  parcela_n: number | null;
  parcela_de: number | null;
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
  /** 'repasse' = dinheiro de terceiro passando pela conta (cliente/parceiro). */
  direcao: 'entrada' | 'saida' | 'repasse' | null;
  /** true = ainda não é caixa (parcela prevista, "a receber" da planilha). */
  previsto: boolean;
  /** Antecipação do FIDC: entrou caixa, mas o processo continua tramitando. */
  adiantado: boolean;
  /** Valor fixado sem data de pagamento (a data da linha é a da decisão). */
  semCronograma?: boolean;
  /** Previsto cujo vencimento já passou e ninguém baixou. Segue fora do caixa. */
  vencido?: boolean;
  /** Vencimento da linha ainda em aberto — é o prazo que a antecipação desconta. */
  vencimento?: string | null;
  /** "3/12" quando a linha faz parte de um plano de parcelamento. */
  parcela?: { n: number; de: number } | null;
  /** false = ainda não conferida; fica fora de todos os totais. */
  conferido?: boolean;
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
  // Valor do processo (jm_partes) vive em estado PRÓPRIO, separado do extrato:
  // é estoque, não caixa, e misturar os dois conta o mesmo dinheiro duas vezes.
  const [partesValor, setPartesValor] = useState<ParteValor[]>([]);
  const [verPartes, setVerPartes] = useState(false);
  // competência -> coeficiente, já da régua deste processo e da safra vigente.
  const [coeficientes, setCoeficientes] = useState<Map<string, number>>(new Map());
  const [safra, setSafra] = useState<string | null>(null);
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
    /** Vencimento. */
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    /** 'parte:<parte_id>' ou 'contato:<contact_id>'. Vazio = não informado. */
    parte: '',
    /** URL do comprovante já gravado (edição) ou recém-enviado. */
    receipt_url: '',
    /** true depois que a pessoa clica no par Já entrou/Previsto — ver o onChange da data. */
    settledTocado: false,
    /** false = ainda não entrou; a linha nasce como recebível. */
    settled: true,
    /** Só na edição: quando pagaram, se for diferente do vencimento. */
    settled_date: '',
    parcelar: false,
    parcelas: '2',
    periodicidade: 'mensal' as Periodicidade,
    modo: 'dividir' as ModoParcelamento,
    payment_method: '',
    notes: '',
  });

  // Deságio da antecipação, em % ao mês. Mora em `system_settings` (Cloud) para
  // valer para a equipe toda — taxa que só existe neste navegador vira proposta
  // diferente para cada pessoa que abre a tela.
  const [taxaMes, setTaxaMes] = useState('');
  const [taxaSalva, setTaxaSalva] = useState('');
  const [salvandoTaxa, setSalvandoTaxa] = useState(false);

  /** Hoje congelado no render: `extrato` e antecipação precisam do MESMO dia. */
  const hoje = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  /** Contatos do lead — quem responde "de quem veio o dinheiro" fora do processo. */
  const [contatos, setContatos] = useState<{ id: string; nome: string }[]>([]);

  // Comprovante em mãos, antes de salvar: o arquivo (para subir) e a data URL
  // (para a IA ler e para a prévia). Um sem o outro não serve.
  const [comprovante, setComprovante] = useState<{ arquivo: File; dataUrl: string } | null>(null);
  const [pensando, setPensando] = useState<'comprovante' | 'categoria' | 'audio' | null>(null);
  const [gravando, setGravando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const [sugestao, setSugestao] = useState<SugestaoIa | null>(null);
  /** Categoria que a IA propôs criar e a pessoa aceitou. Vira opção na lista. */
  const [categoriaCriada, setCategoriaCriada] = useState<string | null>(null);
  const [verComprovante, setVerComprovante] = useState<string | null>(null);

  // Documento com VÁRIOS valores: a tela deixa de preencher o formulário e passa
  // a mostrar a lista para escolher. Preencher um campo só com o primeiro de
  // onze seria esconder o resto do documento.
  const [itensIa, setItensIa] = useState<ItemIa[]>([]);
  const [escolha, setEscolha] = useState<Set<number>>(new Set());

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

  /**
   * Coeficientes da régua DESTE processo. Qual régua vale sai do CNJ (dígito J):
   * trabalhista e comum divergem em tudo que é anterior a set/2024. Busca só as
   * competências que as partes realmente usam — a série tem 380 meses e carregar
   * tudo para usar 3 é desperdício em toda abertura de ficha.
   */
  const carregarCoeficientes = useCallback(async (lista: ParteValor[]) => {
    const regua = reguaDoProcesso(processNumber);
    const comps = [...new Set(lista.map(p => competenciaDe(p.termoInicial)).filter(Boolean))] as string[];
    if (!regua || !comps.length) { setCoeficientes(new Map()); setSafra(null); return; }
    const externo = db as unknown as {
      from: (t: string) => { select: (c: string) => {
        eq: (col: string, v: string) => { in: (col: string, vals: string[]) => {
          order: (col: string, o: { ascending: boolean }) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>;
        } };
      } };
    };
    const { data, error } = await externo.from('jm_indices')
      .select('competencia, coeficiente, referencia')
      .eq('indice', regua)
      .in('competencia', comps)
      .order('referencia', { ascending: false });
    if (error) {
      console.error('[EntityFinancialsPanel] coeficientes:', error.message);
      setCoeficientes(new Map()); setSafra(null);
      return;
    }
    // Ordenado por referência decrescente: o primeiro de cada competência é a
    // safra mais nova. Safra velha corrige menos e ninguém percebe — por isso a
    // data da safra vai para a tela junto do valor.
    const mapa = new Map<string, number>();
    let ref: string | null = null;
    for (const linha of data || []) {
      const comp = String(linha.competencia);
      if (!mapa.has(comp)) mapa.set(comp, Number(linha.coeficiente));
      if (!ref) ref = String(linha.referencia);
    }
    setCoeficientes(mapa);
    setSafra(ref);
  }, [processNumber]);

  /** Extrato da jurimetria — só na aba do processo, e só leitura. */
  const fetchJm = useCallback(async () => {
    if (scope !== 'process' || !processNumber) { setJmLinhas([]); setPartesValor([]); setCoeficientes(new Map()); return; }
    const variantes = cnjVariantes(processNumber);
    if (!variantes.length) { setJmLinhas([]); setPartesValor([]); setCoeficientes(new Map()); return; }
    await ensureExternalSession().catch(() => {});
    // As tabelas jm_* vivem no Externo e não existem no schema tipado do client
    // — mesmo desvio do useConferenciaProcesso.
    type Linha = Record<string, unknown>;
    type Consulta = Promise<{ data: Linha[] | null; error: { message?: string } | null }>;
    const externo = db as unknown as {
      from: (t: string) => { select: (c: string) => { in: (col: string, vals: string[]) => Consulta } };
    };
    const [pag, lanc, partes] = await Promise.all([
      externo.from('jm_pagamentos')
        .select('id, cliente, n_parcela, data_prevista, data_recebida, valor_pago, valor_previsto, forma')
        .in('processo_cnj', variantes),
      externo.from('jm_lancamentos')
        .select('id, data, pessoa, categoria, subcategoria, tipo, valor_caixa, valor_competencia, beneficiario, observacao, tem_data_pagamento')
        .in('processo_cnj', variantes),
      // Tab. Aux: a separação cota do cliente × honorário existe por PARTE, em
      // todo processo — inclusive nos que ainda não têm um único lançamento.
      externo.from('jm_partes')
        .select('parte_id, cliente, condenacao_cjcm, cota_parte_cjcm, cota_parte_vista_cjcm, hc_vista, hc_parcelado, hs, status_pagamento, fase_atual, termo_inicial_jcm')
        .in('processo_cnj', variantes),
    ]);
    // Uma consulta falhar não derruba as outras: o painel manual continua de pé,
    // e o bloco que ficou sem dado simplesmente não aparece.
    if (partes.error) {
      console.error('[EntityFinancialsPanel] valor do processo:', partes.error.message);
      setPartesValor([]);
    } else {
      const lista = (partes.data || []).map(montarParteValor);
      setPartesValor(lista);
      void carregarCoeficientes(lista);
    }
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
        // Parcela prevista tem data e valor: dá para antecipar. O que ela NÃO tem
        // é abertura cliente × honorário — por isso `titular` fica null e a
        // antecipação a mostra como bruto da parte, sem dizer de quem é.
        vencimento: recebida ? null : texto(p.data_prevista),
        vencido: !recebida && !!p.data_prevista && String(p.data_prevista) < hoje,
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
      // Linha cuja data é a da decisão (sem cronograma) é CONDENAÇÃO: tem valor,
      // não tem prazo, e não pode ser lida como atrasada.
      const semCronograma = l.tem_data_pagamento === false;
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
        direcao: l.tipo === 'ENTRADA' ? 'entrada'
          : l.tipo === 'SAIDA' ? 'saida'
          : l.tipo === 'REPASSE' ? 'repasse'
          : null,
        previsto: cls.previsto,
        semCronograma,
        adiantado: cls.adiantado,
        valor: valor == null ? null : Number(valor),
        origem: 'planilha',
      });
    }
    setJmLinhas(linhas);
  }, [scope, processNumber, carregarCoeficientes, hoje]);

  useEffect(() => { void fetchJm(); }, [fetchJm]);

  // Contatos do lead, de DUAS origens: a ponte `contact_leads` e o vínculo
  // legado `contacts.lead_id`. Ler só uma deixaria contato de fora — é o mesmo
  // par que `useAutoImportGroupDocs` consulta para achar os grupos do lead.
  useEffect(() => {
    if (!leadId) { setContatos([]); return; }
    let vivo = true;
    void (async () => {
      await ensureExternalSession().catch(() => {});
      const externo = db as unknown as { from: (t: string) => any };
      const [ponte, legado] = await Promise.all([
        externo.from('contact_leads').select('contacts:contact_id(id, full_name)').eq('lead_id', leadId),
        externo.from('contacts').select('id, full_name').eq('lead_id', leadId),
      ]);
      if (!vivo) return;
      const mapa = new Map<string, string>();
      for (const linha of ponte.data || []) {
        const c = (linha as { contacts?: { id?: string; full_name?: string } }).contacts;
        if (c?.id) mapa.set(c.id, c.full_name || 'sem nome');
      }
      for (const c of (legado.data || []) as { id?: string; full_name?: string }[]) {
        if (c?.id) mapa.set(c.id, c.full_name || 'sem nome');
      }
      setContatos([...mapa].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)));
    })();
    return () => { vivo = false; };
  }, [leadId]);

  // Deságio padrão da equipe. Falha em silêncio de propósito: sem taxa a tela
  // apenas deixa de mostrar o valor presente, e nada mais depende dela.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const { data } = await authClient
        .from('system_settings')
        .select('value')
        .eq('key', CHAVE_DESAGIO)
        .maybeSingle();
      if (!vivo || !data?.value) return;
      setTaxaMes(data.value);
      setTaxaSalva(data.value);
    })();
    return () => { vivo = false; };
  }, []);

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

  /** Extrato completo do processo: manuais + jurimetria, mais novo primeiro. */
  const extrato = useMemo<LinhaExtrato[]>(() => {
    const manuais: LinhaExtrato[] = entries.map(e => {
      // Quem diz se já é caixa é `settled_at` — NÃO o texto da categoria. Nenhuma
      // categoria do formulário tem "a receber" no nome, então antes disto um
      // honorário com vencimento futuro entrava como dinheiro no bolso.
      const previsto = !e.settled_at;
      const cls = classificarLancamento({ categoria: e.category, previsto });
      return {
        key: `mn-${e.id}`,
        // Baixado mostra o dia em que entrou; em aberto, o vencimento.
        data: e.settled_at || e.entry_date,
        descricao: e.description || e.category || 'Sem descrição',
        // De quem veio o dinheiro vem antes de tudo na linha: é a pergunta que
        // o extrato não respondia.
        detalhe: [
          e.parte_nome,
          scope !== 'activity' && e.activity_id ? 'via atividade' : null,
        ].filter(Boolean).join(' · ') || null,
        categoria: e.category,
        titular: cls.titular,
        especie: cls.especie,
        direcao: e.entry_type === 'entrada' ? 'entrada' as const : 'saida' as const,
        previsto: cls.previsto,
        adiantado: cls.adiantado,
        vencido: previsto && e.entry_date < hoje,
        vencimento: previsto ? e.entry_date : null,
        parcela: e.parcela_n && e.parcela_de ? { n: e.parcela_n, de: e.parcela_de } : null,
        conferido: e.conferido !== false,
        valor: Number(e.amount),
        origem: 'manual' as const,
        entry: e,
      };
    });
    return [...manuais, ...jmLinhas]
      .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  }, [entries, jmLinhas, scope, hoje]);

  /**
   * Totais do extrato, nas réguas que a pergunta "cadê o dinheiro deste
   * processo" exige. Cada valor entra em UMA linha só:
   *  - contratual/sucumbencial: honorário do escritório JÁ recebido;
   *  - cliente: a cota da parte já paga a ela;
   *  - despesas: saídas do escritório (repasse ao cliente NÃO é despesa);
   *  - aReceber*: o que está previsto e ainda não entrou — nunca somado ao caixa;
   *  - aPagar: saída lançada e ainda não paga. Não é "a receber": contar
   *    despesa em aberto como direito nosso inverte o sinal do dinheiro;
   *  - adiantado: antecipação do FIDC (Oriz). É caixa, mas NÃO é o processo
   *    pagando — o processo continua tramitando, então fica fora do recebido;
   *  - brutoParcelas: parcela de jm_pagamentos sem abertura cliente×honorário.
   * Linha sem valor importado não soma em lugar nenhum.
   */
  const totaisProcesso = useMemo(() => {
    let contratual = 0, sucumbencial = 0, outrosHonorarios = 0, cliente = 0;
    let despesas = 0, adiantado = 0, parceiro = 0, brutoParcelas = 0, semValor = 0;
    let aReceberEscritorio = 0, aReceberCliente = 0;
    let vencidoEscritorio = 0, vencidoCliente = 0, aPagar = 0, aPagarVencido = 0, aConferir = 0;
    for (const l of extrato) {
      if (l.valor == null) { semValor += 1; continue; }
      // Sugestão da IA que ninguém olhou não entra em total NENHUM — nem no
      // caixa, nem no a receber. Ela aparece na lista, marcada, esperando.
      if (l.conferido === false) { aConferir += l.valor; continue; }
      if (l.previsto) {
        if (l.origem === 'parcela') continue; // parcela prevista já aparece na linha
        // Saída em aberto é A PAGAR. Cair no "a receber" faria a conta de luz do
        // processo parecer dinheiro entrando.
        if (l.direcao === 'saida') {
          aPagar += l.valor;
          if (l.vencido) aPagarVencido += l.valor;
          continue;
        }
        if (l.titular === 'cliente') aReceberCliente += l.valor;
        else if (l.titular === 'escritorio') aReceberEscritorio += l.valor;
        // Vencido continua DENTRO do a receber — é o mesmo direito, só atrasado.
        // Sai destacado para não desaparecer no meio do total.
        if (l.vencido) {
          if (l.titular === 'cliente') vencidoCliente += l.valor;
          else if (l.titular === 'escritorio') vencidoEscritorio += l.valor;
        }
        continue;
      }
      if (l.adiantado) { adiantado += l.valor; continue; }
      if (l.origem === 'parcela') { brutoParcelas += l.valor; continue; }
      // Repasse ao parceiro é linha própria, de valor igual à nossa metade —
      // não desconta do nosso honorário porque nunca entrou nele.
      if (l.titular === 'parceiro') { parceiro += l.valor; continue; }
      // A cota do cliente conta pelo TITULAR, não pela direção: com tipo
      // REPASSE a linha não é entrada nem saída, e cair no `else` a sumiria.
      if (l.titular === 'cliente') { cliente += l.valor; continue; }
      if (l.direcao === 'entrada') {
        if (l.especie === 'honorario_contratual') contratual += l.valor;
        else if (l.especie === 'honorario_sucumbencial') sucumbencial += l.valor;
        else outrosHonorarios += l.valor;
      } else if (l.direcao === 'saida') {
        despesas += l.valor;
      }
    }
    const escritorio = contratual + sucumbencial + outrosHonorarios;
    return {
      contratual, sucumbencial, outrosHonorarios, escritorio, cliente, despesas,
      resultado: escritorio - despesas,
      aReceberEscritorio, aReceberCliente, vencidoEscritorio, vencidoCliente,
      aPagar, aPagarVencido, aConferir, adiantado, parceiro, brutoParcelas, semValor,
    };
  }, [extrato]);

  /**
   * O que ainda está em aberto e PODE ser antecipado, já com a conta do valor
   * presente feita. Ficam de fora: saída (não se antecipa o que se deve),
   * linha sem valor importado e condenação sem cronograma — deságio compra
   * TEMPO, e sem vencimento não há prazo a comprar.
   */
  const recebiveis = useMemo(() => {
    const taxa = Number(String(taxaMes).replace(',', '.')) || 0;
    return extrato
      .filter(l => l.previsto && l.direcao !== 'saida' && l.valor != null && !!l.vencimento && !l.semCronograma)
      .map(l => ({
        linha: l,
        conta: antecipar({ valorFuturo: l.valor as number, vencimento: l.vencimento as string, taxaMes: taxa, hoje }),
      }))
      .sort((a, b) => (a.linha.vencimento || '').localeCompare(b.linha.vencimento || ''));
  }, [extrato, taxaMes, hoje]);

  /**
   * Separado por TITULAR porque a oferta é diferente em cada caso: o honorário
   * o escritório vende ao fundo, a cota o cliente adianta conosco, e a parcela
   * bruta ainda não sabe quanto é de cada um.
   */
  const antecipacaoTotais = useMemo(() => ({
    escritorio: totalAntecipacao(recebiveis.filter(r => r.linha.titular === 'escritorio').map(r => r.conta)),
    cliente: totalAntecipacao(recebiveis.filter(r => r.linha.titular === 'cliente').map(r => r.conta)),
    bruto: totalAntecipacao(recebiveis.filter(r => r.linha.titular === null).map(r => r.conta)),
  }), [recebiveis]);

  /**
   * Quanto o processo VALE, por parte (Tab. Aux). Não é caixa e não entra em
   * `totaisProcesso` — a condenação é o estoque, o extrato é o fluxo. Um mesmo
   * honorário aparece nos dois: aqui como direito, lá como parcela recebida.
   */
  const valorProcesso = useMemo(() => resumirValorProcesso(partesValor), [partesValor]);

  /**
   * O valor do processo MENOS o que já virou lançamento a receber.
   *
   * Condenação é ESTOQUE e lançamento é FLUXO — o painel sempre avisou em texto
   * que não se somam. O aviso deixou de bastar quando a leitura do documento
   * passou a criar lançamento a partir da MESMA condenação: aí o dinheiro
   * aparecia inteiro nos dois blocos da mesma tela. Agora o estoque recua na
   * medida em que o fluxo o absorve, e a tela diz quanto já migrou.
   *
   * Só conta lançamento MANUAL (`origem === 'manual'`): parcela de
   * `jm_pagamentos` e linha da planilha vêm de outra fonte e já são tratadas à
   * parte. E só o CONFERIDO, porque sugestão que ninguém olhou não move nada.
   */
  const estoqueRestante = useMemo(() => {
    let cliente = 0, escritorio = 0;
    for (const l of extrato) {
      if (!l.previsto || l.valor == null || l.origem !== 'manual') continue;
      if (l.conferido === false) continue;
      if (l.titular === 'cliente') cliente += l.valor;
      else if (l.titular === 'escritorio') escritorio += l.valor;
    }
    return {
      migradoCliente: cliente,
      migradoEscritorio: escritorio,
      migrado: cliente + escritorio,
      // Nunca negativo: lançamento maior que a condenação importada é sinal de
      // que uma das duas fontes está desatualizada, não de estoque negativo.
      cotaCliente: Math.max(0, valorProcesso.cotaCliente - cliente),
      escritorio: Math.max(0, valorProcesso.escritorio - escritorio),
    };
  }, [extrato, valorProcesso]);

  /**
   * ATENÇÃO — os valores da Tab. Aux são **CJCM**: "com juros e correção
   * monetária". Já vêm atualizados pela planilha. Multiplicá-los pelo
   * coeficiente da régua é corrigir duas vezes.
   *
   * Foi exatamente o erro que estava aqui: a tela mostrava a condenação da
   * Ivonete a R$ 1.082.448,38 quando o valor já corrigido é R$ 821.599,58 —
   * R$ 260 mil inventados por dupla correção.
   *
   * A prova de que já vêm corrigidos: na Leocadia
   * (0016074-62.2016.5.16.0014), o dano moral nominal é R$ 50.000 e o CJCM é
   * R$ 72.960 — coeficiente 1,4592 embutido, com termo inicial em 20/09/2022.
   * Na régua trabalhista isso equivale a correção até meados de 2026.
   *
   * O que a régua (`atualizacaoMonetaria.ts`) serve, então:
   *  - atualizar a partir do NOMINAL, que vive nas outras colunas da planilha
   *    (dano moral, dano estético, base de cálculo × tempo de pensionamento) e
   *    na aba Lançamentos — nenhuma delas importada ainda;
   *  - completar do mês do CJCM até hoje, quando essa data estiver gravada.
   * Enquanto nenhuma das duas existir no banco, a tela mostra o CJCM como ele é
   * e DIZ que a data-base da correção não está registrada.
   */
  const jaCorrigido = useMemo(() => {
    let pagas = 0;
    for (const p of valorProcesso.partes) {
      if (!parteSemValor(p) && p.status === 'PAGO') pagas += 1;
    }
    return { pagas, regua: reguaDoProcesso(processNumber) };
  }, [valorProcesso.partes, processNumber]);

  /**
   * Só o PROCESSO tem CNJ, e só com ele existem os blocos da jurimetria
   * (quanto vale o processo, parcelas de jm_pagamentos, extrato da planilha).
   * Os CARDS, esses, são os mesmos em todo objeto — ver o comentário deles.
   */
  const temJm = scope === 'process' && !!processNumber;
  const temValorProcesso = temJm && valorProcesso.comValor > 0;

  const resetForm = () => {
    setForm({
      entry_type: 'saida',
      amount: '',
      description: '',
      category: '',
      entry_date: hoje,
      parte: '',
      receipt_url: '',
      settled: true,
      settledTocado: false,
      settled_date: '',
      parcelar: false,
      parcelas: '2',
      periodicidade: 'mensal',
      modo: 'dividir',
      payment_method: '',
      notes: '',
    });
    setComprovante(null);
    setSugestao(null);
    setCategoriaCriada(null);
    setItensIa([]);
    setEscolha(new Set());
  };

  /**
   * As parcelas que o plano atual geraria, para CONFERIR antes de salvar. Valor
   * pequeno demais para dividir aparece como erro aqui, e não como um punhado de
   * linhas de R$ 0,00 depois de gravado.
   */
  const previaParcelas = useMemo<{ parcelas: Parcela[] | null; erro: string | null }>(() => {
    if (!form.parcelar) return { parcelas: null, erro: null };
    const valor = parseFloat(form.amount);
    const n = Number(form.parcelas);
    if (!Number.isFinite(valor) || valor <= 0) return { parcelas: null, erro: null };
    if (!Number.isInteger(n) || n < 2) return { parcelas: null, erro: 'Parcelas: use um número inteiro de 2 a 360' };
    if (n > 360) return { parcelas: null, erro: 'No máximo 360 parcelas' };
    try {
      return {
        parcelas: gerarParcelas({
          valor, parcelas: n, periodicidade: form.periodicidade,
          primeiraData: form.entry_date, modo: form.modo,
        }),
        erro: null,
      };
    } catch (e) {
      return { parcelas: null, erro: e instanceof Error ? e.message : 'Não deu para montar as parcelas' };
    }
  }, [form.parcelar, form.amount, form.parcelas, form.periodicidade, form.entry_date, form.modo]);

  /** Prévia enxuta: as três primeiras, a última e a soma — o que se confere de olho. */
  const previaResumo = useMemo(() => {
    const ps = previaParcelas.parcelas;
    if (!ps) return null;
    return {
      inicio: ps.slice(0, 3),
      ultima: ps.length > 3 ? ps[ps.length - 1] : null,
      ocultas: Math.max(0, ps.length - 4),
      total: ps.reduce((s, p) => s + p.valor, 0),
    };
  }, [previaParcelas]);

  /**
   * De quem veio (ou para quem foi) o dinheiro. No processo as PARTES vêm
   * primeiro, porque é nelas que a planilha calculou cota e honorário — amarrar
   * o recebimento à parte é o que responde "esses R$ 1.125,30 são da cota de
   * quem?". Fora do processo, e depois delas, vão os contatos do lead.
   */
  const opcoesParte = useMemo(() => {
    const out: { valor: string; nome: string; grupo: string }[] = [];
    for (const p of partesValor) {
      if (!p.parteId) continue;
      out.push({ valor: 'parte:' + p.parteId, nome: p.cliente || 'parte sem nome', grupo: 'Partes do processo' });
    }
    for (const c of contatos) {
      out.push({ valor: 'contato:' + c.id, nome: c.nome, grupo: 'Contatos do lead' });
    }
    return out;
  }, [partesValor, contatos]);

  /**
   * A lista do seletor: as curadas + toda categoria já usada aqui + a que a IA
   * propôs e a pessoa aceitou. **Usar uma vez é criar** — não existe tela de
   * administrar categoria, e não precisa existir. `form.category` entra junto
   * para o Select nunca aparecer vazio ao editar linha de categoria antiga.
   */
  const categoriasDisponiveis = useMemo(
    () => mesclarCategorias(CATEGORIES, [...entries.map(e => e.category), categoriaCriada, form.category]),
    [entries, categoriaCriada, form.category],
  );

  /**
   * A opção da lista que corresponde a um nome lido no documento. Só devolve
   * com UM candidato: dois nomes parecidos não escolhem nenhum, porque errar de
   * quem é o dinheiro é pior que deixar em branco.
   */
  const casarParte = useCallback((nome: string | null): string => {
    if (!nome) return '';
    const alvo = normalizarNome(nome);
    if (!alvo) return '';
    const casam = opcoesParte.filter(o => {
      const n = normalizarNome(o.nome);
      return !!n && (n.includes(alvo) || alvo.includes(n));
    });
    return casam.length === 1 ? casam[0].valor : '';
  }, [opcoesParte]);

  /** Decompõe 'parte:<id>' / 'contato:<id>' nas três colunas do banco. */
  const vinculoDaParte = (chave: string) => {
    const sep = chave.indexOf(':');
    if (sep < 0) return { contact_id: null, parte_id: null, parte_nome: null };
    const tipo = chave.slice(0, sep);
    const id = chave.slice(sep + 1);
    const nome = opcoesParte.find(o => o.valor === chave)?.nome || null;
    return {
      contact_id: tipo === 'contato' ? id : null,
      parte_id: tipo === 'parte' ? id : null,
      parte_nome: nome,
    };
  };

  const lerArquivo = (f: File) => new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => erro(new Error('não deu para ler o arquivo'));
    r.readAsDataURL(f);
  });

  /**
   * Preenche o formulário com o que a IA leu.
   *
   * Vindo de COMPROVANTE ela sobrescreve: o documento é a fonte, e é para isso
   * que a pessoa anexou. Vindo só da descrição, ela apenas completa o que está
   * vazio — ninguém quer ver o valor que digitou sumir por causa de um palpite.
   * Campo que a IA não leu volta null e não encosta em nada.
   */
  const aplicarSugestao = (s: SugestaoIa, ehFonte: boolean) => {
    setForm(p => ({
      ...p,
      amount: s.valor != null && (ehFonte || !p.amount) ? String(s.valor) : p.amount,
      entry_date: s.data && ehFonte ? s.data : p.entry_date,
      entry_type: s.tipo && ehFonte ? s.tipo : p.entry_type,
      description: s.descricao && (ehFonte || !p.description) ? s.descricao : p.description,
      category: s.categoria || p.category,
      // Comprovante é prova de que o dinheiro andou: nasce baixado, na data dele.
      settled: ehFonte && !!s.data ? s.data <= hoje : p.settled,
      settledTocado: ehFonte ? true : p.settledTocado,
    }));

    // Nome lido no comprovante ou dito no áudio: se casar com EXATAMENTE uma
    // parte/contato da lista, já deixa escolhido.
    const nomeLido = s.tipo === 'saida' ? (s.beneficiario || s.pagador) : (s.pagador || s.beneficiario);
    if (ehFonte && nomeLido) {
      const achou = casarParte(nomeLido);
      if (achou) setForm(p => ({ ...p, parte: achou }));
    }
  };

  const chamarIa = async (
    origem: 'comprovante' | 'categoria' | 'audio',
    extra?: { comprovante?: string; ditado?: string },
  ) => {
    setPensando(origem);
    setSugestao(null);
    try {
      const { data, error } = await cloudFunctions.invoke<SugestaoIa & { error?: string }>(
        'sugerir-lancamento',
        {
          body: {
            descricao: form.description || null,
            comprovante: extra?.comprovante || null,
            ditado: extra?.ditado || null,
            categorias: categoriasDisponiveis,
            contexto: processNumber || contextLabel || null,
            // O servidor pode estar em outro fuso: quem sabe que dia é hoje
            // para resolver "ontem" do ditado é a tela.
            hoje,
          },
        },
      );
      if (error) throw error;
      if (!data) throw new Error('sem resposta');
      if (data.error) throw new Error(data.error);
      setSugestao(data);
      const achados = Array.isArray(data.lancamentos) ? data.lancamentos : [];
      if (achados.length > 1) {
        // Documento com vários valores: mostra a lista para escolher, e NÃO mexe
        // no formulário. Jogar o primeiro de onze num campo só esconderia o resto.
        setItensIa(achados);
        setEscolha(new Set(achados.map((_, i) => i)));
        return;
      }
      setItensIa([]);
      // Comprovante e ditado são FONTE: sobrescrevem. Sugerir categoria pelo
      // texto só completa o que está vazio.
      aplicarSugestao(data, origem !== 'categoria');
    } catch (e) {
      toast.error('A IA não conseguiu: ' + (e instanceof Error ? e.message : 'erro'));
    } finally {
      setPensando(null);
    }
  };

  const anexarComprovante = async (arquivo: File | null) => {
    if (!arquivo) { setComprovante(null); return; }
    if (arquivo.size > LIMITE_COMPROVANTE_MB * 1024 * 1024) {
      toast.error('Comprovante acima de ' + LIMITE_COMPROVANTE_MB + ' MB — reduza antes de anexar');
      return;
    }
    try {
      const dataUrl = await lerArquivo(arquivo);
      setComprovante({ arquivo, dataUrl });
      // Imagem E PDF: o conversor do _shared/gemini.ts lê o mime do data URL e
      // manda como inlineData, e o Gemini aceita application/pdf igual.
      await chamarIa('comprovante', { comprovante: dataUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ler o arquivo');
    }
  };

  /**
   * Ditar o lançamento, igual ao que a atividade já faz por voz.
   *
   * O caminho é o MESMO que o chat da equipe usa e que já funciona: sobe o
   * áudio, pede a `transcribe-team-audio` (ElevenLabs Scribe, com Gemini de
   * reserva) o texto, e só então a IA lê esse texto como DITADO. Escrever um
   * segundo transcritor aqui seria manter duas coisas que fazem a mesma.
   */
  const gravarDitado = async () => {
    if (gravando) { gravadorRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      pedacosRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) pedacosRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        setGravando(false);
        const blob = new Blob(pedacosRef.current, { type: mime });
        if (blob.size < 1000) { toast.error('Gravação muito curta.'); return; }
        void transcreverDitado(blob, mime);
      };
      gravadorRef.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      toast.error('Não consegui acessar o microfone');
    }
  };

  const transcreverDitado = async (blob: Blob, mime: string) => {
    setPensando('audio');
    try {
      const caminho = 'lancamentos/audio/' + crypto.randomUUID() + '.webm';
      const { error: upErr } = await authClient.storage.from(BUCKET_COMPROVANTE).upload(caminho, blob);
      if (upErr) throw new Error('o áudio não subiu (' + upErr.message + ')');
      const url = authClient.storage.from(BUCKET_COMPROVANTE).getPublicUrl(caminho).data.publicUrl;
      const { data } = await cloudFunctions.invoke<{ success?: boolean; transcription?: string }>(
        'transcribe-team-audio',
        { body: { audio_url: url, audio_mime: mime.split(';')[0] } },
      );
      const texto = data?.transcription?.trim();
      if (!texto) throw new Error('não entendi o áudio');
      await chamarIa('audio', { ditado: texto });
    } catch (e) {
      toast.error('Ditado: ' + (e instanceof Error ? e.message : 'erro'));
      setPensando(null);
    }
  };

  /** Sobe o comprovante e devolve a URL. Falhar aqui NÃO pode custar o lançamento. */
  const subirComprovante = async (): Promise<string | null> => {
    if (!comprovante) return form.receipt_url || null;
    const ext = comprovante.arquivo.name.split('.').pop() || 'jpg';
    const caminho = 'lancamentos/' + crypto.randomUUID() + '.' + ext;
    const { error } = await authClient.storage.from(BUCKET_COMPROVANTE)
      .upload(caminho, comprovante.arquivo, { upsert: true });
    if (error) {
      toast.warning('O comprovante não subiu (' + error.message + '). O lançamento vai ser salvo assim mesmo.');
      return form.receipt_url || null;
    }
    return authClient.storage.from(BUCKET_COMPROVANTE).getPublicUrl(caminho).data.publicUrl;
  };

  /**
   * Grava de uma vez os itens escolhidos da lista que a IA leu do documento.
   *
   * Cada um vira uma linha com a SUA verba, o SEU valor e a SUA parte — que é o
   * trabalho que se estava fazendo à mão, um por um. O que o documento diz que
   * já foi pago nasce baixado; o resto nasce a receber, fora do caixa.
   *
   * `conferido: true` porque a pessoa acabou de olhar item por item nesta tela.
   * A leitura automática dos marcos é que entra como false, esperando alguém.
   */
  const salvarVarios = async () => {
    const escolhidos = itensIa.filter((_, i) => escolha.has(i));
    if (!escolhidos.length) { toast.error('Marque ao menos um valor'); return; }
    const semCategoria = escolhidos.filter(i => !i.categoria && !i.categoriaNova).length;
    if (semCategoria) { toast.error(semCategoria + ' item(ns) sem categoria — desmarque ou lance à mão'); return; }
    if (hasTargets && !target) { toast.error('Escolha onde registrar'); return; }

    setSaving(true);
    try {
      await ensureExternalSession().catch(() => {});
      const receiptUrl = await subirComprovante();
      const { data: { user } } = await authClient.auth.getUser();
      const createdBy = await remapToExternal(user?.id).catch(() => null);
      const linhas = escolhidos.map(it => ({
        ...vinculoDaParte(casarParte(it.parte)),
        // Sem parte casada, o nome lido ainda é gravado: saber que o dinheiro é
        // "da Maria José" vale mesmo sem o vínculo formal.
        parte_nome: vinculoDaParte(casarParte(it.parte)).parte_nome || it.parte,
        lead_id: (hasTargets ? target?.leadId : leadId) || null,
        case_id: (hasTargets ? target?.caseId : caseId) || null,
        process_id: (hasTargets ? target?.processId : processId) || null,
        activity_id: activityId || null,
        entry_type: it.tipo || 'entrada',
        amount: it.valor,
        description: it.descricao || it.verba || 'Lido do documento',
        category: it.categoria || it.categoriaNova,
        verba: it.verba,
        valor_nominal: it.valorNominal,
        juros: it.juros,
        entry_date: it.data || hoje,
        settled_at: it.jaPago ? (it.data || hoje) : null,
        receipt_url: receiptUrl,
        conferido: true,
        payment_method: null,
        notes: null,
        parcela_grupo: null,
        parcela_n: null,
        parcela_de: null,
        created_by: createdBy,
      }));
      const { error } = await db.from('lead_financials' as any).insert(linhas);
      if (error) throw error;
      toast.success(linhas.length + ' lançamentos criados do documento');
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

  const handleSave = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Informe o valor');
      return;
    }
    if (hasTargets && !target) {
      toast.error('Escolha onde registrar');
      return;
    }
    // Sem categoria o sistema não sabe DE QUEM é o dinheiro: cai em "operação do
    // escritório" e um recebimento de cota do cliente vira resultado nosso.
    if (!form.category) {
      toast.error('Escolha a categoria — é ela que diz de quem é o dinheiro');
      return;
    }
    if (!form.description.trim()) {
      toast.error('Escreva a descrição — sem ela a linha vira "Sem descrição" no extrato');
      return;
    }
    // Dinheiro não entra antes da hora. O botão já se protege quando a data muda;
    // esta trava pega o caminho da edição, onde as duas datas são digitáveis.
    const dataBaixa = form.settled_date || form.entry_date;
    if (form.settled && dataBaixa > hoje) {
      toast.error('Pagamento em data futura não existe — marque como previsto');
      return;
    }
    if (form.parcelar && previaParcelas.erro) {
      toast.error(previaParcelas.erro);
      return;
    }

    setSaving(true);
    try {
      // Com destino escolhido, gravam-se os vínculos DELE — uma despesa atribuída
      // ao lead não deve aparecer no financeiro do processo. Sem destino (abas de
      // lead e processo), valem os ids das props.
      const vinculos = {
        ...vinculoDaParte(form.parte),
        receipt_url: await subirComprovante(),
        lead_id: (hasTargets ? target?.leadId : leadId) || null,
        case_id: (hasTargets ? target?.caseId : caseId) || null,
        process_id: (hasTargets ? target?.processId : processId) || null,
        activity_id: activityId || null,
        entry_type: form.entry_type,
        description: form.description || null,
        category: form.category || null,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
      };

      await ensureExternalSession().catch(() => {});
      let mensagem = editingEntry ? 'Registro atualizado' : 'Registro adicionado';

      if (editingEntry) {
        const { error } = await db.from('lead_financials' as any).update({
          ...vinculos,
          amount: parseFloat(form.amount),
          entry_date: form.entry_date,
          settled_at: form.settled ? dataBaixa : null,
        }).eq('id', editingEntry.id);
        if (error) throw error;
      } else {
        // O usuário autentica no Cloud; `created_by` referencia o auth do Externo.
        const { data: { user } } = await authClient.auth.getUser();
        const createdBy = await remapToExternal(user?.id).catch(() => null);
        // Um acordo em 12x nasce como 12 linhas amarradas pelo mesmo grupo: cada
        // parcela vence e é baixada por si, e uma atrasar não contamina as outras.
        const plano = form.parcelar ? previaParcelas.parcelas : null;
        const grupo = plano ? crypto.randomUUID() : null;
        const linhas = plano
          ? plano.map(p => ({
              ...vinculos,
              created_by: createdBy,
              amount: p.valor,
              entry_date: p.data,
              // Só a parcela cuja data já chegou pode nascer baixada; as futuras
              // ninguém pagou ainda, por definição.
              settled_at: form.settled && p.data <= hoje ? p.data : null,
              parcela_grupo: grupo,
              parcela_n: p.n,
              parcela_de: p.de,
            }))
          : [{
              ...vinculos,
              created_by: createdBy,
              amount: parseFloat(form.amount),
              entry_date: form.entry_date,
              settled_at: form.settled ? dataBaixa : null,
              parcela_grupo: null,
              parcela_n: null,
              parcela_de: null,
            }];
        const { error } = await db.from('lead_financials' as any).insert(linhas);
        if (error) throw error;
        if (plano) mensagem = plano.length + ' parcelas criadas';
      }

      // Lançamento gravado → conta o tempo no cronômetro (guarda-chuva do dia).
      void trackFinanceEntry();

      toast.success(mensagem);
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

  /**
   * Baixa o recebível: o MESMO lançamento muda de estado, nunca nasce outro.
   * Lançar um "recebido" novo ao lado do "a receber" contaria o dinheiro duas
   * vezes — é a regra do vocabulário (src/lib/lancamentoCategorias.ts).
   */
  const baixar = async (entry: EntityFinancialEntry) => {
    await ensureExternalSession().catch(() => {});
    const { error } = await db.from('lead_financials' as any)
      .update({ settled_at: hoje })
      .eq('id', entry.id);
    if (error) { toast.error('Erro ao baixar: ' + error.message); return; }
    toast.success(entry.entry_type === 'entrada' ? 'Recebimento registrado' : 'Pagamento registrado');
    fetchEntries();
  };

  /**
   * Confere a sugestão: a linha passa a contar nos totais.
   *
   * Só isso — NÃO baixa. Conferir é dizer "a IA leu certo"; baixar é dizer "o
   * dinheiro entrou". Juntar os dois num clique faria uma condenação lida virar
   * caixa recebido sem ninguém decidir isso.
   */
  const conferir = async (entry: EntityFinancialEntry) => {
    await ensureExternalSession().catch(() => {});
    const { error } = await db.from('lead_financials' as any)
      .update({ conferido: true })
      .eq('id', entry.id);
    if (error) { toast.error('Erro ao conferir: ' + error.message); return; }
    toast.success('Conferido — agora conta nos totais');
    fetchEntries();
  };

  /** Deságio padrão da equipe. Fica no Cloud (`system_settings`), não no navegador. */
  const salvarTaxa = async () => {
    const n = Number(String(taxaMes).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) { toast.error('Taxa inválida'); return; }
    setSalvandoTaxa(true);
    const { error } = await authClient.from('system_settings').upsert({
      key: CHAVE_DESAGIO,
      value: String(n),
      description: 'Deságio padrão da antecipação de recebível, em % ao mês.',
      updated_at: new Date().toISOString(),
    });
    setSalvandoTaxa(false);
    if (error) { toast.error('Não salvou o padrão: ' + error.message); return; }
    setTaxaMes(String(n));
    setTaxaSalva(String(n));
    toast.success('Deságio padrão salvo para a equipe');
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
    setComprovante(null);
    setSugestao(null);
    setForm({
      entry_type: entry.entry_type,
      amount: String(entry.amount),
      description: entry.description || '',
      category: entry.category || '',
      entry_date: entry.entry_date,
      receipt_url: entry.receipt_url || '',
      parte: entry.parte_id ? 'parte:' + entry.parte_id
        : entry.contact_id ? 'contato:' + entry.contact_id
        : '',
      settled: !!entry.settled_at,
      // Na edição o estado já é uma escolha feita: a data não pode revogá-la.
      settledTocado: true,
      settled_date: entry.settled_at || '',
      // Replanejar o parcelamento de um lançamento que já existe criaria linhas
      // soltas do grupo original — para isso, apaga-se o plano e refaz.
      parcelar: false,
      parcelas: '2',
      periodicidade: 'mensal',
      modo: 'dividir',
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

      {/* QUANTO VALE — vem antes do extrato de propósito: é a pergunta que se faz
          primeiro sobre um processo, e a única que responde de quem é o dinheiro
          mesmo onde ainda não houve um único lançamento. Bloco fechado em si,
          com aviso explícito de que não se soma ao caixa abaixo. */}
      {temValorProcesso && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-indigo-900">Quanto vale o processo</p>
            <span className="text-[10px] text-muted-foreground">
              {valorProcesso.comValor} parte{valorProcesso.comValor > 1 ? 's' : ''}
              {valorProcesso.semValor > 0 && ` · ${valorProcesso.semValor} sem valor`}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Condenação corrigida</p>
              <p className="text-sm font-bold text-indigo-900">{formatCurrency(valorProcesso.condenacao)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Do cliente (líquido)</p>
              {/* A planilha já entrega líquida: o 30% saiu do vencido E do vincendo. */}
              <p className="text-sm font-bold text-sky-700">{formatCurrency(estoqueRestante.cotaCliente)}</p>
              {valorProcesso.hcParcelado > 0 && (
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {formatCurrency(valorProcesso.cotaVencida)} já venceu
                </p>
              )}
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Do escritório (30% + suc.)</p>
              <p className="text-sm font-bold text-green-700">{formatCurrency(estoqueRestante.escritorio)}</p>
              {/* Contratual e sucumbencial são recebíveis distintos: um vem do
                  contrato com o cliente, o outro da condenação da parte contrária. */}
              <p className="text-[10px] text-muted-foreground leading-tight">
                {formatCurrency(valorProcesso.hc)} contratual · {formatCurrency(valorProcesso.hs)} sucumbencial
              </p>
            </div>
          </div>

          {/* À vista × parcelado: a divisão que o pensionamento cria, com a soma
              explícita. É a conta que o Raym faz na planilha, nos mesmos termos. */}
          {valorProcesso.brutoParcelado > 0 && (
            <div className="rounded border border-indigo-200 bg-background/60 px-2 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">À vista <span className="text-[10px]">(já venceu)</span></span>
                <span className="font-medium">{formatCurrency(valorProcesso.brutoVista)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Parcelado <span className="text-[10px]">(ainda vai vencer)</span></span>
                <span className="font-medium">{formatCurrency(valorProcesso.brutoParcelado)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 border-t pt-1">
                <span className="font-medium">Soma das duas fatias</span>
                <span className="font-bold text-indigo-900">{formatCurrency(valorProcesso.bruto)}</span>
              </div>
              {Math.abs(valorProcesso.bruto - valorProcesso.condenacao) >= 0.01 && (
                <p className="mt-1 text-[10px] text-amber-700 leading-snug">
                  A coluna "TOTAL DA CONDENAÇÃO CJCM" da planilha traz{' '}
                  {formatCurrency(valorProcesso.condenacao)} — ela soma o sucumbencial e deixa o
                  honorário do parcelado de fora, então não é a soma das duas fatias.
                </p>
              )}
            </div>
          )}

          {valorProcesso.status.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {valorProcesso.status.map(s => (
                <Badge key={s.status} variant="outline" className="text-[10px] border-indigo-300 text-indigo-800">
                  {s.status} · {s.partes}
                </Badge>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground leading-snug">
            <strong>CJCM</strong> = com juros e correção monetária: estes valores já vêm corrigidos
            da planilha, não são nominais. A data até a qual foram corrigidos ainda não está no
            banco — quando estiver, dá para completar daqui até hoje pela régua da{' '}
            {jaCorrigido.regua ? REGUA_LABEL[jaCorrigido.regua] : 'justiça do processo'}.
            {jaCorrigido.pagas > 0 && ` ${jaCorrigido.pagas} parte(s) já paga(s) não corrigem mais.`}
          </p>

          {estoqueRestante.migrado > 0 && (
            <p className="text-[10px] leading-snug text-indigo-800">
              {formatCurrency(estoqueRestante.migrado)} já viraram lançamento a receber e por isso
              saíram daqui ({formatCurrency(estoqueRestante.migradoCliente)} do cliente,{' '}
              {formatCurrency(estoqueRestante.migradoEscritorio)} do escritório). Este bloco mostra
              só o que ainda <strong>não</strong> foi lançado — assim o mesmo dinheiro não aparece
              duas vezes na mesma tela.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground leading-snug">
            Valor do processo, não caixa — <strong>não some com o extrato abaixo</strong>. O mesmo
            honorário aparece nos dois lugares: aqui como direito, lá como parcela quando entra.
          </p>

          {valorProcesso.hcParcelado > 0 && (
            <p className="text-[10px] text-muted-foreground leading-snug">
              Pensionamento: {formatCurrency(valorProcesso.hcVista)} do contratual já foi apurado
              sobre o que venceu, e {formatCurrency(valorProcesso.hcParcelado)} vão sendo apurados
              conforme as parcelas vencerem — cada parcela que vence migra do parcelado para o à
              vista, e o honorário dela vai junto.
            </p>
          )}

          {valorProcesso.cotaProjetada > 0 && (
            <p className="text-[10px] text-muted-foreground leading-snug">
              {valorProcesso.cotaProjetada} parte(s) sem acordo fechado: a cota vem da projeção à
              vista da planilha, não de valor acertado.
            </p>
          )}

          {/* Número que não fecha e não avisa é pior que número ausente. */}
          {Math.abs(valorProcesso.diferenca) >= 0.01 && (
            <p className="text-[10px] text-amber-700 leading-snug">
              A soma cliente + escritório não fecha com a condenação: sobra{' '}
              {formatCurrency(valorProcesso.diferenca)}. Acontece em 9 das 688 partes importadas —
              confira as colunas na planilha antes de usar esse total.
            </p>
          )}

          <button
            type="button"
            onClick={() => setVerPartes(v => !v)}
            className="text-[11px] text-indigo-700 underline underline-offset-2"
          >
            {verPartes ? 'ocultar as partes' : `ver as ${valorProcesso.partes.length} partes`}
          </button>

          {verPartes && (
            <ScrollArea style={{ maxHeight: '200px' }}>
              <div className="space-y-1 pr-2">
                {valorProcesso.partes.map(p => (
                  <div key={p.parteId} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{p.cliente || p.parteId}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {[p.status, p.fase].filter(Boolean).join(' · ') || 'sem status'}
                      </p>
                    </div>
                    {parteSemValor(p) ? (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">sem valor</span>
                    ) : (
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-semibold">{formatCurrency(p.condenacao ?? 0)}</p>
                        <p className="text-[10px] text-muted-foreground">
                          <span className="text-sky-700">{formatCurrency(cotaClienteDaParte(p))}</span> cliente ·{' '}
                          <span className="text-green-700">{formatCurrency(honorarioDaParte(p))}</span> nosso
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      {/* Summary Cards. Os MESMOS em lead, caso, processo e atividade: um só
          jeito de ler dinheiro no sistema inteiro. Abrem por TITULAR — quanto é
          do escritório e quanto é do cliente — porque somar tudo numa "receita"
          só mistura dinheiro nosso com dinheiro que é dever de repasse. Antes,
          fora do processo, a tela mostrava Receitas/Despesas/Resultado e a mesma
          pergunta tinha duas respostas dependendo de onde você abrisse. */}
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
                {/* De quem é o recebível decide quem pode antecipar: honorário o
                    escritório vende ao fundo, cota o cliente adianta conosco. */}
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {formatCurrency(totaisProcesso.aReceberEscritorio)} escritório ·{' '}
                  {formatCurrency(totaisProcesso.aReceberCliente)} cliente
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
            {(totaisProcesso.vencidoEscritorio + totaisProcesso.vencidoCliente) > 0 && (
              <p className="text-red-700">
                {formatCurrency(totaisProcesso.vencidoEscritorio + totaisProcesso.vencidoCliente)} já
                venceram e ninguém baixou. Continuam como direito, fora do caixa — data que passa não
                é prova de pagamento. Baixe pelo ✓ na linha quando o dinheiro entrar.
              </p>
            )}
            {totaisProcesso.aConferir > 0 && (
              <p className="text-violet-700">
                {formatCurrency(totaisProcesso.aConferir)} lidos por IA e ainda não conferidos —
                fora de todos os totais até alguém confirmar. Confira pelo ✦ na linha.
              </p>
            )}
            {totaisProcesso.aPagar > 0 && (
              <p className="text-red-700">
                {formatCurrency(totaisProcesso.aPagar)} em saída lançada e ainda não paga
                {totaisProcesso.aPagarVencido > 0
                  ? ' (' + formatCurrency(totaisProcesso.aPagarVencido) + ' já vencida)'
                  : ''}
                {' '}— não abate o resultado enquanto não sair da conta.
              </p>
            )}
            {totaisProcesso.adiantado > 0 && (
              <p className="text-amber-700">
                {formatCurrency(totaisProcesso.adiantado)} adiantados pelo FIDC (Oriz) — entrou caixa,
                mas não foi o processo que pagou: ele continua em tramitação. Fora do recebido.
              </p>
            )}
            {totaisProcesso.parceiro > 0 && (
              <p className="text-violet-700">
                {formatCurrency(totaisProcesso.parceiro)} repassados ao advogado parceiro. Não abate
                do honorário acima: a planilha lança a metade dele como linha própria, então esse
                valor nunca entrou no nosso.
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

          {/* ANTECIPAR — transforma "R$ X em 6 meses" em "R$ Y hoje". Serve aos
              dois lados da mesma parcela: o honorário que o escritório pode
              vender ao fundo e a cota que o cliente pode adiantar conosco. */}
          {recebiveis.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" /> Antecipar o que está a receber
                </p>
                <span className="text-[10px] text-muted-foreground">{recebiveis.length} em aberto</span>
              </div>

              <div className="flex items-end gap-2">
                <div className="w-28">
                  <Label className="text-[10px]">Deságio (% ao mês)</Label>
                  <Input
                    type="number" step="0.01" min="0" placeholder="ex: 3"
                    value={taxaMes}
                    onChange={e => setTaxaMes(e.target.value)}
                    className="h-8"
                  />
                </div>
                <Button
                  size="sm" variant="outline" className="h-8"
                  disabled={salvandoTaxa || !taxaMes || taxaMes === taxaSalva}
                  onClick={salvarTaxa}
                >
                  {salvandoTaxa ? 'Salvando...' : 'Salvar como padrão'}
                </Button>
              </div>

              {!Number(String(taxaMes).replace(',', '.')) ? (
                <p className="text-[11px] text-muted-foreground">
                  Informe o deságio para ver quanto cada recebível vale hoje.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['Do cliente', antecipacaoTotais.cliente, 'text-sky-700'],
                      ['Do escritório', antecipacaoTotais.escritorio, 'text-green-700'],
                      ['Bruto da parte', antecipacaoTotais.bruto, 'text-foreground'],
                    ] as const).filter(([, t]) => t.valorFuturo > 0).map(([rotulo, t, cor]) => (
                      <div key={rotulo} className="rounded border bg-background/60 p-2 text-center">
                        <p className="text-[10px] text-muted-foreground">{rotulo}</p>
                        <p className={'text-sm font-bold ' + cor}>{formatCurrency(t.valorPresente)}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          hoje, de {formatCurrency(t.valorFuturo)}
                        </p>
                        <p className="text-[10px] text-red-600 leading-tight">
                          −{formatCurrency(t.desconto)} de deságio
                        </p>
                      </div>
                    ))}
                  </div>

                  <ScrollArea style={{ maxHeight: '170px' }}>
                    <div className="space-y-1 pr-2">
                      {recebiveis.map(({ linha, conta }) => (
                        <div key={linha.key} className="flex items-center justify-between gap-2 rounded border bg-background/60 px-2 py-1 text-[11px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {linha.descricao}
                              {linha.parcela ? ' (' + linha.parcela.n + '/' + linha.parcela.de + ')' : ''}
                            </p>
                            <p className="text-muted-foreground truncate">
                              {conta.dias === 0 ? 'já venceu' : 'vence em ' + conta.dias + ' dia(s)'}
                              {' · '}
                              {linha.titular === 'cliente' ? 'do cliente'
                                : linha.titular === 'escritorio' ? 'do escritório'
                                : 'bruto da parte'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold">{formatCurrency(conta.valorPresente)}</p>
                            <p className="text-muted-foreground">de {formatCurrency(conta.valorFuturo)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Valor presente a juros COMPOSTOS: face ÷ (1 + deságio)^(dias ÷ 30). É simulação —
                    antecipar de verdade vira lançamento próprio, no dia em que acontecer. O que já
                    venceu não desconta nada: deságio paga o tempo que falta, não o atraso.
                  </p>
                </>
              )}
            </div>
          )}
        </>

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
                  {linha.direcao === 'entrada' ? '📥'
                    : linha.direcao === 'saida' ? '📤'
                    : linha.direcao === 'repasse' ? '🔁' : '•'}
                </Badge>
                <div className="min-w-0">
                  <p className="font-medium truncate">{linha.descricao}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {linha.previsto && linha.vencimento
                      ? (linha.vencido ? 'venceu em ' : 'vence ') + linha.vencimento
                      : (linha.data || 'sem data')}
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
                {linha.titular === 'parceiro' && (
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] gap-1 border-violet-300 text-violet-700">
                    <Handshake className="h-2.5 w-2.5" />repasse ao parceiro
                  </Badge>
                )}
                {linha.titular === null && (
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px]">bruto da parte</Badge>
                )}
                {linha.parcela && (
                  <Badge variant="outline" className="text-[10px]">
                    {linha.parcela.n}/{linha.parcela.de}
                  </Badge>
                )}
                {linha.conferido === false && (
                  <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700">
                    a conferir
                  </Badge>
                )}
                {linha.previsto && (
                  <Badge
                    variant="outline"
                    className={'text-[10px] ' + (linha.vencido ? 'border-red-300 text-red-700' : 'border-amber-300 text-amber-700')}
                  >
                    {linha.semCronograma ? 'condenação · sem data'
                      : linha.vencido ? 'vencido'
                      : linha.direcao === 'saida' ? 'a pagar' : 'a receber'}
                  </Badge>
                )}
                {linha.adiantado && (
                  <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800">antecipado</Badge>
                )}
                <span className={`font-bold text-sm ${linha.valor == null ? 'font-normal text-muted-foreground' : linha.direcao === 'entrada' ? 'text-green-600' : linha.direcao === 'saida' ? 'text-red-600' : 'text-foreground'}`}>
                  {linha.valor == null
                    ? 'sem valor'
                    : `${linha.direcao === 'entrada' ? '+' : linha.direcao === 'saida' ? '-' : ''}${formatCurrency(linha.valor)}`}
                </span>
                {linha.entry?.receipt_url && (
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    title="Ver comprovante"
                    onClick={() => setVerComprovante(linha.entry?.receipt_url || null)}
                  >
                    <Paperclip className="h-3 w-3" />
                  </Button>
                )}
                {linha.entry && linha.conferido === false && (
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 text-violet-600"
                    title="A IA sugeriu esta linha. Conferir faz ela contar nos totais."
                    onClick={() => conferir(linha.entry!)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                )}
                {linha.entry && (
                  <>
                    {/* Baixar é o MESMO lançamento mudando de estado — nunca um
                        lançamento novo ao lado do previsto. */}
                    {linha.previsto && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-green-600"
                        title={linha.direcao === 'saida' ? 'Marcar como pago hoje' : 'Marcar como recebido hoje'}
                        onClick={() => baixar(linha.entry!)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
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

      <MediaLightbox url={verComprovante} title="Comprovante" onClose={() => setVerComprovante(null)} />

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="max-w-md max-h-[90vh]"
          // Colar (Ctrl+V) e arrastar valem em QUALQUER canto do diálogo, não só
          // em cima do campo: comprovante quase sempre chega como print na área
          // de transferência, e obrigar a mira certa é atrito à toa.
          onPaste={e => {
            const arq = Array.from(e.clipboardData?.files || [])[0];
            if (arq) { e.preventDefault(); void anexarComprovante(arq); }
          }}
          onDragOver={e => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={e => {
            e.preventDefault();
            setArrastando(false);
            const arq = Array.from(e.dataTransfer?.files || [])[0];
            if (arq) void anexarComprovante(arq);
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingEntry ? 'Editar Lançamento' : 'Novo Lançamento'}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-3">
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

            {/* COMPROVANTE PRIMEIRO, porque é o caminho curto: anexou, a IA lê a
                imagem e preenche valor, data, tipo, descrição e categoria de uma
                vez. O que ela não conseguir ler fica em BRANCO — nunca chutado.
                Tudo continua editável: quem salva é a pessoa. */}
            <div className={'rounded border p-2 space-y-2 ' + (arrastando ? 'border-primary bg-primary/5' : '')}>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" /> Comprovante
                </Label>
                {(comprovante || form.receipt_url) && (
                  <Button
                    type="button" variant="ghost" size="sm" className="h-6 text-[11px]"
                    onClick={() => { setComprovante(null); setForm(p => ({ ...p, receipt_url: '' })); }}
                  >
                    <X className="h-3 w-3 mr-1" /> tirar
                  </Button>
                )}
              </div>

              {comprovante ? (
                <div className="flex items-center gap-2">
                  {comprovante.arquivo.type.startsWith('image/') && (
                    <img src={comprovante.dataUrl} alt="comprovante" className="h-14 w-14 rounded border object-cover" />
                  )}
                  <div className="min-w-0 text-[11px]">
                    <p className="truncate font-medium">{comprovante.arquivo.name}</p>
                    <p className="text-muted-foreground">{(comprovante.arquivo.size / 1024).toFixed(0)} KB · sobe ao salvar</p>
                  </div>
                </div>
              ) : form.receipt_url ? (
                <button
                  type="button"
                  onClick={() => setVerComprovante(form.receipt_url)}
                  className="text-[11px] text-primary underline underline-offset-2"
                >
                  ver o comprovante anexado
                </button>
              ) : (
                <>
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    className="text-xs"
                    onChange={e => void anexarComprovante(e.target.files?.[0] || null)}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Ou <strong>arraste o arquivo aqui</strong>, ou <strong>cole com Ctrl+V</strong>.
                    Imagem e PDF são lidos pela IA.
                  </p>
                </>
              )}

              {pensando === 'comprovante' && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> lendo o comprovante...
                </p>
              )}

              {/* DITAR — mesmo caminho da atividade por voz: transcreve e a IA
                  lê o texto como ditado, tirando valor, data e de quem é. */}
              <Button
                type="button"
                variant={gravando ? 'destructive' : 'outline'}
                size="sm"
                className="w-full"
                disabled={pensando !== null && !gravando}
                onClick={() => void gravarDitado()}
              >
                {gravando ? (
                  <><Square className="h-3.5 w-3.5 mr-1" /> parar e transcrever</>
                ) : pensando === 'audio' ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> transcrevendo...</>
                ) : (
                  <><Mic className="h-3.5 w-3.5 mr-1" /> ditar o lançamento</>
                )}
              </Button>
            </div>

            {/* DOCUMENTO COM VÁRIOS VALORES — a tela vira uma conferência: marque
                o que entra, e cada item vira uma linha com a SUA verba e a SUA
                parte. É exatamente o trabalho que se fazia à mão, um por um. */}
            {itensIa.length > 1 && (
              <div className="rounded border border-violet-200 bg-violet-50/40 p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1 text-xs font-semibold text-violet-900">
                    <Sparkles className="h-3.5 w-3.5" />
                    {itensIa.length} valores lidos{sugestao?.documento ? ' · ' + sugestao.documento : ''}
                  </p>
                  <Button
                    type="button" variant="ghost" size="sm" className="h-6 text-[11px]"
                    onClick={() => setEscolha(
                      escolha.size === itensIa.length ? new Set() : new Set(itensIa.map((_, i) => i)),
                    )}
                  >
                    {escolha.size === itensIa.length ? 'desmarcar todos' : 'marcar todos'}
                  </Button>
                </div>

                {sugestao?.observacao && (
                  <p className="text-[10px] leading-snug text-muted-foreground">{sugestao.observacao}</p>
                )}

                <ScrollArea style={{ maxHeight: '260px' }}>
                  <div className="space-y-1 pr-2">
                    {itensIa.map((it, i) => (
                      <label key={i} className="flex cursor-pointer items-start gap-2 rounded border bg-background/70 px-2 py-1.5 text-[11px]">
                        <input
                          type="checkbox" className="mt-0.5" checked={escolha.has(i)}
                          onChange={e => {
                            const s = new Set(escolha);
                            if (e.target.checked) s.add(i); else s.delete(i);
                            setEscolha(s);
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium">{it.descricao || it.verba || 'sem descrição'}</span>
                            <span className={'flex-shrink-0 font-bold ' + (it.tipo === 'saida' ? 'text-red-600' : 'text-green-600')}>
                              {it.tipo === 'saida' ? '-' : '+'}
                              {it.valor != null ? formatCurrency(it.valor) : 'sem valor'}
                            </span>
                          </div>
                          <p className="truncate text-muted-foreground">
                            {it.categoria || ('categoria nova: ' + it.categoriaNova)}
                            {it.verba ? ' · ' + it.verba : ''}
                            {it.parte ? ' · ' + it.parte : ''}
                          </p>
                          <p className="text-muted-foreground">
                            {it.jaPago ? 'já pago' : 'a receber'}
                            {it.data ? ' · ' + it.data : ' · sem data'}
                            {it.valorNominal != null ? ' · principal ' + formatCurrency(it.valorNominal) : ''}
                            {it.juros != null ? ' + juros ' + formatCurrency(it.juros) : ''}
                            {it.parte && !casarParte(it.parte) ? ' · parte não vinculada' : ''}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>

                <p className="text-[10px] leading-snug text-muted-foreground">
                  Confira antes de lançar — o que o documento diz que já foi pago entra baixado, e o
                  resto entra como a receber, fora do caixa até alguém baixar.
                </p>
              </div>
            )}

            {itensIa.length <= 1 && (
              <>
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
            {/* JÁ ENTROU × PREVISTO — a pergunta que separa caixa de recebível.
                Sem ela, honorário com vencimento futuro entrava como dinheiro no
                bolso e inflava o resultado do processo no mesmo instante. */}
            <div>
              <Label className="text-xs">O dinheiro já entrou?</Label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant={form.settled ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  disabled={form.entry_date > hoje}
                  title={form.entry_date > hoje ? 'A data escolhida ainda não chegou' : undefined}
                  onClick={() => setForm(p => ({ ...p, settled: true, settledTocado: true }))}
                >
                  {form.entry_type === 'entrada' ? 'Já recebi' : 'Já paguei'}
                </Button>
                <Button
                  type="button"
                  variant={form.settled ? 'outline' : 'default'}
                  size="sm"
                  className={'flex-1 ' + (form.settled ? '' : 'bg-amber-600 hover:bg-amber-700')}
                  onClick={() => setForm(p => ({ ...p, settled: false, settledTocado: true }))}
                >
                  <CalendarClock className="h-3.5 w-3.5 mr-1" />
                  {form.entry_type === 'entrada' ? 'A receber' : 'A pagar'}
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs">
                {!form.settled || editingEntry
                  ? 'Vencimento'
                  : (form.entry_type === 'entrada' ? 'Data do recebimento' : 'Data do pagamento')}
              </Label>
              <Input
                type="date"
                value={form.entry_date}
                onChange={e => {
                  const d = e.target.value;
                  // Enquanto ninguém encostou no par acima, o estado SEGUE a data:
                  // futuro = previsto, passado ou hoje = já entrou. Antes ele só
                  // ia num sentido — pôr data futura marcava "a receber", e voltar
                  // a data para o passado deixava a marca grudada. A linha nascia
                  // VENCIDA sem ninguém entender por quê. Data futura continua
                  // forçando previsto mesmo com escolha manual: ninguém recebeu amanhã.
                  setForm(p => ({
                    ...p,
                    entry_date: d,
                    settled: p.settledTocado ? (d > hoje ? false : p.settled) : d <= hoje,
                  }));
                }}
              />
              {form.entry_date > hoje && (
                <p className="text-[10px] text-amber-700 mt-1 leading-snug">
                  Data futura: entra como {form.entry_type === 'entrada' ? 'a receber' : 'a pagar'} e
                  fica fora do caixa até alguém baixar.
                </p>
              )}
              {!form.settled && form.entry_date < hoje && (
                <p className="text-[10px] text-red-600 mt-1 leading-snug">
                  Vai nascer <strong>VENCIDO</strong>: a data já passou e está marcado como
                  {form.entry_type === 'entrada' ? ' não recebido' : ' não pago'}. Se o dinheiro já
                  entrou, troque no par acima.
                </p>
              )}
            </div>

            {/* Na edição as duas datas são independentes: venceu no dia 10, o
                cliente pagou no 17 — as duas informações importam. */}
            {editingEntry && form.settled && (
              <div>
                <Label className="text-xs">Entrou de fato em</Label>
                <Input
                  type="date"
                  value={form.settled_date || form.entry_date}
                  onChange={e => setForm(p => ({ ...p, settled_date: e.target.value }))}
                />
              </div>
            )}
            {/* Obrigatória: é a categoria que diz se aquele dinheiro é honorário
                nosso ou cota do cliente. Em branco, tudo virava "operação do
                escritório" e recebimento do cliente entrava no nosso resultado. */}
            <div>
              <Label className="text-xs">Categoria *</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {categoriasDisponiveis.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* DE QUEM VEIO O DINHEIRO. Num caso com cinco herdeiros, "cota do
                cliente" não diz de qual deles — a parte diz. */}
            {opcoesParte.length > 0 && (
              <div>
                <Label className="text-xs">
                  {form.entry_type === 'entrada' ? 'De quem veio o dinheiro' : 'Para quem foi o dinheiro'}
                </Label>
                <Select value={form.parte} onValueChange={v => setForm(p => ({ ...p, parte: v }))}>
                  <SelectTrigger><SelectValue placeholder="Parte ou contato..." /></SelectTrigger>
                  <SelectContent>
                    {opcoesParte.map(o => (
                      <SelectItem key={o.valor} value={o.valor}>
                        {o.nome} <span className="text-muted-foreground text-[10px]">· {o.grupo}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.parte.startsWith('parte:') && (
                  <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                    Amarrado à parte do processo: dá para conferir esse valor contra a cota e o
                    honorário que a planilha calculou para ela.
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Descrição *</Label>
                {/* Escreveu o que foi, a IA diz em que categoria isso cai — e,
                    quando nenhuma das existentes serve, propõe uma nova. */}
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 text-[11px]"
                  disabled={!form.description.trim() || pensando !== null}
                  onClick={() => void chamarIa('categoria')}
                >
                  {pensando === 'categoria'
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <Sparkles className="h-3 w-3 mr-1" />}
                  sugerir categoria
                </Button>
              </div>
              <Input placeholder="Ex: pago 3ª parcela do acordo" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>

            {/* O que a IA leu, dito na cara. Confiança baixa e campo que ela não
                conseguiu ler são informação — não detalhe para esconder. */}
            {sugestao && (
              <div className="rounded border border-violet-200 bg-violet-50/50 p-2 space-y-1 text-[11px]">
                <p className="font-medium text-violet-900 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> A IA preencheu o que conseguiu ler
                  <span className="font-normal text-muted-foreground">· confiança {sugestao.confianca}</span>
                </p>
                {sugestao.observacao && <p className="text-muted-foreground">{sugestao.observacao}</p>}
                {(sugestao.pagador || sugestao.beneficiario) && (
                  <p className="text-muted-foreground">
                    {sugestao.pagador ? 'de ' + sugestao.pagador : ''}
                    {sugestao.pagador && sugestao.beneficiario ? ' · ' : ''}
                    {sugestao.beneficiario ? 'para ' + sugestao.beneficiario : ''}
                    {' — confira se bate com a parte escolhida acima.'}
                  </p>
                )}
                {sugestao.categoriaNova && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-muted-foreground">
                      Nenhuma categoria existente serve. Propõe: <strong>{sugestao.categoriaNova}</strong>
                    </span>
                    <Button
                      type="button" size="sm" variant="outline" className="h-6 flex-shrink-0 text-[11px]"
                      onClick={() => {
                        const nova = sugestao.categoriaNova as string;
                        setCategoriaCriada(nova);
                        setForm(p => ({ ...p, category: nova }));
                      }}
                    >
                      criar e usar
                    </Button>
                  </div>
                )}
                <p className="text-muted-foreground">Confira antes de salvar — sugestão não é lançamento.</p>
              </div>
            )}
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>

            {/* PARCELAR — um acordo em 12x é UM combinado com DOZE vencimentos.
                Lançar doze vezes à mão é onde nasce erro de data e de centavo.
                Só no lançamento novo: replanejar um que já existe deixaria linhas
                soltas do grupo original. */}
            {!editingEntry && (
              <div className="rounded border p-2 space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.parcelar}
                    onChange={e => setForm(p => ({ ...p, parcelar: e.target.checked }))}
                  />
                  <Repeat className="h-3.5 w-3.5" /> Parcelar / repetir
                </label>
                {form.parcelar && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px]">Quantas</Label>
                        <Input
                          type="number" min="2" max="360" className="h-8"
                          value={form.parcelas}
                          onChange={e => setForm(p => ({ ...p, parcelas: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">A cada</Label>
                        <Select value={form.periodicidade} onValueChange={v => setForm(p => ({ ...p, periodicidade: v as Periodicidade }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PERIODICIDADE_LABEL) as Periodicidade[]).map(k => (
                              <SelectItem key={k} value={k}>{PERIODICIDADE_LABEL[k]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Confundir os dois erra o valor por um fator igual ao número
                        de parcelas — daí ser escolha explícita, sem padrão esperto. */}
                    <div>
                      <Label className="text-[10px]">O valor informado acima é...</Label>
                      <Select value={form.modo} onValueChange={v => setForm(p => ({ ...p, modo: v as ModoParcelamento }))}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dividir">O TOTAL, a dividir entre as parcelas</SelectItem>
                          <SelectItem value="repetir">O valor DE CADA parcela</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {previaParcelas.erro && (
                      <p className="text-[11px] text-red-600">{previaParcelas.erro}</p>
                    )}
                    {previaResumo && (
                      <div className="rounded bg-muted/50 p-2 text-[11px] space-y-0.5">
                        {previaResumo.inicio.map(p => (
                          <div key={p.n} className="flex justify-between">
                            <span className="text-muted-foreground">{p.n}/{p.de} · {p.data}</span>
                            <span className="font-medium">{formatCurrency(p.valor)}</span>
                          </div>
                        ))}
                        {previaResumo.ocultas > 0 && (
                          <p className="text-muted-foreground">... mais {previaResumo.ocultas} parcela(s)</p>
                        )}
                        {previaResumo.ultima && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              {previaResumo.ultima.n}/{previaResumo.ultima.de} · {previaResumo.ultima.data}
                            </span>
                            <span className="font-medium">{formatCurrency(previaResumo.ultima.valor)}</span>
                          </div>
                        )}
                        {/* A sobra de centavo vai na última: R$ 100 em 3x são
                            33,33 + 33,33 + 33,34, e a soma fecha com o combinado. */}
                        <div className="flex justify-between border-t pt-1 mt-1 font-semibold">
                          <span>Soma das parcelas</span>
                          <span>{formatCurrency(previaResumo.total)}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
              </>
            )}
          </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            {itensIa.length > 1 ? (
              <Button onClick={salvarVarios} disabled={saving || escolha.size === 0}>
                {saving ? 'Salvando...' : 'Lançar ' + escolha.size + ' de ' + itensIa.length}
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (editingEntry ? 'Atualizar' : 'Salvar')}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
