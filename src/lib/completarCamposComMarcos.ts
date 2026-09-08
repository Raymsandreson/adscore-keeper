/**
 * "Completar campos vazios com os marcos do processo".
 *
 * Quando ligado, a mensagem da atividade (Copiar, Enviar ao Grupo, prévia e
 * áudio) escreve sozinha as seções "Como está?", "O que foi feito?" e "Próximo
 * passo" que o assessor deixou **em branco**, usando os marcos da régua do
 * processo — movimentações e documentos reais, nada inventado. Texto digitado
 * sempre vence: isto só cobre o vazio.
 *
 * **Desligado de fábrica** (08/09/2026). Nasceu ligado em 30/08/2026 para que a
 * atividade automática não saísse sem nenhuma das três seções, mas passou a
 * valer para qualquer atividade com régua: quem copiava a mensagem via um campo
 * que não preencheu aparecer escrito, sem ter pedido, e ia para o grupo do
 * cliente como se fosse texto do assessor.
 *
 * A escolha é por navegador (`localStorage`), como as outras preferências de
 * tela do app — a configuração de campos em si (`activity_field_settings`)
 * continua sendo do escritório inteiro, no banco.
 */

const CHAVE_PREF = 'atividade-completar-campos-marcos';

/** Preferência atual. Sem nada salvo, desligada. */
export function completarCamposComMarcosLigado(): boolean {
  try {
    return localStorage.getItem(CHAVE_PREF) === 'true';
  } catch {
    return false; // navegador sem storage: segue desligada
  }
}

/** Liga/desliga e guarda a escolha neste navegador. */
export function setCompletarCamposComMarcos(ligado: boolean): void {
  try {
    localStorage.setItem(CHAVE_PREF, ligado ? 'true' : 'false');
  } catch {
    /* sem storage: vale só nesta sessão */
  }
}
