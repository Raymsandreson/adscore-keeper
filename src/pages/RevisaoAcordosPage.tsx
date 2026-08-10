// =============================================================================
// Revisão dos acordos que a IA leu dentro das atas de audiência.
//
// Por que esta tela existe: acordo homologado em audiência frequentemente não
// gera movimentação nenhuma — só a ata registra. A IA leu as 336 atas baixadas
// e apontou acordo em 27 processos, 6 deles que o catálogo manual não tinha.
// Nada disso vale como marco enquanto uma pessoa não confirmar, porque um falso
// acordo move o processo de estação E reclassifica dinheiro no relatório do fundo.
//
// A lista abre cada acordo em aba lateral (nunca redireciona) e o PDF da ata no
// MediaLightbox (nunca abre página).
// =============================================================================
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { AcordoRevisaoSheet } from '@/components/processual/AcordoRevisaoSheet';
import { useAcordoExtracoes, type AcordoProcesso, type AcordoDados } from '@/hooks/useAcordoExtracoes';
import { AlertTriangle, PanelRightOpen, RefreshCw, Handshake, FileWarning } from 'lucide-react';

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'valor não informado';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(iso: string | null): string {
  if (!iso) return 'sem data';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function Linha({ item, onAbrir }: { item: AcordoProcesso; onAbrir: () => void }) {
  const d = (item.principal.dados || {}) as Partial<AcordoDados>;
  return (
    <button
      type="button"
      onClick={onAbrir}
      title="abrir aqui do lado"
      className="flex w-full items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{item.processo_cnj}</span>
          {d.parcial ? (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertTriangle className="h-3 w-3" /> parcial
            </Badge>
          ) : null}
          {item.apoio.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              {item.apoio.length + 1} atas
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {dataBr(item.principal.data_extraida)} · {moeda(d.valor_total)}
          {d.n_parcelas ? ` em ${d.n_parcelas}x` : ''}
          {d.devedor ? ` · ${d.devedor}` : ''}
        </p>
        {item.principal.trecho ? (
          <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
            “{item.principal.trecho}”
          </p>
        ) : null}
      </div>
      <PanelRightOpen className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Lista({ itens, vazio, onAbrir }: {
  itens: AcordoProcesso[];
  vazio: string;
  onAbrir: (a: AcordoProcesso) => void;
}) {
  if (itens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
        <FileWarning className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{vazio}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {itens.map((i) => (
        <Linha key={i.processo_cnj} item={i} onAbrir={() => onAbrir(i)} />
      ))}
    </div>
  );
}

export default function RevisaoAcordosPage() {
  const { pendentes, aprovados, rejeitados, semPop, loading, erro, recarregar, revisar } = useAcordoExtracoes();
  const [aberto, setAberto] = useState<AcordoProcesso | null>(null);

  return (
    <div className="container mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Handshake className="h-5 w-5" /> Acordos lidos nas atas
            </CardTitle>
            <CardDescription>
              Todos os acordos lidos nas atas, de qualquer POP. O caminho normal é o
              editor do POP, na seção <b>Marcos do POP</b> — esta tela existe para ver
              tudo de uma vez, inclusive processo que não está em POP nenhum.
              {semPop > 0 ? (
                <>
                  {' '}
                  <span className="text-amber-600 dark:text-amber-500">
                    {semPop} processo(s) com acordo não estão cadastrados no CRM e por isso
                    não aparecem em nenhum POP.
                  </span>
                </>
              ) : null}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => void recarregar()}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {erro ? (
            <p className="text-sm text-destructive">Erro ao carregar: {erro}</p>
          ) : loading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <Tabs defaultValue="pendentes">
              <TabsList>
                <TabsTrigger value="pendentes">A revisar ({pendentes.length})</TabsTrigger>
                <TabsTrigger value="confirmados">Confirmados ({aprovados.length})</TabsTrigger>
                <TabsTrigger value="rejeitados">Rejeitados ({rejeitados.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="pendentes" className="mt-3">
                <Lista itens={pendentes} onAbrir={setAberto} vazio="Nada pendente de revisão." />
              </TabsContent>
              <TabsContent value="confirmados" className="mt-3">
                <Lista itens={aprovados} onAbrir={setAberto} vazio="Nenhum acordo confirmado ainda." />
              </TabsContent>
              <TabsContent value="rejeitados" className="mt-3">
                <Lista itens={rejeitados} onAbrir={setAberto} vazio="Nenhum rejeitado." />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <AcordoRevisaoSheet
        acordo={aberto}
        onOpenChange={(open) => { if (!open) setAberto(null); }}
        onRevisado={revisar}
      />
    </div>
  );
}
