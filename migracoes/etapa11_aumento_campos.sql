-- =====================================================
-- ETAPA 11 · CAMPOS NOVOS EM aumentos_verba (formulário em papel)
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- O formulário ajustado (mundos/investimentos/aumento.js) passa a
-- capturar "Valor do investimento" e "Tipo de investimento", que não
-- existiam na tabela (só existia "valor" = o aumento necessário, e
-- "justificativa", que já existia e continua igual).
--
--   valor_investimento — o valor total necessário do PAI (o que hoje é
--   chamado "Valor do investimento" no formulário). "Valor remanescente"
--   NÃO é uma coluna — é calculado (valor_investimento - valor) tanto na
--   tela quanto no PDF, então fica sempre coerente com o "Aumento
--   necessário" já gravado em `valor`.
--
--   tipo — mesmo texto livre de pais.tipo (Etapa 5: nome de
--   tipos_investimento), sem enum fixo.
--
-- Nenhuma RLS nova: as policies de INSERT em aumentos_verba (Etapa 7) já
-- são por linha, não por coluna — o solicitante que já pode inserir a
-- própria linha já pode gravar essas duas colunas novas nela.
--
-- Como aplicar: rodar inteiro no SQL Editor. Idempotente.
-- =====================================================

ALTER TABLE aumentos_verba ADD COLUMN IF NOT EXISTS valor_investimento NUMERIC(14,2);
ALTER TABLE aumentos_verba ADD COLUMN IF NOT EXISTS tipo TEXT;

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'aumentos_verba' AND column_name IN ('valor_investimento', 'tipo');

-- =====================================================
-- ROLLBACK
--   ALTER TABLE aumentos_verba DROP COLUMN IF EXISTS valor_investimento;
--   ALTER TABLE aumentos_verba DROP COLUMN IF EXISTS tipo;
-- =====================================================
