import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, Check, X, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { VoiceInputButton } from '@/components/ui/voice-input-button';

interface FollowupStep {
  action_type: 'whatsapp_message' | 'call' | 'create_activity';
  delay_minutes: number;
  message_template?: string;
  assigned_to?: string;
  activity_type?: string;
  priority?: string;
}

interface ShortcutConfig {
  shortcut_name: string;
  description: string;
  prompt_instructions: string;
  followup_steps: FollowupStep[];
}

interface Props {
  onApply: (config: ShortcutConfig) => void;
  onClose: () => void;
  existingConfig?: ShortcutConfig | null;
}

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-shortcut-config`;

export function AIShortcutGenerator({ onApply, onClose, existingConfig }: Props) {
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ShortcutConfig | null>(null);

  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.error('Descreva o que o atalho deve fazer');
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const payload: any = { description: description.trim() };
      if (existingConfig) {
        payload.existing_config = existingConfig;
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
    toast.success('Atalho configurado pela IA!');
  };

  const formatDelay = (mins: number) => {
    if (mins >= 1440) return `${Math.round(mins / 1440)}d`;
    if (mins >= 60) return `${Math.round(mins / 60)}h`;
    return `${mins}min`;
  };

  const actionLabels: Record<string, string> = {
    whatsapp_message: '📱 Mensagem WhatsApp',
    call: '📞 Ligação',
    create_activity: '📋 Atividade',
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Criar Atalho com IA</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {existingConfig
            ? `Editando "${existingConfig.shortcut_name}" — descreva as mudanças desejadas.`
            : 'Descreva o que o atalho deve fazer e a IA configura tudo: nome, prompt, follow-up.'}
        </p>

        {!result && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Textarea
                placeholder={existingConfig
                  ? "Ex: Mude o tom para mais formal, adicione mais uma etapa de follow-up por ligação após 24h..."
                  : "Ex: Atalho para gerar procuração ad judicia. Deve coletar nome completo, CPF, RG, endereço, estado civil e e-mail. Tom profissional mas acolhedor. Follow-up a cada 1h se não assinar, máximo 3 cobranças."}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="min-h-[80px] text-sm flex-1"
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
                  Gerando configuração...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Gerar Atalho Completo
                </>
              )}
            </Button>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {/* Preview */}
            <div className="space-y-2 p-3 rounded-lg border bg-background">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-primary">@wjia {result.shortcut_name}</span>
              </div>
              {result.description && (
                <p className="text-[11px] text-muted-foreground">{result.description}</p>
              )}

              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground">📝 Prompt ({result.prompt_instructions.length} chars)</span>
                <p className="text-[10px] text-muted-foreground/70 line-clamp-3">
                  {result.prompt_instructions}
                </p>
              </div>

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
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setResult(null)}>
                Refazer
              </Button>
              <Button size="sm" className="flex-1" onClick={handleApply}>
                <Check className="h-3.5 w-3.5 mr-1" />
                Usar esta Configuração
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
