// =============================================================================
// "Autos apartados" — o cartão que fecha a história do processo sem fundir nada.
//
// A execução provisória tem autos próprios: CNJ próprio, rito próprio, captura
// própria. Fundir com o principal cegaria a captura do apartado (push, DataJud
// e Escavador consultam por CNJ) e apagaria o fato de ele ter vida própria —
// embargos, penhora, e o acordo que às vezes é feito lá dentro.
//
// Então o principal não engole o apartado: mostra onde ele está e abre a ficha
// dele por cima (Sheet empilhado, sem redirecionar). Cada régua continua
// inteira no seu lugar.
// =============================================================================
import { FileStack, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useProcessoApartados, VINCULO_LABEL } from '@/hooks/useProcessoApartados';

function dataBR(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('pt-BR');
}

export function ApartadosDoProcesso({
  processId,
  onAbrir,
}: {
  processId: string;
  /** Abre a ficha do apartado empilhada. Sem handler, o cartão é informativo. */
  onAbrir?: (apartadoId: string) => void;
}) {
  const { apartados } = useProcessoApartados(processId);
  if (apartados.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <FileStack className="h-3.5 w-3.5" />
        Autos apartados ({apartados.length})
      </div>
      {apartados.map(a => {
        const conteudo = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {a.process_number || 'sem número'}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {a.marco_atual
                  ? <>{a.marco_atual}{a.marco_em ? ` · ${dataBR(a.marco_em)}` : ''}</>
                  : 'sem marco detectado'}
              </span>
            </span>
            <Badge variant="outline" className="shrink-0 text-[9px]">
              {VINCULO_LABEL[a.vinculo_tipo || ''] || a.vinculo_tipo || 'vinculado'}
            </Badge>
          </>
        );
        return onAbrir ? (
          <button
            key={a.process_id}
            type="button"
            onClick={() => onAbrir(a.process_id)}
            className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-accent"
            title="Abrir a ficha destes autos por cima"
          >
            {conteudo}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <div
            key={a.process_id}
            className="flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5"
          >
            {conteudo}
          </div>
        );
      })}
      <p className="text-[9px] text-muted-foreground">
        Correm em separado, com rito próprio — a régua de cada um fica na ficha dele.
      </p>
    </div>
  );
}
