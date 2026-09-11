// Painel de métricas: investimento ao vivo + funil, num lugar só.
//
// Tudo vem de UMA chamada (`metricas-painel`, no Railway). O token da Meta nunca
// chega aqui, e `meta_capi_events` tem RLS sem policy — o navegador não alcança
// essas tabelas nem se quisesse.
//
// REGRA DESTA TELA: número que não pode ser calculado com honestidade aparece
// como "—" com o motivo do lado. Nunca como zero, nunca como estimativa.
//
// FILTROS: período, funil e acolhedor. Os três são resolvidos no servidor e
// alcançam os DOIS lados (gasto da Meta e lead do CRM), justamente para que o
// custo por lead nunca some numerador de um recorte com denominador de outro.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, TrendingUp, Users, Handshake, Wallet, AlertTriangle, Send, Check, X, Link2,
  Target, Timer, Filter, CalendarRange, UserRound,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cloudFunctions } from '@/lib/functionRouter';

const ATUALIZA_MS = 60_000;
const TODOS = '__todos__';

const brl = (v: number | null | undefined) =>
  typeof v === 'number'
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
    : '—';
const num = (v: number | null | undefined) =>
  typeof v === 'number' ? new Intl.NumberFormat('pt-BR').format(v) : '—';
const pct = (v: number | null | undefined) =>
  typeof v === 'number' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—';
const diaCurto = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

