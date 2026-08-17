import { sb } from '../../shared/supabase.js';
import { STATUS_LABELS, PRIORIDADE_LABELS, TIPO_LANCAMENTO, fmtDate, fmtDateTime, toast, resetFileStore, downloadAnexo } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { currentPage, navigateTo } from './nav.js';
import { openChamado } from './chamados.js';

// ═══════════════════════════════════════════════════
// LANÇAMENTO DE HORAS
// ═══════════════════════════════════════════════════
export async function openLancamento(chamadoId) {
  const { data: c } = await sb.from('chamados').select('codigo, titulo, horas_estimadas').eq('id', chamadoId).single();
  const { data: diario } = await sb.from('diario_bordo').select('horas').eq('chamado_id', chamadoId);
  const totalHoras = (diario||[]).reduce((a,b) => a+b.horas, 0);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div><h2>Lançar Horas</h2><div class="text-xs text-muted font-mono" style="margin-top:4px">${c.codigo} — ${c.titulo}</div></div>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        ${c.horas_estimadas ? `
        <div class="info-row" style="margin-bottom:16px">
          <div class="info-item"><span class="info-label">Estimado</span><span class="info-val">${c.horas_estimadas}h</span></div>
          <div class="info-item"><span class="info-label">Lançado</span><span class="info-val" style="color:var(--accent)">${totalHoras.toFixed(1)}h</span></div>
          <div class="info-item"><span class="info-label">Saldo</span><span class="info-val" style="color:${totalHoras > c.horas_estimadas ? 'var(--red)' : 'var(--green)'}">${(c.horas_estimadas - totalHoras).toFixed(1)}h</span></div>
        </div>` : ''}
        <div class="form-row">
          <div class="field">
            <label>Tipo *</label>
            <select id="lan-tipo">
              <option value="projeto">Projeto</option>
              ${c.tipo_execucao === 'projeto_execucao' ? '<option value="acompanhamento_obra">Acompanhamento de Obra</option>' : ''}
            </select>
          </div>
          <div class="field">
            <label>Data *</label>
            <input type="date" id="lan-data" value="${new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="field">
          <label>Horas *</label>
          <input type="number" id="lan-horas" placeholder="Ex: 2.5" min="0.5" max="24" step="0.5">
        </div>
        <div class="field">
          <label>Descrição da Atividade *</label>
          <textarea id="lan-descricao" rows="3" placeholder="Descreva o que foi realizado..."></textarea>
        </div>
        <div class="field">
          <label>Atualizar Horas Estimadas</label>
          <input type="number" id="lan-est" placeholder="${c.horas_estimadas||'Não definido'}" min="0" step="0.5">
          <div class="text-xs text-muted" style="margin-top:4px">Deixe em branco para manter o valor atual</div>
        </div>
        <div class="form-section" style="margin-top:16px">
          <div class="form-section-title">Fotos / Arquivos</div>
          <div class="file-upload-area" onclick="document.getElementById('lan-files').click()">
            <input type="file" id="lan-files" multiple accept="image/*,.pdf,.dwg,.doc,.docx" onchange="previewLanFiles(this)">
            <div class="file-upload-icon">📷</div>
            <div class="file-upload-text">Fotos do andamento ou documentos</div>
          </div>
          <div class="file-list" id="lan-file-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarLancamento('${chamadoId}')">Salvar Lançamento</button>
      </div>
    </div>`;
  resetFileStore('lan-files', 'lan-file-list');
  document.body.appendChild(overlay);
}

export async function confirmarLancamento(chamadoId) {
  const tipo = document.getElementById('lan-tipo').value;
  const data = document.getElementById('lan-data').value;
  const horas = parseFloat(document.getElementById('lan-horas').value);
  const descricao = document.getElementById('lan-descricao').value.trim();
  const novaEst = document.getElementById('lan-est').value;

  if (!data || !horas || !descricao) { toast('Preencha todos os campos obrigatórios', 'error'); return; }

  const { data: lancamento, error } = await sb.from('diario_bordo').insert({
    chamado_id:chamadoId, engenheiro_id:currentUser.id, tipo, data_trabalho:data, horas, descricao
  }).select().single();

  if (error) { toast('Erro: ' + error.message, 'error'); return; }

  if (novaEst) await sb.from('chamados').update({horas_estimadas:parseFloat(novaEst)}).eq('id',chamadoId);

  const files = document.getElementById('lan-files').files;
  const falhasAnexo = [];
  for (const file of files) {
    const path = `${lancamento.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await sb.storage.from('anexos-diario').upload(path, file);
    if (upErr) { falhasAnexo.push(`${file.name}: ${upErr.message}`); continue; }
    const { error: insErr } = await sb.from('anexos_diario').insert({diario_id:lancamento.id, nome_arquivo:file.name, storage_path:path, tamanho_bytes:file.size, tipo_mime:file.type});
    if (insErr) falhasAnexo.push(`${file.name}: ${insErr.message}`);
  }

  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  if (falhasAnexo.length) {
    toast('Lançamento salvo, mas houve erro no(s) anexo(s): ' + falhasAnexo.join(' | '), 'error');
  } else {
    toast('Lançamento salvo com sucesso!');
  }
  navigateTo(currentPage);
}

