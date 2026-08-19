import { sb } from './supabase.js';
import { setPage, show, hide } from './ui.js';

// ═══════════════════════════════════════════════════
// AUTENTICAÇÃO — "quem está logado"
// Hoje: e-mail/senha (Supabase Auth). A troca futura para Google Workspace
// (signInWithOAuth, restrito a @grupopirineus.com.br) só muda o que está
// neste arquivo — o resto do portal só conhece obterUsuarioLogado().
// ═══════════════════════════════════════════════════

// Linha da tabela `usuarios` de quem está logado agora (ou null).
export let usuarioLogado = null;

export function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (tab==='login'&&i===0)||(tab==='register'&&i===1)));
  tab==='login' ? (show('login-form'), hide('register-form')) : (hide('login-form'), show('register-form'));
}

export async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const msg = document.getElementById('login-msg');
  msg.innerHTML = '';
  if (!email || !pass) { msg.innerHTML = '<p class="error-msg">Preencha todos os campos.</p>'; return; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (!error && data?.user) {
    setTimeout(() => window.location.reload(), 300);
    return;
  }
  if (error) {
    const msgs = {
      'Invalid login credentials': 'E-mail ou senha incorretos.',
      'Email not confirmed': 'E-mail não confirmado. Verifique sua caixa de entrada.',
      'Too many requests': 'Muitas tentativas. Aguarde alguns minutos.'
    };
    const bloqueado = /banned/i.test(error.message);
    const textoFinal = bloqueado
      ? 'Usuário bloqueado. Contate seu gestor.'
      : (msgs[error.message] || error.message);
    msg.innerHTML = `<p class="error-msg">${textoFinal}</p>`;
  }
}

export async function doRegister() {
  const nome = document.getElementById('reg-nome').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-password').value;
  const msg = document.getElementById('register-msg');
  msg.innerHTML = '';
  if (!nome || !email || !pass) { msg.innerHTML = '<p class="error-msg">Preencha todos os campos.</p>'; return; }
  if (pass.length < 6) { msg.innerHTML = '<p class="error-msg">Senha mínima de 6 caracteres.</p>'; return; }
  const { error } = await sb.auth.signUp({ email, password: pass, options: { data: { nome } } });
  if (error) { msg.innerHTML = `<p class="error-msg">${error.message}</p>`; }
  else { msg.innerHTML = '<p class="success-msg">Cadastro realizado! Verifique seu e-mail e clique no link de confirmação para acessar o sistema.</p>'; }
}

export function toggleSenha(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  } else {
    input.type = 'password';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
}

export async function abrirRecuperarSenha() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-recuperar';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h2>Recuperar Senha</h2>
        <button class="close-btn" onclick="document.getElementById('modal-recuperar').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p class="text-muted text-sm" style="margin-bottom:16px">Digite seu e-mail e enviaremos um link para redefinir sua senha.</p>
        <div class="field">
          <label>E-mail</label>
          <input type="email" id="rec-email" placeholder="seu@email.com" autocomplete="email">
        </div>
        <div id="rec-msg"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-recuperar').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="enviarRecuperacao()">Enviar link</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('rec-email')?.focus(), 100);
}

export async function enviarRecuperacao() {
  const email = document.getElementById('rec-email').value.trim();
  const msg = document.getElementById('rec-msg');
  if (!email) { msg.innerHTML = '<p class="error-msg">Digite seu e-mail.</p>'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=true'
  });
  if (error) { msg.innerHTML = `<p class="error-msg">${error.message}</p>`; }
  else { msg.innerHTML = '<p class="success-msg">Link enviado! Verifique seu e-mail.</p>'; }
}

export async function fazerLogout() {
  await sb.auth.signOut();
  usuarioLogado = null;
  sessionStorage.clear();
  setPage('auth-screen');
}

// Resolve quem está logado a partir da sessão atual (hoje: e-mail/senha) e
// garante que existe uma linha em `usuarios` para essa pessoa — cadastro
// automático no primeiro acesso, sem nenhuma atribuição (fica pendente até
// o master liberar). Não decide qual tela mostrar — isso é responsabilidade
// de quem chama (a casca).
export async function obterUsuarioLogado() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { usuarioLogado = null; return null; }

  const { data, error } = await sb.from('usuarios').select('*').eq('id', session.user.id).single();
  if (data) { usuarioLogado = data; return data; }

  console.error('Erro ao carregar usuário:', error);
  const { data: authUser } = await sb.auth.getUser();
  if (authUser?.user) {
    await sb.from('usuarios').upsert({
      id: authUser.user.id,
      nome: authUser.user.user_metadata?.nome || authUser.user.email.split('@')[0],
      email: authUser.user.email,
      perfil: 'solicitante'
    });
    const { data: newData } = await sb.from('usuarios').select('*').eq('id', session.user.id).single();
    if (newData) { usuarioLogado = newData; return newData; }
  }
  usuarioLogado = null;
  return null;
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  switchAuthTab, doLogin, doRegister, toggleSenha,
  abrirRecuperarSenha, enviarRecuperacao, fazerLogout
});
