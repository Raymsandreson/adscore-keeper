import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Volume2, Send, MessageCircle, Sparkles, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react';
import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

const AUDIO_TONES = [
  { key: 'humanized', label: '🤝 Humanizado', prompt: 'Explique de forma natural e humana, como se estivesse conversando pessoalmente. Seja caloroso e acessível.' },
  { key: 'casual', label: '😎 Descontraído', prompt: 'Explique de forma leve e descontraída, como uma conversa informal entre amigos. Use linguagem coloquial.' },
  { key: 'formal', label: '👔 Formal', prompt: 'Explique de forma profissional e formal, mantendo clareza e objetividade.' },
  { key: 'empathetic', label: '💛 Empático', prompt: 'Explique com empatia e cuidado, mostrando que se importa com o cliente. Seja acolhedor.' },
  { key: 'concise', label: '⚡ Conciso', prompt: 'Explique de forma breve e direta, indo direto ao ponto sem rodeios.' },
  { key: 'friendly', label: '😊 Amigável', prompt: 'Explique de forma amigável e simpática, com tom positivo e encorajador.' },
  { key: 'custom', label: '💬 Personalizado', prompt: '' },
];

export interface GroupOption {
  id: string;
  label: string;
  group_jid: string;
  group_name: string | null;
}

/**
 * Grupos do lead no formato do seletor deste dialog.
 *
 * Extraída do efeito abaixo para que a ficha da atividade possa pré-carregar os
 * grupos enquanto o usuário ainda preenche o formulário (ver `preloadedGroups`).
 * A busca é a mesma de sempre: `lead_whatsapp_groups` primeiro e o campo legado
 * `leads.whatsapp_group_id` só quando não há nenhum vinculado — o segundo
 * round-trip existe apenas nesse caso.
 *
 * Lista vazia aqui significa "este lead não tem grupo", e o dialog desliga a
 * notificação por causa dela. Então falha NÃO pode virar lista vazia:
 *  - a policy do `lead_whatsapp_groups` é `TO authenticated`; sem sessão o
 *    PostgREST devolve `[]` (zero linhas), não erro — daí o `ensureExternalSession`
 *    antes da query. Enquanto a busca só acontecia no clique o problema não
 *    aparecia (a sessão já estava de pé); com o pré-carregamento junto da ficha
 *    ela passou a correr com o bootstrap;
 *  - erro de rede/permissão sobe como exceção, e quem chamou trata (o preload
 *    guarda `null` e o dialog volta a buscar no clique).
 * Incidente 17/08/2026: "Concluir + próxima" parou de mandar áudio ao grupo em
 * silêncio — o dialog exibia "(nenhum grupo vinculado)" para lead com grupo.
 */
export async function fetchLeadGroupOptions(leadId: string): Promise<GroupOption[]> {
  await ensureExternalSession();

  const { data, error } = await externalSupabase
    .from('lead_whatsapp_groups')
    .select('id, label, group_jid, group_name')
    .eq('lead_id', leadId);
  if (error) throw error;

  const groupOptions: GroupOption[] = (data || [])
    .filter((g: any) => g.group_jid)
    .map((g: any) => ({
      id: g.id,
      label: g.label || g.group_name || g.group_jid,
      group_jid: g.group_jid,
      group_name: g.group_name,
    }));

  // Also check legacy whatsapp_group_id on leads table
  if (groupOptions.length === 0) {
    // Externo: é onde os leads vivem. Lendo o legado do Cloud, o texto podia
    // ir para um grupo diferente do que o áudio (que lê do externo) usa.
    const { data: lead, error: leadError } = await externalSupabase
      .from('leads')
      .select('whatsapp_group_id, lead_name')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    if (lead?.whatsapp_group_id) {
      groupOptions.push({
        id: 'legacy',
        label: `Grupo ${lead.lead_name || 'do Lead'}`,
        group_jid: lead.whatsapp_group_id,
        group_name: lead.lead_name,
      });
    }
  }

  return groupOptions;
}

interface CompleteAndNotifyDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (notifyOptions?: { groupJid: string; message: string; sendAudio: boolean; audioText?: string }) => Promise<void>;
  leadId: string | null;
  buildMsg: (() => string) | null;
  /**
   * Grupos já buscados pela ficha para ESTE lead. Quando vem preenchido, o
   * dialog abre sem round-trip e sem spinner. `null` mantém a busca no clique
   * (lead ainda carregando, preload falhou ou grupo vinculado agora há pouco).
   */
  preloadedGroups?: GroupOption[] | null;
  /** Prazo GRAVADO na atividade que está sendo concluída (`yyyy-MM-dd`). */
  currentDeadline?: string | null;
  /** Prazo que está no formulário agora — é o que vai para a filha. */
  nextDeadline?: string | null;
  /**
   * Adia a atividade aberta em vez de concluir. Sem isto, o atalho não aparece
   * e o aviso vira só texto.
   */
  onPostponeInstead?: (dateStr: string) => Promise<void> | void;
}

