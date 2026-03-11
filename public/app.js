const countryEl = document.getElementById("country");
const stateContainer = document.getElementById("states");
const cityContainer = document.getElementById("cities");
const selectAllStates = document.getElementById("selectAllStates");
const selectAllCities = document.getElementById("selectAllCities");
const statusEl = document.getElementById("status");
const statusIndicator = document.getElementById("statusIndicator");
const eventsEl = document.getElementById("events");
const filesEl = document.getElementById("files");
const phoneFilesEl = document.getElementById("phoneFiles");
const nichesEl = document.getElementById("niches");
const expandedNichesEl = document.getElementById("expandedNiches");
const googleMapsModeEl = document.getElementById("googleMapsMode");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");
const historyEl = document.getElementById("history");
const queueStatusEl = document.getElementById("queueStatus");
const liveLeadCountEl = document.getElementById("liveLeadCount");
const livePhoneCountEl = document.getElementById("livePhoneCount");
const phoneQueryPreviewEl = document.getElementById("phoneQueryPreview");
const phoneQueryExampleEl = document.getElementById("phoneQueryExample");

// Auto-Mail Elements
const adminAutoMailCard = document.getElementById('adminAutoMailCard');
const enableAutoMailEl = document.getElementById('enableAutoMail');
const autoMailSettingsEl = document.getElementById('autoMailSettings');
const templateSelectEl = document.getElementById('autoMailTemplateSelect');
const templateNameEl = document.getElementById('autoMailTemplateName');
const senderNameEl = document.getElementById('autoMailSenderName');
const subjectEl = document.getElementById('autoMailSubject');
const htmlEl = document.getElementById('autoMailHtml');
const smtpListEl = document.getElementById('autoMailSmtpList');
const btnSaveTemplateEl = document.getElementById('btnSaveAutoMailTemplate');
const btnDeleteTemplateEl = document.getElementById('btnDeleteTemplate');

let autoMailTemplates = [];

let currentUser = null;
let totalLeads = 0;
let totalPhones = 0;

// Throttled UI State
let _uiUpdateQueued = false;
let _pendingEvents = [];
const MAX_EVENTS_IN_DOM = 15;

// ── Scrape Mode helpers ─────────────────────────────────────
function getScrapeMode() {
  const checked = document.querySelector('input[name="scrapeMode"]:checked');
  return checked ? checked.value : 'emails';
}

// Country → phone prefix map for the preview banner
const COUNTRY_PHONE_PREFIXES = {
  "United Kingdom": ['"07"', '"+44"'],
  "United States": ['"+1"', '"tel:"'],
  "Canada": ['"+1"', '"tel:"'],
  "Australia": ['"04"', '"+61"'],
  "Germany": ['"+49"', '"015"', '"016"', '"017"'],
  "France": ['"+33"', '"06"', '"07"'],
  "India": ['"+91"'],
  "Pakistan": ['"+92"', '"03"'],
  "UAE": ['"+971"', '"05"'],
  "Saudi Arabia": ['"+966"', '"05"']
};

function updatePhoneQueryPreview() {
  const mode = getScrapeMode();
  const showPhone = mode === 'phones' || mode === 'both';
  if (phoneQueryPreviewEl) phoneQueryPreviewEl.style.display = showPhone ? 'block' : 'none';
  if (!showPhone || !phoneQueryExampleEl) return;

  const country = countryEl?.value || 'United Kingdom';
  const prefixes = COUNTRY_PHONE_PREFIXES[country] || ['"+XX"'];
  const phoneTerm = '(' + prefixes.join(' OR ') + ')';

  const rawNiches = nichesEl?.value.split('\n').map(x => x.trim()).filter(Boolean) || [];
  const niche = rawNiches[0] || 'Fitness Trainer';

  const checkedCities = [...(cityContainer?.querySelectorAll('input:checked') || [])].map(i => i.value);
  const city = checkedCities[0] || 'London';

  phoneQueryExampleEl.textContent = `site:linkedin.com/in ${niche} "${city}" ${phoneTerm}`;
}

function getPlanLimits(plan) {
  const p = (plan || '').toLowerCase().trim();
  if (p === 'premium') return { daily: 6000, monthly: 180000, concurrentJobs: 5 };
  if (p === 'advance') return { daily: 1000, monthly: 30000, concurrentJobs: 1 };
  if (p === 'basic') return { daily: 300, monthly: 9000, concurrentJobs: 1 };
  return { daily: 100, monthly: 3000, concurrentJobs: 1 };
}

