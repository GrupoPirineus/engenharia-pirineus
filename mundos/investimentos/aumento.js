import { sb } from '../../shared/supabase.js';
import { toast, fmtDate } from '../../shared/ui.js';
import { temPapel } from '../../shared/acesso.js';
import { currentUser } from './auth.js';
import { badgeStatusPai, fmtMoeda } from './dashboard.js';
import { resolverEscoposSolicitante } from './solicitacao.js';

// ═══════════════════════════════════════════════════
// FLUXO DE AUMENTO DE VERBA (Etapa 7)
//
// Reaproveita a mecânica de passos_aprovacao do PAI (Etapa 4), agora em
// passos_aumento. Cadeia (4 passos):
//   Controladoria Operacional → Superintendente da área → Diretor da área
//   → Diretor CEO
//
// Colapso: se quem aprova o passo "diretor" (Diretor da área) TEM o papel
// diretor_ceo, essa mesma aprovação já fecha o fluxo — o passo 4 nunca é
// criado. O efeito final (linha em linhas_plano tipo=aumento + elevação do
// teto em teto_area_plano) é aplicado pela função de banco
// aplicar_efeito_aumento (migracoes/etapa7_rls_aumento.sql), chamada nos
// dois pontos em que o fluxo pode terminar: fim do passo "diretor" quando
// colapsa, e fim do passo "diretor_ceo" quando não colapsa.
// ═══════════════════════════════════════════════════

