import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, Check, X, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface FollowupStep {
  action_type: 'whatsapp_message' | 'call' | 'create_activity';
  delay_minutes: number;
  assigned_to?: string;
  activity_type?: string;
  priority?: string;
}

interface ShortcutConfig {
  shortcut_name: string;
  description: string;
  prompt_instructions: string;
  media_extraction_prompt?: string;
  followup_steps: FollowupStep[];
}

interface Props {
  onApply: (config: ShortcutConfig) => void;
  onClose: () => void;
  existingConfig?: ShortcutConfig | null;
  templateFields?: { variable: string; label: string; required: boolean }[];
  templateName?: string;
}

const GENERATE_URL = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/generate-shortcut-config`;

export function AIShortcutGenerator({ onApply, onClose, existingConfig, templateFields, templateName }: Props) {
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ShortcutConfig | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.error('Descreva o que o agente deve fazer');
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const payload: any = { description: description.trim() };
      if (existingConfig) {
        payload.existing_config = existingConfig;
      }
      if (templateFields?.length) {
        payload.template_fields = templateFields;
        payload.template_name = templateName;
      }

      const resp = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${resp.status}`);
      }

      const data = await resp.json();
      // Strip message_template from followup steps
      if (data.followup_steps) {
        data.followup_steps = data.followup_steps.map((s: any) => {
          const { message_template, ...rest } = s;
          return rest;
        });
      }
      setResult(data);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar configuração');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (!result) return;
    onApply(result);
    onClose();
    toast.success('Agente configurado pela IA!');
  };

  const formatDelay = (mins: number) => {
    if (mins >= 1440) return `${Math.round(mins / 1440)}d`;
    if (mins >= 60) return `${Math.round(mins / 60)}h`;
    return `${mins}min`;
  };

  const actionLabels: Record<string, string> = {
    whatsapp_message: '📱 WhatsApp',
    call: '📞 Ligação',
    create_activity: '📋 Atividade',
  };

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">
            {existingConfig ? `Editar "${existingConfig.shortcut_name}" com IA` : 'Criar Agente com IA'}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {existingConfig
          ? 'Descreva as mudanças desejadas — a IA atualiza prompt, follow-up e tempos.'
          : 'Descreva o que o agente deve fazer — a IA cria tudo: nome, prompt, sequência de follow-up com tempos ideais.'}
      </p>

      {!result && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Textarea
              placeholder={existingConfig
                ? "Ex: Mude o tom para mais formal, adicione ligação após 2 dias..."
                : "Ex: Agente para procuração ad judicia. Coletar nome, CPF, RG, endereço. Tom profissional. Follow-up automático."}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="min-h-[70px] text-xs flex-1"
              autoFocus
            />
            <VoiceInputButton
              onResult={text => setDescription(prev => prev ? `${prev} ${text}` : text)}
              className="mt-1"
            />
          </div>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!description.trim() || isGenerating}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {existingConfig ? 'Gerar Edição' : 'Gerar Agente'}
              </>
            )}
          </Button>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="space-y-2 p-3 rounded-lg border bg-background">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-primary">#{result.shortcut_name}</span>
            </div>
            {result.description && (
              <p className="text-[11px] text-muted-foreground">{result.description}</p>
            )}

            {/* Expandable prompt */}
            <Collapsible open={promptExpanded} onOpenChange={setPromptExpanded}>
              <CollapsibleTrigger className="flex items-center gap-1 w-full text-left hover:bg-muted/50 rounded p-1 -m-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  📝 Prompt ({result.prompt_instructions.length} chars)
                </span>
                {promptExpanded ? (
                  <ChevronUp className="h-3 w-3 text-muted-foreground ml-auto" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 p-2 rounded bg-muted/30 max-h-[300px] overflow-y-auto">
                  <p className="text-[10px] text-muted-foreground/90 whitespace-pre-wrap">
                    {result.prompt_instructions}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {!promptExpanded && (
              <p className="text-[10px] text-muted-foreground/70 line-clamp-2">
                {result.prompt_instructions}
              </p>
            )}

            {result.followup_steps.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground">🔔 Follow-up ({result.followup_steps.length} etapas)</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {result.followup_steps.map((step, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">
                      {idx > 0 && '→ '}{actionLabels[step.action_type] || step.action_type} ({formatDelay(step.delay_minutes)})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setResult(null); setPromptExpanded(false); }}>
              Refazer
            </Button>
            <Button size="sm" className="flex-1" onClick={handleApply}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Usar Configuração
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
