import { FileText } from 'lucide-react';

const companyName = 'WHATSJUD TECNOLOGIA EM SOFTWARE LTDA - ME';
const cnpj = '48.628.348/0001-54';
const website = 'https://adscore-keeper.lovable.app';
const email = 'processual@rprudencioadv.com';
const phone = '869995590127';
const address = 'AV ENG LUIZ CARLOS BERRINI, 1681, sala 111 e 112, São Paulo/SP';
const today = new Date().toLocaleDateString('pt-BR');
const year = new Date().getFullYear();

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Termos de Uso</h1>
            <p className="text-xs text-muted-foreground">{companyName}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 prose prose-sm dark:prose-invert max-w-none">
        <p className="text-muted-foreground text-sm">Última atualização: {today}</p>

        <p>
          Os presentes Termos de Uso ("Termos") regulam o acesso e a utilização da plataforma WhatsJUD, de titularidade da <strong>{companyName}</strong>, inscrita no CNPJ sob o nº {cnpj}, com sede em {address} ("WhatsJUD", "nós" ou "Empresa"), disponibilizada por meio do site <a href={website} className="text-primary">{website}</a> e aplicativos associados.
        </p>
        <p>
          A utilização dos serviços implica aceitação integral e incondicional destes Termos. Caso não concorde com qualquer disposição, o usuário deverá abster-se de utilizar a plataforma.
        </p>

        <h2>1. Aceitação dos Termos</h2>
        <p>1.1. Ao se cadastrar, acessar ou utilizar a plataforma WhatsJUD, o usuário declara ter lido, compreendido e aceitado integralmente estes Termos de Uso, bem como a Política de Privacidade que os complementa.</p>
        <p>1.2. Caso o usuário esteja contratando em nome de pessoa jurídica, declara possuir poderes suficientes para vincular tal entidade aos presentes Termos.</p>
        <p>1.3. A não concordância com qualquer cláusula implica a impossibilidade de uso da plataforma.</p>

        <h2>2. Descrição do Serviço</h2>
        <p>2.1. O WhatsJUD é uma plataforma de Software como Serviço (SaaS) voltada à gestão de escritórios de advocacia e equipes jurídicas, oferecendo, entre outras funcionalidades:</p>
        <ul>
          <li>CRM jurídico para gestão de leads, prospecção e funis de atendimento;</li>
          <li>Atendimento integrado via WhatsApp Business Platform e Instagram;</li>
          <li>Gestão de contatos, casos, atividades e tarefas;</li>
          <li>Controle financeiro (transações, despesas e categorizações);</li>
          <li>Gestão de equipe (produtividade, metas, avaliações e comissões);</li>
          <li>Integrações com APIs da Meta (Facebook/Instagram/WhatsApp) e Google;</li>
          <li>Geração de relatórios, dashboards e análises de métricas.</li>
        </ul>
        <p>2.2. A WhatsJUD reserva-se o direito de modificar, suspender ou descontinuar funcionalidades, a qualquer tempo, mediante aviso prévio razoável aos usuários.</p>

        <h2>3. Cadastro e Conta do Usuário</h2>
        <p>3.1. Para utilizar a plataforma, o usuário deverá realizar cadastro fornecendo informações verdadeiras, completas e atualizadas.</p>
        <p>3.2. É obrigatório ter no mínimo 18 (dezoito) anos de idade e plena capacidade civil.</p>
        <p>3.3. O usuário é o único e exclusivo responsável pela guarda e sigilo de suas credenciais de acesso (login e senha), comprometendo-se a notificar imediatamente a WhatsJUD em caso de uso não autorizado.</p>
        <p>3.4. Toda atividade realizada por meio da conta do usuário será considerada de sua responsabilidade.</p>
        <p>3.5. A WhatsJUD reserva-se o direito de recusar, suspender ou cancelar cadastros que apresentem informações falsas, inconsistentes ou em desacordo com estes Termos.</p>

        <h2>4. Uso Permitido e Conduta Vedada</h2>
        <p>4.1. O usuário compromete-se a utilizar a plataforma de forma ética, lícita e em conformidade com a legislação aplicável.</p>
        <p>4.2. É expressamente vedado, dentre outras condutas:</p>
        <ul>
          <li>Envio de mensagens não solicitadas (spam), correntes ou comunicações em massa sem consentimento;</li>
          <li>Prática de phishing, fraude, engenharia social ou qualquer tentativa de obtenção indevida de dados;</li>
          <li>Utilização da plataforma para atividades ilícitas, criminosas ou que violem direitos de terceiros;</li>
          <li>Engenharia reversa, descompilação, desmontagem ou tentativa de extrair o código-fonte do software;</li>
          <li>Automação não autorizada, uso de bots, scrapers ou ferramentas que sobrecarreguem a infraestrutura;</li>
          <li>Violação à Lei nº 13.709/2018 (LGPD) e demais normas de proteção de dados;</li>
          <li>Violação aos Termos de Serviço da Meta Platforms, à WhatsApp Business Policy, às políticas comerciais do WhatsApp e demais regulamentos de plataformas integradas;</li>
          <li>Compartilhamento, sublicenciamento, revenda ou cessão do acesso à plataforma a terceiros sem autorização expressa.</li>
        </ul>
        <p>4.3. O descumprimento de qualquer das vedações acima poderá resultar em suspensão imediata da conta, sem prejuízo das medidas judiciais cabíveis.</p>

        <h2>5. Comunicações via WhatsApp</h2>
        <p>5.1. Ao utilizar as funcionalidades de comunicação via WhatsApp, o usuário declara e garante que possui <strong>consentimento explícito, prévio e específico</strong> dos titulares dos números de telefone cadastrados antes de iniciar qualquer conversa, em conformidade com a LGPD e com as políticas da Meta.</p>
        <p>5.2. O usuário compromete-se a respeitar integralmente:</p>
        <ul>
          <li>A janela de atendimento de 24 (vinte e quatro) horas estabelecida pelo WhatsApp Business Platform;</li>
          <li>O uso exclusivo de templates de mensagem previamente aprovados pela Meta para comunicações fora da janela de 24h;</li>
          <li>As políticas comerciais, de spam e de qualidade da Meta Platforms.</li>
        </ul>
        <p>5.3. O usuário reconhece que o uso do WhatsApp Business Platform está sujeito às políticas da Meta, podendo resultar em bloqueios, suspensões ou banimentos de número aplicados diretamente pela Meta, sem qualquer ingerência ou responsabilidade da WhatsJUD.</p>
        <p>5.4. A WhatsJUD não se responsabiliza por sanções, restrições ou penalidades aplicadas pela Meta em decorrência do uso indevido das integrações.</p>

        <h2>6. Propriedade Intelectual</h2>
        <p>6.1. Todo o software, código-fonte, marca, logotipo, layout, identidade visual, textos, base de dados e demais elementos integrantes da plataforma WhatsJUD são de propriedade exclusiva da Empresa, protegidos pela Lei nº 9.279/1996 (Propriedade Industrial), Lei nº 9.609/1998 (Software), Lei nº 9.610/1998 (Direitos Autorais) e demais normas aplicáveis.</p>
        <p>6.2. Mediante a aceitação destes Termos e o pagamento das contraprestações devidas, é concedida ao usuário uma licença de uso <strong>limitada, não exclusiva, intransferível, revogável e não sublicenciável</strong>, restrita ao período de vigência da assinatura.</p>
        <p>6.3. É vedada qualquer utilização da marca WhatsJUD sem autorização prévia e expressa, por escrito.</p>
        <p>6.4. Os dados inseridos pelo usuário na plataforma permanecem de sua titularidade, sendo a WhatsJUD mera operadora para os fins da LGPD.</p>

        <h2>7. Pagamento e Assinatura</h2>
        <p>7.1. O acesso à plataforma é prestado mediante pagamento de assinatura nas modalidades, planos e periodicidades vigentes, conforme divulgado no site oficial.</p>
        <p>7.2. A cobrança ocorrerá conforme o ciclo contratado (mensal, trimestral, anual ou outro), de forma recorrente e automática quando aplicável.</p>
        <p>7.3. O não pagamento na data de vencimento poderá ensejar suspensão do acesso, sem prejuízo da cobrança dos valores em aberto, acrescidos de multa, juros e correção monetária.</p>
        <p>7.4. O usuário poderá cancelar sua assinatura a qualquer tempo, sendo o cancelamento efetivo ao final do ciclo já pago, sem direito a reembolso proporcional, salvo disposição legal em contrário ou previsão específica do plano contratado.</p>
        <p>7.5. Nos termos do art. 49 do Código de Defesa do Consumidor, contratações realizadas fora do estabelecimento comercial poderão ser exercidas mediante direito de arrependimento no prazo de 7 (sete) dias.</p>

        <h2>8. Suspensão e Encerramento</h2>
        <p>8.1. A WhatsJUD poderá suspender ou encerrar, imediatamente e sem aviso prévio, o acesso do usuário nas seguintes hipóteses:</p>
        <ul>
          <li>Descumprimento de qualquer cláusula destes Termos ou da Política de Privacidade;</li>
          <li>Inadimplência das contraprestações financeiras;</li>
          <li>Uso indevido, fraudulento ou ilícito da plataforma;</li>
          <li>Determinação judicial ou de autoridade competente.</li>
        </ul>
        <p>8.2. O usuário poderá encerrar voluntariamente sua conta a qualquer tempo, mediante solicitação formal à WhatsJUD, com prazo de aviso prévio de 30 (trinta) dias.</p>
        <p>8.3. Em caso de encerramento, os dados do usuário serão tratados conforme a Política de Privacidade, sendo facultada a portabilidade nos termos da LGPD.</p>

        <h2>9. Limitação de Responsabilidade</h2>
        <p>9.1. A plataforma é fornecida "no estado em que se encontra" ("as is") e "conforme disponível" ("as available"), no limite máximo permitido pela legislação aplicável.</p>
        <p>9.2. A WhatsJUD <strong>não se responsabiliza</strong> por:</p>
        <ul>
          <li>Indisponibilidade, instabilidade, alterações ou descontinuidade de APIs e serviços de terceiros, incluindo, mas não se limitando a, Meta Platforms, WhatsApp Business Platform, Instagram e Google;</li>
          <li>Perdas indiretas, incidentais, consequenciais ou lucros cessantes;</li>
          <li>Decisões jurídicas, comerciais ou estratégicas tomadas pelo usuário com base em dados, análises, métricas ou relatórios gerados pela plataforma;</li>
          <li>Danos decorrentes de uso inadequado, configuração incorreta ou negligência do usuário;</li>
          <li>Eventos de caso fortuito ou força maior, nos termos do art. 393 do Código Civil.</li>
        </ul>
        <p>9.3. O limite máximo de indenização eventualmente devida pela WhatsJUD ao usuário, a qualquer título, fica desde já limitado ao valor efetivamente pago pelo usuário nos 12 (doze) meses imediatamente anteriores ao evento que deu causa à reclamação.</p>

        <h2>10. Garantias e Isenções</h2>
        <p>10.1. A WhatsJUD não oferece qualquer garantia, expressa ou implícita, de adequação da plataforma a fim específico, comercialização ou não violação.</p>
        <p>10.2. O usuário é o único responsável por validar a adequação da plataforma e de seus resultados aos seus casos jurídicos, fluxos internos e exigências regulatórias da advocacia.</p>
        <p>10.3. A WhatsJUD não substitui o juízo técnico-jurídico do advogado, sendo apenas ferramenta de apoio à gestão e produtividade.</p>

        <h2>11. Indenização</h2>
        <p>11.1. O usuário obriga-se a indenizar e manter indene a WhatsJUD, seus sócios, administradores, empregados e parceiros, por toda e qualquer reclamação, demanda judicial ou administrativa, perda, dano, custo ou despesa (incluindo honorários advocatícios) decorrentes de:</p>
        <ul>
          <li>Uso indevido ou em desacordo com estes Termos;</li>
          <li>Violação da Lei nº 13.709/2018 (LGPD) ou demais normas de proteção de dados;</li>
          <li>Violação das políticas da Meta, WhatsApp Business Platform, Google ou demais plataformas integradas;</li>
          <li>Violação de direitos de terceiros, especialmente direitos de personalidade, propriedade intelectual ou imagem.</li>
        </ul>

        <h2>12. Alterações nos Termos</h2>
        <p>12.1. A WhatsJUD reserva-se o direito de alterar estes Termos a qualquer tempo, a seu exclusivo critério.</p>
        <p>12.2. Alterações materiais serão comunicadas ao usuário com antecedência mínima de 30 (trinta) dias, por meio de aviso na plataforma ou pelo e-mail cadastrado.</p>
        <p>12.3. A continuidade do uso da plataforma após a entrada em vigor das alterações implica aceitação tácita dos novos Termos.</p>

        <h2>13. Lei Aplicável e Foro</h2>
        <p>13.1. Estes Termos são regidos pelas leis da República Federativa do Brasil.</p>
        <p>13.2. Fica eleito o foro da comarca de São Paulo/SP para dirimir quaisquer controvérsias decorrentes destes Termos, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</p>

        <h2>14. Disposições Gerais</h2>
        <p>14.1. Caso qualquer disposição destes Termos seja considerada nula, inválida ou inexequível, as demais permanecerão em pleno vigor e efeito.</p>
        <p>14.2. A tolerância de uma parte quanto ao descumprimento de qualquer cláusula pela outra não constituirá novação ou renúncia ao direito de exigir seu cumprimento.</p>
        <p>14.3. Todas as comunicações entre as partes serão consideradas válidas quando enviadas para os endereços eletrônicos cadastrados.</p>
        <p>14.4. É vedada a cessão, total ou parcial, dos direitos e obrigações decorrentes destes Termos pelo usuário sem prévia e expressa autorização da WhatsJUD.</p>

        <h2>15. Contato</h2>
        <p>Para dúvidas, sugestões ou solicitações relacionadas a estes Termos de Uso, entre em contato:</p>
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
