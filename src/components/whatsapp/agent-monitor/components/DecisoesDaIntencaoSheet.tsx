/**
 * O que está POR TRÁS de um número da tabela de intenções.
 *
 * A tabela dizia "Dinheiro ou prazo: 18 vezes, 13 grupos, 18 precisaram de
 * gente" e parava aí. O número é o fim da leitura e o começo do trabalho: quem
 * lê 18 quer saber QUAIS, de quem, o que a pessoa escreveu e o que o atendente
 * virtual fez com aquilo. Até aqui a resposta era abrir a fila ao lado e
 * garimpar.
 *
 * Agora a linha é clicável e o detalhe abre na aba lateral, por cima do
 * relatório — que continua aberto atrás, com o mesmo período selecionado. De
 * dentro daqui, clicar numa decisão empilha a conversa do grupo (painel de
 * baixo pra cima), e fechar devolve a pessoa exatamente onde ela estava.
 * Nenhum passo tira ninguém da tela (skill `ui-sem-redirecionar`).
 *
 * A CONTA E A LISTA SÃO DUAS CONSULTAS
 *
 * A lista traz no máximo 200 linhas — é leitura humana, ninguém rola mais que
 * isso. O total vem do `count: 'exact'` na mesma chamada, então o cabeçalho diz
 * a verdade ("200 das 417") em vez de repetir o teto do `limit` como se fosse
 * o número do banco.
 *
 * O FILTRO VAI AO BANCO, NÃO À MEMÓRIA
 *
 * Filtrar as 200 já carregadas responderia "quantos calaram ENTRE OS 200 mais
 * recentes", que é outra pergunta e não avisa que é outra. Cada chip refaz a
 * consulta com o `decisao` no `where`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, MessagesSquare, TriangleAlert, Inbox } from 'lucide-react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';
import { COR, DECISOES, FAMILIA_DE, rotuloDaIntencao } from '../intencoes';

const dbAny = db as unknown as SupabaseClient;

/** O teto da lista. Acima disto é relatório, não leitura. */
const TETO = 200;

/**
 * O rótulo que a RPC devolve quando `intencao` é nulo. A tabela mostra essa
 * string; aqui ela vira o `is null` do filtro — igualar a string ao banco
 * traria zero linhas e pareceria "não tem nada", quando tem 86.
 */
export const SEM_CLASSIFICACAO = '(sem classificação)';

interface Decisao {
  id: string;
  group_jid: string;
  group_name: string | null;
  decisao: string | null;
  motivo: string | null;
  pergunta: string | null;
  pendente_id: string | null;
  criado_em: string;
}

/** O que a tabela já sabe da intenção, para o cabeçalho não recarregar a conta. */
export interface ResumoDaIntencao {
  total: number;
  grupos: number;
  precisou_gente: number;
  respondeu: number;
  calou: number;
}

const FILTROS: { chave: string | null; rotulo: string }[] = [
  { chave: null, rotulo: 'tudo' },
  { chave: 'humano', rotulo: 'precisou de gente' },
  { chave: 'respondeu', rotulo: 'o Dom respondeu' },
  { chave: 'silencio', rotulo: 'calou' },
  { chave: 'pulou', rotulo: 'pulou' },
];

interface Props {
  /** O código da intenção (`E17`) ou `null` com a aba fechada. */
  intencao: string | null;
  dias: number;
  resumo: ResumoDaIntencao | null;
  onClose: () => void;
}

