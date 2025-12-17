import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  ArrowLeft, 
  HelpCircle, 
  CheckCircle2, 
  XCircle, 
  Upload, 
  Users, 
  Target,
  TrendingUp,
  FileSpreadsheet,
  ExternalLink,
  Info,
  Zap
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const LeadsCenter = () => {
  const handleOpenFacebookEvents = () => {
    window.open('https://business.facebook.com/events_manager', '_blank');
    toast.info("Abrindo Events Manager do Facebook");
  };

  const handleOpenLeadsCenter = () => {
    window.open('https://business.facebook.com/leads_center', '_blank');
    toast.info("Abrindo Central de Leads do Facebook");
  };

  const handleDownloadTemplate = () => {
    toast.success("Template de CSV para upload de conversões - em breve!");
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Central de Leads</h1>
              <p className="text-muted-foreground">
                Informe ao Facebook quais leads converteram para receber leads melhores
              </p>
            </div>
          </div>

          {/* Why This Matters */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Por que isso é importante?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                Quando você informa ao Facebook quais leads realmente compraram ou converteram, 
                o algoritmo aprende o perfil do seu cliente ideal e passa a entregar leads 
                mais qualificados, reduzindo seu custo por aquisição.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">↓ Custo por Lead</Badge>
                <Badge variant="secondary">↑ Taxa de Conversão</Badge>
                <Badge variant="secondary">↑ Qualidade dos Leads</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Methods Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            
            {/* Method 1: Events Manager */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Método 1: Events Manager
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      O Events Manager é onde você configura e monitora todos os eventos 
                      de conversão do seu site/app
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Configure eventos de conversão automáticos via Pixel ou CAPI
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium text-sm">Instale o Pixel do Facebook</p>
                      <p className="text-xs text-muted-foreground">
                        Código que rastreia ações no seu site (visitas, compras, cadastros)
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium text-sm">Configure eventos de conversão</p>
                      <p className="text-xs text-muted-foreground">
                        Purchase, Lead, CompleteRegistration, etc.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">3</span>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-medium text-sm">Ative a CAPI</p>
                        <p className="text-xs text-muted-foreground">
                          Conversions API - envia dados direto do servidor, mais preciso
                        </p>
                      </div>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          A CAPI não depende do navegador do usuário, então funciona mesmo 
                          quando cookies são bloqueados. Recomendado usar junto com o Pixel.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                <Button onClick={handleOpenFacebookEvents} className="w-full">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir Events Manager
                </Button>
              </CardContent>
            </Card>

            {/* Method 2: Leads Center */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Método 2: Central de Leads
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      A Central de Leads é onde você vê e gerencia todos os leads 
                      captados pelos formulários do Facebook/Instagram
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Marque manualmente quais leads converteram
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium text-sm">Acesse a Central de Leads</p>
                      <p className="text-xs text-muted-foreground">
                        Veja todos os leads dos formulários do Facebook
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium text-sm">Atualize o status de cada lead</p>
                      <p className="text-xs text-muted-foreground">
                        Marque como "Convertido" ou "Não qualificado"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium text-sm">Faça isso regularmente</p>
                      <p className="text-xs text-muted-foreground">
                        Quanto mais dados, melhor o algoritmo aprende
                      </p>
                    </div>
                  </div>
                </div>

                <Button onClick={handleOpenLeadsCenter} className="w-full">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir Central de Leads
                </Button>
              </CardContent>
            </Card>

            {/* Method 3: Offline Conversions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Método 3: Offline Conversions
                  <Tooltip>
                    <TooltipTrigger>
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Permite enviar dados de vendas que aconteceram fora do site 
                      (loja física, WhatsApp, telefone)
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>
                  Envie dados de conversões offline via arquivo CSV
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">1</span>
                    <div>
                      <p className="font-medium text-sm">Exporte seus dados de vendas</p>
                      <p className="text-xs text-muted-foreground">
                        Do seu CRM, planilha ou sistema de vendas
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">2</span>
                    <div>
                      <p className="font-medium text-sm">Formate no padrão do Facebook</p>
                      <p className="text-xs text-muted-foreground">
                        Email, telefone, nome, valor, data da conversão
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium">3</span>
                    <div>
                      <p className="font-medium text-sm">Faça upload no Events Manager</p>
                      <p className="text-xs text-muted-foreground">
                        O Facebook cruza os dados com quem viu seus anúncios
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleDownloadTemplate} variant="outline" className="flex-1">
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Template CSV
                  </Button>
                  <Button onClick={handleOpenFacebookEvents} className="flex-1">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Events Manager
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Status Guide */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Status dos Leads
                </CardTitle>
                <CardDescription>
                  Como classificar seus leads na Central
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 border border-green-500/30 bg-green-500/10 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Convertido</p>
                      <p className="text-xs text-muted-foreground">
                        Lead que comprou, fechou contrato ou virou cliente. 
                        Isso ensina o Facebook a encontrar mais pessoas parecidas.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 border border-yellow-500/30 bg-yellow-500/10 rounded-lg">
                    <Info className="h-5 w-5 text-yellow-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Em andamento</p>
                      <p className="text-xs text-muted-foreground">
                        Lead em negociação, aguardando proposta ou em follow-up.
                        Ainda pode converter.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 border border-red-500/30 bg-red-500/10 rounded-lg">
                    <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Não qualificado</p>
                      <p className="text-xs text-muted-foreground">
                        Lead que não tem perfil (sem dinheiro, errou dados, spam).
                        Isso ensina o Facebook a evitar pessoas assim.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    <strong>Dica:</strong> Atualize os status pelo menos 1x por semana. 
                    Quanto mais feedback você der, mais rápido o algoritmo aprende.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Best Practices */}
          <Card>
            <CardHeader>
              <CardTitle>Boas Práticas para Otimização de Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <h4 className="font-medium">Frequência</h4>
                  <p className="text-sm text-muted-foreground">
                    Atualize os status dos leads pelo menos 1x por semana. 
                    Ideal: diariamente ou após cada venda.
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <h4 className="font-medium">Volume mínimo</h4>
                  <p className="text-sm text-muted-foreground">
                    O Facebook precisa de pelo menos 50 conversões por semana 
                    para otimizar bem. Se tiver menos, use otimização para leads.
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <h4 className="font-medium">Janela de conversão</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure a janela de acordo com seu ciclo de vendas. 
                    Vendas rápidas: 7 dias. Vendas longas: 28+ dias.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default LeadsCenter;
