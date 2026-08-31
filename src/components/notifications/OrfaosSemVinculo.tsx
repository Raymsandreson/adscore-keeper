import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Link2, FilePlus2, EyeOff, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  useIdentificadoresOrfaos,
  TIPO_ORFAO_LABEL,
  type IdentificadorOrfao,
  type ProcessoParaVincular,
  type StatusOrfao,
} from '@/hooks/useIdentificadoresOrfaos';

/**
 * Aba "Sem vínculo" do painel de atualizações processuais.
 *
 * Cada linha é um identificador (CNJ, SEI, demanda SIT, OS, protocolo INSS)
 * que apareceu em e-mail e NÃO casou com processo cadastrado — antes isso era
 * um array descartado na resposta da função. Ordenado por última ocorrência:
 * o que está vivo em cima, o histórico do backfill embaixo.
 *
 * Ações por linha, sem sair do painel (regra de interface: nada redireciona):
 * vincular a processo existente (busca por número ou nome), criar processo,
 * ignorar. Ao vincular, os e-mails daquele identificador são reprocessados
 * para os cards retroativos nascerem no feed.
 */
export function OrfaosSemVinculo({ aberto }: { aberto: boolean }) {
  const {
    orfaos, loading, statusFiltro, setStatusFiltro,
    ignorar, vincular, criarProcesso, buscarProcessos, reprocessando,
  } = useIdentificadoresOrfaos(aberto);

  const [vinculando, setVinculando] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ProcessoParaVincular[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [agindo, setAgindo] = useState<string | null>(null);
  const buscaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce da busca: cada tecla não pode virar uma ida ao banco.
  useEffect(() => {
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    if (!vinculando || busca.trim().length < 3) { setResultados([]); return; }
    buscaTimer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await buscarProcessos(busca));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => { if (buscaTimer.current) clearTimeout(buscaTimer.current); };
  }, [busca, vinculando, buscarProcessos]);

  const fmt = (iso: string) => {
    try { return format(parseISO(iso), 'dd/MM/yyyy'); } catch { return iso; }
  };

  const abrirVinculo = (o: IdentificadorOrfao) => {
    setVinculando((atual) => (atual === o.identificador ? null : o.identificador));
    setBusca('');
    setResultados([]);
  };

  const executar = async (o: IdentificadorOrfao, acao: () => Promise<unknown>, ok: string) => {
    setAgindo(o.identificador);
    try {
      await acao();
      toast.success(ok);
    } catch (err) {
      toast.error(`Não deu: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAgindo(null);
      setVinculando(null);
    }
  };

  const filtros: Array<{ value: StatusOrfao; label: string }> = useMemo(() => [
    { value: 'novo', label: 'Novos' },
    { value: 'ignorado', label: 'Ignorados' },
    { value: 'vinculado', label: 'Vinculados' },
  ], []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-1 px-2 py-1.5 border-b shrink-0 items-center">
        {filtros.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFiltro(f.value)}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors',
              statusFiltro === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background hover:bg-accent',
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground pr-1">
          por última ocorrência
        </span>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
        ) : orfaos.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8 px-4">
            {statusFiltro === 'novo'
              ? 'Nenhum identificador sem vínculo — tudo que chegou por e-mail casou com processo cadastrado.'
              : 'Nada aqui.'}
          </p>
        ) : orfaos.map((o) => (
          <div key={o.identificador} className="px-3 py-2.5 border-b last:border-b-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium font-mono">{o.identificador_exibicao}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border">
                {TIPO_ORFAO_LABEL[o.tipo] || o.tipo}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                {o.ocorrencias}× · última {fmt(o.ultima_ocorrencia)}
              </span>
            </div>
            {(o.ultimo_assunto || o.ultimo_remetente) && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={o.ultimo_assunto || undefined}>
                {[o.ultimo_assunto, o.ultimo_remetente].filter(Boolean).join(' — ')}
              </p>
            )}
            {statusFiltro === 'novo' && (
              <div className="flex gap-1 mt-1.5">
                <Button
                  variant="outline" size="sm" className="h-6 text-[11px] gap-1"
                  disabled={agindo === o.identificador}
                  onClick={() => abrirVinculo(o)}
                >
                  <Link2 className="h-3 w-3" /> Vincular
                </Button>
                <Button
                  variant="outline" size="sm" className="h-6 text-[11px] gap-1"
                  disabled={agindo === o.identificador}
                  onClick={() => executar(o, () => criarProcesso(o),
                    'Processo criado e e-mails reprocessados — os cards retroativos vão aparecer no feed.')}
                >
                  {agindo === o.identificador
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <FilePlus2 className="h-3 w-3" />} Criar processo
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground"
                  disabled={agindo === o.identificador}
                  onClick={() => executar(o, () => ignorar(o), 'Ignorado — não aparece mais em "Novos".')}
                >
                  <EyeOff className="h-3 w-3" /> Ignorar
                </Button>
              </div>
            )}
            {vinculando === o.identificador && (
              <div className="mt-2 rounded-md border bg-muted/30 p-2 space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Número ou nome do processo (mín. 3 letras)"
                    className="h-7 pl-7 text-xs"
                  />
                </div>
                {buscando && <p className="text-[10px] text-muted-foreground">Buscando…</p>}
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-accent"
                    disabled={agindo === o.identificador || reprocessando === o.identificador}
                    onClick={() => executar(o, () => vincular(o, p),
                      'Vinculado — reprocessando os e-mails deste identificador para os cards retroativos.')}
                  >
                    <span className="font-mono">{p.process_number || 'sem número'}</span>
                    <span className="text-muted-foreground"> · {p.title}</span>
                  </button>
                ))}
                {!buscando && busca.trim().length >= 3 && resultados.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">Nenhum processo com esse número/nome.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
