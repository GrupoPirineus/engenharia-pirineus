-- =====================================================
-- ETAPA 14 · INDICADOR DE SISTEMA DESEJADO NO CADASTRO
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- No cadastro (register-form), a pessoa agora marca quais sistemas
-- pretende usar — Chamados, Investimentos ou os dois. Isso é gravado em
-- usuarios.sistema_desejado como texto simples ('chamados',
-- 'investimentos' ou 'chamados,investimentos') só para o admin ter uma
-- pista na ficha do usuário e na lista de pendentes.
--
-- É só um INDICADOR — não concede acesso nenhum. Quem decide o que o
-- usuário pode acessar continua sendo exclusivamente a tabela
-- `atribuicoes` (Etapa 4/7b); sistema_desejado nunca é lido por nenhuma
-- policy nem por nenhuma tela de aprovação. Usuário sem atribuição
-- continua pendente, com ou sem essa coluna preenchida.
--
-- Nenhuma RLS nova: sistema_desejado é preenchido pelo próprio usuário
-- no cadastro (mesma linha que options.data.nome já grava hoje via
-- user_metadata) e lido pelo admin (que já lê a tabela usuarios
-- inteira). Não precisa de policy própria.
--
-- Como aplicar: rodar inteiro no SQL Editor. Idempotente.
-- =====================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sistema_desejado TEXT;

COMMENT ON COLUMN usuarios.sistema_desejado IS 'Indicador informativo do cadastro: sistema(s) que o usuário marcou que precisa acessar (''chamados'', ''investimentos'' ou ''chamados,investimentos''). Não concede acesso — apenas orienta o admin na ficha do usuário/lista de pendentes. Acesso real é sempre via tabela atribuicoes.';

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'usuarios' AND column_name = 'sistema_desejado';

-- =====================================================
-- ROLLBACK
--   ALTER TABLE usuarios DROP COLUMN IF EXISTS sistema_desejado;
-- =====================================================
