// =============================================================================
// Tabela de valores da jurimetria — painel de baixo pra cima na ficha.
//
// Pedido do Raym (29/08/2026): "cadê a mudança da tabela da jurimetria de
// valores aqui, para saber qual ele mudou automaticamente — abrir tipo uma aba
// de cima para baixo com a tabela dos valores".
//
// Mostra (1) o que a carteira usa hoje por cliente e (2) os lançamentos de
// jm_valores, com a auditoria da correção automática: valor anterior riscado →
// atual, quando corrigiu (corrigido_em) e por qual peça (corrigido_por_leitura
// → jm_documento_leitura → jm_documentos.titulo). Nada aqui edita — é o
// retrato auditável do número que entra na carteira.
// =============================================================================
import { useEffect, useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wand2 } from 'lucide-react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import type { ClienteConferido, ValorJm, DecisaoJm } from '@/hooks/useConferenciaProcesso';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: string | null | undefined) => {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

const num = (v: number | null | undefined) => Number(v ?? 0) || 0;

/** Valor com auditoria: anterior riscado → atual quando a correção mexeu nele. */
function ValorAuditado({ atual, anterior, corrigido }: {
  atual: number | null; anterior: number | null; corrigido: boolean;
}) {
  const mudou = corrigido && anterior != null && Math.abs(num(anterior) - num(atual)) > 0.005;
  return (
    <span className="whitespace-nowrap">
      {mudou && <span className="mr-1 text-muted-foreground line-through">{brl(num(anterior))}</span>}
      <span className={mudou ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}>{brl(num(atual))}</span>
    </span>
  );
}

export function JurimetriaValoresDrawer({ aberto, onOpenChange, cnj, carregando, clientes, valores, decisoes }: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  cnj: string;
  carregando: boolean;
  clientes: ClienteConferido[];
  valores: ValorJm[];
  decisoes: DecisaoJm[];
}) {
  /** corrigido_por_leitura → título da peça que causou a correção. */
  const [pecaDaLeitura, setPecaDaLeitura] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!aberto) return;
    const leituraIds = [...new Set(valores.map(v => v.corrigido_por_leitura).filter((x): x is number => x != null))];
    if (leituraIds.length === 0) return;
    let cancelado = false;
    (async () => {
      await ensureExternalSession().catch(() => {});
      const { data: leituras } = await (externalSupabase
        .from('jm_documento_leitura')
        .select('id, documento_id')
        .in('id', leituraIds) as unknown as Promise<{ data: { id: number; documento_id: number }[] | null }>);
      if (cancelado || !leituras?.length) return;
      const { data: docs } = await (externalSupabase
        .from('jm_documentos')
        .select('id, titulo')
        .in('id', leituras.map(l => l.documento_id)) as unknown as Promise<{ data: { id: number; titulo: string | null }[] | null }>);
      if (cancelado) return;
      const tituloDoc = new Map((docs || []).map(d => [d.id, d.titulo || `peça #${d.id}`]));
      const mapa: Record<number, string> = {};
      for (const l of leituras) mapa[l.id] = tituloDoc.get(l.documento_id) || `peça #${l.documento_id}`;
      setPecaDaLeitura(mapa);
    })();
    return () => { cancelado = true; };
  }, [aberto, valores]);

  const dataDaDecisao = (decId: string | null) =>
    decisoes.find(d => d.dec_id === decId)?.data_decisao ?? null;

  const totalCarteira = clientes.reduce((s, c) => s + c.valor, 0);

  return (
    <Drawer open={aberto} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-sm">Valores da jurimetria</DrawerTitle>
          <DrawerDescription className="text-xs">
            {cnj} — os números que a carteira usa, com a auditoria do que foi corrigido automaticamente.
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-3 overflow-y-auto px-4 pb-6">
          {carregando ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" />
              Carregando a jurimetria…
            </div>
          ) : clientes.length === 0 && valores.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum valor lançado na jurimetria para este CNJ — na carteira ele entra como projetado.
            </p>
          ) : (
            <>
              {/* 1. O que a carteira usa hoje, por cliente */}
              {clientes.length > 0 && (
                <section className="rounded-lg border">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      O que a carteira usa hoje
                    </span>
                    <span className="text-xs font-semibold">{brl(totalCarteira)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-1.5 text-left">Cliente</th>
                          <th className="px-2 py-1.5 text-right">Dano moral</th>
                          <th className="px-2 py-1.5 text-right">Dano estético</th>
                          <th className="px-2 py-1.5 text-right">Líquido</th>
                          <th className="px-2 py-1.5 text-right">Corrigido</th>
                          <th className="px-2 py-1.5 text-left">Decisão usada</th>
                          <th className="px-2 py-1.5 text-left">Estágio</th>
                          <th className="px-3 py-1.5 text-right">Pago</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {clientes.map((c, i) => (
                          <tr key={i}>
                            <td className="max-w-40 truncate px-3 py-1.5 font-medium" title={c.cliente}>{c.cliente}</td>
                            <td className="px-2 py-1.5 text-right">{brl(c.danoMoral)}</td>
                            <td className="px-2 py-1.5 text-right">{brl(c.danoEstetico)}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{brl(c.valor)}</td>
                            <td className="px-2 py-1.5 text-right">{brl(c.valorAtualizado)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{dataBR(c.decisaoUsada?.data_decisao)}</td>
                            <td className="px-2 py-1.5"><Badge variant="secondary" className="px-1 py-0 text-[9px]">{c.estagio}</Badge></td>
                            <td className="px-3 py-1.5 text-right">{brl(c.pago)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* 2. Lançamentos com auditoria da correção automática */}
              {valores.length > 0 && (
                <section className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Lançamentos (jm_valores) — {valores.length}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-1.5 text-left">Cliente</th>
                          <th className="px-2 py-1.5 text-left">Decisão</th>
                          <th className="px-2 py-1.5 text-right">Dano moral</th>
                          <th className="px-2 py-1.5 text-right">Dano estético</th>
                          <th className="px-3 py-1.5 text-left">Correção automática</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {valores.map(v => {
                          const corrigido = !!v.corrigido_em;
                          const peca = v.corrigido_por_leitura != null ? pecaDaLeitura[v.corrigido_por_leitura] : null;
                          return (
                            <tr key={v.id} className={corrigido ? 'bg-amber-500/5' : undefined}>
                              <td className="max-w-40 truncate px-3 py-1.5 font-medium" title={v.cliente ?? ''}>{v.cliente ?? '—'}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{dataBR(dataDaDecisao(v.dec_id))}</td>
                              <td className="px-2 py-1.5 text-right">
                                <ValorAuditado atual={v.dano_moral} anterior={v.dano_moral_anterior} corrigido={corrigido} />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <ValorAuditado atual={v.dano_estetico} anterior={v.dano_estetico_anterior} corrigido={corrigido} />
                              </td>
                              <td className="px-3 py-1.5">
                                {corrigido ? (
                                  <span className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400" title={peca ? `Corrigido pela leitura da peça "${peca}"` : undefined}>
                                    <Wand2 className="h-3 w-3 shrink-0" />
                                    em {dataBR(v.corrigido_em)}{peca ? ` · pela peça "${peca}"` : ''}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
