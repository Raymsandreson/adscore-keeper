// =============================================================================
// "Por que este marco?" — a matéria prima por trás de uma linha da trilha.
//
// O Raym, em 27/08/2026, olhando a Conferência do processo:
//   "eu acho que o datajud pode estar mais atrapalhando que ajudando; aqui
//    poderia também consultar que movimentação do datajud ele usou para
//    identificar que passou por aquele marco".
//
// A trilha dizia "Decisão TST / STJ · DataJud · 19/05/2026" e parava aí. Sem a
// linha que gerou o marco, "o DataJud atrapalha" é palpite dos dois lados — nem
// dá para provar, nem para desmentir. Este diálogo abre a prova.
//
// O QUE ELE MOSTRA, nesta ordem:
//   1. Quem venceu — todas as fontes que apontam este marco, com a data de cada
//      uma e a regra de prioridade que decidiu o empate. É aqui que a divergência
//      entre DataJud e Escavador fica visível em vez de invisível.
//   2. A regra — o código TPU, o regex de título, o padrão de texto.
//   3. O que casou com a regra, linha a linha, com a que ditou a data marcada.
//   4. A peça, para abrir e para PERGUNTAR.
//
// Nada aqui grava nada. Se a evidência não sustenta o marco, o conserto é na
// regra (Detecção do POP) ou na peça — não nesta tela.
// =============================================================================
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, FileText, Paperclip, ScrollText } from 'lucide-react';
import { useMarcoEvidencia, type FonteCandidata } from '@/hooks/useMarcoEvidencia';
import { FONTE_LABEL } from '@/hooks/useProcessoMarcos';
import { PerguntarAPecaBox } from './PerguntarAPecaBox';
import type { PecaDoProcesso } from '@/lib/pecasDoProcesso';

