import { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Eye, Send, FileSignature, Search, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/functionRouter';
import { fetchLeadGroups, type LeadGroupOption } from '@/lib/leadWhatsAppTarget';
import { MediaLightbox } from './MediaLightbox';
import { onProcuracaoPicker, type ProcuracaoPickerPayload } from '@/lib/procuracaoPickerEvent';

/**
 * Escolha manual da procuração que vai ao cliente para assinar à mão.
 *
 * Existe porque o robô só liga procuração a requerimento por chave exata
 * (lead, CPF ou nome idêntico) e isso cobre 22 dos 58 casos. No resto o
 * requerimento está no nome da criança e a procuração no nome da mãe — quem
 * reconhece o par é quem atende o caso. Casar por semelhança de nome está
 * proibido: o título do grupo carrega o nome do acolhedor, e a heurística
 * entregava a procuração de uma funcionária para 9 clientes diferentes.
 *
 * Por isso a lista mostra SEMPRE o porquê de cada candidata ter aparecido, e a
 * confirmação é de quem clica. O "Enviar" grava o vínculo (o próximo caso do
 * mesmo lead resolve sozinho) e manda o PDF sem assinatura ao grupo.
 */

interface Candidata {
  doc_token: string;
  outorgante: string | null;
  cpf_mascarado: string | null;
  document_name: string | null;
  created_at: string | null;
  url: string;
  ja_vinculado: boolean;
  motivo: string;
}

function ProcuracaoPickerBody({ payload, onClose }: { payload: ProcuracaoPickerPayload; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [candidatas, setCandidatas] = useState<Candidata[]>([]);
  const [busca, setBusca] = useState('');
  const [preview, setPreview] = useState<{ url: string; titulo: string } | null>(null);
  const [enviandoToken, setEnviandoToken] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<LeadGroupOption[]>([]);
  const [grupoJid, setGrupoJid] = useState<string | null>(null);

  const buscar = useCallback(async (termo?: string) => {
    setCarregando(true);
    try {
      const { data, error } = await cloudFunctions.invoke('inss-procuracao-vincular', {
        body: {
          action: 'listar',
          lead_id: payload.leadId,
          lead_name: payload.leadName || null,
          nome_segurado: payload.nomeSegurado || null,
          cpf_segurado: payload.cpfSegurado || null,
          busca: termo || null,
        },
      });
      const d = data as any;
      if (error || d?.success === false) throw new Error(d?.error || (error as any)?.message || 'falha na busca');
      setCandidatas(d?.candidatas || []);
    } catch (e: any) {
      toast.error(`Não consegui listar as procurações: ${e?.message || e}`);
      setCandidatas([]);
    } finally {
      setCarregando(false);
    }
  }, [payload.leadId, payload.leadName, payload.nomeSegurado, payload.cpfSegurado]);

  useEffect(() => { void buscar(); }, [buscar]);

  useEffect(() => {
    let vivo = true;
    fetchLeadGroups(payload.leadId)
      .then((gs) => {
        if (!vivo) return;
        setGrupos(gs);
        if (gs.length === 1) setGrupoJid(gs[0].jid);
      })
      .catch(() => { /* sem grupo: o envio fica bloqueado e a tela explica */ });
    return () => { vivo = false; };
  }, [payload.leadId]);

  async function enviar(c: Candidata) {
    if (!grupoJid) {
      toast.error('Escolha o grupo de destino antes de enviar.');
      return;
    }
    const nomeGrupo = grupos.find((g) => g.jid === grupoJid)?.name || grupoJid;
    const ok = window.confirm(
      `Enviar a procuração de ${c.outorgante || 'sem nome'} para o grupo "${nomeGrupo}"?\n\n` +
      'O cliente recebe o PDF para imprimir e assinar à caneta. Confira que é a pessoa certa: ' +
      'o documento leva CPF e endereço dela.',
    );
    if (!ok) return;
    setEnviandoToken(c.doc_token);
    try {
      const { data, error } = await cloudFunctions.invoke('inss-procuracao-vincular', {
        body: {
          action: 'vincular',
          doc_token: c.doc_token,
          lead_id: payload.leadId,
          group_jid: grupoJid,
          instance_name: payload.instanceName || null,
        },
      });
      const d = data as any;
      if (error || d?.success === false) throw new Error(d?.error || (error as any)?.message || 'falha ao vincular');
      if (d?.enviado) {
        toast.success('Procuração enviada ao grupo e vinculada a este lead.');
        onClose();
      } else {
        toast.warning(
          `Vínculo gravado, mas o PDF não foi ao grupo${d?.erro_envio ? `: ${d.erro_envio}` : ''}.`,
        );
        void buscar(busca);
      }
    } catch (e: any) {
      toast.error(`Não deu certo: ${e?.message || e}`);
    } finally {
      setEnviandoToken(null);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <FileSignature className="h-4 w-4" /> Procuração para assinar à mão
        </SheetTitle>
        <SheetDescription>
          O INSS não aceita mais a assinatura eletrônica. Escolha a procuração deste cliente: o PDF
          vai ao grupo já preenchido e sem assinatura, para imprimir e assinar à caneta.
        </SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-3">
        {payload.nomeSegurado && (
          <div className="text-xs text-muted-foreground">
            Requerimento no nome de <strong>{payload.nomeSegurado}</strong>
            {payload.leadName ? <> · grupo <strong>{payload.leadName}</strong></> : null}
            . Em BPC e maternidade o requerimento fica no nome da criança e a procuração no da mãe —
            por isso pode ser preciso buscar pelo outro nome.
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); void buscar(busca); }}
        >
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome (ex.: o nome da mãe)"
            className="h-9"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={carregando}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        {grupos.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Este lead não tem grupo de WhatsApp vinculado, então o envio fica bloqueado. Vincule o
              grupo na ficha do lead e volte aqui.
            </span>
          </div>
        ) : grupos.length > 1 ? (
          <div className="space-y-1">
            <div className="text-xs font-medium">Grupo de destino</div>
            <div className="flex flex-wrap gap-1">
              {grupos.map((g) => (
                <Button
                  key={g.jid}
                  size="sm"
                  variant={grupoJid === g.jid ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setGrupoJid(g.jid)}
                >
                  {g.name || g.jid}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {carregando ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : candidatas.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            Nenhuma procuração encontrada. Busque pelo nome de quem assinou (a mãe, o tutor) — e se
            este cliente nunca teve procuração, gere uma nova em "Gerar Documento para Assinatura".
          </div>
        ) : (
          <div className="space-y-2">
            {candidatas.map((c) => (
              <div key={c.doc_token} className="rounded-md border p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.outorgante || 'sem nome no documento'}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.document_name || 'procuração'}
                      {c.cpf_mascarado ? ` · CPF ${c.cpf_mascarado}` : ''}
                      {c.created_at ? ` · ${new Date(c.created_at).toLocaleDateString('pt-BR')}` : ''}
                    </div>
                  </div>
                  {c.ja_vinculado && <Badge variant="secondary" className="shrink-0 text-[10px]">deste lead</Badge>}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">{c.motivo}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setPreview({ url: c.url, titulo: c.outorgante || 'Procuração' })}
                    >
                      <Eye className="mr-1 h-3 w-3" /> Ver
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={!grupoJid || enviandoToken !== null}
                      onClick={() => void enviar(c)}
                    >
                      {enviandoToken === c.doc_token
                        ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        : <Send className="mr-1 h-3 w-3" />}
                      É esta
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <MediaLightbox url={preview.url} title={preview.titulo} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

/**
 * Host global: fica montado num pai estável e escuta `procuracao:picker`.
 * Mesmo desenho do ZapSignDialogHost, pelo mesmo motivo — o Sheet precisa
 * sobreviver a remount da lista de conversas.
 */
export function ProcuracaoPickerHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ProcuracaoPickerPayload | null>(null);

  useEffect(() => onProcuracaoPicker((p) => { setPayload(p); setOpen(true); }), []);

  if (!payload) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <ProcuracaoPickerBody payload={payload} onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
