// =============================================================================
// Perguntar à peça — o campo de pergunta livre sobre o documento do marco.
//
// Pedido do Raym (27/08/2026): "ter também uma ia para perguntar sobre a peça em
// si que subsidia o marco".
//
// Vive separado do diálogo de evidência porque é uma conversa, com estado
// próprio (o que já foi perguntado, o que está sendo esperado), e porque o
// mesmo bloco serve para qualquer peça — não só a do marco.
//
// A resposta é LEITURA. Nada aqui vira valor, marco ou parcela; o rodapé diz
// isso, porque uma resposta segura de IA ao lado de um número é exatamente o
// tipo de coisa que alguém copia para uma proposta.
// =============================================================================
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { usePerguntasDaPeca } from '@/hooks/usePerguntasDaPeca';

/**
 * Perguntas que a conferência faz o tempo todo. Existem para tirar o custo do
 * "o que eu pergunto?" — que é o que faz uma caixa de texto vazia não ser usada.
 */
const SUGESTOES = [
  'Esta peça decidiu o mérito ou um recurso processual (agravo, admissibilidade)?',
  'Que valores esta peça fixa, e para quem?',
  'Esta peça encerra o processo ou ele continua?',
];

interface Props {
  documentoId: number;
  tituloPeca: string | null;
  marcoChave?: string | null;
  marcoRotulo?: string | null;
}

export function PerguntarAPecaBox({ documentoId, tituloPeca, marcoChave, marcoRotulo }: Props) {
  const { perguntas, aguardando, perguntar } = usePerguntasDaPeca(documentoId);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (pergunta: string) => {
    setErro(null);
    const r = await perguntar(pergunta, { marcoChave, marcoRotulo });
    if (r.ok) setTexto('');
    else setErro(r.erro ?? 'não consegui perguntar');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3 shrink-0" />
        Perguntar sobre <span className="font-medium text-foreground">{tituloPeca || 'a peça'}</span>
      </div>

      {perguntas.length > 0 && (
        <div className="space-y-2">
          {perguntas.map(p => (
            <div key={p.id} className="rounded-md border bg-muted/20 p-2 text-xs">
              <div className="flex items-start gap-1.5 font-medium">
                <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0">{p.pergunta}</span>
              </div>
              {p.resposta ? (
                <p className="mt-1.5 whitespace-pre-wrap leading-snug text-muted-foreground">{p.resposta}</p>
              ) : p.erro ? (
                <p className="mt-1.5 text-destructive">{p.erro}</p>
              ) : (
                <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> lendo a peça…
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {perguntas.length === 0 && !aguardando && (
        <div className="flex flex-wrap gap-1">
          {SUGESTOES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => void enviar(s)}
              className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Pergunte qualquer coisa sobre esta peça…"
          rows={2}
          maxLength={1000}
          disabled={aguardando}
          className="min-h-0 resize-none text-xs"
          onKeyDown={e => {
            // Enter manda, Shift+Enter quebra linha: é uma pergunta, não um texto.
            if (e.key === 'Enter' && !e.shiftKey && texto.trim().length >= 3 && !aguardando) {
              e.preventDefault();
              void enviar(texto);
            }
          }}
        />
        <Button
          size="sm"
          className="gap-1.5"
          disabled={aguardando || texto.trim().length < 3}
          onClick={() => void enviar(texto)}
        >
          {aguardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Perguntar
        </Button>
      </div>

      {erro && <p className="text-[11px] text-destructive">{erro}</p>}

      <p className="text-[10px] leading-snug text-muted-foreground">
        A IA lê o PDF desta peça e responde só com o que está nela. É leitura para conferir — não
        muda valor, marco nem parcela, e não substitui abrir a peça.
      </p>
    </div>
  );
}
