// PROXY do Cloud para a `auto-enrich-lead` do Externo.
//
// A função de verdade vive no Externo (kmedldlepwiityjsdahz). Este arquivo só
// repassa — e, ao repassar, TROCA a credencial de quem chamou pelo service role
// do Externo. É isso que torna a porta daqui a porta de tudo.
//
// PORTA (10/09/2026): `apply_fields` grava QUALQUER campo em QUALQUER `lead_id`,
// com service role. Antes deste gate, bastava a chave ANON — que é pública e
// está no bundle do front — para um estranho reescrever o cadastro de qualquer
// cliente do escritório.
//
// `verify_jwt` NÃO resolve isto: a chave anon é um JWT válido e passaria.
// A distinção precisa ser feita aqui, olhando QUEM chamou.
//
// O gate fica só no `apply_fields` porque o caminho de enriquecimento tem
// chamadores de servidor legítimos que só alcançam a chave anon:
// `whatsapp-webhook` (Railway e edge) e `zapsign-post-sign-extras`. Nenhum deles
// manda `apply_fields` — conferido em 10/09/2026: o único é o `LeadEditDialog`,
// pelo front, com o JWT do usuário logado.
import { createClient } from 'npm:@supabase/supabase-js@2';

const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/auto-enrich-lead';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

/** Papel declarado dentro do JWT, sem validar assinatura: só para separar anon de usuário. */
function papelDoToken(token: string): string {
  try {
    const meio = token.split('.')[1];
    if (!meio) return '';
    const json = atob(meio.replace(/-/g, '+').replace(/_/g, '/'));
    return String(JSON.parse(json)?.role || '');
  } catch (_e) {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  let ehApply = false;
  try {
    const corpo = body ? JSON.parse(body) : {};
    ehApply = !!corpo?.apply_fields && typeof corpo.apply_fields === 'object' && !Array.isArray(corpo.apply_fields);
  } catch (_e) {
    ehApply = false;
  }

  if (ehApply) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const papel = papelDoToken(token);
    let autorizado = false;
    // `motivo` existe para o gate poder ser TESTADO de fora sem uma sessão real.
    // A pergunta perigosa não é "o usuário passa?" e sim "o verificador está de
    // pé?": se faltar SUPABASE_URL ou SUPABASE_ANON_KEY nesta função, o
    // `getUser` estoura, cai no catch e o gate nega TODO MUNDO — inclusive o
    // front. Sem este campo, os dois casos devolvem o mesmo 401 e a diferença
    // fica invisível. Nenhum valor aqui revela credencial.
    let motivo = 'sem_token';

    if (papel === 'service_role') {
      // Chave privada: quem a tem já alcança o banco por fora.
      autorizado = true;
      motivo = 'service_role';
    } else if (papel === 'anon') {
      motivo = 'chave_anon_e_publica';
    } else if (token && papel) {
      // `getUser` confirma que o token é de alguém logado de verdade.
      const url = Deno.env.get('SUPABASE_URL') ?? '';
      const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
      if (!url || !anon) {
        motivo = 'verificador_indisponivel_faltam_env';
      } else {
        try {
          const verificador = createClient(url, anon);
          const { data } = await verificador.auth.getUser(token);
          autorizado = !!data?.user;
          motivo = autorizado ? 'usuario_autenticado' : 'token_nao_corresponde_a_usuario';
        } catch (_e) {
          motivo = 'verificador_falhou';
        }
      }
    }

    if (!autorizado) {
      console.warn(`[auto-enrich-proxy] apply_fields recusado: ${motivo}`);
      return new Response(JSON.stringify({ error: 'apply_fields exige usuário autenticado', motivo }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${externalKey}`,
    'apikey': externalKey,
  };

  try {
    const resp = await fetch(EXT, { method: req.method, headers, body });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: `Proxy failed: ${msg}` }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
