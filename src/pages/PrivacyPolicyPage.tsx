import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Shield, Copy, Check, FileText, Globe } from 'lucide-react';
import { toast } from 'sonner';

interface PolicyData {
  companyName: string;
  cnpj: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  appDescription: string;
  dataCollected: string;
  dpoName: string;
  dpoEmail: string;
}

const generatePolicy = (d: PolicyData): string => {
  const today = new Date().toLocaleDateString('pt-BR');
  return `POLÍTICA DE PRIVACIDADE

Última atualização: ${today}

A ${d.companyName || '[Nome da Empresa]'}${d.cnpj ? `, inscrita no CNPJ sob o nº ${d.cnpj}` : ''}, com sede em ${d.address || '[Endereço]'} ("nós", "nosso" ou "Empresa"), é a controladora dos dados pessoais tratados por meio ${d.website ? `do site ${d.website}` : 'de nossos serviços digitais'} e aplicativos associados.

Esta Política de Privacidade tem como objetivo informar de forma clara e transparente como coletamos, usamos, armazenamos, compartilhamos e protegemos seus dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD), o Marco Civil da Internet (Lei nº 12.965/2014), o Código de Defesa do Consumidor (Lei nº 8.078/1990), o Regulamento Geral sobre a Proteção de Dados da União Europeia (GDPR – Regulamento UE 2016/679), a California Consumer Privacy Act (CCPA) e demais legislações aplicáveis.

${d.appDescription ? `\nSOBRE O SERVIÇO\n\n${d.appDescription}\n` : ''}
1. DADOS PESSOAIS COLETADOS

1.1. Coletamos os seguintes tipos de dados pessoais:
${d.dataCollected || `• Dados de identificação: nome completo, CPF/CNPJ, data de nascimento;
• Dados de contato: e-mail, telefone, endereço;
• Dados de acesso: endereço IP, geolocalização aproximada, tipo de dispositivo, sistema operacional, navegador;
• Dados de uso: páginas acessadas, tempo de permanência, cliques, preferências;
• Dados financeiros: quando necessário para processamento de pagamentos;
• Dados de comunicação: mensagens enviadas por meio de nossos canais.`}

1.2. Dados sensíveis, conforme art. 5º, II da LGPD, somente serão tratados com consentimento específico e destacado, ou nas hipóteses legais previstas no art. 11 da LGPD.

2. FINALIDADES DO TRATAMENTO

2.1. Seus dados pessoais são tratados para as seguintes finalidades:
• Prestação e melhoria dos serviços oferecidos;
• Comunicação sobre atualizações, novidades e suporte;
• Cumprimento de obrigações legais e regulatórias;
• Prevenção de fraudes e garantia da segurança;
• Personalização da experiência do usuário;
• Envio de comunicações de marketing (mediante consentimento);
• Análises estatísticas e estudos internos (dados anonimizados);
• Exercício regular de direitos em processos judiciais, administrativos ou arbitrais.

3. BASES LEGAIS PARA O TRATAMENTO (LGPD – Art. 7º)

3.1. Os tratamentos de dados são fundamentados nas seguintes bases legais:
• Consentimento do titular (art. 7º, I);
• Cumprimento de obrigação legal ou regulatória (art. 7º, II);
• Execução de contrato ou de procedimentos preliminares (art. 7º, V);
• Exercício regular de direitos (art. 7º, VI);
• Legítimo interesse do controlador (art. 7º, IX);
• Proteção do crédito (art. 7º, X).

4. COMPARTILHAMENTO DE DADOS

4.1. Seus dados poderão ser compartilhados com:
• Prestadores de serviços essenciais (hospedagem, processamento de pagamentos, análise de dados);
• Parceiros comerciais, quando necessário para a prestação dos serviços;
• Autoridades públicas, em cumprimento de obrigação legal ou ordem judicial;
• Empresas do mesmo grupo econômico, para finalidades compatíveis.

4.2. Em caso de transferência internacional de dados, serão adotadas as salvaguardas previstas nos arts. 33 a 36 da LGPD e no Capítulo V do GDPR, incluindo cláusulas contratuais padrão e verificação do nível de proteção do país destinatário.

4.3. Não vendemos, alugamos ou comercializamos seus dados pessoais.

5. ARMAZENAMENTO E SEGURANÇA

5.1. Seus dados são armazenados em servidores seguros, com a adoção de medidas técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados, situações acidentais ou ilícitas de destruição, perda, alteração ou comunicação, conforme art. 46 da LGPD e art. 32 do GDPR.

5.2. Medidas de segurança adotadas incluem:
• Criptografia de dados em trânsito (TLS/SSL) e em repouso;
• Controles de acesso baseados em função (RBAC);
• Monitoramento contínuo e detecção de intrusões;
• Backups regulares e plano de recuperação de desastres;
• Treinamento periódico da equipe sobre proteção de dados.

5.3. Os dados serão retidos pelo período necessário ao cumprimento das finalidades descritas nesta Política, observados os prazos legais de retenção obrigatória.

6. DIREITOS DO TITULAR (LGPD – Art. 18)

6.1. Você tem o direito de, a qualquer momento, solicitar:
• Confirmação da existência de tratamento;
• Acesso aos seus dados pessoais;
• Correção de dados incompletos, inexatos ou desatualizados;
• Anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;
• Portabilidade dos dados a outro fornecedor de serviço;
• Eliminação dos dados tratados com base em consentimento;
• Informação sobre entidades públicas e privadas com as quais seus dados foram compartilhados;
• Informação sobre a possibilidade de não fornecer consentimento e suas consequências;
• Revogação do consentimento;
• Oposição ao tratamento realizado com base em legítimo interesse.

6.2. Para exercer seus direitos, entre em contato pelo e-mail: ${d.dpoEmail || d.email || '[email de contato]'}.

6.3. Responderemos suas solicitações no prazo de até 15 (quinze) dias, conforme art. 18, §5º da LGPD.

7. DIREITOS ADICIONAIS (GDPR e CCPA)

7.1. Para titulares residentes no Espaço Econômico Europeu (EEE), são assegurados adicionalmente:
• Direito de apresentar reclamação junto à autoridade supervisora competente;
• Direito à limitação do tratamento;
• Direito à não sujeição a decisões automatizadas.

7.2. Para residentes da Califórnia (EUA), nos termos da CCPA:
• Direito de saber quais dados pessoais são coletados;
• Direito de solicitar a exclusão de dados;
• Direito de optar por não ter seus dados vendidos (não realizamos venda de dados);
• Direito à não discriminação pelo exercício de direitos de privacidade.

8. COOKIES E TECNOLOGIAS DE RASTREAMENTO

8.1. Utilizamos cookies e tecnologias similares para:
• Garantir o funcionamento adequado do site/aplicativo;
• Analisar o uso e o desempenho dos serviços;
• Personalizar conteúdo e anúncios;
• Lembrar suas preferências.

8.2. Você pode gerenciar suas preferências de cookies a qualquer momento por meio das configurações do seu navegador.

9. ENCARREGADO DE PROTEÇÃO DE DADOS (DPO)

9.1. O Encarregado de Proteção de Dados designado é:
• Nome: ${d.dpoName || '[Nome do DPO]'}
• E-mail: ${d.dpoEmail || d.email || '[E-mail do DPO]'}
${d.phone ? `• Telefone: ${d.phone}` : ''}

10. MENORES DE IDADE

10.1. Nossos serviços não se destinam a menores de 18 (dezoito) anos. Dados de crianças e adolescentes somente serão tratados em conformidade com o art. 14 da LGPD, com consentimento específico de pelo menos um dos pais ou responsável legal.

11. ALTERAÇÕES NESTA POLÍTICA

11.1. Reservamo-nos o direito de atualizar esta Política de Privacidade a qualquer momento, sendo que quaisquer alterações entrarão em vigor imediatamente após sua publicação.

11.2. Notificaremos os titulares sobre alterações relevantes por meio de aviso em nosso site ou por e-mail.

12. LEGISLAÇÃO E FORO APLICÁVEIS

12.1. Esta Política é regida pelas leis da República Federativa do Brasil.

12.2. Fica eleito o foro da comarca de ${d.address ? d.address.split(',').pop()?.trim() || '[Cidade/Estado]' : '[Cidade/Estado]'} para dirimir quaisquer controvérsias decorrentes desta Política, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

13. CONTATO

Para dúvidas, sugestões ou solicitações relacionadas a esta Política de Privacidade, entre em contato:

${d.companyName || '[Nome da Empresa]'}
${d.address ? `Endereço: ${d.address}` : ''}
E-mail: ${d.email || '[e-mail]'}
${d.phone ? `Telefone: ${d.phone}` : ''}
${d.website ? `Site: ${d.website}` : ''}

---
© ${new Date().getFullYear()} ${d.companyName || '[Nome da Empresa]'}. Todos os direitos reservados.`;
};