async function checkAuth() {
  try {
    const user = await fetchJson("/api/me");
    currentUser = user;

    if (user.subscriptionPlan === 'expired' || user.subscriptionPlan === 'free') {
      window.location.href = "/expired.html";
      return;
    }

    userInfoEl.textContent = `Logged in as: ${user.username}`;

    // Show Admin Panel link if user is an admin
    if (user.isAdmin) {
      const adminLink = document.getElementById('adminPanelLink');
      if (adminLink) adminLink.style.display = 'flex';
    }

    // Display Usage Quota and Active Plan
    const currentPlanEl = document.getElementById('currentPlanEl');
    if (currentPlanEl && user.subscriptionPlan) {
      currentPlanEl.classList.remove('hidden');
      currentPlanEl.style.display = 'inline-block';
      let showTrial = false;

      if (user.trialEndsAt) {
        const tEnd = new Date(user.trialEndsAt);
        if (tEnd > new Date()) {
          showTrial = true;
          const daysLeft = Math.ceil((tEnd - new Date()) / (1000 * 60 * 60 * 24));
          currentPlanEl.textContent = `Free Trial (${daysLeft}d left)`;
          currentPlanEl.style.color = 'var(--blue-primary)';
          currentPlanEl.style.borderColor = 'rgba(59, 130, 246, 0.4)';
          currentPlanEl.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
        }
      }

      if (!showTrial) {
        const p = user.subscriptionPlan.toLowerCase().trim();
        currentPlanEl.textContent = `${p.charAt(0).toUpperCase() + p.slice(1)} Plan`;

        // Color code by tier
        if (p === 'premium') {
          currentPlanEl.style.color = '#10b981'; // Green
          currentPlanEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
          currentPlanEl.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        } else if (p === 'advance') {
          currentPlanEl.style.color = 'var(--blue-primary)';
          currentPlanEl.style.borderColor = 'rgba(59, 130, 246, 0.3)';
          currentPlanEl.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
        } else {
          currentPlanEl.style.color = 'var(--text-secondary)';
          currentPlanEl.style.borderColor = 'var(--border)';
          currentPlanEl.style.backgroundColor = 'var(--bg-surface)';
        }
      }
    }

    const usageQuotaEl = document.getElementById('usageQuotaEl');
    if (usageQuotaEl && user.usage) {
      if (user.isAdmin) {
        usageQuotaEl.style.display = 'inline-block';
        usageQuotaEl.textContent = `Emails: ${user.usage.dailyCount}/Unlimited | Month: ${user.usage.monthlyCount}/Unlimited`;
      } else {
        const limits = getPlanLimits(user.subscriptionPlan);
        usageQuotaEl.style.display = 'inline-block';
        usageQuotaEl.textContent = `Emails: ${user.usage.dailyCount}/${limits.daily} | Month: ${user.usage.monthlyCount}/${limits.monthly}`;
      }
    }

    loadCountries();
    loadCategories();
    loadHistory();
    startQueuePolling();

    // Populate the Profile Modal with live session data
    if (typeof window.populateProfileModal === 'function') {
      window.populateProfileModal(user);
    }

    // Apply UI locks based on subscription plan
    applySubscriptionLocks(user.subscriptionPlan, user.isAdmin);

    if (user.activeJobId) {
      attachToJob(user.activeJobId);
    }

    if (user.isAdmin) {
        initAutoMailUI();
    }

    setupMobileMenu();
  } catch (error) {
    window.location.href = "/login.html";
  }
}

function setupMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileOverlay = document.getElementById('mobileOverlay');
  const sidebar = document.querySelector('aside');

  if (!mobileMenuBtn || !mobileOverlay || !sidebar) return;

  const toggle = () => {
    sidebar.classList.toggle('active');
    mobileOverlay.classList.toggle('active');
  };

  mobileMenuBtn.addEventListener('click', toggle);
  mobileOverlay.addEventListener('click', toggle);

  // Close sidebar when clicking a nav item on mobile
  sidebar.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', () => {
      if (sidebar.classList.contains('active')) {
        toggle();
      }
    });
  });
}

function applySubscriptionLocks(plan, isAdmin) {
  const modeEmails = document.getElementById('modeEmails');
  const modePhones = document.getElementById('modePhones');
  const modeBoth = document.getElementById('modeBoth');
  const mapsMode = document.getElementById('googleMapsMode');

  const navSender = document.getElementById('navSender');
  const navChecker = document.getElementById('navChecker');
  const smPriorityWrap = document.querySelector('.sm-priority-wrap');

  // Ensure Sender and Checker are ONLY visible for Premium users OR Admins
  if (plan !== 'premium' && !isAdmin) {
    if (navSender) navSender.style.display = 'none';
    if (navChecker) navChecker.style.display = 'none';
  }

  if (!modeEmails) return; // not on scraper dashboard

  // Reset visual states
  document.querySelectorAll('.mode-card').forEach(el => {
    el.style.display = 'flex';
    el.style.opacity = '1';
    el.onclick = null; // remove potential old alerts
  });
  if (mapsMode) {
    mapsMode.closest('div').style.display = 'block';
    mapsMode.closest('div').style.opacity = '1';
    mapsMode.disabled = false;
  }
  if (smPriorityWrap) smPriorityWrap.style.display = 'block';

  modeEmails.disabled = false;
  modePhones.disabled = false;
  modeBoth.disabled = false;

  if (plan === 'basic') {
    // Basic: Emails only, No Maps
    modePhones.disabled = true;
    modeBoth.disabled = true;
    modeEmails.checked = true;

    if (mapsMode) {
      mapsMode.value = 'no';
      mapsMode.disabled = true;
      mapsMode.closest('div').style.opacity = '0.5';
      mapsMode.title = 'Upgrade your plan to unlock Google Maps scraping.';
    }

    document.querySelector('label[for="modePhones"]').style.opacity = '0.4';
    document.querySelector('label[for="modeBoth"]').style.opacity = '0.4';

    // Intercept clicks on disabled options to show upgrade message
    const upgradeAlert = (e) => {
      e.preventDefault();
      alert("Please update your plan to access this feature.");
    };
    document.querySelector('label[for="modePhones"]').onclick = upgradeAlert;
    document.querySelector('label[for="modeBoth"]').onclick = upgradeAlert;

  } else if (plan === 'advance' || plan === 'premium') {
    // Advance/Premium: Maps ONLY, Both ONLY. Hide the redundant UI options completely.
    modeBoth.checked = true;

    document.querySelector('label[for="modeEmails"]').style.display = 'none';
    document.querySelector('label[for="modePhones"]').style.display = 'none';

    // Also remove the "Social Media Priority" block since it's irrelevant for Maps-only
    if (smPriorityWrap) {
      smPriorityWrap.style.display = 'none';
    }

    if (mapsMode) {
      mapsMode.closest('div').style.display = 'none'; // Lock Maps ON silently
      mapsMode.value = 'yes';
    }
  }
}


