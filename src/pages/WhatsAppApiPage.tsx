import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Settings, MessageSquare, ShieldCheck, ShieldAlert } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useAuthContext } from '@/contexts/AuthContext';
import { canSeeCloudApi } from '@/lib/cloudApiAllowlist';

interface CloudConfig {
  id?: string;
  phone_number_id: string;
  waba_id: string;
  display_phone?: string | null;
  display_name?: string | null;
  status?: string;
  last_heartbeat_at?: string | null;
  is_active?: boolean;
}

const INSTANCE_NAME = 'cloud_gerencia';

export default function WhatsAppApiPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<CloudConfig | null>(null);

  // Guard de acesso (defesa em profundidade — sidebar já esconde o item)
  useEffect(() => {
    if (user && !canSeeCloudApi(user.email)) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await cloudFunctions.invoke('whatsapp-cloud-admin', { body: { action: 'overview' } });
      if (data?.success) setConfig(data.config || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (user && !canSeeCloudApi(user.email)) return null;

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-5xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp API</h1>
          <p className="text-sm text-muted-foreground">
            Números conectados via WhatsApp Business Cloud API (Meta oficial).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </header>

      {loading && !config && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando números…
        </div>
      )}

      {!loading && !config && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Nenhum número Cloud configurado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Configure o primeiro número Cloud API (phone_number_id e WABA ID) para começar.
            </p>
            <Button onClick={() => navigate('/whatsapp/cloud')}>
              <Settings className="h-4 w-4 mr-2" /> Configurar agora
            </Button>
          </CardContent>
        </Card>
      )}

      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              {config.display_name || INSTANCE_NAME}
              {config.status && <Badge variant="outline">{config.status}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Telefone:</span>{' '}
                <span className="font-mono">{config.display_phone || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Phone Number ID:</span>{' '}
                <span className="font-mono text-xs">{config.phone_number_id || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">WABA ID:</span>{' '}
                <span className="font-mono text-xs">{config.waba_id || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Instância interna:</span>{' '}
                <span className="font-mono text-xs">{INSTANCE_NAME}</span>
              </div>
              {config.last_heartbeat_at && (
                <div className="md:col-span-2">
                  <span className="text-muted-foreground">Último heartbeat:</span>{' '}
                  <span className="text-xs">
                    {new Date(config.last_heartbeat_at).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => navigate('/whatsapp/cloud')}>
                <Settings className="h-4 w-4 mr-2" /> Gerenciar config
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/whatsapp-api/conversas')}
              >
                <MessageSquare className="h-4 w-4 mr-2" /> Ver conversas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
