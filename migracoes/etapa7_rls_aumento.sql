-- =====================================================
-- ETAPA 7 · FLUXO DE AUMENTO DE VERBA
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
-- aumentos_verba e passos_aumento já existem (Etapa 3), reaproveitando a
-- mesma mecânica de passos_aprovacao do PAI (Etapa 4). Este arquivo:
--   1. Acrescenta o papel diretor_ceo (enum papel) e o valor diretor_ceo
--      no enum etapa_fluxo (passo 4 da cadeia).
--   2. Cria gerar_numero_aumento(p_ano), espelhando gerar_numero_pai.
--   3. Cria as funções auxiliares de RLS pode_atuar_no_aumento(id) e
--      e_solicitante_do_aumento(id), espelhando pode_atuar_no_pai /
--      e_solicitante_do_pai.
--   4. Cria aplicar_efeito_aumento(id) — função SECURITY DEFINER que,
--      na aprovação final (passo Diretor da área quando colapsa com
--      Diretor CEO, ou passo Diretor CEO quando não colapsa), gera a
--      linha em linhas_plano (tipo=aumento) e eleva teto_area_plano.
--   5. RLS de leitura/escrita em aumentos_verba e passos_aumento.
--   6. Policies adicionais (estreitas, só INSERT com tipo='aumento' /
--      só para diretor e diretor_ceo) em linhas_plano e teto_area_plano,
--      como reforço caso a função do item 4 não rode com bypass de RLS.
--
-- Cadeia (4 passos, ordem crescente em passos_aumento):
--   1. controladoria_op        (Controladoria Operacional)
--   2. aprovador                (Superintendente da área — alcada_por_setor.responsavel_id)
--   3. diretor                  (Diretor da área — alcada_por_setor.diretor_id)
--   4. diretor_ceo               (quem tem o papel diretor_ceo, global)
-- Colapso: se quem aprova o passo 3 (diretor da área) TEM o papel
-- diretor_ceo, a aprovação do passo 3 já aplica o efeito final — o passo 4
-- nunca chega a ser criado. Isso é decidido no APP (mundos/investimentos/
-- aumento.js), checando tem_papel('investimentos','diretor_ceo') do próprio
-- usuário que está aprovando o passo 3 — nada disso precisa de lógica nova
-- no banco além do que já está aqui.
--
-- IMPORTANTE — RODAR EM DUAS ETAPAS (obrigatório no Postgres):
--   PASSO 1: selecione e rode SOZINHA a SEÇÃO 1 (os dois ALTER TYPE ... ADD
--            VALUE). Um valor de enum novo não pode ser lido na MESMA
--            transação em que foi criado.
--   PASSO 2: depois, rode o resto do arquivo (seções 2 em diante).
--
-- Como aplicar: backup → PASSO 1 → PASSO 2 → verificações na seção 7.
-- Idempotente (seguro rodar de novo, desde que a Seção 1 já tenha sido
-- aplicada alguma vez antes).
-- =====================================================


-- =====================================================
-- SEÇÃO 1 · ENUMS — RODAR SOZINHA, ANTES DE TUDO O MAIS
-- =====================================================

ALTER TYPE papel ADD VALUE IF NOT EXISTS 'diretor_ceo';
ALTER TYPE etapa_fluxo ADD VALUE IF NOT EXISTS 'diretor_ceo';

-- ⬆⬆⬆ RODE SÓ ATÉ AQUI PRIMEIRO. Depois rode a partir da Seção 2. ⬇⬇⬇


-- =====================================================
-- SEÇÃO 2 · NUMERAÇÃO — gerar_numero_aumento(p_ano)
-- Idêntica a gerar_numero_pai, trocando a tabela contada e o prefixo
-- ("INV-" -> "AUM-"). Formato: AUM-0001-2026.
-- =====================================================

