// Aba Indicações — os contatos que chegaram por compartilhamento no WhatsApp.
//
// Cada linha é um cartão de contato que alguém mandou numa conversa. A esteira
// é: chegou → alguém diz de que assunto é → vira contato → recebe a
// apresentação dizendo quem indicou. Enquanto não recebe apresentação, a
// indicação está parada, e indicação parada esfria e queima quem indicou.
//
// Regras de interface da casa respeitadas aqui: nada de navegar para outra
// página — o detalhe abre em Sheet por cima da lista, e fechar devolve a pessoa
// exatamente onde estava.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuthContext } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search, UserPlus, Sparkles, Send, Phone, Trophy, Smartphone, MessageSquareQuote,
  CheckCircle2, XCircle, Loader2, UserCheck, Users,
} from 'lucide-react';

export interface Indicacao {
  id: string;
  shared_at: string;
  direction: string;
  referrer_phone: string;
  referrer_name: string | null;
  referrer_contact_id: string | null;
  referrer_group_id: string | null;
  indicated_name: string;
  indicated_phone: string;
  indicated_company: string | null;
  indicated_contact_id: string | null;
  instance_name: string | null;
  instance_owner_phone: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  ai_suggested_product: string | null;
  ai_reason: string | null;
  ai_confidence: number | null;
  product_service_id: string | null;
  product_name: string | null;
  status: string;
  discard_reason: string | null;
  outreach_draft: string | null;
  outreach_sent_at: string | null;
  notes: string | null;
}

interface Produto { id: string; name: string }
interface PessoaDaEquipe { user_id: string; full_name: string | null; default_instance_id: string | null }
interface InstanciaResumo { id: string; instance_name: string; owner_name: string | null }

/**
 * Acesso à tabela `referrals`.
 *
 * Ela vive no Supabase EXTERNO, e `types.ts` é gerado a partir do CLOUD — o
 * TypeScript não conhece o nome e recusa a chamada. Mesmo caso de
 * `whatsapp_groups_index` e companhia. O atalho fica isolado aqui, numa função
 * só, em vez de espalhar cast por toda chamada.
 */
function tabelaIndicacoes() {
  return (externalSupabase as unknown as SupabaseClient).from('referrals');
}

const STATUS_ROTULO: Record<string, string> = {
  novo: 'Novo',
  classificado: 'Classificado',
  contatado: 'Apresentação enviada',
  convertido: 'Virou cliente',
  descartado: 'Descartado',
};

const STATUS_COR: Record<string, string> = {
  novo: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  classificado: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  contatado: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  convertido: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  descartado: 'bg-muted text-muted-foreground',
};

