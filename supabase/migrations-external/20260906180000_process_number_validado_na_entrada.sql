-- =============================================================================
-- O número do processo passa a ser conferido na hora em que é digitado.
--
-- POR QUE
-- Ontem o campo aceitava qualquer coisa, e isso já custou caro duas vezes:
--
--   1. TEXTO NO LUGAR DE NÚMERO. Três fichas com `process_number` = ".",
--      "Não protocolado", "reprotocolar-cliente nao foi p perícia".
--      `dom_so_digitos` devolve string vazia para elas, e o join `'' = ''`
--      as casava com as 12 linhas de `process_updates` que têm numero_cnj
--      nulo. O assessor virtual contaria a um cliente a movimentação de um
--      processo que não é dele. (Fechado em 20260906121000 com NULLIF; esta
--      migration ataca a origem.)
--
--   2. CNJ COM DÍGITO VERIFICADOR ERRADO. `cnj_valido()` só conferia se havia
--      20 dígitos — nunca o verificador. Foi assim que
--      0000240-19.2025.5.11.0152 e ...0153 entraram, ficaram três semanas
--      girando na fila do Escavador e voltaram 422 NUMERO_CNJ_INVALIDO em
--      toda rodada. Vinte dígitos quaisquer não são um CNJ, do mesmo jeito
--      que onze dígitos quaisquer não são um CPF.
--
-- O QUE O CAMPO REALMENTE GUARDA — medido em 06/09/2026, 2.689 fichas vivas
--     955  número nulo
--   1.326  CNJ com 20 dígitos  (TODOS passam no verificador — nada quebra)
--     403  menos de 20 dígitos
--       2  mais de 20 dígitos
--       3  texto sem número nenhum
--
-- Os 403 NÃO são lixo. São outros identificadores legítimos:
--     10 dígitos (197)  número do benefício do INSS
--      9 dígitos (141)  protocolo do INSS, boletim de ocorrência
--     17 dígitos  (14)  processo administrativo federal (10212.202803/2026-11)
--     e mais uns 50 entre internos, MP e afins
--
-- Por isso a regra NÃO é "tem que ser CNJ" — isso rejeitaria 403 cadastros
-- legítimos e quebraria o trabalho de quem usa o campo para requerimento.
-- A regra é mais estreita e mira só o que já deu errado.
--
-- A REGRA
--   nulo ou vazio      → aceita. "Sem número" é uma resposta honesta.
--   sem dígito nenhum  → RECUSA. Anotação não é número; deixe o campo vazio.
--   exatamente 20 díg. → tem que passar no verificador (Res. 65/2008 CNJ),
--                        e é gravado no formato canônico
--                        NNNNNNN-DD.AAAA.J.TR.OOOO.
--   qualquer outro     → aceita, só aparando espaço. É NB, protocolo, BO.
--
-- SÓ CONFERE QUANDO O NÚMERO MUDA. Editar o título de uma ficha antiga com
-- número torto continua funcionando. Foi exatamente o erro do gatilho
-- anti-duplicata, que refazia a checagem em toda edição e deixou 100 fichas
-- congeladas — impossíveis de salvar — sem ninguém perceber.
--
-- VERIFICADOR CONFERIDO CONTRA DADO REAL antes de virar trava:
--   1326 de 1326 CNJs da base          → passam
--   os 3 recusados pelo Escavador      → reprovam
--   um dígito trocado de propósito     → reprova
--
-- ROLLBACK:
--   drop trigger if exists lead_processes_numero_valido on public.lead_processes;
--   create or replace function public.cnj_valido(p_numero text)
--   returns boolean language sql immutable parallel safe as $$
--     select length(public.cnj_digitos(p_numero)) = 20 $$;
-- =============================================================================

-- 1. cnj_valido passa a valer o nome que tem --------------------------------
-- Alimenta cnj_segmento, cnj_ramo (a tela mostra SEM_NUMERO / NUMERO_INVALIDO
-- / ramo) e a deteccao de duplicata. Como os 1326 CNJs da base passam, hoje
-- nada muda; daqui pra frente a tela deixa de chamar de valido um numero que
-- o tribunal recusa.
create or replace function public.cnj_valido(p_numero text)
returns boolean
language sql
immutable
parallel safe
as $function$
  -- Res. 65/2008: NNNNNNN-DD.AAAA.J.TR.OOOO. Remontando sem o DD e colando-o
  -- no fim, o número inteiro tem que deixar resto 1 na divisão por 97.
  select case
    when length(public.cnj_digitos(p_numero)) <> 20 then false
    else (substr(public.cnj_digitos(p_numero), 1, 7) ||
          substr(public.cnj_digitos(p_numero),10, 4) ||
          substr(public.cnj_digitos(p_numero),14, 1) ||
          substr(public.cnj_digitos(p_numero),15, 2) ||
          substr(public.cnj_digitos(p_numero),17, 4) ||
          substr(public.cnj_digitos(p_numero), 8, 2))::numeric % 97 = 1
  end
