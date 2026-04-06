/**
 * Auto-Mail and Sequence management module for the SaaS frontend.
 */
import { fetchJson } from './api.js';
import { escapeHtml } from './utils.js';

let autoMailTemplates = [];
let autoMailSequences = [];
let savedSequencesConfigs = [];

// Elements (lazy loaded or initialized in initAutoMailUI)
let adminAutoMailCard, enableAutoMailEl, autoMailSettingsEl, smtpListEl, autoMailSequenceContainer, btnAddAutoMailStep;
let templateSelectEl, templateNameEl, senderNameEl, subjectEl, htmlEl, btnSaveTemplateEl, btnDeleteTemplateEl;
let savedSequenceSelect, btnSaveSequence, btnDeleteSequence, savedSequencesContainer;

function cacheElements() {
    adminAutoMailCard = document.getElementById('adminAutoMailCard');
    enableAutoMailEl = document.getElementById('enableAutoMail');
    autoMailSettingsEl = document.getElementById('autoMailSettings');
    smtpListEl = document.getElementById('autoMailSmtpList');
    autoMailSequenceContainer = document.getElementById('autoMailSequenceContainer');
    btnAddAutoMailStep = document.getElementById('btnAddAutoMailStep');
    templateSelectEl = document.getElementById('autoMailTemplateSelect');
    templateNameEl = document.getElementById('autoMailTemplateName');
    senderNameEl = document.getElementById('autoMailSenderName');
    subjectEl = document.getElementById('autoMailSubject');
    htmlEl = document.getElementById('autoMailHtml');
    btnSaveTemplateEl = document.getElementById('btnSaveAutoMailTemplate');
    btnDeleteTemplateEl = document.getElementById('btnDeleteTemplate');
    savedSequenceSelect = document.getElementById('savedSequenceSelect');
    btnSaveSequence = document.getElementById('btnSaveSequence');
    btnDeleteSequence = document.getElementById('btnDeleteSequence');
    savedSequencesContainer = document.getElementById('savedSequencesContainer');
}

export async function initAutoMailUI() {
    cacheElements();

    if (adminAutoMailCard) {
        adminAutoMailCard.style.display = 'block';
    }

    if (enableAutoMailEl) {
        enableAutoMailEl.onchange = async () => {
            if (autoMailSettingsEl) autoMailSettingsEl.style.display = enableAutoMailEl.checked ? 'block' : 'none';
            if (savedSequencesContainer) savedSequencesContainer.style.display = enableAutoMailEl.checked ? 'flex' : 'none';
            if (enableAutoMailEl.checked) {
                await Promise.all([loadAutoMailTemplates(), loadSenderSmtps(), loadSavedSequences()]);
                if (autoMailSequences.length === 0) {
                    addSequenceStep();
                }
            }
        };
    }

    if (btnAddAutoMailStep) {
        btnAddAutoMailStep.onclick = (e) => {
            e.preventDefault();
            addSequenceStep();
        };
    }
    if (btnSaveTemplateEl) btnSaveTemplateEl.onclick = saveAutoMailTemplate;
    if (btnDeleteTemplateEl) btnDeleteTemplateEl.onclick = deleteTemplate;
    if (btnSaveSequence) btnSaveSequence.onclick = saveSequenceConfig;
    if (btnDeleteSequence) btnDeleteSequence.onclick = deleteSequenceConfig;

    if (templateSelectEl) {
        templateSelectEl.onchange = () => {
            const templateId = templateSelectEl.value;
            const template = autoMailTemplates.find(t => String(t.id) === String(templateId));
            if (template) {
                templateNameEl.value = template.name;
                senderNameEl.value = template.senderName || "";
                subjectEl.value = template.subject || "";
                htmlEl.value = template.htmlContent || "";
            } else {
                templateNameEl.value = "";
                senderNameEl.value = "";
                subjectEl.value = "";
                htmlEl.value = "";
            }
        };
    }

    if (savedSequenceSelect) {
        savedSequenceSelect.onchange = () => {
            const seqId = savedSequenceSelect.value;
            const seq = savedSequencesConfigs.find(s => String(s.id) === String(seqId));
            if (seq && seq.config && seq.config.steps) {
                autoMailSequences = [...seq.config.steps];
                renderAutoMailSequence();
            }
        };
    }

    // Expose SMTP management for inline handlers on dashboard.html
    window.submitNewSmtp = submitNewSmtp;
    window.deleteAutoMailSmtp = deleteAutoMailSmtp;
}