/** `2026-08-18` → `18/08`. */
function diaMes(dateStr: string): string {
  return `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

export function CompleteAndNotifyDialog({ open, onClose, onConfirm, leadId, buildMsg, preloadedGroups = null, currentDeadline = null, nextDeadline = null, onPostponeInstead }: CompleteAndNotifyDialogProps) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [postponing, setPostponing] = useState(false);

  // Choices
  const [notifyGroup, setNotifyGroup] = useState<'yes' | 'no'>('no');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [sendAudio, setSendAudio] = useState(false);
  const [audioTone, setAudioTone] = useState('humanized');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatingAudioText, setGeneratingAudioText] = useState(false);

  // Lido por ref, e não como dependência: se o preload chegasse com o dialog já
  // aberto, reexecutar o efeito apagaria a escolha que o usuário acabou de fazer.
  const preloadedRef = useRef(preloadedGroups);
  preloadedRef.current = preloadedGroups;

  // Fetch groups for the lead
  useEffect(() => {
    if (!open || !leadId) return;
    // Zera antes de buscar: sem isso, os grupos do lead ANTERIOR continuam em
    // memória enquanto a query está em voo (e ficam para sempre se ela falhar).
    // Foi assim que a notificação de um cliente foi parar no grupo de outro em
    // 13/07 e 30/07/2026.
    setGroups([]);
    setSelectedGroupId('');
    setNotifyGroup('no');

    const aplicar = (groupOptions: GroupOption[]) => {
      setGroups(groupOptions);
      if (groupOptions.length === 1) setSelectedGroupId(groupOptions[0].id);
      if (groupOptions.length > 0) setNotifyGroup('yes');
      setLoading(false);
    };

    // Ficha já buscou os grupos deste lead: abre pronto, sem round-trip e sem
    // spinner. Buscar no clique era o gargalo do "Concluir + próxima" — 1 a 2
    // idas ao banco por atividade, multiplicadas pela fila do modo workflow.
    const preloaded = preloadedRef.current;
    if (preloaded) {
      aplicar(preloaded);
      return;
    }

    setLoading(true);
    let cancelado = false;
    (async () => {
      const groupOptions = await fetchLeadGroupOptions(leadId);
      // Resposta de um lead que não está mais aberto não pode virar destino.
      if (cancelado) return;
      aplicar(groupOptions);
    })().catch(() => {
      if (cancelado) return;
      setLoading(false);
      toast.error('Não foi possível carregar os grupos do lead. Notificação desativada.');
    });
    return () => { cancelado = true; };
  }, [open, leadId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setGroups([]);
      setNotifyGroup('no');
      setSelectedGroupId('');
      setSendAudio(false);
      setAudioTone('humanized');
      setCustomPrompt('');
    }
  }, [open]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      if (notifyGroup === 'yes' && selectedGroupId) {
        const group = groups.find(g => g.id === selectedGroupId);
        if (!group) {
          toast.error('Selecione um grupo');
          setSubmitting(false);
          return;
        }

        const message = buildMsg ? buildMsg() : '';
        let audioText: string | undefined;

        if (sendAudio && message) {
          // Generate the audio explanation text via AI
          const toneConfig = AUDIO_TONES.find(t => t.key === audioTone);
          const prompt = audioTone === 'custom' && customPrompt
            ? customPrompt
            : toneConfig?.prompt || '';

          setGeneratingAudioText(true);
          try {
            const { data: aiData } = await cloudFunctions.invoke('ai-text-editor', {
              body: {
                action: 'custom',
                text: message,
                custom_prompt: `Você é o dono desta instância de WhatsApp. Gere APENAS o texto que será convertido em áudio para enviar ao grupo do cliente. NÃO leia o texto literal da mensagem escrita. Em vez disso, EXPLIQUE de forma natural o conteúdo/atualização da atividade como se estivesse falando ao vivo para o cliente. ${prompt}. O texto deve ser curto (máximo 3 frases) e soar como fala natural. Não use emojis, asteriscos ou formatação. Comece direto sem saudação genérica.`,
              },
            });
            audioText = aiData?.result || message;
          } catch {
            audioText = message;
          } finally {
            setGeneratingAudioText(false);
          }
        }

        await onConfirm({
          groupJid: group.group_jid,
          message,
          sendAudio,
          audioText,
        });
      } else {
        await onConfirm();
      }
    } finally {
      setSubmitting(false);
      onClose();
    }
  };

  const hasGroups = groups.length > 0;
  const isProcessing = submitting || generatingAudioText || postponing;

  /**
   * Trocar o prazo e clicar em "Concluir + próxima" NÃO adia: a atividade
   * aberta é concluída com o prazo antigo e a data nova vai só para a filha
   * (`handleCompleteAndCreateNextWithNotify` conclui sem regravar a mãe). Quem
   * só queria adiar acabava concluindo — no PREV 180 foram 8 conclusões em 10
   * minutos, cada clique deixando uma atividade concluída a mais no histórico.
   * Quando o formulário tem prazo diferente do gravado, o dialog diz o que vai
   * acontecer e oferece a saída certa.
   */
  const prazoMudou = !!currentDeadline && !!nextDeadline && currentDeadline !== nextDeadline;
  const paraFrente = prazoMudou && (nextDeadline as string) > (currentDeadline as string);

  const adiarEmVezDeConcluir = async () => {
    if (!onPostponeInstead || !nextDeadline) return;
    setPostponing(true);
    try {
      await onPostponeInstead(nextDeadline);
      onClose();
    } finally {
      setPostponing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Concluir e Criar Próxima Atividade
          </DialogTitle>
          <DialogDescription>
            Deseja notificar o grupo do WhatsApp sobre esta atividade?
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Prazo mexido no formulário: diz o que o botão realmente faz e
                oferece o adiar de verdade. Ver `prazoMudou` acima. */}
            {prazoMudou && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 space-y-2">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-xs leading-snug">
                    Você mudou o prazo de <strong>{diaMes(currentDeadline as string)}</strong> para{' '}
                    <strong>{diaMes(nextDeadline as string)}</strong>. Concluir agora encerra{' '}
                    <strong>esta</strong> atividade no prazo {diaMes(currentDeadline as string)} — o{' '}
                    {diaMes(nextDeadline as string)} vai para a <strong>próxima</strong>, que nasce como
                    uma atividade nova.
                  </p>
                </div>
                {onPostponeInstead && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isProcessing}
                    className="w-full h-8 text-xs gap-1"
                    onClick={adiarEmVezDeConcluir}
                  >
                    {postponing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CalendarClock className="h-3.5 w-3.5" />}
                    {paraFrente ? 'Só adiar' : 'Só mudar o prazo'} para {diaMes(nextDeadline as string)} — não concluir
                  </Button>
                )}
              </div>
            )}

            {/* Notify or not */}
            <RadioGroup value={notifyGroup} onValueChange={(v: 'yes' | 'no') => setNotifyGroup(v)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="yes" id="notify-yes" disabled={!hasGroups} />
                <Label htmlFor="notify-yes" className={!hasGroups ? 'text-muted-foreground' : ''}>
                  Notificar no grupo
                  {!hasGroups && <span className="text-xs ml-1">(nenhum grupo vinculado)</span>}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="no" id="notify-no" />
                <Label htmlFor="notify-no">Não notificar</Label>
              </div>
            </RadioGroup>

            {/* Group selection */}
            {notifyGroup === 'yes' && hasGroups && (
              <div className="space-y-3 pl-1 border-l-2 border-primary/20 ml-2">
                {groups.length > 1 && (
                  <div className="pl-3">
                    <Label className="text-xs text-muted-foreground mb-1 block">Qual grupo?</Label>
                    <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione o grupo" />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map(g => (
                          <SelectItem key={g.id} value={g.id} className="text-xs">
                            👥 {g.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Audio option */}
                <div className="pl-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="send-audio"
                      checked={sendAudio}
                      onCheckedChange={(v) => setSendAudio(!!v)}
                    />
                    <Label htmlFor="send-audio" className="text-sm flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5" />
                      Enviar áudio junto
                    </Label>
                  </div>

                  {sendAudio && (
                    <div className="space-y-2 ml-6">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Tom do áudio (a IA vai explicar, não ler o texto)
                      </Label>
                      <Select value={audioTone} onValueChange={setAudioTone}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AUDIO_TONES.map(t => (
                            <SelectItem key={t.key} value={t.key} className="text-xs">
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {audioTone === 'custom' && (
                        <Textarea
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          placeholder="Descreva como quer que a IA explique..."
                          className="text-xs min-h-[60px]"
                        />
                      )}

                      <p className="text-[10px] text-muted-foreground">
                        🎙️ O áudio será gerado com a voz da sua instância do WhatsApp
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isProcessing || (notifyGroup === 'yes' && !selectedGroupId)}>
            {isProcessing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                {generatingAudioText ? 'Gerando áudio...' : 'Processando...'}
              </>
            ) : (
              <>
                {notifyGroup === 'yes' ? <Send className="h-3.5 w-3.5 mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                {notifyGroup === 'yes' ? 'Concluir e Notificar' : 'Concluir'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