function setStatus(text, mode = 'idle') {
  if (statusEl) statusEl.textContent = text;
  if (statusIndicator) {
    const dot = statusIndicator.querySelector('.dot');
    if (dot) {
      dot.className = 'dot dot--' + mode;
    }
  }
}

function addEvent(payload) {
  const type = payload.type || '';
  if (type === 'usage-update') return;

  // Format rules
  const isEmail = (type === 'lead-saved' && payload.email);
  const isPhone = (type === 'phone-saved' && payload.phone);

  // Update global counters only for strictly validated events
  if (isEmail) totalLeads++;
  else if (isPhone) totalPhones++;

  // Filter: Only show emails, phones, completion, or errors in the feed
  const isDone = type.includes('complete') || type.includes('done');
  const isError = type.includes('fail') || type.includes('error');

  if (!isEmail && !isPhone && !isDone && !isError) {
    // Still queue a UI update just for the counters, but no event log
    queueUiUpdate();
    return;
  }

  let cls = 'ev--log';
  let content = '';

  if (isEmail) {
    cls = 'ev--email';
    content = `<div class="ev-flex"><span class="ev-icon">📧</span><div class="ev-body"><div class="ev-label">New Email Found</div><div class="ev-value">${payload.email}</div></div></div>`;
  } else if (isPhone) {
    cls = 'ev--phone';
    content = `<div class="ev-flex"><span class="ev-icon">📱</span><div class="ev-body"><div class="ev-label">New Phone Found</div><div class="ev-value">${payload.phone}</div></div></div>`;
  } else if (isDone) {
    cls = 'ev--done';
    content = `<div class="ev-flex"><span class="ev-icon">✅</span><div class="ev-body"><div class="ev-label">Completed</div><div class="ev-value">${payload.message || 'Scraping finished successfully.'}</div></div></div>`;
  } else if (isError) {
    cls = 'ev--error';
    content = `<div class="ev-flex"><span class="ev-icon">❌</span><div class="ev-body"><div class="ev-label">Error</div><div class="ev-value">${payload.message || 'An error occurred.'}</div></div></div>`;
  }

  _pendingEvents.push({ cls, content });

  // Keep pending array small to avoid memory bloat
  if (_pendingEvents.length > 50) {
    _pendingEvents = _pendingEvents.slice(_pendingEvents.length - MAX_EVENTS_IN_DOM);
  }

  queueUiUpdate();
}

/** 
 * Batches DOM updates to run at most once every 300ms.
 * Massively improves performance when processing thousands of leads per second.
 */
function queueUiUpdate() {
  if (_uiUpdateQueued) return;
  _uiUpdateQueued = true;

  setTimeout(() => {
    _uiUpdateQueued = false;

    // Update counters
    if (liveLeadCountEl) liveLeadCountEl.textContent = totalLeads + ' leads';
    if (livePhoneCountEl) livePhoneCountEl.textContent = totalPhones + ' phones';

    // Update Feed
    if (eventsEl && _pendingEvents.length > 0) {
      // Create a document fragment to append multiple items safely at once
      const fragment = document.createDocumentFragment();

      // We only insert the newest N items if there's a huge backlog
      const toRender = _pendingEvents.slice(-MAX_EVENTS_IN_DOM).reverse();

      for (const ev of toRender) {
        const row = document.createElement("li");
        row.className = `ev-item ${ev.cls}`;
        row.innerHTML = ev.content;
        fragment.appendChild(row);
      }

      eventsEl.prepend(fragment);

      // Trim DOM elements
      while (eventsEl.children.length > MAX_EVENTS_IN_DOM) {
        eventsEl.removeChild(eventsEl.lastChild);
      }

      _pendingEvents = []; // clear queue
    }
  }, 300);
}

function attachToJob(jobId) {
  setStatus(`Attaching to job ${jobId}...`, 'running');
  const stream = new EventSource(`/api/jobs/${jobId}/events`);

  stream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    addEvent(payload);

    const jobStatusEl = document.getElementById(`status - ${jobId}`);
    if (jobStatusEl) {
      const s = payload.type.replace('job-', '');
      jobStatusEl.textContent = s.toUpperCase();
      jobStatusEl.className = `status - ${s}`;
    }

    if (payload.type === 'info' && payload.message === 'Job started') {
      setStatus(`Job ${jobId} running...`, 'running');
    }

    if (payload.type === 'lead-saved' || payload.type === 'city-update' || payload.type === 'phone-saved') {
      if (payload.fileName) ensureFileLink(jobId, payload.fileName);
      if (payload.emailFileName) ensureFileLink(jobId, payload.emailFileName);
      if (payload.allEmailsFileName) ensureFileLink(jobId, payload.allEmailsFileName);
      if (payload.phoneFileName) ensureFileLink(jobId, payload.phoneFileName);
      if (payload.allPhonesFileName) ensureFileLink(jobId, payload.allPhonesFileName);
    }

    if (payload.type === 'usage-update') {
      const usageQuotaEl = document.getElementById('usageQuotaEl');
      if (usageQuotaEl && payload.usage) {
        usageQuotaEl.style.display = 'inline-block';
        const limits = (currentUser && !currentUser.isAdmin) ? getPlanLimits(currentUser.subscriptionPlan) : { daily: payload.dailyLimit, monthly: payload.monthlyLimit };
        usageQuotaEl.textContent = `Emails: ${payload.usage.dailyCount} / ${limits.daily} | Month: ${payload.usage.monthlyCount} / ${limits.monthly}`;
      }
    }
    if (payload.type === 'job-completed' || payload.type === 'job-complete' || payload.type === 'job-stopped' || payload.type === 'job-failed') {
      const isDone = payload.type.includes('complete');
      const isStopped = payload.type === 'job-stopped';
      setStatus(isDone ? 'Completed' : isStopped ? 'Stopped' : 'Failed', isDone ? 'done' : 'error');
      stream.close();
      loadHistory();
      updateQueueStatus();
    }
  };

  stream.onerror = () => console.log('Job stream disconnected.');
}

