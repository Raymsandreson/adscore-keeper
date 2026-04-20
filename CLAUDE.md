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

## Princípios permanentes de cibersegurança

Antes de qualquer sugestão de código ou arquitetura, avaliar:

1. **Dados sensíveis nunca em logs**: CPF, RG, número de processo, dados bancários, mensagens de clientes. Se log for necessário pra debug, mascarar antes (ex: `CPF: ***.***.***-12`).

2. **Secrets nunca no repo**: API keys, tokens, credenciais vão em variáveis de ambiente. Se aparecer `.env` commitado ou secret hardcoded em código, parar e alertar.

3. **Webhook endpoints exigem verificação de origem**: webhook da UazAPI, Meta, Celcoin, etc. precisam validar assinatura ou token antes de processar payload. Sem verificação = vulnerável a spoofing.

4. **Supabase RLS obrigatório em tabelas com dados de cliente**: antes de criar tabela nova ou coluna sensível, confirmar que RLS está habilitado e policies cobrem os casos de uso. Tabela sem RLS é considerada bug crítico.

5. **Permissões de edge functions mínimas**: se a função não precisa de SERVICE_ROLE_KEY, usa ANON_KEY. Cada função deve ter o escopo mínimo necessário.

6. **Dados de clientes não saem do ambiente Brasil (LGPD)**: se propor integração com serviço externo, verificar se é em região brasileira ou com acordo de transferência internacional. Se não for, alertar.

7. **Edge functions públicas validam JWT**: se uma edge expõe endpoint público (`verify_jwt = false` na config), toda a validação de autenticação precisa ser manual no código. Alertar se aparecer JWT desativado sem validação compensatória.

---

## Princípios permanentes de escalabilidade

Antes de qualquer sugestão de código ou arquitetura, avaliar:

1. **Performance sob carga, não só correção**: código novo deve considerar comportamento sob N = 10.000+ linhas, N = 100 usuários simultâneos, N = 1.000 mensagens/min. Não só "funciona com 3 casos no dev".

2. **Queries sempre com índice em coluna de filtro**: se a query filtra por `WHERE instance_name = X`, tem que ter índice em `instance_name` (ou composto incluindo). Alertar se propor query sem cobertura de índice.

3. **Evitar N+1 queries**: quando lista de recursos precisa de dados relacionados, usar JOIN ou IN em single-query, não N queries dentro de um loop.

4. **Realtime/polling: preferir realtime**: já aprendemos nesta base (Fase 3). Novas features com atualização automática devem usar Supabase Realtime, não setInterval.

5. **Edge function quick wins**: se uma edge function roda muito (>10k invocations/dia), considerar cache (upstash, redis), batch processing, ou migração pra servidor dedicado (tipo Railway — já temos pipeline).

6. **Componentes React com muitos itens usam useMemo**: lista com 100+ itens, sort, filter, ou transform — sempre useMemo pra evitar recálculo a cada render. Também useCallback em handlers passados como prop pra componentes que React.memo.

7. **Custos visíveis em decisão**: toda nova integração ou função tem custo associado (tokens LLM, invocations, storage, bandwidth). Antes de sugerir, mencionar ordem de grandeza esperada pra usuário decidir.

8. **Migração sempre reversível**: estrutura grande de mudança (schema, roteamento, deploys) deve vir com plano de rollback testado. Se não for possível reverter em <5min, alerta alto-risco.

---

## Princípios permanentes de processo e rigor

Regras de conduta obrigatórias durante qualquer execução:

1. **Rota de fuga antes de mexer**: antes de alterar infra, deploy, schema, env var, ou roteamento, criar rollback verificável e documentado. Sem rollback = não executa.

2. **Confira, não assuma**: validar arquivo, branch, commit, remote, env, contexto antes de editar. Se tiver dúvida se comando vai afetar o que você pensa, rode query de verificação primeiro.

3. **Mostre ponto de inserção antes em arquivos sensíveis**: em CLAUDE.md, proximos_passos.md, migrations SQL, config de produção, sempre mostrar onde vai inserir antes de aplicar. Usuário aprova o "onde" separado do "o quê".

4. **Pare diante de risco alto**: se detectar chance de quebra em produção, vazamento de dado, lockout de conta, perda irreversível — para, não tenta contornar, avisa o usuário explicitamente e aguarda instrução.

5. **Ordem literal quando especificada**: quando o usuário passar ordem específica (ex: "primeiro A, depois B, só então C"), seguir exatamente. Não reordenar "por eficiência" sem perguntar.

6. **Alterar o mínimo necessário**: sem "melhorias" colaterais de código alheio à tarefa. Formatação, refactor, cleanup de `any` pré-existente — tudo isso vira commit separado, nunca piggyback numa mudança funcional.

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
