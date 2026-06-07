import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck, ShieldAlert, ShieldX, Loader2, RefreshCw, ArrowLeft,
  Clock, KeyRound, Phone, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

type TokenStatus =
  | 'valid' | 'expired' | 'invalid' | 'missing'
  | 'no_config' | 'graph_error' | 'unreachable';

interface TokenCheckResult {
  success: boolean;
  status: TokenStatus;
  message?: string;
  app_id?: string | null;
  application?: string | null;
  type?: string | null;
  scopes?: string[];
  expires_at?: number | null;
  seconds_left?: number | null;
  never_expires?: boolean;
  phone_number_id?: string | null;
  display_phone?: string | null;
  phone_check?: { ok: boolean; error?: string; display_phone?: string } | null;
  graph_code?: number;
  graph_subcode?: number;
  checked_at?: string;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return 'expirado';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

const STATUS_UI: Record<TokenStatus, {
  label: string; color: string; icon: typeof ShieldCheck; hint: string;
}> = {
  valid:       { label: 'Token válido',          color: 'text-emerald-600 border-emerald-500 bg-emerald-50 dark:bg-emerald-950',
                 icon: ShieldCheck, hint: 'Pronto para enviar mensagens.' },
  expired:     { label: 'Token expirado',        color: 'text-red-600 border-red-500 bg-red-50 dark:bg-red-950',
                 icon: ShieldX, hint: 'Gere um novo token no Meta e atualize WHATSAPP_CLOUD_TOKEN no Railway.' },
  invalid:     { label: 'Token inválido',        color: 'text-red-600 border-red-500 bg-red-50 dark:bg-red-950',
                 icon: ShieldX, hint: 'Token revogado ou malformado. Gere novo no Business Manager.' },
  missing:     { label: 'Token não configurado', color: 'text-amber-600 border-amber-500 bg-amber-50 dark:bg-amber-950',
                 icon: ShieldAlert, hint: 'Defina WHATSAPP_CLOUD_TOKEN nas variáveis do Railway.' },
  no_config:   { label: 'Número não configurado', color: 'text-amber-600 border-amber-500 bg-amber-50 dark:bg-amber-950',
                 icon: ShieldAlert, hint: 'Configure o phone_number_id em WhatsApp Cloud.' },
  graph_error: { label: 'Erro Meta Graph',       color: 'text-red-600 border-red-500 bg-red-50 dark:bg-red-950',
                 icon: AlertTriangle, hint: 'Veja a mensagem retornada pelo Graph abaixo.' },
  unreachable: { label: 'Sem conexão',           color: 'text-muted-foreground border-muted bg-muted/40',
                 icon: AlertTriangle, hint: 'Railway ou Graph API indisponível. Tente novamente.' },
};

export default function WhatsAppTokenStatusPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TokenCheckResult | null>(null);

  const check = async () => {
    setLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('check-whatsapp-cloud-token', { body: {} });
      if (error) throw error;
      setResult(data as TokenCheckResult);
      const s = (data as TokenCheckResult)?.status;
      if (s === 'valid') toast.success('Token válido');
      else if (s === 'expired') toast.error('Token expirado');
      else if (s === 'invalid') toast.error('Token inválido');
      else if (s === 'missing' || s === 'no_config') toast.warning('Configuração incompleta');
      else toast.error('Falha ao verificar token');
    } catch (e: any) {
      toast.error('Erro ao verificar', { description: e?.message || String(e) });
      setResult({ success: false, status: 'unreachable', message: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const ui = result ? STATUS_UI[result.status] : null;
  const Icon = ui?.icon;
  const lowTime = result?.seconds_left != null && result.seconds_left < 86400 && result.seconds_left > 0;

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-3xl">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/whatsapp-api')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Status do Token Meta</h1>
            <p className="text-sm text-muted-foreground">
              Verifique se o token do WhatsApp Cloud API está válido antes de enviar mensagens.
            </p>
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="pt-6">
          <Button onClick={check} disabled={loading} size="lg" className="w-full">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {result ? 'Verificar novamente' : 'Verificar token agora'}
          </Button>
          {!result && !loading && (
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Consulta o Graph API da Meta em tempo real (não envia mensagem).
            </p>
          )}
        </CardContent>
      </Card>

      {result && ui && Icon && (
        <>
          <Card className={`border-2 ${ui.color}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Icon className="h-6 w-6" />
                {ui.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">{ui.hint}</p>
              {result.message && result.status !== 'valid' && (
                <div className="text-xs font-mono p-2 rounded bg-background/60 border">
                  {result.message}
                  {result.graph_code != null && <span className="ml-2 opacity-70">(code {result.graph_code}{result.graph_subcode ? `/${result.graph_subcode}` : ''})</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {result.status === 'valid' && (
            <Card>
              <CardHeader><CardTitle className="text-base">Detalhes do token</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="text-muted-foreground text-xs">Expira em</div>
                      <div className="font-medium">
                        {result.never_expires
                          ? <Badge variant="outline" className="border-emerald-500 text-emerald-700">Não expira (System User)</Badge>
                          : (
                            <span className={lowTime ? 'text-amber-600' : ''}>
                              {formatDuration(result.seconds_left)}
                              {result.expires_at && (
                                <span className="text-muted-foreground text-xs ml-1">
                                  ({new Date(result.expires_at * 1000).toLocaleString('pt-BR')})
                                </span>
                              )}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <KeyRound className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="text-muted-foreground text-xs">Tipo</div>
                      <div className="font-mono text-xs">{result.type || '—'}</div>
                    </div>
                  </div>

                  {result.application && (
                    <div className="md:col-span-2">
                      <div className="text-muted-foreground text-xs">App</div>
                      <div className="font-mono text-xs">{result.application} {result.app_id ? `(${result.app_id})` : ''}</div>
                    </div>
                  )}

                  {result.scopes && result.scopes.length > 0 && (
                    <div className="md:col-span-2">
                      <div className="text-muted-foreground text-xs mb-1">Permissões</div>
                      <div className="flex flex-wrap gap-1">
                        {result.scopes.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                      </div>
                    </div>
                  )}
                </div>

                {lowTime && !result.never_expires && (
                  <div className="flex items-start gap-2 p-3 rounded border border-amber-500 bg-amber-50 dark:bg-amber-950 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
                    <div>
                      <strong>Atenção:</strong> token expira em menos de 24h. Considere migrar para um <em>System User token</em> permanente.
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(result.phone_number_id || result.phone_check) && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <Phone className="h-4 w-4" /> Número conectado
              </CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Phone Number ID:</span>{' '}
                  <span className="font-mono text-xs">{result.phone_number_id || '—'}</span>
                </div>
                {result.display_phone && (
                  <div>
                    <span className="text-muted-foreground">Telefone configurado:</span>{' '}
                    <span className="font-mono">{result.display_phone}</span>
                  </div>
                )}
                {result.phone_check && (
                  <div className="flex items-center gap-2 pt-2">
                    {result.phone_check.ok ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>Token tem acesso ao número{result.phone_check.display_phone ? `: ${result.phone_check.display_phone}` : ''}</span>
                      </>
                    ) : (
                      <>
                        <ShieldX className="h-4 w-4 text-red-600" />
                        <span className="text-red-600">Token NÃO tem acesso a este número: {result.phone_check.error}</span>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {result.checked_at && (
            <p className="text-xs text-muted-foreground text-center">
              Verificado em {new Date(result.checked_at).toLocaleString('pt-BR')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
