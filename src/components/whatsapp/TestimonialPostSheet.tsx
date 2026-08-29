/**
 * Testemunho → post de Instagram, com revisão humana obrigatória.
 *
 * Abre por cima da conversa (Sheet lateral — regra de UI: nunca redirecionar).
 * A IA propõe citação + legenda e o card já vem renderizado do Railway; aqui o
 * revisor edita, regenera a arte e SÓ ELE publica — o botão exige marcar que o
 * cliente autorizou o uso do depoimento (LGPD). Nada é postado sem esse clique.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Send, ExternalLink, Instagram } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuthContext } from '@/contexts/AuthContext';

interface TestimonialPost {
  id: string;
  quote_text: string;
  caption: string;
  display_name: string | null;
  image_url: string | null;
  post_type: 'imagem' | 'reel';
  video_url: string | null;
  status: string;
  permalink: string | null;
}

interface IgAccount {
  instagram_id: string;
  username: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string | null;
  messageText: string;
  /** true quando a bolha é um áudio — habilita o Reel com a voz do cliente. */
  hasAudio?: boolean;
  clientName?: string | null;
  phone?: string | null;
  instanceName?: string | null;
  leadId?: string | null;
  contactId?: string | null;
}

export function TestimonialPostSheet({
  open, onOpenChange, messageId, messageText, hasAudio,
  clientName, phone, instanceName, leadId, contactId,
}: Props) {
  const { user } = useAuthContext();
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [post, setPost] = useState<TestimonialPost | null>(null);
  const [quote, setQuote] = useState('');
  const [caption, setCaption] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contextLabel, setContextLabel] = useState('');
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [igUserId, setIgUserId] = useState('');
  const [consent, setConsent] = useState(false);
  // Áudio disponível → padrão é publicar COM a voz do cliente (Reel).
  const [withVoice, setWithVoice] = useState(!!hasAudio);

  const baseBody = useMemo(() => ({
    message_id: messageId || undefined,
    testimonial_text: messageText,
    client_name: clientName || undefined,
    phone: phone || undefined,
    instance_name: instanceName || undefined,
    lead_id: leadId || undefined,
    contact_id: contactId || undefined,
    created_by: user?.id || undefined,
  }), [messageId, messageText, clientName, phone, instanceName, leadId, contactId, user?.id]);

  const applyPost = useCallback((p: TestimonialPost) => {
    setPost(p);
    setQuote(p.quote_text || '');
    setCaption(p.caption || '');
    setDisplayName(p.display_name || '');
  }, []);

  const generate = useCallback(async (regenerate = false, voiceOverride?: boolean) => {
    setGenerating(true);
    try {
      const body: Record<string, unknown> = {
        ...baseBody,
        with_voice: voiceOverride ?? withVoice,
      };
      if (regenerate && post) {
        // Revisor ajustou na mão → re-renderiza a arte sem passar pela IA.
        body.regenerate_post_id = post.id;
        body.quote_text = quote;
        body.caption = caption;
        body.display_name = displayName;
        if (contextLabel) body.context_label = contextLabel;
      }
      const { data, error } = await cloudFunctions.invoke('testimonial-to-instagram-post', { body });
      if (error || !data?.post) throw new Error(error?.message || data?.error || 'Falha ao gerar o post');
      applyPost(data.post as TestimonialPost);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar o post');
    } finally {
      setGenerating(false);
    }
  }, [baseBody, post, quote, caption, displayName, contextLabel, withVoice, applyPost]);

  // Gera o rascunho na abertura (uma vez por mensagem).
  useEffect(() => {
    if (!open) return;
    setConsent(false);
    if (!post) void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Contas de Instagram disponíveis pro token configurado.
  useEffect(() => {
    if (!open || accounts.length) return;
    (async () => {
      try {
        const { data } = await cloudFunctions.invoke('list-instagram-accounts');
        const list: IgAccount[] = data?.accounts || [];
        setAccounts(list);
        if (list.length === 1) setIgUserId(list[0].instagram_id);
      } catch {
        // Sem contas: o select mostra o estado vazio e o publish fica desabilitado.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const publish = useCallback(async () => {
    if (!post || !igUserId) return;
    setPublishing(true);
    try {
      const { data, error } = await cloudFunctions.invoke('publish-instagram-testimonial', {
        body: { post_id: post.id, ig_user_id: igUserId, caption },
      });
      if (error || !data?.post) throw new Error(error?.message || data?.error || 'Falha ao publicar');
      applyPost(data.post as TestimonialPost);
      toast.success('Publicado no Instagram!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao publicar');
    } finally {
      setPublishing(false);
    }
  }, [post, igUserId, caption, applyPost]);

  const published = post?.status === 'publicado';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5" /> Post de testemunho
          </SheetTitle>
          <SheetDescription>
            Revise a arte e a legenda antes de publicar. Nada sai sem o seu clique.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 pb-8">
          {generating && !post && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {withVoice ? 'Gerando arte e montando o Reel com o áudio…' : 'Gerando citação, legenda e arte…'}
            </div>
          )}

          {post?.post_type === 'reel' && post.video_url ? (
            <div className="rounded-lg overflow-hidden border bg-muted/30">
              <video src={post.video_url} controls className="w-full h-auto" />
            </div>
          ) : post?.image_url ? (
            <div className="rounded-lg overflow-hidden border bg-muted/30">
              <img
                src={post.image_url}
                alt="Prévia do card de testemunho"
                className="w-full h-auto"
              />
            </div>
          ) : null}

          {hasAudio && post && !published && (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm cursor-pointer">
              <Checkbox
                checked={withVoice}
                onCheckedChange={(v) => {
                  const on = v === true;
                  setWithVoice(on);
                  // Trocar o modo muda a mídia — regenera na hora com o mesmo rascunho.
                  void generate(true, on);
                }}
                className="mt-0.5"
                disabled={generating}
              />
              <span>
                Publicar como <strong>Reel com a voz da cliente</strong> (o áudio original
                toca sobre o card). Desmarcado, sai só a imagem.
              </span>
            </label>
          )}

          {post && !published && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tps-quote">Citação do card</Label>
                <Textarea
                  id="tps-quote"
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                  rows={4}
                  maxLength={340}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tps-name">Nome no card</Label>
                  <Input
                    id="tps-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Só o primeiro nome"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tps-context">Contexto (opcional)</Label>
                  <Input
                    id="tps-context"
                    value={contextLabel}
                    onChange={(e) => setContextLabel(e.target.value)}
                    placeholder='Ex.: "mãe de assistido"'
                  />
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={generating || !quote.trim()}
                onClick={() => void generate(true)}
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Atualizar arte com os ajustes
              </Button>

              <div className="space-y-1.5">
                <Label htmlFor="tps-caption">Legenda</Label>
                <Textarea
                  id="tps-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={7}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Conta do Instagram</Label>
                <Select value={igUserId} onValueChange={setIgUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={accounts.length ? 'Escolha a conta' : 'Nenhuma conta conectada'} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.instagram_id} value={a.instagram_id}>
                        @{a.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-start gap-2 rounded-md border p-3 text-sm cursor-pointer">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Confirmo que o cliente autorizou o uso deste depoimento na divulgação
                  do escritório (LGPD).
                </span>
              </label>

              <Button
                className="w-full gap-2"
                disabled={publishing || generating || !igUserId || !consent || !caption.trim()}
                onClick={() => void publish()}
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {publishing ? 'Publicando…' : 'Publicar no Instagram'}
              </Button>
            </>
          )}

          {published && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm space-y-2">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">✅ Publicado no Instagram</p>
              {post?.permalink && (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Ver publicação
                </a>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
