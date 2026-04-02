const params = new URLSearchParams(window.location.search);
const type = params.get('type') || 'sender';
const entityId = params.get('id') || '';
let mode = params.get('mode') === 'edit' ? 'edit' : 'view';

const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const backLink = document.getElementById('backLink');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const saveBtn = document.getElementById('saveBtn');
const alertBox = document.getElementById('alertBox');
const statusPill = document.getElementById('statusPill');

const statSent = document.getElementById('statSent');
const statDeliveryRate = document.getElementById('statDeliveryRate');
const statOpenRate = document.getElementById('statOpenRate');
const statClickRate = document.getElementById('statClickRate');

const campaignNameInput = document.getElementById('campaignNameInput');
const categoryNameInput = document.getElementById('categoryNameInput');
const timezoneInput = document.getElementById('timezoneInput');
const startTimeInput = document.getElementById('startTimeInput');
const endTimeInput = document.getElementById('endTimeInput');
const nichesInput = document.getElementById('nichesInput');
const countryInput = document.getElementById('countryInput');
const citiesInput = document.getElementById('citiesInput');
const smtpHostInput = document.getElementById('smtpHostInput');
const smtpPortInput = document.getElementById('smtpPortInput');
const smtpUserInput = document.getElementById('smtpUserInput');
const smtpPassInput = document.getElementById('smtpPassInput');
const smtpAccountIdsInput = document.getElementById('smtpAccountIdsInput');
const categoryFieldWrap = document.getElementById('categoryFieldWrap');
const nichesFieldWrap = document.getElementById('nichesFieldWrap');
const locationFieldWrap = document.getElementById('locationFieldWrap');
const recipientList = document.getElementById('recipientList');
const eventList = document.getElementById('eventList');
const fileList = document.getElementById('fileList');
const filePreview = document.getElementById('filePreview');
const previewTitle = document.getElementById('previewTitle');
const previewDownloadLink = document.getElementById('previewDownloadLink');
const sequenceEditor = document.getElementById('sequenceEditor');
const addStepBtn = document.getElementById('addStepBtn');

