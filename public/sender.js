import { fetchJson, checkAuthAndSetupSidebar } from './app.js';

let currentUser = null;
let currentRecipients = [];

// DOM Elements
const campaignNameEl = document.getElementById('campaignName');
const senderNameEl = document.getElementById('senderName');
const subjectLineEl = document.getElementById('subjectLine');
const htmlTemplateEl = document.getElementById('htmlTemplate');
const btnLaunchCampaign = document.getElementById('btnLaunchCampaign');
const senderErrorBox = document.getElementById('senderErrorBox');

// SMTP Elements
const smtpHostEl = document.getElementById('smtpHost');
const smtpPortEl = document.getElementById('smtpPort');
const smtpUserEl = document.getElementById('smtpUser');
const smtpPassEl = document.getElementById('smtpPass');

// Audience Elements
const csvDropZone = document.getElementById('csvDropZone');
const audienceFileEl = document.getElementById('audienceFile');
const btnBrowseFile = document.getElementById('btnBrowseFile');
const audiencePreview = document.getElementById('audiencePreview');
const parsedCountEl = document.getElementById('parsedCount');
const btnClearAudience = document.getElementById('btnClearAudience');
const audienceTableBody = document.getElementById('audienceTableBody');

// KPIs
const kpiTotalSent = document.getElementById('kpiTotalSent');
const kpiDeliveryRate = document.getElementById('kpiDeliveryRate');
const kpiOpenRate = document.getElementById('kpiOpenRate');
const kpiClickRate = document.getElementById('kpiClickRate');

// History
const historyTableBody = document.getElementById('historyTableBody');
const btnRefreshHistory = document.getElementById('btnRefreshHistory');

/**
 * Validates basic email formatting via regex
 */
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

/**
 * Renders the preview table of uploaded recipients
 */
const renderAudiencePreview = () => {
  audienceTableBody.innerHTML = '';

  if (currentRecipients.length === 0) {
    audiencePreview.style.display = 'none';
    csvDropZone.style.display = 'block';
    validateForm();
    return;
  }

  csvDropZone.style.display = 'none';
  audiencePreview.style.display = 'block';
  parsedCountEl.innerText = currentRecipients.filter(r => r.valid).length;

  // Show max 100 in preview to avoid DOM lag
  const previewSlice = currentRecipients.slice(0, 100);

  previewSlice.forEach(rec => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <svg width="14" height="14" fill="none" stroke="var(--text-muted)" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          ${rec.email}
        </div>
      </td>
      <td>
        ${rec.valid
        ? '<span class="status-badge valid">Valid</span>'
        : '<span class="status-badge invalid">Invalid Format</span>'}
      </td>
    `;
    audienceTableBody.appendChild(tr);
  });

  if (currentRecipients.length > 100) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="2" style="text-align:center; color:var(--text-muted); font-size:12px;">+ ${currentRecipients.length - 100} more recipients hidden</td>`;
    audienceTableBody.appendChild(tr);
  }

  validateForm();
};

/**
 * Handles CSV parsing using PapaParse
 */
const handleFileUpload = (file) => {
  if (!file) return;

  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    complete: function (results) {
      currentRecipients = [];
      const data = results.data;

      data.forEach(row => {
        // Assume first column with an '@' is the email
        const possibleEmail = row.find(col => col && col.includes('@'));
        if (possibleEmail) {
          const cleanEmail = possibleEmail.trim().toLowerCase();
          currentRecipients.push({
            email: cleanEmail,
            valid: isValidEmail(cleanEmail)
          });
        }
      });

      renderAudiencePreview();
    }
  });
};

// --- DRAG & DROP LOGIC ---
btnBrowseFile.addEventListener('click', () => audienceFileEl.click());

audienceFileEl.addEventListener('change', (e) => {
  handleFileUpload(e.target.files[0]);
});

csvDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  csvDropZone.classList.add('dragover');
});

csvDropZone.addEventListener('dragleave', () => {
  csvDropZone.classList.remove('dragover');
});

csvDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  csvDropZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

btnClearAudience.addEventListener('click', () => {
  currentRecipients = [];
  audienceFileEl.value = '';
  renderAudiencePreview();
});

