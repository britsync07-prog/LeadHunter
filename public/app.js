/**
 * SaaS Main Entry Point (app.js)
 * Coordinates modular logic with defensive initialization.
 */

import * as API from './js/api.js';
import * as Utils from './js/utils.js';
import * as Auth from './js/auth.js';
import * as AutoMail from './js/automail.js';

// --- SHARED STATE ---
let totalLeads = 0;
let totalPhones = 0;
let allCountryCities = [];
let visibleCityOptions = [];
let selectedCityValues = new Set();
const stateCitiesCache = new Map();
let historyCategories = [];

let _uiUpdateQueued = false;
let _pendingEvents = [];
const MAX_EVENTS_IN_DOM = 15;

// --- ELEMENT REFERENCES (With safety checks) ---
const getEl = id => document.getElementById(id);
const countryEl = getEl("country");
const stateContainer = getEl("states");
const cityContainer = getEl("cities");
const selectAllStates = getEl("selectAllStates");
const selectAllCities = getEl("selectAllCities");
const citySearchEl = getEl("citySearch");
const eventsEl = getEl("events");
const liveLeadCountEl = getEl("liveLeadCount");
const livePhoneCountEl = getEl("livePhoneCount");
const nichesEl = getEl("niches");
const historyEl = getEl("history");
const queueStatusEl = getEl("queueStatus");

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("SaaS Dashboard Initializing...");
    
    // 1. Auth & Layout (Critical)
    try {
        await Auth.checkAuth({
            onAuthSuccess: (user) => {
                initializeDashboard(user);
            }
        });
    } catch (err) {
        console.error("Auth initialization failed:", err);
    }
});

async function initializeDashboard(user) {
    // 2. Data Loading (Concurrent)
    safeInit("Categories", loadCategories);
    safeInit("Countries", loadCountries);
    safeInit("History", loadHistory);
    safeInit("Queue", startQueuePolling);
    
    // 3. UI logic (Feature specific)
    safeInit("AutoMail", AutoMail.initAutoMailUI);
    safeInit("SocialToggles", setupSocialToggles);
    safeInit("ModalBindings", setupModalBindings);
    
    // Check for active jobs
    if (user.activeJobId) {
        attachToJob(user.activeJobId);
    }
}

function safeInit(name, fn) {
    try {
        fn();
    } catch (err) {
        console.warn(`Module initialization [${name}] failed, but dashboard remains active:`, err);
    }
}

// --- CORE SCRAPER UI LOGIC ---

async function loadCountries() {
    if (!countryEl) return;
    try {
        const metadata = await API.getMetadata();
        countryEl.innerHTML = metadata.countries.map(c => `<option value="${c}">${c}</option>`).join("");
        countryEl.onchange = () => loadLocationDetails(countryEl.value);
        if (countryEl.value) loadLocationDetails(countryEl.value);
    } catch (err) {
        console.error("Failed to load countries:", err);
    }
}

async function loadLocationDetails(country) {
    try {
        const details = await API.getLocationDetails(country);
        allCountryCities = details.cities || [];
        visibleCityOptions = [];
        selectedCityValues = new Set();
        if (citySearchEl) citySearchEl.value = "";
        Utils.renderCheckboxList(stateContainer, details.states || [], selectAllStates);
    } catch (err) {
        console.error("Failed to load location details:", err);
    }
}

async function refreshVisibleCities() {
    if (!countryEl) return;
    const country = countryEl.value;
    const states = Utils.selectedValues(stateContainer);
    const previouslySelected = new Set(selectedCityValues);

    if (!states.length) {
        visibleCityOptions = [];
        selectedCityValues.clear();
        renderVisibleCities();
        return;
    }

    try {
        const cityLists = await Promise.all(states.map(state => API.getCitiesForState(country, state).catch(() => [])));
        visibleCityOptions = [...new Set(cityLists.flat())].sort((a, b) => a.localeCompare(b));
    } catch (err) {
        visibleCityOptions = [];
    }

    selectedCityValues = new Set([...previouslySelected].filter(city => visibleCityOptions.includes(city)));
    if (!visibleCityOptions.length) {
        visibleCityOptions = [...new Set(allCountryCities)].sort((a, b) => a.localeCompare(b));
        selectedCityValues = new Set([...previouslySelected].filter(city => visibleCityOptions.includes(city)));
    }
    renderVisibleCities();
}

function renderVisibleCities() {
    const query = citySearchEl?.value?.trim().toLowerCase() || "";
    const filtered = visibleCityOptions.filter(city => city.toLowerCase().includes(query));
    Utils.renderCheckboxList(cityContainer, filtered, selectAllCities, [...selectedCityValues]);
}

