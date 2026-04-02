import { fetchJson, checkAuthAndSetupSidebar, loadAutoMailTemplates, loadSavedSequences, setupTemplateListeners, setupSavedSequenceListeners } from './app.js';

let currentUser = null;
let currentRecipients = [];

// DOM Elements
const campaignNameEl = document.getElementById('campaignName');
const btnLaunchCampaign = document.getElementById('btnLaunchCampaign');
const senderErrorBox = document.getElementById('senderErrorBox');
const modeDirectBtn = document.getElementById('modeDirectBtn');
const modeSequenceBtn = document.getElementById('modeSequenceBtn');
const directMailComposer = document.getElementById('directMailComposer');
const directSenderNameEl = document.getElementById('directSenderName');
const directSubjectEl = document.getElementById('directSubject');
const directHtmlContentEl = document.getElementById('directHtmlContent');
const templateManagerBlock = document.getElementById('templateManagerBlock');
const sequenceBlock = document.getElementById('sequenceBlock');
const savedSequencesContainer = document.getElementById('savedSequencesContainer');
const adminSchedulingBlock = document.getElementById('adminSchedulingBlock');

const sequenceContainer = document.getElementById('sequenceContainer');
const btnAddSequenceStep = document.getElementById('btnAddSequenceStep');

let sequences = []; // Array of { delayDays, subject, htmlContent, senderName }
let sendMode = 'direct';

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

// --- SCRAPER CAMPAIGNS TAB LOGIC ---
let scraperCampaignsData = [];
const scraperCampaignSelect = document.getElementById('scraperCampaignSelect');
const scraperJobsList = document.getElementById('scraperJobsList');
const scraperSummaryBar = document.getElementById('scraperSummaryBar');
const btnLoadScraperEmails = document.getElementById('btnLoadScraperEmails');

window.switchAudienceTab = function(tab) {
  const csvPanel = document.getElementById('tabCsvPanel');
  const scraperPanel = document.getElementById('tabScraperPanel');
  const csvBtn = document.getElementById('tabCsvBtn');
  const scraperBtn = document.getElementById('tabScraperBtn');

  if (tab === 'csv') {
    csvPanel.style.display = 'block';
    scraperPanel.style.display = 'none';
    csvBtn.className = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition-all bg-white shadow-sm text-brand-primary';
    scraperBtn.className = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-slate-500 hover:text-brand-primary';
  } else {
    csvPanel.style.display = 'none';
    scraperPanel.style.display = 'block';
    csvBtn.className = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-slate-500 hover:text-brand-primary';
    scraperBtn.className = 'flex-1 py-1.5 text-xs font-semibold rounded-md transition-all bg-white shadow-sm text-brand-primary';
    loadScraperCampaigns();
  }
};

async function loadScraperCampaigns() {
  if (!scraperCampaignSelect) return;
  scraperCampaignSelect.innerHTML = '<option value="">Loading...</option>';
  scraperJobsList.style.display = 'none';
  btnLoadScraperEmails.style.display = 'none';
  scraperSummaryBar.style.display = 'none';

  try {
    const data = await fetchJson('/api/sender/scraper-campaigns');
    scraperCampaignsData = data.campaigns || [];

    if (scraperCampaignsData.length === 0) {
      scraperCampaignSelect.innerHTML = '<option value="">No scraper campaigns found</option>';
      return;
    }

    scraperCampaignSelect.innerHTML = '<option value="">-- Select a Campaign --</option>' +
      scraperCampaignsData.map(c =>
        `<option value="${c.id}">${c.name} (${c.totalEmails} emails, ${c.jobs.length} jobs)</option>`
      ).join('');
  } catch (err) {
    scraperCampaignSelect.innerHTML = '<option value="">Failed to load campaigns</option>';
  }
}