export function DecisoesDaIntencaoSheet({ intencao, dias, resumo, onClose }: Props) {
  const [linhas, setLinhas] = useState<Decisao[]>([]);
  const [total, setTotal] = useState(0);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** Aba nova, leitura nova: o filtro da intenção anterior não segue junto. */
  useEffect(() => { setFiltro(null); }, [intencao]);

  const carregar = useCallback(async () => {
    if (!intencao) return;
    setCarregando(true);
    setErro(null);
    try {
      await ensureExternalSession();
      const desde = new Date(Date.now() - Math.max(dias, 1) * 24 * 60 * 60 * 1000).toISOString();
      let q = dbAny
        .from('dom_decisoes')
        .select('id, group_jid, group_name, decisao, motivo, pergunta, pendente_id, criado_em', { count: 'exact' })
        .gte('criado_em', desde);
      q = intencao === SEM_CLASSIFICACAO ? q.is('intencao', null) : q.eq('intencao', intencao);
      if (filtro) q = q.eq('decisao', filtro);
      const { data, error, count } = await q.order('criado_em', { ascending: false }).limit(TETO);
      if (error) throw error;
      setLinhas((data as Decisao[]) || []);
      setTotal(count ?? 0);
    } catch (e) {
      // Dizer o que falhou. "Nenhuma decisão" mandaria alguém procurar cliente
      // quieto quando o problema é a consulta.
      setErro((e as Error)?.message || 'não consegui carregar as decisões');
    } finally {
      setCarregando(false);
    }
  }, [intencao, dias, filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  const familia = useMemo(() => (intencao ? FAMILIA_DE(intencao) : 'sem classificação'), [intencao]);

  return (
    <Sheet open={!!intencao} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: COR[familia] }}
              aria-hidden
            />
            {intencao ? rotuloDaIntencao(intencao) : ''}
            {intencao && intencao !== SEM_CLASSIFICACAO && (
              <span className="text-[10px] font-normal text-muted-foreground">{intencao}</span>
            )}
          </SheetTitle>
        </SheetHeader>

        {/* O que a tabela mostrava em cinco colunas cabe aqui numa linha só —
            é por isso que ela pôde ficar com três. */}
        {resumo && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {resumo.total} {resumo.total === 1 ? 'vez' : 'vezes'} em {resumo.grupos}{' '}
            {resumo.grupos === 1 ? 'grupo' : 'grupos'}, nos últimos {dias} dias
            {resumo.precisou_gente > 0 && <> · <span className="text-destructive">{resumo.precisou_gente} precisaram de gente</span></>}
            {resumo.respondeu > 0 && <> · {resumo.respondeu} o Dom respondeu</>}
            {resumo.calou > 0 && <> · {resumo.calou} calou</>}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1">
          {FILTROS.map(f => (
            <Button
              key={f.rotulo}
              size="sm"
              variant={filtro === f.chave ? 'secondary' : 'ghost'}
              className={cn('h-6 px-2 text-[10px]', filtro === f.chave && 'font-medium')}
              onClick={() => setFiltro(f.chave)}
            >
              {f.rotulo}
            </Button>
          ))}
        </div>

        {erro && (
          <div className="mt-3 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        {carregando && (
          <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> carregando…
          </div>
        )}

        {!carregando && !erro && linhas.length === 0 && (
          <p className="py-8 text-center text-[11px] text-muted-foreground">
            Nenhuma decisão com esse filtro nos últimos {dias} dias.
          </p>
        )}

        {!carregando && linhas.length > 0 && (
          <>
            <div className="mt-3 divide-y rounded-md border">
              {linhas.map(d => {
                const dec = DECISOES[d.decisao || ''] || { rotulo: d.decisao || '—', classe: 'text-muted-foreground border-border bg-muted/40' };
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="w-full text-left px-2.5 py-2 hover:bg-muted/50 transition-colors"
                    title="abrir a conversa aqui mesmo"
                    onClick={() => openWhatsAppChatSheet({
                      phone: d.group_jid,
                      contactName: d.group_name,
                      direction: 'bottom',
                      forceSheet: true,
                    })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium flex items-center gap-1.5 min-w-0">
                        <MessagesSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{d.group_name || d.group_jid}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {format(parseISO(d.criado_em), 'dd/MM HH:mm', { locale: ptBR })}
                      </span>
                    </div>
                    {d.pergunta && (
                      <p className="mt-1 text-[11px] text-foreground/80 line-clamp-2">{d.pergunta}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className={cn('rounded border px-1.5 py-0.5 text-[9px]', dec.classe)}>
                        {dec.rotulo}
                      </span>
                      {d.pendente_id && (
                        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground inline-flex items-center gap-1">
                          <Inbox className="h-2.5 w-2.5" /> virou fila
                        </span>
                      )}
                      {d.motivo && (
                        <span className="truncate text-[10px] text-muted-foreground">{d.motivo}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {total > linhas.length
                ? <>Mostrando as {linhas.length} mais recentes de {total}. Clique numa linha para abrir a conversa.</>
                : <>Clique numa linha para abrir a conversa, sem sair daqui.</>}
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
