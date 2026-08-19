// Papel legado do mundo Chamados (usuarios.perfil) — intacto desde antes da Etapa 2.
// A autenticação em si (login/logout/sessão) agora é da casca (shared/auth.js);
// este módulo só guarda quem está logado *dentro do mundo Chamados* e os
// helpers de papel que o resto de mundos/chamados/ já usava.
export let currentUser = null;
export let currentPerfil = null;

export function canApprove() { return ['gestor','gestor_master'].includes(currentPerfil); }
export function isGestor() { return ['gestor','gestor_master'].includes(currentPerfil); }
export function isMaster() { return currentPerfil === 'gestor_master'; }
export function isEngenheiro() { return currentPerfil === 'engenheiro'; }
export function isSolicitante() { return currentPerfil === 'solicitante'; }

// Chamada pela casca ao montar o mundo Chamados, com o usuário já resolvido
// (mesma linha da tabela `usuarios` usada antes desta etapa).
export function definirSessaoChamados(usuario) {
  currentUser = usuario;
  currentPerfil = usuario.perfil;
}
