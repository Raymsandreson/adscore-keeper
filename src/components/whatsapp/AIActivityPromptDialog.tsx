import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2 } from 'lucide-react';

const DEFAULT_PROMPT = `Você é um coordenador jurídico inteligente. Analise o caso fechado abaixo e crie atividades específicas para cada membro da equipe processual, baseando-se na DESCRIÇÃO DO CARGO de cada um.

Regras:
- Crie atividades RELEVANTES para o caso específico, não genéricas
- Cada atividade deve ser atribuída ao membro cujo cargo é mais adequado
- O título deve ser curto e em MAIÚSCULAS
- A descrição deve ser detalhada com o que precisa ser feito
- Defina prazos razoáveis em dias úteis a partir de hoje
- Prioridade: "normal", "alta" ou "urgente" dependendo da natureza
- Use as informações das mensagens e dados coletados para contextualizar
- Não crie mais de 2 atividades por membro
- Se um cargo não tem relação com o caso, não crie atividade para ele
- Tipo de atividade: use "tarefa", "prazo", "audiencia", "reuniao" conforme aplicável`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  onConfirm: (prompt: string) => void;
  loading: boolean;
}

export function AIActivityPromptDialog({ open, onOpenChange, leadName, onConfirm, loading }: Props) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Gerar Atividades IA — {leadName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Prompt de geração (edite conforme necessidade)
          </label>
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={12}
            className="text-xs leading-relaxed font-mono"
            placeholder="Instruções para a IA..."
          />
          <p className="text-[10px] text-muted-foreground">
            A IA usará este prompt + contexto do lead (mensagens, dados coletados, processos) + equipe disponível.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => setPrompt(DEFAULT_PROMPT)} disabled={loading}>
            Restaurar padrão
          </Button>
          <Button size="sm" onClick={() => onConfirm(prompt)} disabled={loading || !prompt.trim()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            Gerar Atividades
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DEFAULT_PROMPT };