logoutBtn?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

function selectedValues(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function renderCheckboxList(container, values, selectAllEl) {
  container.innerHTML = "";
  if (selectAllEl) selectAllEl.checked = false; // Reset Select All when list changes

  if (!values || !values.length) {
    container.textContent = "No data available.";
    return;
  }
  values.forEach((value) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type = "checkbox" value = "${value}" /> ${value}`;
    container.appendChild(label);
  });
}

function setupSelectAll(selectAllEl, container) {
  if (!selectAllEl || !container) return;
  selectAllEl?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
    });
  });
}

setupSelectAll(selectAllStates, stateContainer);
setupSelectAll(selectAllCities, cityContainer);

// --- AUTO-MAIL (ADMIN) UI LOGIC ---
async function initAutoMailUI() {
    if (!adminAutoMailCard) return;
    adminAutoMailCard.style.display = 'block';

    enableAutoMailEl.addEventListener('change', () => {
        autoMailSettingsEl.style.display = enableAutoMailEl.checked ? 'block' : 'none';
        if (enableAutoMailEl.checked) {
            loadAutoMailTemplates();
            loadSenderSmtps();
        }
    });

    templateSelectEl.addEventListener('change', () => {
        const val = templateSelectEl.value;
        if (val === 'new') {
            resetAutoMailForm();
        } else {
            const t = autoMailTemplates.find(x => x.id === val);
            if (t) populateAutoMailForm(t);
        }
    });

    btnSaveTemplateEl.addEventListener('click', async () => {
        const payload = {
            id: templateSelectEl.value === 'new' ? null : templateSelectEl.value,
            name: templateNameEl.value.trim(),
            senderName: senderNameEl.value.trim(),
            subject: subjectEl.value.trim(),
            htmlContent: htmlEl.value.trim(),
            smtpAccountIds: [...(smtpListEl.querySelectorAll('input:checked'))].map(i => i.value)
        };

        if (!payload.name || !payload.senderName || !payload.subject || !payload.htmlContent) {
            alert("Please fill in all template fields.");
            return;
        }

        try {
            btnSaveTemplateEl.disabled = true;
            btnSaveTemplateEl.textContent = 'Saving...';
            const res = await fetchJson('/api/admin/auto-mail-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.success) {
                alert("Template saved!");
                await loadAutoMailTemplates();
                templateSelectEl.value = res.id;
            }
        } catch (err) {
            alert("Failed to save template: " + err.message);
        } finally {
            btnSaveTemplateEl.disabled = false;
            btnSaveTemplateEl.textContent = 'Save Template';
        }
    });

    btnDeleteTemplateEl.addEventListener('click', async () => {
        const id = templateSelectEl.value;
        if (id === 'new') return;
        if (!confirm("Are you sure you want to delete this template?")) return;

        try {
            await fetchJson(`/api/admin/auto-mail-templates/${id}`, { method: 'DELETE' });
            alert("Template deleted.");
            await loadAutoMailTemplates();
            resetAutoMailForm();
        } catch (err) {
            alert("Failed to delete template: " + err.message);
        }
    });
}

async function loadAutoMailTemplates() {
    try {
        const data = await fetchJson('/api/admin/auto-mail-templates');
        autoMailTemplates = data.templates || [];
        renderAutoMailTemplates();
    } catch (err) {
        console.error("Failed to load auto-mail templates:", err);
    }
}

function renderAutoMailTemplates() {
    const currentVal = templateSelectEl.value;
    templateSelectEl.innerHTML = '<option value="new">+ Create New Template</option>' +
        autoMailTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (autoMailTemplates.find(t => t.id === currentVal)) {
        templateSelectEl.value = currentVal;
    }
}

async function loadSenderSmtps() {
    try {
        const data = await fetchJson('/api/sender/smtp');
        const accounts = data.accounts || [];
        if (accounts.length === 0) {
            smtpListEl.innerHTML = '<div class="text-[10px] text-slate-500 italic">No SMTP accounts found in Sender.</div>';
            return;
        }

        const selectedIds = templateSelectEl.value !== 'new' 
            ? (autoMailTemplates.find(t => t.id === templateSelectEl.value)?.smtpAccountIds || [])
            : [];

        smtpListEl.innerHTML = accounts.map(acc => `
            <label class="flex items-center gap-2 p-1.5 hover:bg-red-50 rounded cursor-pointer transition-colors">
                <input type="checkbox" value="${acc.id}" class="w-3.5 h-3.5 text-red-600 rounded border-slate-300" ${selectedIds.includes(acc.id) ? 'checked' : ''}>
                <span class="text-[11px] font-medium text-slate-700 truncate">${acc.user} (${acc.host})</span>
            </label>
        `).join('');
    } catch (err) {
        smtpListEl.innerHTML = '<div class="text-[10px] text-red-500">Failed to load SMTP accounts.</div>';
    }
}

function resetAutoMailForm() {
    templateNameEl.value = '';
    senderNameEl.value = '';
    subjectEl.value = '';
    htmlEl.value = '';
    smtpListEl.querySelectorAll('input').forEach(i => i.checked = false);
}

function populateAutoMailForm(t) {
    templateNameEl.value = t.name;
    senderNameEl.value = t.senderName;
    subjectEl.value = t.subject;
    htmlEl.value = t.htmlContent;
    
    const checkboxes = smtpListEl.querySelectorAll('input');
    checkboxes.forEach(i => {
        i.checked = t.smtpAccountIds.includes(i.value);
    });
}

async function fetchJson(url, options = {}) {
  // Always include session cookie for backend authentication
  options.credentials = options.credentials || "include";

  const response = await fetch(url, options);
  if (response.status === 401 && !url.includes("/api/me")) {
    window.location.href = "/login.html";
    return;
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch { }
    throw new Error(message);
  }
  return response.json();
}

async function loadCountries() {
  try {
    const metadata = await fetchJson("/api/metadata");
    countryEl.innerHTML = metadata.countries.map((country) => `<option value = "${country}" > ${country}</option> `).join("");
    if (countryEl.value) {
      await loadLocationDetails(countryEl.value);
    }
  } catch (error) {
    console.error("Could not load countries", error);
  }
}

async function loadLocationDetails(country) {
  try {
    const details = await fetchJson(`/api/location?country=${encodeURIComponent(country)}`);
    renderCheckboxList(stateContainer, details.states || [], selectAllStates);
    renderCheckboxList(cityContainer, details.cities || [], selectAllCities);
  } catch (error) {
    console.error(`Could not load locations for ${country}`, error);
  }
}

countryEl?.addEventListener("change", async () => {
  await loadLocationDetails(countryEl.value);
});

async function loadCategories() {
  try {
    const { categories } = await fetchJson("/api/categories");
    const selectEl = document.getElementById("jobCategory");
    if (selectEl) {
      const currentVal = selectEl.value;
      selectEl.innerHTML = '<option value="">-- Select a Campaign --</option>' +
        categories.map(c => `<option value = "${c.id}" > ${c.name}</option> `).join("");

      const exists = categories.find(c => c.id === currentVal);
      if (exists) selectEl.value = currentVal;
    }

    // Update the history filter dropdown
    const filterSelect = document.getElementById("historyCategoryFilter");
    if (filterSelect) {
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = '<option value="all">All Campaigns</option>' +
        categories.map(c => `<option value = "${c.id}" > ${c.name}</option> `).join("");
      const exists = categories.find(c => c.id === currentVal);
      filterSelect.value = exists ? currentVal : "all";
    }
  } catch (err) {
    console.error("Could not load categories", err);
  }
}

// Handle Add Category Button
const addCategoryBtn = document.getElementById("addCategoryBtn");
if (addCategoryBtn) {
  addCategoryBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const name = prompt("Enter a name for the new campaign:");
    if (!name?.trim()) return;

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() })
      });

      if (!res.ok) {
        let errorMsg = "Failed to create campaign";
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch { }
        alert(errorMsg);
        return;
      }

      const { category } = await res.json();
      await loadCategories();

      // Select the newly created category
      const selectEl = document.getElementById("jobCategory");
      if (selectEl) selectEl.value = category.id;

    } catch (err) {
      alert("Error creating campaign");
      console.error(err);
    }
  });
}

// Add event listener to the history category filter
const historyCategoryFilter = document.getElementById("historyCategoryFilter");
if (historyCategoryFilter) {
  historyCategoryFilter?.addEventListener("change", () => loadHistory());
}

async function loadHistory() {
  try {
    const history = await fetchJson("/api/history");
    historyEl.innerHTML = "";
    if (history.length === 0) {
      historyEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No search history yet.</p>';
      return;
    }
    const filterVal = historyCategoryFilter ? historyCategoryFilter.value : "all";

    let filteredHistory = history;
    if (filterVal !== "all") {
      filteredHistory = history.filter(job => job.params.category === filterVal);
      if (filteredHistory.length === 0) {
        historyEl.innerHTML = `<p style = "color:var(--text-muted);font-size:13px;padding:8px 0;" > No jobs found in this campaign.</p> `;
        return;
      }
    }

    filteredHistory.forEach((job) => {
      const div = document.createElement("div");
      div.className = "history-item";
      const date = new Date(job.createdAt).toLocaleString();
      const params = job.params;
      const citiesList = params.cities || [];
      const statesList = params.states || [];

      let locationText = params.country;
      if (statesList.length > 0) {
        locationText += ` &ndash; ${statesList.join(", ")} `;
      }

      let citiesText = "";
      if (citiesList.length > 5) {
        citiesText = citiesList.slice(0, 5).join(", ") + ` (+${citiesList.length - 5} more)`;
      } else {
        citiesText = citiesList.join(", ");
      }

      const fileList = (job.files || []);

      const isPrimary = (f) => f === "all_emails.txt" || f === "all_phones.txt" || f.endsWith(".csv");

      const primaryFiles = fileList.filter(isPrimary);
      const secondaryFiles = fileList.filter(f => !isPrimary(f) && (f.endsWith(".txt") || f.endsWith(".json")));

      const renderFileBtn = (f, isPhone) => {
        const style = isPhone ? `border-color: var(--purple); color: var(--purple); background: rgba(139, 92, 246, 0.12)` : ``;
        return `<div class="history-file-row">
           <span style="font-size:13px; font-weight:500; color:#374151; display:flex; align-items:center; gap:6px; word-break: break-all;">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
             ${f}
           </span>
           <div style="display:flex; gap:4px; flex-shrink: 0;">
             <a href="#" onclick="openFilePreview('${job.id}', '${f}'); return false;" class="download-btn" style="padding: 4px 8px; ${style}">View</a>
             <a data-file-name="${f}" href="/api/jobs/${job.id}/files/${f}" target="_blank" class="download-btn" style="padding: 4px 8px; ${style}">Download</a>
           </div>
         </div> `;
      };

      const primaryHtml = primaryFiles.map(f => renderFileBtn(f, f.includes("phone"))).join("");
      const secondaryHtml = secondaryFiles.map(f => renderFileBtn(f, f.includes("phone"))).join("");

      const toggleSecondaryBtn = secondaryFiles.length > 0
        ? `<div style = "width: 100%; margin-top: 5px;" > <button class="btn btn--ghost btn--sm" onclick="toggleSecondaryFiles('sec-${job.id}')" style="font-size: 0.75rem; padding: 4px 8px; width:100%; justify-content:center;">Show all files (${secondaryFiles.length})</button></div> `
        : "";

      const fileButtons = `
        ${primaryHtml}
        ${toggleSecondaryBtn}
  <div id="sec-${job.id}" style="display: none; width: 100%; margin-top: 8px; flex-direction: column;">
    ${secondaryHtml}
  </div>
  `;

      const isStoppable = job.status === "running";
      const isRestartable = job.status === "failed" || job.status === "stopped";
      const stopButton = isStoppable ? `<button class="stop-btn" onclick="stopJob('${job.id}')">&#x25A0; Stop</button>` : "";
      const restartButton = isRestartable ? `<button class="restart-btn" onclick="restartJob('${job.id}')" style="background:var(--blue-primary); color:white; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;">&#x21BB; Restart</button>` : "";

      const emailListId = `emails-${job.id}`;

      div.innerHTML = `
    <div class="history-meta-row" >
          <div class="history-meta">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="history-date">${date}</span>
            </div>
            <div class="history-location" title="${params.country} - ${params.cities.join(", ")}">
               <strong>${locationText}</strong><br>
               <span style="font-size:0.9em; color:var(--text-muted)">${citiesText}</span>
            </div>
            <div class="history-niches">${params.niches.join(" &middot; ")}</div>
          </div>
    <div class="history-actions">
      <span class="status-chip ${job.status}" id="status-${job.id}">${job.status}</span>
      ${stopButton}
      ${restartButton}
      <button class="toggle-btn" onclick="toggleEmails('${emailListId}')">Files</button>
    </div>
        </div>
    ${job.error ? `<div class="error-message" style="margin-top:6px">Error: ${job.error}</div>` : ""}
  <div id="${emailListId}" class="email-dropdown" style="display: none; flex-direction: column;">
    ${fileButtons}
  </div>
  `;
      historyEl.appendChild(div);
    });
  } catch (error) {
    console.error("Could not load history", error);
  }
}