// Binding listeners to state/city containers
stateContainer?.addEventListener("change", () => refreshVisibleCities());
cityContainer?.addEventListener("change", (e) => {
    const cb = e.target;
    if (cb && cb.type === "checkbox") {
        if (cb.checked) selectedCityValues.add(cb.value);
        else selectedCityValues.delete(cb.value);
        const label = cb.closest("label");
        if (label) label.classList.toggle("is-selected", cb.checked);
        Utils.syncSelectAllState(cityContainer, selectAllCities);
    }
});
citySearchEl?.addEventListener("input", () => renderVisibleCities());

selectAllStates?.addEventListener("change", () => {
    const checked = selectAllStates.checked;
    stateContainer.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = checked);
    refreshVisibleCities();
});

selectAllCities?.addEventListener("change", () => {
    const checked = selectAllCities.checked;
    cityContainer.querySelectorAll('input[type="checkbox"]').forEach(i => {
        i.checked = checked;
        if (checked) selectedCityValues.add(i.value);
        else selectedCityValues.delete(i.value);
    });
    renderVisibleCities();
});

// --- CATEGORIES & HISTORY ---

async function loadCategories() {
  try {
    const categoriesData = await API.getCategories();
    const categories = categoriesData.categories || [];
    historyCategories = categories;
    const selectEl = document.getElementById("jobCategory");
    if (selectEl) {
      const currentVal = selectEl.value;
      selectEl.innerHTML = '<option value="">-- Select a Campaign --</option>' +
        categories.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join("");

      const exists = categories.find(c => c.id === currentVal);
      if (exists) selectEl.value = currentVal;
    }

    // Update the history filter dropdown
    const filterSelect = document.getElementById("historyCategoryFilter");
    if (filterSelect) {
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = '<option value="all">All Campaigns</option>' +
        categories.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join("");
      const exists = categories.find(c => c.id === currentVal);
      filterSelect.value = exists ? currentVal : "all";
    }
  } catch (err) {
    console.error("Could not load categories", err);
  }
}

function getCategoryName(categoryId) {
  if (!categoryId) return "Uncategorized";
  const match = historyCategories.find((cat) => cat.id === categoryId);
  return match ? match.name : "Uncategorized";
}

function openCampaignWorkbench(type, id, mode = 'view') {
  const url = new URL('/campaign-workbench.html', window.location.origin);
  url.searchParams.set('type', type);
  url.searchParams.set('id', id);
  url.searchParams.set('mode', mode);
  window.location.href = url.toString();
}

window.openCampaignWorkbench = openCampaignWorkbench;

// Handle Add Category Button
const addCategoryBtn = document.getElementById("addCategoryBtn");
if (addCategoryBtn) {
  addCategoryBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const name = prompt("Enter a name for the new campaign:");
    if (!name?.trim()) return;

    try {
      const res = await API.fetchJson("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() })
      });

      const category = res.category;
      await loadCategories();

      // Select the newly created category
      const selectEl = document.getElementById("jobCategory");
      if (selectEl) selectEl.value = category.id;

    } catch (err) {
      alert("Error creating campaign: " + err.message);
      console.error(err);
    }
  });
}

const deleteCategoryBtn = document.getElementById("deleteCategoryBtn");
if (deleteCategoryBtn) {
  deleteCategoryBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const selectEl = document.getElementById("jobCategory");
    const categoryId = selectEl?.value;
    if (!categoryId) return alert("Please select a campaign to delete.");

    const categoryName = selectEl.options[selectEl.selectedIndex].text;
    if (!confirm(`Are you sure you want to delete the campaign category "${categoryName}"? Existing jobs in this category will NOT be deleted, but they will no longer be filtered by this name.`)) return;

    try {
      await API.fetchJson(`/api/categories/${categoryId}`, {
        method: "DELETE"
      });
      await loadCategories();
    } catch (err) {
      console.error(err);
      alert("Error deleting campaign. It may not exist.");
    }
  });
}

// Add event listener to the history category filter
const historyCategoryFilter = document.getElementById("historyCategoryFilter");
if (historyCategoryFilter) {
  historyCategoryFilter?.addEventListener("change", () => loadHistory());
}

async function loadHistory() {
    if (!historyEl) return;
    try {
        const history = await API.getHistory();
        renderHistory(history);
    } catch (err) {
        console.error("Failed to load history:", err);
    }
}