function numOrZero(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// ═══════════════════════════════════════════════════
// SOLICITAÇÃO — modal de "Solicitar aumento de verba"
// Único ponto de entrada: o botão na tela de Solicitação (Novo PAI),
// quando o valor estoura o teto da área — com prefill do contexto do PAI.
// Não há tela/nav própria para abrir um pedido (Etapa 7b).
// ═══════════════════════════════════════════════════
let estadoForm = null;

export async function abrirModalSolicitarAumento(prefill) {
  const escopos = await resolverEscoposSolicitante();
  if (!escopos.length) {
    toast('Sem área de investimento atribuída para solicitar aumento de verba', 'error');
    return;
  }

  let escopoIdx = 0;
  if (prefill?.empresaId && prefill?.setorId) {
    const idx = escopos.findIndex(e => e.empresaId === prefill.empresaId && e.setorId === prefill.setorId);
    if (idx >= 0) escopoIdx = idx;
  }
  const anoAtual = new Date().getFullYear();
  estadoForm = {
    escopos, escopoIdx,
    ano: prefill?.ano || anoAtual,
    valor: numOrZero(prefill?.valorSugerido),
    justificativa: ''
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-solicitar-aumento';
  overlay.innerHTML = renderModalSolicitarAumento(anoAtual);
  document.body.appendChild(overlay);
}

function renderModalSolicitarAumento(anoAtual) {
  const esc = estadoForm.escopos[estadoForm.escopoIdx];
  return `
    <div class="modal">
      <div class="modal-header">
        <h2>Solicitar aumento de verba</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        ${estadoForm.escopos.length > 1 ? `
        <div class="field"><label>Empresa / Área</label>
          <select id="aumento-escopo" onchange="onAumentoEscopoChange(this.value)">
            ${estadoForm.escopos.map((e, i) => `<option value="${i}" ${i === estadoForm.escopoIdx ? 'selected' : ''}>${e.empresaNome} · ${e.setorNome}</option>`).join('')}
          </select>
        </div>` : `
        <div class="form-row">
          <div class="field"><label>Empresa</label><input value="${esc.empresaNome}" disabled></div>
          <div class="field"><label>Área</label><input value="${esc.setorNome}" disabled></div>
        </div>`}
        <div class="form-row">
          <div class="field"><label>Ano-calendário</label>
            <select id="aumento-ano" onchange="onAumentoAnoChange(this.value)">
              <option value="${anoAtual}" ${estadoForm.ano === anoAtual ? 'selected' : ''}>${anoAtual} · vigente</option>
              <option value="${anoAtual + 1}" ${estadoForm.ano === anoAtual + 1 ? 'selected' : ''}>${anoAtual + 1} · disponível (entressafra)</option>
            </select>
          </div>
          <div class="field"><label>Valor do aumento *</label>
            <input type="number" min="0" step="0.01" id="aumento-valor" value="${estadoForm.valor || ''}" placeholder="0" oninput="onAumentoValorInput(this.value)">
          </div>
        </div>
        <div class="field">
          <label>Justificativa *</label>
          <textarea id="aumento-justificativa" rows="4" oninput="onAumentoJustificativaInput(this.value)" placeholder="Explique por que o teto da área precisa aumentar...">${estadoForm.justificativa}</textarea>
        </div>
        <div id="aumento-erro" class="text-xs" style="color:var(--red);min-height:16px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="onEnviarAumento()">Enviar</button>
      </div>
    </div>`;
}

function onAumentoEscopoChange(v) { estadoForm.escopoIdx = parseInt(v, 10); }
function onAumentoAnoChange(v) { estadoForm.ano = parseInt(v, 10); }
function onAumentoValorInput(v) { estadoForm.valor = numOrZero(v); }
function onAumentoJustificativaInput(v) { estadoForm.justificativa = v; }

async function onEnviarAumento() {
  const erroEl = document.getElementById('aumento-erro');
  erroEl.textContent = '';

  const esc = estadoForm.escopos[estadoForm.escopoIdx];
  const valor = numOrZero(estadoForm.valor);
  const justificativa = (estadoForm.justificativa || '').trim();

  if (valor <= 0) { erroEl.textContent = 'Informe um valor maior que zero.'; return; }
  if (!justificativa) { erroEl.textContent = 'A justificativa é obrigatória.'; return; }

  const { data: numero, error: erroNumero } = await sb.rpc('gerar_numero_aumento', { p_ano: estadoForm.ano });
  if (erroNumero) { toast('Erro ao gerar número do aumento: ' + erroNumero.message, 'error'); return; }

  const { data: plano } = await sb.from('planos_investimento').select('id')
    .eq('empresa_id', esc.empresaId).eq('ano_calendario', estadoForm.ano).maybeSingle();

  const { data: aumento, error: erroInsert } = await sb.from('aumentos_verba').insert({
    numero, empresa_id: esc.empresaId, setor_id: esc.setorId, ano_calendario: estadoForm.ano,
    valor, justificativa, solicitante_id: currentUser.id, status: 'em_critica', plano_id: plano?.id || null
  }).select('id').single();
  if (erroInsert) { toast('Erro ao enviar aumento de verba: ' + erroInsert.message, 'error'); return; }

  const { error: erroPasso } = await sb.from('passos_aumento')
    .insert({ aumento_id: aumento.id, ordem: 1, etapa: 'controladoria_op', decisao: 'pendente' });
  if (erroPasso) { toast('Aumento criado, mas houve erro ao abrir a fila de aprovação: ' + erroPasso.message, 'error'); return; }

  document.getElementById('modal-solicitar-aumento')?.remove();
  toast(`Aumento de verba ${numero} enviado à Controladoria`);
}

// ═══════════════════════════════════════════════════
// MEUS AUMENTOS DE VERBA — fragmento de acompanhamento (Etapa 7b: virou
// aba dentro de "Meus PAIs", em vez de tela própria; sem botão de criar
// pedido aqui — isso só acontece pelo botão na tela de Novo PAI).
// ═══════════════════════════════════════════════════
export async function renderConteudoAumentos() {
  const { data: aumentos, error } = await sb.from('aumentos_verba')
    .select('*, empresas(nome), setores(nome)')
    .eq('solicitante_id', currentUser.id)
    .order('criado_em', { ascending: false });
  if (error) { toast('Erro ao carregar aumentos de verba: ' + error.message, 'error'); return ''; }

  return `
    <div class="table-card">
      <div class="table-header"><div class="table-title">Meus aumentos de verba</div></div>
      ${(aumentos || []).length === 0 ? `
      <div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">Nenhum aumento solicitado ainda</div><div class="empty-desc">Peça um aumento direto na tela de Novo PAI, quando o teto da área não for suficiente.</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Empresa</th><th>Área</th><th>Ano</th><th class="text-right">Valor</th><th>Status</th><th>Criado em</th></tr></thead>
        <tbody>
          ${aumentos.map(a => `
            <tr>
              <td><span class="font-mono text-xs" style="color:var(--accent)">${a.numero || '—'}</span></td>
              <td><span class="text-muted text-sm">${a.empresas?.nome || '—'}</span></td>
              <td><span class="text-muted text-sm">${a.setores?.nome || '—'}</span></td>
              <td>${a.ano_calendario}</td>
              <td class="text-right">${fmtMoeda(a.valor)}</td>
              <td>${badgeStatusPai(a.status)}</td>
              <td>${fmtDate(a.criado_em)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// FILAS (uma por papel, mesma mecânica de aprovacao.js)
// ═══════════════════════════════════════════════════

// Chamado depois de toda decisão registrada, para a tela "Aprovações"
// consolidada (Etapa 7b) recarregar a aba ativa.
let aoAtualizar = null;
export function definirCallbackAtualizacao(fn) { aoAtualizar = fn; }

const SELECT_FILA_AUMENTO = '*, aumento:aumentos_verba(*, empresas(nome), setores(nome), solicitante:solicitante_id(nome,email))';

async function carregarFilaControladoriaAumento() {
  const { data, error } = await sb.from('passos_aumento').select(SELECT_FILA_AUMENTO)
    .eq('etapa', 'controladoria_op').eq('decisao', 'pendente').order('criado_em');
  if (error) { toast('Erro ao carregar fila: ' + error.message, 'error'); return []; }
  return data || [];
}

async function carregarFilaPorResponsavelAumento(etapa, coluna) {
  const [{ data: minhasAreas, error: errAreas }, { data: passos, error: errPassos }] = await Promise.all([
    sb.from('alcada_por_setor').select('empresa_id,setor_id').eq(coluna, currentUser.id),
    sb.from('passos_aumento').select(SELECT_FILA_AUMENTO).eq('etapa', etapa).eq('decisao', 'pendente').order('criado_em')
  ]);
  if (errAreas || errPassos) { toast('Erro ao carregar fila: ' + (errAreas || errPassos).message, 'error'); return []; }

  const chaves = new Set((minhasAreas || []).map(a => `${a.empresa_id}·${a.setor_id}`));
  return (passos || []).filter(p => p.aumento && chaves.has(`${p.aumento.empresa_id}·${p.aumento.setor_id}`));
}

async function carregarFilaDiretorCeoAumento() {
  const { data, error } = await sb.from('passos_aumento').select(SELECT_FILA_AUMENTO)
    .eq('etapa', 'diretor_ceo').eq('decisao', 'pendente').order('criado_em');
  if (error) { toast('Erro ao carregar fila: ' + error.message, 'error'); return []; }
  return data || [];
}

// Fragmento de HTML da fila de um papel (chave: 'controladoria' | 'aprovador'
// | 'diretor' | 'diretor_ceo') — usado pela tela consolidada "Aprovações"
// (Etapa 7b), ao lado da fila de PAI da mesma aba.
export async function renderFragmentoFilaAumento(chave) {
  const passos = chave === 'controladoria' ? await carregarFilaControladoriaAumento()
    : chave === 'aprovador' ? await carregarFilaPorResponsavelAumento('aprovador', 'responsavel_id')
    : chave === 'diretor' ? await carregarFilaPorResponsavelAumento('diretor', 'diretor_id')
    : await carregarFilaDiretorCeoAumento();

  return `
    <div class="table-card">
      <div class="table-header"><div class="table-title">Aumentos de Verba · ${passos.length}</div></div>
      ${passos.length === 0 ? `
      <div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Fila vazia</div><div class="empty-desc">Nenhum aumento de verba aguardando sua análise no momento.</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Empresa</th><th>Área/Setor</th><th class="text-right">Valor</th><th>Solicitante</th><th>Enviado em</th></tr></thead>
        <tbody>
          ${passos.map(p => `
            <tr onclick="abrirDetalheAumento('${p.aumento.id}','${p.etapa}')">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${p.aumento.numero || '—'}</span></td>
              <td>${p.aumento.empresas?.nome || '—'}</td>
              <td>${p.aumento.setores?.nome || '—'}</td>
              <td class="text-right">${fmtMoeda(p.aumento.valor)}</td>
              <td>${p.aumento.solicitante?.nome || '—'}</td>
              <td>${fmtDate(p.aumento.criado_em)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// DETALHE + DECISÃO
// ═══════════════════════════════════════════════════
export async function abrirDetalheAumento(aumentoId, etapaAtual) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><div class="loading"><div class="spinner"></div> Carregando...</div></div>';
  document.body.appendChild(overlay);

  const { data: aumento, error } = await sb.from('aumentos_verba')
    .select('*, empresas(nome), setores(nome), solicitante:solicitante_id(nome,email)')
    .eq('id', aumentoId).single();
  if (error || !aumento) { toast('Aumento de verba não encontrado', 'error'); overlay.remove(); return; }

  overlay.id = 'modal-decisao-aumento';
  overlay.querySelector('.modal').innerHTML = `
    <div class="modal-header">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="font-mono text-xs" style="color:var(--accent)">${aumento.numero || '—'}</span>
          ${badgeStatusPai(aumento.status)}
        </div>
        <h2>Aumento de verba</h2>
      </div>
      <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="info-row">
        <div class="info-item"><span class="info-label">Empresa</span><span class="info-val">${aumento.empresas?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Área/Setor</span><span class="info-val">${aumento.setores?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Ano</span><span class="info-val">${aumento.ano_calendario}</span></div>
        <div class="info-item"><span class="info-label">Valor</span><span class="info-val">${fmtMoeda(aumento.valor)}</span></div>
        <div class="info-item"><span class="info-label">Solicitante</span><span class="info-val">${aumento.solicitante?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Enviado em</span><span class="info-val">${fmtDate(aumento.criado_em)}</span></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Justificativa</div>
        <p style="color:var(--text2);line-height:1.7;font-size:13px">${aumento.justificativa}</p>
      </div>
      <div class="form-section">
        <div class="form-section-title">Observação — obrigatória para devolver ou reprovar</div>
        <textarea id="decisao-aumento-observacao" rows="3" placeholder="Explique sua decisão..."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-danger" onclick="confirmarDecisaoAumento('${aumentoId}','${etapaAtual}','reprovado')">Reprovar</button>
      <button class="btn btn-warning" onclick="confirmarDecisaoAumento('${aumentoId}','${etapaAtual}','devolvido')">Devolver p/ ajuste</button>
      <button class="btn btn-primary" onclick="confirmarDecisaoAumento('${aumentoId}','${etapaAtual}','aprovado')">Aprovar</button>
    </div>`;
}

export async function confirmarDecisaoAumento(aumentoId, etapa, decisao) {
  const observacao = document.getElementById('decisao-aumento-observacao').value.trim();
  if ((decisao === 'devolvido' || decisao === 'reprovado') && !observacao) {
    toast('Explique o motivo para devolver ou reprovar', 'error');
    return;
  }
  await registrarDecisaoAumento(aumentoId, etapa, decisao, observacao);
  document.getElementById('modal-decisao-aumento')?.remove();
}

// Estado-máquina da cadeia, com o colapso do passo 4 (Diretor CEO) quando o
// Diretor da área que aprova o passo 3 é a mesma pessoa que tem o papel
// diretor_ceo — nesse caso o efeito final já é aplicado aqui, sem nunca
// criar um passo diretor_ceo pendente.
async function registrarDecisaoAumento(aumentoId, etapa, decisao, observacao) {
  const { data: passo } = await sb.from('passos_aumento').select('*')
    .eq('aumento_id', aumentoId).eq('etapa', etapa).eq('decisao', 'pendente')
    .order('ordem', { ascending: false }).limit(1).maybeSingle();
  if (!passo) { toast('Este aumento de verba não está mais pendente nesta etapa', 'error'); return; }

  const { error: erroPasso } = await sb.from('passos_aumento').update({
    decisao, observacao: observacao || null, decidido_em: new Date().toISOString(), responsavel_id: currentUser.id
  }).eq('id', passo.id);
  if (erroPasso) { toast('Erro ao registrar decisão: ' + erroPasso.message, 'error'); return; }

  if (decisao === 'devolvido' || decisao === 'reprovado') {
    const { error } = await sb.from('aumentos_verba').update({ status: decisao }).eq('id', aumentoId);
    if (error) { toast('Erro ao atualizar status do aumento: ' + error.message, 'error'); return; }
    toast('Decisão registrada');
    if (aoAtualizar) await aoAtualizar();
    return;
  }

  // decisao === 'aprovado'
  if (etapa === 'controladoria_op') {
    await sb.from('passos_aumento').insert({ aumento_id: aumentoId, ordem: passo.ordem + 1, etapa: 'aprovador', decisao: 'pendente' });
  } else if (etapa === 'aprovador') {
    await sb.from('passos_aumento').insert({ aumento_id: aumentoId, ordem: passo.ordem + 1, etapa: 'diretor', decisao: 'pendente' });
  } else if (etapa === 'diretor') {
    const souDiretorCeo = await temPapel('investimentos', 'diretor_ceo');
    if (souDiretorCeo) {
      const { error } = await sb.rpc('aplicar_efeito_aumento', { p_aumento_id: aumentoId });
      if (error) { toast('Erro ao aplicar efeito do aumento: ' + error.message, 'error'); return; }
      toast('Aumento aprovado — teto da área elevado (Diretor da área também é Diretor CEO)');
      if (aoAtualizar) await aoAtualizar();
      return;
    }
    await sb.from('passos_aumento').insert({ aumento_id: aumentoId, ordem: passo.ordem + 1, etapa: 'diretor_ceo', decisao: 'pendente' });
  } else if (etapa === 'diretor_ceo') {
    const { error } = await sb.rpc('aplicar_efeito_aumento', { p_aumento_id: aumentoId });
    if (error) { toast('Erro ao aplicar efeito do aumento: ' + error.message, 'error'); return; }
    toast('Aumento aprovado — teto da área elevado');
    if (aoAtualizar) await aoAtualizar();
    return;
  }

  toast('Decisão registrada');
  if (aoAtualizar) await aoAtualizar();
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  abrirModalSolicitarAumento, onAumentoEscopoChange, onAumentoAnoChange, onAumentoValorInput, onAumentoJustificativaInput, onEnviarAumento,
  abrirDetalheAumento, confirmarDecisaoAumento
});
