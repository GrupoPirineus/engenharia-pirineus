import { sb } from '../../shared/supabase.js';
import { STATUS_LABELS, TIPO_LANCAMENTO, badgeStatus, badgePrio, fmtDate, fmtDateTime, toast, resetFileStore } from '../../shared/ui.js';
import { currentUser, isGestor, isEngenheiro, isSolicitante } from './auth.js';
import { currentPage, navigateTo, updateBadges } from './nav.js';

// ═══════════════════════════════════════════════════
// CHAMADOS (GESTOR)
// ═══════════════════════════════════════════════════
export async function renderChamados(filtroStatus='') {
  document.getElementById('topbar-title').textContent = 'Chamados';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  let query = sb.from('chamados').select(`*, empresas(nome), setores(nome), tipos_servico(nome), solicitante:solicitante_id(nome), engenheiro:engenheiro_id(nome)`).order('criado_em', {ascending:false});
  if (filtroStatus) query = query.eq('status', filtroStatus);

  const { data: chamados } = await query;

  page.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Todos os Chamados</div>
        <div class="filters">
          <select class="filter-select" onchange="renderChamados(this.value)">
            <option value="">Todos os status</option>
            ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}" ${filtroStatus===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      ${(chamados||[]).length === 0 ? `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Nenhum chamado encontrado</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Código</th><th>Título</th><th>Empresa</th><th>Status</th><th>Prioridade</th><th>Engenheiro</th><th>Data Desejada</th>
        </tr></thead>
        <tbody>
          ${(chamados||[]).map(c => `
            <tr onclick="openChamado('${c.id}')">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${c.codigo}</span></td>
              <td><strong>${c.titulo}</strong></td>
              <td><span class="text-muted text-sm">${c.empresas?.nome||'—'}</span></td>
              <td>${badgeStatus(c.status)}</td>
              <td>${badgePrio(c.prioridade)}</td>
              <td>${c.engenheiro?.nome || '<span class="text-muted">Não atribuído</span>'}</td>
              <td>${fmtDate(c.data_desejada)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// MEUS CHAMADOS (SOLICITANTE)
// ═══════════════════════════════════════════════════
export async function renderMeusChamados() {
  document.getElementById('topbar-title').textContent = 'Meus Chamados';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const { data: chamados } = await sb.from('chamados')
    .select(`*, empresas(nome), setores(nome), tipos_servico(nome), engenheiro:engenheiro_id(nome)`)
    .eq('solicitante_id', currentUser.id)
    .order('criado_em', {ascending:false});

  page.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="openNovoChamado()">+ Novo Chamado</button>
    </div>
    <div class="table-card">
      <div class="table-header"><div class="table-title">Meus Chamados</div></div>
      ${(chamados||[]).length === 0 ? `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Nenhum chamado ainda</div><div class="empty-desc">Abra um chamado para começar</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Código</th><th>Título</th><th>Status</th><th>Prioridade</th><th>Engenheiro</th><th>Data Desejada</th></tr></thead>
        <tbody>
          ${(chamados||[]).map(c => `
            <tr onclick="openChamado('${c.id}')">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${c.codigo}</span></td>
              <td><strong>${c.titulo}</strong></td>
              <td>${badgeStatus(c.status)}</td>
              <td>${badgePrio(c.prioridade)}</td>
              <td>${c.engenheiro?.nome || '<span class="text-muted">Aguardando</span>'}</td>
              <td>${fmtDate(c.data_desejada)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// MINHA FILA (ENGENHEIRO)
// ═══════════════════════════════════════════════════
export async function renderMinhaFila() {
  document.getElementById('topbar-title').textContent = 'Minha Fila';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const { data: chamados } = await sb.from('chamados')
    .select(`*, empresas(nome), setores(nome), tipos_servico(nome), solicitante:solicitante_id(nome)`)
    .eq('engenheiro_id', currentUser.id)
    .not('status', 'in', '("concluido","rejeitado")')
    .order('criado_em', {ascending:false});

  const prioOrder = { urgente:0, alta:1, media:2, baixa:3 };
  const sorted = (chamados||[]).sort((a,b) => (prioOrder[a.prioridade]??9) - (prioOrder[b.prioridade]??9));

  page.innerHTML = `
    <div class="table-card">
      <div class="table-header"><div class="table-title">Chamados Atribuídos a Mim</div></div>
      ${sorted.length === 0 ? `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Nenhum chamado na fila</div><div class="empty-desc">Você está em dia!</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Código</th><th>Título</th><th>Empresa</th><th>Status</th><th>Prioridade</th><th>Data Desejada</th></tr></thead>
        <tbody>
          ${sorted.map(c => `
            <tr onclick="openChamado('${c.id}')">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${c.codigo}</span></td>
              <td><strong>${c.titulo}</strong></td>
              <td><span class="text-muted text-sm">${c.empresas?.nome||'—'}</span></td>
              <td>${badgeStatus(c.status)}</td>
              <td>${badgePrio(c.prioridade)}</td>
              <td>${fmtDate(c.data_desejada)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// DETALHE DO CHAMADO
// ═══════════════════════════════════════════════════
export async function openChamado(id) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal modal-lg"><div class="loading"><div class="spinner"></div> Carregando...</div></div>';
  document.body.appendChild(overlay);

  const { data: c } = await sb.from('chamados')
    .select(`*, empresas(nome), setores(nome), tipos_servico(nome), solicitante:solicitante_id(nome,email), engenheiro:engenheiro_id(nome)`)
    .eq('id', id).single();

  const { data: diario } = await sb.from('diario_bordo').select('*, anexos_diario(*)').eq('chamado_id', id).order('data_trabalho', {ascending:false});
  const { data: historico } = await sb.from('historico_status').select('*, usuario:usuarios(nome)').eq('chamado_id', id).order('criado_em', {ascending:false});
  const { data: anexos } = await sb.from('anexos_chamado').select('*').eq('chamado_id', id);
  const { data: comentarios } = await sb.from('comentarios_chamado').select('*, usuario:usuario_id(nome,email), anexos_comentario(*)').eq('chamado_id', id).order('criado_em', {ascending:true});

  const totalHoras = (diario||[]).reduce((a,b) => a+b.horas, 0);
  const hoje = new Date().toISOString().split('T')[0];
  const atrasado = c.data_desejada && c.data_desejada < hoje && !['concluido','rejeitado'].includes(c.status);

  const statusFlow = ['solicitacao','aprovacao','atribuicao','execucao','revisao','concluido'];
  const statusFlowLabels = ['Solicitação','Aprovação','Atribuição','Execução','Revisão','Concluído'];
  const currentIdx = statusFlow.indexOf(c.status);

  let acoes = '';
  if (isGestor()) {
    if (c.status === 'aprovacao') {
      acoes = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="aprovarChamado('${id}')">✓ Aprovar</button>
          <button class="btn btn-danger btn-sm" onclick="rejeitarChamado('${id}')">✗ Rejeitar</button>
        </div>`;
    }
    if (c.status === 'atribuicao') {
      acoes = `<button class="btn btn-primary btn-sm" onclick="atribuirEngenheiro('${id}')">Atribuir Engenheiro</button>`;
    }
    if (!c.prioridade && c.status !== 'rejeitado') {
      acoes += ` <button class="btn btn-secondary btn-sm" onclick="definirPrioridade('${id}')">Definir Prioridade</button>`;
    }
    if (c.status === 'correcao') {
      acoes = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="enviarCorrecaoEngenheiro('${id}')">↩ Enviar Correção ao Engenheiro</button>
          <button class="btn btn-secondary btn-sm" onclick="moverStatus('${id}','concluido','Encerrado pelo gestor')">✓ Encerrar mesmo assim</button>
        </div>`;
    }
    if (c.status === 'concluido') {
      acoes = `<button class="btn btn-secondary btn-sm" onclick="reabrirConcluido('${id}')">↩ Reabrir Chamado</button>`;
    }
  }

  if (isEngenheiro() && c.engenheiro_id === currentUser.id) {
    if (c.status === 'execucao' || c.status === 'correcao') {
      acoes = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="openLancamento('${id}')">+ Lançar Horas</button>
          <button class="btn btn-secondary btn-sm" onclick="moverStatus('${id}','revisao','Enviado para revisão')">Enviar para Revisão</button>
        </div>`;
    }
  }

  if (isSolicitante() && c.solicitante_id === currentUser.id) {
    if (c.status === 'rejeitado') {
      acoes = `<button class="btn btn-primary btn-sm" onclick="abrirRevisarReenviar('${id}')">✎ Revisar e Reenviar</button>`;
    }
    if (c.status === 'revisao') {
      acoes = `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="aprovarRevisao('${id}')">✓ Aprovar e Concluir</button>
          <button class="btn btn-danger btn-sm" onclick="rejeitarRevisao('${id}')">✗ Solicitar Correção</button>
        </div>`;
    }
    if (['solicitacao'].includes(c.status)) {
      acoes = `<button class="btn btn-primary btn-sm" onclick="abrirRevisarReenviar('${id}')">✎ Revisar e Reenviar</button>`;
    }
  }

  overlay.querySelector('.modal').innerHTML = `
    <div class="modal-header">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="font-mono text-xs" style="color:var(--accent)">${c.codigo}</span>
          ${badgeStatus(c.status)}
          ${atrasado ? '<span class="badge badge-urgente">⚠ Atrasado</span>' : ''}
        </div>
        <h2>${c.titulo}</h2>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-secondary btn-sm" onclick="imprimirChamado('${id}')" title="Imprimir / Exportar PDF">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Imprimir
        </button>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="modal-body">

      ${c.status !== 'rejeitado' ? `
      <div class="status-flow">
        ${statusFlow.map((s,i) => `
          <div class="status-step">
            <div class="status-dot ${i < currentIdx ? 'done' : i === currentIdx ? 'current' : ''}">
              ${i < currentIdx ? '✓' : i+1}
            </div>
            <span class="status-label">${STATUS_LABELS[s]}</span>
          </div>
          ${i < statusFlow.length-1 ? '<span class="status-arrow">›</span>' : ''}
        `).join('')}
      </div>` : ''}

      ${c.motivo_rejeicao ? `<div style="background:var(--red-dim);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px"><div class="text-xs" style="color:var(--red);margin-bottom:4px;font-weight:600">MOTIVO DA REJEIÇÃO</div><div class="text-sm">${c.motivo_rejeicao}</div></div>` : ''}

      <div class="info-row">
        <div class="info-item"><span class="info-label">Empresa</span><span class="info-val">${c.empresas?.nome||'—'}</span></div>
        <div class="info-item"><span class="info-label">Setor</span><span class="info-val">${c.setores?.nome||'—'}</span></div>
        <div class="info-item"><span class="info-label">Tipo</span><span class="info-val">${c.tipos_servico?.nome||'—'}</span></div>
        <div class="info-item"><span class="info-label">Execução</span><span class="info-val"><span class="badge ${c.tipo_execucao === 'projeto_execucao' ? 'badge-execucao' : 'badge-atribuicao'}">${c.tipo_execucao === 'projeto_execucao' ? 'Projeto + Obra' : 'Apenas Projeto'}</span></span></div>
        <div class="info-item"><span class="info-label">Prioridade</span><span class="info-val">${badgePrio(c.prioridade)}</span></div>
        <div class="info-item"><span class="info-label">Solicitante</span><span class="info-val">${c.solicitante?.nome||'—'}</span></div>
        <div class="info-item"><span class="info-label">Engenheiro</span><span class="info-val">${c.engenheiro?.nome||'Não atribuído'}</span></div>
        <div class="info-item"><span class="info-label">Data Desejada</span><span class="info-val">${fmtDate(c.data_desejada)}</span></div>
        <div class="info-item"><span class="info-label">Abertura</span><span class="info-val">${fmtDate(c.criado_em)}</span></div>
        ${c.telefone_contato ? `<div class="info-item"><span class="info-label">Contato</span><span class="info-val">${c.telefone_contato}</span></div>` : ''}
        ${c.horas_estimadas ? `<div class="info-item"><span class="info-label">Horas Estimadas</span><span class="info-val">${c.horas_estimadas}h</span></div>` : ''}
        ${totalHoras > 0 ? `<div class="info-item"><span class="info-label">Horas Gastas</span><span class="info-val" style="color:var(--accent)">${totalHoras.toFixed(1)}h</span></div>` : ''}
      </div>

      ${(isEngenheiro() && c.engenheiro_id === currentUser.id) || isGestor() ? `
      <div class="form-section">
        <div class="form-section-title">Contato do Solicitante</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div style="font-size:13px;color:var(--text2);margin-right:8px">
            <strong style="color:var(--text)">${c.solicitante?.nome||'—'}</strong>
            ${c.telefone_contato ? ` · ${c.telefone_contato}` : ''}
          </div>
          ${c.telefone_contato ? `
            <a href="https://wa.me/55${c.telefone_contato.replace(/\D/g,'')}" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.6-1.5-.8-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z"/><path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3C4.4 15 4 13.5 4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8z"/></svg>
              WhatsApp
            </a>
            <a href="tel:${c.telefone_contato.replace(/\D/g,'')}" class="btn btn-secondary btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              Ligar
            </a>
          ` : ''}
          <a href="mailto:${c.solicitante?.email||''}" class="btn btn-secondary btn-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            E-mail
          </a>
        </div>
      </div>
      ` : ''}

      <div class="form-section">
        <div class="form-section-title">Descrição</div>
        <p style="color:var(--text2);line-height:1.7;font-size:13px">${c.descricao}</p>
      </div>

      ${(anexos||[]).length > 0 ? `
      <div class="form-section">
        <div class="form-section-title">Anexos do Chamado</div>
        <div class="file-list">
          ${anexos.map(a => `<div class="file-item"><span>📎</span><span class="file-item-name">${a.nome_arquivo}</span><a href="#" onclick="downloadAnexo('${a.storage_path}','anexos-chamados','${a.nome_arquivo}')" style="color:var(--accent);font-size:12px">↓</a></div>`).join('')}
        </div>
      </div>` : ''}

      ${acoes ? `<div class="divider"></div><div style="display:flex;gap:8px;flex-wrap:wrap">${acoes}</div>` : ''}

      <div class="divider"></div>

      <div class="form-section">
        <div class="section-header">
          <div class="form-section-title" style="margin-bottom:0">Diário de Bordo</div>
          ${isEngenheiro() && c.engenheiro_id === currentUser.id && c.status === 'execucao' ? `<button class="btn btn-secondary btn-sm" onclick="openLancamento('${id}')">+ Lançamento</button>` : ''}
        </div>
        <div style="margin-top:14px">
          ${(diario||[]).length === 0 ? '<div class="empty-state" style="padding:24px"><div class="empty-icon" style="font-size:24px">📓</div><div class="empty-desc">Nenhum lançamento ainda</div></div>' :
          diario.map(d => `
            <div class="diario-card">
              <div class="diario-header">
                <span class="badge ${d.tipo === 'projeto' ? 'badge-execucao' : 'badge-revisao'}">${TIPO_LANCAMENTO[d.tipo]||d.tipo}</span>
                <span class="diario-date">${fmtDate(d.data_trabalho)}</span>
                <span class="diario-hours">${d.horas}h</span>
                ${isEngenheiro() && d.engenheiro_id === currentUser.id ? `<a href="#" onclick="editarLancamento('${d.id}','${id}');return false;" style="margin-left:auto;color:var(--accent);font-size:12px;text-decoration:none" title="Editar lançamento">✎ Editar</a>` : ''}
              </div>
              <div class="diario-desc">${d.descricao}</div>
              ${(d.anexos_diario||[]).length > 0 ? `
                <div class="file-list" style="margin-top:10px">
                  ${d.anexos_diario.map(a => `<a href="#" onclick="downloadAnexo('${a.storage_path}','anexos-diario','${a.nome_arquivo}');return false;" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--accent);text-decoration:none"><span>📎</span> ${a.nome_arquivo}</a>`).join('')}
                </div>` : ''}
            </div>`).join('')}
        </div>
      </div>

      <div class="divider"></div>

      <div class="form-section">
        <div class="form-section-title">Conversa do Chamado</div>
        <div id="chat-messages" style="margin-top:14px;max-height:400px;overflow-y:auto">
          ${(comentarios||[]).length === 0 ? '<div class="empty-state" style="padding:24px"><div class="empty-icon" style="font-size:24px">💬</div><div class="empty-desc">Nenhuma mensagem ainda. Inicie a conversa abaixo.</div></div>' :
          comentarios.map(cm => {
            const isMe = cm.usuario_id === currentUser.id;
            return `
            <div style="display:flex;flex-direction:column;margin-bottom:14px;align-items:${isMe ? 'flex-end' : 'flex-start'}">
              <div style="max-width:75%;background:${isMe ? 'var(--accent-dim)' : 'var(--surface2)'};border:1px solid ${isMe ? 'var(--accent)' : 'var(--border)'};border-radius:var(--radius-lg);padding:10px 14px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  <span style="font-size:12px;font-weight:600;color:${isMe ? 'var(--accent)' : 'var(--text)'}">${cm.usuario?.nome||'—'}</span>
                  <span style="font-size:10px;color:var(--text3)">${fmtDateTime(cm.criado_em)}</span>
                </div>
                <div style="font-size:13px;color:var(--text);line-height:1.5;white-space:pre-wrap">${cm.mensagem}</div>
                ${(cm.anexos_comentario||[]).length > 0 ? `
                  <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                    ${cm.anexos_comentario.map(a => `<a href="#" onclick="downloadAnexo('${a.storage_path}','anexos-comentarios','${a.nome_arquivo}');return false;" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--accent);text-decoration:none"><span>📎</span> ${a.nome_arquivo}</a>`).join('')}
                  </div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
          <textarea id="chat-input" rows="2" placeholder="Digite sua mensagem..." style="margin-bottom:8px"></textarea>
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px">
              <input type="file" id="chat-files" multiple style="display:none" onchange="previewChatFiles(this)">
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('chat-files').click()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                Anexar
              </button>
              <span id="chat-file-count" class="text-xs text-muted"></span>
            </div>
            <button class="btn btn-primary btn-sm" onclick="enviarComentario('${id}')">Enviar</button>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="form-section">
        <div class="form-section-title">Histórico</div>
        <div class="timeline" style="margin-top:14px">
          ${(historico||[]).length === 0 ? '<p class="text-muted text-sm">Nenhum histórico.</p>' :
          historico.map(h => `
            <div class="timeline-item">
              <div class="timeline-dot">→</div>
              <div class="timeline-content">
                <div class="timeline-title">${STATUS_LABELS[h.status_novo]||h.status_novo}</div>
                <div class="timeline-meta">${h.usuario?.nome||'—'} · ${fmtDateTime(h.criado_em)}</div>
                ${h.observacao ? `<div class="timeline-desc">${h.observacao}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>

    </div>`;
}

// ═══════════════════════════════════════════════════
// AÇÕES DE CHAMADO
// ═══════════════════════════════════════════════════
export async function moverStatus(id, novoStatus, obs) {
  const { data: c } = await sb.from('chamados').select('status').eq('id',id).single();
  await sb.from('chamados').update({status: novoStatus}).eq('id',id);
  await sb.from('historico_status').insert({chamado_id:id, usuario_id:currentUser.id, status_anterior:c.status, status_novo:novoStatus, observacao:obs});
  toast(`Status atualizado: ${STATUS_LABELS[novoStatus]}`);
  document.querySelector('.modal-overlay')?.remove();
  updateBadges();
  navigateTo(currentPage);
}

export async function aprovarChamado(id) {
  // Abre modal de aprovação com atribuição OPCIONAL de engenheiro.
  // - Se escolher engenheiro: aprova E atribui (vai direto para execução).
  // - Se deixar "Atribuir depois": só aprova (vai para atribuição), fluxo atual.
  const { data: engenheiros } = await sb.from('usuarios')
    .select('id,nome').eq('perfil','engenheiro').eq('ativo',true);
  const optsEng = (engenheiros||[]).map(e => `<option value="${e.id}">${e.nome}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h2>Aprovar Chamado</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Atribuir engenheiro (opcional)</label>
          <select id="apr-eng">
            <option value="">— Atribuir depois —</option>
            ${optsEng}
          </select>
          <div class="text-xs text-muted" style="margin-top:4px">Deixe em "Atribuir depois" para aprovar agora e atribuir mais tarde.</div>
        </div>
        <div id="apr-extra" style="display:none">
          <div class="field"><label>Prioridade</label><select id="apr-prio"><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></div>
          <div class="field"><label>Horas Estimadas</label><input type="number" id="apr-horas" placeholder="Ex: 8" min="0" step="0.5"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarAprovacao('${id}')">Aprovar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Mostra prioridade/horas só quando um engenheiro é escolhido
  const sel = document.getElementById('apr-eng');
  sel.onchange = () => {
    document.getElementById('apr-extra').style.display = sel.value ? 'block' : 'none';
  };
}

export async function confirmarAprovacao(id) {
  const engId = document.getElementById('apr-eng').value;
  const { data: c } = await sb.from('chamados').select('status').eq('id',id).single();

  if (engId) {
    // Aprovar + atribuir de uma vez → vai direto para execução.
    // O e-mail de "execução" (Forma 2) notifica engenheiro + solicitante.
    const prio = document.getElementById('apr-prio').value;
    const horas = document.getElementById('apr-horas').value;
    await sb.from('chamados').update({engenheiro_id:engId, status:'execucao', prioridade:prio, horas_estimadas:horas||null}).eq('id',id);
    await sb.from('historico_status').insert({chamado_id:id, usuario_id:currentUser.id, status_anterior:c.status, status_novo:'execucao', observacao:'Aprovado e engenheiro atribuído'});
    document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
    toast('Chamado aprovado e engenheiro atribuído');
  } else {
    // Só aprovar (fluxo atual): vai para atribuição.
    document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
    await moverStatus(id, 'atribuicao', 'Chamado aprovado');
  }
  updateBadges();
  navigateTo(currentPage);
}

export async function rejeitarChamado(id) {
  const motivo = prompt('Motivo da rejeição:');
  if (!motivo) return;
  const { data: c } = await sb.from('chamados').select('status').eq('id',id).single();
  await sb.from('chamados').update({status:'rejeitado', motivo_rejeicao:motivo}).eq('id',id);
  await sb.from('historico_status').insert({chamado_id:id, usuario_id:currentUser.id, status_anterior:c.status, status_novo:'rejeitado', observacao:motivo});
  toast('Chamado rejeitado', 'error');
  document.querySelector('.modal-overlay')?.remove();
  updateBadges();
  navigateTo(currentPage);
}

export async function reabrirChamado(id) {
  await moverStatus(id, 'solicitacao', 'Chamado reaberto pelo solicitante após rejeição');
}

// ─── Revisar e Reenviar (chamado reaberto após rejeição, status 'solicitacao') ───
export async function abrirRevisarReenviar(id) {
  const { data: c } = await sb.from('chamados').select('*').eq('id', id).single();
  const { data: anexos } = await sb.from('anexos_chamado').select('*').eq('chamado_id', id);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header">
        <h2>Revisar e Reenviar — ${c.codigo}</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        ${c.motivo_rejeicao ? `<div style="background:var(--red-dim);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px"><div class="text-xs" style="color:var(--red);margin-bottom:4px;font-weight:600">MOTIVO DA REJEIÇÃO</div><div class="text-sm">${c.motivo_rejeicao}</div></div>` : ''}
        <div class="field">
          <label>Descrição Detalhada *</label>
          <textarea id="rv-descricao" rows="4">${c.descricao||''}</textarea>
        </div>
        <div class="form-section">
          <div class="form-section-title">Anexos Atuais</div>
          <div class="file-list" id="rv-anexos-existentes">
            ${(anexos||[]).length === 0 ? '<div class="text-xs text-muted">Nenhum anexo ainda.</div>' : anexos.map(a => `
              <div class="file-item" id="anexo-existente-${a.id}">
                <span>📎</span><span class="file-item-name">${a.nome_arquivo}</span>
                <a href="#" onclick="downloadAnexo('${a.storage_path}','anexos-chamados','${a.nome_arquivo}');return false;" style="color:var(--accent);font-size:12px">↓</a>
                <a href="#" onclick="removerAnexoExistente('${a.id}','${a.storage_path}');return false;" style="color:var(--red);font-size:14px;font-weight:bold;margin-left:4px;text-decoration:none" title="Remover anexo">✕</a>
              </div>`).join('')}
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Adicionar Novos Anexos</div>
          <div class="file-upload-area" onclick="document.getElementById('rv-files').click()">
            <input type="file" id="rv-files" multiple onchange="addFiles(this,'rv-files','rv-file-list')">
            <div class="file-upload-icon">📎</div>
            <div class="file-upload-text">Clique para selecionar arquivos ou arraste aqui<br><span class="text-xs text-muted">Plantas, fotos, documentos</span></div>
          </div>
          <div class="file-list" id="rv-file-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarReenvio('${id}')">Reenviar para Aprovação</button>
      </div>
    </div>`;
  resetFileStore('rv-files', 'rv-file-list');
  document.body.appendChild(overlay);
}

export async function removerAnexoExistente(anexoId, storagePath) {
  if (!confirm('Remover este anexo? Essa ação não pode ser desfeita.')) return;

  const { error: storageErr } = await sb.storage.from('anexos-chamados').remove([storagePath]);
  const { error: dbErr } = await sb.from('anexos_chamado').delete().eq('id', anexoId);

  if (storageErr || dbErr) {
    toast('Erro ao remover anexo: ' + (dbErr?.message || storageErr?.message || 'falha desconhecida'), 'error');
    return; // não remove da tela — se falhou de verdade, o item continua visível, refletindo a realidade
  }

  document.getElementById(`anexo-existente-${anexoId}`)?.remove();
  toast('Anexo removido');
}

export async function confirmarReenvio(id) {
  const descricao = document.getElementById('rv-descricao').value.trim();
  if (!descricao) { toast('A descrição não pode ficar vazia', 'error'); return; }

  const { data: c } = await sb.from('chamados').select('status').eq('id', id).single();
  await sb.from('chamados').update({ descricao, status: 'aprovacao', motivo_rejeicao: null }).eq('id', id);
  await sb.from('historico_status').insert({ chamado_id: id, usuario_id: currentUser.id, status_anterior: c.status, status_novo: 'aprovacao', observacao: 'Reenviado para aprovação pelo solicitante' });

  const filesInput = document.getElementById('rv-files');
  const falhasAnexo = [];
  for (const file of (filesInput?.files || [])) {
    const path = `${id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await sb.storage.from('anexos-chamados').upload(path, file);
    if (upErr) { falhasAnexo.push(`${file.name}: ${upErr.message}`); continue; }
    const { error: insErr } = await sb.from('anexos_chamado').insert({ chamado_id: id, usuario_id: currentUser.id, nome_arquivo: file.name, storage_path: path, tamanho_bytes: file.size, tipo_mime: file.type });
    if (insErr) falhasAnexo.push(`${file.name}: ${insErr.message}`);
  }

  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  if (falhasAnexo.length) {
    toast('Chamado reenviado, mas houve erro no(s) anexo(s): ' + falhasAnexo.join(' | '), 'error');
  } else {
    toast('Chamado reenviado para aprovação!');
  }
  updateBadges();
  navigateTo(currentPage);
}

export async function atribuirEngenheiro(id) {
  const { data: engenheiros } = await sb.from('usuarios').select('id,nome').eq('perfil','engenheiro').eq('ativo',true);
  if (!engenheiros?.length) { toast('Nenhum engenheiro cadastrado', 'error'); return; }

  const opts = engenheiros.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header"><h2>Atribuir Engenheiro</h2><button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      <div class="modal-body">
        <div class="field"><label>Engenheiro</label><select id="eng-select">${opts}</select></div>
        <div class="field"><label>Prioridade</label><select id="prio-select"><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></div>
        <div class="field"><label>Horas Estimadas</label><input type="number" id="horas-est" placeholder="Ex: 8" min="0" step="0.5"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarAtribuicao('${id}')">Confirmar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.querySelector('.modal-overlay:last-child .modal-overlay')?.remove();
}

export async function confirmarAtribuicao(id) {
  const engId = document.getElementById('eng-select').value;
  const prio = document.getElementById('prio-select').value;
  const horas = document.getElementById('horas-est').value;
  const { data: c } = await sb.from('chamados').select('status').eq('id',id).single();
  await sb.from('chamados').update({engenheiro_id:engId, status:'execucao', prioridade:prio, horas_estimadas:horas||null}).eq('id',id);
  await sb.from('historico_status').insert({chamado_id:id, usuario_id:currentUser.id, status_anterior:c.status, status_novo:'execucao', observacao:'Engenheiro atribuído'});
  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  toast('Engenheiro atribuído com sucesso');
  updateBadges();
  navigateTo(currentPage);
}

export async function aprovarRevisao(id) {
  await moverStatus(id, 'concluido', 'Aprovado pelo solicitante');
}

export async function rejeitarRevisao(id) {
  const motivo = document.createElement('div');
  motivo.className = 'modal-overlay';
  motivo.id = 'modal-rejeitar-revisao';
  motivo.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <h2>Solicitar Correção</h2>
        <button class="close-btn" onclick="document.getElementById('modal-rejeitar-revisao').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p class="text-muted text-sm" style="margin-bottom:14px">Descreva o que precisa ser corrigido. O gestor será notificado para avaliar.</p>
        <div class="field">
          <label>O que precisa ser ajustado *</label>
          <textarea id="motivo-correcao" rows="4" placeholder="Descreva detalhadamente o que precisa ser corrigido..."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-rejeitar-revisao').remove()">Cancelar</button>
        <button class="btn btn-danger" onclick="confirmarRejeicaoRevisao('${id}')">Solicitar Correção</button>
      </div>
    </div>`;
  document.body.appendChild(motivo);
}

export async function confirmarRejeicaoRevisao(id) {
  const motivo = document.getElementById('motivo-correcao')?.value?.trim();
  if (!motivo) { toast('Descreva o que precisa ser corrigido', 'error'); return; }
  const { data: c } = await sb.from('chamados').select('status').eq('id',id).single();
  await sb.from('chamados').update({status:'correcao', motivo_rejeicao:motivo}).eq('id',id);
  await sb.from('historico_status').insert({chamado_id:id, usuario_id:currentUser.id, status_anterior:c.status, status_novo:'correcao', observacao:motivo});
  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  toast('Solicitação de correção enviada ao gestor');
  navigateTo(currentPage);
}

export async function enviarCorrecaoEngenheiro(id) {
  const { data: c } = await sb.from('chamados').select('status, motivo_rejeicao').eq('id',id).single();
  await sb.from('chamados').update({status:'execucao'}).eq('id',id);
  await sb.from('historico_status').insert({chamado_id:id, usuario_id:currentUser.id, status_anterior:'correcao', status_novo:'execucao', observacao:`Correção solicitada: ${c.motivo_rejeicao}`});
  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  toast('Chamado devolvido ao engenheiro para correção');
  updateBadges();
  navigateTo(currentPage);
}

export async function reabrirConcluido(id) {
  const obs = 'Chamado reaberto pelo gestor';
  await moverStatus(id, 'execucao', obs);
}

export async function definirPrioridade(id) {
  const prio = prompt('Prioridade (baixa/media/alta/urgente):');
  if (!prio || !['baixa','media','alta','urgente'].includes(prio)) return;
  await sb.from('chamados').update({prioridade:prio}).eq('id',id);
  toast('Prioridade definida');
  document.querySelector('.modal-overlay')?.remove();
  navigateTo(currentPage);
}

// ═══════════════════════════════════════════════════
// NOVO CHAMADO
// ═══════════════════════════════════════════════════
export async function openNovoChamado() {
  const [{ data: empresas }, { data: tipos }] = await Promise.all([
    sb.from('empresas').select('id,nome').eq('ativo',true).order('nome'),
    sb.from('tipos_servico').select('id,nome').eq('ativo',true).order('nome')
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header">
        <h2>Novo Chamado</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-section">
          <div class="form-section-title">Empresa e Setor</div>
          <div class="form-row">
            <div class="field">
              <label>Empresa *</label>
              <select id="nc-empresa" onchange="loadSetores(this.value)">
                <option value="">Selecione...</option>
                ${(empresas||[]).map(e => `<option value="${e.id}">${e.nome}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Setor *</label>
              <select id="nc-setor"><option value="">Selecione a empresa primeiro</option></select>
            </div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Sobre o Serviço</div>
          <div class="field">
            <label>Título *</label>
            <input type="text" id="nc-titulo" placeholder="Descreva brevemente o que precisa">
          </div>
          <div class="field">
            <label>Telefone / WhatsApp para contato *</label>
            <input type="tel" id="nc-telefone" placeholder="(00) 00000-0000">
          </div>
          <div class="form-row">
            <div class="field">
              <label>Tipo de Serviço *</label>
              <select id="nc-tipo">
                <option value="">Selecione...</option>
                ${(tipos||[]).map(t => `<option value="${t.id}">${t.nome}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Data Desejada</label>
              <input type="date" id="nc-data">
            </div>
          </div>
          <div class="field">
            <label>Tipo de Execução *</label>
            <div style="display:flex;gap:12px;margin-top:4px" id="nc-execucao-group">
              <label class="radio-option checked" onclick="selectRadio(this)">
                <input type="radio" name="nc-execucao" value="projeto" checked> Apenas Projeto
              </label>
              <label class="radio-option" onclick="selectRadio(this)">
                <input type="radio" name="nc-execucao" value="projeto_execucao"> Projeto + Execução de Obra
              </label>
            </div>
          </div>
          <div class="field">
            <label>Descrição Detalhada *</label>
            <textarea id="nc-descricao" rows="4" placeholder="Descreva o serviço necessário com o máximo de detalhes possível..."></textarea>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Anexos</div>
          <div class="file-upload-area" onclick="document.getElementById('nc-files').click()">
            <input type="file" id="nc-files" multiple onchange="previewFiles(this)">
            <div class="file-upload-icon">📎</div>
            <div class="file-upload-text">Clique para selecionar arquivos ou arraste aqui<br><span class="text-xs text-muted">Plantas, fotos, documentos</span></div>
          </div>
          <div class="file-list" id="nc-file-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="submeterChamado()">Enviar Chamado</button>
      </div>
    </div>`;
  resetFileStore('nc-files', 'nc-file-list');
  document.body.appendChild(overlay);
}

export async function loadSetores(empresaId) {
  if (!empresaId) return;
  const { data } = await sb.from('empresa_setores').select('setores(id,nome)').eq('empresa_id', empresaId);
  const setorSel = document.getElementById('nc-setor');
  setorSel.innerHTML = '<option value="">Selecione...</option>' + (data||[]).map(r => `<option value="${r.setores.id}">${r.setores.nome}</option>`).join('');
}

export async function submeterChamado() {
  const empresa = document.getElementById('nc-empresa').value;
  const setor = document.getElementById('nc-setor').value;
  const titulo = document.getElementById('nc-titulo').value.trim();
  const tipo = document.getElementById('nc-tipo').value;
  const descricao = document.getElementById('nc-descricao').value.trim();
  const data = document.getElementById('nc-data').value;

  const telefone = document.getElementById('nc-telefone').value.trim();
  if (!empresa || !setor || !titulo || !tipo || !descricao || !telefone) { toast('Preencha todos os campos obrigatórios', 'error'); return; }

  const tipoExecucao = document.querySelector('input[name="nc-execucao"]:checked')?.value || 'projeto';
  const { data: chamado, error } = await sb.from('chamados').insert({
    titulo, descricao, empresa_id:empresa, setor_id:setor, tipo_servico_id:tipo,
    solicitante_id:currentUser.id, status:'aprovacao',
    data_desejada:data||null, tipo_execucao:tipoExecucao, telefone_contato:telefone
  }).select().single();

  if (error) { toast('Erro ao criar chamado: ' + error.message, 'error'); return; }

  await sb.from('historico_status').insert({chamado_id:chamado.id, usuario_id:currentUser.id, status_anterior:null, status_novo:'aprovacao', observacao:'Chamado criado'});

  // Upload de arquivos
  const files = document.getElementById('nc-files').files;
  const falhasAnexo = [];
  for (const file of files) {
    const path = `${chamado.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await sb.storage.from('anexos-chamados').upload(path, file);
    if (upErr) { falhasAnexo.push(`${file.name}: ${upErr.message}`); continue; }
    const { error: insErr } = await sb.from('anexos_chamado').insert({ chamado_id:chamado.id, usuario_id:currentUser.id, nome_arquivo:file.name, storage_path:path, tamanho_bytes:file.size, tipo_mime:file.type });
    if (insErr) falhasAnexo.push(`${file.name}: ${insErr.message}`);
  }
  if (falhasAnexo.length) toast('Chamado criado, mas houve erro no(s) anexo(s): ' + falhasAnexo.join(' | '), 'error');

  document.querySelector('.modal-overlay')?.remove();
  if (!falhasAnexo.length) toast(`Chamado ${chamado.codigo} criado com sucesso!`);
  updateBadges();
  navigateTo(currentPage);
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  renderChamados, openChamado, moverStatus, aprovarChamado, confirmarAprovacao,
  rejeitarChamado, abrirRevisarReenviar, removerAnexoExistente, confirmarReenvio,
  atribuirEngenheiro, confirmarAtribuicao, aprovarRevisao, rejeitarRevisao,
  confirmarRejeicaoRevisao, enviarCorrecaoEngenheiro, reabrirConcluido, definirPrioridade,
  openNovoChamado, loadSetores, submeterChamado
});
