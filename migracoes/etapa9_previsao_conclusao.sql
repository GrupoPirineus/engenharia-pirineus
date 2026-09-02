-- =====================================================
-- ETAPA 9 · PREVISÃO DE CONCLUSÃO + AVISO DE VENCIMENTO
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- 1. pais.previsao_conclusao — capturada pela Controladoria Operacional na
--    formalização (mundos/investimentos/aprovacao.js, confirmarFormalizacao).
-- 2. pais.aviso_vencimento_enviado_em — controla a régua de "no máximo 1
--    lembrete por semana" da função de varredura abaixo.
-- 3. verificar_vencimento_pai() — função SECURITY DEFINER que varre os PAIs
--    com prazo se aproximando/vencido e ainda não encerrados, e dispara
--    e-mail à Controladoria Contábil via a MESMA edge function
--    notificar-email (mesma URL/Bearer de disparar_notificacao_email) —
--    só que chamada por uma rotina, não por uma trigger de linha, por isso
--    o payload usa type='CRON' e table='aviso_vencimento_pai' (nomes
--    sintéticos, tratados à parte na edge function).
-- 4. Agendamento via pg_cron, SE a extensão estiver habilitada neste
--    projeto — ver nota no fim.
--
-- Nenhuma RLS nova é necessária: a formalização já tem policy de escrita
-- em pais para controladoria_op (Etapa 4); a leitura de previsao_conclusao
-- usa a mesma policy de leitura ampla já existente; e a função de
-- varredura roda como SECURITY DEFINER, ignorando RLS.
--
-- Como aplicar: rodar inteiro no SQL Editor. Idempotente.
-- =====================================================


-- =====================================================
-- 1-2. COLUNAS NOVAS
-- =====================================================

ALTER TABLE pais ADD COLUMN IF NOT EXISTS previsao_conclusao date;
ALTER TABLE pais ADD COLUMN IF NOT EXISTS aviso_vencimento_enviado_em timestamptz;


-- =====================================================
-- 3. FUNÇÃO DE VARREDURA
-- Régua: dispara quando faltam <= 7 dias para o prazo (cobre também "já
-- venceu", pois nesse caso a diferença é negativa) E o último aviso (se
-- houve algum) foi há mais de 7 dias — ou seja, no máximo 1 lembrete por
-- semana, começando na janela dos 7 dias antes do vencimento.
-- =====================================================

CREATE OR REPLACE FUNCTION verificar_vencimento_pai()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, numero, titulo, previsao_conclusao
    FROM pais
    WHERE previsao_conclusao IS NOT NULL
      AND status <> 'encerrado'
      AND previsao_conclusao <= CURRENT_DATE + INTERVAL '7 days'
      AND (aviso_vencimento_enviado_em IS NULL OR aviso_vencimento_enviado_em <= NOW() - INTERVAL '7 days')
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := 'https://oklglgvhlqixzxngbsvw.supabase.co/functions/v1/notificar-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          -- Mesmo Bearer usado em disparar_notificacao_email() — não
          -- versionado aqui de propósito (GitHub bloqueia push com segredo
          -- exposto). Antes de rodar, substitua pelo mesmo valor que está
          -- naquela função (Dashboard > Database Functions, ou
          -- SELECT pg_get_functiondef('disparar_notificacao_email'::regproc)).
          'Authorization', 'Bearer SUBSTITUA_PELO_MESMO_BEARER_DE_disparar_notificacao_email'
        ),
        body := jsonb_build_object(
          'type', 'CRON',
          'table', 'aviso_vencimento_pai',
          'schema', 'public',
          'record', to_jsonb(r),
          'old_record', null
        )
      );
      UPDATE pais SET aviso_vencimento_enviado_em = NOW() WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- a varredura nunca pode travar por causa de um envio que falhou
    END;
  END LOOP;
END;
$function$;


-- =====================================================
-- 4. AGENDAMENTO (pg_cron) — roda 1x/dia às 8h (fuso do banco, normalmente
-- UTC). Só ativa se a extensão pg_cron já estiver habilitada neste
-- projeto; senão, só avisa via RAISE NOTICE e não quebra o resto do
-- arquivo.
--
-- SE NÃO HOUVER pg_cron disponível (Database > Extensions no Supabase):
--   Opção A — habilitar a extensão pg_cron ali e rodar este arquivo de novo.
--   Opção B — criar uma Edge Function com Scheduled Trigger (Dashboard >
--     Edge Functions > seu projeto > Cron) que só faça, a cada execução,
--     uma chamada RPC: supabase.rpc('verificar_vencimento_pai').
--   Opção C — um cron externo (GitHub Actions, Vercel Cron etc.) batendo
--     numa function wrapper que chama a mesma RPC.
-- Me avise qual das três está disponível/ativa para eu confirmar que o
-- aviso de vencimento está realmente rodando.
-- =====================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'verificar-vencimento-pai';
    PERFORM cron.schedule('verificar-vencimento-pai', '0 8 * * *', 'SELECT verificar_vencimento_pai();');
  ELSE
    RAISE NOTICE 'pg_cron não está habilitado neste projeto — verificar_vencimento_pai() está pronta, mas precisa ser agendada por outro meio (ver comentário acima da Seção 4).';
  END IF;
END $$;


-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name='pais' AND column_name LIKE '%vencimento%' OR column_name = 'previsao_conclusao';
-- SELECT proname FROM pg_proc WHERE proname = 'verificar_vencimento_pai';
-- SELECT * FROM cron.job WHERE jobname = 'verificar-vencimento-pai'; -- só existe se pg_cron estiver ativo
-- SELECT verificar_vencimento_pai(); -- roda manualmente, pra testar sem esperar o agendador

-- =====================================================
-- ROLLBACK
--   DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'verificar-vencimento-pai';
--   END IF; END $$;
--   DROP FUNCTION IF EXISTS verificar_vencimento_pai();
--   ALTER TABLE pais DROP COLUMN IF EXISTS previsao_conclusao;
--   ALTER TABLE pais DROP COLUMN IF EXISTS aviso_vencimento_enviado_em;
-- =====================================================
