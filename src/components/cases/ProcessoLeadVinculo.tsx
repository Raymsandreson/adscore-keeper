// =============================================================================
// Vínculo processo↔lead e importação do Drive do lead — aba Documentos da ficha.
//
// Pedido do Raym (29/08/2026), na aba Documentos do processo:
//   1. importar documentos do Drive do lead respectivo;
//   2. vincular o processo a um lead, ou criar o lead se não existir;
//   3. vincular via grupo de WhatsApp que já tenha lead vinculado.
//
// Nada aqui é infraestrutura nova: o Drive por lead já existe (edge `lead-drive`,
// a mesma da aba Documentos do lead), o grupo já aponta para o lead
// (leads.whatsapp_group_id ↔ whatsapp_groups_cache.group_jid) e o vínculo é a
// coluna lead_processes.lead_id. Este arquivo só costura as três pontas.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ExternalLink, FolderDown, Link2, Loader2, MessagesSquare, Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

// ── Vincular lead ────────────────────────────────────────────────────────────

interface LeadHit {
  id: string;
  lead_name: string | null;
  /** Presente quando o hit veio pela busca de grupo (ou o lead tem grupo). */
  group_name?: string | null;
  temGrupo: boolean;
}

export function VincularLeadAoProcesso({ processId, sugestaoNome, onVinculado }: {
  processId: string;
  /** Nome pré-preenchido ao criar lead novo (título do processo/cliente). */
  sugestaoNome: string;
  onVinculado: (leadId: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [hits, setHits] = useState<LeadHit[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    const q = busca.trim();
    if (q.length < 2) { toast.error('Digite pelo menos 2 letras'); return; }
    setBuscando(true);
    try {
      await ensureExternalSession();
      // Duas frentes em paralelo: lead pelo nome, e GRUPO pelo nome — o grupo
      // só serve se já tiver lead vinculado (leads.whatsapp_group_id).
      const [leadsR, gruposR] = await Promise.all([
        externalSupabase.from('leads')
          .select('id, lead_name, whatsapp_group_id')
          .ilike('lead_name', `%${q}%`)
          .limit(8) as unknown as Promise<{ data: Record<string, unknown>[] | null }>,
        externalSupabase.from('whatsapp_groups_cache')
          .select('group_jid, group_name')
          .ilike('group_name', `%${q}%`)
          .limit(8) as unknown as Promise<{ data: Record<string, unknown>[] | null }>,
      ]);

      const porNome: LeadHit[] = (leadsR.data || []).map(l => ({
        id: String(l.id),
        lead_name: (l.lead_name as string) ?? null,
        temGrupo: !!l.whatsapp_group_id,
      }));

      // Grupos achados → leads donos deles.
      const jids = (gruposR.data || []).map(g => String(g.group_jid)).filter(Boolean);
      let porGrupo: LeadHit[] = [];
      if (jids.length > 0) {
        const donos = await (externalSupabase.from('leads')
          .select('id, lead_name, whatsapp_group_id')
          .in('whatsapp_group_id', jids) as unknown as Promise<{ data: Record<string, unknown>[] | null }>);
        const nomeDoGrupo = new Map((gruposR.data || []).map(g => [String(g.group_jid), (g.group_name as string) ?? null]));
        porGrupo = (donos.data || []).map(l => ({
          id: String(l.id),
          lead_name: (l.lead_name as string) ?? null,
          group_name: nomeDoGrupo.get(String(l.whatsapp_group_id)) ?? null,
          temGrupo: true,
        }));
      }

      // Dedup por id — lead achado pelas duas frentes aparece uma vez, com o grupo.
      const porId = new Map<string, LeadHit>();
      for (const h of [...porGrupo, ...porNome]) {
        if (!porId.has(h.id)) porId.set(h.id, h);
      }
      setHits([...porId.values()]);
    } catch (e) {
      toast.error(`Erro na busca: ${(e as Error)?.message || e}`);
    } finally {
      setBuscando(false);
    }
  }, [busca]);

  const vincular = useCallback(async (leadId: string, leadName: string | null) => {
    setVinculando(leadId);
    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase.from('lead_processes')
        .update({ lead_id: leadId })
        .eq('id', processId) as unknown as Promise<{ error: { message?: string } | null }>);
      if (error) throw new Error(error.message);
      toast.success(`Processo vinculado ao lead "${leadName || leadId}"`);
      onVinculado(leadId);
    } catch (e) {
      toast.error(`Erro ao vincular: ${(e as Error)?.message || e}`);
    } finally {
      setVinculando(null);
    }
  }, [processId, onVinculado]);

  const criarLead = useCallback(async () => {
    const nome = (busca.trim() || sugestaoNome || '').trim();
    if (!nome) { toast.error('Digite o nome do lead na busca antes de criar'); return; }
    setCriando(true);
    try {
      // created_by vem da sessão Cloud (auth mora lá); o insert vai no Externo —
      // mesmo padrão do "criar lead para salvar no Drive" do WhatsAppChat.
      const { data: { user } } = await supabase.auth.getUser();
      await ensureExternalSession();
      const { data, error } = await (externalSupabase.from('leads')
        .insert({
          lead_name: nome,
          source: 'processo',
          lead_status: 'no_response',
          created_by: user?.id || null,
          notes: 'Lead criado a partir da ficha do processo (aba Documentos).',
        })
        .select('id, lead_name')
        .single() as unknown as Promise<{ data: { id: string; lead_name: string | null } | null; error: { message?: string } | null }>);
      if (error || !data) throw new Error(error?.message || 'insert não retornou o lead');
      toast.success(`Lead "${data.lead_name}" criado`);
      await vincular(data.id, data.lead_name);
    } catch (e) {
      toast.error(`Erro ao criar lead: ${(e as Error)?.message || e}`);
    } finally {
      setCriando(false);
    }
  }, [busca, sugestaoNome, vincular]);

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Link2 className="h-3.5 w-3.5 text-amber-600" />
        Processo sem lead vinculado
      </div>
      <p className="text-[11px] text-muted-foreground">
        O Drive dos documentos mora no lead. Busque pelo nome do lead <b>ou do grupo de WhatsApp</b>{' '}
        que já tenha lead — ou crie um lead novo.
      </p>
      <div className="flex gap-1.5">
        <Input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void buscar(); }}
          placeholder="Nome do lead ou do grupo…"
          className="h-8 text-xs"
        />
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={buscando} onClick={() => void buscar()}>
          {buscando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Buscar
        </Button>
      </div>
      {hits !== null && (
        hits.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhum lead ou grupo encontrado com esse nome.</p>
        ) : (
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {hits.map(h => (
              <button
                key={h.id}
                type="button"
                disabled={vinculando !== null}
                onClick={() => void vincular(h.id, h.lead_name)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
              >
                {vinculando === h.id
                  ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  : <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{h.lead_name || h.id}</span>
                {h.group_name && (
                  <Badge variant="secondary" className="max-w-40 shrink-0 truncate px-1 py-0 text-[9px]" title={`Grupo: ${h.group_name}`}>
                    <MessagesSquare className="mr-0.5 h-2.5 w-2.5" />{h.group_name}
                  </Badge>
                )}
                {!h.group_name && h.temGrupo && (
                  <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px]">tem grupo</Badge>
                )}
              </button>
            ))}
          </div>
        )
      )}
      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={criando} onClick={() => void criarLead()}>
        {criando ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
        Criar lead novo{busca.trim() ? ` "${busca.trim()}"` : sugestaoNome ? ` "${sugestaoNome}"` : ''}
      </Button>
    </div>
  );
}