window.toggleEmails = function (id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = el.style.display === "none" ? "flex" : "none";
    // Toggle button text if needed
    const btn = el.previousElementSibling.querySelector('.toggle-btn');
    if (btn) {
      btn.textContent = el.style.display === "none" ? "View Files" : "Hide Files";
    }
  }
};

window.toggleSecondaryFiles = function (id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = el.style.display === "none" ? "flex" : "none";
    const btn = el.previousElementSibling.querySelector('button');
    if (btn) {
      const isHidden = el.style.display === "none";
      const count = el.children.length;
      btn.textContent = isHidden ? `Show all files(${count})` : `Hide extra files`;
    }
  }
};

window.stopJob = async function (jobId) {
  if (!confirm("Are you sure you want to stop this job?")) return;
  try {
    await fetchJson(`/api/jobs/${jobId}/stop`, { method: "POST" });
    loadHistory();
    updateQueueStatus();
  } catch (error) {
    alert("Failed to stop job: " + error.message);
  }
};

window.restartJob = async function (jobId) {
  if (!confirm("Are you sure you want to restart this job? It will resume from the last saved state.")) return;
  try {
    const res = await fetchJson(`/api/jobs/${jobId}/restart`, { method: "POST" });
    if (res.success) {
      alert("Job restart requested!");
      loadHistory();
      updateQueueStatus();
      if (typeof attachToJob === 'function') attachToJob(jobId);
    }
  } catch (error) {
    alert("Failed to restart job: " + error.message);
  }
};