/** Telefone só-dígitos vira algo legível: 558699275467 → +55 (86) 9927-5467 */
function formatarTelefone(bruto: string | null): string {
  if (!bruto) return '';
  const d = bruto.replace(/\D/g, '');
  if (d.length < 10) return bruto;
  const ddi = d.length > 11 ? d.slice(0, d.length - 11) : '55';
  const resto = d.slice(-11);
  const ddd = resto.slice(0, 2);
  const numero = resto.slice(2);
  const meio = numero.length === 9 ? `${numero.slice(0, 5)}-${numero.slice(5)}` : `${numero.slice(0, 4)}-${numero.slice(4)}`;
  return `+${ddi} (${ddd}) ${meio}`;
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function ReferralsInboxTab() {
  const { user } = useAuthContext();
  const { toast } = useToast();

  const [indicacoes, setIndicacoes] = useState<Indicacao[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [equipe, setEquipe] = useState<PessoaDaEquipe[]>([]);
  const [instancias, setInstancias] = useState<InstanciaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroInstancia, setFiltroInstancia] = useState('todas');
  const [aberta, setAberta] = useState<Indicacao | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [indRes, prodRes, equipeRes, instRes] = await Promise.all([
      tabelaIndicacoes()
        .select('*')
        .order('shared_at', { ascending: false })
        .limit(1000),
      // Produtos moram no Cloud, junto com o catálogo que o resto do sistema usa.
      supabase.from('products_services').select('id, name').eq('is_active', true).order('display_order'),
      supabase.from('profiles').select('user_id, full_name, default_instance_id'),
      externalSupabase.from('whatsapp_instances').select('id, instance_name, owner_name'),
    ]);

    if (indRes.error) {
      // Antes da migration rodar a tabela não existe — a aba explica em vez de
      // quebrar a página inteira de contatos.
      console.warn('[indicacoes] não consegui ler referrals:', indRes.error.message);
    }
    setIndicacoes((indRes.data || []) as unknown as Indicacao[]);
    setProdutos((prodRes.data || []) as Produto[]);
    setEquipe((equipeRes.data || []) as PessoaDaEquipe[]);
    setInstancias((instRes.data || []) as unknown as InstanciaResumo[]);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /** Quem atende cada instância. Uma instância pode ter vários usuários — é o
   *  caso normal aqui, e por isso o dono do número não responde a pergunta. */
  const equipePorInstancia = useMemo(() => {
    const porId = new Map<string, string>();
    instancias.forEach(i => porId.set(i.id, i.instance_name));
    const mapa = new Map<string, PessoaDaEquipe[]>();
    equipe.forEach(p => {
      if (!p.default_instance_id) return;
      const nomeInstancia = porId.get(p.default_instance_id);
      if (!nomeInstancia) return;
      const lista = mapa.get(nomeInstancia) || [];
      lista.push(p);
      mapa.set(nomeInstancia, lista);
    });
    return mapa;
  }, [equipe, instancias]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return indicacoes.filter(i => {
      if (filtroStatus !== 'todos' && i.status !== filtroStatus) return false;
      if (filtroInstancia !== 'todas' && i.instance_name !== filtroInstancia) return false;
      if (!termo) return true;
      return (
        i.indicated_name?.toLowerCase().includes(termo) ||
        i.indicated_phone?.includes(termo.replace(/\D/g, '')) ||
        (i.referrer_name || '').toLowerCase().includes(termo) ||
        i.referrer_phone?.includes(termo.replace(/\D/g, '')) ||
        (i.product_name || i.ai_suggested_product || '').toLowerCase().includes(termo)
      );
    });
  }, [indicacoes, busca, filtroStatus, filtroInstancia]);

  const contagemPorStatus = useMemo(() => {
    const c: Record<string, number> = {};
    indicacoes.forEach(i => { c[i.status] = (c[i.status] || 0) + 1; });
    return c;
  }, [indicacoes]);

  /** Ranking de quem mais indicou. É a resposta para "quem está trazendo gente". */
  const ranking = useMemo(() => {
    const porIndicador = new Map<string, { nome: string; total: number; convertidos: number }>();
    indicacoes.forEach(i => {
      const chave = i.referrer_phone;
      const atual = porIndicador.get(chave) || {
        nome: i.referrer_name || formatarTelefone(i.referrer_phone),
        total: 0,
        convertidos: 0,
      };
      atual.total++;
      if (i.status === 'convertido') atual.convertidos++;
      if (i.referrer_name && atual.nome.startsWith('+')) atual.nome = i.referrer_name;
      porIndicador.set(chave, atual);
    });
    return Array.from(porIndicador.entries())
      .map(([telefone, v]) => ({ telefone, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [indicacoes]);

  const atualizarLinha = useCallback((id: string, mudancas: Partial<Indicacao>) => {
    setIndicacoes(atual => atual.map(i => (i.id === id ? { ...i, ...mudancas } : i)));
    setAberta(atual => (atual && atual.id === id ? { ...atual, ...mudancas } : atual));
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 mt-2 px-4 pb-4">
      {/* Resumo + ranking */}
      <div className="grid gap-2 md:grid-cols-[1fr_auto] items-start py-3 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {(['novo', 'classificado', 'contatado', 'convertido', 'descartado'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltroStatus(filtroStatus === s ? 'todos' : s)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                filtroStatus === s ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              }`}
            >
              <span className="font-medium">{contagemPorStatus[s] || 0}</span>{' '}
              <span className="text-muted-foreground">{STATUS_ROTULO[s]}</span>
            </button>
          ))}
        </div>

        {ranking.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span className="hidden sm:inline">Quem mais indica:</span>
            <div className="flex flex-wrap gap-1">
              {ranking.map(r => (
                <Badge
                  key={r.telefone}
                  variant="outline"
                  className="text-[10px] cursor-pointer"
                  onClick={() => setBusca(r.nome)}
                  title={`${r.total} indicação(ões), ${r.convertidos} virou cliente`}
                >
                  {r.nome} · {r.total}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 pb-3 shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por indicado, quem indicou, telefone ou assunto..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={filtroInstancia} onValueChange={setFiltroInstancia}>
          <SelectTrigger className="h-9 w-[190px] text-xs">
            <Smartphone className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="Instância" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as instâncias</SelectItem>
            {instancias.map(i => (
              <SelectItem key={i.id} value={i.instance_name}>{i.instance_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filtroStatus !== 'todos' || filtroInstancia !== 'todas' || busca) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => { setFiltroStatus('todos'); setFiltroInstancia('todas'); setBusca(''); }}
          >
            Limpar
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {filtradas.length} de {indicacoes.length}
        </span>
      </div>

      <ScrollArea className="flex-1">
        {carregando ? (
          <p className="text-center text-muted-foreground py-10 text-sm">Carregando indicações...</p>
        ) : filtradas.length === 0 ? (
          <div className="text-center py-10 px-4">
            <MessageSquareQuote className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {indicacoes.length === 0
                ? 'Nenhuma indicação capturada ainda. Todo contato compartilhado numa conversa do WhatsApp aparece aqui.'
                : 'Nenhuma indicação com esses filtros.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-2 pb-4">
            {filtradas.map(ind => (
              <CartaoDeIndicacao key={ind.id} indicacao={ind} onAbrir={() => setAberta(ind)} />
            ))}
          </div>
        )}
      </ScrollArea>

      <FichaDaIndicacao
        indicacao={aberta}
        produtos={produtos}
        equipeDaInstancia={aberta?.instance_name ? equipePorInstancia.get(aberta.instance_name) || [] : []}
        userId={user?.id || null}
        onFechar={() => setAberta(null)}
        onMudou={atualizarLinha}
        aviso={toast}
      />
    </div>
  );
}

function CartaoDeIndicacao({ indicacao, onAbrir }: { indicacao: Indicacao; onAbrir: () => void }) {
  const assunto = indicacao.product_name || indicacao.ai_suggested_product;
  const assuntoConfirmado = !!indicacao.product_name;

  return (
    <Card className="cursor-pointer transition-colors hover:bg-muted/40" onClick={onAbrir}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-sm truncate">{indicacao.indicated_name}</p>
              <Badge className={`text-[10px] ${STATUS_COR[indicacao.status] || ''}`}>
                {STATUS_ROTULO[indicacao.status] || indicacao.status}
              </Badge>
              {indicacao.indicated_contact_id && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <UserCheck className="h-3 w-3" />Já é contato
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" />{formatarTelefone(indicacao.indicated_phone)}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquareQuote className="h-3 w-3" />
                indicado por <strong className="font-medium text-foreground">
                  {indicacao.referrer_name || formatarTelefone(indicacao.referrer_phone)}
                </strong>
                {indicacao.referrer_group_id && ' (em grupo)'}
              </span>
              {indicacao.instance_name && (
                <span className="flex items-center gap-1">
                  <Smartphone className="h-3 w-3" />{indicacao.instance_name}
                </span>
              )}
            </div>

            {assunto && (
              <div className="mt-1.5">
                <Badge variant={assuntoConfirmado ? 'secondary' : 'outline'} className="text-[10px]">
                  {assuntoConfirmado ? '📦' : '🤖'} {assunto}
                  {!assuntoConfirmado && ' (sugestão)'}
                </Badge>
              </div>
            )}
          </div>

          <span className="text-[11px] text-muted-foreground shrink-0">{dataCurta(indicacao.shared_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

interface PropsDaFicha {
  indicacao: Indicacao | null;
  produtos: Produto[];
  equipeDaInstancia: PessoaDaEquipe[];
  userId: string | null;
  onFechar: () => void;
  onMudou: (id: string, mudancas: Partial<Indicacao>) => void;
  aviso: ReturnType<typeof useToast>['toast'];
}

/** Ficha da indicação. Abre por cima da lista; fechar devolve a pessoa onde estava. */
function FichaDaIndicacao({ indicacao, produtos, equipeDaInstancia, userId, onFechar, onMudou, aviso }: PropsDaFicha) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');

  useEffect(() => { setRascunho(indicacao?.outreach_draft || ''); }, [indicacao?.id, indicacao?.outreach_draft]);

  if (!indicacao) return null;
  const ind = indicacao;

  const gravar = async (mudancas: Record<string, unknown>, etiqueta: string) => {
    setOcupado(etiqueta);
    const { error } = await tabelaIndicacoes().update(mudancas).eq('id', ind.id);
    setOcupado(null);
    if (error) {
      aviso({ title: 'Não consegui salvar', description: error.message, variant: 'destructive' });
      return false;
    }
    onMudou(ind.id, mudancas as Partial<Indicacao>);
    return true;
  };

  /** Pede à IA que leia a conversa ao redor do cartão e diga de que assunto é. */
  const analisar = async () => {
    setOcupado('ia');
    try {
      const { data, error } = await cloudFunctions.invoke('referral-classify', {
        body: { referral_id: ind.id, products: produtos.map(p => ({ id: p.id, name: p.name })), force: true },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'falhou');
      onMudou(ind.id, {
        ai_suggested_product: data.suggestion,
        ai_reason: data.reason,
        ai_confidence: data.confidence,
      });
      aviso({ title: 'Sugestão pronta', description: `${data.suggestion} — confirme antes de valer.` });
    } catch (e: any) {
      aviso({ title: 'A IA não conseguiu', description: e?.message, variant: 'destructive' });
    } finally {
      setOcupado(null);
    }
  };

  const confirmarProduto = async (produtoId: string) => {
    const produto = produtos.find(p => p.id === produtoId);
    if (!produto) return;
    await gravar(
      {
        product_service_id: produto.id,
        product_name: produto.name,
        confirmed_by_user_id: userId,
        confirmed_at: new Date().toISOString(),
        status: ind.status === 'novo' ? 'classificado' : ind.status,
      },
      'produto',
    );
  };

  /** Cria a ficha do indicado em `contacts`, já marcada como vinda de indicação. */
  const criarContato = async () => {
    setOcupado('contato');
    try {
      const { data, error } = await externalSupabase
        .from('contacts')
        .insert({
          full_name: ind.indicated_name,
          phone: ind.indicated_phone,
          action_source: 'referral',
          action_source_detail: ind.referrer_name || ind.referrer_phone,
          notes: [
            `Indicado por ${ind.referrer_name || formatarTelefone(ind.referrer_phone)} em ${dataCurta(ind.shared_at)}`,
            ind.product_name || ind.ai_suggested_product ? `Assunto: ${ind.product_name || ind.ai_suggested_product}` : '',
            ind.indicated_company ? `Empresa: ${ind.indicated_company}` : '',
          ].filter(Boolean).join('\n'),
        } as never)
        .select('id')
        .single();
      if (error) throw error;

      const contatoId = (data as any).id as string;
      await tabelaIndicacoes().update({ indicated_contact_id: contatoId }).eq('id', ind.id);
      onMudou(ind.id, { indicated_contact_id: contatoId });

      // Registra o laço indicador → indicado, para a ficha do contato mostrar de
      // onde ele veio sem precisar voltar aqui.
      if (ind.referrer_contact_id) {
        await externalSupabase.from('contact_relationships').insert({
          contact_id: ind.referrer_contact_id,
          related_contact_id: contatoId,
          relationship_type: 'indicou',
          notes: `Indicação de ${dataCurta(ind.shared_at)}`,
        } as never);
      }
      aviso({ title: 'Contato criado', description: ind.indicated_name });
    } catch (e: any) {
      aviso({ title: 'Não consegui criar o contato', description: e?.message, variant: 'destructive' });
    } finally {
      setOcupado(null);
    }
  };

  const gerarApresentacao = async () => {
    setOcupado('rascunho');
    try {
      const { data, error } = await cloudFunctions.invoke('referral-outreach', {
        body: { referral_id: ind.id, action: 'draft' },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'falhou');
      setRascunho(data.draft);
      onMudou(ind.id, { outreach_draft: data.draft });
    } catch (e: any) {
      aviso({ title: 'Não consegui escrever', description: e?.message, variant: 'destructive' });
    } finally {
      setOcupado(null);
    }
  };

  const enviarApresentacao = async () => {
    if (!rascunho.trim()) return;
    setOcupado('envio');
    try {
      const { data, error } = await cloudFunctions.invoke('referral-outreach', {
        body: { referral_id: ind.id, action: 'send', text: rascunho, user_id: userId },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'falhou');
      onMudou(ind.id, {
        outreach_sent_at: new Date().toISOString(),
        outreach_draft: rascunho,
        status: 'contatado',
      });
      aviso({ title: 'Apresentação enviada', description: `Para ${ind.indicated_name}` });
    } catch (e: any) {
      aviso({ title: 'Não saiu', description: e?.message, variant: 'destructive' });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Sheet open={!!indicacao} onOpenChange={aberto => { if (!aberto) onFechar(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 pr-6">
            {ind.indicated_name}
            <Badge className={`text-[10px] ${STATUS_COR[ind.status] || ''}`}>
              {STATUS_ROTULO[ind.status] || ind.status}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Quem é quem */}
          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <Linha rotulo="Telefone" valor={formatarTelefone(ind.indicated_phone)} />
            {ind.indicated_company && <Linha rotulo="Empresa" valor={ind.indicated_company} />}
            <Separator />
            <Linha
              rotulo="Indicado por"
              valor={`${ind.referrer_name || formatarTelefone(ind.referrer_phone)}${ind.referrer_group_id ? ' (em grupo)' : ''}`}
            />
            <Linha rotulo="Chegou em" valor={new Date(ind.shared_at).toLocaleString('pt-BR')} />
            <Linha rotulo="Instância" valor={ind.instance_name || '—'} />
            {equipeDaInstancia.length > 0 && (
              <Linha
                rotulo={equipeDaInstancia.length > 1 ? 'Usuários da instância' : 'Usuário da instância'}
                valor={equipeDaInstancia.map(p => p.full_name).filter(Boolean).join(', ') || '—'}
              />
            )}
          </div>

          {/* Responsável */}
          {equipeDaInstancia.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />Responsável por esta indicação
              </p>
              <Select
                value={ind.assigned_user_id || ''}
                onValueChange={async v => {
                  const pessoa = equipeDaInstancia.find(p => p.user_id === v);
                  await gravar(
                    { assigned_user_id: v, assigned_user_name: pessoa?.full_name || null },
                    'responsavel',
                  );
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Escolher responsável" />
                </SelectTrigger>
                <SelectContent>
                  {equipeDaInstancia.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.user_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Assunto da indicação */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Assunto da indicação</p>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={analisar} disabled={ocupado === 'ia'}>
                {ocupado === 'ia' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Ler a conversa
              </Button>
            </div>

            {ind.ai_suggested_product && !ind.product_name && (
              <div className="rounded-md border border-dashed p-2.5 text-xs space-y-1">
                <p>
                  <span className="font-medium">Sugestão da IA:</span> {ind.ai_suggested_product}
                  {ind.ai_confidence != null && (
                    <span className="text-muted-foreground"> · confiança {Math.round(ind.ai_confidence * 100)}%</span>
                  )}
                </p>
                {ind.ai_reason && <p className="text-muted-foreground italic">"{ind.ai_reason}"</p>}
                <p className="text-muted-foreground">Confirme abaixo para valer no relatório.</p>
              </div>
            )}

            <Select value={ind.product_service_id || ''} onValueChange={confirmarProduto} disabled={ocupado === 'produto'}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Confirmar o serviço/assunto" />
              </SelectTrigger>
              <SelectContent>
                {produtos.map(p => (
                  <SelectItem key={p.id} value={p.id}>📦 {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contato */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Ficha do indicado</p>
            {ind.indicated_contact_id ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />Já está na agenda de contatos.
              </p>
            ) : (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={criarContato} disabled={ocupado === 'contato'}>
                {ocupado === 'contato' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Criar contato a partir da indicação
              </Button>
            )}
          </div>

          {/* Apresentação */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Mensagem de apresentação</p>
              {!ind.outreach_sent_at && (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={gerarApresentacao} disabled={ocupado === 'rascunho'}>
                  {ocupado === 'rascunho' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Escrever
                </Button>
              )}
            </div>

            {ind.outreach_sent_at ? (
              <div className="rounded-md border bg-muted/40 p-2.5 text-xs space-y-1">
                <p className="text-muted-foreground">
                  Enviada em {new Date(ind.outreach_sent_at).toLocaleString('pt-BR')}
                </p>
                <p className="whitespace-pre-wrap">{ind.outreach_draft}</p>
              </div>
            ) : (
              <>
                <Textarea
                  value={rascunho}
                  onChange={e => setRascunho(e.target.value)}
                  placeholder="Clique em Escrever para a IA montar a apresentação citando quem indicou — ou escreva você mesmo."
                  className="min-h-[110px] text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Nada sai sozinho: a mensagem só é enviada quando você clicar.
                </p>
                <Button
                  size="sm"
                  className="gap-1.5 w-full"
                  onClick={enviarApresentacao}
                  disabled={ocupado === 'envio' || !rascunho.trim()}
                >
                  {ocupado === 'envio' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Enviar para {ind.indicated_name}
                </Button>
              </>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            {ind.status !== 'convertido' && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => gravar({ status: 'convertido' }, 'status')}
                disabled={ocupado === 'status'}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />Virou cliente
              </Button>
            )}
            {ind.status !== 'descartado' && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={() => gravar({ status: 'descartado' }, 'status')}
                disabled={ocupado === 'status'}
              >
                <XCircle className="h-3.5 w-3.5" />Não é indicação
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{rotulo}</span>
      <span className="text-sm text-right">{valor}</span>
    </div>
  );
}
