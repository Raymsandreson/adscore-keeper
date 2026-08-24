// =============================================================================
// Cargos operacionais do jurídico que o POP usa como responsável.
//
// Por que existe (24/08/2026). As opções de cargo do POP vêm de job_positions
// (fichas formais do plano de carreira) e a lista que existia era quase toda
// comercial — SDR, Closer, AE Sênior, Coordenador, Gerente, Diretor — mais os
// quatro degraus de Advogado. Faltava justamente quem toca o dia a dia de um
// POP previdenciário: o processo de BPC passa por triagem, CadÚnico, protocolo
// no Meu INSS e acompanhamento de exigência muito antes de existir petição.
//
// A LINHA QUE ESTAS DESCRIÇÕES GUARDAM. Nenhum destes cargos exige formação em
// Direito nem inscrição na OAB — apoio processual, protocolo, controle de
// prazo e contato com cliente não são atos privativos. O que É privativo de
// advogado é postular em juízo, assinar petição e dar parecer jurídico
// (Lei 8.906/94, art. 1º). Como no POP o cargo RESOLVE o dono do passo, essa
// fronteira precisa estar escrita na descrição do cargo: é ela que aparece na
// seção Time e cargos e evita que um passo de peticionamento caia em quem não
// pode assinar.
//
// Não é uma lista fechada nem um seed de banco: são atalhos do formulário de
// "Novo cargo". Quem cria escolhe, edita o texto e grava — a ficha formal
// resultante é uma job_positions comum, igual a qualquer outra.
// =============================================================================

export interface CargoSugerido {
  nome: string;
  descricao: string;
}

export const CARGOS_JURIDICOS_SUGERIDOS: CargoSugerido[] = [
  {
    nome: 'Assessor Jurídico',
    descricao:
      'Apoio ao processo: organiza documentos, controla prazos, protocola, acompanha o andamento e fala com o cliente. ' +
      'Não exige formação em Direito nem OAB. Em contrapartida, não assina petição, não postula em juízo e não emite ' +
      'parecer jurídico — atos privativos de advogado (Lei 8.906/94, art. 1º).',
  },
  {
    nome: 'Assessor Previdenciário (INSS)',
    descricao:
      'Conduz a fase administrativa: protocola requerimento no Meu INSS, acompanha exigência e mudança de status, ' +
      'junta documento e prepara o caso para a fase judicial quando indeferido. Não exige formação em Direito.',
  },
  {
    nome: 'Atendimento e Triagem',
    descricao:
      'Primeiro contato com o cliente, coleta de documentos e checagem de viabilidade antes de o caso virar processo. ' +
      'Não exige formação em Direito.',
  },
  {
    nome: 'Estagiário de Direito',
    descricao:
      'Cursando Direito. Faz o apoio processual sob supervisão de advogado; não assina petição nem postula sozinho.',
  },
];
