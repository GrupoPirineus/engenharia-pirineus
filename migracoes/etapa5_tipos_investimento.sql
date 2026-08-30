-- =====================================================
-- ETAPA 5 · TIPOS DE INVESTIMENTO CONFIGURÁVEIS
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
-- Depende da Etapa 3 (tabela pais já existe, coluna tipo hoje é o enum
-- tipo_investimento com 4 valores fixos).
--
-- Troca a lista fixa por uma tabela administrável (admin > Unidades e
-- Setores > aba "Tipos de Investimento"). Os 4 valores hoje gravados em
-- PAIs existentes (obra, maquina_equipamento, ti_software, melhoria) não
-- são tocados — continuam legíveis como texto solto; só deixam de ser a
-- ÚNICA opção possível daqui pra frente.
--
-- Como aplicar: backup → rodar inteiro no SQL Editor → verificações na
-- seção 4. Idempotente.
-- =====================================================


-- =====================================================
-- 1. TABELA
-- =====================================================

CREATE TABLE IF NOT EXISTS tipos_investimento (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome      TEXT NOT NULL UNIQUE,
  ativo     BOOLEAN NOT NULL DEFAULT TRUE,
  ordem     INT DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO tipos_investimento (nome, ordem) VALUES
  ('Obra / instalação',       1),
  ('Máquina / equipamento',   2),
  ('TI / software',           3),
  ('Projeto de melhoria',     4)
ON CONFLICT (nome) DO NOTHING;


-- =====================================================
-- 2. PAIS.TIPO — deixa de ser o enum fixo tipo_investimento, vira texto
-- livre (grava o `nome` escolhido em tipos_investimento). PAIs existentes
-- mantêm o valor atual (ex.: 'obra'), só convertido para texto — nada é
-- reescrito.
-- =====================================================

ALTER TABLE pais ALTER COLUMN tipo TYPE TEXT;
-- O enum tipo_investimento fica órfão (sem coluna usando-o) — não é
-- removido aqui de propósito, caso algo mais dependa dele; ver rollback.


-- =====================================================
-- 3. RLS — leitura para todo autenticado, escrita só para master
-- (mesmo padrão de areas/diretorias, Etapa 3b/3c).
-- =====================================================

ALTER TABLE tipos_investimento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tipos_investimento_leitura ON tipos_investimento;
CREATE POLICY tipos_investimento_leitura ON tipos_investimento FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS tipos_investimento_escrita ON tipos_investimento;
CREATE POLICY tipos_investimento_escrita ON tipos_investimento FOR ALL TO authenticated
USING (is_master()) WITH CHECK (is_master());


-- =====================================================
-- 4. VERIFICAÇÃO
-- =====================================================
-- 4a. Os 4 tipos existem, ativos, na ordem certa?
-- SELECT nome, ativo, ordem FROM tipos_investimento ORDER BY ordem;

-- 4b. pais.tipo virou texto e os PAIs antigos continuam com o valor deles?
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='pais' AND column_name='tipo';
-- SELECT DISTINCT tipo FROM pais;

-- =====================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS tipos_investimento_leitura ON tipos_investimento;
--   DROP POLICY IF EXISTS tipos_investimento_escrita ON tipos_investimento;
--   DROP TABLE IF EXISTS tipos_investimento;
--   -- reverter pais.tipo para o enum exigiria checar que nenhum valor
--   -- gravado depois da migração escapa dos 4 originais:
--   ALTER TABLE pais ALTER COLUMN tipo TYPE tipo_investimento USING tipo::tipo_investimento;
-- =====================================================