$function$;

comment on function public.cnj_valido(text) is
  'true quando o numero tem os 20 digitos do padrao CNJ E o digito verificador fecha (Res. 65/2008). Ate 06/09/2026 conferia so o comprimento — foi assim que CNJ inventado entrou e ficou tres semanas girando na fila do Escavador.';

-- 2. A forma canônica --------------------------------------------------------
create or replace function public.cnj_formatado(p_numero text)
returns text
language sql
immutable
parallel safe
as $function$
  select case
    when public.cnj_valido(p_numero)
    then substr(public.cnj_digitos(p_numero), 1, 7) || '-' ||
         substr(public.cnj_digitos(p_numero), 8, 2) || '.' ||
         substr(public.cnj_digitos(p_numero),10, 4) || '.' ||
         substr(public.cnj_digitos(p_numero),14, 1) || '.' ||
         substr(public.cnj_digitos(p_numero),15, 2) || '.' ||
         substr(public.cnj_digitos(p_numero),17, 4)
    else nullif(btrim(coalesce(p_numero, '')), '')
  end
$function$;

comment on function public.cnj_formatado(text) is
  'CNJ valido volta em NNNNNNN-DD.AAAA.J.TR.OOOO. Qualquer outra coisa volta so aparada — NB, protocolo do INSS e boletim de ocorrencia tambem moram neste campo.';

-- 3. A conferência na entrada ------------------------------------------------
create or replace function public.lead_processes_numero_valido()
returns trigger
language plpgsql
as $function$
declare
  v_digitos text;
  v_esperado text;
begin
  -- Só confere quando o número muda. Editar o título de uma ficha antiga com
  -- número torto tem que continuar funcionando: foi o erro do gatilho
  -- anti-duplicata, que congelou 100 fichas sem ninguém perceber.
  if tg_op = 'UPDATE'
     and new.process_number is not distinct from old.process_number then
    return new;
  end if;

  -- Espaço nas pontas e vazio viram nulo. "Sem número" é resposta honesta.
  new.process_number := nullif(btrim(coalesce(new.process_number, '')), '');
  if new.process_number is null then
    return new;
  end if;

  v_digitos := public.cnj_digitos(new.process_number);

  -- Anotação não é número.
  if v_digitos is null then
    raise exception using
      errcode = '23514',
      message = format('"%s" não é um número de processo.', new.process_number),
      detail  = 'O campo do número não tem um dígito sequer — é uma anotação.',
      hint    = 'Deixe o número em branco e escreva a observação no título ou nas notas do caso. Ficha sem número é normal; ficha com recado no lugar do número faz o sistema casar este caso com o processo de outro cliente.';
  end if;

  -- Vinte dígitos quaisquer não são um CNJ.
  if length(v_digitos) = 20 and not public.cnj_valido(new.process_number) then
    v_esperado := lpad(((98 - ((substr(v_digitos,1,7) || substr(v_digitos,10,4) ||
                                substr(v_digitos,14,1) || substr(v_digitos,15,2) ||
                                substr(v_digitos,17,4) || '00')::numeric % 97))::int)::text, 2, '0');
    raise exception using
      errcode = '23514',
      message = format('CNJ inválido: %s', new.process_number),
      detail  = format('O dígito verificador não fecha. Para este número o correto seria %s, e não %s.',
                       v_esperado, substr(v_digitos, 8, 2)),
      hint    = 'Confira o número na fonte. CNJ com verificador errado entra no sistema, mas o tribunal e o Escavador recusam — e a ficha fica girando na fila sem ninguém entender por quê.';
  end if;

  -- CNJ bom vira forma canônica. O resto (NB, protocolo, BO) passa aparado.
  if length(v_digitos) = 20 then
    new.process_number := public.cnj_formatado(new.process_number);
  end if;

  return new;
end $function$;

drop trigger if exists lead_processes_numero_valido on public.lead_processes;
create trigger lead_processes_numero_valido
  before insert or update on public.lead_processes
  for each row
  execute function public.lead_processes_numero_valido();

-- 4. Limpeza de uma vez: os 4 com espaço nas pontas --------------------------
-- Os 3 com espaço que NÃO têm gêmea. O quarto (0056732-43.2026.4.05.8300)
-- fica de fora de propósito: aparar o espaço dele revela uma duplicata de
-- verdade — mesmo cliente, duas fichas, e o espaço era o disfarce. Qual das
-- duas fica é decisão do dono do caso, não de uma migration.
--
-- A primeira tentativa desta migration incluía as quatro e abortou inteira no
-- gatilho anti-duplicata. O erro foi a informação: sem ele, ninguém saberia
-- que aquelas duas fichas eram a mesma.
update public.lead_processes
   set process_number = btrim(process_number)
 where deleted_at is null
   and process_number is distinct from btrim(process_number)
   and cnj_digitos(process_number) is distinct from '00567324320264058300';