function renderHistory(jobs) {
    if (!historyEl) return;
    const filter = getEl("historyCategoryFilter")?.value || "all";
    const filtered = jobs.filter(j => filter === 'all' || String(j.categoryId || (j.params && j.params.category)) === filter);
    
    if (filtered.length === 0) {
        historyEl.innerHTML = '<div class="empty-state">No jobs found. Start your first search above!</div>';
        return;
    }

    historyEl.innerHTML = '';
    
    filtered.forEach((job) => {
      const div = document.createElement("div");
      div.className = "history-item job-card group";
      div.id = `job-${job.id}`;
      const date = new Date(job.createdAt).toLocaleString();
      const params = job.params || {};
      const categoryName = getCategoryName(params.category);
      const citiesList = params.cities || [];
      const statesList = params.states || [];

      let locationText = params.country || "Global";
      if (statesList.length > 0) {
        locationText += ` &ndash; ${statesList.join(", ")} `;
      }

      const fileList = (job.files || []);
      const isPrimary = (f) => f === "all_emails.txt" || f === "all_phones.txt" || f.toLowerCase().endsWith('.csv');

      const primaryFiles = fileList.filter(isPrimary);

      // We replace the old history file elements logic with the newer UI grid elements if appropriate
      let analyticsHtml = "";
      if (typeof job.totalEmailsSent !== 'undefined' && job.params.autoMailConfig && job.totalEmailsSent > 0) {
        analyticsHtml = `<div class="history-analytics" style="margin-top: 6px; font-size: 11.5px; display: flex; align-items: center; gap: 12px; font-weight: 500; background: #f8fafc; padding: 6px 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
           <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">Sent: <span style="color: #1e293b; font-weight: 700;">${job.totalEmailsSent}</span></span>
           <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">Delivered: <span style="color: #10b981; font-weight: 700;">${job.deliveredCount || 0}</span></span>
           <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">Opened: <span style="color: #8b5cf6; font-weight: 700;">${job.uniqueOpens || 0}</span></span>
           <span style="color: #64748b; display: flex; align-items: center; gap: 4px;">Clicked: <span style="color: #0f766e; font-weight: 700;">${job.uniqueClicks || 0}</span></span>
        </div>`;
      }

      const isStoppable = job.status === "running";
      const isRestartable = job.status === "failed" || job.status === "stopped";
      const isDeletable = job.status !== "running";
      const stopButton = isStoppable ? `<button class="p-1 text-red-400 hover:text-red-600 transition-colors" onclick="stopJob('${job.id}')" title="Stop Job"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12"/></svg></button>` : "";
      const restartButton = isRestartable ? `<button class="p-1 text-slate-300 hover:text-blue-500 transition-colors" onclick="restartJob('${job.id}')" title="Restart"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>` : "";
      const deleteButton = isDeletable ? `<button class="p-1 text-slate-300 hover:text-red-500 transition-colors" onclick="deleteJob('${job.id}')" title="Delete Job"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>` : "";
      
      const detailsButton = `<button onclick="openCampaignWorkbench('job', '${job.id}', 'view')" style="background:none; color:#2563eb; border:1px solid #bfdbfe; padding:2px 8px; border-radius:4px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px;" title="View Details">Details</button>`;
      const editButton = `<button onclick="openCampaignWorkbench('job', '${job.id}', 'edit')" style="background:none; color:#d97706; border:1px solid #fcd34d; padding:2px 8px; border-radius:4px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px;" title="Edit Job">Edit</button>`;

      const nicheText = Array.isArray(params.niches) ? params.niches.join(", ") : (params.niches || "All Niches");

      div.innerHTML = `
        <div class="job-header-v2">
            <div class="flex items-center gap-3">
                <span class="job-status-pill status--${job.status}" id="status-${job.id}">${job.status}</span>
                <h3 class="text-sm font-bold text-slate-800 truncate max-w-[200px]" title="${Utils.escapeHtml(nicheText)}">${Utils.escapeHtml(nicheText)}</h3>
            </div>
            <div class="job-meta">
                <span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">${Utils.escapeHtml(locationText)}</span>
                <span class="text-[10px] text-slate-400 font-mono ml-2">• ${date}</span>
                <div class="flex gap-1 items-center ml-2">
                    ${detailsButton}
                    ${editButton}
                    ${stopButton}
                    ${restartButton}
                    ${deleteButton}
                </div>
            </div>
        </div>
        
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; margin-bottom:8px;">
          <span style="font-size:11px; font-weight:700; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; padding:2px 8px; border-radius:999px;">Campaign: ${Utils.escapeHtml(categoryName)}</span>
          ${job.campaignName ? `<span style="font-size:11px; font-weight:700; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; padding:2px 8px; border-radius:999px;">Auto-Mail: ${Utils.escapeHtml(job.campaignName)}</span>` : ''}
        </div>
        ${analyticsHtml}

        <div class="job-files-grid mt-3" id="files-${job.id}">
            ${primaryFiles.map(f => renderFileLink(job.id, f)).join('')}
        </div>
      `;
      historyEl.appendChild(div);
    });
}