if (scraperCampaignSelect) {
  scraperCampaignSelect.addEventListener('change', () => {
    const selId = scraperCampaignSelect.value;
    const campaign = scraperCampaignsData.find(c => c.id === selId);

    if (!campaign) {
      scraperJobsList.style.display = 'none';
      btnLoadScraperEmails.style.display = 'none';
      scraperSummaryBar.style.display = 'none';
      return;
    }

    scraperJobsList.innerHTML = campaign.jobs.map(job => {
      const date = new Date(job.createdAt).toLocaleDateString();
      const loc = [job.country, ...(job.states || []).slice(0, 2)].filter(Boolean).join(', ');
      const niches = (job.niches || []).slice(0, 2).join(', ');
      return `
        <label class="flex items-start gap-2.5 p-2.5 border border-slate-100 rounded-lg hover:bg-blue-50/50 cursor-pointer transition-all">
          <input type="checkbox" class="scraper-job-cb mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300" value="${job.id}" data-emails="${job.emailCount}">
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="text-xs font-semibold text-slate-700 truncate">${loc || 'Unknown Location'}</span>
              <span class="text-[10px] font-bold ${job.emailCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 bg-slate-100'} px-1.5 py-0.5 rounded-full whitespace-nowrap">${job.emailCount} emails</span>
            </div>
            <div class="text-[10px] text-slate-500 mt-0.5">${niches ? `Niches: ${niches}` : ''} &bull; ${date} &bull; <span class="capitalize">${job.status}</span></div>
          </div>
        </label>`;
    }).join('');

    scraperJobsList.style.display = 'flex';
    scraperJobsList.style.flexDirection = 'column';

    // Listen for checkbox changes to update summary
    scraperJobsList.querySelectorAll('.scraper-job-cb').forEach(cb => {
      cb.addEventListener('change', updateScraperSummary);
    });

    updateScraperSummary();
  });
}

function updateScraperSummary() {
  const checked = [...scraperJobsList.querySelectorAll('.scraper-job-cb:checked')];
  const totalEmails = checked.reduce((a, cb) => a + parseInt(cb.dataset.emails || 0), 0);

  if (checked.length > 0) {
    scraperSummaryBar.textContent = `${checked.length} job(s) selected · ~${totalEmails} emails will be loaded.`;
    scraperSummaryBar.style.display = 'block';
    btnLoadScraperEmails.style.display = 'flex';
  } else {
    scraperSummaryBar.style.display = 'none';
    btnLoadScraperEmails.style.display = 'none';
  }
}

