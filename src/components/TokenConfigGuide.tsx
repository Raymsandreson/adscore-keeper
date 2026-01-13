import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  Key, 
  ExternalLink, 
  CheckCircle2, 
  Copy, 
  Shield, 
  Clock, 
  Instagram, 
  Facebook,
  ChevronRight,
  AlertCircle,
  Sparkles
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TokenConfigGuideProps {
  onClose?: () => void;
}

const REQUIRED_PERMISSIONS = {
  paidTraffic: [
    { name: "ads_read", description: "Ler dados de anúncios" },
    { name: "ads_management", description: "Gerenciar campanhas" },
    { name: "business_management", description: "Acesso ao Business Manager" },
  ],
  organic: [
    { name: "instagram_basic", description: "Dados básicos do Instagram" },
    { name: "instagram_manage_insights", description: "Métricas do Instagram" },
    { name: "pages_read_engagement", description: "Engajamento da página" },
    { name: "pages_show_list", description: "Listar páginas" },
  ],
};

const TokenConfigGuide = ({ onClose }: TokenConfigGuideProps) => {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const { toast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    toast({
      title: "Copiado!",
      description: `${label} copiado para a área de transferência`,
    });
    setTimeout(() => setCopiedText(null), 2000);
  };

  const allPermissions = [
    ...REQUIRED_PERMISSIONS.paidTraffic,
    ...REQUIRED_PERMISSIONS.organic,
  ];

  const permissionsList = allPermissions.map(p => p.name).join(", ");

  const longLivedTokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={TOKEN_CURTO}`;
  
  const pageTokenUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token={LONG_LIVED_TOKEN}`;

  return (
    <Card className="bg-gradient-card border-border shadow-card-custom">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <span>Guia de Configuração do Token</span>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Fechar
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Permissões Necessárias */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Permissões Necessárias
          </h3>
          
          <div className="grid md:grid-cols-2 gap-4">
            {/* Tráfego Pago */}
            <div className="p-4 rounded-lg border border-border bg-card/50">
              <div className="flex items-center gap-2 mb-3">
                <Facebook className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm">Tráfego Pago (Ads)</span>
              </div>
              <div className="space-y-2">
                {REQUIRED_PERMISSIONS.paidTraffic.map((perm) => (
                  <div key={perm.name} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{perm.name}</code>
                    <span className="text-xs text-muted-foreground">- {perm.description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Orgânico */}
            <div className="p-4 rounded-lg border border-border bg-card/50">
              <div className="flex items-center gap-2 mb-3">
                <Instagram className="h-4 w-4 text-pink-500" />
                <span className="font-medium text-sm">Orgânico (Instagram/Facebook)</span>
              </div>
              <div className="space-y-2">
                {REQUIRED_PERMISSIONS.organic.map((perm) => (
                  <div key={perm.name} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{perm.name}</code>
                    <span className="text-xs text-muted-foreground">- {perm.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => copyToClipboard(permissionsList, "Permissões")}
            className="gap-2"
          >
            <Copy className="h-3 w-3" />
            {copiedText === "Permissões" ? "Copiado!" : "Copiar todas as permissões"}
          </Button>
        </div>

        {/* Passo a Passo */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Passo a Passo: Token Permanente
          </h3>

          <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Tokens padrão expiram em 1-2 horas. Siga os passos abaixo para gerar um <strong>token permanente</strong> que nunca expira!
              </p>
            </div>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {/* Passo 0 - Pré-requisitos */}
            <AccordionItem value="step-0" className="border border-warning/50 rounded-lg mb-2 overflow-hidden bg-warning/5">
              <AccordionTrigger className="px-4 py-3 hover:bg-warning/10">
                <div className="flex items-center gap-3">
                  <Badge className="bg-warning text-warning-foreground h-6 w-6 p-0 flex items-center justify-center rounded-full">!</Badge>
                  <span className="text-sm font-medium">Pré-requisito: Adicionar Produtos ao App</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                <div className="space-y-4 text-sm">
                  <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-warning">Importante:</strong> As permissões do Instagram só aparecem após adicionar os produtos necessários ao seu App!
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <Instagram className="h-4 w-4 text-pink-500" />
                      Para permissões do Instagram Orgânico:
                    </h4>
                    <ol className="list-decimal list-inside space-y-2 text-muted-foreground ml-2">
                      <li>Acesse <strong>Meta Developers</strong> → Seu App</li>
                      <li>No menu lateral, clique em <strong>"Adicionar Produto"</strong></li>
                      <li>Procure e adicione: <strong>"Instagram Basic Display"</strong></li>
                      <li>Procure e adicione: <strong>"Instagram Graph API"</strong></li>
                      <li>Após adicionar, as permissões <code className="bg-muted px-1 rounded">instagram_basic</code> e <code className="bg-muted px-1 rounded">instagram_manage_insights</code> aparecerão no Graph API Explorer</li>
                    </ol>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <Facebook className="h-4 w-4 text-blue-500" />
                      Para permissões de Ads/Tráfego Pago:
                    </h4>
                    <ol className="list-decimal list-inside space-y-2 text-muted-foreground ml-2">
                      <li>No menu lateral, clique em <strong>"Adicionar Produto"</strong></li>
                      <li>Procure e adicione: <strong>"Marketing API"</strong></li>
                      <li>Após adicionar, as permissões <code className="bg-muted px-1 rounded">ads_read</code> e <code className="bg-muted px-1 rounded">ads_management</code> aparecerão</li>
                    </ol>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}
                      className="gap-2"
                    >
                      Abrir Meus Apps
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open('https://developers.facebook.com/docs/instagram-basic-display-api/getting-started', '_blank')}
                      className="gap-2"
                    >
                      Docs Instagram API
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Passo 1 */}
            <AccordionItem value="step-1" className="border border-border rounded-lg mb-2 overflow-hidden">
              <AccordionTrigger className="px-4 py-3 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge className="bg-primary text-primary-foreground h-6 w-6 p-0 flex items-center justify-center rounded-full">1</Badge>
                  <span className="text-sm font-medium">Gerar User Access Token</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">Acesse o Graph API Explorer e gere um token com todas as permissões:</p>
                  
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>Clique no botão abaixo para abrir o Graph API Explorer</li>
                    <li>Selecione seu <strong>App</strong> no menu "Meta App"</li>
                    <li>Clique em <strong>"Add a Permission"</strong></li>
                    <li>
                      <strong>Para Instagram:</strong> Expanda <code className="bg-muted px-1 rounded">instagram_basic</code> e <code className="bg-muted px-1 rounded">instagram_manage_insights</code>
                      <div className="ml-4 mt-1 text-xs text-warning">⚠️ Se não aparecer, volte ao passo anterior e adicione os produtos!</div>
                    </li>
                    <li>
                      <strong>Para Ads:</strong> Expanda <code className="bg-muted px-1 rounded">ads_read</code>, <code className="bg-muted px-1 rounded">ads_management</code>
                    </li>
                    <li>
                      <strong>Para Páginas:</strong> Expanda <code className="bg-muted px-1 rounded">pages_show_list</code>, <code className="bg-muted px-1 rounded">pages_read_engagement</code>
                    </li>
                    <li>Clique em <strong>"Generate Access Token"</strong></li>
                    <li>Conceda as permissões solicitadas na janela popup</li>
                  </ol>

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">
                      <strong>Onde encontrar cada permissão:</strong><br/>
                      • <code className="text-primary">instagram_basic</code> → Events, Groups and Pages → instagram_basic<br/>
                      • <code className="text-primary">instagram_manage_insights</code> → Events, Groups and Pages → instagram_manage_insights<br/>
                      • <code className="text-primary">ads_read</code> → Ads → ads_read<br/>
                      • <code className="text-primary">pages_show_list</code> → Events, Groups and Pages → pages_show_list
                    </p>
                  </div>

                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => window.open('https://developers.facebook.com/tools/explorer/', '_blank')}
                    className="gap-2"
                  >
                    Abrir Graph API Explorer
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Passo 2 */}
            <AccordionItem value="step-2" className="border border-border rounded-lg mb-2 overflow-hidden">
              <AccordionTrigger className="px-4 py-3 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge className="bg-primary text-primary-foreground h-6 w-6 p-0 flex items-center justify-center rounded-full">2</Badge>
                  <span className="text-sm font-medium">Converter para Long-Lived Token (60 dias)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">Use a URL abaixo substituindo os valores:</p>
                  
                  <div className="bg-muted p-3 rounded-lg overflow-x-auto">
                    <code className="text-xs break-all">
                      GET https://graph.facebook.com/v18.0/oauth/access_token?<br/>
                      &nbsp;&nbsp;grant_type=fb_exchange_token&<br/>
                      &nbsp;&nbsp;client_id=<span className="text-primary">{"{APP_ID}"}</span>&<br/>
                      &nbsp;&nbsp;client_secret=<span className="text-primary">{"{APP_SECRET}"}</span>&<br/>
                      &nbsp;&nbsp;fb_exchange_token=<span className="text-primary">{"{TOKEN_CURTO}"}</span>
                    </code>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ChevronRight className="h-3 w-3" />
                    <span>Encontre APP_ID e APP_SECRET em: Meta Developers → Seu App → Configurações → Básico</span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(longLivedTokenUrl, "URL Long-Lived")}
                    className="gap-2"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedText === "URL Long-Lived" ? "Copiado!" : "Copiar URL"}
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Passo 3 */}
            <AccordionItem value="step-3" className="border border-border rounded-lg mb-2 overflow-hidden">
              <AccordionTrigger className="px-4 py-3 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge className="bg-success text-success-foreground h-6 w-6 p-0 flex items-center justify-center rounded-full">3</Badge>
                  <span className="text-sm font-medium">Obter Page Token PERMANENTE ✨</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Este é o passo mais importante! O Page Access Token gerado aqui <strong className="text-success">nunca expira</strong>.
                  </p>
                  
                  <div className="bg-muted p-3 rounded-lg overflow-x-auto">
                    <code className="text-xs break-all">
                      GET https://graph.facebook.com/v18.0/me/accounts?<br/>
                      &nbsp;&nbsp;access_token=<span className="text-primary">{"{LONG_LIVED_TOKEN}"}</span>
                    </code>
                  </div>

                  <div className="p-3 bg-success/10 border border-success/20 rounded-lg">
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-success">Dica:</strong> A resposta retornará um JSON com suas páginas. 
                      O campo <code className="bg-muted px-1 rounded">access_token</code> de cada página é o <strong>token permanente</strong>!
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(pageTokenUrl, "URL Page Token")}
                    className="gap-2"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedText === "URL Page Token" ? "Copiado!" : "Copiar URL"}
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Passo 4 */}
            <AccordionItem value="step-4" className="border border-border rounded-lg mb-2 overflow-hidden">
              <AccordionTrigger className="px-4 py-3 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge className="bg-primary text-primary-foreground h-6 w-6 p-0 flex items-center justify-center rounded-full">4</Badge>
                  <span className="text-sm font-medium">Verificar Token</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Use o Access Token Debugger para confirmar que o token é permanente:
                  </p>
                  
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>Cole o token no Access Token Debugger</li>
                    <li>Clique em "Debug"</li>
                    <li>Verifique se mostra: <strong className="text-success">"Expires: Never"</strong></li>
                  </ol>

                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => window.open('https://developers.facebook.com/tools/debug/accesstoken/', '_blank')}
                    className="gap-2"
                  >
                    Abrir Token Debugger
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Links Úteis */}
        <div className="pt-4 border-t border-border">
          <h4 className="text-xs font-medium text-muted-foreground mb-3">Links Úteis</h4>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}
              className="gap-1.5 text-xs h-8"
            >
              <Facebook className="h-3 w-3" />
              Meus Apps
              <ExternalLink className="h-2.5 w-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open('https://business.facebook.com/settings/', '_blank')}
              className="gap-1.5 text-xs h-8"
            >
              <Shield className="h-3 w-3" />
              Business Manager
              <ExternalLink className="h-2.5 w-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open('https://developers.facebook.com/docs/facebook-login/guides/access-tokens/', '_blank')}
              className="gap-1.5 text-xs h-8"
            >
              <Clock className="h-3 w-3" />
              Documentação
              <ExternalLink className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TokenConfigGuide;
