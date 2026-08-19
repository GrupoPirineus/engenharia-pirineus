import { setPage } from './ui.js';
import { obterUsuarioLogado } from './auth.js';
import { isMaster, temMundo } from './acesso.js';
import { definirSessaoChamados } from '../mundos/chamados/auth.js';
import { setupApp as montarMundoChamados } from '../mundos/chamados/nav.js';
import { montarMundoInvestimentos } from '../mundos/investimentos/main.js';
import { montarAdmin } from '../admin/usuarios.js';

const ICONES = { chamados: '🛠', investimentos: '📈', administracao: '⚙' };
const LABELS = { chamados: 'Chamados', investimentos: 'Investimentos', administracao: 'Administração' };

let usuarioAtual = null;
let destinos = []; // ['chamados', 'investimentos', 'administracao']
let mundoAtivo = null;

// ═══════════════════════════════════════════════════
// BOOT — resolve sessão, resolve atribuições, decide a entrada
// ═══════════════════════════════════════════════════
export async function iniciarCasca() {
  const usuario = await obterUsuarioLogado();
  if (!usuario) { setPage('auth-screen'); return; }
  usuarioAtual = usuario;

  const [souMaster, acessoChamados, acessoInvestimentos] = await Promise.all([
    isMaster(),
    temMundo('chamados'),
    temMundo('investimentos')
  ]);

  destinos = [];
  if (souMaster || acessoChamados) destinos.push('chamados');
  if (souMaster || acessoInvestimentos) destinos.push('investimentos');
  if (souMaster) destinos.push('administracao');

  if (destinos.length === 0) { setPage('pending-screen'); return; }

  popularUsuarioNaSidebar(usuario);

  if (destinos.length === 1) { entrarNoMundo(destinos[0]); return; }

  // Multi-destino: retoma o último mundo escolhido nesta sessão, se ainda válido.
  const lembrado = sessionStorage.getItem('mundoAtivo');
  if (lembrado && destinos.includes(lembrado)) { entrarNoMundo(lembrado); return; }

  mostrarSeletorDeMundos(usuario);
}

function popularUsuarioNaSidebar(usuario) {
  document.getElementById('user-name-display').textContent = usuario.nome;
  document.getElementById('user-avatar').textContent = usuario.nome.charAt(0).toUpperCase();
}

// ═══════════════════════════════════════════════════
// SELETOR DE MUNDOS (pós-login, 2+ destinos)
// ═══════════════════════════════════════════════════
function mostrarSeletorDeMundos(usuario) {
  setPage('mundo-seletor-screen');
  document.getElementById('mundo-seletor-saudacao').textContent = `Olá, ${usuario.nome.split(' ')[0]}. Para onde vamos?`;
  document.getElementById('mundo-seletor-cards').innerHTML = destinos.map(d => `
    <div class="mundo-card" onclick="entrarNoMundo('${d}')">
      <div class="mundo-card-icon">${ICONES[d]}</div>
      <div class="mundo-card-label">${LABELS[d]}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════
// ENTRAR NO MUNDO / ALTERNADOR (troca sem deslogar)
// ═══════════════════════════════════════════════════
export function entrarNoMundo(destino) {
  mundoAtivo = destino;
  sessionStorage.setItem('mundoAtivo', destino);

  switch (destino) {
    case 'chamados':
      definirSessaoChamados(usuarioAtual);
      setPage('app-screen');
      montarMundoChamados(usuarioAtual);
      break;
    case 'investimentos':
      setPage('app-screen');
      montarMundoInvestimentos();
      break;
    case 'administracao':
      setPage('app-screen');
      montarAdmin();
      break;
  }
  atualizarSwitcher();
}

function atualizarSwitcher() {
  const wrap = document.getElementById('mundo-switcher');
  if (destinos.length <= 1) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  document.getElementById('mundo-switch-label').textContent = `${ICONES[mundoAtivo] || ''} ${LABELS[mundoAtivo] || ''}`;
  document.getElementById('mundo-switch-menu').innerHTML = destinos.map(d => `
    <button class="mundo-switch-item ${d === mundoAtivo ? 'active' : ''}" onclick="entrarNoMundo('${d}')">${ICONES[d]} ${LABELS[d]}</button>`).join('');
  document.getElementById('mundo-switch-menu').classList.add('hidden');
}

export function toggleMundoMenu() {
  document.getElementById('mundo-switch-menu').classList.toggle('hidden');
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { entrarNoMundo, toggleMundoMenu });