CREATE OR REPLACE FUNCTION public.gerar_numero_aumento(p_ano integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO seq FROM aumentos_verba WHERE ano_calendario = p_ano AND numero IS NOT NULL;
  RETURN 'AUM-' || LPAD(seq::TEXT, 4, '0') || '-' || p_ano::TEXT;
END;
$function$;


-- =====================================================
-- SEÇÃO 3 · FUNÇÕES AUXILIARES DE RLS
-- SECURITY DEFINER STABLE, mesmo padrão de is_master()/tem_papel() e das
-- funções pode_atuar_no_pai()/e_solicitante_do_pai() da Etapa 4.
--
-- pode_atuar_no_aumento: verdadeiro para quem participa da cadeia deste
-- aumento — controladoria_op e diretor_ceo (papéis globais, sem escopo),
-- OU quem responde pelo setor/empresa do pedido como superintendente
-- (alcada_por_setor.responsavel_id) ou diretor (alcada_por_setor.diretor_id).
-- Não amarra ao passo pendente no momento (diferente de checar "é a vez
-- dele agora") de propósito: evita corrida entre o UPDATE do passo e o
-- UPDATE do aumento dentro da mesma decisão (a fila em
-- mundos/investimentos/aumento.js já garante, no client, que cada papel só
-- decide na etapa/ordem certa — aqui a RLS só garante que a pessoa é
-- legitimamente uma das 4 alçadas deste pedido).
-- =====================================================

CREATE OR REPLACE FUNCTION pode_atuar_no_aumento(p_aumento_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_empresa_id UUID;
  v_setor_id   UUID;
BEGIN
  SELECT empresa_id, setor_id INTO v_empresa_id, v_setor_id
  FROM aumentos_verba WHERE id = p_aumento_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  RETURN is_master()
    OR tem_papel('investimentos', 'controladoria_op')
    OR tem_papel('investimentos', 'diretor_ceo')
    OR e_responsavel_do_setor_emp(v_empresa_id, v_setor_id)
    OR e_diretor_do_setor_emp(v_empresa_id, v_setor_id);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION e_solicitante_do_aumento(p_aumento_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM aumentos_verba WHERE id = p_aumento_id AND solicitante_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- =====================================================
-- SEÇÃO 4 · EFEITO DA APROVAÇÃO FINAL
-- aplicar_efeito_aumento(p_aumento_id): chamada pelo app assim que o
-- último passo da cadeia é aprovado (Diretor da área, se colapsar com o
-- Diretor CEO, ou o próprio Diretor CEO, se não colapsar). SECURITY
-- DEFINER para poder gravar em linhas_plano/teto_area_plano mesmo que a
-- policy de escrita dessas tabelas (Etapa 6) não cubra diretor/diretor_ceo
-- — mas a verificação de permissão abaixo é feita com o usuário
-- verdadeiro (auth.uid(), que SECURITY DEFINER não muda), então mesmo que
-- o dono da função não tenha BYPASSRLS, a Seção 6 cobre o INSERT/UPDATE.
--
-- Efeito, em ordem:
--   1. Confere que quem chamou é o Diretor da área OU o Diretor CEO (ou
--      master) — só essas alçadas fecham o fluxo.
--   2. Acha o plano do ano/empresa do pedido (precisa existir e já ter
--      sido publicado — teto_area_plano só existe depois da publicação).
--   3. Insere a linha em linhas_plano (tipo=aumento, setor do pedido,
--      descrição citando o número do aumento, valor = valor do pedido).
--   4. Eleva teto_area_plano.valor_teto da área do setor do pedido — soma
--      (não substitui); se por algum motivo a área ainda não tiver linha
--      de teto para este plano, cria uma já com o valor do aumento.
--   5. Grava aumentos_verba.linha_gerada_id e status='aprovado'.
-- Idempotência: se já existir linha_gerada_id, não aplica de novo (evita
-- duplicar linha/teto em caso de clique duplo ou reprocessamento).
-- =====================================================

CREATE OR REPLACE FUNCTION aplicar_efeito_aumento(p_aumento_id UUID)
RETURNS UUID AS $$
DECLARE
  v_aumento   aumentos_verba%ROWTYPE;
  v_plano_id  UUID;
  v_area_id   UUID;
  v_linha_id  UUID;
BEGIN
  SELECT * INTO v_aumento FROM aumentos_verba WHERE id = p_aumento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aumento de verba não encontrado';
  END IF;

  IF v_aumento.linha_gerada_id IS NOT NULL THEN
    RETURN v_aumento.linha_gerada_id; -- já aplicado, não duplica
  END IF;

  IF NOT (
    is_master()
    OR tem_papel('investimentos', 'diretor_ceo')
    OR e_diretor_do_setor_emp(v_aumento.empresa_id, v_aumento.setor_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para concluir este aumento de verba';
  END IF;

  SELECT id INTO v_plano_id FROM planos_investimento
  WHERE empresa_id = v_aumento.empresa_id AND ano_calendario = v_aumento.ano_calendario;
  IF v_plano_id IS NULL THEN
    RAISE EXCEPTION 'Plano de investimento não encontrado para essa empresa/ano';
  END IF;

  SELECT area_do_setor_emp(v_aumento.empresa_id, v_aumento.setor_id) INTO v_area_id;

  INSERT INTO linhas_plano (plano_id, setor_id, descricao, valor, tipo)
  VALUES (v_plano_id, v_aumento.setor_id, 'Aumento de verba ' || v_aumento.numero, v_aumento.valor, 'aumento')
  RETURNING id INTO v_linha_id;

  IF v_area_id IS NOT NULL THEN
    INSERT INTO teto_area_plano (plano_id, area_id, valor_teto)
    VALUES (v_plano_id, v_area_id, v_aumento.valor)
    ON CONFLICT (plano_id, area_id)
    DO UPDATE SET valor_teto = teto_area_plano.valor_teto + EXCLUDED.valor_teto;
  END IF;

  UPDATE aumentos_verba SET linha_gerada_id = v_linha_id, status = 'aprovado' WHERE id = p_aumento_id;

  RETURN v_linha_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- SEÇÃO 5 · RLS — aumentos_verba / passos_aumento
-- Leitura ampla (igual pais/passos_aprovacao — cada fila filtra no client
-- via alcada_por_setor); escrita restrita.
-- =====================================================

ALTER TABLE aumentos_verba ENABLE ROW LEVEL SECURITY;
ALTER TABLE passos_aumento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aumentos_verba_leitura ON aumentos_verba;
CREATE POLICY aumentos_verba_leitura ON aumentos_verba FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS passos_aumento_leitura ON passos_aumento;
CREATE POLICY passos_aumento_leitura ON passos_aumento FOR SELECT TO authenticated USING (true);

-- INSERT em aumentos_verba: só o próprio solicitante, com o papel
-- inv_solicitante, gravando a si mesmo como solicitante_id.
DROP POLICY IF EXISTS aumentos_verba_insercao_solicitante ON aumentos_verba;
CREATE POLICY aumentos_verba_insercao_solicitante ON aumentos_verba FOR INSERT TO authenticated
WITH CHECK (
  solicitante_id = auth.uid()
  AND tem_papel('investimentos', 'inv_solicitante')
);

-- UPDATE em aumentos_verba: quem participa da cadeia (controladoria_op,
-- superintendente/diretor da área do pedido, diretor_ceo) ou master —
-- cobre devolver/reprovar (status) e também o que aplicar_efeito_aumento
-- grava (linha_gerada_id/status='aprovado'), caso a função não rode com
-- bypass de RLS.
DROP POLICY IF EXISTS aumentos_verba_escrita_aprovadores ON aumentos_verba;
CREATE POLICY aumentos_verba_escrita_aprovadores ON aumentos_verba FOR UPDATE TO authenticated
USING (pode_atuar_no_aumento(id))
WITH CHECK (pode_atuar_no_aumento(id));

-- INSERT em passos_aumento: o solicitante cria o passo 1 (controladoria_op)
-- ao enviar o pedido; os demais passos (2, 3, 4) são criados por quem
-- acabou de aprovar o passo anterior — sempre alguém da própria cadeia.
DROP POLICY IF EXISTS passos_aumento_insercao ON passos_aumento;
CREATE POLICY passos_aumento_insercao ON passos_aumento FOR INSERT TO authenticated
WITH CHECK (
  is_master()
  OR e_solicitante_do_aumento(aumento_id)
  OR pode_atuar_no_aumento(aumento_id)
);

-- UPDATE em passos_aumento: registrar a decisão (aprovado/devolvido/reprovado)
-- — quem participa da cadeia deste aumento.
DROP POLICY IF EXISTS passos_aumento_escrita_aprovadores ON passos_aumento;
CREATE POLICY passos_aumento_escrita_aprovadores ON passos_aumento FOR UPDATE TO authenticated
USING (pode_atuar_no_aumento(aumento_id))
WITH CHECK (pode_atuar_no_aumento(aumento_id));


-- =====================================================
-- SEÇÃO 6 · REFORÇO EM linhas_plano / teto_area_plano
-- A Etapa 6 só deu escrita nessas tabelas para controladoria_op/master.
-- Aqui isso é ampliado, de forma estreita, para permitir que
-- aplicar_efeito_aumento grave o efeito mesmo quando quem fecha o fluxo é
-- o Diretor da área ou o Diretor CEO (não controladoria_op). Escopo
-- deliberadamente apertado: só INSERT com tipo='aumento' em linhas_plano
-- (nunca linha 'planejada'/'devolucao'), e só para esses dois papéis.
-- =====================================================

DROP POLICY IF EXISTS linhas_plano_insercao_aumento ON linhas_plano;
CREATE POLICY linhas_plano_insercao_aumento ON linhas_plano FOR INSERT TO authenticated
WITH CHECK (
  tipo = 'aumento'
  AND (tem_papel('investimentos', 'diretor') OR tem_papel('investimentos', 'diretor_ceo'))
);

DROP POLICY IF EXISTS teto_area_plano_escrita_aumento ON teto_area_plano;
CREATE POLICY teto_area_plano_escrita_aumento ON teto_area_plano FOR ALL TO authenticated
USING (tem_papel('investimentos', 'diretor') OR tem_papel('investimentos', 'diretor_ceo'))
WITH CHECK (tem_papel('investimentos', 'diretor') OR tem_papel('investimentos', 'diretor_ceo'));


-- =====================================================
-- SEÇÃO 7 · VERIFICAÇÃO
-- =====================================================
-- 7a. Os enums ganharam o valor novo?
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'papel'::regtype ORDER BY enumsortorder;
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'etapa_fluxo'::regtype ORDER BY enumsortorder;

-- 7b. gerar_numero_aumento funciona?
-- SELECT gerar_numero_aumento(2026);

-- 7c. As funções auxiliares e a de efeito existem?
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('pode_atuar_no_aumento','e_solicitante_do_aumento','aplicar_efeito_aumento');

-- 7d. As policies existem?
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE tablename IN ('aumentos_verba','passos_aumento','linhas_plano','teto_area_plano')
-- ORDER BY tablename, cmd;

-- =====================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS aumentos_verba_leitura ON aumentos_verba;
--   DROP POLICY IF EXISTS aumentos_verba_insercao_solicitante ON aumentos_verba;
--   DROP POLICY IF EXISTS aumentos_verba_escrita_aprovadores ON aumentos_verba;
--   DROP POLICY IF EXISTS passos_aumento_leitura ON passos_aumento;
--   DROP POLICY IF EXISTS passos_aumento_insercao ON passos_aumento;
--   DROP POLICY IF EXISTS passos_aumento_escrita_aprovadores ON passos_aumento;
--   DROP POLICY IF EXISTS linhas_plano_insercao_aumento ON linhas_plano;
--   DROP POLICY IF EXISTS teto_area_plano_escrita_aumento ON teto_area_plano;
--   DROP FUNCTION IF EXISTS aplicar_efeito_aumento(UUID);
--   DROP FUNCTION IF EXISTS pode_atuar_no_aumento(UUID);
--   DROP FUNCTION IF EXISTS e_solicitante_do_aumento(UUID);
--   DROP FUNCTION IF EXISTS gerar_numero_aumento(INTEGER);
--   -- Remover um valor de enum (diretor_ceo) não é suportado nativamente
--   -- pelo Postgres — só recriando o tipo do zero. Não incluído aqui de
--   -- propósito; avaliar com cuidado se algum dia for realmente preciso.
-- =====================================================