// ─── Editar lançamento do Diário de Bordo (engenheiro dono do lançamento) ───
export async function editarLancamento(lancamentoId, chamadoId) {
  const { data: d } = await sb.from('diario_bordo').select('*, anexos_diario(*)').eq('id', lancamentoId).single();
  const { data: c } = await sb.from('chamados').select('codigo, titulo, tipo_execucao').eq('id', chamadoId).single();
  if (!d) { toast('Lançamento não encontrado', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div><h2>Editar Lançamento</h2><div class="text-xs text-muted font-mono" style="margin-top:4px">${c.codigo} — ${c.titulo}</div></div>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="field">
            <label>Tipo *</label>
            <select id="ed-tipo">
              <option value="projeto" ${d.tipo === 'projeto' ? 'selected' : ''}>Projeto</option>
              ${c.tipo_execucao === 'projeto_execucao' ? `<option value="acompanhamento_obra" ${d.tipo === 'acompanhamento_obra' ? 'selected' : ''}>Acompanhamento de Obra</option>` : ''}
            </select>
          </div>
          <div class="field">
            <label>Data *</label>
            <input type="date" id="ed-data" value="${d.data_trabalho}">
          </div>
        </div>
        <div class="field">
          <label>Horas *</label>
          <input type="number" id="ed-horas" value="${d.horas}" min="0" step="0.5">
        </div>
        <div class="field">
          <label>Descrição da Atividade *</label>
          <textarea id="ed-descricao" rows="4">${d.descricao||''}</textarea>
        </div>
        <div class="form-section">
          <div class="form-section-title">Anexos Atuais</div>
          <div class="file-list" id="ed-anexos-existentes">
            ${(d.anexos_diario||[]).length === 0 ? '<div class="text-xs text-muted">Nenhum anexo neste lançamento.</div>' : d.anexos_diario.map(a => `
              <div class="file-item" id="anexo-diario-${a.id}">
                <span>📎</span><span class="file-item-name">${a.nome_arquivo}</span>
                <a href="#" onclick="downloadAnexo('${a.storage_path}','anexos-diario','${a.nome_arquivo}');return false;" style="color:var(--accent);font-size:12px">↓</a>
                <a href="#" onclick="removerAnexoDiario('${a.id}','${a.storage_path}');return false;" style="color:var(--red);font-size:14px;font-weight:bold;margin-left:4px;text-decoration:none" title="Remover anexo">✕</a>
              </div>`).join('')}
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Adicionar Novos Anexos</div>
          <div class="file-upload-area" onclick="document.getElementById('ed-files').click()">
            <input type="file" id="ed-files" multiple accept="image/*,.pdf,.dwg,.doc,.docx,.pptx,.xlsx" onchange="addFiles(this,'ed-files','ed-file-list')">
            <div class="file-upload-icon">📷</div>
            <div class="file-upload-text">Fotos do andamento ou documentos</div>
          </div>
          <div class="file-list" id="ed-file-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarEdicaoLancamento('${lancamentoId}','${chamadoId}')">Salvar Alterações</button>
      </div>
    </div>`;
  resetFileStore('ed-files', 'ed-file-list');
  document.body.appendChild(overlay);
}

export async function removerAnexoDiario(anexoId, storagePath) {
  if (!confirm('Remover este anexo? Essa ação não pode ser desfeita.')) return;
  const { error: storageErr } = await sb.storage.from('anexos-diario').remove([storagePath]);
  const { error: dbErr } = await sb.from('anexos_diario').delete().eq('id', anexoId);
  if (storageErr || dbErr) {
    toast('Erro ao remover anexo: ' + (dbErr?.message || storageErr?.message || 'falha desconhecida'), 'error');
    return;
  }
  document.getElementById(`anexo-diario-${anexoId}`)?.remove();
  toast('Anexo removido');
}

export async function confirmarEdicaoLancamento(lancamentoId, chamadoId) {
  const tipo = document.getElementById('ed-tipo').value;
  const data = document.getElementById('ed-data').value;
  const horas = parseFloat(document.getElementById('ed-horas').value);
  const descricao = document.getElementById('ed-descricao').value.trim();

  if (!data || !horas || !descricao) { toast('Preencha todos os campos obrigatórios', 'error'); return; }

  const { error } = await sb.from('diario_bordo')
    .update({ tipo, data_trabalho: data, horas, descricao })
    .eq('id', lancamentoId);

  if (error) { toast('Erro ao salvar: ' + error.message, 'error'); return; }

  const filesInput = document.getElementById('ed-files');
  const falhasAnexo = [];
  for (const file of (filesInput?.files || [])) {
    const path = `${lancamentoId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await sb.storage.from('anexos-diario').upload(path, file);
    if (upErr) { falhasAnexo.push(`${file.name}: ${upErr.message}`); continue; }
    const { error: insErr } = await sb.from('anexos_diario').insert({ diario_id: lancamentoId, nome_arquivo: file.name, storage_path: path, tamanho_bytes: file.size, tipo_mime: file.type });
    if (insErr) falhasAnexo.push(`${file.name}: ${insErr.message}`);
  }

  document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  if (falhasAnexo.length) {
    toast('Lançamento salvo, mas houve erro no(s) anexo(s): ' + falhasAnexo.join(' | '), 'error');
  } else {
    toast('Lançamento atualizado');
  }
  navigateTo(currentPage);
}

export async function imprimirChamado(id) {
  const { data: c } = await sb.from('chamados')
    .select(`*, empresas(nome), setores(nome), tipos_servico(nome), solicitante:solicitante_id(nome,email), engenheiro:engenheiro_id(nome)`)
    .eq('id', id).single();
  const { data: diario } = await sb.from('diario_bordo').select('*').eq('chamado_id', id).order('data_trabalho', {ascending:true});
  const { data: historico } = await sb.from('historico_status').select('*, usuario:usuarios(nome)').eq('chamado_id', id).order('criado_em', {ascending:true});
  const { data: anexos } = await sb.from('anexos_chamado').select('*').eq('chamado_id', id);
  const totalHoras = (diario||[]).reduce((a,b) => a+b.horas, 0);

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8">
    <title>${c.codigo} — ${c.titulo}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #0f2233; padding: 32px; max-width: 800px; margin: 0 auto; font-size: 13px; }
      h1 { font-size: 20px; color: #1a9e9e; margin-bottom: 4px; }
      h2 { font-size: 14px; color: #4a6478; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #d0dde8; padding-bottom: 6px; margin: 20px 0 10px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #1a9e9e; padding-bottom: 16px; }
      .codigo { font-family: monospace; color: #1a9e9e; font-size: 12px; margin-bottom: 4px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #f0f4f7; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      .item label { font-size: 10px; color: #8aa0b0; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 2px; }
      .item span { font-size: 13px; font-weight: 500; }
      .desc { background: #f8fafc; border: 1px solid #d0dde8; border-radius: 6px; padding: 12px; line-height: 1.6; margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #f0f4f7; padding: 8px 10px; text-align: left; font-size: 11px; color: #4a6478; text-transform: uppercase; }
      td { padding: 8px 10px; border-bottom: 1px solid #e8f0f5; font-size: 12px; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; background: #e8f8f8; color: #1a9e9e; }
      .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #d0dde8; font-size: 11px; color: #8aa0b0; display: flex; justify-content: space-between; }
      @media print { body { padding: 16px; } }
    </style>
  </head><body>
    <div class="header">
      <div>
        <div class="codigo">${c.codigo}</div>
        <h1>${c.titulo}</h1>
        <span class="badge">${STATUS_LABELS[c.status]||c.status}</span>
      </div>
      <div style="text-align:right;font-size:11px;color:#8aa0b0">
        <div><strong>Engenharia Grupo Pirineus</strong></div>
        <div>Emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
    </div>

    <h2>Informações do Chamado</h2>
    <div class="grid">
      <div class="item"><label>Empresa</label><span>${c.empresas?.nome||'—'}</span></div>
      <div class="item"><label>Setor</label><span>${c.setores?.nome||'—'}</span></div>
      <div class="item"><label>Tipo de Serviço</label><span>${c.tipos_servico?.nome||'—'}</span></div>
      <div class="item"><label>Execução</label><span>${c.tipo_execucao === 'projeto_execucao' ? 'Projeto + Obra' : 'Apenas Projeto'}</span></div>
      <div class="item"><label>Prioridade</label><span>${PRIORIDADE_LABELS[c.prioridade]||'—'}</span></div>
      <div class="item"><label>Solicitante</label><span>${c.solicitante?.nome||'—'}</span></div>
      <div class="item"><label>Engenheiro</label><span>${c.engenheiro?.nome||'—'}</span></div>
      <div class="item"><label>Data Desejada</label><span>${fmtDate(c.data_desejada)}</span></div>
      <div class="item"><label>Abertura</label><span>${fmtDate(c.criado_em)}</span></div>
      ${c.horas_estimadas ? `<div class="item"><label>Horas Estimadas</label><span>${c.horas_estimadas}h</span></div>` : ''}
      ${totalHoras > 0 ? `<div class="item"><label>Horas Gastas</label><span>${totalHoras.toFixed(1)}h</span></div>` : ''}
    </div>

    <h2>Descrição</h2>
    <div class="desc">${c.descricao}</div>

    ${(anexos||[]).length > 0 ? `
    <h2>Anexos</h2>
    <table><thead><tr><th>Arquivo</th></tr></thead><tbody>
      ${anexos.map(a => `<tr><td>📎 ${a.nome_arquivo}</td></tr>`).join('')}
    </tbody></table>` : ''}

    ${(diario||[]).length > 0 ? `
    <h2>Diário de Bordo</h2>
    <table>
      <thead><tr><th>Data</th><th>Tipo</th><th>Horas</th><th>Descrição</th></tr></thead>
      <tbody>
        ${diario.map(d => `<tr>
          <td>${fmtDate(d.data_trabalho)}</td>
          <td>${TIPO_LANCAMENTO[d.tipo]||d.tipo}</td>
          <td>${d.horas}h</td>
          <td>${d.descricao}</td>
        </tr>`).join('')}
        <tr style="font-weight:bold;background:#f0f4f7">
          <td colspan="2">Total</td>
          <td>${totalHoras.toFixed(1)}h</td>
          <td></td>
        </tr>
      </tbody>
    </table>` : ''}

    ${(historico||[]).length > 0 ? `
    <h2>Histórico</h2>
    <table>
      <thead><tr><th>Data</th><th>Status</th><th>Usuário</th><th>Observação</th></tr></thead>
      <tbody>
        ${historico.map(h => `<tr>
          <td>${fmtDateTime(h.criado_em)}</td>
          <td>${STATUS_LABELS[h.status_novo]||h.status_novo}</td>
          <td>${h.usuario?.nome||'—'}</td>
          <td>${h.observacao||'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}

    <div class="footer">
      <span>Sistema de Gestão de Engenharia — Grupo Pirineus</span>
      <span>${c.codigo}</span>
    </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

let chatFilesSelected = [];

export function previewChatFiles(input) {
  chatFilesSelected = Array.from(input.files);
  const count = document.getElementById('chat-file-count');
  if (count) count.textContent = chatFilesSelected.length > 0 ? `${chatFilesSelected.length} arquivo(s)` : '';
}

export async function enviarComentario(chamadoId) {
  const input = document.getElementById('chat-input');
  const mensagem = input?.value?.trim();
  const files = document.getElementById('chat-files')?.files || [];
  if (!mensagem && files.length === 0) { toast('Digite uma mensagem ou anexe um arquivo', 'error'); return; }

  const { data: coment, error } = await sb.from('comentarios_chamado').insert({
    chamado_id: chamadoId,
    usuario_id: currentUser.id,
    mensagem: mensagem || '(arquivo anexado)'
  }).select().single();

  if (error) { toast('Erro ao enviar: ' + error.message, 'error'); return; }

  // Upload de anexos
  for (const file of files) {
    const path = `${coment.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await sb.storage.from('anexos-comentarios').upload(path, file);
    if (!upErr) {
      await sb.from('anexos_comentario').insert({
        comentario_id: coment.id, nome_arquivo: file.name, storage_path: path,
        tamanho_bytes: file.size, tipo_mime: file.type
      });
    }
  }

  chatFilesSelected = [];
  toast('Mensagem enviada');
  // Reabrir o chamado para atualizar o chat
  document.querySelector('.modal-overlay')?.remove();
  openChamado(chamadoId);
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  openLancamento, confirmarLancamento, editarLancamento, removerAnexoDiario,
  confirmarEdicaoLancamento, imprimirChamado, previewChatFiles, enviarComentario
});
