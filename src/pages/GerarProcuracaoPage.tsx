import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileSignature, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ZapSignDocumentDialog } from '@/components/whatsapp/ZapSignDocumentDialog';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

function normalizePhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

/**
 * Página unificada de Gerar Procuração.
 *
 * Metáfora: é a "porta fixa" do gerador. Operador entra (já logado),
 * digita o telefone do cliente (ou abre via link com ?phone=...) e
 * o sistema abre o mesmo popup que existe no chat, já com a conversa
 * carregada e pronto pra extrair, editar e enviar.
 */
export default function GerarProcuracaoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialPhone = normalizePhone(params.get('phone') || '');
  const instance = params.get('instance') || undefined;
  const templateHint = params.get('template') || undefined;

  const [phoneInput, setPhoneInput] = useState(initialPhone);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolved, setResolved] = useState<{
    phone: string;
    contactId?: string;
    leadId?: string;
    contactName?: string;
  } | null>(null);

  const openForPhone = async (rawPhone: string) => {
    const phone = normalizePhone(rawPhone);
    if (!phone || phone.length < 10) {
      toast.error('Informe um telefone válido (com DDD)');
      return;
    }
    setLoading(true);
    try {
      // Procura contato/lead pelo telefone no Externo (busca leve)
      const { data: contact } = await externalSupabase
        .from('contacts')
        .select('id, full_name, lead_id')
        .eq('phone', phone)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let leadId: string | undefined = (contact as any)?.lead_id || undefined;
      let contactName: string | undefined = (contact as any)?.full_name || undefined;

      if (!leadId) {
        const { data: lead } = await externalSupabase
          .from('leads')
          .select('id, lead_name')
          .eq('lead_phone', phone)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lead) {
          leadId = (lead as any).id;
          if (!contactName) contactName = (lead as any).lead_name;
        }
      }

      setResolved({
        phone,
        contactId: (contact as any)?.id,
        leadId,
        contactName,
      });
      setDialogOpen(true);
    } catch (err: any) {
      console.error('[GerarProcuracao] erro ao resolver telefone:', err);
      toast.error('Erro ao buscar conversa');
    } finally {
      setLoading(false);
    }
  };

  // Auto-abre se vier com ?phone=
  useEffect(() => {
    if (initialPhone && initialPhone.length >= 10) {
      openForPhone(initialPhone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container max-w-2xl mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileSignature className="h-6 w-6 text-primary" />
          Gerar Procuração
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Informe o telefone do cliente. O sistema busca a conversa, a IA preenche os campos
          e você revisa antes de enviar pra assinatura.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telefone do cliente</CardTitle>
          <CardDescription>Com DDD (ex: 5511999999999)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone (WhatsApp)</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                inputMode="tel"
                placeholder="5511999999999"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openForPhone(phoneInput);
                }}
              />
              <Button
                onClick={() => openForPhone(phoneInput)}
                disabled={loading || !phoneInput.trim()}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Abrir <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {templateHint && (
            <p className="text-xs text-muted-foreground">
              Modelo sugerido: <span className="font-mono">{templateHint}</span> — será pré-selecionado no popup.
            </p>
          )}
          {instance && (
            <p className="text-xs text-muted-foreground">
              Instância: <span className="font-mono">{instance}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {resolved && (
        <ZapSignDocumentDialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) setResolved(null);
          }}
          phone={resolved.phone}
          contactName={resolved.contactName}
          contactId={resolved.contactId}
          leadId={resolved.leadId}
          instanceName={instance}
        />
      )}
    </div>
  );
}
