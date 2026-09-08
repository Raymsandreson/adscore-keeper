/**
 * A fila dos processos citados no grupo que o vinculador NÃO resolveu sozinho —
 * com os dois botões que faltavam.
 *
 * POR QUE EXISTE (08/09/2026). A regra "processo citado no grupo pela equipe é
 * do grupo" vincula sozinha quando o número do caso do grupo bate com o do
 * lead dono do processo. O resto (191 citações naquele dia) caía na
 * `vw_grupo_processo_desalinhado` — que era só leitura: a pessoa via a
 * divergência e não tinha o que clicar. Aqui cada linha tem "É deste grupo" e
 * "Não é". A escrita é UMA RPC (`resolver_processo_citado`), que completa o
 * que faltar na cadeia lead·grupo·processo e recusa quando teria que sortear.
 *
 * O QUE ESTE PAINEL NÃO FAZ. Não escolhe lead. Se o grupo não tem lead e o
 * processo está em dois, a RPC recusa e diz para usar o Vincular — a mesma
 * regra do painel de vincular ficha: sortear conta a um cliente o processo de
 * outro.
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
import { Check, X, Loader2, Scale, AlertTriangle } from 'lucide-react';

const dbAny = db as unknown as SupabaseClient;

/** Só os dígitos do jid — as tabelas do detector guardam sem '@g.us'. */
const jidCurto = (v: string) => String(v || '').split('@')[0];

/** Uma linha da vw_grupo_processo_desalinhado, só o que a tela usa. */
export interface CitacaoNaFila {
  group_jid: string;
  group_name: string | null;
  processo: string | null;
  cnj: string;
  dono_do_processo: string | null;
  leads_donos: string[] | null;
  ocorrencias: number | null;
  ultima_em: string | null;
  classe: 'processo_orfao' | 'grupo_sem_cliente' | 'a_conferir' | 'ficha_paralela' | 'caso_diferente' | string;
  o_que_fazer: string | null;
  /** 'cnj' = processo judicial; 'inss' = requerimento/benefício do INSS (08/09/2026). */
  tipo?: 'cnj' | 'inss' | null;
}

const CLASSES: Record<string, { rotulo: string; explica: string }> = {
  processo_orfao:    { rotulo: 'processo não cadastrado', explica: 'O número citado não existe em lead_processes. "É deste grupo" cadastra no lead do grupo.' },
  grupo_sem_cliente: { rotulo: 'grupo sem lead',           explica: 'O processo tem dono, o grupo não tem lead. "É deste grupo" liga o grupo ao dono.' },
  a_conferir:        { rotulo: 'sem número de caso',       explica: 'Grupo ou lead sem "Caso N" no nome — a máquina não tem como comparar.' },
  caso_diferente:    { rotulo: 'número do caso não bate',  explica: 'O grupo diz um número de caso; o lead dono do processo diz outro.' },
  ficha_paralela:    { rotulo: 'mesmo caso, outro lead',   explica: 'O número bate, mas o processo está em outro lead do mesmo caso.' },
};

const dataBR = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
};

const ACAO_TEXTO: Record<string, string> = {
  processo_do_grupo: 'Marcado como processo do grupo.',
  cadastrado_no_lead_do_grupo: 'Processo cadastrado no lead do grupo.',
  adotado_pelo_lead_do_grupo: 'O lead do grupo adotou o processo.',
  grupo_ligado_ao_lead_do_processo: 'Grupo ligado ao lead dono do processo.',
  nao_e_do_grupo: 'Marcado como "não é deste grupo".',
};

