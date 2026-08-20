// =============================================================================
// Jurimetria — a tabela que alimenta a carteira, aberta para conferência.
//
// É a aba Tab. Aux da planilha (`jm_partes`), dentro do sistema: filtrar,
// conferir e baixar CSV sem abrir o Google Sheets.
//
// O QUE ESTES NÚMEROS SÃO: as colunas CJCM já vêm **com juros e correção
// monetária** aplicados pela planilha. Não são nominais. A tela diz isso em
// cima da tabela porque somar ou corrigir isso de novo já deu erro nesta base.
// =============================================================================
import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTabelaJurimetria } from '@/hooks/useTabelaJurimetria';
import {
  filtrar, totalizar, opcoes, gerarCsv, honorarioDaLinha,
  FILTRO_VAZIO, type FiltroTabela,
} from '@/lib/tabelaJurimetria';
import { Search, Download, RefreshCw, Table2, X } from 'lucide-react';
import { toast } from 'sonner';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cel = (v: number | null) =>
  v == null ? <span className="text-muted-foreground">—</span> : brl(v);
const dataBr = (d: string | null) =>
  d ? d.slice(0, 10).split('-').reverse().join('/') : '—';

/** "Todos" precisa de um valor não-vazio: SelectItem com value="" quebra o Radix. */
const TODOS = '__todos__';