const dataBR = (d: string | null | undefined) => {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

const GRAU_LABEL: Record<string, string> = { G1: '1º grau', G2: '2º grau', SUP: 'instância superior' };

const fonteLabel = (f: string | null | undefined) =>
  (f && (FONTE_LABEL[f] || f)) || 'sem fonte';

/** `{"nome": "x"}` vira "x" — complemento do TPU é ruído em JSON e frase em texto. */
function Bloco({ titulo, contagem, children }: {
  titulo: string; contagem?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
        {contagem && <span className="text-[10px] text-muted-foreground">{contagem}</span>}
      </div>
      <div className="space-y-1.5 p-2.5">{children}</div>
    </section>
  );
}

/** A linha que ditou a data ganha selo; as outras ficam em cinza, mas ficam. */
function Usou({ usado }: { usado: boolean }) {
  return usado ? (
    <Badge className="shrink-0 bg-primary text-[9px] hover:bg-primary">usou esta</Badge>
  ) : null;
}

export interface AlvoEvidencia {
  processId: string;
  marcoChave: string;
  rotulo: string;
}

interface Props {
  alvo: AlvoEvidencia | null;
  onClose: () => void;
  /** As peças dos autos já carregadas pela conferência — para abrir sem recarregar. */
  pecas: PecaDoProcesso[];
  onAbrirPeca: (peca: PecaDoProcesso, rotulo: string) => void;
  /**
   * A peça que a trilha casou POR DATA. Entra quando a regra do marco não casou
   * peça nenhuma: sem ela, o marco detectado por movimento ficaria sem nada para
   * perguntar, que é justamente o caso em que a dúvida é maior.
   */
  pecaDoMarco?: PecaDoProcesso | null;
}

export function MarcoEvidenciaDialog({ alvo, onClose, pecas, onAbrirPeca, pecaDoMarco }: Props) {
  const { evidencia, loading, erro } = useMarcoEvidencia(alvo?.processId ?? null, alvo?.marcoChave ?? null);
  const [perguntando, setPerguntando] = useState<number | null>(null);

  /** Peças com arquivo em casa: são as que dá para abrir e perguntar. */
  const perguntaveis = useMemo(() => {
    const daRegra = (evidencia?.documento.linhas ?? [])
      .filter(l => l.tem_arquivo)
      .map(l => ({ id: l.documento_id, titulo: l.titulo }));
    if (pecaDoMarco?.storagePath && !daRegra.some(d => d.id === pecaDoMarco.id)) {
      daRegra.push({ id: pecaDoMarco.id, titulo: pecaDoMarco.titulo });
    }
    return daRegra;
  }, [evidencia, pecaDoMarco]);

  const divergem = useMemo(() => {
    const datas = new Set((evidencia?.candidatas ?? []).map(c => c.data).filter(Boolean));
    return datas.size > 1;
  }, [evidencia]);

  const abrirDocumento = (documentoId: number, titulo: string | null) => {
    const p = pecas.find(x => x.id === documentoId);
    if (p) onAbrirPeca(p, titulo || 'Peça dos autos');
  };

  return (
    <Dialog open={!!alvo} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Por que este marco</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {alvo?.rotulo}
            {evidencia?.marco.data_detectada && <> · marcado em {dataBR(evidencia.marco.data_detectada)}</>}
            {evidencia?.marco.fonte && <> · por {fonteLabel(evidencia.marco.fonte)}</>}
          </p>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : erro || evidencia?.erro ? (
          <p className="text-sm text-destructive">{erro || evidencia?.erro}</p>
        ) : !evidencia ? null : (
          <div className="space-y-2.5">
            {!evidencia.marco.cadastrado_no_pop && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Este marco está gravado no processo, mas não existe mais no POP. A carteira o ignora
                  — e a régua não tem como recalculá-lo enquanto a chave não voltar.
                </span>
              </div>
            )}

            {/* 1. Quem venceu, e por quê */}
            <Bloco titulo="Fontes que apontam este marco" contagem={`${evidencia.candidatas.length}`}>
              {evidencia.candidatas.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma fonte casa com a regra deste marco hoje. Ele foi detectado numa captura
                  anterior e a régua só o apagaria no próximo recálculo — ou a regra mudou depois.
                </p>
              ) : (
                <>
                  {evidencia.candidatas.map((c: FonteCandidata) => (
                    <div key={c.fonte} className="flex items-center gap-2 text-xs">
                      {c.venceu
                        ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        : <span className="h-3.5 w-3.5 shrink-0" />}
                      <span className={`min-w-0 flex-1 truncate ${c.venceu ? 'font-medium' : 'text-muted-foreground'}`}>
                        {fonteLabel(c.fonte)}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        casou {c.casou}×
                      </span>
                      <span className="w-20 shrink-0 text-right">{dataBR(c.data)}</span>
                    </div>
                  ))}
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {divergem
                      ? 'As fontes discordam da data. Vence a de menor prioridade numérica — movimento e peça (1) na frente de Escavador e e-mail (2), e a capa (3) por último. Dentro de uma fonte, vale a MENOR data entre as que casaram.'
                      : 'Vence a fonte de menor prioridade numérica — movimento e peça (1), Escavador e e-mail (2), capa (3). Dentro de uma fonte, vale a MENOR data entre as que casaram.'}
                  </p>
                </>
              )}
            </Bloco>

            {/* 2. A regra */}
            <Bloco titulo="A regra que reconhece este marco" contagem={`${evidencia.regras.length}`}>
              {evidencia.regras.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma regra cadastrada. Marco sem sinal só nasce da capa do processo.
                </p>
              ) : evidencia.regras.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge variant="outline" className="text-[9px]">{r.tipo}</Badge>
                  {r.codigo != null && (
                    <span>código TPU <span className="font-mono font-medium">{r.codigo}</span></span>
                  )}
                  {r.grau && <span className="text-muted-foreground">{GRAU_LABEL[r.grau] || r.grau}</span>}
                  {r.padrao && <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{r.padrao}</code>}
                  {r.padrao_excluir && (
                    <span className="text-muted-foreground">
                      exceto <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{r.padrao_excluir}</code>
                    </span>
                  )}
                  {r.complemento_pattern && (
                    <span className="text-muted-foreground">complemento “{r.complemento_pattern}”</span>
                  )}
                  {!r.confirmado && (
                    <Badge variant="outline" className="border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                      não calibrada
                    </Badge>
                  )}
                </div>
              ))}
            </Bloco>

            {/* O bloco do DataJud saiu em 02/09/2026: a régua não lê mais o
                DataJud (decisão do usuário — "só faz zoada"). Ficam peças,
                Escavador, e-mail e capa. */}
            {/* 4. Peças */}
            {evidencia.documento.total > 0 && (
              <Bloco
                titulo="Peças dos autos que casaram"
                contagem={`${evidencia.documento.total} de ${evidencia.cobertura.documentos} no processo`}
              >
                {evidencia.documento.linhas.map(d => (
                  <div
                    key={d.documento_id}
                    className={`flex items-center gap-2 text-[11px] ${d.usado ? '' : 'opacity-70'}`}
                  >
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{d.titulo || '(sem título)'}</span>
                    {d.oculta_em && (
                      <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                        desvinculada, mas ainda conta
                      </Badge>
                    )}
                    {d.tem_arquivo && pecas.some(p => p.id === d.documento_id) && (
                      <button
                        type="button"
                        onClick={() => abrirDocumento(d.documento_id, d.titulo)}
                        className="inline-flex shrink-0 items-center gap-1 underline underline-offset-2 hover:text-foreground"
                      >
                        <Paperclip className="h-3 w-3" /> ver
                      </button>
                    )}
                    <Usou usado={d.usado} />
                    <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(d.data)}</span>
                  </div>
                ))}
              </Bloco>
            )}

            {/* 5. Escavador */}
            {evidencia.escavador.total > 0 && (
              <Bloco
                titulo="Publicações do Escavador que casaram"
                contagem={`${evidencia.escavador.total} de ${evidencia.cobertura.movimentacoes_escavador} no processo`}
              >
                {evidencia.escavador.linhas.map((p, i) => (
                  <div key={i} className={`rounded-md border p-1.5 text-[11px] ${p.usado ? 'bg-muted/40' : 'opacity-70'}`}>
                    <div className="flex items-start gap-2">
                      <ScrollText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 font-medium">{p.classe || '(sem classe)'}</span>
                      {p.via === 'escavador_grau' && (
                        <Badge variant="outline" className="shrink-0 text-[9px]">só pelo grau</Badge>
                      )}
                      <Usou usado={p.usado} />
                      <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(p.data)}</span>
                    </div>
                    {p.conteudo && (
                      <p className="pl-5 leading-snug text-muted-foreground">
                        {p.conteudo}{p.cortado && '…'}
                      </p>
                    )}
                  </div>
                ))}
              </Bloco>
            )}

            {/* 6. E-mail do INSS */}
            {evidencia.email.total > 0 && (
              <Bloco titulo="E-mails do INSS que casaram" contagem={`${evidencia.email.total}`}>
                {evidencia.email.linhas.map((e, i) => (
                  <div key={i} className={`text-[11px] ${e.usado ? '' : 'opacity-70'}`}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{e.evento || '(sem evento)'}</span>
                      {e.status && <span className="shrink-0 text-muted-foreground">{e.status}</span>}
                      <Usou usado={e.usado} />
                      <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(e.data)}</span>
                    </div>
                    {e.despacho && <p className="leading-snug text-muted-foreground">{e.despacho}</p>}
                  </div>
                ))}
              </Bloco>
            )}

            {/* 7. Capa */}
            {evidencia.capa?.data && (
              <Bloco titulo="Capa do processo">
                <p className="text-[11px] text-muted-foreground">
                  Distribuição {dataBR(evidencia.capa.data_distribuicao)} · início{' '}
                  {dataBR(evidencia.capa.data_inicio)}. A capa só vale para o ajuizamento, e só quando
                  nenhuma movimentação o encontrou — ela não envelhece, a janela de movimentações sim.
                </p>
              </Bloco>
            )}

            {/* 8. Perguntar à peça */}
            {perguntaveis.length > 0 && (
              <Bloco titulo="Perguntar à peça">
                {perguntaveis.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {perguntaveis.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPerguntando(p.id)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          (perguntando ?? perguntaveis[0].id) === p.id
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'}`}
                      >
                        {p.titulo || `peça ${p.id}`}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const escolhida = perguntaveis.find(p => p.id === perguntando) ?? perguntaveis[0];
                  return (
                    <PerguntarAPecaBox
                      key={escolhida.id}
                      documentoId={escolhida.id}
                      tituloPeca={escolhida.titulo}
                      marcoChave={evidencia.marco.chave}
                      marcoRotulo={evidencia.marco.rotulo}
                    />
                  );
                })()}
              </Bloco>
            )}

            <p className="text-[11px] leading-snug text-muted-foreground">
              Tudo aqui é leitura da matéria prima — nada é gravado. Se a evidência não sustenta o
              marco, o conserto é na regra (Detecção do POP) ou na peça, não nesta tela.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
