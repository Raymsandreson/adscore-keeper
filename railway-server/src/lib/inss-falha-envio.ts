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
  const assunto = args.tipo === 'indeferido'
    ? ' Este é um INDEFERIMENTO: o prazo do cliente corre a partir de quando ele fica sabendo.'
    : '';
  const motivo = String(args.zapErro || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return (
    '\n\n🚫 O CLIENTE NÃO FOI AVISADO — o robô tentou mandar a mensagem e o WhatsApp recusou.' +
    assunto +
    `\n${O_QUE_FAZER[causa]}` +
    (motivo ? `\nMotivo técnico: ${motivo}` : '')
  );
}
