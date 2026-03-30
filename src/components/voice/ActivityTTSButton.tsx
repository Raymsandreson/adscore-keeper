import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, Loader2, Send, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ActivityTTSButtonProps {
  messageText: string;
  leadId?: string;
  contactId?: string;
}

export function ActivityTTSButton({ messageText, leadId, contactId }: ActivityTTSButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [phones, setPhones] = useState<{ label: string; phone: string; chatId?: string }[]>([]);

  // Fetch available phones from lead/contact
  useEffect(() => {
    const fetchPhones = async () => {
      const results: { label: string; phone: string; chatId?: string }[] = [];

      if (contactId) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('full_name, phone, whatsapp_group_id')
          .eq('id', contactId)
          .maybeSingle() as any;
        if (contact?.phone) {
          results.push({ label: `${contact.full_name} (${contact.phone})`, phone: contact.phone });
        }
        if (contact?.whatsapp_group_id) {
          results.push({
            label: `👥 Grupo ${contact.full_name}`,
            phone: contact.whatsapp_group_id,
            chatId: contact.whatsapp_group_id,
          });
        }
      }

      if (leadId) {
        // Get contacts linked to this lead
        const { data: linkedContacts } = await supabase
          .from('contact_leads')
          .select('contact_id, contacts(full_name, phone)')
          .eq('lead_id', leadId);

        if (linkedContacts) {
          for (const lc of linkedContacts) {
            const c = lc.contacts as any;
            if (c?.phone && !results.some(r => r.phone === c.phone)) {
              results.push({ label: `${c.full_name} (${c.phone})`, phone: c.phone });
            }
          }
        }

        // Check lead's registered group and name
        const { data: lead } = await supabase
          .from('leads')
          .select('lead_name, whatsapp_group_id, lead_phone')
          .eq('id', leadId)
          .maybeSingle() as any;

        // If lead has a registered WhatsApp group ID, use it
        if (lead?.whatsapp_group_id) {
          results.push({
            label: `👥 Grupo ${lead.lead_name || 'do Lead'}`,
            phone: lead.whatsapp_group_id,
            chatId: lead.whatsapp_group_id,
          });
        }

        // If lead has a phone, add it
        if (lead?.lead_phone && !results.some(r => r.phone === lead.lead_phone)) {
          results.push({ label: `${lead.lead_name || 'Lead'} (${lead.lead_phone})`, phone: lead.lead_phone });
        }

        // Also auto-detect groups from message history
        const { data: groupMsgs } = await supabase
          .from('whatsapp_messages')
          .select('phone')
          .eq('lead_id', leadId)
          .like('phone', '%@g.us%')
          .limit(5);

        if (groupMsgs) {
          const seenGroups = new Set<string>(lead?.whatsapp_group_id ? [lead.whatsapp_group_id] : []);
          for (const msg of groupMsgs) {
            const groupPhone = msg.phone;
            if (groupPhone && !seenGroups.has(groupPhone)) {
              seenGroups.add(groupPhone);
              results.push({
                label: `👥 Grupo detectado (${groupPhone.split('@')[0].slice(-6)})`,
                phone: groupPhone,
                chatId: groupPhone,
              });
            }
          }
        }
      }

      setPhones(results);
    };

    fetchPhones();
  }, [leadId, contactId]);

  const generateAudio = async (): Promise<string | null> => {
    if (!messageText.trim()) {
      toast.error('Nenhuma mensagem para gerar áudio');
      return null;
    }

    setGenerating(true);
    try {
      const { data, error } = await cloudFunctions.invoke('elevenlabs-tts', {
        body: { text: messageText },
      });

      if (error) throw error;
      if (data?.audio_url) {
        setAudioUrl(data.audio_url);
        return data.audio_url;
      } else {
        throw new Error('Nenhum áudio gerado');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao gerar áudio');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const sendAudioToWhatsApp = async (phone: string, chatId?: string) => {
    setSending(true);
    try {
      // Generate audio if not already generated
      let url = audioUrl;
      if (!url) {
        url = await generateAudio();
        if (!url) return;
      }

      // Send via send-whatsapp edge function
      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'send_media',
          phone,
          chat_id: chatId || phone,
          media_url: url,
          media_type: 'audio/mpeg',
          contact_id: contactId || null,
          lead_id: leadId || null,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao enviar');

      // Also send the text message
      const { error: textError } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          phone,
          chat_id: chatId || phone,
          message: messageText,
          contact_id: contactId || null,
          lead_id: leadId || null,
        },
      });

      if (textError) console.error('Erro ao enviar texto:', textError);

      toast.success('Áudio e mensagem enviados via WhatsApp!');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar áudio');
    } finally {
      setSending(false);
    }
  };

  const isLoading = generating || sending;
  const hasPhones = phones.length > 0;

  return (
    <div className="flex items-center gap-2">
      {hasPhones ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={isLoading || !messageText.trim()}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
              {generating ? 'Gerando...' : sending ? 'Enviando...' : 'Áudio'}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onClick={generateAudio} disabled={isLoading}>
              <Volume2 className="h-4 w-4 mr-2" />
              Apenas gerar áudio
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {phones.map((p, i) => (
              <DropdownMenuItem
                key={i}
                onClick={() => sendAudioToWhatsApp(p.phone, p.chatId)}
                disabled={isLoading}
              >
                <Send className="h-4 w-4 mr-2" />
                Enviar para {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={generateAudio}
          disabled={isLoading || !messageText.trim()}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
          {generating ? 'Gerando...' : 'Gerar áudio'}
        </Button>
      )}
      {audioUrl && (
        <div className="flex items-center gap-2">
          <audio controls src={audioUrl} className="h-8" />
        </div>
      )}
    </div>
  );
}