async function updateQueueStatus() {
  try {
    const status = await fetchJson("/api/queue?_=" + Date.now());
    if (queueStatusEl) {
      let maxText;
      if (currentUser) {
        if (currentUser.isAdmin) {
          maxText = 'Unlimited';
        } else {
          const limits = getPlanLimits(currentUser.subscriptionPlan);
          maxText = limits?.concurrentJobs ?? 1;
        }
      } else {
        maxText = '...';
      }
      queueStatusEl.textContent = `${status.active} active · max ${maxText} concurrent`;
    }
  } catch (error) {
    console.error("Could not update queue status", error);
  }
}

let _queuePollingStarted = false;
function startQueuePolling() {
  updateQueueStatus();
  if (_queuePollingStarted) return; // prevent duplicate intervals
  _queuePollingStarted = true;
  setInterval(updateQueueStatus, 5000);
}

document.getElementById("expandNiches")?.addEventListener("click", async () => {
  const niches = nichesEl.value.split("\n").map((x) => x.trim()).filter(Boolean);
  if (!niches.length) return;
  try {
    const data = await fetchJson("/api/expand-niches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niches })
    });
    expandedNichesEl.textContent = `Expanded niches: ${data.expandedNiches.join(", ")}`;
  } catch (error) {
    expandedNichesEl.textContent = `Niche expansion failed: ${error.message}`;
  }
});