function renderFileLink(jobId, fileName) {
    let icon = "📄";
    let colorClass = "file--generic";
    let label = fileName;
    
    if (fileName === "all.csv") { 
        icon = "📊"; colorClass = "file--csv"; label = "all.csv"; 
    }
    else if (fileName === "all_emails.txt") { 
        icon = "📧"; colorClass = "file--json"; label = "all_emails.txt"; 
    }
    else if (fileName === "all_phones.txt") { 
        icon = "📝"; colorClass = "file--txt"; label = "all_phones.txt"; 
    }
    
    return `
        <div class="file-chip ${colorClass}">
            <span class="file-icon">${icon}</span>
            <span class="file-label" title="${fileName}">${label}</span>
            <div class="file-ops">
                <a href="#" onclick="openFilePreview('${jobId}', '${fileName}'); return false;" class="op-view" title="Preview">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </a>
                <a href="/api/jobs/${jobId}/files/${fileName}" target="_blank" class="op-dl" title="Download">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>
            </div>
        </div>
    `;
}

// Global window bindings for inline HTML handlers
window.stopJob = async (id) => {
    if (confirm("Stop this job?")) {
        await API.stopJob(id);
        loadHistory();
    }
};
window.deleteJob = async (id) => {
    if (confirm("Delete this job and all its files?")) {
        await API.deleteJob(id);
        loadHistory();
    }
};

// --- RUN SCRAPER ---

getEl("run")?.addEventListener("click", async () => {
    const niches = nichesEl?.value.split("\n").map(x => x.trim()).filter(Boolean);
    const states = Utils.selectedValues(stateContainer);
    const cities = [...selectedCityValues];
    const includeGoogleMaps = getEl("includeGoogleMaps")?.checked;
    const includeSocial = getEl("includeSocial")?.checked;
    const scrapeMode = (includeSocial && !includeGoogleMaps) ? 'emails' : 'both';
    
    if (!niches?.length) return alert("Please enter at least one niche.");
    if (!includeGoogleMaps && !includeSocial) return alert("Please select at least one data source.");

    const autoMailConfig = AutoMail.getAutoMailPayload();
    const categoryId = document.getElementById("jobCategory")?.value || "";
    
    try {
        Utils.setStatus("Starting job...", "running");
        const res = await API.fetchJson("/api/jobs", {
            method: "POST",
            body: JSON.stringify({
                country: countryEl.value,
                cities,
                states,
                niches: niches.join("\n"),
                includeGoogleMaps,
                includeSocial,
                scrapeMode,
                category: categoryId,
                autoMailConfig
            })
        });
        attachToJob(res.jobId);
        loadHistory();
    } catch (err) {
        alert(err.message);
        Utils.setStatus("Failed to start", "error");
    }
});

// --- REAL-TIME UPDATES (EventSource) ---

function attachToJob(jobId) {
    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (e) => {
        const payload = JSON.parse(e.data);
        handleJobEvent(jobId, payload, stream);
    };
}

function handleJobEvent(jobId, payload, stream) {
    if (payload.type === 'usage-update') return; // Handled by auth or global
    
    if (payload.type === 'lead-saved' || payload.type === 'phone-saved') {
        if (liveLeadCountEl && payload.email) totalLeads++;
        if (livePhoneCountEl && payload.phone) totalPhones++;
        updateCounters();
    }

    _pendingEvents.push(payload);
    if (_pendingEvents.length > 50) _pendingEvents.shift();
    queueUiUpdate();

    if (payload.type?.includes('complete') || payload.type?.includes('failed') || payload.type?.includes('stopped')) {
        stream.close();
        loadHistory();
        Utils.setStatus(payload.message || "Finished", payload.type === 'job-failed' ? "error" : "idle");
    }
}

function updateCounters() {
    if (liveLeadCountEl) liveLeadCountEl.textContent = totalLeads + ' leads';
    if (livePhoneCountEl) livePhoneCountEl.textContent = totalPhones + ' phones';
}

function queueUiUpdate() {
    if (_uiUpdateQueued) return;
    _uiUpdateQueued = true;
    setTimeout(() => {
        _uiUpdateQueued = false;
        renderEvents();
    }, 300);
}

