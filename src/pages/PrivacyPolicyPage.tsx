import { Shield } from 'lucide-react';

const companyName = 'WHATSJUD TECNOLOGIA EM SOFTWARE LTDA - ME';
const cnpj = '48.628.348/0001-54';
const website = 'https://adscore-keeper.lovable.app';
const email = 'processual@rprudencioadv.com';
const phone = '869995590127';
const address = 'AV ENG LUIZ CARLOS BERRINI, 1681, sala 111 e 112, São Paulo/SP';
const dpoEmail = 'processual@rprudencioadv.com';
const today = new Date().toLocaleDateString('pt-BR');
const year = new Date().getFullYear();

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Política de Privacidade</h1>
            <p className="text-xs text-muted-foreground">{companyName}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 prose prose-sm dark:prose-invert max-w-none">
        <p className="text-muted-foreground text-sm">Última atualização: {today}</p>

        <p>
          A <strong>{companyName}</strong>, inscrita no CNPJ sob o nº {cnpj}, com sede em {address} ("nós", "nosso" ou "Empresa"), é a controladora dos dados pessoais tratados por meio do site <a href={website} className="text-primary">{website}</a> e aplicativos associados.
        </p>
        <p>
          Esta Política de Privacidade tem como objetivo informar de forma clara e transparente como coletamos, usamos, armazenamos, compartilhamos e protegemos seus dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD), o Marco Civil da Internet (Lei nº 12.965/2014), o Código de Defesa do Consumidor (Lei nº 8.078/1990), o Regulamento Geral sobre a Proteção de Dados da União Europeia (GDPR – Regulamento UE 2016/679), a California Consumer Privacy Act (CCPA) e demais legislações aplicáveis.
        </p>

        <h2>Sobre o Serviço</h2>
        <p>
          O WhatsJUD é uma plataforma de gestão e produtividade voltada para escritórios de advocacia e equipes jurídicas. O sistema integra funcionalidades de CRM (gestão de leads e pipeline de vendas), comunicação via WhatsApp e Instagram (envio e recebimento de mensagens, comentários e DMs), gestão de contatos e relacionamentos, controle financeiro (transações bancárias, cartões de crédito e categorização de despesas), gestão de equipes (produtividade, avaliações e comissões), automação de fluxos de trabalho, análise de métricas de engajamento em redes sociais, gestão de atividades e tarefas, integração com Google Calendar, registro e gravação de chamadas telefônicas, importação e gestão de dados de CAT (Comunicação de Acidente de Trabalho), e geração de relatórios e dashboards analíticos.
        </p>

        <h2>1. Dados Pessoais Coletados</h2>
        <p>1.1. Coletamos os seguintes tipos de dados pessoais:</p>
        <ul>
          <li><strong>Dados de identificação:</strong> nome completo, CPF/CNPJ, data de nascimento, profissão (código CBO);</li>
          <li><strong>Dados de contato:</strong> e-mail, telefone, celular, endereço completo (CEP, cidade, estado, bairro);</li>
          <li><strong>Dados de acesso:</strong> endereço IP, geolocalização aproximada, tipo de dispositivo, sistema operacional, navegador, sessões de uso;</li>
          <li><strong>Dados de uso:</strong> páginas acessadas, tempo de permanência, cliques, filtros aplicados, buscas realizadas, exportações de dados;</li>
          <li><strong>Dados de redes sociais:</strong> nome de usuário do Instagram, comentários, mensagens diretas, métricas de engajamento, histórico de interações;</li>
          <li><strong>Dados de comunicação:</strong> mensagens enviadas e recebidas via WhatsApp, registros e gravações de chamadas telefônicas, histórico de conversas;</li>
          <li><strong>Dados financeiros:</strong> transações bancárias, transações de cartão de crédito, categorias de despesas, dados de comerciantes (CNPJ, nome, localização);</li>
          <li><strong>Dados profissionais e jurídicos:</strong> informações de leads, dados de acidentes de trabalho (CAT), classificações de casos, histórico de etapas processuais;</li>
          <li><strong>Dados de equipe:</strong> avaliações de produtividade, metas de comissão, registros de atividades, rotinas de trabalho;</li>
          <li><strong>Dados de integração:</strong> tokens de acesso a APIs (Meta/Facebook, Google), webhooks e dados de automação.</li>
        </ul>
        <p>1.2. Dados sensíveis, conforme art. 5º, II da LGPD, somente serão tratados com consentimento específico e destacado, ou nas hipóteses legais previstas no art. 11 da LGPD.</p>

        <h2>2. Finalidades do Tratamento</h2>
        <p>2.1. Seus dados pessoais são tratados para as seguintes finalidades:</p>
        <ul>
          <li>Prestação e melhoria dos serviços oferecidos;</li>
          <li>Comunicação sobre atualizações, novidades e suporte;</li>
          <li>Cumprimento de obrigações legais e regulatórias;</li>
          <li>Prevenção de fraudes e garantia da segurança;</li>
          <li>Personalização da experiência do usuário;</li>
          <li>Envio de comunicações de marketing (mediante consentimento);</li>
          <li>Análises estatísticas e estudos internos (dados anonimizados);</li>
          <li>Exercício regular de direitos em processos judiciais, administrativos ou arbitrais.</li>
        </ul>

        <h2>3. Bases Legais para o Tratamento (LGPD – Art. 7º)</h2>
        <p>3.1. Os tratamentos de dados são fundamentados nas seguintes bases legais:</p>
        <ul>
          <li>Consentimento do titular (art. 7º, I);</li>
          <li>Cumprimento de obrigação legal ou regulatória (art. 7º, II);</li>
          <li>Execução de contrato ou de procedimentos preliminares (art. 7º, V);</li>
          <li>Exercício regular de direitos (art. 7º, VI);</li>
          <li>Legítimo interesse do controlador (art. 7º, IX);</li>
          <li>Proteção do crédito (art. 7º, X).</li>
        </ul>

        <h2>4. Compartilhamento de Dados</h2>
        <p>4.1. Seus dados poderão ser compartilhados com:</p>
        <ul>
          <li>Prestadores de serviços essenciais (hospedagem, processamento de pagamentos, análise de dados);</li>
          <li>Parceiros comerciais, quando necessário para a prestação dos serviços;</li>
          <li>Autoridades públicas, em cumprimento de obrigação legal ou ordem judicial;</li>
          <li>Empresas do mesmo grupo econômico, para finalidades compatíveis.</li>
        </ul>
        <p>4.2. Em caso de transferência internacional de dados, serão adotadas as salvaguardas previstas nos arts. 33 a 36 da LGPD e no Capítulo V do GDPR, incluindo cláusulas contratuais padrão e verificação do nível de proteção do país destinatário.</p>
        <p>4.3. Não vendemos, alugamos ou comercializamos seus dados pessoais.</p>

        <h2>5. Armazenamento e Segurança</h2>
        <p>5.1. Seus dados são armazenados em servidores seguros, com a adoção de medidas técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados, situações acidentais ou ilícitas de destruição, perda, alteração ou comunicação, conforme art. 46 da LGPD e art. 32 do GDPR.</p>
        <p>5.2. Medidas de segurança adotadas incluem:</p>
        <ul>
          <li>Criptografia de dados em trânsito (TLS/SSL) e em repouso;</li>
          <li>Controles de acesso baseados em função (RBAC);</li>
          <li>Monitoramento contínuo e detecção de intrusões;</li>
          <li>Backups regulares e plano de recuperação de desastres;</li>
          <li>Treinamento periódico da equipe sobre proteção de dados.</li>
        </ul>
        <p>5.3. Os dados serão retidos pelo período necessário ao cumprimento das finalidades descritas nesta Política, observados os prazos legais de retenção obrigatória.</p>

        <h2>6. Direitos do Titular (LGPD – Art. 18)</h2>
        <p>6.1. Você tem o direito de, a qualquer momento, solicitar:</p>
        <ul>
          <li>Confirmação da existência de tratamento;</li>
          <li>Acesso aos seus dados pessoais;</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;</li>
          <li>Portabilidade dos dados a outro fornecedor de serviço;</li>
          <li>Eliminação dos dados tratados com base em consentimento;</li>
          <li>Informação sobre entidades públicas e privadas com as quais seus dados foram compartilhados;</li>
          <li>Informação sobre a possibilidade de não fornecer consentimento e suas consequências;</li>
          <li>Revogação do consentimento;</li>
          <li>Oposição ao tratamento realizado com base em legítimo interesse.</li>
        </ul>
        <p>6.2. Para exercer seus direitos, entre em contato pelo e-mail: <a href={`mailto:${dpoEmail}`} className="text-primary">{dpoEmail}</a>.</p>
        <p>6.3. Responderemos suas solicitações no prazo de até 15 (quinze) dias, conforme art. 18, §5º da LGPD.</p>

        <h2>7. Direitos Adicionais (GDPR e CCPA)</h2>
        <p>7.1. Para titulares residentes no Espaço Econômico Europeu (EEE), são assegurados adicionalmente:</p>
        <ul>
          <li>Direito de apresentar reclamação junto à autoridade supervisora competente;</li>
          <li>Direito à limitação do tratamento;</li>
          <li>Direito à não sujeição a decisões automatizadas.</li>
        </ul>
        <p>7.2. Para residentes da Califórnia (EUA), nos termos da CCPA:</p>
        <ul>
          <li>Direito de saber quais dados pessoais são coletados;</li>
          <li>Direito de solicitar a exclusão de dados;</li>
          <li>Direito de optar por não ter seus dados vendidos (não realizamos venda de dados);</li>
          <li>Direito à não discriminação pelo exercício de direitos de privacidade.</li>
        </ul>

        <h2>8. Cookies e Tecnologias de Rastreamento</h2>
        <p>8.1. Utilizamos cookies e tecnologias similares para:</p>
        <ul>
          <li>Garantir o funcionamento adequado do site/aplicativo;</li>
          <li>Analisar o uso e o desempenho dos serviços;</li>
          <li>Personalizar conteúdo e anúncios;</li>
          <li>Lembrar suas preferências.</li>
        </ul>
        <p>8.2. Você pode gerenciar suas preferências de cookies a qualquer momento por meio das configurações do seu navegador.</p>

        <h2>9. Encarregado de Proteção de Dados (DPO)</h2>
        <p>9.1. O Encarregado de Proteção de Dados designado pode ser contatado pelo e-mail: <a href={`mailto:${dpoEmail}`} className="text-primary">{dpoEmail}</a>.</p>

        <h2>10. Menores de Idade</h2>
        <p>10.1. Nossos serviços não se destinam a menores de 18 (dezoito) anos. Dados de crianças e adolescentes somente serão tratados em conformidade com o art. 14 da LGPD, com consentimento específico de pelo menos um dos pais ou responsável legal.</p>

        <h2>11. Alterações nesta Política</h2>
        <p>11.1. Reservamo-nos o direito de atualizar esta Política de Privacidade a qualquer momento, sendo que quaisquer alterações entrarão em vigor imediatamente após sua publicação.</p>
        <p>11.2. Notificaremos os titulares sobre alterações relevantes por meio de aviso em nosso site ou por e-mail.</p>

        <h2>12. Legislação e Foro Aplicáveis</h2>
        <p>12.1. Esta Política é regida pelas leis da República Federativa do Brasil.</p>
        <p>12.2. Fica eleito o foro da comarca de São Paulo/SP para dirimir quaisquer controvérsias decorrentes desta Política, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</p>

        <h2>13. Contato</h2>
        <p>Para dúvidas, sugestões ou solicitações relacionadas a esta Política de Privacidade, entre em contato:</p>
        <address className="not-italic text-sm text-muted-foreground space-y-1">
          <p>{companyName}</p>
          <p>Endereço: {address}</p>
          <p>E-mail: <a href={`mailto:${email}`} className="text-primary">{email}</a></p>
          <p>Telefone: {phone}</p>
          <p>Site: <a href={website} className="text-primary">{website}</a></p>
        </address>

        <hr />
        <p className="text-xs text-muted-foreground text-center">
          © {year} {companyName}. Todos os direitos reservados.
        </p>
      </main>
    </div>
  );
}