document.getElementById("run")?.addEventListener("click", async () => {
  const niches = nichesEl.value.split("\n").map((x) => x.trim()).filter(Boolean);
  const states = selectedValues(stateContainer);
  const includeGoogleMaps = (googleMapsModeEl?.value || "yes") === "yes";
  const scrapeMode = getScrapeMode();
  const country = countryEl.value;

  const allSites = ["facebook.com", "instagram.com", "linkedin.com/in", "twitter.com", "reddit.com"];
  let sites = [...allSites];
  const smLeaveItEl = document.getElementById("smLeaveIt");

  const runErrorBox = document.getElementById("runErrorBox");
  if (runErrorBox) runErrorBox.style.display = "none";

  if (smLeaveItEl && !smLeaveItEl.checked) {
    const selectedSites = Array.from(document.querySelectorAll(".sm-site:checked")).map(el => el.value);
    if (selectedSites.length > 0) {
      sites = [...selectedSites, ...allSites.filter(s => !selectedSites.includes(s))];
    }
  }

  if (!niches.length || !states.length) {
    if (runErrorBox) {
      runErrorBox.innerHTML = "<strong>Missing Fields:</strong><br>Please enter at least one niche and select at least one State / Region before starting.";
      runErrorBox.style.display = "block";
    }
    setStatus("Select at least one niche and one state.", 'error');
    return;
  }

  // === Auto-resolve all cities for the selected states ===
  statusEl.textContent = "Resolving cities for selected states…";
  let cities = [];
  try {
    const cityFetches = states.map(state =>
      fetchJson(`/api/location?country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`)
        .then(d => d.cities || [])
        .catch(() => [])
    );
    const results = await Promise.all(cityFetches);
    cities = [...new Set(results.flat())];
  } catch (err) {
    console.warn("Could not auto-resolve cities, falling back to country-wide list.", err);
  }

  // Fallback: if state-level cities are empty, use all country cities
  if (!cities.length) {
    try {
      const details = await fetchJson(`/api/location?country=${encodeURIComponent(country)}`);
      cities = details.cities || [];
    } catch (err) {
      console.warn("Fallback city fetch also failed.", err);
    }
  }

  if (!cities.length) {
    if (runErrorBox) {
      runErrorBox.innerHTML = "<strong>No cities found:</strong><br>Could not resolve any cities for the selected states. Please try a different state or country.";
      runErrorBox.style.display = "block";
    }
    setStatus("No cities resolved for selected states.", 'error');
    return;
  }

  statusEl.textContent = "Submitting job to queue...";
  eventsEl.innerHTML = "";
  filesEl.innerHTML = "";

  try {
    const jobCategory = document.getElementById("jobCategory")?.value;

    let autoMailConfig = null;
    if (currentUser?.isAdmin && enableAutoMailEl?.checked) {
        const smtpAccountIds = [...(smtpListEl.querySelectorAll('input:checked'))].map(i => i.value);
        if (smtpAccountIds.length === 0) {
            alert("Please select at least one SMTP account for Auto-Mail.");
            return;
        }
        autoMailConfig = {
            senderName: senderNameEl.value.trim(),
            subject: subjectEl.value.trim(),
            htmlContent: htmlEl.value.trim(),
            smtpAccountIds
        };
        if (!autoMailConfig.senderName || !autoMailConfig.subject || !autoMailConfig.htmlContent) {
            alert("Please fill in all Auto-Mail template fields.");
            return;
        }
    }

    const { jobId, status } = await fetchJson("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country,
        states,
        cities,
        niches,
        includeGoogleMaps,
        scrapeMode,
        sites,
        category: jobCategory,
        autoMailConfig
      })
    });

    setStatus(`Job ${jobId} is ${status}. Waiting...`, 'running');
    totalLeads = 0;
    totalPhones = 0;
    if (liveLeadCountEl) liveLeadCountEl.textContent = '0 leads';
    if (livePhoneCountEl) livePhoneCountEl.textContent = '0 phones';
    if (phoneFilesEl) phoneFilesEl.innerHTML = '';

    // Refresh history, queue status, and category list immediately
    loadHistory();
    updateQueueStatus();
    loadCategories();

    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      addEvent(payload);

      if (payload.type === 'info' && payload.message === 'Job started') {
        setStatus(`Job ${jobId} running...`, 'running');
      }

      if (payload.type === 'lead-saved' || payload.type === 'city-update' || payload.type === 'phone-saved') {
        if (payload.fileName) ensureFileLink(jobId, payload.fileName);
        if (payload.emailFileName) ensureFileLink(jobId, payload.emailFileName);
        if (payload.allEmailsFileName) ensureFileLink(jobId, payload.allEmailsFileName);
        if (payload.phoneFileName) ensureFileLink(jobId, payload.phoneFileName);
        if (payload.allPhonesFileName) ensureFileLink(jobId, payload.allPhonesFileName);
      }

      if (payload.type === 'usage-update') {
        const usageQuotaEl = document.getElementById('usageQuotaEl');
        if (usageQuotaEl && payload.usage) {
          usageQuotaEl.style.display = 'inline-block';
          const limits = (currentUser && !currentUser.isAdmin) ? getPlanLimits(currentUser.subscriptionPlan) : { daily: payload.dailyLimit, monthly: payload.monthlyLimit };
          usageQuotaEl.textContent = `Emails: ${payload.usage.dailyCount}/${limits.daily} | Month: ${payload.usage.monthlyCount}/${limits.monthly}`;
        }
      }

      if (payload.type === 'job-completed' || payload.type === 'job-complete') {
        setStatus('Completed', 'done');
        stream.close(); loadHistory(); updateQueueStatus();
        (payload.files || []).forEach((file) => ensureFileLink(jobId, file));
      }

      if (payload.type === 'job-stopped') {
        setStatus('Stopped by user', 'idle');
        stream.close(); loadHistory(); updateQueueStatus();
      }

      if (payload.type === 'job-failed') {
        setStatus(`Failed: ${payload.message}`, 'error');
        stream.close(); loadHistory(); updateQueueStatus();
      }
    };

    stream.onerror = () => console.log('Job stream disconnected (might be finished or queued).');
  } catch (error) {
    if (runErrorBox) {
      runErrorBox.innerHTML = `<strong>Could not start scraper:</strong><br>${error.message}`;
      runErrorBox.style.display = "block";
    }
    setStatus(`Failed to start: ${error.message}`, 'error');
  }
});