export default function JurimetriaTabelaPage() {
  const { linhas, carregando, erro, recarregar } = useTabelaJurimetria();
  const [filtro, setFiltro] = useState<FiltroTabela>(FILTRO_VAZIO);

  const visiveis = useMemo(() => filtrar(linhas, filtro), [linhas, filtro]);
  const totais = useMemo(() => totalizar(visiveis), [visiveis]);
  const listaStatus = useMemo(() => opcoes(linhas, 'status'), [linhas]);
  const listaFases = useMemo(() => opcoes(linhas, 'fase'), [linhas]);
  const listaUf = useMemo(() => opcoes(linhas, 'uf'), [linhas]);

  const temFiltro = filtro.busca !== '' || filtro.status || filtro.fase || filtro.uf || filtro.valor;

  const baixar = () => {
    const csv = gerarCsv(visiveis);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `carteira-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${visiveis.length} linha(s) baixada(s)`);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Jurimetria — tabela da carteira</h1>
            <p className="text-xs text-muted-foreground">
              É a aba Tab. Aux da planilha. Valores <strong>CJCM</strong> já vêm com juros e
              correção — não são nominais.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={recarregar} disabled={carregando}>
            <RefreshCw className={`h-4 w-4 mr-1 ${carregando ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
          <Button size="sm" onClick={baixar} disabled={!visiveis.length}>
            <Download className="h-4 w-4 mr-1" /> Baixar CSV
          </Button>
        </div>
      </div>

      {/* Totais do que está FILTRADO, não da base inteira — o número tem que
          responder ao filtro, senão o usuário compara maçã com laranja. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Partes</p>
          <p className="text-lg font-bold tabular-nums">{totais.partes.toLocaleString('pt-BR')}</p>
          <p className="text-[11px] text-muted-foreground">{totais.comValor.toLocaleString('pt-BR')} com valor</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Condenação</p>
          <p className="text-lg font-bold tabular-nums text-indigo-700">{brl(totais.condenacao)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Do cliente</p>
          <p className="text-lg font-bold tabular-nums text-sky-700">{brl(totais.cota)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Do escritório</p>
          <p className="text-lg font-bold tabular-nums text-green-700">{brl(totais.honorario)}</p>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar parte, cliente, processo, cidade…"
            value={filtro.busca}
            onChange={e => setFiltro(f => ({ ...f, busca: e.target.value }))}
          />
        </div>
        <Select
          value={filtro.status ?? TODOS}
          onValueChange={v => setFiltro(f => ({ ...f, status: v === TODOS ? null : v }))}
        >
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todo status</SelectItem>
            {listaStatus.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filtro.fase ?? TODOS}
          onValueChange={v => setFiltro(f => ({ ...f, fase: v === TODOS ? null : v }))}
        >
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Fase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Toda fase</SelectItem>
            {listaFases.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filtro.uf ?? TODOS}
          onValueChange={v => setFiltro(f => ({ ...f, uf: v === TODOS ? null : v }))}
        >
          <SelectTrigger className="w-[110px]"><SelectValue placeholder="UF" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Toda UF</SelectItem>
            {listaUf.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filtro.valor ?? TODOS}
          onValueChange={v => setFiltro(f => ({ ...f, valor: v === TODOS ? null : (v as 'com' | 'sem') }))}
        >
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Valor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Com e sem valor</SelectItem>
            <SelectItem value="com">Só com valor</SelectItem>
            <SelectItem value="sem">Só sem valor</SelectItem>
          </SelectContent>
        </Select>
        {temFiltro && (
          <Button size="sm" variant="ghost" onClick={() => setFiltro(FILTRO_VAZIO)}>
            <X className="h-4 w-4 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {erro && (
        <Card className="border-destructive"><CardContent className="p-3">
          <p className="text-sm text-destructive">Erro ao carregar: {erro}</p>
        </CardContent></Card>
      )}

      <Card>
        <CardContent className="p-0">
          {carregando ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : !visiveis.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {linhas.length ? 'Nenhuma parte com esses filtros.' : 'Nenhuma parte na tabela.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="p-2 font-medium">Parte</th>
                    <th className="p-2 font-medium">Processo</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium whitespace-nowrap">Termo inicial</th>
                    <th className="p-2 font-medium text-right whitespace-nowrap">Condenação</th>
                    <th className="p-2 font-medium text-right whitespace-nowrap">Do cliente</th>
                    <th className="p-2 font-medium text-right whitespace-nowrap">Já venceu</th>
                    <th className="p-2 font-medium text-right whitespace-nowrap">HC vencido</th>
                    <th className="p-2 font-medium text-right whitespace-nowrap">HC a vencer</th>
                    <th className="p-2 font-medium text-right">HS</th>
                    <th className="p-2 font-medium text-right whitespace-nowrap">Nosso total</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(l => (
                    <tr key={l.parteId} className="border-t hover:bg-muted/30">
                      <td className="p-2">
                        <p className="font-medium truncate max-w-[220px]">{l.cliente || l.parteId}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {l.parteId}{l.fase && ` · ${l.fase}`}
                        </p>
                      </td>
                      <td className="p-2 text-xs whitespace-nowrap">
                        {l.processo || '—'}
                        {(l.cidade || l.uf) && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                            {[l.cidade, l.uf].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="p-2">
                        {l.status
                          ? <Badge variant="outline" className="text-[10px] whitespace-nowrap">{l.status}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="p-2 text-xs tabular-nums whitespace-nowrap">{dataBr(l.termoInicial)}</td>
                      <td className="p-2 text-right tabular-nums font-medium whitespace-nowrap">{cel(l.condenacao)}</td>
                      <td className="p-2 text-right tabular-nums text-sky-700 whitespace-nowrap">{cel(l.cota)}</td>
                      <td className="p-2 text-right tabular-nums text-xs whitespace-nowrap">{cel(l.cotaVista)}</td>
                      <td className="p-2 text-right tabular-nums text-xs whitespace-nowrap">{cel(l.hcVista)}</td>
                      <td className="p-2 text-right tabular-nums text-xs whitespace-nowrap">{cel(l.hcParcelado)}</td>
                      <td className="p-2 text-right tabular-nums text-xs whitespace-nowrap">{cel(l.hs)}</td>
                      <td className="p-2 text-right tabular-nums text-green-700 font-medium whitespace-nowrap">
                        {brl(honorarioDaLinha(l))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground leading-snug">
        A condenação é o processo inteiro: a cota do cliente mais a nossa fatia. <strong>Não some
        com o honorário recebido</strong> — aquele é caixa realizado, este é direito. “Já venceu” é a
        parte da pensão que virou pagamento à vista; o que falta continua vencendo mês a mês.
      </p>
    </div>
  );
}
