/**
 * A fila caso ↔ grupo — passo 1 de "o grupo é o caso" (09/09/2026).
 *
 * POR QUE EXISTE. O Raym quer a palavra "caso" fora das telas: o caso é o
 * grupo do WhatsApp com o mesmo número. Antes de tirar qualquer coisa, os dois
 * lados têm que apontar para o MESMO lead (grupo → lead ← caso). A
 * `vw_caso_grupo_conciliacao` compara cada grupo de caso (PREV/CASO/FAMÍLIA
 * com número no nome) com o legal_case de mesma chave e diz a classe. Aqui a
 * pessoa vê a evidência dos dois lados (qual lead, quantos processos, nº no
 * lead) e resolve com 1 clique onde dá.
 *
 * O QUE ESCREVE. Duas RPCs, nada mais:
 *   · resolver_caso_grupo(grupo, 'ligar_ao_lead_do_caso') — ponte grupo → lead
 *     do caso (auto_linked = false). A ponte mais nova é a que vale; a antiga
 *     fica e o grupo mostra "2 leads" até alguém juntar os leads.
 *   · casar_caso_grupo() — o lote: só as classes "casável" (um caso com a
 *     chave, lead vivo, nada contradiz). Pede um segundo clique.
 *
 * O QUE NÃO FAZ. Não junta leads, não apaga ponte, não mexe em legal_cases.
 * Classes que precisam de outra tela (caso duplicado, grupo sem lead) só
 * dizem o que fazer e onde.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { invalidateGroupLeadCache } from '@/integrations/supabase/group-lead-links';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Link2, Loader2, AlertTriangle, Users } from 'lucide-react';

const dbAny = db as unknown as SupabaseClient;

/** Uma linha da vw_caso_grupo_conciliacao, só o que a tela usa. */
export interface LinhaCasoGrupo {
  lado: 'grupo' | 'caso';
  group_jid: string | null;
  chave: string | null;
  group_name: string | null;
  fam: string | null;
  numero: number;
  chave_txt: string;
  caso_id: string | null;
  case_number: string | null;
  n_casos: number;
  n_leads_cadastrados: number;
  lead_grupo_id: string | null;
  lead_grupo_nome: string | null;
  lead_grupo_via: 'ponte' | 'cadastro' | null;
  lead_grupo_case_number: string | null;
  lead_grupo_processos: number;
  lead_caso_id: string | null;
  lead_caso_nome: string | null;
  lead_caso_case_number: string | null;
  lead_caso_processos: number;
  classe: string;
  o_que_fazer: string | null;
}

/** Classes que a RPC aceita em "Ligar ao lead do caso" (espelho do resolver_caso_grupo). */
export const LIGAVEIS = new Set([
  'casavel_cadastro_bate', 'casavel_sem_cadastro', 'leads_diferentes',
  'leads_diferentes_no_cadastro', 'lead_do_caso_tem_outro_grupo',
]);
const CASAVEIS = new Set(['casavel_cadastro_bate', 'casavel_sem_cadastro']);
/** Fora da fila por padrão: não é pendência sob "o grupo é o caso". */
const INFORMATIVAS = ['casado', 'lead_sem_caso'];