export function FilaProcessosCitadosSheet({
  open, onOpenChange, onResolvido,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Chamado a cada decisão, para quem abriu recontar. */
  onResolvido?: () => void;
}) {
  const [linhas, setLinhas] = useState<CitacaoNaFila[]>([]);
  const [leadDoGrupo, setLeadDoGrupo] = useState<Map<string, string>>(new Map());
  const [carregando, setCarregando] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [classe, setClasse] = useState<string>('todas');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      await ensureExternalSession();
      const { data, error } = await dbAny.from('vw_grupo_processo_desalinhado')
        .select('group_jid, group_name, processo, cnj, dono_do_processo, leads_donos, ocorrencias, ultima_em, classe, o_que_fazer, tipo')
        .order('ocorrencias', { ascending: false });
      if (error) throw error;
      const rows = (data as CitacaoNaFila[]) || [];
      setLinhas(rows);

      // O lead de cada grupo, para a linha dizer "lead do grupo: X" em vez de
      // obrigar a pessoa a abrir o grupo para saber. Uma consulta para todos —
      // a ponte guarda com e sem '@g.us', por isso os dois formatos.
      const jids = Array.from(new Set(rows.map(r => jidCurto(r.group_jid))));
      if (jids.length) {
        const { data: pontes } = await dbAny.from('lead_whatsapp_groups')
          .select('group_jid, lead_id, created_at')
          .in('group_jid', [...jids, ...jids.map(j => `${j}@g.us`)])
          .not('lead_id', 'is', null)
          .order('created_at', { ascending: false });
        const porGrupo = new Map<string, string>();
        for (const p of (pontes as { group_jid: string; lead_id: string }[]) || []) {
          const k = jidCurto(p.group_jid);
          if (!porGrupo.has(k)) porGrupo.set(k, p.lead_id);
        }
        const ids = Array.from(new Set(porGrupo.values()));
        const nomes = new Map<string, string>();
        if (ids.length) {
          const { data: leads } = await dbAny.from('leads').select('id, lead_name').in('id', ids);
          for (const l of (leads as { id: string; lead_name: string | null }[]) || []) {
            nomes.set(l.id, l.lead_name || 'lead sem nome');
          }
        }
        const m = new Map<string, string>();
        for (const [k, id] of porGrupo) m.set(k, nomes.get(id) || 'lead sem nome');
        setLeadDoGrupo(m);
      } else {
        setLeadDoGrupo(new Map());
      }
    } catch (e) {
      toast.error('Não consegui carregar a fila: ' + (e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { if (open) void carregar(); }, [open, carregar]);

  const contagem = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of linhas) c.set(l.classe, (c.get(l.classe) || 0) + 1);
    return c;
  }, [linhas]);

  const visiveis = useMemo(
    () => (classe === 'todas' ? linhas : linhas.filter(l => l.classe === classe)),
    [linhas, classe],
  );

  const decidir = async (l: CitacaoNaFila, decisao: 'e_do_grupo' | 'nao_e_do_grupo') => {
    const chave = `${jidCurto(l.group_jid)}:${l.cnj}`;
    if (decidindo) return;
    setDecidindo(chave);
    try {
      await ensureExternalSession();
      const { data, error } = await dbAny.rpc('resolver_processo_citado', {
        p_group_jid: l.group_jid, p_cnj: l.cnj, p_decisao: decisao,
      });
      if (error) throw error;
      const r = (data || {}) as { ok?: boolean; acao?: string };
      toast.success(ACAO_TEXTO[r.acao || ''] || 'Feito.');
      if (r.acao === 'grupo_ligado_ao_lead_do_processo') invalidateGroupLeadCache(jidCurto(l.group_jid));
      // A view deixa de devolver a linha decidida — tirar daqui evita recarregar tudo.
      setLinhas(prev => prev.filter(x => !(jidCurto(x.group_jid) === jidCurto(l.group_jid) && x.cnj === l.cnj)));
      onResolvido?.();
    } catch (e) {
      // A RPC recusa com frase de gente ("ligue o grupo a um lead primeiro"):
      // é essa frase que a pessoa precisa ler, não um código.
      toast.error((e as Error).message || 'Não consegui decidir.');
    } finally {
      setDecidindo(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Processos citados a conferir
            <Badge variant="secondary">{linhas.length}</Badge>
          </SheetTitle>
          <SheetDescription>
            A equipe citou o processo neste grupo, mas o número do caso não bateu com o do lead
            dono — ou não tinha como comparar. Você decide: é deste grupo ou não é.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant={classe === 'todas' ? 'default' : 'outline'} className="h-7 text-xs"
                  onClick={() => setClasse('todas')}>todas ({linhas.length})</Button>
          {Array.from(contagem.entries()).map(([k, n]) => (
            <Button key={k} size="sm" variant={classe === k ? 'default' : 'outline'} className="h-7 text-xs"
                    onClick={() => setClasse(k)} title={CLASSES[k]?.explica}>
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
          <p className="mt-4 text-xs text-muted-foreground">Nada na fila. Tudo que a equipe citou já está ligado.</p>
        )}

        <div className="mt-3 space-y-2">
          {visiveis.map(l => {
            const chave = `${jidCurto(l.group_jid)}:${l.cnj}`;
            const lead = leadDoGrupo.get(jidCurto(l.group_jid));
            const info = CLASSES[l.classe];
            return (
              <Card key={chave} data-testid="citacao">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{l.group_name || l.group_jid}</p>
                      <p className="text-[11px] text-muted-foreground">
                        lead do grupo: <span className={lead ? '' : 'text-amber-700'}>{lead || 'nenhum'}</span>
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0" title={info?.explica}>
                      {info?.rotulo || l.classe}
                    </Badge>
                  </div>
                  <p className="text-[11px]">
                    cita {l.tipo === 'inss' ? 'o requerimento INSS' : 'o processo'} <span className="font-mono">{l.processo || l.cnj}</span>
                    {typeof l.ocorrencias === 'number' && ` · ${l.ocorrencias}×`}
                    {l.ultima_em && ` · última em ${dataBR(l.ultima_em)}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {l.classe === 'processo_orfao'
                      ? (l.tipo === 'inss' ? 'requerimento não cadastrado em nenhum lead' : 'processo não cadastrado em nenhum lead')
                      : <>processo está no lead: <span className="font-medium">{l.dono_do_processo || '—'}</span></>}
                  </p>
                  {l.classe === 'caso_diferente' && (
                    <p className="text-[10px] text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      Número de caso diferente dos dois lados. Se for outra pessoa, é "não é".
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-7 text-xs gap-1" disabled={!!decidindo}
                            onClick={() => decidir(l, 'e_do_grupo')}>
                      {decidindo === chave ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {l.classe === 'processo_orfao' ? 'É deste grupo — cadastrar' : 'É deste grupo'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!!decidindo}
                            onClick={() => decidir(l, 'nao_e_do_grupo')}>
                      <X className="h-3 w-3" /> Não é
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