export async function loadAutoMailTemplates() {
    try {
        const data = await fetchJson('/api/automail/templates');
        autoMailTemplates = data.templates || [];
        if (templateSelectEl) {
            templateSelectEl.innerHTML = '<option value="">-- Create New Template --</option>' +
                autoMailTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        }
        renderTemplateDropdownsAcrossSteps();
    } catch (err) {
        console.error('Failed to load templates', err);
    }
}

async function loadSenderSmtps() {
    try {
        const smtpsRes = await fetchJson('/api/sender/smtp');
        const smtps = smtpsRes.accounts || [];
        if (smtpListEl) {
            if (smtps.length === 0) {
                smtpListEl.innerHTML = '<div class="text-[10px] text-slate-500 italic">No SMTP accounts found in Sender.</div>';
                return;
            }
            smtpListEl.innerHTML = smtps.map(s => `
                <div class="flex items-center justify-between group p-1.5 hover:bg-red-50 rounded transition-colors border border-transparent hover:border-red-100">
                    <label class="flex items-center gap-2 cursor-pointer flex-1">
                        <input type="checkbox" name="smtp_ids" value="${s.id}" checked class="w-3.5 h-3.5 text-red-600 rounded border-slate-300 focus:ring-red-500">
                        <span class="text-[11px] font-medium text-slate-700 truncate">${escapeHtml(s.user)} <span class="text-slate-400 font-normal">(${escapeHtml(s.host)})</span></span>
                    </label>
                    <button type="button" onclick="window.deleteAutoMailSmtp('${s.id}')" class="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all" title="Delete Account">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                    </button>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Failed to load SMTPs', err);
    }
}

export async function loadSavedSequences() {
    try {
        const data = await fetchJson('/api/automail/saved-sequences');
        savedSequencesConfigs = data.sequences || [];
        if (savedSequenceSelect) {
            savedSequenceSelect.innerHTML = '<option value="">-- Select Saved Sequence --</option>' +
                savedSequencesConfigs.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
        }
    } catch (err) {
        console.error('Failed to load sequences', err);
    }
}

function renderTemplateDropdownsAcrossSteps() {
    const selects = document.querySelectorAll('.step-template-select');
    selects.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Select Template --</option>' +
            autoMailTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        if (currentVal) select.value = currentVal;
    });
}

function addSequenceStep() {
    const step = { 
        templateId: "", 
        delayDays: autoMailSequences.length === 0 ? 0 : 3,
        dependsOnIdx: autoMailSequences.length === 0 ? null : autoMailSequences.length - 1
    };
    autoMailSequences.push(step);
    renderAutoMailSequence();
}

window.removeAutoMailStep = (idx) => {
    autoMailSequences.splice(idx, 1);
    // After removal, some dependsOnIdx might be invalid or need shifting
    autoMailSequences.forEach((s, i) => {
        if (i === 0) s.dependsOnIdx = null;
        else if (s.dependsOnIdx >= i) s.dependsOnIdx = i - 1;
    });
    renderAutoMailSequence();
};

function renderAutoMailSequence() {
    if (!autoMailSequenceContainer) return;

    if (autoMailSequences.length === 0) {
        autoMailSequenceContainer.innerHTML = `
            <div class="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <p class="text-sm text-slate-400">No steps added. Click the button below to start.</p>
            </div>`;
        return;
    }

    autoMailSequenceContainer.innerHTML = autoMailSequences.map((step, idx) => {
        const isFirst = idx === 0;
        const delayHtml = isFirst 
            ? `<div class="text-[10px] font-bold text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded border border-blue-100 inline-block mb-3">Sent immediately on launch</div>`
            : `<div class="flex items-center gap-2 mb-3 bg-slate-50 p-1.5 rounded-lg border border-slate-200 w-fit flex-wrap">
                 <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Wait</span>
                 <input type="number" class="step-delay w-12 px-1 py-0.5 text-center text-xs font-bold bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" 
                        value="${step.delayDays}" min="1" 
                        oninput="window.updateStep(${idx}, 'delayDays', parseInt(this.value)||0)">
                 <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 whitespace-nowrap">Days After</span>
                 <select class="step-depends-on px-2 py-0.5 text-[10px] font-bold bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none uppercase tracking-tighter"
                         onchange="window.updateStep(${idx}, 'dependsOnIdx', parseInt(this.value))">
                    ${autoMailSequences.slice(0, idx).map((s, i) => `<option value="${i}" ${parseInt(step.dependsOnIdx) === i ? 'selected' : ''}>Step ${i + 1}</option>`).join('')}
                 </select>
               </div>`;

        return `
        <div class="sequence-step-card relative bg-white border border-slate-200 rounded-xl p-4 shadow-sm transition-all hover:border-blue-300 mb-5 group" data-idx="${idx}">
            <span class="absolute -top-3 -left-3 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-lg ring-4 ring-slate-50">${idx + 1}</span>
            
            <button class="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100" 
                    onclick="window.removeAutoMailStep(${idx}); return false;" title="Remove Step">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            <div class="mt-1">
                ${delayHtml}

                <div class="space-y-3">
                    <div class="form-group mb-0">
                        <label class="block text-[11px] font-bold text-slate-400 uppercase mb-1.5 tracking-wider">Pick a Template</label>
                        <select class="step-template-select w-full px-3 py-2 text-sm font-medium bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:bg-white outline-none transition-all" 
                                onchange="window.updateStep(${idx}, 'templateId', this.value)">
                            <option value="">-- Custom Message --</option>
                            ${autoMailTemplates.map(t => `<option value="${t.id}" ${String(t.id) === String(step.templateId) ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `; }).join('') + `
        <div class="flex justify-center mt-2">
            <a href="/sender.html" class="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:text-blue-700 uppercase tracking-widest bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 transition-all hover:bg-blue-100 shadow-sm">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                Manage Templates
            </a>
        </div>
    `;
}


window.updateStep = (idx, field, value) => {
    if (autoMailSequences[idx]) {
        autoMailSequences[idx][field] = value;
    }
};

async function saveAutoMailTemplate() {
    const templateId = templateSelectEl.value;
    const payload = {
        name: templateNameEl.value,
        senderName: senderNameEl.value,
        subject: subjectEl.value,
        htmlContent: htmlEl.value
    };
    if (templateId && templateId !== 'new') {
        payload.id = templateId;
    }
    
    if (!payload.name) return alert("Please enter a template name");
    try {
        const res = await fetch('/api/automail/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert("Template saved!");
            await loadAutoMailTemplates();
        } else {
            const errData = await res.json();
            alert("Error saving template: " + (errData.error || "Unknown error"));
        }
    } catch (err) {
        alert("Error saving template");
    }
}

async function deleteTemplate() {
    const templateId = templateSelectEl.value;
    if (!templateId || templateId === 'new') return alert("Please select a template to delete");
    if (!confirm("Are you sure?")) return;
    try {
        const res = await fetch('/api/automail/templates/' + templateId, { method: 'DELETE' });
        if (res.ok) {
            alert("Template deleted");
            await loadAutoMailTemplates();
            templateNameEl.value = "";
            senderNameEl.value = "";
            subjectEl.value = "";
            htmlEl.value = "";
        }
    } catch (err) {
        alert("Error deleting template");
    }
}

async function saveSequenceConfig() {
    const name = prompt("Enter a name for this sequence:");
    if (!name) return;
    const steps = [...document.querySelectorAll('.sequence-step-card')].map(card => {
        const dependsOnSelect = card.querySelector('.step-depends-on');
        return {
            templateId: card.querySelector('.step-template-select').value,
            delayDays: parseInt(card.querySelector('.step-delay').value) || 0,
            dependsOnIdx: dependsOnSelect ? parseInt(dependsOnSelect.value) : null
        };
    }).filter(s => s.templateId);

    if (steps.length === 0) return alert("Please add at least one step with a template");

    try {
        const res = await fetch('/api/automail/saved-sequences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, config: { steps } })
        });
        if (res.ok) {
            alert("Sequence saved!");
            await loadSavedSequences();
        }
    } catch (err) {
        alert("Error saving sequence");
    }
}

async function deleteSequenceConfig() {
    const seqId = savedSequenceSelect.value;
    if (!seqId) return alert("Please select a sequence to delete");
    if (!confirm("Are you sure?")) return;
    try {
        const res = await fetch('/api/automail/saved-sequences/' + seqId, { method: 'DELETE' });
        if (res.ok) {
            alert("Sequence deleted");
            await loadSavedSequences();
        }
    } catch (err) {
        alert("Error deleting sequence");
    }
}

export function getAutoMailPayload() {
    const enabled = enableAutoMailEl?.checked;
    if (!enabled) return null;

    const smtpIds = [...document.querySelectorAll('input[name="smtp_ids"]:checked')].map(i => i.value);
    const steps = [...document.querySelectorAll('.sequence-step-card')].map(card => {
        const dependsOnSelect = card.querySelector('.step-depends-on');
        return {
            templateId: card.querySelector('.step-template-select').value,
            delayDays: parseInt(card.querySelector('.step-delay').value) || 0,
            dependsOnIdx: dependsOnSelect ? parseInt(dependsOnSelect.value) : null
        };
    }).filter(s => s.templateId);

    return { smtpIds, steps };
}
export function setupTemplateListeners(callback) {
    if (templateSelectEl) {
        templateSelectEl.addEventListener('change', () => {
            const templateId = templateSelectEl.value;
            const template = autoMailTemplates.find(t => String(t.id) === String(templateId));
            callback(template);
        });
    }
}

export function setupSavedSequenceListeners(callback) {
    if (savedSequenceSelect) {
        savedSequenceSelect.addEventListener('change', () => {
            const seqId = savedSequenceSelect.value;
            const seq = savedSequencesConfigs.find(s => String(s.id) === String(seqId));
            callback(seq);
        });
    }
}

async function submitNewSmtp(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btnSaveSmtpDash');
    const errEl = document.getElementById('addSmtpErrorDash');
    if (errEl) errEl.textContent = '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying...';
    }

    try {
        const payload = {
            host: document.getElementById('newSmtpHost').value.trim(),
            port: document.getElementById('newSmtpPort').value.trim(),
            user: document.getElementById('newSmtpUser').value.trim(),
            pass: document.getElementById('newSmtpPass').value.trim()
        };

        const res = await fetchJson('/api/sender/smtp', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.success) {
            const form = document.getElementById('addSmtpFormObj');
            if (form) {
                form.reset();
                form.style.display = 'none';
            }
            await loadSenderSmtps();
        } else {
            if (errEl) errEl.textContent = res.error || 'Failed to add account.';
        }
    } catch (err) {
        if (errEl) errEl.textContent = err.message;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Verify & Save';
        }
    }
}

async function deleteAutoMailSmtp(id) {
    if (!confirm('Delete this SMTP account?')) return;
    try {
        const res = await fetchJson(`/api/sender/smtp/${id}`, { method: 'DELETE' });
        if (res.success) {
            await loadSenderSmtps();
        } else {
            alert('Failed to delete account: ' + (res.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Error deleting account: ' + err.message);
    }
}
