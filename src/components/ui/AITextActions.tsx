import { useState, useCallback } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const AI_ACTIONS: Record<string, { label: string; icon: string }> = {
  summarize: { label: 'Resumir', icon: '📝' },
  fix_typos: { label: 'Corrigir erros', icon: '✏️' },
  humanize: { label: 'Humanizar', icon: '🤝' },
  help_write: { label: 'Ajude-me a escrever', icon: '💡' },
};
const TONE_ACTIONS: Record<string, string> = {
  formal: 'Formal',
  friendly: 'Amigável',
  funny: 'Engraçado',
  engaging: 'Cativante',
  concise: 'Conciso',
  empathetic: 'Empático',
};
const TRANSLATE_ACTIONS: Record<string, string> = {
  translate_en: 'Inglês',
  translate_es: 'Espanhol',
  translate_pt: 'Português',
};
const DRAFT_ACTIONS: Record<string, string> = {
  draft_email: 'E-mail',
  draft_message: 'Mensagem WhatsApp',
  draft_report: 'Relatório',
};

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  buttonClassName?: string;
}

export function AITextActions({ value, onChange, className, buttonClassName }: Props) {
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [lastText, setLastText] = useState('');
  const [lastCustom, setLastCustom] = useState<string | undefined>(undefined);

  const fetchOptions = useCallback(async (action: string, text: string, customPrompt?: string) => {
    setLoading(true);
    setLastAction(action);
    setLastText(text);
    setLastCustom(customPrompt);
    try {
      const body: Record<string, string> = { text, action };
      if (customPrompt) body.custom_prompt = customPrompt;
      const { data, error } = await supabase.functions.invoke('ai-text-editor', { body });
      if (error) throw error;
      if (data?.options?.length) setOptions(data.options);
      else toast.error('Nenhuma sugestão retornada');
    } catch (e: any) {
      console.error('AI editor error:', e);
      toast.error('Erro ao processar com IA');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAction = (action: string) => {
    const text = (value || '').trim();
    if (!text) {
      toast.error('Escreva algo primeiro para usar a IA');
      return;
    }
    fetchOptions(action, text);
  };

  const handleCustom = () => {
    const text = (value || '').trim();
    const label = text
      ? 'Como você quer que a IA edite o texto?'
      : 'O que você quer que a IA escreva?';
    const p = window.prompt(label);
    if (!p?.trim()) return;
    fetchOptions('custom', text || p.trim(), p.trim());
  };

  const apply = (text: string) => {
    onChange(text);
    setOptions([]);
    toast.success('Texto aplicado!');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={loading}
            title="AI Edition"
            className={cn(
              'p-1.5 rounded hover:bg-accent transition-colors flex items-center gap-0.5 text-xs',
              loading && 'opacity-50',
              buttonClassName,
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn('w-56', className)}>
          {Object.entries(AI_ACTIONS).map(([key, { label, icon }]) => (
            <DropdownMenuItem key={key} onClick={() => handleAction(key)}>
              <span className="mr-2">{icon}</span> {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><span className="mr-2">🎨</span> Mudar tom</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {Object.entries(TONE_ACTIONS).map(([k, l]) => (
                <DropdownMenuItem key={k} onClick={() => handleAction(k)}>{l}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><span className="mr-2">🌍</span> Traduzir</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {Object.entries(TRANSLATE_ACTIONS).map(([k, l]) => (
                <DropdownMenuItem key={k} onClick={() => handleAction(k)}>{l}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><span className="mr-2">📄</span> Rascunhar como</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {Object.entries(DRAFT_ACTIONS).map(([k, l]) => (
                <DropdownMenuItem key={k} onClick={() => handleAction(k)}>{l}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCustom}>
            <span className="mr-2">💬</span> Prompt personalizado
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={options.length > 0} onOpenChange={(o) => !o && setOptions([])}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Sugestões da IA
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => apply(opt)}
                className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors text-sm whitespace-pre-wrap"
              >
                <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Opção {i + 1}</div>
                {opt}
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || !lastAction}
              onClick={() => lastAction && fetchOptions(lastAction, lastText, lastCustom)}
            >
              {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Gerar novamente
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOptions([])}>Cancelar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