function renderEvents() {
    if (!eventsEl) return;
    const fragment = document.createDocumentFragment();
    _pendingEvents.slice(-MAX_EVENTS_IN_DOM).reverse().forEach(ev => {
        const li = document.createElement("li");
        li.className = "ev-item";
        li.innerHTML = `<span class="ev-type">${ev.type}</span> <span class="ev-msg">${ev.message || ev.email || ev.phone || ""}</span>`;
        fragment.appendChild(li);
    });
    eventsEl.innerHTML = "";
    eventsEl.appendChild(fragment);
}

// --- QUEUE POLLING ---

async function startQueuePolling() {
    if (!queueStatusEl) return;
    const updateQueueUI = (status) => {
        const count = status.active || 0;
        queueStatusEl.innerHTML = count > 0 
            ? `<span class="flex items-center gap-1.5 font-bold" style="color: var(--green);"><span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background: var(--green);"></span> ${count} Running</span>` 
            : `<span class="text-slate-400 font-medium">System Idle</span>`;
        queueStatusEl.className = `queue-badge ${count > 0 ? 'queue--active' : 'queue--idle'}`;
    };

    setInterval(async () => {
        try {
            const status = await API.getQueueStatus();
            updateQueueUI(status);
        } catch (err) {
            queueStatusEl.innerHTML = `<span class="text-red-400 text-[10px]">Error fetching queue</span>`;
        }
    }, 5000);
}

// --- UI MISC ---

function setupSocialToggles() {
    const socialSiteSelection = getEl("socialSiteSelection");
    const includeSocialEl = getEl("includeSocial");
    if (includeSocialEl && socialSiteSelection) {
        includeSocialEl.onchange = () => {
            socialSiteSelection.style.display = includeSocialEl.checked ? "block" : "none";
        };
    }
}

function setupModalBindings() {
    const closeModalBtn = getEl("closeModalBtn");
    const modal = getEl("filePreviewModal");
    if (closeModalBtn && modal) {
        closeModalBtn.onclick = () => modal.style.display = 'none';
    }
}

// File Preview Logic (Module style)
window.openFilePreview = async (jobId, fileName) => {
    const modal = getEl("filePreviewModal");
    const contentEl = getEl("modalFileContent");
    const downloadBtn = getEl("modalDownloadBtn");
    if (!modal || !contentEl) return;
    
    modal.style.display = 'flex';
    contentEl.innerHTML = '<div style="padding:20px; color:var(--text-muted);">Loading...</div>';
    if (downloadBtn) {
        downloadBtn.href = `/api/jobs/${jobId}/files/${fileName}`;
        downloadBtn.setAttribute('download', fileName);
    }
    
    try {
        const res = await fetch(`/api/jobs/${jobId}/files/${fileName}`);
        if (!res.ok) throw new Error("Failed to load file");
        const text = await res.text();
        
        if (fileName.toLowerCase().endsWith('.csv')) {
            const lines = text.split('\n').filter(l => l.trim());
            if (lines.length === 0) {
                contentEl.innerHTML = '<div style="padding:20px; color:var(--text-muted);">File is empty.</div>';
            } else {
                const table = document.createElement('table');
                table.className = 'csv-table';
                table.style.width = '100%';
                table.style.borderCollapse = 'collapse';
                table.style.fontSize = '12px';
                
                lines.forEach((line, idx) => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid var(--border-color)';
                    const cols = line.split(',');
                    cols.forEach(col => {
                        const cell = document.createElement(idx === 0 ? 'th' : 'td');
                        cell.style.padding = '8px';
                        cell.style.textAlign = 'left';
                        cell.textContent = col.trim();
                        tr.appendChild(cell);
                    });
                    table.appendChild(tr);
                });
                const wrapper = document.createElement('div');
                wrapper.className = 'csv-table-wrapper';
                wrapper.appendChild(table);
                contentEl.innerHTML = '';
                contentEl.appendChild(wrapper);
            }
        } else {
            // Render as raw text in a pre tag
            const pre = document.createElement('pre');
            pre.style.margin = '0';
            pre.style.padding = '24px';
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-all';
            pre.style.fontFamily = 'monospace';
            pre.style.fontSize = '13px';
            pre.style.color = 'var(--text-primary)';
            pre.textContent = text;
            contentEl.innerHTML = '';
            contentEl.appendChild(pre);
        }
    } catch (err) {
        contentEl.innerHTML = `<div style="padding:20px; color:var(--red);">Error loading file: ${err.message}</div>`;
    }
};

export { API, Utils, Auth, AutoMail };