// --- MULTI-SMTP PREMIUM/ADMIN LOGIC ---
let canUseMultiSmtp = false;
let savedSmtpAccounts = [];
const standardSmtpBlock = document.getElementById('standardSmtpBlock');
const adminSmtpBlock = document.getElementById('adminSmtpBlock');
const smtpAccountsList = document.getElementById('smtpAccountsList');
const scheduleTimezoneEl = document.getElementById('scheduleTimezone');
const scheduleStartEl = document.getElementById('scheduleStart');
const scheduleEndEl = document.getElementById('scheduleEnd');

async function initSmtpUI() {
  try {
    const me = await fetchJson('/api/me');
    const isPremiumOrAdvance = me && (me.subscriptionPlan === 'premium' || me.subscriptionPlan === 'advance' || me.isAdmin);

    if (isPremiumOrAdvance) {
      canUseMultiSmtp = true;
      standardSmtpBlock.style.display = 'none';
      adminSmtpBlock.style.display = 'block';
      
      // Populate Timezones
      if (Intl.supportedValuesOf) {
        const timezones = Intl.supportedValuesOf('timeZone');
        const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        scheduleTimezoneEl.innerHTML = timezones.map(tz => `<option value="${tz}" ${tz === defaultTz ? 'selected' : ''}>${tz}</option>`).join('');
      } else {
        scheduleTimezoneEl.innerHTML = '<option value="UTC">UTC</option>';
      }

      await loadSmtpAccounts();
    }
  } catch (err) {
    console.error("Failed to init SMTP UI:", err);
  }
}

async function loadSmtpAccounts() {
  try {
    const data = await fetchJson('/api/sender/smtp');
    savedSmtpAccounts = data.accounts || [];
    renderSmtpList();
    validateForm();
  } catch (err) {
    smtpAccountsList.innerHTML = `<div class="text-red-500 text-xs py-2">Failed to load accounts.</div>`;
  }
}

function renderSmtpList() {
  if (savedSmtpAccounts.length === 0) {
    smtpAccountsList.innerHTML = `<div class="text-xs text-slate-500 italic py-2 text-center bg-white border border-slate-200 rounded">No saved SMTP accounts yet. Add one above.</div>`;
    return;
  }

  smtpAccountsList.innerHTML = savedSmtpAccounts.map(acc => `
    <label class="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded hover:border-blue-400 cursor-pointer transition-colors ${acc.restingUntil && new Date(acc.restingUntil) > new Date() ? 'opacity-50 grayscale' : ''}">
      <div class="flex items-center gap-3">
        <input type="checkbox" name="selectedSmtps" value="${acc.id}" class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" onchange="validateForm()" ${acc.restingUntil && new Date(acc.restingUntil) > new Date() ? 'disabled' : ''}>
        <div class="flex flex-col">
          <span class="text-xs font-semibold text-slate-800">${acc.user}</span>
          <span class="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 w-fit mt-0.5 font-mono">${acc.host}:${acc.port}</span>
        </div>
      </div>
      ${acc.restingUntil && new Date(acc.restingUntil) > new Date()
      ? `<span class="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full flex items-center gap-1 border border-amber-200"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Resting</span>`
      : `<button type="button" onclick="deleteSmtp('${acc.id}'); event.preventDefault(); event.stopPropagation();" class="text-slate-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors cursor-pointer" title="Delete Account"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>`
    }
    </label>
  `).join('');
}

async function submitNewSmtp(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveSmtp');
  const errEl = document.getElementById('addSmtpError');
  errEl.textContent = '';
  btn.disabled = true;
  btn.innerHTML = 'Verifying...';

  try {
    const payload = {
      host: document.getElementById('newSmtpHost').value.trim(),
      port: document.getElementById('newSmtpPort').value.trim(),
      user: document.getElementById('newSmtpUser').value.trim(),
      pass: document.getElementById('newSmtpPass').value.trim()
    };

    const res = await fetchJson('/api/sender/smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.success) {
      document.getElementById('addSmtpFormObj').reset();
      document.getElementById('addSmtpFormObj').style.display = 'none';
      await loadSmtpAccounts();
    } else {
      errEl.textContent = res.error || 'Failed to add account.';
    }
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Verify & Save';
  }
}

