import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Send, Sparkles, Timer } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  WHATSAPP_FREIO_EVENT,
  gerarVariacoes,
  type FreioDeRitmoDetail,
} from '@/lib/whatsappFreioRitmo';

/**
 * Painel do freio de abordagem a número novo.
 *
 * Abre quando a edge `send-whatsapp` v30 barra um envio. Não existe para
 * informar o bloqueio — existe para dar a saída, que muda conforme o motivo:
 *
 *   TEXTO_REPETIDO      → 3 variações pela IA, ou reescrever à mão aqui
 *   TETO_DIARIO         → mandar pela instância que o gate sugeriu
 *   INSTANCIA_FORA_DO_AR→ idem, porque a instância atual está muda
 *   RITMO               → contagem até poder mandar, e envia ao zerar
 *
 * Painel lateral por cima, nada de redirecionar: fechar devolve a pessoa ao
 * chat, com o texto dela ainda no campo.
 */
export function FreioDeRitmoSheet() {
  const [freio, setFreio] = useState<FreioDeRitmoDetail | null>(null);
  const [texto, setTexto] = useState('');
  const [opcoes, setOpcoes] = useState<string[]>([]);
  const [gerando, setGerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [faltam, setFaltam] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FreioDeRitmoDetail>).detail;
      if (!detail) return;
      setFreio(detail);
      setTexto(detail.texto || '');
      setOpcoes([]);
      setAviso(null);
      setFaltam(detail.esperarSegundos ?? 0);
    };
    window.addEventListener(WHATSAPP_FREIO_EVENT, handler as EventListener);
    return () => window.removeEventListener(WHATSAPP_FREIO_EVENT, handler as EventListener);
  }, []);

  // Contagem do código RITMO. Só desce enquanto o painel está aberto.
  useEffect(() => {
    if (faltam <= 0) return;
    const t = setInterval(() => setFaltam((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [faltam]);

  const fechar = useCallback(() => {
    setFreio(null);
    setOpcoes([]);
    setAviso(null);
  }, []);

  const pedirVariacoes = useCallback(async () => {
    if (!freio) return;
    setGerando(true);
    setAviso(null);
    try {
      const { opcoes: novas, aviso: av } = await gerarVariacoes(
        freio.texto,
        freio.textoRepetidoEm ?? 0,
      );
      setOpcoes(novas);
      if (av) setAviso(av);
    } finally {
      setGerando(false);
    }
  }, [freio]);

  const enviar = useCallback(
    async (textoEscolhido: string, instancia?: string | null) => {
      if (!freio) return;
      const limpo = textoEscolhido.trim();
      if (!limpo) {
        toast.error('Escreva a mensagem antes de enviar.');
        return;
      }
      setEnviando(true);
      try {
        const ok = await freio.reenviar(limpo, instancia);
        // Não fecho quando falha: o gate pode ter barrado de novo (outro
        // motivo, ou a variação ainda repetida) e o painel já vai reabrir com
        // a informação nova. Fechar aqui apagaria o texto que a pessoa acabou
        // de escolher.
        if (ok) {
          toast.success(instancia ? `Enviado por "${instancia}".` : 'Mensagem enviada.');
          fechar();
        }
      } finally {
        setEnviando(false);
      }
    },
    [freio, fechar],
  );

  if (!freio) return null;

  const podeSugerirInstancia = !!freio.instanciaSugerida;
  const eTextoRepetido = freio.codigo === 'RITMO_TEXTO_REPETIDO' || freio.variarTexto === true;
  const eEspera = freio.codigo === 'RITMO_RITMO';

  return (
    <Sheet open onOpenChange={(v) => !v && fechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            Abordagem freada
          </SheetTitle>
          <SheetDescription>{freio.motivo}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6 text-sm">
          {/* ---------- texto repetido: variar ---------- */}
          {eTextoRepetido && (
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                <Sparkles className="h-4 w-4" /> Varie a mensagem
              </h4>
              <p className="mb-3 text-xs text-muted-foreground">
                Este texto já foi para {freio.textoRepetidoEm ?? 0} números diferentes. Texto colado
                indo de desconhecido em desconhecido é a assinatura mais fácil de o WhatsApp pegar.
              </p>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pedirVariacoes}
                disabled={gerando}
                className="mb-3"
              >
                {gerando ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Gerando…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-3.5 w-3.5" /> Gerar 3 variações
                  </>
                )}
              </Button>

              {aviso && <p className="mb-3 text-xs text-amber-700">{aviso}</p>}

              {opcoes.length > 0 && (
                <ul className="mb-4 space-y-2">
                  {opcoes.map((o, i) => (
                    <li key={`${i}-${o.slice(0, 24)}`}>
                      <button
                        type="button"
                        onClick={() => setTexto(o)}
                        className="w-full rounded-md border p-3 text-left transition hover:bg-muted/50"
                      >
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                          Opção {i + 1}
                        </span>
                        <span className="block whitespace-pre-wrap">{o}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                O que vai ser enviado
              </label>
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={5}
                className="mb-3"
              />
              <Button
                type="button"
                onClick={() => enviar(texto)}
                disabled={enviando || texto.trim() === freio.texto.trim()}
                className="w-full"
              >
                {enviando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" /> Enviar este texto
                  </>
                )}
              </Button>
              {texto.trim() === freio.texto.trim() && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Ainda é o texto original — o gate vai barrar de novo. Escolha uma variação ou
                  edite acima.
                </p>
              )}
            </section>
          )}

          {/* ---------- espera de ritmo ---------- */}
          {eEspera && (
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                <Timer className="h-4 w-4" /> Intervalo entre abordagens
              </h4>
              <p className="mb-3 text-xs text-muted-foreground">
                As três instâncias perdidas em 2026 abordavam desconhecidos com 5 a 7 segundos de
                intervalo. Nenhuma pessoa no aplicativo faz isso — e é isso que o WhatsApp mede.
              </p>
              <p className="mb-3 tabular-nums">
                {faltam > 0 ? (
                  <>
                    Faltam <strong>{faltam}s</strong>.
                  </>
                ) : (
                  <>Já pode enviar.</>
                )}
              </p>
              <Button
                type="button"
                onClick={() => enviar(texto)}
                disabled={enviando || faltam > 0}
                className="w-full"
              >
                {enviando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" /> Enviar agora
                  </>
                )}
              </Button>
            </section>
          )}

          {/* ---------- trocar de instância ---------- */}
          {podeSugerirInstancia && (
            <section className="border-t pt-4">
              <h4 className="mb-2 font-medium">Mandar por outra instância</h4>
              <p className="mb-3 text-xs text-muted-foreground">
                O sistema escolheu <strong>{freio.instanciaSugerida}</strong>: é a de menor risco
                com folga de cota hoje, e com preferência para quem já falou com este número.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => enviar(texto, freio.instanciaSugerida)}
                disabled={enviando}
                className="w-full"
              >
                {enviando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
                  </>
                ) : (
                  <>Enviar por &quot;{freio.instanciaSugerida}&quot;</>
                )}
              </Button>
            </section>
          )}

          {!eTextoRepetido && !eEspera && !podeSugerirInstancia && (
            <p className="text-xs text-muted-foreground">
              Não há instância saudável com folga agora. Espere o teto diário virar, ou reconecte
              uma instância que esteja fora do ar.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
