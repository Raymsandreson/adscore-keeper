// check-time-off — "o prazo que eu vou marcar cai em ausência de alguém?"
//
// Leitura pura, sem efeito colateral. Existe porque o ADIAR do app precisa da
// resposta mas não do endpoint inteiro: ele não cria nada, e um `create-activity`
// que também atualiza seria nome mentindo. Um `update-activity-deadline` próprio
// seria um segundo endpoint para carregar uma regra só — então o adiar PERGUNTA
// aqui e segue gravando pelo `write.ts` do app.
//
// A regra mora em `lib/ausencias`, e o `create-activity` chama a MESMA função:
// uma regra, um lugar, dois consumidores.
//
// CONSEQUÊNCIA HONESTA, e ela precisa estar escrita: como o adiar continua
// gravando pelo cliente, isto é CONSELHO, não tranca. Um app com o código
// alterado grava assim mesmo. É aceitável pelo mesmo motivo do §3.4 — protege
// contra engano de agenda, não contra má-fé — e é a diferença entre este caso e
// o dedup do `create-activity`, que PRECISA ser tranca de servidor porque o
// cliente não tem como saber o que o outro aparelho fez.
//
// POST { user_ids?: string[], date: "YYYY-MM-DD" }   // uuids do CLOUD; vazio = o autor do JWT
//   -> { success: true, conflicts: [...] }
//   -> { success: true, conflicts: [], ausencia_nao_verificada: true }
//   -> { success: false, error: "nao_autenticado" }
import type { RequestHandler } from 'express';
import { consultarAusencias } from '../lib/ausencias';
import { autorDaRequisicao } from '../lib/identidadeDoApp';

export const handler: RequestHandler = async (req, res) => {
  // Formato da casa (chat-to-activity): sempre HTTP 200, resultado no corpo.
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const autor = await autorDaRequisicao(req.headers.authorization);
    if (!autor) return ok({ success: false, error: 'nao_autenticado' });

    const body = (req.body || {}) as { user_ids?: unknown; date?: unknown };
    const pedidos = Array.isArray(body.user_ids)
      ? (body.user_ids as unknown[]).map((v) => String(v || '')).filter(Boolean)
      : [];
    // Lista vazia é o caso comum: quem adia a própria atividade pergunta por si.
    const ids = pedidos.length > 0 ? pedidos : [autor.cloudUserId];

    const consulta = await consultarAusencias(ids, body.date as string | null | undefined);

    return ok({
      success: true,
      conflicts: consulta.conflitos,
      // Só aparece quando a consulta falhou. Cliente antigo, que não conhece a
      // flag, continua lendo `conflicts: []` e se comportando como antes.
      ...(consulta.verificado ? {} : { ausencia_nao_verificada: true }),
    });
  } catch (e) {
    console.error('[check-time-off] erro:', e);
    // Erro inesperado aqui também falha aberto: a resposta diz "não conferi",
    // e não "não há ausência".
    return ok({ success: true, conflicts: [], ausencia_nao_verificada: true });
  }
};