/** Dia civil de São Paulo, não o de Greenwich: `toISOString` faria "hoje" começar às 21h de ontem. */
function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function diasAtrasSP(n: number): string {
  const d = new Date(`${hojeSP()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

interface Painel {
  gerado_em: string;
  janela: { de: string; ate: string; dias: number; inclui_hoje: boolean };
  filtros: { funil: string | null; acolhedor: string | null };
  opcoes: {
    funis: Array<{ chave: string; rotulo: string }>;
    acolhedores: Array<{ chave: string; rotulo: string }>;
    max_dias: number;
  };
  investimento: {
    disponivel: boolean; erro?: string | null;
    na_janela: number; hoje: number | null;
    contas: Array<{ conta: string; valor: number }>;
  };
  leads: {
    na_janela: number; pagos_na_janela: number; hoje: number | null; pagos_hoje: number | null;
    entraram_no_funil: number; entraram_no_funil_hoje: number | null;
    por_fonte: Array<{ nome: string; qtd: number }>; por_board: Array<{ nome: string; qtd: number }>;
  };
  fechamentos: {
    na_janela: number; pagos_na_janela: number; hoje: number | null;
    por_fonte: Array<{ nome: string; qtd: number }>; por_board: Array<{ nome: string; qtd: number }>;
  };
  serie: Array<{ dia: string; leads: number; leads_pagos: number; fechamentos: number; investido: number }>;
  desempenho_por_conjunto: Array<{
    nome: string; nome_invalido: boolean; acolhedor: string | null; conta: string | null;
    campanha: string | null; ativo: boolean; otimizacao: string | null; piloto_conversao: boolean;
    gasto: number | null; leads_meta: number | null; leads_crm: number; fechados: number;
    custo_por_lead: number | null; custo_por_fechamento: number | null; taxa_fechamento: number | null;
  }>;
  por_acolhedor: Array<{
    chave: string; rotulo: string; conjuntos: number; gasto: number; leads: number; fechados: number;
    custo_por_lead: number | null; custo_por_fechamento: number | null; taxa_fechamento: number | null;
  }>;
  funil_pago: {
    total: number; sem_resposta: number; em_atendimento: number; fechados: number;
    inviaveis: number; recusados: number;
  };
  capi: Record<string, any>;
  funil_por_status: Record<string, number>;
  integracao: {
    disponivel: boolean; erro?: string; dataset_id?: string;
    conjuntos_ativos?: number; conjuntos_otimizando_conversao?: number; conjuntos_usando_dataset?: number;
  };
  rotinas: Array<{
    chave: string; rotulo: string; a_cada: string; ligado: boolean; execucoes: number;
    ultima_em: string | null; ultimo_resultado: string | null; acumulado: string;
  }>;
  custo: {
    leads_pagos: number; fechamentos_pagos: number;
    por_lead_pago: number | null; por_fechamento_pago: number | null;
    gasto_sem_lead_no_crm: number; gasto_com_lead_no_crm: number;
    por_lead_pago_so_do_que_gerou: number | null;
    campanhas_sem_lead: Array<{ campanha: string; gasto: number; conjuntos: number; leads_meta: number }>;
    cobertura_pagos_desde: string | null; cobertura_completa: boolean; aviso: string | null;
  };
}

function Kpi({
  titulo, valor, sub, rodape, icone, destaque, aviso,
}: { titulo: string; valor: string; sub?: string; rodape?: string; icone: React.ReactNode; destaque?: boolean; aviso?: string | null }) {
  return (
    <Card className={destaque ? 'border-primary/40' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          {icone}
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`font-bold tabular-nums ${destaque ? 'text-3xl text-primary' : 'text-2xl'}`}>{valor}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        {rodape && <p className="text-[11px] text-muted-foreground/70 mt-1.5 border-t pt-1.5">{rodape}</p>}
        {aviso && (
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 flex items-start gap-1">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{aviso}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const ROTULO_STATUS: Record<string, string> = {
  no_response: 'Sem resposta',
  in_progress: 'Em atendimento',
  closed: 'Fechado',
  inviavel: 'Inviável',
  cancelled: 'Cancelado',
  refused: 'Recusado',
};

/** Linha do checklist: o que precisa estar feito para a otimização por conversão valer. */
function Passo({ ok, texto, detalhe }: { ok: boolean; texto: string; detalhe?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <span className={ok ? '' : 'text-muted-foreground'}>{texto}</span>
        {detalhe && <span className="text-xs text-muted-foreground block">{detalhe}</span>}
      </div>
    </div>
  );
}

function Ranking({ titulo, itens }: { titulo: string; itens: Array<{ nome: string; qtd: number }> }) {
  const maior = itens[0]?.qtd || 1;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">{titulo}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {itens.length === 0 && <p className="text-sm text-muted-foreground">Nada na janela.</p>}
        {itens.map((i) => (
          <div key={i.nome} className="space-y-1">
            <div className="flex justify-between text-sm gap-2">
              <span className="truncate" title={i.nome}>{i.nome}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">{num(i.qtd)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary/60" style={{ width: `${Math.max(2, (i.qtd / maior) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** "há 4 min", "há 2 h". Rotina que nunca rodou nesta versão diz isso, não "há 56 anos". */
function desdeQuando(iso: string | null): string {
  if (!iso) return 'ainda não rodou nesta versão';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dia(s)`;
}

/**
 * Barra de filtros: período, funil e acolhedor.
 *
 * O período tem atalhos porque é o que se troca o tempo todo, e campos de data
 * porque "a semana passada inteira" não é atalho nenhum. Os três filtros vão
 * para o servidor juntos — filtrar no navegador só recortaria o que já foi
 * baixado, e o gasto da Meta nunca esteve no navegador.
 */
function BarraDeFiltros({
  de, ate, funil, acolhedor, opcoes, ocupado, onPeriodo, onFunil, onAcolhedor,
}: {
  de: string; ate: string; funil: string | null; acolhedor: string | null;
  opcoes: Painel['opcoes'] | null; ocupado: boolean;
  onPeriodo: (de: string, ate: string) => void;
  onFunil: (v: string | null) => void;
  onAcolhedor: (v: string | null) => void;
}) {
  const hoje = hojeSP();
  const atalhos = [
    { rot: 'Hoje', de: hoje, ate: hoje },
    { rot: '7 dias', de: diasAtrasSP(6), ate: hoje },
    { rot: '30 dias', de: diasAtrasSP(29), ate: hoje },
    { rot: '90 dias', de: diasAtrasSP(89), ate: hoje },
  ];
  const ativo = (a: { de: string; ate: string }) => a.de === de && a.ate === ate;
  const filtrando = Boolean(funil || acolhedor);

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5 mr-1">
            <CalendarRange className="h-3.5 w-3.5" />Período
          </span>
          {atalhos.map((a) => (
            <Button
              key={a.rot}
              size="sm"
              variant={ativo(a) ? 'default' : 'outline'}
              disabled={ocupado}
              onClick={() => onPeriodo(a.de, a.ate)}
            >
              {a.rot}
            </Button>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <Input
              type="date"
              value={de}
              max={ate}
              disabled={ocupado}
              onChange={(e) => e.target.value && onPeriodo(e.target.value, ate)}
              className="h-9 w-[150px]"
              aria-label="Data inicial"
            />
            <span className="text-muted-foreground text-sm">até</span>
            <Input
              type="date"
              value={ate}
              min={de}
              max={hoje}
              disabled={ocupado}
              onChange={(e) => e.target.value && onPeriodo(de, e.target.value)}
              className="h-9 w-[150px]"
              aria-label="Data final"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5" />Funil
            </span>
            <Select
              value={funil ?? TODOS}
              disabled={ocupado}
              onValueChange={(v) => onFunil(v === TODOS ? null : v)}
            >
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os funis</SelectItem>
                {(opcoes?.funis || []).map((f) => (
                  <SelectItem key={f.chave} value={f.chave}>{f.rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />Acolhedor
            </span>
            <Select
              value={acolhedor ?? TODOS}
              disabled={ocupado}
              onValueChange={(v) => onAcolhedor(v === TODOS ? null : v)}
            >
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os acolhedores</SelectItem>
                {(opcoes?.acolhedores || []).map((a) => (
                  <SelectItem key={a.chave} value={a.chave}>{a.rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filtrando && (
            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => { onFunil(null); onAcolhedor(null); }}>
              Limpar filtros
            </Button>
          )}
        </div>

        {acolhedor && (
          <p className="text-[11px] text-muted-foreground border-t pt-2">
            O acolhedor vem do nome do conjunto de anúncio — é o único vínculo que existe entre um lead
            pago e quem o atende. Lead sem conjunto (orgânico, notícia, cadastro manual) fica de fora
            deste recorte.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Dinheiro que saiu e não virou lead no funil.
 *
 * Separado da tabela de propósito: numa lista de 24 conjuntos ordenada por
 * gasto, um conjunto que gastou R$ 373 e trouxe zero lead não se distingue de um
 * que gastou R$ 373 e trouxe 130. É o número que alguém precisa ver hoje, não
 * rolar até encontrar.
 */
function GastoSemLead({ custo }: { custo: Painel['custo'] }) {
  const campanhas = custo?.campanhas_sem_lead || [];
  if (!campanhas.length) return null;
  const formulariosPerdidos = campanhas.reduce((t, c) => t + (c.leads_meta || 0), 0);
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4" />Investimento que não alimenta o CRM
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Agrupado por campanha — conjunto a conjunto seriam dezenas de linhas e nenhuma decisão.
        </p>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-500">
          {brl(custo.gasto_sem_lead_no_crm)}
        </div>
        <div className="mt-3 space-y-1.5">
          {campanhas.map((c) => (
            <div key={c.campanha} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate" title={c.campanha}>
                {c.campanha}
                <span className="text-xs text-muted-foreground ml-2">{num(c.conjuntos)} conjunto(s)</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {brl(c.gasto)}
                <span className="text-xs text-muted-foreground ml-2">
                  {c.leads_meta ? `${num(c.leads_meta)} na Meta, 0 no funil` : 'nenhum formulário'}
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 border-t pt-2">
          Campanha que vende outro produto (curso, guia, seguro) não deveria mesmo aparecer no funil — o
          que ela distorce é o custo por lead da visão "todos os funis", porque o gasto dela entra no
          numerador e os leads dela não entram no denominador. Filtrar por funil resolve.
          {formulariosPerdidos > 0 && (
            <> Já os {num(formulariosPerdidos)} formulários registrados na Meta e ausentes do CRM são
            outra coisa: ou é roteamento faltando, ou é lead de produto que não usa o CRM.</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/** A mesma tabela de conjuntos, somada por pessoa. É a leitura que a operação faz. */
function PorAcolhedor({ itens, ativo, onEscolher }: {
  itens: Painel['por_acolhedor']; ativo: string | null; onEscolher: (v: string | null) => void;
}) {
  if (!itens?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><UserRound className="h-4 w-4" />Por acolhedor</CardTitle>
        <p className="text-xs text-muted-foreground">
          Some os conjuntos de cada pessoa. Clique numa linha para filtrar a aba inteira por ela.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="pb-2 font-medium">Acolhedor</th>
                <th className="pb-2 font-medium text-right">Investido</th>
                <th className="pb-2 font-medium text-right">Leads</th>
                <th className="pb-2 font-medium text-right">Custo/lead</th>
                <th className="pb-2 font-medium text-right">Fechados</th>
                <th className="pb-2 font-medium text-right">Custo/contrato</th>
                <th className="pb-2 font-medium text-right">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <tr
                  key={a.chave}
                  onClick={() => onEscolher(ativo === a.chave ? null : a.chave)}
                  className={`border-b last:border-0 cursor-pointer hover:bg-muted/50 ${ativo === a.chave ? 'bg-primary/5' : ''}`}
                >
                  <td className="py-2">
                    {a.rotulo}
                    <span className="text-xs text-muted-foreground ml-2">{num(a.conjuntos)} conjunto(s)</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{brl(a.gasto)}</td>
                  <td className="py-2 text-right tabular-nums">{num(a.leads)}</td>
                  <td className="py-2 text-right tabular-nums">{brl(a.custo_por_lead)}</td>
                  <td className="py-2 text-right tabular-nums">{num(a.fechados)}</td>
                  <td className="py-2 text-right tabular-nums">{brl(a.custo_por_fechamento)}</td>
                  <td className="py-2 text-right tabular-nums">{pct(a.taxa_fechamento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          "Custo/contrato" fica vazio para quem ainda não fechou na janela: dividir por zero e escrever
          R$ 0,00 mentiria, e "infinito" não ajuda a decidir nada.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Desempenho por conjunto de anúncio.
 *
 * Gasto e formulário vêm da Meta; lead e fechamento vêm do CRM. Nenhum dos dois
 * lados sabe sozinho quanto custa um cliente.
 */
function DesempenhoPorConjunto({ itens }: { itens: Painel['desempenho_por_conjunto'] }) {
  if (!itens?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4" />Desempenho por conjunto de anúncio
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Gasto e formulários vêm da Meta. Leads e fechamentos vêm do CRM. Conjunto pausado continua na
          lista enquanto tiver gasto ou lead no período.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="pb-2 font-medium">Conjunto</th>
                <th className="pb-2 font-medium text-right">Investido</th>
                <th className="pb-2 font-medium text-right">Leads</th>
                <th className="pb-2 font-medium text-right">Custo/lead</th>
                <th className="pb-2 font-medium text-right">Fechados</th>
                <th className="pb-2 font-medium text-right">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((c) => (
                <tr key={c.nome} className={`border-b last:border-0 ${c.piloto_conversao ? 'bg-primary/5' : ''}`}>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.nome_invalido ? (
                        <span className="text-amber-600 dark:text-amber-500 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />nome inválido
                        </span>
                      ) : (
                        <span className="font-medium">{c.nome}</span>
                      )}
                      {c.piloto_conversao && <Badge className="text-[10px]">piloto conversão</Badge>}
                      {!c.ativo && <Badge variant="outline" className="text-[10px]">pausado</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {c.nome_invalido
                        ? 'a Graph API gravou um erro no lugar do nome do conjunto — os leads são reais'
                        : [c.campanha, c.conta].filter(Boolean).join(' · ') || 'sem gasto no período'}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{brl(c.gasto)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {num(c.leads_crm)}
                    {typeof c.leads_meta === 'number' && c.leads_meta !== c.leads_crm && (
                      <span className="block text-[11px] text-muted-foreground">{num(c.leads_meta)} na Meta</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{brl(c.custo_por_lead)}</td>
                  <td className="py-2 text-right tabular-nums">{num(c.fechados)}</td>
                  <td className="py-2 text-right tabular-nums">{pct(c.taxa_fechamento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          "Leads" é o que entrou no CRM. Quando a contagem da Meta difere, ela aparece embaixo — a
          diferença é lead que o formulário registrou e o funil ainda não recebeu.
        </p>
      </CardContent>
    </Card>
  );
}

/** O caminho do lead pago: quantos falam, quantos fecham. Cada degrau com o que sobrou. */
function FunilPago({ f, dias }: { f: Painel['funil_pago']; dias: number }) {
  const degraus = [
    { rot: 'Leads de anúncio', v: f.total, cor: 'bg-primary/70' },
    { rot: 'Responderam', v: f.total - f.sem_resposta, cor: 'bg-primary/55' },
    { rot: 'Em atendimento', v: f.em_atendimento, cor: 'bg-primary/40' },
    { rot: 'Fecharam contrato', v: f.fechados, cor: 'bg-emerald-600' },
  ];
  const topo = degraus[0].v || 1;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Filter className="h-4 w-4" />Funil dos leads de anúncio
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Só quem veio de formulário pago, no período selecionado ({num(dias)} dia(s)).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {degraus.map((d) => (
          <div key={d.rot} className="space-y-1">
            <div className="flex justify-between text-sm gap-2">
              <span className="truncate">{d.rot}</span>
              <span className="tabular-nums shrink-0">
                {num(d.v)}
                <span className="text-muted-foreground ml-2">{pct(topo ? (d.v / topo) * 100 : null)}</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${d.cor}`} style={{ width: `${Math.max(1, (d.v / topo) * 100)}%` }} />
            </div>
          </div>
        ))}
        <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
          <p>{num(f.inviaveis)} marcados inviáveis · {num(f.recusados)} recusaram ou cancelaram</p>
          {f.sem_resposta > 0 && (
            <p>
              O degrau que mais come lead é o primeiro: {num(f.sem_resposta)} nunca responderam. É volume
              comprado que não virou conversa — onde a otimização por conversão morde.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** As quatro rotinas que mantêm o painel vivo. Não seguem o filtro: são do sistema, não do período. */
function Rotinas({ itens }: { itens: Painel['rotinas'] }) {
  if (!itens?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Timer className="h-4 w-4" />Rotinas automáticas</CardTitle>
        <p className="text-xs text-muted-foreground">
          O que alimenta esta tela sozinho. Os contadores zeram a cada publicação — quem responde
          "está de pé?" é a última execução.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {itens.map((r) => (
          <div key={r.chave} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {r.ligado ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className={r.ligado ? '' : 'text-muted-foreground line-through'}>{r.rotulo}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">{r.a_cada}</Badge>
              </div>
              {r.ultimo_resultado && (
                <p className="text-xs text-muted-foreground ml-5 truncate" title={r.ultimo_resultado}>
                  {r.ultimo_resultado}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/70 ml-5">{r.acumulado} desde a última publicação</p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{desdeQuando(r.ultima_em)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function MetricasPage() {
  const [dados, setDados] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [de, setDe] = useState(() => diasAtrasSP(29));
  const [ate, setAte] = useState(() => hojeSP());
  const [funil, setFunil] = useState<string | null>(null);
  const [acolhedor, setAcolhedor] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data, error } = await cloudFunctions.invoke('metricas-painel', {
        body: { de, ate, funil, acolhedor },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setDados(data as Painel);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha ao carregar');
    } finally {
      setCarregando(false);
    }
  }, [de, ate, funil, acolhedor]);

  useEffect(() => {
    buscar();
    const t = setInterval(buscar, ATUALIZA_MS);
    return () => clearInterval(t);
  }, [buscar]);

  const inv = dados?.investimento;
  const custo = dados?.custo;
  const filtrado = Boolean(funil || acolhedor);
  const rotuloJanela = useMemo(() => {
    if (!dados) return '';
    if (dados.janela.de === dados.janela.ate) return diaCurto(dados.janela.de);
    return `${diaCurto(dados.janela.de)} a ${diaCurto(dados.janela.ate)}`;
  }, [dados]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="h-4 w-4" />Voltar</Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-primary" />Métricas
              </h1>
              <p className="text-sm text-muted-foreground truncate">
                {dados
                  ? `${rotuloJanela} · atualiza sozinho a cada minuto`
                  : 'Investimento, leads e fechamentos'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={buscar} disabled={carregando} className="gap-2 shrink-0">
            <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />Atualizar
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <BarraDeFiltros
          de={de}
          ate={ate}
          funil={funil}
          acolhedor={acolhedor}
          opcoes={dados?.opcoes ?? null}
          ocupado={carregando && !dados}
          onPeriodo={(d, a) => { setDe(d); setAte(a); }}
          onFunil={setFunil}
          onAcolhedor={setAcolhedor}
        />

        {erro && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Não consegui carregar as métricas: {erro}</span>
            </CardContent>
          </Card>
        )}

        {carregando && !dados && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        )}

        {dados && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                destaque
                titulo="Investido no período"
                valor={inv?.disponivel ? brl(inv.na_janela) : '—'}
                sub={
                  inv?.disponivel
                    ? typeof inv.hoje === 'number' ? `${brl(inv.hoje)} hoje` : 'período fechado, sem hoje'
                    : inv?.erro || 'sem acesso à conta de anúncios'
                }
                icone={<Wallet className="h-3.5 w-3.5" />}
              />
              <Kpi
                titulo="Leads de anúncio"
                valor={num(dados.leads.pagos_na_janela)}
                sub={
                  typeof dados.leads.pagos_hoje === 'number'
                    ? `${num(dados.leads.pagos_hoje)} hoje`
                    : `${num(dados.janela.dias)} dia(s) no período`
                }
                rodape={
                  `${num(dados.leads.na_janela)} leads no total (o resto é notícia e orgânico) · ` +
                  `${num(dados.leads.entraram_no_funil)} entraram no funil`
                }
                icone={<Users className="h-3.5 w-3.5" />}
              />
              <Kpi
                titulo="Fechamentos"
                valor={num(dados.fechamentos.na_janela)}
                sub={`${num(dados.fechamentos.pagos_na_janela)} vieram de anúncio`}
                icone={<Handshake className="h-3.5 w-3.5" />}
              />
              <Kpi
                titulo="Custo por lead pago"
                valor={brl(custo?.por_lead_pago)}
                sub={`${num(custo?.leads_pagos)} leads de anúncio no período`}
                rodape={
                  [
                    custo?.por_fechamento_pago
                      ? `${brl(custo.por_fechamento_pago)} por contrato fechado`
                      : 'sem fechamento pago no período para o custo por contrato',
                    // Os dois números, nunca só o mais bonito: o de cima divide
                    // TODO o investimento, inclusive o de campanha que vende
                    // outro produto e não alimenta o CRM.
                    (custo?.gasto_sem_lead_no_crm ?? 0) > 0
                      ? `inclui ${brl(custo!.gasto_sem_lead_no_crm)} de campanha que não alimenta o CRM — sem elas, ${brl(custo!.por_lead_pago_so_do_que_gerou)} por lead`
                      : null,
                  ].filter(Boolean).join(' · ')
                }
                icone={<TrendingUp className="h-3.5 w-3.5" />}
                aviso={custo?.aviso}
              />
            </div>

            <Tabs defaultValue="desempenho" className="w-full">
              {/* Agrupado por PERGUNTA, não por tipo de dado. Antes eram onze
                  blocos empilhados e a pessoa rolava a tela inteira procurando a
                  tabela certa; agora cada uma responde a uma das três coisas que
                  se quer saber aqui: de onde vem contrato, como isso mudou no
                  tempo, e se o encanamento está de pé. */}
              <TabsList className="w-full justify-start h-auto flex-wrap gap-1">
                <TabsTrigger value="desempenho" className="gap-1.5">
                  <Target className="h-3.5 w-3.5" />Desempenho
                </TabsTrigger>
                <TabsTrigger value="evolucao" className="gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />Evolução e funil
                </TabsTrigger>
                <TabsTrigger value="sistema" className="gap-1.5">
                  <Link2 className="h-3.5 w-3.5" />Integração e sistema
                </TabsTrigger>
              </TabsList>

              <TabsContent value="desempenho" className="space-y-4 mt-4">
                {/* O alerta abre a aba padrão de propósito: é dinheiro saindo, e
                    dentro de uma aba secundária ninguém o encontraria. */}
                <GastoSemLead custo={dados.custo} />
                <PorAcolhedor itens={dados.por_acolhedor || []} ativo={acolhedor} onEscolher={setAcolhedor} />
                <DesempenhoPorConjunto itens={dados.desempenho_por_conjunto || []} />
                {inv?.disponivel && inv.contas.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-sm">Contas de anúncio</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {inv.contas.map((c) => (
                          <div key={c.conta} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{c.conta}</span>
                            <span className="tabular-nums shrink-0">{brl(c.valor)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="evolucao" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Dia a dia</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Barras: leads de anúncio e fechamentos por dia. Linha: investimento do dia.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[320px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={dados.serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="dia" tickFormatter={diaCurto} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                          <YAxis yAxisId="q" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />
                          <Tooltip
                            formatter={(v: any, nome: any) => (nome === 'Investido' ? brl(Number(v)) : num(Number(v)))}
                            labelFormatter={(l) => `Dia ${diaCurto(String(l))}`}
                          />
                          <Legend />
                          <Bar yAxisId="q" dataKey="leads_pagos" name="Leads de anúncio" fill="hsl(var(--primary))" fillOpacity={0.55} radius={[3, 3, 0, 0]} />
                          <Bar yAxisId="q" dataKey="fechamentos" name="Fechamentos" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                          <Line yAxisId="r" type="monotone" dataKey="investido" name="Investido" stroke="#f59e0b" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
                <div className="grid gap-4 lg:grid-cols-2">
                  <FunilPago f={dados.funil_pago} dias={dados.janela.dias} />
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-sm">Funil por status (todos os leads do período)</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {Object.entries(dados.funil_por_status || {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">{ROTULO_STATUS[k] || k}</span>
                            <span className="tabular-nums">{num(v)}</span>
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Ranking titulo="Leads por origem" itens={dados.leads.por_fonte.slice(0, 8)} />
                  <Ranking titulo="Leads por funil" itens={dados.leads.por_board.slice(0, 8)} />
                </div>
              </TabsContent>

              <TabsContent value="sistema" className="space-y-4 mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Link2 className="h-4 w-4" />Saúde da integração com a Meta
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Configuração da conta, não medição do período — não segue os filtros acima.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-2.5">
                      {!dados.integracao?.disponivel ? (
                        <p className="text-sm text-muted-foreground">
                          Não consegui ler a conta de anúncio agora{dados.integracao?.erro ? `: ${dados.integracao.erro}` : '.'}
                        </p>
                      ) : (
                        <>
                          <Passo
                            ok={(dados.capi.sent || 0) > 0}
                            texto="Conversões chegando à Meta"
                            detalhe={`${num(dados.capi.sent || 0)} aceitas`}
                          />
                          <Passo
                            ok={(dados.capi.aceitos_com_lead_id || 0) > 0}
                            texto="Conversões com o id do lead da Meta"
                            detalhe={`${num(dados.capi.aceitos_com_lead_id || 0)} de ${num(dados.capi.sent || 0)} — é o que casa a venda com o formulário do anúncio`}
                          />
                          <Passo
                            ok={(dados.integracao.conjuntos_otimizando_conversao || 0) > 0}
                            texto="Conjuntos otimizando por conversão"
                            detalhe={`${num(dados.integracao.conjuntos_otimizando_conversao || 0)} de ${num(dados.integracao.conjuntos_ativos || 0)} ativos — trocar em "Leads com conversão" no Gerenciador`}
                          />
                          <p className="text-xs text-muted-foreground pt-2 border-t">
                            Enquanto o último item não estiver marcado, a Meta recebe as conversões mas continua
                            comprando lead por volume, não por quem fecha contrato.
                          </p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4" />Conversões enviadas à Meta</CardTitle>
                      <p className="text-xs text-muted-foreground">Fila inteira, desde o início — não segue os filtros.</p>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {[
                        ['sent', 'Aceitas pela Meta'],
                        ['pending', 'Na fila'],
                        ['skipped', 'Ignoradas (sem contato ou sem valor)'],
                        ['failed', 'Recusadas'],
                      ].map(([k, rot]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{rot}</span>
                          <Badge variant={k === 'failed' && (dados.capi[k] || 0) > 0 ? 'destructive' : 'secondary'} className="tabular-nums">
                            {num(dados.capi[k] || 0)}
                          </Badge>
                        </div>
                      ))}
                      <div className="pt-2 border-t space-y-1">
                        {Object.entries(dados.capi.motivos_ignorado || {}).map(([motivo, qtd]) => (
                          <p key={motivo} className="text-xs text-muted-foreground">
                            {num(qtd as number)} — {motivo}
                          </p>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          Ignorada não é erro de envio: é lead fechado que a Meta descartaria. É lista de conserto.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <Rotinas itens={dados.rotinas || []} />
              </TabsContent>
            </Tabs>


            <p className="text-xs text-muted-foreground text-center">
              Gerado em {new Date(dados.gerado_em).toLocaleString('pt-BR')}
              {filtrado && ' · com filtros aplicados'}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
