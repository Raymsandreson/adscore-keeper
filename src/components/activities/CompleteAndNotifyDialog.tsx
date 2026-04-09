import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Volume2, Send, MessageCircle, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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

interface GroupOption {
  id: string;
  label: string;
  group_jid: string;
  group_name: string | null;
}

interface CompleteAndNotifyDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (notifyOptions?: { groupJid: string; message: string; sendAudio: boolean; audioText?: string }) => Promise<void>;
  leadId: string | null;
  buildMsg: (() => string) | null;
}

export function CompleteAndNotifyDialog({ open, onClose, onConfirm, leadId, buildMsg }: CompleteAndNotifyDialogProps) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Choices
  const [notifyGroup, setNotifyGroup] = useState<'yes' | 'no'>('no');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [sendAudio, setSendAudio] = useState(false);
  const [audioTone, setAudioTone] = useState('humanized');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatingAudioText, setGeneratingAudioText] = useState(false);

  // Fetch groups for the lead
  useEffect(() => {
    if (!open || !leadId) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('lead_whatsapp_groups')
        .select('id, label, group_jid, group_name')
        .eq('lead_id', leadId);
      
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
        const { data: lead } = await supabase
          .from('leads')
          .select('whatsapp_group_id, lead_name')
          .eq('id', leadId)
          .maybeSingle();
        if (lead?.whatsapp_group_id) {
          groupOptions.push({
            id: 'legacy',
            label: `Grupo ${lead.lead_name || 'do Lead'}`,
            group_jid: lead.whatsapp_group_id,
            group_name: lead.lead_name,
          });
        }
      }

      setGroups(groupOptions);
      if (groupOptions.length === 1) setSelectedGroupId(groupOptions[0].id);
      if (groupOptions.length > 0) setNotifyGroup('yes');
      setLoading(false);
    })();
  }, [open, leadId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
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
                customPrompt: `Você é o dono desta instância de WhatsApp. Gere APENAS o texto que será convertido em áudio para enviar ao grupo do cliente. NÃO leia o texto literal da mensagem escrita. Em vez disso, EXPLIQUE de forma natural o conteúdo/atualização da atividade como se estivesse falando ao vivo para o cliente. ${prompt}. O texto deve ser curto (máximo 3 frases) e soar como fala natural. Não use emojis, asteriscos ou formatação. Comece direto sem saudação genérica.`,
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
  const isProcessing = submitting || generatingAudioText;

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

// Need to import CheckCircle2
import { CheckCircle2 } from 'lucide-react';
