// ============================================================================
// Quando o aviso do INSS não chega ao cliente
//
// A falha de envio era o único desfecho mudo do fluxo. Sem grupo vinculado, o
// robô escreve na atividade que o cliente não foi avisado; envio recusado pela
// instância virava só `zap_erro` no banco e uma linha de log — ninguém lê
// nenhum dos dois. A assimetria era o defeito: a falha mais segura (não sei
// para onde mandar, então não mando) gritava, e a mais perigosa (tentei mandar
// e o WhatsApp recusou) era silenciosa.
//
// Custo medido em 04/09/2026: das duas falhas registradas, uma era um
// INDEFERIMENTO do próprio dia — o cliente teve o benefício negado e ninguém
// no escritório soube que o aviso não saiu. Nada foi reenviado nos dois casos.
//
// Classificar importa porque a esteira de conserto é diferente: instância
// desconectada é problema do escritório (reconectar e reenviar), grupo
// inexistente é vínculo errado no lead. Aviso que não diz o que fazer vira
// ruído — ver o princípio do conserto estrutural.
// ============================================================================

export type CausaFalha =
  | 'instancia_desconectada'
  | 'grupo_inexistente'
  | 'sem_texto'
  | 'expirado'
  | 'outro';

/**
 * Lê o `zap_erro` cru — que é o corpo da UazAPI — e diz de que falha se trata.
 * Casa pelo texto do erro, não pelo código HTTP: a UazAPI devolve 500 tanto
 * para grupo inexistente quanto para falha genérica de envio.
 */
export function classificarFalha(zapErro?: string | null): CausaFalha {
  const e = String(zapErro || '').toLowerCase();
  if (!e) return 'outro';
  if (/disconnected|not reconnectable|session is not|desconectad/.test(e)) return 'instancia_desconectada';
  if (/group does not exist|not-authorized|group not found|não existe/.test(e)) return 'grupo_inexistente';
  if (/agendado sem texto/.test(e)) return 'sem_texto';
  if (/parado mais de|expirad/.test(e)) return 'expirado';
  return 'outro';
}

const O_QUE_FAZER: Record<CausaFalha, string> = {
  instancia_desconectada:
    'O WhatsApp que enviaria a mensagem está desconectado. Reconecte a instância ' +
    '(Configurações → WhatsApp → reconectar, ler o QR) e mande esta atualização ao cliente por aqui. ' +
    'Enquanto ela estiver fora do ar, nenhuma mensagem deste grupo sai sozinha.',
  grupo_inexistente:
    'O grupo vinculado a este lead não existe mais no WhatsApp — pode ter sido apagado ou o número ' +
    'que enviava saiu dele. Vincule o grupo certo ao lead (ficha do lead → WhatsApp → vincular grupo) ' +
    'e avise o cliente desta atualização por aqui.',
  sem_texto:
    'A mensagem foi agendada sem texto e não tinha o que enviar. Avise o cliente desta atualização ' +
    'por aqui e reporte, porque isso é falha do robô, não do cadastro.',
  expirado:
    'A mensagem ficou tempo demais na fila e não vale mais mandar automaticamente. Confira se o ' +
    'cliente já soube desta atualização e, se não souber, avise por aqui.',
  outro:
    'O WhatsApp recusou o envio. Confira o grupo e a instância do lead e avise o cliente desta ' +
    'atualização por aqui.',
};

/**
 * O bloco que entra na atividade. Mesmo formato dos avisos que já existem
 * (`sem_grupo`, `vinculo_retroativo`): título em caixa alta dizendo o que
 * aconteceu com o cliente, depois o que fazer, depois o motivo técnico.
 */
