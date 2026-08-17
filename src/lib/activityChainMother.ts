/**
 * O que a MÃE guarda quando alguém clica em "Concluir + próxima".
 *
 * O botão nunca gravou o formulário na atividade que está sendo concluída: o
 * `completeActivity` mexe em `status`, `completed_at`, `completed_by` e
 * `updated_by`, e nada mais. Tudo que a pessoa digitou ia **só para a filha**.
 * Medido em 17/08/2026 nos 1.000 elos de cadeia mais recentes: 56 com a mãe de
 * "O que foi feito" VAZIA e a filha cheia, e outros 151 com a mãe guardando uma
 * versão diferente da que foi digitada — ou seja, ~20% da cadeia com o relato
 * do trabalho parado na etapa que ainda nem começou.
 *
 * Aqui ficam só os 6 campos de TEXTO. O que deliberadamente NÃO entra:
 *  - `deadline` / `notification_date` / `callback_at` — são da PRÓXIMA etapa. A
 *    mãe fica concluída na data em que venceu; a data nova nasce na filha. Esse
 *    é o fluxo correto e não muda. Como o patch não tem `deadline` nem
 *    responsável, também não dispara o bloqueio de ausência registrada do
 *    `updateActivity`, que só olha essas chaves.
 *  - `title` — assunto trocado no formulário costuma ser o nome da PRÓXIMA
 *    etapa. Gravar na mãe reabriria o "a atividade muda de nome sozinha" de
 *    jul/2026, quando a IA sobrescrevia o assunto ao concluir.
 *
 * Duas regras, nesta ordem:
 *  1. campo igual ao que já está no banco não entra no patch (não reescreve
 *     coluna à toa, e mantém o `updated_at` honesto);
 *  2. campo VAZIO no formulário nunca apaga texto que existe na mãe. É
 *     assimétrico de propósito: formulário vazio com banco cheio é exatamente o
 *     que uma ficha meio-carregada parece, e o custo de apagar o relato do
 *     trabalho por engano não tem volta. Para esvaziar um campo de propósito,
 *     existe o Salvar.
 */
import { stripHtmlToText } from '@/components/activities/richTextFields';

/** Colunas de texto de `lead_activities` que pertencem à etapa que acabou. */
export const MOTHER_TEXT_COLUMNS = [
  'what_was_done',
  'current_status_notes',
  'next_steps',
  'notes',
  'solicitacao',
  'resposta_juizo',
] as const;

export type MotherTextColumn = (typeof MOTHER_TEXT_COLUMNS)[number];
export type ActivityTextFields = Partial<Record<MotherTextColumn, string | null>>;

/**
 * Vazio para o usuário, não para o banco: os campos longos são HTML do Lexical,
 * então um campo limpo chega como `<p></p>` ou `<p><br></p>` — string não-vazia
 * que não diz nada. Sem stripar as tags, a regra 2 nunca pegaria.
 */
const semTexto = (v?: string | null) => stripHtmlToText(v || '') === '';

/**
 * Patch de conteúdo para a mãe: o que o formulário tem de novo, sem as datas e
 * sem apagar nada. Devolve `{}` quando não há o que gravar — quem chama pode
 * pular o UPDATE inteiro.
 */
export function buildMotherContentPatch(
  form: ActivityTextFields,
  saved: ActivityTextFields,
): ActivityTextFields {
  const patch: ActivityTextFields = {};
  for (const col of MOTHER_TEXT_COLUMNS) {
    const novo = form[col] ?? null;
    const atual = saved[col] ?? null;
    if ((novo || '') === (atual || '')) continue; // regra 1
    if (semTexto(novo) && !semTexto(atual)) continue; // regra 2
    patch[col] = novo || null;
  }
  return patch;
}
