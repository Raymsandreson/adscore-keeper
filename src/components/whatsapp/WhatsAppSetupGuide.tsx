import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { WhatsAppAdLinkSettings } from './WhatsAppAdLinkSettings';
import { WhatsAppReportSettings } from './WhatsAppReportSettings';

export function WhatsAppSetupGuide() {
  const webhookUrl = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/whatsapp-webhook`;

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL copiada!');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-2">Configuração da Integração WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          Configure seu n8n para enviar mensagens do UazAPI para o webhook abaixo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>1</Badge> URL do Webhook
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Use esta URL no n8n para enviar as mensagens recebidas do UazAPI:
          </p>
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <code className="text-xs flex-1 break-all">{webhookUrl}</code>
            <Button variant="ghost" size="icon" onClick={copyUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Método: <strong>POST</strong> | Content-Type: <strong>application/json</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>2</Badge> Formato do Payload
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            O n8n deve enviar o seguinte JSON para cada mensagem recebida:
          </p>
          <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto">
{`{
  "phone": "5511999999999",
  "contact_name": "Nome do Contato",
  "message": "Texto da mensagem",
  "message_type": "text",
  "media_url": null,
  "media_type": null,
  "direction": "inbound",
  "message_id": "id-externo-opcional"
}`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>3</Badge> Workflow no n8n
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Crie dois workflows no n8n:
          </p>
          <div className="space-y-2">
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm">📥 Receber mensagens</p>
              <p className="text-xs text-muted-foreground mt-1">
                UazAPI Trigger → Formatar dados → HTTP Request (POST para o webhook acima)
              </p>
            </div>
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm">📤 Enviar mensagens</p>
              <p className="text-xs text-muted-foreground mt-1">
                Webhook Trigger → UazAPI Send Message
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Configure a variável de ambiente <code className="bg-muted px-1 rounded">N8N_WHATSAPP_WEBHOOK_URL</code> com a URL do webhook de envio do n8n.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>4</Badge> Rastreamento de Chamadas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            O sistema pode rastrear chamadas de voz/vídeo feitas pelo WhatsApp automaticamente.
          </p>
          <div className="p-3 border rounded-lg space-y-2">
            <p className="font-medium text-sm">📞 Configuração na UazAPI:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>No painel da UazAPI, acesse <strong>Webhooks</strong></li>
              <li>Ative o evento <strong>"call"</strong> além de "messages"</li>
              <li>O n8n deve encaminhar esses eventos para o mesmo webhook</li>
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">
            As chamadas serão registradas automaticamente na página <strong>/calls</strong> com transcrição por IA quando disponível.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>5</Badge> Vinculação Automática
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            O sistema tenta vincular automaticamente as mensagens e chamadas recebidas a contatos e leads existentes pelo número de telefone. 
            Para números desconhecidos, você pode criar um contato e vincular a um lead diretamente pelo chat.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>6</Badge> Configurar Webhooks na Meta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Acesse o painel de Webhooks do seu app na Meta para configurar os eventos:
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Abrir Meta Developers
            </a>
          </Button>
          <div className="space-y-2 mt-3">
            <p className="text-xs text-muted-foreground">
              <strong>URL do Webhook para Chamadas:</strong>
            </p>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <code className="text-xs flex-1 break-all">{`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-calling-webhook`}</code>
              <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(`https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/meta-calling-webhook`); toast.success('URL copiada!'); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Verify Token: <code className="bg-muted px-1 rounded">abraci_calling_2026</code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Report Settings */}
      <WhatsAppReportSettings />

      {/* Ad Link Settings */}
      <WhatsAppAdLinkSettings />
    </div>
  );
}