export function avisoDeFalhaNoEnvio(args: { zapErro?: string | null; tipo?: string | null }): string {
  const causa = classificarFalha(args.zapErro);
  const assunto = urgenciaDoTipo(args.tipo);
  const motivo = String(args.zapErro || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return (
    '\n\n🚫 O CLIENTE NÃO FOI AVISADO — o robô tentou mandar a mensagem e o WhatsApp recusou.' +
    assunto +
    `\n${O_QUE_FAZER[causa]}` +
    (motivo ? `\nMotivo técnico: ${motivo}` : '')
  );
}

/**
 * Ênfase por tipo. Protocolo e exigência o cliente descobre depois sem prejuízo;
 * deferimento e indeferimento são DECISÃO — num o prazo corre, no outro o
 * cliente tem dinheiro a receber e não sabe. O aviso precisa separar os dois
 * casos, senão vira mais uma linha igual às outras na atividade.
 */
function urgenciaDoTipo(tipo?: string | null): string {
  if (tipo === 'indeferido') {
    return ' Este é um INDEFERIMENTO: o prazo do cliente corre a partir de quando ele fica sabendo.';
  }
  if (tipo === 'deferido') {
    return ' Este é um DEFERIMENTO: o benefício foi aprovado e o cliente ainda não sabe.';
  }
  return '';
}

/**
 * O nome do segurado no requerimento não bate com nenhum nome do lead, então a
 * mensagem iria para o grupo de OUTRO cliente e o robô se recusou a mandar.
 *
 * A recusa está certa — medido em 04/09/2026, de 38 eventos parados assim
 * apenas 2 eram a mesma pessoa com grafia diferente (DANIELLE/DANIELE,
 * RAINARA/RAYNARA); os outros 36 eram nomes de fato distintos. Afrouxar a
 * checagem trocaria silêncio por decisão de INSS no grupo do cliente errado.
 *
 * Este texto vai DENTRO da descrição da atividade, no momento em que ela nasce
 * — não como acréscimo depois. O aviso de vínculo suspeito já existia ali
 * desde antes; o que faltava era dizer a urgência (deferimento e indeferimento
 * são decisão, não andamento), lembrar que às vezes é só grafia, e avisar que
 * um vínculo errado prende TODAS as próximas atualizações no mesmo lugar.
 */
export function avisoDeVinculoSuspeito(args: {
  motivo?: string | null;
  tipo?: string | null;
}): string {
  const motivo = String(args.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return (
    '\n\n🛑 O CLIENTE NÃO FOI AVISADO — o nome do segurado neste requerimento não bate com o ' +
    'nome deste lead, e mandar assim colocaria a informação no grupo de outro cliente.' +
    urgenciaDoTipo(args.tipo) +
    '\nConfira de quem é este requerimento. Se for mesmo deste lead, corrija o nome no cadastro ' +
    '(às vezes é só a grafia: DANIELLE contra DANIELE) e avise o cliente desta atualização por ' +
    'aqui. Se não for, desvincule o protocolo na tela de Protocolos e ligue-o ao lead certo — ' +
    'enquanto o vínculo estiver errado, TODAS as próximas atualizações deste requerimento vão ' +
    'parar aqui também.' +
    (motivo ? `\nO que não bateu: ${motivo}` : '')
  );
}

/**
 * O que aconteceu com a mensagem ao cliente, dito na atividade.
 *
 * Pedido do usuário (04/09/2026): já que a atividade é sempre criada — medido,
 * 51 de 51 eventos em falha têm uma —, ela é o lugar certo para explicar por
 * que o cliente não recebeu. Antes disso só 6 dos 13 desfechos explicavam:
 * `silencio` (52 eventos), `retroativo` (26), `repetido` e `expirado` não
 * diziam nada, e quem abria a atividade não tinha como saber se o cliente
 * já sabia da atualização ou não.
 *
 * Devolve `null` para os desfechos cujo texto JÁ está na descrição desde que
 * ela nasce (vínculo suspeito, perícia do escritório, pendência só nossa) e
 * para o deferimento, que tem roteiro próprio — repetir daria dois avisos
 * iguais na mesma atividade.
 */
export function explicarDestinoDaMensagem(args: {
  zapStatus?: string | null;
  zapErro?: string | null;
  tipo?: string | null;
}): string | null {
  const st = args.zapStatus || '';
  const motivo = String(args.zapErro || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  switch (st) {
    case 'enviado':
      return '\n\n✅ O CLIENTE JÁ FOI AVISADO no grupo, com este mesmo conteúdo em linguagem simples.';

    case 'agendado':
      return (
        '\n\n🕗 A MENSAGEM ESTÁ PRONTA E SAI SOZINHA na próxima janela de 8h às 20h — o cliente ' +
        'ainda não foi avisado. Não precisa mandar à mão; se for urgente, mande e a duplicata é ' +
        'só o incômodo de duas mensagens.'
      );

    case 'silencio':
      return (
        '\n\n🔇 ESTE EVENTO NÃO VIRA MENSAGEM. O status não é protocolo, exigência nem conclusão, ' +
        'então não há o que contar ao cliente. Nada a fazer.'
      );

    case 'retroativo':
      return (
        '\n\n🕰️ O CLIENTE NÃO FOI AVISADO — este evento é anterior à ativação do aviso automático, ' +
        'e o robô não dispara mensagem de coisa velha para não assustar quem já resolveu o assunto. ' +
        'Se ele ainda não souber, avise por aqui.'
      );

    case 'repetido':
      return (
        '\n\n🔁 O CLIENTE JÁ FOI AVISADO deste mesmo tipo de atualização neste requerimento. O robô ' +
        'não repete para não virar spam no grupo. Se o conteúdo mudou e importa, mande à mão.'
      );

    case 'expirado':
      return (
        '\n\n⌛ O CLIENTE NÃO FOI AVISADO — a mensagem ficou tempo demais na fila e deixou de valer ' +
        `automaticamente${motivo ? ` (${motivo})` : ''}. Confira se ele já soube e, se não, avise por aqui.`
      );

    case 'vinculo_retroativo':
      return (
        '\n\n🔗 ESTE REQUERIMENTO ACABOU DE GANHAR DONO. O robô ligou o requerimento a este lead pelo ' +
        'nome do segurado — antes disso o e-mail do INSS não era tarefa de ninguém. O CLIENTE NÃO FOI ' +
        'AVISADO: confira se o requerimento é mesmo deste lead e, se for, avise-o do que está escrito ' +
        'acima. Daqui para frente as atualizações deste requerimento saem sozinhas.'
      );

    case 'sem_grupo':
      return (
        '\n\n📵 O CLIENTE NÃO FOI AVISADO — este lead não tem grupo de WhatsApp confiável vinculado' +
        `${motivo ? ` (${motivo})` : ''}.\n` +
        'Vincule o grupo certo ao lead (ficha do lead → WhatsApp → vincular grupo) e avise o cliente ' +
        'desta atualização por aqui. Depois de vinculado, as próximas mensagens saem sozinhas.'
      );

    case 'erro':
      return avisoDeFalhaNoEnvio({ zapErro: args.zapErro, tipo: args.tipo });

    // Já ditos na descrição desde que ela nasce, ou com roteiro próprio.
    case 'suspeito':
    case 'so_equipe':
    case 'pericia_escritorio':
    case 'so_escritorio':
      return null;

    default:
      return null;
  }
}

/**
 * O PDF da procuração existe mas não foi junto, porque a mensagem não saiu.
 * Fica no MESMO bloco do destino da mensagem: até 04/09/2026 era um `update`
 * separado que relia a descrição original, então dois avisos no mesmo evento se
 * apagavam — nunca foi observado em dado real, mas o desenho permitia.
 */
export function avisoDeProcuracaoNaoEntregue(zapStatus?: string | null): string {
  const motivo =
    zapStatus === 'agendado'
      ? 'a mensagem ficou agendada para a janela de 8h às 20h e o PDF vai junto com ela'
      : `a mensagem não saiu (${zapStatus})`;
  return (
    `\n\n📎 O PDF DA PROCURAÇÃO AINDA NÃO CHEGOU AO CLIENTE: ${motivo}. ` +
    'Se precisar adiantar, mande o link acima no grupo.'
  );
}
