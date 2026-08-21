import { useState } from 'react';
import { useDialQueue, DialQueueFilters, DialLead } from '@/hooks/useDialQueue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, RefreshCw, Copy, PhoneOutgoing, AlertTriangle, Inbox, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { exibirTelefone, hrefTel } from '@/lib/dial';

/**
 * CSV com `;` e BOM: é o que o Excel em pt-BR e o Google Sheets abrem sem
 * pedir assistente de importação. O `lead_id` vai junto de propósito — se um dia
 * a Callface devolver um identificador nosso no webhook (hoje o `deal_id` chega
 * vazio em 100% das chamadas), a ligação volta já colada no lead.
 */
function montarCsv(leads: DialLead[]): string {
  const escapar = (v: unknown) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecalho = ['nome', 'telefone', 'lead_id', 'board', 'origem', 'chegou_em'];
  const linhas = leads.map((l) =>
    [
      l.lead_name || '',
      l.telefone,
      l.id,
      l.board_name,
      l.source || '',
      format(new Date(l.created_at), 'dd/MM/yyyy'),
    ]
      .map(escapar)
      .join(';'),
  );
  return '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n');
}

function baixar(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DialQueueTab() {
  const [filtros, setFiltros] = useState<DialQueueFilters>({
    boardId: 'all',
    source: 'all',
    dias: 30,
    esconderJaLigados: true,
  });
  const { leads, boards, sources, loading, truncado, descartadosPorLigacao, refetch } = useDialQueue(filtros);

  const set = <K extends keyof DialQueueFilters>(k: K, v: DialQueueFilters[K]) =>
    setFiltros((f) => ({ ...f, [k]: v }));

  const exportar = () => {
    if (leads.length === 0) {
      toast.error('Nada para exportar');
      return;
    }
    baixar(`fila-discagem-${format(new Date(), 'yyyy-MM-dd')}.csv`, montarCsv(leads));
    toast.success(`${leads.length} número${leads.length !== 1 ? 's' : ''} exportado${leads.length !== 1 ? 's' : ''}`);
  };

  const copiarNumeros = async () => {
    if (leads.length === 0) {
      toast.error('Nada para copiar');
      return;
    }
    await navigator.clipboard.writeText(leads.map((l) => l.telefone).join('\n'));
    toast.success(`${leads.length} número${leads.length !== 1 ? 's' : ''} na área de transferência`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Quadro</Label>
          <Select value={filtros.boardId} onValueChange={(v) => set('boardId', v)}>
            <SelectTrigger className="h-9 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quadros</SelectItem>
              {boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Origem</Label>
          <Select value={filtros.source} onValueChange={(v) => set('source', v)}>
            <SelectTrigger className="h-9 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Chegaram nos últimos</Label>
          <Select value={String(filtros.dias)} onValueChange={(v) => set('dias', Number(v))}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="15">15 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex h-9 items-center gap-2">
          <Checkbox
            id="esconder-ligados"
            checked={filtros.esconderJaLigados}
            onCheckedChange={(v) => set('esconderJaLigados', v === true)}
          />
          <Label htmlFor="esconder-ligados" className="text-sm font-normal">
            Esconder quem já recebeu ligação
          </Label>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={copiarNumeros} disabled={loading || leads.length === 0}>
            <Copy className="mr-2 h-3.5 w-3.5" />
            Copiar números
          </Button>
          <Button size="sm" onClick={exportar} disabled={loading || leads.length === 0}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Exportar planilha
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {loading ? (
          'montando a fila…'
        ) : (
          <>
            <PhoneOutgoing className="h-3.5 w-3.5" />
            <span>
              <span className="font-medium text-foreground">{leads.length}</span> número
              {leads.length !== 1 ? 's' : ''} para discar
            </span>
            {descartadosPorLigacao > 0 && <span>• {descartadosPorLigacao} fora por já ter recebido ligação</span>}
          </>
        )}
      </div>

      {truncado && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            A janela escolhida tem mais de 2.000 leads e a lista foi cortada nesse teto. Estreite o período ou o quadro
            para não deixar gente de fora sem perceber.
          </span>
        </div>
      )}

      {!loading && leads.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nenhum lead com telefone discável nesse recorte.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A maior parte dos leads que chegam vem de notícia (<code>google_alerts</code>) e não tem telefone. Tente
              filtrar por origem <code>whatsapp</code> ou por uma planilha.
            </p>
          </CardContent>
        </Card>
      )}

      {leads.length > 0 && (
        <Card>
          <ScrollArea className="max-h-[55vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Quadro</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Chegou</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.lead_name || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {hrefTel(l.telefone) ? (
                        <a href={hrefTel(l.telefone)} className="hover:underline">
                          {exibirTelefone(l.telefone)}
                        </a>
                      ) : (
                        exibirTelefone(l.telefone)
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.board_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {l.source || '—'}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(l.created_at), 'dd/MM/yy', { locale: ptBR })}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {/* `<a href="tel:">` em vez de onClick: entrega o número montado ao
                          discador do aparelho sem a página navegar nem abrir aba. */}
                      <Button asChild size="sm" variant="secondary" className="h-7">
                        <a href={hrefTel(l.telefone)}>
                          <Phone className="mr-1.5 h-3 w-3" />
                          Ligar
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
