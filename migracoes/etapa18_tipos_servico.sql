-- =====================================================
-- ETAPA 18 · CENTRALIZAR ADMINISTRAÇÃO + TIPOS DE SERVIÇO
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- ATENÇÃO — tipos_servico JÁ EXISTE em produção (mundos/chamados/
-- configuracoes.js já lê/grava nela hoje: colunas nome e ativo, sem RLS
-- própria visível no código, sem coluna ordem, sem seed em nenhuma
-- migração rastreada — foi criada e populada fora do controle de versão,
-- pelos "+ Adicionar" da tela de Configurações). Por isso este script é
-- todo em CREATE/ADD COLUMN IF NOT EXISTS: funciona tanto se a tabela já
-- existir com só (id, nome, ativo) quanto do zero. Nada aqui apaga linha
-- nenhuma.
--
-- Espelha tipos_investimento (Etapa 5): mesma forma, mesma RLS (leitura
-- autenticados, escrita só master via is_master()), mesmo CRUD em
-- Administração → Unidades e Setores → aba "Tipos de Serviço".
--
-- Como aplicar: rodar inteiro no SQL Editor. Idempotente — mas ver a
-- SEÇÃO 2 (seed) antes: não consegui ler os valores atuais de
-- tipos_servico pra gerar o INSERT (RLS bloqueia leitura anônima, e eu
-- não tenho login de gestor/master neste ambiente). Rode a query da
-- seção 2a primeiro e me devolva o resultado, ou preencha você mesmo o
-- INSERT da seção 2b antes de rodar — sem isso a tabela fica com a
-- estrutura nova (ordem, RLS) mas os tipos que já existem hoje não
-- ganham uma `ordem` definida (ficam com o padrão 0, todos empatados,
-- sem quebrar nada — só sem ordenação própria até você ajustar).
-- =====================================================


-- =====================================================
-- 1. TABELA (cria do zero OU completa uma já existente)
-- =====================================================

CREATE TABLE IF NOT EXISTS tipos_servico (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome      TEXT NOT NULL,
  ativo     BOOLEAN NOT NULL DEFAULT TRUE,
  ordem     INT DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Caso a tabela já existisse (é o caso hoje) com só parte destas colunas:
ALTER TABLE tipos_servico ADD COLUMN IF NOT EXISTS ordem INT DEFAULT 0;
ALTER TABLE tipos_servico ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tipos_servico ALTER COLUMN ativo SET DEFAULT TRUE;

-- nome único (mesmo padrão de tipos_investimento) — só aplica se ainda não
-- houver nomes duplicados na tabela existente; se houver, este comando
-- falha e precisa resolver a duplicidade antes (ver verificação 4c).
ALTER TABLE tipos_servico ADD CONSTRAINT tipos_servico_nome_key UNIQUE (nome);


-- =====================================================
-- 2. SEED — os tipos de serviço que já existem hoje na Configuração do
-- mundo Chamados. NÃO PREENCHIDO — não consegui ler a tabela real.
-- =====================================================

-- 2a. Rode isto primeiro (como gestor/master, autenticado — RLS de
-- tipos_servico hoje provavelmente já exige isso) e me devolva o
-- resultado, ou use você mesmo pra montar o INSERT abaixo:
--   SELECT nome, ativo FROM tipos_servico ORDER BY nome;

-- 2b. Preencha com o resultado da query acima antes de rodar este bloco
-- (a ordem das linhas vira a `ordem` — ajuste como preferir; o
-- ON CONFLICT garante que rodar de novo não duplica nem sobrescreve
-- edições feitas depois pela tela):
--
-- INSERT INTO tipos_servico (nome, ordem) VALUES
--   ('<nome 1>', 1),
--   ('<nome 2>', 2),
--   ('<nome 3>', 3)
-- ON CONFLICT (nome) DO NOTHING;


-- =====================================================
-- 3. RLS — leitura para todo autenticado, escrita só para master
-- (mesmo padrão de tipos_investimento, Etapa 5).
-- =====================================================

ALTER TABLE tipos_servico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tipos_servico_leitura ON tipos_servico;
CREATE POLICY tipos_servico_leitura ON tipos_servico FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS tipos_servico_escrita ON tipos_servico;
CREATE POLICY tipos_servico_escrita ON tipos_servico FOR ALL TO authenticated
USING (is_master()) WITH CHECK (is_master());


-- =====================================================
-- 4. VERIFICAÇÃO
-- =====================================================
-- 4a. Estrutura final da tabela:
-- SELECT column_name, data_type, column_default FROM information_schema.columns
-- WHERE table_name = 'tipos_servico' ORDER BY ordinal_position;

-- 4b. Tipos existentes, com a ordem que ficaram:
-- SELECT nome, ativo, ordem FROM tipos_servico ORDER BY ordem;

-- 4c. Se o ADD CONSTRAINT da seção 1 falhar por nome duplicado, ache o
-- duplicado com:
-- SELECT nome, COUNT(*) FROM tipos_servico GROUP BY nome HAVING COUNT(*) > 1;

-- =====================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS tipos_servico_leitura ON tipos_servico;
--   DROP POLICY IF EXISTS tipos_servico_escrita ON tipos_servico;
--   ALTER TABLE tipos_servico DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE tipos_servico DROP CONSTRAINT IF EXISTS tipos_servico_nome_key;
--   -- ordem/criado_em: seguros de manter mesmo revertendo o resto, mas se
--   -- quiser tirar:
--   ALTER TABLE tipos_servico DROP COLUMN IF EXISTS ordem;
--   ALTER TABLE tipos_servico DROP COLUMN IF EXISTS criado_em;
--   -- Não fornecido: DROP TABLE — a tabela já existia antes desta
--   -- migração, apagá-la não é um "rollback" desta etapa.
-- =====================================================