const state = {
  detail: null,
  sequences: [],
  files: []
};

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function showAlert(message, tone = 'info') {
  const palette = {
    info: 'border-slate-200 bg-white text-slate-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-red-200 bg-red-50 text-red-700'
  };
  alertBox.className = `mb-4 rounded-md border px-4 py-3 text-sm ${palette[tone] || palette.info}`;
  alertBox.textContent = message;
  alertBox.classList.remove('hidden');
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function setReadonly(readonly) {
  const fields = [
    campaignNameInput,
    categoryNameInput,
    timezoneInput,
    startTimeInput,
    endTimeInput,
    nichesInput,
    countryInput,
    citiesInput,
    smtpHostInput,
    smtpPortInput,
    smtpUserInput,
    smtpPassInput,
    smtpAccountIdsInput
  ];
  fields.forEach((field) => {
    field.disabled = readonly;
    field.classList.toggle('bg-slate-100', readonly);
  });
  categoryNameInput.disabled = true;
  addStepBtn.disabled = readonly;
  saveBtn.disabled = readonly;
  modeToggleBtn.textContent = readonly ? 'Switch To Edit' : 'Switch To View';
}

function setCampaignEditorDisabled(disabled) {
  const fields = [
    campaignNameInput,
    timezoneInput,
    startTimeInput,
    endTimeInput,
    smtpHostInput,
    smtpPortInput,
    smtpUserInput,
    smtpPassInput,
    smtpAccountIdsInput
  ];
  fields.forEach((field) => {
    field.disabled = disabled || mode === 'view';
    field.classList.toggle('bg-slate-100', disabled || mode === 'view');
  });
  addStepBtn.disabled = disabled || mode === 'view';
  sequenceEditor.querySelectorAll('input, textarea, button').forEach((el) => {
    if (el === addStepBtn) return;
    el.disabled = disabled || mode === 'view';
    el.classList.toggle('bg-slate-100', disabled || mode === 'view');
  });
}

function setBackLink() {
  backLink.href = type === 'job' ? '/dashboard.html' : '/sender.html';
  backLink.textContent = type === 'job' ? 'Back to Dashboard' : 'Back to Sender';
  if (type !== 'job') {
    categoryFieldWrap.style.display = 'none';
    nichesFieldWrap.style.display = 'none';
    locationFieldWrap.style.display = 'none';
  }
}

function applyHeader(detail) {
  const name = type === 'job'
    ? (detail.job?.campaign?.name || detail.job.campaignName || `Job ${detail.job.id}`)
    : detail.campaign.name;
  pageTitle.textContent = name;
  pageSubtitle.textContent = type === 'job'
    ? `Scraper job ${detail.job.id}${detail.job?.campaign ? ' with live auto-mail settings' : ''}`
    : `Sender campaign ${detail.campaign.id}`;
}

function applyStats(campaign) {
  const rawCounts = campaign?.rawCounts || {};
  const metrics = campaign?.metrics || {};
  statSent.textContent = rawCounts.sent || 0;
  statDeliveryRate.textContent = formatPercent(metrics.deliveryRate);
  statOpenRate.textContent = formatPercent(metrics.openRate);
  statClickRate.textContent = formatPercent(metrics.clickThroughRate);
  const status = campaign?.status || state.detail?.job?.status || 'unknown';
  statusPill.textContent = status;
  statusPill.className = 'text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-600';
  if (status === 'completed') statusPill.className = 'text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700';
  if (status === 'sending' || status === 'running') statusPill.className = 'text-xs font-semibold px-3 py-1 rounded-full bg-amber-50 text-amber-700';
  if (status === 'failed' || status === 'aborted' || status === 'stopped') statusPill.className = 'text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-red-700';
}

function renderRecipients(campaign) {
  const recipients = campaign?.recipients || [];
  if (recipients.length === 0) {
    recipientList.innerHTML = '<div class="p-5 text-sm text-slate-500">No recipients recorded yet.</div>';
    return;
  }
  recipientList.innerHTML = recipients.map((recipient) => `
    <div class="px-5 py-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="font-medium text-sm">${recipient.email}</div>
          <div class="text-xs text-slate-500">Step ${recipient.currentStep || 0} • Next send ${recipient.nextSendAt || 'now'}</div>
        </div>
        <div class="text-right">
          <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">${recipient.status}</div>
          ${recipient.error ? `<div class="text-xs text-red-500 mt-1 max-w-[220px]">${recipient.error}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function renderEvents(campaign) {
  const events = campaign?.recentEvents || [];
  if (events.length === 0) {
    eventList.innerHTML = '<div class="p-5 text-sm text-slate-500">No tracking events yet.</div>';
    return;
  }
  eventList.innerHTML = events.map((event) => `
    <div class="px-5 py-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="font-medium text-sm">${event.eventType}</div>
          <div class="text-xs text-slate-500">${event.email || 'Unknown recipient'}${event.url ? ` • ${event.url}` : ''}</div>
        </div>
        <div class="text-xs text-slate-500">${new Date(event.timestamp).toLocaleString()}</div>
      </div>
    </div>
  `).join('');
}

function renderPreviewPlaceholder(message = 'Select a file above to preview it here.') {
  previewTitle.textContent = 'No file selected';
  previewTitle.className = 'text-base font-semibold text-slate-500';
  previewDownloadLink.classList.add('hidden');
  previewDownloadLink.href = '#';
  filePreview.className = 'max-h-[480px] overflow-auto p-5 text-sm text-slate-500';
  filePreview.textContent = message;
}

function renderCsvPreview(text) {
  const lines = text.split('\n').filter((row) => row.trim());
  if (lines.length === 0) {
    filePreview.className = 'max-h-[480px] overflow-auto p-5 text-sm text-slate-500';
    filePreview.innerHTML = 'File is empty.';
    return;
  }

  const tableRows = lines.map((row, index) => {
    const cols = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || row.split(',');
    const cleanCols = cols.map((col) => col.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (index === 0) {
      return `<tr>${cleanCols.map((col) => `<th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 bg-slate-50">${col}</th>`).join('')}</tr>`;
    }
    return `<tr>${cleanCols.map((col) => `<td class="px-3 py-2 text-sm text-slate-700 border-b border-slate-100 align-top">${col}</td>`).join('')}</tr>`;
  });

  filePreview.className = 'max-h-[480px] overflow-auto';
  filePreview.innerHTML = `<table class="min-w-full">${tableRows.join('')}</table>`;
  filePreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTextPreview(text) {
  filePreview.className = 'max-h-[480px] overflow-auto p-5';
  const pre = document.createElement('pre');
  pre.className = 'm-0 text-xs text-slate-800 whitespace-pre-wrap break-words font-mono';
  pre.textContent = text;
  filePreview.innerHTML = '';
  filePreview.appendChild(pre);
  filePreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function previewFile(url, name) {
  try {
    previewTitle.textContent = `Loading ${name}...`;
    previewTitle.className = 'text-base font-semibold text-slate-700';
    filePreview.className = 'max-h-[480px] overflow-auto p-5 text-sm text-slate-500';
    filePreview.textContent = 'Loading file...';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load file');
    const text = await res.text();
    previewTitle.textContent = name;
    previewTitle.className = 'text-base font-semibold text-slate-900';
    const activeFile = state.files.find((file) => file.name === name);
    previewDownloadLink.href = activeFile?.downloadUrl || url;
    previewDownloadLink.classList.remove('hidden');
    if (name.toLowerCase().endsWith('.csv')) {
      renderCsvPreview(text);
    } else {
      renderTextPreview(text);
    }
  } catch (error) {
    showAlert(error.message, 'error');
  }
}

function renderFiles(detail) {
  const rows = [];
  if (type === 'job') {
    const priorityFiles = ['google_maps_all.csv', 'all_phones.txt', 'all_emails.txt'];
    const files = detail.job?.files || [];
    const mainFiles = priorityFiles.filter((name) => files.includes(name));
    const fallbackFiles = mainFiles.length > 0 ? mainFiles : files.slice(0, 3);
    for (const file of fallbackFiles) {
      rows.push({
        name: file,
        viewUrl: `/api/jobs/${detail.job.id}/files/${encodeURIComponent(file)}/raw`,
        downloadUrl: `/api/jobs/${detail.job.id}/files/${encodeURIComponent(file)}`
      });
    }
  } else {
    const campaign = detail.campaign || {};
    if (campaign.sentReportFile) {
      rows.push({
        name: campaign.sentReportFile,
        viewUrl: `/${campaign.sentReportFile}`,
        downloadUrl: `/${campaign.sentReportFile}`
      });
    }
    if (campaign.failedReportFile) {
      rows.push({
        name: campaign.failedReportFile,
        viewUrl: `/${campaign.failedReportFile}`,
        downloadUrl: `/${campaign.failedReportFile}`
      });
    }
  }

  state.files = rows;

  if (rows.length === 0) {
    fileList.innerHTML = '<div class="p-5 text-sm text-slate-500">No generated files yet.</div>';
    renderPreviewPlaceholder();
    return;
  }

  fileList.innerHTML = rows.map((file, index) => `
    <div class="px-5 py-3 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="font-medium text-sm break-all">${file.name}</div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button type="button" onclick="window.previewWorkbenchFile(${index})" class="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium hover:bg-slate-100">View</button>
        <a href="${file.downloadUrl}" target="_blank" class="px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100">Download</a>
      </div>
    </div>
  `).join('');

  const firstFile = rows[0];
  if (firstFile) {
    previewFile(firstFile.viewUrl, firstFile.name);
  } else {
    renderPreviewPlaceholder();
  }
}

window.previewWorkbenchFile = function previewWorkbenchFile(index) {
  const file = state.files[index];
  if (!file) {
    renderPreviewPlaceholder('File metadata is missing.');
    return;
  }
  previewFile(file.viewUrl, file.name);
};

function collectSequenceState() {
  return [...sequenceEditor.querySelectorAll('[data-seq-index]')].map((card) => {
    const index = Number(card.dataset.seqIndex);
    return {
      delayDays: Number(card.querySelector('[data-field="delayDays"]').value || 0),
      senderName: card.querySelector('[data-field="senderName"]').value.trim(),
      subject: card.querySelector('[data-field="subject"]').value.trim(),
      htmlContent: card.querySelector('[data-field="htmlContent"]').value.trim(),
      templateId: state.sequences[index]?.templateId || ''
    };
  });
}

function renderSequences() {
  if (state.sequences.length === 0) {
    sequenceEditor.innerHTML = '<div class="text-sm text-slate-500">No follow-up steps configured.</div>';
    return;
  }

  sequenceEditor.innerHTML = state.sequences.map((step, index) => `
    <div class="rounded-lg border border-slate-200 p-4 bg-slate-50" data-seq-index="${index}">
      <div class="flex items-center justify-between gap-3 mb-3">
        <div class="text-sm font-semibold">Step ${index + 1}</div>
        <button ${mode === 'view' ? 'disabled' : ''} type="button" data-remove-index="${index}" class="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40">Delete Step</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label class="block">
          <span class="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Delay Days</span>
          <input data-field="delayDays" type="number" min="0" value="${step.delayDays || 0}" class="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white" ${mode === 'view' ? 'disabled' : ''} />
        </label>
        <label class="block md:col-span-1">
          <span class="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Sender Name</span>
          <input data-field="senderName" type="text" value="${(step.senderName || '').replace(/"/g, '&quot;')}" class="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white" ${mode === 'view' ? 'disabled' : ''} />
        </label>
        <label class="block md:col-span-1">
          <span class="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Subject</span>
          <input data-field="subject" type="text" value="${(step.subject || '').replace(/"/g, '&quot;')}" class="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white" ${mode === 'view' ? 'disabled' : ''} />
        </label>
      </div>
      <label class="block mt-3">
        <span class="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">HTML Template</span>
        <textarea data-field="htmlContent" rows="6" class="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white font-mono" ${mode === 'view' ? 'disabled' : ''}>${step.htmlContent || ''}</textarea>
      </label>
    </div>
  `).join('');

  sequenceEditor.querySelectorAll('[data-remove-index]').forEach((button) => {
    button.addEventListener('click', () => {
      state.sequences = collectSequenceState();
      state.sequences.splice(Number(button.dataset.removeIndex), 1);
      renderSequences();
    });
  });
}

function fillForm(detail) {
  const campaign = type === 'job' ? detail.job.campaign : detail.campaign;
  const config = campaign?.config || {};
  const jobParams = detail.job?.params || {};

  campaignNameInput.value = campaign?.name || '';
  categoryNameInput.value = detail.job?.category?.name || 'Not linked to a scraper campaign';
  timezoneInput.value = config.timezone || '';
  startTimeInput.value = config.startTime || '';
  endTimeInput.value = config.endTime || '';
  nichesInput.value = (jobParams.niches || []).join('\n');
  countryInput.value = jobParams.country || '';
  citiesInput.value = (jobParams.cities || []).join(', ');
  smtpHostInput.value = config.smtpHost || '';
  smtpPortInput.value = config.smtpPort || '';
  smtpUserInput.value = config.smtpUser || '';
  smtpPassInput.value = config.smtpPass || '';
  smtpAccountIdsInput.value = (config.smtpAccountIds || []).join(', ');
  state.sequences = Array.isArray(config.sequences) ? config.sequences.map((step) => ({ ...step })) : [];
  renderSequences();
}

function buildPayload() {
  const payload = {
    campaignName: campaignNameInput.value.trim(),
    timezone: timezoneInput.value.trim(),
    startTime: startTimeInput.value,
    endTime: endTimeInput.value,
    smtpHost: smtpHostInput.value.trim(),
    smtpPort: smtpPortInput.value ? Number(smtpPortInput.value) : null,
    smtpUser: smtpUserInput.value.trim(),
    smtpPass: smtpPassInput.value.trim(),
    smtpAccountIds: smtpAccountIdsInput.value.split(',').map((item) => item.trim()).filter(Boolean),
    sequences: collectSequenceState()
  };

  if (type === 'job') {
    payload.niches = nichesInput.value.split('\n').map((item) => item.trim()).filter(Boolean);
    payload.country = countryInput.value.trim();
    payload.cities = citiesInput.value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return payload;
}

async function loadDetail() {
  if (!entityId) {
    showAlert('Missing campaign or job id.', 'error');
    setReadonly(true);
    return;
  }

  const url = type === 'job' ? `/api/jobs/${entityId}` : `/api/sender/campaigns/${entityId}`;
  const payload = await fetchJson(url);
  state.detail = payload;
  const campaign = type === 'job' ? payload.job.campaign : payload.campaign;
  applyHeader(payload);
  applyStats(campaign || null);
  fillForm(payload);
  renderRecipients(campaign || null);
  renderEvents(campaign || null);
  renderFiles(payload);
  if (type === 'job' && !campaign) {
    showAlert('This scraper job has no auto-mail campaign attached. Files are available, and you can still edit basic scraper fields. Follow-up settings are unavailable for this job.', 'info');
    modeToggleBtn.disabled = false;
    setReadonly(mode === 'view');
    setCampaignEditorDisabled(true);
  } else {
    modeToggleBtn.disabled = false;
    setReadonly(mode === 'view');
    setCampaignEditorDisabled(false);
  }
}

async function saveChanges() {
  try {
    const payload = buildPayload();
    if (type !== 'job' && !payload.campaignName) {
      throw new Error('Campaign name is required.');
    }
    if ((type !== 'job' || state.detail?.job?.campaign) && !payload.sequences.length) {
      throw new Error('At least one follow-up step is required.');
    }

    saveBtn.disabled = true;
    const url = type === 'job' ? `/api/jobs/${entityId}` : `/api/sender/campaigns/${entityId}`;
    await fetchJson(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showAlert('Changes saved. Future sends will use the updated flow.', 'success');
    await loadDetail();
  } catch (error) {
    showAlert(error.message, 'error');
  } finally {
    saveBtn.disabled = mode === 'view';
  }
}

addStepBtn.addEventListener('click', () => {
  if (sequenceEditor.children.length > 0) {
    state.sequences = collectSequenceState();
  }
  state.sequences.push({ delayDays: 0, senderName: '', subject: '', htmlContent: '', templateId: '' });
  renderSequences();
});

modeToggleBtn.addEventListener('click', () => {
  mode = mode === 'view' ? 'edit' : 'view';
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState({}, '', url.toString());
  setReadonly(mode === 'view');
  renderSequences();
  setCampaignEditorDisabled(type === 'job' && !state.detail?.job?.campaign);
});

saveBtn.addEventListener('click', saveChanges);

setBackLink();
loadDetail().catch((error) => {
  showAlert(error.message, 'error');
  setReadonly(true);
});
