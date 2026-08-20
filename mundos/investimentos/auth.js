// Sessão do mundo Investimentos — espelha mundos/chamados/auth.js. A
// autenticação em si (login/logout) é da casca (shared/auth.js); este módulo
// só guarda quem está logado *dentro do mundo Investimentos*.
export let currentUser = null;

// Chamada pela casca ao montar o mundo Investimentos, com o usuário já resolvido.
export function definirSessaoInvestimentos(usuario) {
  currentUser = usuario;
}
