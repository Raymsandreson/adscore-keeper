// Passo intermediário do botão "Contato" das partes do processo: antes de criar
// mais um contato com o mesmo nome, mostra quem já está na base (mesmo
// documento, mesmo nome ou nome próximo) e de quebra diz qual desses números já
// tem conversa no WhatsApp. Escolher um deles reaproveita o cadastro; ninguém
// parecido, o botão do rodapé cria o contato novo.

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, UserPlus, MessageSquare, IdCard, Search, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ensureExternalSession } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import {
  buscarSugestoesParaParte,
  marcarConversasDeWhatsApp,
  vincularParteAContato,
  soDigitos,
  type ParteParaBusca,
  type SugestaoDeContato,
} from '@/lib/parteContato';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parte: ParteParaBusca | null;
  processoNumero?: string | null;
  leadId?: string | null;
  /** Chamado depois de gravar, para a lista de partes marcar o selo "Contato". */
  onVinculado?: (nomeDaParte: string) => void;
}

/** (85) 99999-9999 — o número volta cru do banco, em grafias variadas. */
function formatarTelefone(raw?: string | null): string {
  let d = soDigitos(raw);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return String(raw || '');
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  const meio = numero.length > 8 ? numero.slice(0, numero.length - 4) : numero.slice(0, 4);
  const fim = numero.slice(-4);
  return `(${ddd}) ${meio}-${fim}`;
}

const ROTULO_MOTIVO: Record<SugestaoDeContato['motivo'], string> = {
  documento: 'mesmo documento',
  'nome-exato': 'mesmo nome',
  'nome-parecido': 'nome parecido',
};

export function VincularParteContatoDialog({
  open, onOpenChange, parte, processoNumero, leadId, onVinculado,
}: Props) {
  const [buscando, setBuscando] = useState(false);
  const [sugestoes, setSugestoes] = useState<SugestaoDeContato[]>([]);
  const [gravando, setGravando] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !parte) return;
    let cancelado = false;
    setSugestoes([]);
    setBuscando(true);
    (async () => {
      try {
        // RLS do Externo exige `authenticated`: sem a sessão pronta a busca
        // volta zero linhas em silêncio e tudo pareceria "ninguém parecido".
        await ensureExternalSession().catch(() => {});
        const achados = await buscarSugestoesParaParte(parte);
        if (cancelado) return;
        setSugestoes(achados);
        const comConversa = await marcarConversasDeWhatsApp(achados);
        if (!cancelado) setSugestoes(comConversa);
      } catch (e: any) {
        console.error('Erro ao procurar contatos parecidos:', e);
        if (!cancelado) toast.error('Não deu para procurar contatos parecidos');
      } finally {
        if (!cancelado) setBuscando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [open, parte]);

  // Telefone que a parte "ganha" quando o contato escolhido não tem nenhum:
  // o de quem já conversa no WhatsApp na frente do resto.
  const telefoneDeReserva =
    sugestoes.find((s) => s.telefone && s.temConversa)?.telefone ||
    sugestoes.find((s) => s.telefone)?.telefone ||
    null;

  const gravar = useCallback(async (escolha: SugestaoDeContato | null) => {
    if (!parte) return;
    setGravando(escolha ? `${escolha.origem}:${escolha.id}` : 'novo');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const criadoPor = await remapToExternal(user?.id).catch(() => null);
      const r = await vincularParteAContato({
        parte,
        processoNumero,
        leadId,
        escolha,
        // "Criar contato novo" é o usuário recusando as sugestões: nada de
        // herdar o telefone de um homônimo que ele acabou de descartar.
        telefone: escolha ? (escolha.telefone || telefoneDeReserva) : null,
        criadoPor,
      });
      const comFone = r.telefone ? ` com o telefone ${formatarTelefone(r.telefone)}` : '';
      const noLead = r.vinculouAoLead ? ' e vinculado ao lead' : ' (processo sem lead — só na lista de contatos)';
      toast.success(
        `${r.criouContato ? 'Contato criado' : 'Contato existente reaproveitado'}${comFone}${noLead}`
      );
      onVinculado?.(parte.nome);
      onOpenChange(false);
    } catch (e: any) {
      console.error('Erro ao vincular parte a contato:', e);
      toast.error(e?.message || 'Não deu para gravar o contato');
    } finally {
      setGravando(null);
    }
  }, [parte, processoNumero, leadId, telefoneDeReserva, onVinculado, onOpenChange]);

  if (!parte) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!gravando) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Adicionar {parte.nome} aos contatos</DialogTitle>
          <DialogDescription className="text-xs">
            {[parte.polo ? `Polo ${parte.polo}` : null, parte.tipo, parte.doc].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>

        {!leadId && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Processo sem lead vinculado — o contato é criado assim mesmo, só não fica ligado a um lead.
          </p>
        )}

        {buscando && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Procurando quem já está na base…
          </div>
        )}

        {!buscando && sugestoes.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Search className="h-4 w-4" /> Ninguém parecido na base — vai ser um cadastro novo.
          </div>
        )}

        {sugestoes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Já existe na base. Clique para reaproveitar em vez de criar um contato repetido:
            </p>
            <div className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
              {sugestoes.map((s) => {
                const chave = `${s.origem}:${s.id}`;
                return (
                  <button
                    key={chave}
                    type="button"
                    disabled={!!gravando}
                    onClick={() => gravar(s)}
                    className="w-full text-left border rounded p-2 bg-muted/30 hover:bg-muted transition-colors disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{s.nome}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <Badge variant={s.origem === 'contato' ? 'default' : 'secondary'} className="text-[9px]">
                            {s.origem === 'contato' ? 'Contato' : 'Lead'}
                          </Badge>
                          <Badge variant="outline" className="text-[9px]">{ROTULO_MOTIVO[s.motivo]}</Badge>
                          {s.documento && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <IdCard className="h-3 w-3" /> {s.documento}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          {s.telefone ? (
                            <span className="text-[10px] text-muted-foreground">{formatarTelefone(s.telefone)}</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">sem telefone</span>
                          )}
                          {s.temConversa && (
                            <span className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" /> tem conversa no WhatsApp
                            </span>
                          )}
                        </div>
                      </div>
                      {gravando === chave
                        ? <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                        : <Link2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!!gravando} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" disabled={!!gravando || buscando} onClick={() => gravar(null)}>
            {gravando === 'novo'
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <UserPlus className="h-3.5 w-3.5 mr-1" />}
            Criar contato novo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
