-- =====================================================
-- ETAPA 8 · ENCERRAMENTO DO PAI
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
-- Schema já tem tudo o que a Etapa 8 precisa (status formalizado /
-- em_execucao / concluido_solicitante / encerrado no enum status_pai,
-- itens_pai.numero_bem, pais.saldo_final, pais.encerrado_em, o papel
-- controladoria_contabil no enum papel, e o tipo 'devolucao' no enum
-- tipo_linha_plano) — confirmado por sondagem antes de escrever este
-- arquivo. NENHUM ALTER TYPE é necessário aqui.
--
-- Fluxo (dois passos, sem passos_aprovacao — é só pais.status):
--   1. Solicitante indica conclusão: PAI formalizado/em_execucao ->
--      concluido_solicitante (grava em historico_pai).
--   2. Controladoria Contábil encerra: preenche numero_bem de cada item,
--      informa o valor realizado, o app calcula saldo_final = valor_total
--      - realizado, grava em pais.saldo_final/encerrado_em, lança o saldo
--      numa linha tipo=devolucao da área/ano do PAI (soma se já existir
--      uma para aquela área+plano) e status -> encerrado (historico_pai).
--
-- Este arquivo só ACRESCENTA policies novas e estreitas (nomes próprios,
-- não mexe em nenhuma policy existente) para as duas escritas que ainda
-- não têm alçada: o solicitante indicando conclusão, e a Controladoria
-- Contábil encerrando. RLS de leitura não é tocada — pais/itens_pai/
-- historico_pai/linhas_plano já são de leitura ampla para autenticado
-- (padrão usado em toda a Etapa 4/6/7); se algum teste ao vivo mostrar
-- o contrário, isso é ajustado à parte.
--
-- Como aplicar: backup → rodar inteiro no SQL Editor → verificações na
-- seção 3. Idempotente (seguro rodar de novo).
-- =====================================================


-- =====================================================
-- 1. SOLICITANTE — indicar conclusão
-- Só troca o PRÓPRIO PAI, e só de formalizado/em_execucao para
-- concluido_solicitante — nada além disso.
-- =====================================================

DROP POLICY IF EXISTS pais_conclusao_solicitante ON pais;
CREATE POLICY pais_conclusao_solicitante ON pais FOR UPDATE TO authenticated
USING (is_master() OR (e_solicitante_do_pai(id) AND status IN ('formalizado', 'em_execucao')))
WITH CHECK (is_master() OR (e_solicitante_do_pai(id) AND status = 'concluido_solicitante'));

DROP POLICY IF EXISTS historico_pai_insercao_solicitante ON historico_pai;
CREATE POLICY historico_pai_insercao_solicitante ON historico_pai FOR INSERT TO authenticated
WITH CHECK (is_master() OR (usuario_id = auth.uid() AND e_solicitante_do_pai(pai_id)));


-- =====================================================
-- 2. CONTROLADORIA CONTÁBIL — encerramento
-- Papel de back-office largo (sem escopo de empresa/setor), mesmo padrão
-- já usado para controladoria_op em planos_investimento/linhas_plano
-- (Etapa 6) e para diretor/diretor_ceo em linhas_plano tipo=aumento
-- (Etapa 7).
-- =====================================================

DROP POLICY IF EXISTS pais_escrita_controladoria_contabil ON pais;
CREATE POLICY pais_escrita_controladoria_contabil ON pais FOR UPDATE TO authenticated
USING (is_master() OR tem_papel('investimentos', 'controladoria_contabil'))
WITH CHECK (is_master() OR tem_papel('investimentos', 'controladoria_contabil'));

DROP POLICY IF EXISTS itens_pai_escrita_controladoria_contabil ON itens_pai;
CREATE POLICY itens_pai_escrita_controladoria_contabil ON itens_pai FOR UPDATE TO authenticated
USING (is_master() OR tem_papel('investimentos', 'controladoria_contabil'))
WITH CHECK (is_master() OR tem_papel('investimentos', 'controladoria_contabil'));

DROP POLICY IF EXISTS historico_pai_insercao_controladoria_contabil ON historico_pai;
CREATE POLICY historico_pai_insercao_controladoria_contabil ON historico_pai FOR INSERT TO authenticated
WITH CHECK (is_master() OR (usuario_id = auth.uid() AND tem_papel('investimentos', 'controladoria_contabil')));

-- linhas_plano: só o tipo 'devolucao' — nunca 'planejada'/'aumento' — e só
-- para quem tem o papel (INSERT da primeira devolução da área/ano, UPDATE
-- para somar numa devolução já existente).
DROP POLICY IF EXISTS linhas_plano_escrita_devolucao ON linhas_plano;
CREATE POLICY linhas_plano_escrita_devolucao ON linhas_plano FOR ALL TO authenticated
USING (tipo = 'devolucao' AND (is_master() OR tem_papel('investimentos', 'controladoria_contabil')))
WITH CHECK (tipo = 'devolucao' AND (is_master() OR tem_papel('investimentos', 'controladoria_contabil')));


-- =====================================================
-- 3. VERIFICAÇÃO
-- =====================================================
-- 3a. As policies novas existem?
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE policyname IN (
--   'pais_conclusao_solicitante', 'historico_pai_insercao_solicitante',
--   'pais_escrita_controladoria_contabil', 'itens_pai_escrita_controladoria_contabil',
--   'historico_pai_insercao_controladoria_contabil', 'linhas_plano_escrita_devolucao'
-- ) ORDER BY tablename;

-- 3b. Confirma os valores do schema que este arquivo assume (não deveria
-- retornar erro nenhum — só confirma que já existiam antes desta migração):
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'status_pai'::regtype ORDER BY enumsortorder;
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'papel'::regtype ORDER BY enumsortorder;
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'tipo_linha_plano'::regtype ORDER BY enumsortorder;
-- SELECT column_name FROM information_schema.columns WHERE table_name='itens_pai' AND column_name='numero_bem';
-- SELECT column_name FROM information_schema.columns WHERE table_name='pais' AND column_name IN ('saldo_final','encerrado_em');

-- =====================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS pais_conclusao_solicitante ON pais;
--   DROP POLICY IF EXISTS historico_pai_insercao_solicitante ON historico_pai;
--   DROP POLICY IF EXISTS pais_escrita_controladoria_contabil ON pais;
--   DROP POLICY IF EXISTS itens_pai_escrita_controladoria_contabil ON itens_pai;
--   DROP POLICY IF EXISTS historico_pai_insercao_controladoria_contabil ON historico_pai;
--   DROP POLICY IF EXISTS linhas_plano_escrita_devolucao ON linhas_plano;
-- =====================================================