function ensureFileLink(jobId, fileName) {
  if (!fileName) return;
  // We accept all files now so we can categorize them

  const historyContainer = document.getElementById(`emails-${jobId}`);
  if (!historyContainer) return; // Wait for history to render first

  const isPrimary = fileName === "all_emails.txt" || fileName === "all_phones.txt" || fileName.endsWith(".csv");
  const existing = historyContainer.querySelector(`a[data-file-name="${fileName}"]`);
  if (existing) return;

  const style = fileName.includes("phone") ? `border-color:var(--purple);color:var(--purple);background:rgba(139,92,246,0.12)` : ``;
  const fileHtml = `
    <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; margin-bottom:6px;">
      <span style="font-size:13px; font-weight:500; color:#374151; display:flex; align-items:center; gap:6px; word-break: break-all;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        ${fileName}
      </span>
      <div style="display:flex; gap:4px; flex-shrink: 0;">
        <a href="#" onclick="openFilePreview('${jobId}', '${fileName}'); return false;" class="download-btn" style="padding: 4px 8px; ${style}">View</a>
        <a data-file-name="${fileName}" href="/api/jobs/${jobId}/files/${fileName}" target="_blank" class="download-btn" style="padding: 4px 8px; ${style}">Download</a>
      </div>
    </div>
  `;

  if (isPrimary) {
    // Insert before the toggle button or secondary container
    const toggleBtnDiv = historyContainer.querySelector('div[style*="width: 100%"]');
    if (toggleBtnDiv) {
      toggleBtnDiv.insertAdjacentHTML("beforebegin", fileHtml);
    } else {
      historyContainer.insertAdjacentHTML("afterbegin", fileHtml);
    }
  } else {
    // It's a secondary file
    let secContainer = document.getElementById(`sec-${jobId}`);

    // Create the secondary container and toggle if it doesn't exist yet
    if (!secContainer) {
      const toggleHtml = `<div style="width: 100%; margin-top: 5px;"><button class="btn btn--ghost btn--sm" onclick="toggleSecondaryFiles('sec-${jobId}')" style="font-size: 0.75rem; padding: 4px 8px; width:100%; justify-content:center;">Show all files (1)</button></div>`;
      secContainer = document.createElement('div');
      secContainer.id = `sec-${jobId}`;
      secContainer.style.cssText = "display: none; width: 100%; margin-top: 8px; flex-direction: column;";
      historyContainer.insertAdjacentHTML("beforeend", toggleHtml);
      historyContainer.appendChild(secContainer);
    } else {
      // Update count
      const btn = secContainer.previousElementSibling.querySelector('button');
      if (btn) {
        const count = secContainer.children.length + 1;
        if (secContainer.style.display === "none") {
          btn.textContent = `Show all files (${count})`;
        }
      }
    }

    secContainer.insertAdjacentHTML("beforeend", fileHtml);
  }
}



// ── Phone query preview event wiring ─────────────────────────
document.querySelectorAll('input[name="scrapeMode"]').forEach(r => r.addEventListener('change', updatePhoneQueryPreview));
nichesEl?.addEventListener('input', updatePhoneQueryPreview);
countryEl?.addEventListener('change', updatePhoneQueryPreview);
cityContainer?.addEventListener('change', updatePhoneQueryPreview);
// Initial call once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  updatePhoneQueryPreview();

  // Social media priority group toggle
  const smLeaveItEl = document.getElementById("smLeaveIt");
  const smSiteEls = document.querySelectorAll(".sm-site");

  if (smLeaveItEl) {
    smLeaveItEl.addEventListener("change", (e) => {
      const isLeaveIt = e.target.checked;
      smSiteEls.forEach(el => {
        el.disabled = isLeaveIt;
        if (isLeaveIt) el.checked = false;
        el.parentElement.style.opacity = isLeaveIt ? '0.5' : '1';
      });
    });
  }

  // Close Modal bindings
  if (document.getElementById('closeModalBtn')) {
    document.getElementById('closeModalBtn').addEventListener('click', () => {
      document.getElementById('filePreviewModal').style.display = 'none';
    });
  }
});

// ── File Preview Logic ─────────────────────────
window.openFilePreview = async function (jobId, fileName) {
  const modal = document.getElementById('filePreviewModal');
  const titleEl = document.getElementById('modalFileName');
  const contentEl = document.getElementById('modalFileContent');
  const downloadBtn = document.getElementById('modalDownloadBtn');

  if (!modal || !titleEl || !contentEl || !downloadBtn) return;

  titleEl.textContent = `Loading ${fileName}...`;
  contentEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">Fetching file contents...</div>';
  downloadBtn.href = `/api/jobs/${jobId}/files/${fileName}`;
  downloadBtn.setAttribute('download', fileName);
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/jobs/${jobId}/files/${fileName}`);
    if (!res.ok) throw new Error("Failed to load file");

    const text = await res.text();
    titleEl.textContent = fileName;

    if (fileName.endsWith('.csv')) {
      // Render CSV as a table
      const rows = text.split('\n').filter(r => r.trim());
      if (rows.length === 0) {
        contentEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">CSV is empty.</div>';
        return;
      }

      const tableRows = rows.map((row, idx) => {
        const cols = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || row.split(',');
        const cleanCols = cols.map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

        if (idx === 0) { // Header
          return `<tr>${cleanCols.map(c => `<th>${c}</th>`).join('')}</tr>`;
        }
        return `<tr>${cleanCols.map(c => `<td>${c}</td>`).join('')}</tr>`;
      });

      contentEl.innerHTML = `
        <div class="csv-table-wrapper">
          <table class="csv-table">
            ${tableRows.join('')}
          </table>
        </div>
      `;
    } else {
      // Render as raw text
      contentEl.innerHTML = `<pre>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
    }

  } catch (err) {
    titleEl.textContent = "Error";
    contentEl.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--red);">Could not load file. It may no longer exist on the server.</div>`;
    console.error(err);
  }
};
// ── Initial Setup ─────────────────────────
checkAuth();

export { fetchJson, checkAuth as checkAuthAndSetupSidebar };
