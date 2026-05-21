import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle, Sparkles, FileText, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';

const RAILWAY_URL =
  (import.meta.env.VITE_RAILWAY_URL as string | undefined) ||
  'https://adscore-keeper-production.up.railway.app';

interface TemplateField {
  name: string;
  type?: string;
  required?: boolean;
}
interface PendingDoc {
  id: string;
  contact_name: string;
  phone: string;
  instance_name: string;
  label_name: string;
  status: string;
  extracted_fields: { fields?: Array<{ de: string; para: string }>; filled_count?: number; total_count?: number };
  extracted_documents?: any[];
  message_count?: number;
  expires_at?: string;
  zapsign_template_id?: string;
}

export default function DocumentReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingDoc | null>(null);
  const [templateFields, setTemplateFields] = useState<TemplateField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [aiFilledKeys, setAiFilledKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ signUrl?: string; whatsappSent?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${RAILWAY_URL}/public/review/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ review_token: token }),
        });
        const j = await r.json();
        if (cancelled) return;
        if (!j.success) {
          setError(j.error || 'Não foi possível carregar a revisão');
          if (j.already_sent && j.sign_url) setSuccess({ signUrl: j.sign_url });
          setLoading(false);
          return;
        }
        setPending(j.pending);
        setTemplateFields(j.template_fields || []);
        // Pré-popula campos com extração da IA
        const initial: Record<string, string> = {};
        const ai = new Set<string>();
        (j.pending.extracted_fields?.fields || []).forEach((f: any) => {
          if (f?.de) {
            initial[f.de] = String(f.para ?? '');
            if (f.para && String(f.para).trim()) ai.add(f.de);
          }
        });
        setFieldValues(initial);
        setAiFilledKeys(ai);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Erro de conexão');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const updateField = (name: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
    setAiFilledKeys((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const fields = templateFields.map((tf) => ({
        de: tf.name,
        para: (fieldValues[tf.name] || '').trim(),
      }));
      const r = await fetch(`${RAILWAY_URL}/public/review/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_token: token, fields, action: 'send' }),
      });
      const j = await r.json();
      if (j.success) {
        setSuccess({ signUrl: j.sign_url, whatsappSent: j.whatsapp_sent_to_client });
        toast({ title: '✅ Enviado!', description: 'O cliente recebeu o link de assinatura no WhatsApp.' });
      } else {
        toast({ title: 'Erro', description: j.error || 'Falha ao enviar', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Falha de conexão', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDiscard = async () => {
    if (!token || !confirm('Descartar essa procuração? Não poderá desfazer.')) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${RAILWAY_URL}/public/review/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_token: token, action: 'discard' }),
      });
      const j = await r.json();
      if (j.success) {
        setSuccess({});
        toast({ title: 'Descartado', description: 'A procuração foi descartada.' });
      } else {
        toast({ title: 'Erro', description: j.error || 'Falha ao descartar', variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
        <h1 className="text-2xl font-bold text-foreground mb-2">Tudo certo!</h1>
        <p className="text-muted-foreground text-center max-w-sm">
          {success.whatsappSent
            ? 'O cliente recebeu o link de assinatura no WhatsApp.'
            : 'Documento gerado. Veja o link abaixo.'}
        </p>
        {success.signUrl && (
          <a
            href={success.signUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 text-sm text-primary underline break-all max-w-sm text-center"
          >
            {success.signUrl}
          </a>
        )}
      </div>
    );
  }

  if (error || !pending) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <AlertCircle className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-xl font-bold text-foreground mb-2">Não foi possível abrir</h1>
        <p className="text-muted-foreground text-center max-w-sm">{error || 'Link inválido ou expirado.'}</p>
      </div>
    );
  }

  const emptyCount = templateFields.filter((tf) => !(fieldValues[tf.name] || '').trim()).length;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">{pending.label_name}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {pending.contact_name} · +{pending.phone}
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">
              {pending.instance_name}
            </Badge>
            <Badge variant={emptyCount > 0 ? 'destructive' : 'default'} className="text-xs">
              {templateFields.length - emptyCount}/{templateFields.length} preenchidos
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Revise os campos antes de enviar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Campos com <Sparkles className="h-3 w-3 inline text-primary" /> foram preenchidos pela IA. Confira tudo antes
              de confirmar — o cliente vai assinar exatamente o que está aqui.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {templateFields.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground text-center">
                Template sem campos configurados.
              </CardContent>
            </Card>
          ) : (
            templateFields.map((tf) => {
              const value = fieldValues[tf.name] || '';
              const isAI = aiFilledKeys.has(tf.name);
              const isEmpty = !value.trim();
              return (
                <div key={tf.name} className="space-y-1.5">
                  <Label htmlFor={tf.name} className="flex items-center gap-1.5 text-sm">
                    {tf.name}
                    {isAI && <Sparkles className="h-3 w-3 text-primary" />}
                    {isEmpty && (
                      <span className="text-xs text-amber-600 font-normal">⚠ vazio</span>
                    )}
                  </Label>
                  <Input
                    id={tf.name}
                    value={value}
                    onChange={(e) => updateField(tf.name, e.target.value)}
                    placeholder="Preencher..."
                    className={isEmpty ? 'border-amber-400 bg-amber-50/30' : ''}
                  />
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Sticky footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-3 z-20">
        <div className="max-w-2xl mx-auto flex gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={handleDiscard}
            disabled={submitting}
            className="flex-shrink-0"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={submitting || templateFields.length === 0}
            className="flex-1"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Confirmar e enviar ao cliente
          </Button>
        </div>
      </footer>
    </div>
  );
}
