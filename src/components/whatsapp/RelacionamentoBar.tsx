import { useState } from 'react';
import { Handshake, Sparkles, Loader2, Check, Pencil } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { OrigemDoRelacionamento } from '@/lib/relacionamentoDoContato';

interface Props {
  rotulos: string[];
  slugs: string[];
  origem: OrigemDoRelacionamento;
  /** Trecho que sustenta a leitura ("o nome traz 'parceiro'"). */
  motivo?: string;
  /** IA lendo a conversa agora. */
  lendo?: boolean;
  opcoes: { name: string; label: string }[];
  onConfirmar: () => Promise<void> | void;
  onDefinir: (slugs: string[]) => Promise<void> | void;
}

/**
 * Barra fina no topo da conversa: quem é essa pessoa para nós.
 *
 * Só aparece quando o relacionamento é INDÍCIO — lido do nome ou pela IA e
 * ainda não confirmado por ninguém. Relacionamento já gravado no contato não
 * ocupa espaço nenhum: ele já está certo, e a IA já o recebe no prompt.
 *
 * Confirmar grava em `contacts.classifications` e a conversa seguinte nasce
 * sabendo — é o que impede a IA de ser chamada de novo para o mesmo contato.
 */
export function RelacionamentoBar({
  rotulos, slugs, origem, motivo, lendo, opcoes, onConfirmar, onDefinir,
}: Props) {
  const [editando, setEditando] = useState(false);
  const [escolha, setEscolha] = useState<string[]>(slugs);
  const [salvando, setSalvando] = useState(false);

  const indicio = origem === 'ia' || origem === 'nome';
  // Nada a confirmar e nada sendo lido: a barra não existe.
  if (!indicio && !lendo) return null;

  const confirmar = async () => {
    setSalvando(true);
    try {
      await onConfirmar();
      toast.success('Relacionamento confirmado na ficha do contato');
    } catch {
      toast.error('Não deu para gravar o relacionamento');
    } finally {
      setSalvando(false);
    }
  };

  const salvarCorrecao = async () => {
    setSalvando(true);
    try {
      await onDefinir(escolha);
      setEditando(false);
      toast.success('Relacionamento corrigido na ficha do contato');
    } catch {
      toast.error('Não deu para gravar o relacionamento');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="w-full flex items-center gap-2 px-3 py-1.5 bg-card border-b">
      <Handshake className={cn('h-3.5 w-3.5 shrink-0', indicio ? 'text-sky-600' : 'text-muted-foreground')} />
      <span className="text-[10px] font-medium text-muted-foreground shrink-0 inline-flex items-center gap-1">
        Relacionamento conosco
        {origem === 'ia' && <Sparkles className="h-2.5 w-2.5 text-primary" />}
      </span>

      {indicio ? (
        <span className="flex items-center gap-1 min-w-0 overflow-hidden">
          {rotulos.slice(0, 3).map((r) => (
            <span
              key={r}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900 truncate max-w-[160px]"
            >
              {r}
            </span>
          ))}
          <span className="text-[10px] text-muted-foreground truncate">
            {origem === 'ia' ? 'lido pela IA na conversa' : 'lido do nome'}
            {motivo ? ` — ${motivo}` : ''}
          </span>
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground truncate inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> vendo quem é esse contato…
        </span>
      )}

      {indicio && (
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando}
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-900 dark:text-sky-300 dark:hover:bg-sky-950/30"
            title="Gravar esse relacionamento na ficha do contato"
          >
            {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirmar
          </button>

          {/* Corrigir sem sair da conversa: nenhum clique aqui troca de tela. */}
          <Popover
            open={editando}
            onOpenChange={(v) => { setEditando(v); if (v) setEscolha(slugs); }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border text-muted-foreground hover:bg-accent/40"
                title="Corrigir o relacionamento"
              >
                <Pencil className="h-3 w-3" /> Corrigir
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-2">
              <p className="text-[11px] font-medium mb-1.5">Quem é essa pessoa para nós?</p>
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {opcoes.map((o) => (
                  <label key={o.name} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                    <Checkbox
                      checked={escolha.includes(o.name)}
                      onCheckedChange={(v) =>
                        setEscolha((prev) => (v ? [...prev, o.name] : prev.filter((s) => s !== o.name)))
                      }
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={salvarCorrecao}
                disabled={salvando}
                className="mt-2 w-full text-[11px] font-semibold py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : 'Salvar na ficha'}
              </button>
            </PopoverContent>
          </Popover>
        </span>
      )}
    </div>
  );
}
