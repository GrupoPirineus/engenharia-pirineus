import { setPage, toast } from './ui.js';
import { obterUsuarioLogado } from './auth.js';
import { isMaster, temMundo } from './acesso.js';
import { definirSessaoChamados } from '../mundos/chamados/auth.js';
import { setupApp as montarMundoChamados } from '../mundos/chamados/nav.js';
import { definirSessaoInvestimentos } from '../mundos/investimentos/auth.js';
import { montarMundoInvestimentos } from '../mundos/investimentos/main.js';
import { abrirPaiPorDeepLink } from '../mundos/investimentos/aprovacao.js';
import { abrirAumentoPorDeepLink } from '../mundos/investimentos/aumento.js';
import { montarAdmin } from '../admin/usuarios.js';

const ICONES = { chamados: '🛠', investimentos: '📈', administracao: '⚙' };
const LABELS = { chamados: 'Chamados', investimentos: 'Investimentos', administracao: 'Administração' };

let usuarioAtual = null;
let destinos = []; // ['chamados', 'investimentos', 'administracao']
let mundoAtivo = null;

// ═══════════════════════════════════════════════════
// DEEP LINK DE E-MAIL (PAI/Aumento) — ?pai=<id> / ?aumento=<id> na URL.
// Guardado em sessionStorage (não só lido da URL) porque precisa
// sobreviver tanto a um reload de página (login e-mail/senha, ver
// shared/auth.js doLogin) quanto a um redirect OAuth que NÃO preserva
// query string (Google — doLoginGoogle usa redirectTo:
// origin+pathname, sem o "?pai=..."). A URL é limpa assim que o valor é
// capturado, pra um F5 depois não reabrir o mesmo item de novo.
// ═══════════════════════════════════════════════════
const DEEP_LINK_KEY = 'deepLinkPendente';

function capturarDeepLinkDaUrl() {
  const params = new URLSearchParams(window.location.search);
  const paiId = params.get('pai');
  const aumentoId = params.get('aumento');
  if (!paiId && !aumentoId) return;

  sessionStorage.setItem(DEEP_LINK_KEY, JSON.stringify(
    paiId ? { tipo: 'pai', id: paiId } : { tipo: 'aumento', id: aumentoId }
  ));
  const url = new URL(window.location.href);
  url.searchParams.delete('pai');
  url.searchParams.delete('aumento');
  window.history.replaceState({}, '', url);
}

function lerDeepLinkPendente() {
  try { return JSON.parse(sessionStorage.getItem(DEEP_LINK_KEY) || 'null'); }
  catch { return null; }
}

function consumirDeepLinkPendente() {
  const dl = lerDeepLinkPendente();
  sessionStorage.removeItem(DEEP_LINK_KEY);
  return dl;
}

// ═══════════════════════════════════════════════════
// BOOT — resolve sessão, resolve atribuições, decide a entrada
// ═══════════════════════════════════════════════════
export async function iniciarCasca() {
  capturarDeepLinkDaUrl();

  const usuario = await obterUsuarioLogado();
  if (!usuario) { setPage('auth-screen'); return; } // deep link fica guardado; aplicado no próximo boot, pós-login

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

  // Deep link pendente tem prioridade sobre o mundo lembrado/seletor — a
  // pessoa clicou num e-mail sobre um item específico de Investimentos.
  // Sem acesso a Investimentos: descarta e segue o fluxo normal, com aviso
  // ("abrir normal com aviso", em vez de travar ou dar erro).
  if (lerDeepLinkPendente()) {
    if (destinos.includes('investimentos')) { entrarNoMundo('investimentos'); return; }
    const tipo = consumirDeepLinkPendente()?.tipo;
    toast(`Você não tem acesso a Investimentos para abrir o ${tipo === 'aumento' ? 'aumento de verba' : 'PAI'} do link.`, 'error');
  }

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
export async function entrarNoMundo(destino) {
  mundoAtivo = destino;
  sessionStorage.setItem('mundoAtivo', destino);

  switch (destino) {
    case 'chamados':
      definirSessaoChamados(usuarioAtual);
      setPage('app-screen');
      montarMundoChamados(usuarioAtual);
      break;
    case 'investimentos':
      definirSessaoInvestimentos(usuarioAtual);
      setPage('app-screen');
      await montarMundoInvestimentos(usuarioAtual);
      // Deep link de e-mail (PAI/Aumento): abre por cima da tela que
      // montarMundoInvestimentos já montou (Aprovações/Meus PAIs) — mesma
      // sobreposição de modal usada quando se clica numa linha da fila.
      await aplicarDeepLinkPendente();
      break;
    case 'administracao':
      setPage('app-screen');
      montarAdmin();
      break;
  }
  atualizarSwitcher();
}

async function aplicarDeepLinkPendente() {
  const deepLink = consumirDeepLinkPendente();
  if (!deepLink) return;
  if (deepLink.tipo === 'pai') await abrirPaiPorDeepLink(deepLink.id);
  else if (deepLink.tipo === 'aumento') await abrirAumentoPorDeepLink(deepLink.id);
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