const CLASSES: Record<string, { rotulo: string }> = {
  casavel_cadastro_bate:           { rotulo: 'só falta a ponte' },
  casavel_sem_cadastro:            { rotulo: 'casável' },
  leads_diferentes:                { rotulo: 'dois leads' },
  leads_diferentes_no_cadastro:    { rotulo: 'dois leads (cadastro)' },
  grupo_com_varios_leads:          { rotulo: 'vários leads no grupo' },
  lead_do_caso_tem_outro_grupo:    { rotulo: 'lead do caso noutro grupo' },
  caso_duplicado:                  { rotulo: 'caso duplicado' },
  caso_sem_lead:                   { rotulo: 'caso sem lead' },
  lead_do_caso_apagado:            { rotulo: 'lead do caso apagado' },
  numero_divergente:               { rotulo: 'número divergente' },
  grupo_sem_lead:                  { rotulo: 'grupo sem lead' },
  grupo_com_varios_leads_sem_caso: { rotulo: 'vários leads, sem caso' },
  grupo_ainda_lead:                { rotulo: 'grupo ainda "LEAD N"' },
  caso_sem_grupo_lead_tem_outro:   { rotulo: 'caso sem grupo (lead noutro)' },
  caso_sem_grupo:                  { rotulo: 'caso sem grupo' },
  lead_sem_caso:                   { rotulo: 'lead sem legal_case' },
  casado:                          { rotulo: 'casado' },
};

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export function FilaCasoGrupoSheet({
  open, onOpenChange, onResolvido,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Chamado a cada ponte criada, para quem abriu recontar. */
  onResolvido?: (quantas: number) => void;
}) {
  const [linhas, setLinhas] = useState<LinhaCasoGrupo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [classe, setClasse] = useState<string>('pendencias');
  const [confirmarLote, setConfirmarLote] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      await ensureExternalSession();
      const { data, error } = await dbAny.from('vw_caso_grupo_conciliacao')
        .select('lado, group_jid, chave, group_name, fam, numero, chave_txt, caso_id, case_number, n_casos, n_leads_cadastrados, '
              + 'lead_grupo_id, lead_grupo_nome, lead_grupo_via, lead_grupo_case_number, lead_grupo_processos, '
              + 'lead_caso_id, lead_caso_nome, lead_caso_case_number, lead_caso_processos, classe, o_que_fazer')
        .not('classe', 'in', `(${INFORMATIVAS.join(',')})`)
        .order('classe')
        .order('numero');
      if (error) throw error;
      setLinhas((data as unknown as LinhaCasoGrupo[]) || []);
    } catch (e) {
      toast.error('Não consegui carregar a conciliação: ' + (e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { if (open) { setConfirmarLote(false); void carregar(); } }, [open, carregar]);

  const contagem = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of linhas) c.set(l.classe, (c.get(l.classe) || 0) + 1);
    return c;
  }, [linhas]);
  const casaveis = useMemo(() => linhas.filter(l => CASAVEIS.has(l.classe)).length, [linhas]);

  const visiveis = useMemo(
    () => (classe === 'pendencias' ? linhas : linhas.filter(l => l.classe === classe)),
    [linhas, classe],
  );

  const ligar = async (l: LinhaCasoGrupo) => {
    if (decidindo || !l.chave) return;
    setDecidindo(l.chave);
    try {
      await ensureExternalSession();
      const { data, error } = await dbAny.rpc('resolver_caso_grupo', {
        p_group_jid: l.chave, p_decisao: 'ligar_ao_lead_do_caso',
      });
      if (error) throw error;
      const r = (data || {}) as { tinha_outro_lead?: boolean };
      toast.success(r.tinha_outro_lead
        ? 'Grupo ligado ao lead do caso. O lead antigo continua no grupo até alguém juntar os dois.'
        : 'Grupo ligado ao lead do caso.');
      invalidateGroupLeadCache(l.chave);
      // A view devolve a linha como "casado" agora — e casado não entra na fila.
      setLinhas(prev => prev.filter(x => x.chave !== l.chave));
      onResolvido?.(1);
    } catch (e) {
      // A RPC recusa com frase de gente ("Não dá para ligar daqui: …"): é essa
      // frase que a pessoa precisa ler.
      toast.error((e as Error).message || 'Não consegui ligar.');
    } finally {
      setDecidindo(null);
    }
  };

  const casarLote = async () => {
    if (decidindo) return;
    setDecidindo('lote');
    try {
      await ensureExternalSession();
      const { data, error } = await dbAny.rpc('casar_caso_grupo');
      if (error) throw error;
      const r = (Array.isArray(data) ? data[0] : data) as { pontes_criadas?: number; deixados_na_fila?: number } | null;
      const n = r?.pontes_criadas ?? 0;
      toast.success(`${plural(n, 'ponte criada', 'pontes criadas')}. ${r?.deixados_na_fila ?? '?'} ficam na fila.`);
      for (const l of linhas) if (CASAVEIS.has(l.classe) && l.chave) invalidateGroupLeadCache(l.chave);
      setLinhas(prev => prev.filter(x => !CASAVEIS.has(x.classe)));
      onResolvido?.(n);
    } catch (e) {
      toast.error((e as Error).message || 'Não consegui casar o lote.');
    } finally {
      setDecidindo(null);
      setConfirmarLote(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Caso ↔ grupo a conciliar
            <Badge variant="secondary">{linhas.length}</Badge>
          </SheetTitle>
          <SheetDescription>
            O grupo é o caso. Cada grupo "PREV N" / "Caso N" / "Família N" tem que apontar para o
            mesmo lead que o caso de número N. Aqui está o que ainda não aponta, com a evidência dos dois lados.
          </SheetDescription>
        </SheetHeader>

        {casaveis > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs">
            <span className="flex-1">
              {plural(casaveis, 'grupo bate', 'grupos batem')} sem contradição (um caso com o número, lead vivo, nenhum outro lead no grupo).
            </span>
            {!confirmarLote ? (
              <Button size="sm" className="h-7 text-xs gap-1" disabled={!!decidindo} onClick={() => setConfirmarLote(true)}>
                <Link2 className="h-3 w-3" /> Ligar os {casaveis}
              </Button>
            ) : (
              <>
                <Button size="sm" className="h-7 text-xs gap-1" disabled={!!decidindo} onClick={casarLote} data-testid="confirmar-lote">
                  {decidindo === 'lote' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                  Confirmar: criar {casaveis} pontes
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!decidindo} onClick={() => setConfirmarLote(false)}>
                  cancelar
                </Button>
              </>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant={classe === 'pendencias' ? 'default' : 'outline'} className="h-7 text-xs"
                  onClick={() => setClasse('pendencias')}>pendências ({linhas.length})</Button>
          {Array.from(contagem.entries()).map(([k, n]) => (
            <Button key={k} size="sm" variant={classe === k ? 'default' : 'outline'} className="h-7 text-xs"
                    onClick={() => setClasse(k)}>
              {CLASSES[k]?.rotulo || k} ({n})
            </Button>
          ))}
        </div>

        {carregando && (
          <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> carregando…
          </p>
        )}
        {!carregando && visiveis.length === 0 && (
          <p className="mt-4 text-xs text-muted-foreground">Nada aqui. Grupo e caso apontam para o mesmo lead em todos.</p>
        )}

        <div className="mt-3 space-y-2">
          {visiveis.map(l => {
            const id = l.chave || l.caso_id || l.chave_txt;
            const ligavel = l.lado === 'grupo' && LIGAVEIS.has(l.classe) && !!l.lead_caso_id;
            const doisLeads = l.lead_grupo_id && l.lead_caso_id && l.lead_grupo_id !== l.lead_caso_id;
            return (
              <Card key={id} data-testid="conciliacao">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">
                        <span className="font-mono">{l.chave_txt}</span>
                        {' · '}
                        {l.lado === 'grupo' ? (l.group_name || l.chave) : (l.case_number || 'caso')}
                      </p>
                      {l.lado === 'caso' && (
                        <p className="text-[11px] text-muted-foreground">
                          grupo do lead: <span className={l.group_name ? '' : 'text-amber-700'}>{l.group_name || 'nenhum'}</span>
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{CLASSES[l.classe]?.rotulo || l.classe}</Badge>
                  </div>

                  {l.lado === 'grupo' && (
                    <p className="text-[11px]">
                      lead do grupo:{' '}
                      <span className={l.lead_grupo_nome ? 'font-medium' : 'text-amber-700'}>{l.lead_grupo_nome || 'nenhum'}</span>
                      {l.lead_grupo_via && <span className="text-muted-foreground"> (via {l.lead_grupo_via})</span>}
                      {l.lead_grupo_id && <span className="text-muted-foreground"> · {plural(l.lead_grupo_processos, 'processo', 'processos')}</span>}
                      {l.n_leads_cadastrados > 1 && <span className="text-amber-700"> · {l.n_leads_cadastrados} leads cadastram este grupo</span>}
                    </p>
                  )}
                  <p className="text-[11px]">
                    lead do caso {l.case_number && <span className="font-mono">{l.case_number}</span>}:{' '}
                    <span className={l.lead_caso_nome ? 'font-medium' : 'text-amber-700'}>{l.lead_caso_nome || 'nenhum'}</span>
                    {l.lead_caso_id && <span className="text-muted-foreground"> · {plural(l.lead_caso_processos, 'processo', 'processos')}</span>}
                    {l.lead_caso_case_number && <span className="text-muted-foreground"> · nº no lead: {l.lead_caso_case_number}</span>}
                    {l.n_casos > 1 && <span className="text-amber-700"> · {l.n_casos} casos com este número</span>}
                  </p>

                  {doisLeads && (
                    <p className="text-[10px] text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      Dois leads para o mesmo número. Quem tem os processos costuma ser o certo; se for a mesma pessoa, o caminho de verdade é juntar os leads.
                    </p>
                  )}
                  {l.o_que_fazer && <p className="text-[11px] text-muted-foreground">{l.o_que_fazer}</p>}

                  {ligavel && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="h-7 text-xs gap-1" disabled={!!decidindo} onClick={() => ligar(l)}>
                        {decidindo === l.chave ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                        Ligar ao lead do caso
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