if (btnLoadScraperEmails) {
  btnLoadScraperEmails.addEventListener('click', async () => {
    const jobIds = [...scraperJobsList.querySelectorAll('.scraper-job-cb:checked')].map(cb => cb.value);
    if (jobIds.length === 0) return;

    const origText = btnLoadScraperEmails.innerHTML;
    btnLoadScraperEmails.disabled = true;
    btnLoadScraperEmails.innerHTML = '<svg width="14" height="14" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg> Loading...';

    try {
      const res = await fetchJson('/api/sender/extract-job-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds })
      });

      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      currentRecipients = (res.emails || []).map(email => ({
        email,
        valid: emailRe.test(email)
      }));

      // Switch back to CSV tab view to show the table
      window.switchAudienceTab('csv');
      // Hide the upload zone since we already have data
      document.getElementById('csvDropZone').style.display = 'none';
      renderAudiencePreview();
    } catch (err) {
      alert('Failed to load emails: ' + err.message);
    } finally {
      btnLoadScraperEmails.disabled = false;
      btnLoadScraperEmails.innerHTML = origText;
    }
  });
}



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
        <input type="checkbox" name="selectedSmtps" value="${acc.id}" class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" onchange="validateForm()">
        <div class="flex flex-col">
          <span class="text-xs font-semibold text-slate-800">${acc.user}</span>
          <span class="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 w-fit mt-0.5 font-mono">${acc.host}:${acc.port}</span>
        </div>
      </div>
      ${acc.restingUntil && new Date(acc.restingUntil) > new Date()
      ? `<span class="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full flex items-center gap-1 border border-amber-200" title="Selected resting emails will wait until the resting period ends before sending"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Resting</span>`
      : `<button type="button" onclick="deleteSmtp('${acc.id}'); event.preventDefault(); event.stopPropagation();" class="text-slate-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors cursor-pointer" title="Delete Account"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>`
    }
    </label>
  `).join('');
}

function getLaunchValidationErrors() {
  const errors = [];
  const hasValidRecipients = currentRecipients.some((r) => r.valid);

  if (!campaignNameEl.value.trim()) {
    errors.push('Campaign name is required.');
  }

  if (!hasValidRecipients) {
    errors.push('Target Audience must contain at least one valid email.');
  }

  if (sendMode === 'direct') {
    if (!directSenderNameEl.value.trim()) errors.push('Direct email sender name is required.');
    if (!directSubjectEl.value.trim()) errors.push('Direct email subject is required.');
    if (!directHtmlContentEl.value.trim()) errors.push('Direct email content is required.');
  } else {
    if (!sequences.length) {
      errors.push('At least one follow-up step is required.');
    } else {
      sequences.forEach((seq, index) => {
        if (!seq.senderName.trim() || !seq.subject.trim() || !seq.htmlContent.trim()) {
          errors.push(`Follow-up step ${index + 1} is incomplete.`);
        }
      });
    }
  }

  if (canUseMultiSmtp) {
    const checkedSmtps = Array.from(document.querySelectorAll('input[name="selectedSmtps"]:checked'));
    if (checkedSmtps.length === 0) {
      errors.push('Select at least one SMTP email.');
    }
  } else {
    if (!smtpHostEl.value.trim()) errors.push('SMTP host is required.');
    if (!smtpPortEl.value.trim()) errors.push('SMTP port is required.');
    if (!smtpUserEl.value.trim()) errors.push('SMTP username is required.');
    if (!smtpPassEl.value.trim()) errors.push('SMTP password is required.');
  }

  return [...new Set(errors)];
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

// --- SEQUENCE BUILDER LOGIC ---
function addSequenceStep() {
    const defaultDepends = sequences.length > 0 ? sequences[sequences.length - 1].id : null;
    sequences.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        templateId: '',
        delayDays: sequences.length === 0 ? 0 : 1,
        dependsOnId: defaultDepends,
        senderName: '',
        subject: '',
        htmlContent: ''
    });
    renderSequences();
    validateForm();
}

window.updateStepTemplate = function(id, templateId) {
    const step = sequences.find(s => s.id === id);
    if (!step) return;
    step.templateId = templateId;
    if (templateId) {
        // Fetch from the already loaded templates if possible, or just let it be.
        // We can get them from window.autoMailTemplates if we export it or just use fetchJson again.
        // But app.js already has them. I'll just use a fetch logic or assume they are globably accessible if I change app.js.
        // Or I can just use the select element to find the data.
        fetchJson(`/api/automail/templates/${templateId}`).then(t => {
            if (t) {
                step.senderName = t.senderName || '';
                step.subject = t.subject || '';
                step.htmlContent = t.htmlContent || '';
                renderSequences();
                validateForm();
            }
        });
    } else {
        step.senderName = '';
        step.subject = '';
        step.htmlContent = '';
        renderSequences();
        validateForm();
    }
};

function removeSequenceStep(id) {
    sequences = sequences.filter(s => s.id !== id);
    if (sequences.length === 0) addSequenceStep();
    else {
        renderSequences();
        validateForm();
    }
}

function updateStepField(id, field, value) {
    const step = sequences.find(s => s.id === id);
    if (step) {
        step[field] = value;
        validateForm();
    }
}

function renderSequences() {
    if (!sequenceContainer) return;
    sequenceContainer.innerHTML = '';
    
    // Get templates for the dropdown
    const templateSelect = document.getElementById('autoMailTemplateSelect');
    const templateOptions = Array.from(templateSelect?.options || [])
        .filter(opt => opt.value !== 'new')
        .map(opt => `<option value="${opt.value}">${opt.textContent}</option>`)
        .join('');

    sequences.forEach((step, index) => {
        const stepIndex = index + 1;
        const isFirst = index === 0;

        const delayHtml = isFirst 
            ? `<div class="text-[10px] font-bold text-slate-500 uppercase tracking-wide bg-slate-100 px-2 py-1 rounded inline-block mb-3">Instantly sent on launch</div>`
            : `<div class="flex items-center gap-2 mb-3 bg-blue-50 p-2 rounded border border-blue-100 w-fit">
                 <label class="text-xs font-bold text-blue-800 uppercase tracking-widest">Wait</label>
                 <input type="number" min="0" value="${step.delayDays}" onchange="window.updateSeqStep('${step.id}', 'delayDays', parseInt(this.value)||0)" oninput="window.updateSeqStep('${step.id}', 'delayDays', parseInt(this.value)||0)" class="w-16 px-2 py-1 border rounded text-sm text-center font-mono border-blue-200 outline-none focus:ring-1 focus:ring-blue-500">
                 <span class="text-xs font-bold text-blue-800 uppercase tracking-widest whitespace-nowrap">Days After</span>
                 <select onchange="window.updateSeqStep('${step.id}', 'dependsOnId', this.value)" class="w-32 px-2 py-1 border rounded text-sm font-mono border-blue-200 outline-none focus:ring-1 focus:ring-blue-500">
                    ${sequences.slice(0, index).map((s, i) => `<option value="${s.id}" ${step.dependsOnId === s.id ? 'selected' : ''}>Step ${i + 1}</option>`).join('')}
                 </select>
               </div>`;

        const html = `
          <div class="relative border border-slate-200 rounded-lg p-3 bg-white shadow-sm mt-4">
            <span class="absolute -top-3 -left-3 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm">${stepIndex}</span>
            <button onclick="window.removeSeqStep('${step.id}')" class="absolute -top-2 -right-2 w-5 h-5 bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-400 rounded-full flex items-center justify-center transition-all bg-white shadow-sm" title="Remove Step">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            
            ${delayHtml}
            
            <div class="space-y-2">
              <select onchange="window.updateStepTemplate('${step.id}', this.value)" class="w-full px-2 py-1.5 border rounded-md text-sm font-mono border-slate-200 bg-slate-50 focus:outline-none">
                <option value="">-- Custom Email --</option>
                ${templateOptions.replace(`value="${step.templateId}"`, `value="${step.templateId}" selected`)}
              </select>

              <div class="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Sender Name (e.g. John Doe)" value="${step.senderName.replace(/"/g, '&quot;')}" oninput="window.updateSeqStep('${step.id}', 'senderName', this.value)" class="w-full px-2 py-1 border rounded text-sm border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-primary">
                <input type="text" placeholder="Email Subject" value="${step.subject.replace(/"/g, '&quot;')}" oninput="window.updateSeqStep('${step.id}', 'subject', this.value)" class="w-full px-2 py-1 border rounded text-sm border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-primary">
              </div>
              <textarea placeholder="HTML Email Content" rows="${isFirst ? 4 : 2}" oninput="window.updateSeqStep('${step.id}', 'htmlContent', this.value)" class="w-full px-2 py-1 border rounded text-xs font-mono border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-primary">${step.htmlContent}</textarea>
            </div>
          </div>
        `;
        
        sequenceContainer.insertAdjacentHTML('beforeend', html);
    });
}

function compileSequencePayload(seqs) {
    if(!seqs || seqs.length === 0) return [];
    const absDays = new Map();
    absDays.set(seqs[0].id, 0);
    seqs[0]._absoluteDays = 0;
    
    for (let i = 1; i < seqs.length; i++) {
        const s = seqs[i];
        const dependsOnAbs = absDays.has(s.dependsOnId) ? absDays.get(s.dependsOnId) : 0;
        const total = dependsOnAbs + (parseInt(s.delayDays) || 0);
        absDays.set(s.id, total);
        s._absoluteDays = total;
    }

    const sorted = [...seqs].map(s => ({...s})).sort((a, b) => a._absoluteDays - b._absoluteDays);

    const payload = [];
    let currentAbs = 0;
    for (const s of sorted) {
        let relativeDelay = s._absoluteDays - currentAbs;
        if(relativeDelay < 0) relativeDelay = 0;
        payload.push({
            delayDays: relativeDelay,
            templateId: s.templateId || '',
            senderName: s.senderName.trim(),
            subject: s.subject.trim(),
            htmlContent: s.htmlContent.trim()
        });
        currentAbs += relativeDelay;
    }
    return payload;
}

// Attach globally for inline HTML
window.removeSeqStep = removeSequenceStep;
window.updateSeqStep = updateStepField;

if (btnAddSequenceStep) {
    btnAddSequenceStep.addEventListener('click', addSequenceStep);
}

// --- FORM VALIDATION ---
const validateForm = () => {
  const errors = getLaunchValidationErrors();
  btnLaunchCampaign.disabled = false;
  btnLaunchCampaign.classList.toggle('opacity-80', errors.length > 0);
};

window.validateForm = validateForm;

function applySendModeUI() {
  const isDirect = sendMode === 'direct';
  directMailComposer.style.display = isDirect ? 'block' : 'none';
  templateManagerBlock.style.display = isDirect ? 'none' : 'block';
  sequenceBlock.style.display = isDirect ? 'none' : 'block';
  if (savedSequencesContainer) savedSequencesContainer.style.display = isDirect ? 'none' : 'flex';
  if (adminSchedulingBlock) adminSchedulingBlock.style.display = isDirect ? 'none' : '';

  modeDirectBtn.className = isDirect
    ? 'px-3 py-2 rounded-md border border-brand-primary/30 bg-brand-primary/10 text-brand-primary text-xs font-semibold transition-colors'
    : 'px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-500 text-xs font-semibold transition-colors';
  modeSequenceBtn.className = !isDirect
    ? 'px-3 py-2 rounded-md border border-brand-primary/30 bg-brand-primary/10 text-brand-primary text-xs font-semibold transition-colors'
    : 'px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-500 text-xs font-semibold transition-colors';

  validateForm();
}

function buildLaunchSequences() {
  if (sendMode === 'direct') {
    return [{
      delayDays: 0,
      senderName: directSenderNameEl.value.trim(),
      subject: directSubjectEl.value.trim(),
      htmlContent: directHtmlContentEl.value.trim(),
      templateId: ''
    }];
  }

  return compileSequencePayload(sequences);
}

// Initialize Admin UI on Load
initSmtpUI();

[campaignNameEl, smtpHostEl, smtpPortEl, smtpUserEl, smtpPassEl, directSenderNameEl, directSubjectEl, directHtmlContentEl].forEach(el => {
  if (el) el.addEventListener('input', validateForm);
});

modeDirectBtn?.addEventListener('click', () => {
  sendMode = 'direct';
  if (!directSenderNameEl.value.trim() && sequences[0]?.senderName) directSenderNameEl.value = sequences[0].senderName;
  if (!directSubjectEl.value.trim() && sequences[0]?.subject) directSubjectEl.value = sequences[0].subject;
  if (!directHtmlContentEl.value.trim() && sequences[0]?.htmlContent) directHtmlContentEl.value = sequences[0].htmlContent;
  applySendModeUI();
});

modeSequenceBtn?.addEventListener('click', () => {
  sendMode = 'sequence';
  if (sequences.length === 0) {
    sequences = [{
      id: Date.now().toString(),
      templateId: '',
      delayDays: 0,
      dependsOnId: null,
      senderName: directSenderNameEl.value.trim(),
      subject: directSubjectEl.value.trim(),
      htmlContent: directHtmlContentEl.value.trim()
    }];
    renderSequences();
  }
  applySendModeUI();
});

// Initialize with one step
if (sequences.length === 0) {
    addSequenceStep();
}

applySendModeUI();

btnLaunchCampaign.addEventListener('click', async () => {
  try {
    const validationErrors = getLaunchValidationErrors();
    if (validationErrors.length > 0) {
      senderErrorBox.className = 'error-box';
      senderErrorBox.innerHTML = `<strong>Missing Information:</strong><br>${validationErrors.join('<br>')}`;
      senderErrorBox.style.display = 'block';
      return;
    }

    btnLaunchCampaign.disabled = true;
    senderErrorBox.style.display = 'none';

    const validEmails = currentRecipients.filter(r => r.valid).map(r => r.email);
    const payload = {
      campaignName: campaignNameEl.value.trim(),
      sequences: buildLaunchSequences(),
      recipients: validEmails
    };

    if (canUseMultiSmtp) {
      const checked = Array.from(document.querySelectorAll('input[name="selectedSmtps"]:checked')).map(el => el.value);
      payload.smtpAccountIds = checked;
      if (sendMode !== 'direct') {
        payload.timezone = scheduleTimezoneEl?.value || 'UTC';
        payload.startTime = scheduleStartEl?.value || '09:00';
        payload.endTime = scheduleEndEl?.value || '17:00';
      }
    } else {
      payload.smtpHost = smtpHostEl.value.trim();
      payload.smtpPort = parseInt(smtpPortEl.value.trim(), 10);
      payload.smtpUser = smtpUserEl.value.trim();
      payload.smtpPass = smtpPassEl.value.trim();
    }

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
      directSenderNameEl.value = '';
      directSubjectEl.value = '';
      directHtmlContentEl.value = '';
      sequences = [];
      addSequenceStep();
      sendMode = 'direct';
      applySendModeUI();

      // Refresh KPIs and History after launch
      loadKPIs();
      loadHistory();
    }

  } catch (error) {
    senderErrorBox.className = 'error-box';
    senderErrorBox.innerHTML = `<strong>Launch Failed:</strong><br>${error.message}`;
    senderErrorBox.style.display = 'block';
  } finally {
    btnLaunchCampaign.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Launch Campaign`;
    validateForm();
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