export default function PrivacyPolicyPage() {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [form, setForm] = useState<PolicyData>({
    companyName: 'WHATSJUD TECNOLOGIA EM SOFTWARE LTDA - ME',
    cnpj: '48.628.348/0001-54',
    website: 'https://adscore-keeper.lovable.app',
    email: 'processual@rprudencioadv.com',
    phone: '869995590127',
    address: 'AV ENG LUIZ CARLOS BERRINI, 1681, sala 111 e 112, São Paulo/SP',
    appDescription: 'O WhatsJUD é uma plataforma de gestão e produtividade voltada para escritórios de advocacia e equipes jurídicas. O sistema integra funcionalidades de CRM (gestão de leads e pipeline de vendas), comunicação via WhatsApp e Instagram (envio e recebimento de mensagens, comentários e DMs), gestão de contatos e relacionamentos, controle financeiro (transações bancárias, cartões de crédito e categorização de despesas), gestão de equipes (produtividade, avaliações e comissões), automação de fluxos de trabalho, análise de métricas de engajamento em redes sociais, gestão de atividades e tarefas, integração com Google Calendar, registro e gravação de chamadas telefônicas, importação e gestão de dados de CAT (Comunicação de Acidente de Trabalho), e geração de relatórios e dashboards analíticos.',
    dataCollected: `• Dados de identificação: nome completo, CPF/CNPJ, data de nascimento, profissão (código CBO);
• Dados de contato: e-mail, telefone, celular, endereço completo (CEP, cidade, estado, bairro);
• Dados de acesso: endereço IP, geolocalização aproximada, tipo de dispositivo, sistema operacional, navegador, sessões de uso;
• Dados de uso: páginas acessadas, tempo de permanência, cliques, filtros aplicados, buscas realizadas, exportações de dados;
• Dados de redes sociais: nome de usuário do Instagram, comentários, mensagens diretas, métricas de engajamento, histórico de interações;
• Dados de comunicação: mensagens enviadas e recebidas via WhatsApp, registros e gravações de chamadas telefônicas, histórico de conversas;
• Dados financeiros: transações bancárias, transações de cartão de crédito, categorias de despesas, dados de comerciantes (CNPJ, nome, localização);
• Dados profissionais e jurídicos: informações de leads, dados de acidentes de trabalho (CAT), classificações de casos, histórico de etapas processuais;
• Dados de equipe: avaliações de produtividade, metas de comissão, registros de atividades, rotinas de trabalho;
• Dados de integração: tokens de acesso a APIs (Meta/Facebook, Google), webhooks e dados de automação.`,
    dpoName: '',
    dpoEmail: 'processual@rprudencioadv.com',
  });

  const update = (key: keyof PolicyData, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const policy = generatePolicy(form);

  const handleCopy = () => {
    navigator.clipboard.writeText(policy);
    setCopied(true);
    toast.success('Política copiada para a área de transferência!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Gerador de Política de Privacidade</h1>
            <p className="text-xs text-muted-foreground">LGPD · GDPR · CCPA · Marco Civil da Internet</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Info banner */}
        <div className="rounded-lg border bg-primary/5 p-4 flex gap-3 items-start">
          <Globe className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm text-foreground">
            <p className="font-medium">Política em conformidade com:</p>
            <p className="text-muted-foreground mt-1">
              Lei Geral de Proteção de Dados (LGPD – Lei 13.709/2018) · Marco Civil da Internet (Lei 12.965/2014) · 
              Código de Defesa do Consumidor · GDPR (UE 2016/679) · CCPA (Califórnia, EUA)
            </p>
          </div>
        </div>

        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Dados da Empresa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nome da Empresa *</Label>
                <Input placeholder="Ex: Abraci Ltda" value={form.companyName} onChange={e => update('companyName', e.target.value)} />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input placeholder="00.000.000/0001-00" value={form.cnpj} onChange={e => update('cnpj', e.target.value)} />
              </div>
              <div>
                <Label>Website</Label>
                <Input placeholder="https://seusite.com.br" value={form.website} onChange={e => update('website', e.target.value)} />
              </div>
              <div>
                <Label>E-mail de contato *</Label>
                <Input placeholder="contato@empresa.com.br" value={form.email} onChange={e => update('email', e.target.value)} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input placeholder="(00) 00000-0000" value={form.phone} onChange={e => update('phone', e.target.value)} />
              </div>
              <div>
                <Label>Endereço / Cidade / Estado</Label>
                <Input placeholder="Rua X, 123 - Cidade, Estado" value={form.address} onChange={e => update('address', e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Descrição do serviço/aplicativo</Label>
              <Textarea placeholder="Descreva brevemente o que sua empresa/app faz..." value={form.appDescription} onChange={e => update('appDescription', e.target.value)} rows={3} />
            </div>

            <div>
              <Label>Dados coletados (opcional — deixe vazio para usar o padrão)</Label>
              <Textarea placeholder="Liste os tipos de dados que seu serviço coleta..." value={form.dataCollected} onChange={e => update('dataCollected', e.target.value)} rows={3} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nome do DPO (Encarregado)</Label>
                <Input placeholder="Nome completo" value={form.dpoName} onChange={e => update('dpoName', e.target.value)} />
              </div>
              <div>
                <Label>E-mail do DPO</Label>
                <Input placeholder="dpo@empresa.com.br" value={form.dpoEmail} onChange={e => update('dpoEmail', e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => setShowPreview(true)} className="flex-1">
                <FileText className="h-4 w-4 mr-2" />
                Gerar Política
              </Button>
              {showPreview && (
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {showPreview && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Prévia da Política de Privacidade</CardTitle>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted/50 rounded-lg p-6 max-h-[600px] overflow-y-auto font-sans leading-relaxed">
                {policy}
              </pre>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center pb-8">
          Este documento é gerado automaticamente como modelo. Recomendamos a revisão por um advogado especializado em proteção de dados.
        </p>
      </main>
    </div>
  );
}
