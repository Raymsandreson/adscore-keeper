import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Phone,
  PhoneOutgoing,
  PhoneIncoming,
  Clock,
  User,
  FileText,
  Sparkles,
  Play,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CallRecord {
  id: string;
  call_type: string;
  call_result: string;
  contact_phone: string | null;
  duration_seconds: number | null;
  ai_summary: string | null;
  ai_transcript: string | null;
  audio_url: string | null;
  notes: string | null;
  phone_used: string | null;
  tags: string[] | null;
  created_at: string;
  user_id: string;
  lead_name: string | null;
}

interface Props {
  contactId: string;
  contactPhone: string | null;
}

const RESULT_CONFIG: Record<string, { label: string; color: string }> = {
  completed: { label: 'Atendida', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  atendeu: { label: 'Atendida', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  nao_atendeu: { label: 'Não atendeu', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  em_andamento: { label: 'Em andamento', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  ocupado: { label: 'Ocupado', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  caixa_postal: { label: 'Caixa postal', color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400' },
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ContactCallHistory({ contactId, contactPhone }: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchCalls();
  }, [contactId, contactPhone]);

  const fetchCalls = async () => {
    setLoading(true);
    try {
      // Fetch by contact_id OR by phone number match
      let query = supabase
        .from('call_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (contactId && contactPhone) {
        const cleanPhone = contactPhone.replace(/\D/g, '');
        const phoneSuffix = cleanPhone.slice(-8);
        query = query.or(`contact_id.eq.${contactId},contact_phone.ilike.%${phoneSuffix}%`);
      } else if (contactId) {
        query = query.eq('contact_id', contactId);
      } else if (contactPhone) {
        const cleanPhone = contactPhone.replace(/\D/g, '');
        const phoneSuffix = cleanPhone.slice(-8);
        query = query.ilike('contact_phone', `%${phoneSuffix}%`);
      } else {
        setLoading(false);
        return;
      }

      const { data, error } = await query;
      if (error) throw error;

      setCalls(data || []);

      // Fetch user names
      const userIds = [...new Set((data || []).map(c => c.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', userIds);
        
        const map: Record<string, string> = {};
        profileData?.forEach(p => { map[p.user_id] = p.full_name || 'Usuário'; });
        setProfiles(map);
      }
    } catch (err) {
      console.error('Error fetching call history:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="text-center py-8">
        <Phone className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">Nenhuma chamada registrada</p>
        <p className="text-xs text-muted-foreground mt-1">
          Use a extensão CallFace para fazer chamadas e os registros aparecerão aqui
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground font-medium">
          {calls.length} chamada{calls.length !== 1 ? 's' : ''} registrada{calls.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-2">
        {calls.map((call) => {
          const result = RESULT_CONFIG[call.call_result] || { label: call.call_result, color: 'bg-muted text-muted-foreground' };
          const isExpanded = expandedId === call.id;
          const isCallFace = call.tags?.includes('callface') || call.phone_used === 'callface';
          const callerName = profiles[call.user_id] || 'Desconhecido';

          return (
            <div key={call.id} className="border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : call.id)}
              >
                <div className="shrink-0">
                  {call.call_type === 'outbound' || call.call_type === 'realizada' ? (
                    <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                  ) : (
                    <PhoneIncoming className="h-4 w-4 text-green-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{callerName}</span>
                    {isCallFace && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">CallFace</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {format(new Date(call.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-[10px] ${result.color} border-0`}>
                    {result.label}
                  </Badge>
                  {call.duration_seconds && call.duration_seconds > 0 && (
                    <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(call.duration_seconds)}
                    </span>
                  )}
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t px-3 pb-3 pt-2 space-y-3 bg-muted/20">
                  {/* Caller info */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span>Realizada por: <strong className="text-foreground">{callerName}</strong></span>
                  </div>

                  {/* Lead link */}
                  {call.lead_name && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <span>Lead: <strong className="text-foreground">{call.lead_name}</strong></span>
                    </div>
                  )}

                  {/* Audio player */}
                  {call.audio_url && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                        <Play className="h-3 w-3" /> Gravação
                      </p>
                      <audio controls className="w-full h-8" src={call.audio_url}>
                        Seu navegador não suporta áudio.
                      </audio>
                    </div>
                  )}

                  {/* AI Summary */}
                  {call.ai_summary && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Resumo IA
                      </p>
                      <p className="text-xs whitespace-pre-wrap bg-background rounded p-2 border">
                        {call.ai_summary}
                      </p>
                    </div>
                  )}

                  {/* Transcription */}
                  {call.ai_transcript && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                        <FileText className="h-3 w-3" /> Transcrição
                      </p>
                      <p className="text-xs whitespace-pre-wrap bg-background rounded p-2 border max-h-40 overflow-y-auto">
                        {call.ai_transcript}
                      </p>
                    </div>
                  )}

                  {/* Notes */}
                  {call.notes && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground">Notas</p>
                      <p className="text-xs whitespace-pre-wrap">{call.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
