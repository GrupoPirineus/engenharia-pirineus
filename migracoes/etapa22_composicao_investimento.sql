-- =====================================================
-- ETAPA 22 · COMPOSIÇÃO DO INVESTIMENTO COM LISTA FIXA E CONFIGURÁVEL
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- Por quê: as categorias da composição viram filtros de centro de custo no
-- MRP. Por isso cada item da composição de um PAI passa a ser só
-- categoria + valor — sem texto livre.
--
-- O que faz:
--   1. Cria categorias_composicao (mesma forma de tipos_investimento,
--      Etapa 5), administrável em Administração → Unidades e Setores →
--      aba "Composição do Investimento".
--   2. Semeia as 8 categorias iniciais (sem "Outros", de propósito).
--   3. itens_pai ganha categoria_id (FK, nula para os itens antigos) e
--      unicidade (pai_id, categoria_id) — cada categoria no máximo uma vez
--      por PAI. A coluna aplicacao é MANTIDA e continua sendo gravada pela
--      tela (com o nome da categoria), para não quebrar PDF, encerramento e
--      relatórios que já a leem.
--   4. RLS: leitura para autenticados, escrita só master (is_master()).
--
-- Itens antigos (aplicacao em texto livre, categoria_id NULL) não são
-- tocados nem reclassificados. Na unicidade, NULL não colide com NULL no
-- Postgres — então PAIs antigos com vários itens sem categoria continuam
-- válidos.
--
-- Como aplicar: backup → rodar inteiro no SQL Editor → verificações na
-- seção 5. Idempotente.
-- =====================================================


-- =====================================================
-- 1. TABELA
-- =====================================================

CREATE TABLE IF NOT EXISTS categorias_composicao (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome      TEXT NOT NULL UNIQUE,
  ativo     BOOLEAN NOT NULL DEFAULT TRUE,
  ordem     INT DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);


-- =====================================================
-- 2. SEED — idempotente (ON CONFLICT DO NOTHING: rodar de novo não duplica
-- nem sobrescreve nome/ordem/ativo editados depois pela tela).
-- =====================================================

INSERT INTO categorias_composicao (nome, ordem) VALUES
  ('Licenciamento ambiental e atendimento de requisitos', 1),
  ('Projetos de infraestrutura',                          2),
  ('Mão de obra de infraestrutura',                       3),
  ('Materiais para obra civil',                           4),
  ('Materiais para elétrica e automação',                 5),
  ('Materiais para mecânica',                             6),
  ('Máquinas em geral',                                   7),
  ('Equipamentos em geral',                               8)
ON CONFLICT (nome) DO NOTHING;


-- =====================================================
-- 3. ITENS_PAI — categoria_id + unicidade por PAI
-- =====================================================

ALTER TABLE itens_pai ADD COLUMN IF NOT EXISTS categoria_id UUID
  REFERENCES categorias_composicao(id);

-- Cada categoria aparece no máximo uma vez por PAI. ADD CONSTRAINT não tem
-- IF NOT EXISTS — o bloco DO deixa o script re-executável.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'itens_pai_pai_categoria_key'
  ) THEN
    ALTER TABLE itens_pai
      ADD CONSTRAINT itens_pai_pai_categoria_key UNIQUE (pai_id, categoria_id);
  END IF;
END $$;

-- Índice para o agrupamento "Por categoria de composição" nos relatórios.
CREATE INDEX IF NOT EXISTS itens_pai_categoria_idx ON itens_pai (categoria_id);

-- itens_pai.aplicacao: NÃO alterada. A tela passa a gravar nela o nome da
-- categoria escolhida (snapshot do nome no momento do envio).


-- =====================================================
-- 4. RLS — leitura para todo autenticado, escrita só para master
-- (mesmo padrão de tipos_investimento, Etapa 5).
-- =====================================================

ALTER TABLE categorias_composicao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categorias_composicao_leitura ON categorias_composicao;
CREATE POLICY categorias_composicao_leitura ON categorias_composicao FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS categorias_composicao_escrita ON categorias_composicao;
CREATE POLICY categorias_composicao_escrita ON categorias_composicao FOR ALL TO authenticated
USING (is_master()) WITH CHECK (is_master());


-- =====================================================
-- 5. VERIFICAÇÃO
-- =====================================================
-- 5a. As 8 categorias existem, ativas, na ordem certa?
-- SELECT nome, ativo, ordem FROM categorias_composicao ORDER BY ordem;

-- 5b. itens_pai ganhou categoria_id e a unicidade?
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'itens_pai' AND column_name IN ('categoria_id', 'aplicacao');
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'itens_pai'::regclass AND conname = 'itens_pai_pai_categoria_key';

-- 5c. Itens antigos intactos (categoria_id nula, aplicacao preservada)?
-- SELECT COUNT(*) FILTER (WHERE categoria_id IS NULL) AS sem_categoria,
--        COUNT(*) FILTER (WHERE categoria_id IS NOT NULL) AS com_categoria
--   FROM itens_pai;

-- 5d. RLS ativa com as duas policies?
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'categorias_composicao';

-- =====================================================
-- ROLLBACK
--   ALTER TABLE itens_pai DROP CONSTRAINT IF EXISTS itens_pai_pai_categoria_key;
--   DROP INDEX IF EXISTS itens_pai_categoria_idx;
--   ALTER TABLE itens_pai DROP COLUMN IF EXISTS categoria_id;
--   DROP POLICY IF EXISTS categorias_composicao_leitura ON categorias_composicao;
--   DROP POLICY IF EXISTS categorias_composicao_escrita ON categorias_composicao;
--   DROP TABLE IF EXISTS categorias_composicao;
--   -- itens_pai.aplicacao não foi alterada — nada a reverter nela.
-- =====================================================