async function deleteSmtp(id) {
  if (!confirm('Delete this SMTP account?')) return;
  try {
    await fetchJson(`/api/sender/smtp/${id}`, { method: 'DELETE' });
    await loadSmtpAccounts();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

// Expose for inline onclick handlers in sender.html
window.submitNewSmtp = submitNewSmtp;
window.deleteSmtp = deleteSmtp;

// --- FORM VALIDATION ---
const validateForm = () => {
  const hasValidRecipients = currentRecipients.some(r => r.valid);

  let isConfigFilled = campaignNameEl.value.trim() &&
    senderNameEl.value.trim() &&
    subjectLineEl.value.trim() &&
    htmlTemplateEl.value.trim();

  if (canUseMultiSmtp) {
    const checkedSmtps = document.querySelectorAll('input[name="selectedSmtps"]:checked');
    isConfigFilled = isConfigFilled && checkedSmtps.length > 0;
  } else {
    isConfigFilled = isConfigFilled &&
      smtpHostEl.value.trim() &&
      smtpPortEl.value.trim() &&
      smtpUserEl.value.trim() &&
      smtpPassEl.value.trim();
  }

  btnLaunchCampaign.disabled = !(hasValidRecipients && isConfigFilled);
};

// Initialize Admin UI on Load
initSmtpUI();

[campaignNameEl, senderNameEl, subjectLineEl, htmlTemplateEl, smtpHostEl, smtpPortEl, smtpUserEl, smtpPassEl].forEach(el => {
  el.addEventListener('input', validateForm);
});

btnLaunchCampaign.addEventListener('click', async () => {
  btnLaunchCampaign.disabled = true;
  senderErrorBox.style.display = 'none';

  const validEmails = currentRecipients.filter(r => r.valid).map(r => r.email);

  let payload = {
    campaignName: campaignNameEl.value.trim(),
    senderName: senderNameEl.value.trim(),
    subject: subjectLineEl.value.trim(),
    htmlContent: htmlTemplateEl.value.trim(),
    recipients: validEmails
  };

  if (canUseMultiSmtp) {
    const checked = Array.from(document.querySelectorAll('input[name="selectedSmtps"]:checked')).map(el => el.value);
    payload.smtpAccountIds = checked;
    payload.timezone = scheduleTimezoneEl.value;
    payload.startTime = scheduleStartEl.value;
    payload.endTime = scheduleEndEl.value;
  } else {
    payload.smtpHost = smtpHostEl.value.trim();
    payload.smtpPort = parseInt(smtpPortEl.value.trim(), 10);
    payload.smtpUser = smtpUserEl.value.trim();
    payload.smtpPass = smtpPassEl.value.trim();
  }

  try {
    btnLaunchCampaign.innerHTML = `<svg width="18" height="18" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Launching...`;

    // 1. Dispatch the payload to the Native SMTP Endpoint
    const result = await fetchJson('/api/sender/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (result && result.campaignId) {
      // 2. Mock immediate initial KPI load since it was just accepted into the Delivery Queue
      kpiTotalSent.innerText = validEmails.length;
      kpiDeliveryRate.innerText = 'Queued';
      kpiOpenRate.innerText = '0.0%';
      kpiClickRate.innerText = '0.0%';

      senderErrorBox.className = 'status-box success-box';
      senderErrorBox.innerHTML = `<strong>Success!</strong> ${result.message} Check back shortly for delivery metrics.`;
      senderErrorBox.style.display = 'block';

      audiencePreview.style.display = 'none';
      csvDropZone.style.display = 'block';
      currentRecipients = [];
      campaignNameEl.value = '';
      subjectLineEl.value = '';
      htmlTemplateEl.value = '';

      btnLaunchCampaign.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Launch Campaign`;

      // Refresh KPIs and History after launch
      loadKPIs();
    }

  } catch (error) {
    senderErrorBox.className = 'error-box';
    senderErrorBox.innerHTML = `<strong>Launch Failed:</strong><br>${error.message}`;
    senderErrorBox.style.display = 'block';

    btnLaunchCampaign.disabled = false;
    btnLaunchCampaign.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Launch Campaign`;
  }
});


document.addEventListener('DOMContentLoaded', () => {
  // Re-bind just in case they fired too early
  const reBtnBrowse = document.getElementById('btnBrowseFile');
  const reAudienceFile = document.getElementById('audienceFile');
  const reCsvDropZone = document.getElementById('csvDropZone');
  const reBtnClear = document.getElementById('btnClearAudience');
  const reBtnLaunch = document.getElementById('btnLaunchCampaign');

  if (reBtnBrowse && reAudienceFile) {
    // Clear any old listeners if possible by cloning
    const newBtnBrowse = reBtnBrowse.cloneNode(true);
    reBtnBrowse.parentNode.replaceChild(newBtnBrowse, reBtnBrowse);

    newBtnBrowse.addEventListener('click', (e) => {
      e.preventDefault();
      reAudienceFile.click();
    });

    reAudienceFile.addEventListener('change', (e) => {
      handleFileUpload(e.target.files[0]);
    });
  }
});

// --- KPI DATA FETCHING ---
const loadKPIs = async () => {
  try {
    const data = await fetchJson('/api/sender/analytics/account');
    if (data && data.metrics) {
      kpiTotalSent.innerText = data.rawCounts.sent.toLocaleString();
      kpiDeliveryRate.innerText = data.metrics.deliveryRate;
      kpiOpenRate.innerText = data.metrics.openRate;
      kpiClickRate.innerText = data.metrics.clickThroughRate;
    }
  } catch (err) {
    console.error("Failed to load KPIs:", err);
  }
  // Also load history
  loadHistory();
};

const loadHistory = async () => {
  try {
    const data = await fetchJson('/api/sender/analytics/history');
    if (!data || !data.history) return;

    if (!historyTableBody) return;
    historyTableBody.innerHTML = '';

    if (data.history.length === 0) {
      historyTableBody.innerHTML = `<tr><td colspan="6" class="px-5 py-6 text-center text-brand-muted">No campaigns found</td></tr>`;
      return;
    }

    data.history.forEach(camp => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition-colors';

      let statusBadge = '';
      if (camp.status === 'completed') {
        statusBadge = '<span class="status-badge valid">Completed</span>';
      } else if (camp.status === 'aborted') {
        statusBadge = '<span class="status-badge invalid">Aborted</span>';
      } else if (camp.status === 'sending') {
        statusBadge = '<span class="status-badge pending">Sending...</span>';
      } else {
        statusBadge = `<span class="status-badge">${camp.status}</span>`;
      }

      const dateStr = new Date(camp.createdAt).toLocaleDateString() + ' ' + new Date(camp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let downloadsHtml = '';
      if (camp.status === 'completed' || camp.status === 'aborted') {
        const sentFile = camp.sentReportFile || null;
        const failedFile = camp.failedReportFile || null;
        downloadsHtml = `
          <div class="mt-2 flex gap-2">
            ${sentFile ? `<a href="/${sentFile}" target="_blank" class="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 hover:bg-emerald-100 flex items-center gap-1 transition-colors"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Sent TXT</a>` : ''}
            ${failedFile ? `<a href="/${failedFile}" target="_blank" class="text-[10px] font-medium text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100 hover:bg-red-100 flex items-center gap-1 transition-colors"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Failed TXT</a>` : ''}
          </div>
        `;
      }

      tr.innerHTML = `
        <td class="px-5 py-4 font-medium text-brand-text">${camp.name}</td>
        <td class="px-5 py-4">${statusBadge}</td>
        <td class="px-5 py-4 text-center font-mono">${camp.deliveredCount || 0}</td>
        <td class="px-5 py-4 text-center font-mono">${camp.bouncedCount || 0}</td>
        <td class="px-5 py-4 text-brand-muted text-xs">${dateStr}</td>
        <td class="px-5 py-4">
          ${camp.abortReason ? `<div class="text-xs text-red-500 max-w-xs break-words">${camp.abortReason}</div>` : `<span class="text-xs text-brand-muted">No errors logged</span>`}
          ${downloadsHtml}
        </td>
      `;
      historyTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load history:", err);
    if (historyTableBody) {
      historyTableBody.innerHTML = `<tr><td colspan="6" class="px-5 py-6 text-center text-red-500">Failed to load history</td></tr>`;
    }
  }
};

if (btnRefreshHistory) {
  btnRefreshHistory.addEventListener('click', loadKPIs);
}

// --- INIT ---
async function init() {
  currentUser = await checkAuthAndSetupSidebar();

  if (currentUser && currentUser.subscriptionPlan !== 'premium') {
    // If somehow a non-premium user accesses this page despite locks
    window.location.href = "/dashboard.html";
    return;
  }

  // Hydrate metrics on page load
  await loadKPIs();
}

init();