function openCampaignWorkbench(type, id, mode = 'view') {
  const url = new URL('/campaign-workbench.html', window.location.origin);
  url.searchParams.set('type', type);
  url.searchParams.set('id', id);
  url.searchParams.set('mode', mode);
  window.location.href = url.toString();
}

const loadHistory = async () => {
  try {
    const data = await fetchJson('/api/sender/analytics/history');
    if (!data || !data.history) return;

    if (!historyTableBody) return;
    historyTableBody.innerHTML = '';

    if (data.history.length === 0) {
      historyTableBody.innerHTML = `<tr><td colspan="7" class="px-5 py-6 text-center text-brand-muted">No campaigns found</td></tr>`;
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
        <td class="px-5 py-4 text-center font-mono">${camp.totalSent || 0}</td>
        <td class="px-5 py-4 text-center font-mono">${camp.deliveredCount || 0}</td>
        <td class="px-5 py-4 text-center font-mono">${camp.bouncedCount || 0}</td>
        <td class="px-5 py-4 text-brand-muted text-xs">${dateStr}</td>
        <td class="px-5 py-4">
          <div class="flex items-center justify-between gap-2">
            <div class="flex-1">
              <div class="text-xs text-brand-muted mb-2 flex flex-wrap gap-3">
                <span>Opens: <strong class="text-brand-text">${camp.uniqueOpens || 0}</strong></span>
                <span>Clicks: <strong class="text-brand-text">${camp.uniqueClicks || 0}</strong></span>
              </div>
              ${camp.abortReason ? `<div class="text-xs text-red-500 max-w-xs break-words">${camp.abortReason}</div>` : `<span class="text-xs text-brand-muted">No errors logged</span>`}
              ${downloadsHtml}
            </div>
            <div class="flex items-center gap-1.5">
              <button onclick="window.openCampaignWorkbench('sender', '${camp.id}', 'view')" class="text-slate-500 hover:text-blue-600 p-1.5 rounded-md hover:bg-blue-50 transition-colors cursor-pointer" title="View Details">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
              <button onclick="window.openCampaignWorkbench('sender', '${camp.id}', 'edit')" class="text-slate-500 hover:text-amber-600 p-1.5 rounded-md hover:bg-amber-50 transition-colors cursor-pointer" title="Edit Campaign">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
              </button>
              <button onclick="window.deleteCampaign('${camp.id}')" class="text-slate-400 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors cursor-pointer" title="Delete Campaign">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
            </div>
          </div>
        </td>
      `;
      historyTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load history:", err);
    if (historyTableBody) {
      historyTableBody.innerHTML = `<tr><td colspan="7" class="px-5 py-6 text-center text-red-500">Failed to load history</td></tr>`;
    }
  }
};

async function deleteCampaign(id) {
  if (!confirm('Are you sure you want to delete this campaign? This will permanently remove its history and tracking logs.')) return;
  try {
    const res = await fetchJson(`/api/sender/campaigns/${id}`, { method: 'DELETE' });
    if (res.success) {
      loadHistory();
      loadKPIs();
    }
  } catch (err) {
    alert('Failed to delete campaign: ' + err.message);
  }
}

window.deleteCampaign = deleteCampaign;
window.openCampaignWorkbench = openCampaignWorkbench;

if (btnRefreshHistory) {
  btnRefreshHistory.addEventListener('click', loadKPIs);
}

// --- INIT ---
async function init() {
  currentUser = await checkAuthAndSetupSidebar();

  if (currentUser && currentUser.subscriptionPlan !== 'premium' && currentUser.subscriptionPlan !== 'advance' && !currentUser.isAdmin) {
    window.location.href = "/dashboard.html";
    return;
  }

  // Setup Auto-Mail Logic
  setupTemplateListeners((t) => {
      // When a template is saved or selected in the top management area,
      // we don't necessarily update steps unless the user wants to.
      // But we must reload the steps' template dropdowns.
      renderSequences();
  });

  setupSavedSequenceListeners((config) => {
      if (config) {
          // Sequence Loaded from Save
          sequences = config.sequences.map(s => ({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
              templateId: s.templateId || '',
              delayDays: s.delayDays || 0,
              dependsOnId: null, // Will relink below
              senderName: s.senderName || '',
              subject: s.subject || '',
              htmlContent: s.htmlContent || ''
          }));
          for (let i = 1; i < sequences.length; i++) {
              sequences[i].dependsOnId = sequences[i-1].id;
          }
          
          // Restore SMTP selection
          const smtpIds = config.smtpAccountIds || [];
          document.querySelectorAll('input[name="selectedSmtps"]').forEach(cb => {
              cb.checked = smtpIds.includes(cb.value);
          });
          
          renderSequences();
          validateForm();
      } else {
          // Reset to default
          sequences = [];
          addSequenceStep();
      }
  });

  // Global helpers for saved sequence logic
  window.getCurrentSequence = () => compileSequencePayload(sequences);
  window.getSelectedSmtps = () => Array.from(document.querySelectorAll('input[name="selectedSmtps"]:checked')).map(cb => cb.value);

  await Promise.all([
      loadKPIs(),
      loadAutoMailTemplates(),
      loadSavedSequences()
  ]);
}

init();
