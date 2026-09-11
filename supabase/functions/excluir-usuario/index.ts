// Edge Function: excluir-usuario
// Mesmo padrão da bloquear-usuario existente (Authorization header do
// chamador, CORS, callerClient só pra identificar quem chamou, adminClient
// com service role pras ações privilegiadas, trava contra agir sobre a
// própria conta).
//
// Recebe: { target_id: string }
//
// Regras de segurança:
//  1. Só quem é master pode chamar — aqui isso é checado por QUALQUER um
//     dos dois critérios (a bloquear-usuario usa só o legado):
//       (a) usuarios.perfil = 'gestor_master' (legado, mesmo critério dela), OU
//       (b) is_master() do modelo novo — checado direto em atribuicoes
//           (papel = 'master'), já que aqui não há sessão de usuário pra
//           chamar a função SQL is_master() por RLS.
//     Um master só do mundo Investimentos pode não ter o perfil legado, e
//     por isso não bastaria copiar o critério cru da bloquear-usuario.
//  2. Ninguém pode excluir a própria conta (mesma trava contra lockout).
//
// Exclusão, em duas ações privilegiadas:
//   1) apaga a linha em `usuarios` — o ON DELETE CASCADE em
//      atribuicoes.usuario_id (Etapa 1) já remove as atribuições do
//      usuário na mesma operação, sem precisar de um DELETE separado;
//   2) apaga a conta em auth.users via auth.admin.deleteUser(id),
//      liberando o e-mail pra um novo cadastro.
//
// Se o DELETE em `usuarios` falhar por FK (registros vinculados — PAIs,
// aumentos de verba, histórico, passos de aprovação etc. — código
// Postgres 23503), a function NÃO toca em auth.users e devolve um erro
// amigável, orientando a usar "Bloquear" em vez de excluir.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Sem token de autenticação" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente com o token de quem chamou, só pra descobrir quem é (não usa service role aqui)
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Token inválido ou expirado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente com service role, pra checagens e ações privilegiadas
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Confirma que quem chamou é master — pelo critério legado OU pelo
    // modelo novo de atribuições (não confia em nada vindo do frontend).
    const [{ data: callerProfile }, { data: callerAtribMaster }] = await Promise.all([
      adminClient.from("usuarios").select("perfil").eq("id", caller.id).maybeSingle(),
      adminClient.from("atribuicoes").select("id").eq("usuario_id", caller.id).eq("papel", "master").limit(1).maybeSingle(),
    ]);
    const chamadorEhMaster = callerProfile?.perfil === "gestor_master" || !!callerAtribMaster;

    if (!chamadorEhMaster) {
      return new Response(JSON.stringify({ error: "Apenas administradores podem excluir usuários" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { target_id } = await req.json();
    if (!target_id) {
      return new Response(JSON.stringify({ error: "Parâmetros inválidos: target_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trava: ninguém exclui a própria conta
    if (target_id === caller.id) {
      return new Response(JSON.stringify({ error: "Você não pode excluir a própria conta" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) apaga a linha em `usuarios` — o CASCADE cuida de atribuicoes.
    const { error: deleteRowError } = await adminClient.from("usuarios").delete().eq("id", target_id);
    if (deleteRowError) {
      const bloqueadoPorRegistros = deleteRowError.code === "23503";
      return new Response(
        JSON.stringify({
          error: bloqueadoPorRegistros
            ? "Usuário tem registros e não pode ser excluído; use Bloquear."
            : "Erro ao excluir usuário: " + deleteRowError.message,
        }),
        { status: bloqueadoPorRegistros ? 409 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2) apaga do Auth — libera o e-mail pra um novo cadastro.
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(target_id);
    if (deleteAuthError) {
      // A linha em `usuarios` já foi removida; não há como desfazer isso
      // sem recriar o cadastro do zero — reporta claramente o estado.
      return new Response(
        JSON.stringify({ error: "Cadastro removido, mas falhou ao excluir o login: " + deleteAuthError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erro inesperado: " + (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
