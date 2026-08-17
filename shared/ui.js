import { sb } from './supabase.js';

// ═══════════════════════════════════════════════════
// LABELS
// ═══════════════════════════════════════════════════
export const STATUS_LABELS = {
  solicitacao:'Solicitação', aprovacao:'Aprovação', atribuicao:'Atribuição',
  execucao:'Execução', revisao:'Revisão', correcao:'Correção', concluido:'Concluído', rejeitado:'Rejeitado'
};
export const PRIORIDADE_LABELS = { baixa:'Baixa', media:'Média', alta:'Alta', urgente:'Urgente' };
export const PERFIL_LABELS = {
  pendente:'Pendente', solicitante:'Solicitante', engenheiro:'Engenheiro',
  gestor:'Gestor', gestor_master:'Gestor Master'
};
export const TIPO_LANCAMENTO = { projeto:'Projeto', acompanhamento_obra:'Acompanhamento de Obra' };

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
export function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
export function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
export function setPage(id) {
  ['auth-screen','pending-screen','app-screen'].forEach(s => hide(s));
  show(id);
}

export function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  setTimeout(() => el.className = '', 3000);
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

export function badgeStatus(s) {
  return `<span class="badge badge-${s}">${STATUS_LABELS[s]||s}</span>`;
}
export function badgePrio(p) {
  if (!p) return '<span class="text-muted">—</span>';
  return `<span class="badge badge-${p}">${PRIORIDADE_LABELS[p]||p}</span>`;
}
export function badgePerfil(p) {
  return `<span class="badge badge-${p}">${PERFIL_LABELS[p]||p}</span>`;
}

// ═══════════════════════════════════════════════════
// GESTÃO DE ARQUIVOS SELECIONADOS (acumulativa)
// ═══════════════════════════════════════════════════
// O navegador SUBSTITUI input.files a cada nova seleção — se o usuário escolhe um
// arquivo, depois clica de novo e escolhe outro, o primeiro é descartado. Por isso
// mantemos a lista real aqui e reescrevemos input.files via DataTransfer, para que
// submeterChamado()/confirmarLancamento()/confirmarReenvio() continuem lendo o input
// normalmente e recebam TODOS os arquivos acumulados.
const filesStore = {};

export function resetFileStore(inputId, listId) {
  filesStore[inputId] = [];
  const list = document.getElementById(listId);
  if (list) list.innerHTML = '';
}

export function previewFiles(input) { addFiles(input, 'nc-files', 'nc-file-list'); }
export function previewLanFiles(input) { addFiles(input, 'lan-files', 'lan-file-list'); }

export function addFiles(input, inputId, listId) {
  const atuais = filesStore[inputId] || [];
  Array.from(input.files).forEach(f => {
    const jaExiste = atuais.some(e => e.name === f.name && e.size === f.size);
    if (!jaExiste) atuais.push(f);
  });
  filesStore[inputId] = atuais;
  syncInputFiles(inputId);
  renderFileList(inputId, listId);
}

export function syncInputFiles(inputId) {
  const dt = new DataTransfer();
  (filesStore[inputId] || []).forEach(f => dt.items.add(f));
  const input = document.getElementById(inputId);
  if (input) input.files = dt.files;
}

export function renderFileList(inputId, listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = (filesStore[inputId] || []).map((f,i) => `
    <div class="file-item">
      <span>📄</span>
      <span class="file-item-name">${f.name}</span>
      <span class="text-xs text-muted">${(f.size/1024).toFixed(0)}KB</span>
      <a href="#" onclick="removerArquivoSelecionado('${inputId}','${listId}',${i});return false;" style="color:var(--red);font-size:14px;font-weight:bold;margin-left:6px;text-decoration:none" title="Remover arquivo">✕</a>
    </div>`).join('');
}

export function removerArquivoSelecionado(inputId, listId, index) {
  filesStore[inputId] = (filesStore[inputId] || []).filter((_,i) => i !== index);
  syncInputFiles(inputId);
  renderFileList(inputId, listId);
}

export async function downloadAnexo(path, bucket, nome) {
  const { data } = await sb.storage.from(bucket).createSignedUrl(path, 60);
  if (data?.signedUrl) { window.open(data.signedUrl, '_blank'); }
  else { toast('Erro ao baixar arquivo', 'error'); }
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  previewFiles, previewLanFiles, addFiles, removerArquivoSelecionado, downloadAnexo
});
