import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Chrome, Download, Shield, Smartphone, Zap } from 'lucide-react';

export default function ExtensionPage() {
  const handleDownload = () => {
    fetch('/adscore-crm-extension.zip')
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'adscore-crm-extension.zip';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(err.message));
  };

  const features = [
    { icon: '🔗', title: 'Vincular Lead', desc: 'Busque e vincule leads existentes direto do WhatsApp' },
    { icon: '➕', title: 'Criar Lead + Contato', desc: 'Crie novos registros sem sair da conversa' },
    { icon: '⚖️', title: 'Criar Caso Jurídico', desc: 'Abra casos vinculados ao lead da conversa' },
    { icon: '📄', title: 'Gerar Documento', desc: 'Inicie coleta ZapSign pelo WhatsApp' },
    { icon: '🤖', title: 'Ativar Agente IA', desc: 'Ative ou troque agentes IA na conversa' },
    { icon: '🔒', title: 'Trancar / Silenciar', desc: 'Controle de privacidade e pausas do agente' },
  ];

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium">
            <Chrome className="h-4 w-4" /> Extensão Chrome
          </div>
          <h1 className="text-3xl font-bold text-foreground">AdScore CRM para WhatsApp</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Use todas as funcionalidades do CRM diretamente no WhatsApp Web e WhatsApp Business Web, sem precisar alternar entre abas.
          </p>
        </div>

        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="flex flex-col sm:flex-row items-center gap-4 p-6">
            <div className="flex-1">
              <h2 className="font-semibold text-lg text-foreground">Download da Extensão</h2>
              <p className="text-sm text-muted-foreground mt-1">Compatível com Chrome, Edge, Brave e Arc</p>
            </div>
            <Button size="lg" onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-700">
              <Download className="h-4 w-4 mr-2" /> Baixar Extensão
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {features.map((f) => (
            <Card key={f.title}>
              <CardContent className="flex items-start gap-3 p-4">
                <span className="text-2xl">{f.icon}</span>
                <div>
                  <h3 className="font-semibold text-sm">{f.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Como instalar</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <p>Baixe e descompacte o arquivo .zip</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <p>Abra <code className="bg-muted px-1 rounded">chrome://extensions</code> no navegador</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <p>Ative o <strong>Modo Desenvolvedor</strong> (toggle no canto superior direito)</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">4</span>
              <p>Clique em <strong>"Carregar sem compactação"</strong> e selecione a pasta descompactada</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">5</span>
              <p>Abra o WhatsApp Web e clique no ícone ⚖️ para fazer login e usar!</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
