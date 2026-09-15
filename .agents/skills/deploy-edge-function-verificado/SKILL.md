---
name: deploy-edge-function-verificado
description: Como deployar edge function do Supabase neste projeto sem perguntar e sem quebrar produção. Cobre a autorização durável do usuário (set/2026), a ausência de SUPABASE_PAT no ambiente remoto, o deploy pelo MCP, e o protocolo canary → ezbr_sha256 → smoke test por pg_net. Use SEMPRE que for subir qualquer função em supabase/functions/ ou _external_*, ou quando aparecer dúvida sobre qual versão está realmente no ar.
---

# Deploy de edge function — autorizado, e verificado

## Autorização durável (set/2026)

**Deployar edge function sem perguntar.** O usuário autorizou expressamente e
pediu para não ser consultado de novo sobre isso. Não devolver a tarefa por
falta de PAT, não pedir confirmação a cada versão, não sugerir que ele rode o
script no lugar. Fazer, verificar e relatar.

O que continua valendo: mostrar no resumo o que subiu, a versão resultante e a
evidência do smoke test.

## O ambiente NÃO tem SUPABASE_PAT

`_deploy_send_whatsapp.mjs` e similares pedem `SUPABASE_PAT`. **Essa variável
não existe na sessão remota** — nem no ambiente, nem no `.env` (que só guarda
URL e chaves publicáveis). Conferido em 15/09/2026.

Não peça o PAT ao usuário. **Use o MCP do Supabase**, que já tem credencial:
`mcp__Supabase__deploy_edge_function`.

Atenção ao grep: procurar só por `SUPABASE_ACCESS_TOKEN` ou `SUPABASE_SERVICE`
deixa `SUPABASE_PAT` passar batido. Procure por `PAT|TOKEN|SUPABASE`.

## A regra que salvou a v30: confira o que está NO AR, não o que está no repo

Antes de deployar, **sempre** rode `mcp__Supabase__get_edge_function` e compare
com o arquivo local.

Em 15/09/2026, ao subir a v30 do `send-whatsapp`, produção estava na **v28** — a
v29 estava commitada no repo há tempo, com um arquivo `index.v29.rollback.ts`
que se anunciava "espelho fiel da v29 deployada", e **nunca tinha subido**.
Quem confiasse no espelho reverteria para uma versão que jamais existiu em
produção.

> Espelho de rollback não é confiável por estar no repo. O que está no ar é o
> que `get_edge_function` devolve.

Consequência prática: o deploy da v30 levou a v29 de carona. Delta zero naquele
caso, mas era preciso saber e dizer.

## Protocolo de deploy verificado

O MCP exige o conteúdo do arquivo **inline** — não aceita caminho. Isso
significa transmitir o arquivo inteiro à mão (47 KB no caso do `send-whatsapp`),
e um caractere errado no único ponto por onde passa toda mensagem do escritório
derruba a comunicação com cliente. O protocolo abaixo elimina esse risco.

1. **Confira o que está no ar.** `get_edge_function` no slug de destino. Anote
   `version` e `verify_jwt` — o deploy tem que repetir o mesmo `verify_jwt`
   (`send-whatsapp` é `false`).
2. **Deploy numa canary primeiro**, com nome novo (`<slug>-canary-vNN`). Função
   nova não é chamada por ninguém: risco zero.
3. **Smoke test na canary.** Egress para `*.supabase.co` é bloqueado nesta
   sessão, então `curl` não serve. Chame por `pg_net`, de dentro do banco:

   ```sql
   select net.http_post(
     url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/<slug>',
     headers := jsonb_build_object('Content-Type','application/json'),
     body := '{"action":"send_text"}'::jsonb,
     timeout_milliseconds := 25000) as request_id;
   -- depois, com alguns segundos de espera:
   select status_code, content from net._http_response where id = <request_id>;
   ```

   Um body inválido já prova que o arquivo parseia e o handler roda — erro de
   transcrição vira erro de sintaxe e a função nem responde.
4. **Deploy em produção** com o MESMO conteúdo.
5. **Compare o `ezbr_sha256`** devolvido pelos dois deploys. Hash igual é prova
   criptográfica de que produção recebeu byte a byte o que a canary já provou
   bom. Isso vale mais que qualquer diff de texto.
6. **Smoke test em produção**, igual ao passo 3.

## Testar o caminho perigoso sem mandar mensagem

Para validar o fluxo de envio sem disparar WhatsApp para ninguém, use uma
combinação que o gate bloqueia **antes** da chamada à UazAPI. Exemplo real:
instância classificada `PROVAVELMENTE BANIDA` em `wa_instancia_risco` + número
novo → `wa_gate_envio` devolve `permitido: false` e a função retorna sem enviar.

Confirme antes em SQL, com `p_registrar := false`, que a decisão é mesmo de
bloqueio — assim o teste não polui contador nem manda nada:

```sql
select public.wa_gate_envio('<instancia morta>', '<numero>', 'teste', false);
```

## Rollback

Cada versão tem espelho em
`supabase/functions/_external_send-whatsapp/index.vNN.rollback.ts`.
**Mas confira qual é a versão realmente deployada antes de escolher o alvo** —
ver a seção acima. Reverter é redeployar o conteúdo do espelho certo, pelo mesmo
protocolo (canary primeiro, se houver tempo; direto, se for incêndio).
