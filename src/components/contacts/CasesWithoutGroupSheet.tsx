// =============================================================================
// Casos sem grupo WhatsApp vinculado — e o botão pra vincular.
// A auditoria da aba Grupos lista GRUPOS; um caso sem grupo não tem linha lá.
// Este painel ataca o outro lado: parte dos casos e mostra quais ficaram órfãos.
// Regra (skill lead-vs-case-identity): caso SEMPRE tem grupo WhatsApp.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, Link2, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/functionRouter';

interface CasoSemGrupo {
  caseId: string;
  caseNumber: string | null;
  title: string | null;
  leadId: string | null;
  leadName: string | null;
  /** Sequência do funil (leads.case_number) — é ela que aparece no nome do grupo. */
  leadCaseNumber: string | null;
  leadMissing: boolean;
}

interface GrupoOpcao {
  group_jid: string;
  contact_name: string | null;
}

const PAGE = 1000;

/** Só dígitos, sem zeros à esquerda — é assim que o número aparece no nome do grupo. */
function digitos(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '').replace(/^0+/, '');
}

export function CasesWithoutGroupSheet({ open, onOpenChange, onLinked }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Avisa o pai pra refazer a lista de grupos depois de vincular. */
  onLinked?: () => void;
}) {
  const [rows, setRows] = useState<CasoSemGrupo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<GrupoOpcao[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [renomear, setRenomear] = useState(true);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();

      // 1) Casos vivos
      const casos: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await externalSupabase
          .from('legal_cases')
          .select('id, case_number, title, lead_id')
          .is('deleted_at', null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data as any[]) || [];
        casos.push(...page);
        if (page.length < PAGE) break;
      }

      // 2) Leads que já têm grupo (vínculo direto)
      const leadsComGrupo = new Set<string>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await externalSupabase
          .from('lead_whatsapp_groups')
          .select('lead_id')
          .not('lead_id', 'is', null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data as any[]) || [];
        page.forEach(r => r.lead_id && leadsComGrupo.add(r.lead_id));
        if (page.length < PAGE) break;
      }

      // 3) Dados do lead dos casos que sobraram (nome + espelho whatsapp_group_id)
      const candidatos = casos.filter(c => !c.lead_id || !leadsComGrupo.has(c.lead_id));
      const leadIds = Array.from(new Set(candidatos.map(c => c.lead_id).filter(Boolean))) as string[];
      const leadById = new Map<string, any>();
      for (let i = 0; i < leadIds.length; i += 200) {
        const chunk = leadIds.slice(i, i + 200);
        const { data, error } = await externalSupabase
          .from('leads')
          .select('id, lead_name, case_number, whatsapp_group_id')
          .in('id', chunk);
        if (error) throw error;
        (data as any[] || []).forEach(l => leadById.set(l.id, l));
      }

      const semGrupo: CasoSemGrupo[] = candidatos
        // leads.whatsapp_group_id é espelho do vínculo — se está preenchido, tem grupo.
        .filter(c => !c.lead_id || !leadById.get(c.lead_id)?.whatsapp_group_id)
        .map(c => {
          const lead = c.lead_id ? leadById.get(c.lead_id) : null;
          return {
            caseId: c.id,
            caseNumber: c.case_number ? String(c.case_number) : null,
            title: c.title || null,
            leadId: c.lead_id || null,
            leadName: lead?.lead_name || null,
            leadCaseNumber: lead?.case_number ? String(lead.case_number) : null,
            leadMissing: !c.lead_id || !lead,
          };
        })
        .sort((a, b) => Number(digitos(b.leadCaseNumber) || 0) - Number(digitos(a.leadCaseNumber) || 0));

      setRows(semGrupo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar casos sem grupo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && rows.length === 0 && !loading) carregar();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Busca grupos por nome. Ao abrir um caso, já sugere pelo número da sequência. */
  const buscarGrupos = useCallback(async (q: string) => {
    const termo = q.trim();
    if (termo.length < 2) { setOptions([]); return; }
    setSearching(true);
    try {
      // whatsapp_groups_index não está nos types gerados — mesmo cast que o
      // fetchGroups da ContactsListPage usa.
      const { data, error } = await (externalSupabase as any)
        .from('whatsapp_groups_index')
        .select('group_jid, contact_name')
        .ilike('contact_name', `%${termo}%`)
        .limit(200);
      if (error) throw error;
      // O mesmo grupo aparece uma vez por instância (até 19) — dedup por JID.
      const porJid = new Map<string, GrupoOpcao>();
      (data as any[] || []).forEach(g => {
        if (g.group_jid && !porJid.has(g.group_jid)) {
          porJid.set(g.group_jid, { group_jid: g.group_jid, contact_name: g.contact_name });
        }
      });
      setOptions(Array.from(porJid.values()).slice(0, 30));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao buscar grupos');
    } finally {
      setSearching(false);
    }
  }, []);

  const abrirCaso = (r: CasoSemGrupo) => {
    if (expanded === r.caseId) { setExpanded(null); return; }
    setExpanded(r.caseId);
    setOptions([]);
    const sugestao = digitos(r.leadCaseNumber);
    setQuery(sugestao);
    if (sugestao) buscarGrupos(sugestao);
  };

  const vincular = async (r: CasoSemGrupo, grupo: GrupoOpcao) => {
    if (!r.leadId) return;
    setLinking(grupo.group_jid);
    try {
      const { error } = await externalSupabase
        .from('lead_whatsapp_groups')
        .insert({
          lead_id: r.leadId,
          group_jid: grupo.group_jid,
          group_name: grupo.contact_name,
        } as any);
      if (error) throw error;

      if (renomear) {
        // Mesma função usada pelo "+ vincular lead" da tabela: põe o nome do
        // caso no grupo do WhatsApp. Falha aqui não desfaz o vínculo.
        cloudFunctions.invoke('regenerate-lead-name', { body: { lead_id: r.leadId } }).catch(() => {});
      }

      toast.success(renomear ? 'Grupo vinculado — renomeando no WhatsApp' : 'Grupo vinculado');
      setRows(prev => prev.filter(x => x.caseId !== r.caseId));
      setExpanded(null);
      setOptions([]);
      onLinked?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao vincular');
    } finally {
      setLinking(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">Casos sem grupo vinculado</SheetTitle>
          <SheetDescription className="text-xs">
            Caso sempre tem grupo no WhatsApp. Os daqui ficaram sem vínculo — clique num
            caso para achar o grupo pelo número e vincular.
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!loading && (
              <Badge variant="secondary" className="text-[10px]">{rows.length} caso(s)</Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={carregar}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recarregar
            </Button>
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nenhum caso sem grupo. Vinculação em dia.
          </p>
        ) : (
          <ScrollArea className="flex-1">
            <div className="divide-y">
              {rows.map(r => (
                <div key={r.caseId} className="px-5 py-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-2 text-left"
                    onClick={() => abrirCaso(r)}
                    disabled={r.leadMissing}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold tabular-nums">
                          {r.leadCaseNumber || r.caseNumber || 'sem nº'}
                        </span>
                        {r.leadMissing && (
                          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400">
                            lead ausente
                          </Badge>
                        )}
                      </div>
                      <p className="break-words text-sm">{r.leadName || r.title || '(sem nome)'}</p>
                    </div>
                    {!r.leadMissing && (
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
                        <Link2 className="h-3.5 w-3.5" />
                        Vincular
                      </span>
                    )}
                  </button>

                  {r.leadMissing && (
                    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                      Caso sem lead válido — corrigir o vínculo do caso antes de ligar um grupo.
                    </p>
                  )}

                  {expanded === r.caseId && !r.leadMissing && (
                    <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center gap-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') buscarGrupos(query); }}
                          placeholder="Buscar grupo por nome ou número…"
                          className="h-8 text-xs"
                        />
                        <Button size="sm" variant="outline" className="h-8 shrink-0 px-2 text-xs" onClick={() => buscarGrupos(query)} disabled={searching}>
                          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Buscar'}
                        </Button>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`ren-${r.caseId}`}
                          checked={renomear}
                          onCheckedChange={(v) => setRenomear(!!v)}
                        />
                        <Label htmlFor={`ren-${r.caseId}`} className="cursor-pointer text-[11px] leading-snug text-muted-foreground">
                          Renomear o grupo no WhatsApp com o nome do caso (altera o grupo de verdade)
                        </Label>
                      </div>

                      {options.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          {searching ? 'Buscando…' : 'Nenhum grupo encontrado. Ajuste a busca.'}
                        </p>
                      ) : (
                        <div className="divide-y rounded-md border bg-background">
                          {options.map(op => (
                            <button
                              key={op.group_jid}
                              type="button"
                              disabled={!!linking}
                              onClick={() => vincular(r, op)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
                            >
                              <span className="min-w-0 break-words text-xs">
                                {op.contact_name || op.group_jid}
                              </span>
                              {linking === op.group_jid
                                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                : <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