// ── Importar do Drive do lead ────────────────────────────────────────────────

interface DriveFileHit {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export function ImportarDoDriveButton({ processId, caseId, leadId, jaImportados, classificar, onImportado }: {
  processId: string;
  caseId: string | null;
  leadId: string;
  /** URLs/ids já presentes em process_documents — para não duplicar. */
  jaImportados: { original_url: string | null; metadata?: Record<string, unknown> | null }[];
  classificar: (texto: string) => string;
  onImportado: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [arquivos, setArquivos] = useState<DriveFileHit[]>([]);
  const [pastaUrl, setPastaUrl] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [importando, setImportando] = useState(false);

  const jaTem = useCallback((f: DriveFileHit) => jaImportados.some(d =>
    (d.metadata && (d.metadata as Record<string, unknown>).drive_file_id === f.id)
    || (!!f.webViewLink && d.original_url === f.webViewLink),
  ), [jaImportados]);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setCarregando(true);
    (async () => {
      try {
        // A MESMA edge da aba Documentos do lead: pasta única por lead no Drive
        // do escritório. lead_name vai junto porque a edge o usa para nomear a
        // pasta na primeira vez.
        await ensureExternalSession();
        const { data: leadRow } = await (externalSupabase.from('leads')
          .select('lead_name').eq('id', leadId).maybeSingle() as unknown as Promise<{ data: { lead_name: string | null } | null }>);
        const { data, error } = await supabase.functions.invoke('lead-drive', {
          body: { action: 'list_files', lead_id: leadId, lead_name: leadRow?.lead_name || undefined },
        });
        if (cancelado) return;
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        setArquivos(((data as { files?: DriveFileHit[] }).files) || []);
        setPastaUrl((data as { folder_url?: string }).folder_url || null);
      } catch (e) {
        if (!cancelado) toast.error(`Erro ao listar o Drive do lead: ${(e as Error)?.message || e}`);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [aberto, leadId]);

  const importar = useCallback(async () => {
    const escolhidos = arquivos.filter(f => selecionados.has(f.id));
    if (escolhidos.length === 0) return;
    setImportando(true);
    let ok = 0;
    try {
      await ensureExternalSession();
      for (const f of escolhidos) {
        if (jaTem(f)) continue;
        const { error } = await (externalSupabase.from('process_documents').insert({
          process_id: processId,
          case_id: caseId,
          lead_id: leadId,
          document_type: classificar(f.name),
          title: f.name,
          source: 'drive',
          original_url: f.webViewLink || null,
          metadata: { drive_file_id: f.id, mimeType: f.mimeType || null, modifiedTime: f.modifiedTime || null },
        }) as unknown as Promise<{ error: { message?: string } | null }>);
        if (error) { toast.error(`"${f.name}": ${error.message}`); continue; }
        ok++;
      }
      if (ok > 0) toast.success(`${ok} documento(s) importado(s) do Drive`);
      else toast.info('Nada novo para importar (já estavam vinculados).');
      setAberto(false);
      setSelecionados(new Set());
      onImportado();
    } finally {
      setImportando(false);
    }
  }, [arquivos, selecionados, jaTem, processId, caseId, leadId, classificar, onImportado]);

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setAberto(true)}>
        <FolderDown className="h-3 w-3" />
        Importar do Drive
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Importar do Drive do lead</DialogTitle>
            <DialogDescription className="text-xs">
              Arquivos da pasta do lead no Drive do escritório. Importar vincula o arquivo a este
              processo — nada é copiado nem movido.
            </DialogDescription>
          </DialogHeader>
          {carregando ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" />
              Lendo a pasta do lead…
            </div>
          ) : arquivos.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">A pasta do lead está vazia.</p>
          ) : (
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {arquivos.map(f => {
                const importado = jaTem(f);
                return (
                  <label key={f.id} className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${importado ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40'}`}>
                    <Checkbox
                      checked={selecionados.has(f.id)}
                      disabled={importado}
                      onCheckedChange={(v) => setSelecionados(prev => {
                        const next = new Set(prev);
                        if (v) next.add(f.id); else next.delete(f.id);
                        return next;
                      })}
                    />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                    {importado && <Badge variant="outline" className="shrink-0 px-1 py-0 text-[8px]">já vinculado</Badge>}
                    <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                      {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('pt-BR') : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            {pastaUrl ? (
              <a href={pastaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                <ExternalLink className="h-2.5 w-2.5" /> Abrir pasta no Drive
              </a>
            ) : <span />}
            <Button size="sm" disabled={importando || selecionados.size === 0} onClick={() => void importar()} className="h-7 gap-1 text-xs">
              {importando ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderDown className="h-3 w-3" />}
              Importar {selecionados.size > 0 ? `(${selecionados.size})` : ''}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
