# Instruções Permanentes — Claude Code (adscore-keeper)

Este arquivo é lido em toda sessão. Siga-o literalmente. Quando houver conflito entre velocidade e processo, siga o processo.

---

## REGRA 0 — Antes de responder

Releia este arquivo se:
- A sessão já passou de 10 mensagens
- Você vai alterar arquivo em `src/integrations/supabase/`, migrations, webhooks ou edge functions
- O usuário usar "urgente", "produção" ou "está quebrado"

Se não tem certeza sobre algo, diga explicitamente:
> "Não verifiquei X. Preciso rodar Y antes de responder."

**Nunca** preencha lacuna com palpite que soa informado. Palpite mascarado de fato é a pior falha possível aqui. Dizer "não sei, preciso checar" é sempre melhor que inventar.

---

## REGRA 1 — Evidência antes de diagnóstico

Proibido diagnosticar ou sugerir correção sem **pelo menos uma** destas evidências obtidas **nesta sessão**:

- Saída de `cat` ou leitura do arquivo relevante
- Resultado de SQL rodado contra o banco real
- Log do Supabase das últimas execuções da função/webhook em questão
- `EXPLAIN ANALYZE` se o problema for de performance
- `\d nome_tabela` se envolver índice ou constraint

Se não tiver a evidência, a resposta certa é:
> "Preciso ler [arquivo/log/SQL] antes de opinar."

Conhecimento geral de Postgres/React/Supabase **não** substitui evidência do código e dos dados deste projeto.

---

## REGRA 2 — Fluxo LDPEV obrigatório

Para qualquer problema não-trivial:

1. **L**er — código, logs, banco (Regra 1)
2. **D**iagnosticar — causa raiz com evidência citada
3. **P**lanejar — mostrar plano antes de executar, incluindo o que pode quebrar
4. **E**xecutar — aplicar
5. **V**erificar — rodar teste ou query que confirma o fix em dados reais

Pular etapas só vale para mudanças triviais (typo, remover `console.log`, renomear variável local). Em dúvida, não pule.

---

## REGRA 3 — Autonomia e limites

### Autônomo (sem perguntar):
- Ler arquivos, `grep`, `cat`, `ls`
- SQL de leitura (`SELECT`, `EXPLAIN`)
- Ler logs Supabase
- Editar arquivos
- `npm run build`, `npm run lint`, `npm test`
- `git status`, `git diff`, `git log`

### Sempre pedir confirmação explícita:
- `git push` — mostrar diff resumido antes
- `git commit` incluindo arquivos que você não editou nesta sessão
- SQL de escrita em produção (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`) — mostrar o SQL e quantas linhas serão afetadas
- Deploy de edge function
- Criar ou remover índice em tabela grande (usar `CONCURRENTLY` sempre)
- Apagar arquivo
- `npm install` de dependência nova
- Qualquer coisa com credenciais, secrets ou env vars

Use `--dangerously-skip-permissions` pra velocidade em leitura/edição, **nunca** como desculpa pra pular as confirmações acima.

---

## REGRA 4 — Não quebrar o que funciona

Antes de alterar função, componente ou RPC:

1. `grep -r "nome_da_coisa"` pra mapear usos
2. Listar em 1 linha cada fluxo afetado
3. Se houver teste, rodar antes (baseline) e depois
4. Se não houver teste, rodar manualmente o fluxo principal antes, pra saber o que "funcionando" parece

Se a mudança quebrar algo:
- `git restore <arquivo>` **imediatamente**
- Não consertar por cima — volta ao estado bom e re-planeja

Manter versão antiga como `_legacy` por 24h quando trocar função/RPC crítica. Remover só depois de confirmar que nada chama a antiga.

---

## REGRA 5 — Comunicação

- Português brasileiro, direto, sem floreio
- Discordar do usuário quando houver base técnica pra isso
- Nunca "pronto, funcionou!" sem mostrar evidência (saída de comando, SQL, log)
- No plano antes de executar, listar também o que **não** vai mexer — deixa o escopo claro
- Não inflacionar resposta com repetição do que o usuário já disse

---

## Contexto do projeto

- **Supabase Externo** `kmedldlepwiityjsdahz` — `whatsapp_messages`, webhooks
- **Supabase Cloud** `gliigkupoebmlbwyvijp` — auth, perfis, leads, instâncias
- **GitHub** `github.com/Raymsandreson/adscore-keeper`
- **Frontend** Lovable — publicar só após confirmação explícita

---

## Arquivo vs resposta inline

- Análise, diagnóstico, plano → chat
- Código que vai pro repo → arquivo
- Documentação nova → markdown no repo
- Migration SQL → `supabase/migrations/` com timestamp correto

---

## Lembrete final

Velocidade sem evidência é retrabalho disfarçado. Dois minutos lendo > duas horas revertendo.
