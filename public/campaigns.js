// Utility function to fetch JSON
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    throw new Error(`Failed to fetch ${url}`);
  }
  const data = await res.json();
  if (url === '/api/me' && (data.subscriptionPlan === 'expired' || data.subscriptionPlan === 'free')) {
    window.location.href = '/expired.html';
    return;
  }
  return data;
}

// Global state
let categories = [];
let userHistory = [];
let selectedCategoryId = null;

// DOM Elements
const categoryListContainer = document.getElementById('categoryListContainer');
const centerTitle = document.getElementById('centerTitle');
const centerSubtitle = document.getElementById('centerSubtitle');
const jobsListContainer = document.getElementById('jobsListContainer');
const viewerFileName = document.getElementById('viewerFileName');
const viewerContent = document.getElementById('viewerContent');
const downloadBtn = document.getElementById('downloadBtn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [catRes, histRes] = await Promise.all([
      fetchJson('/api/categories'),
      fetchJson('/api/history')
    ]);

    categories = catRes.categories || [];
    userHistory = histRes || [];

    renderCategoryList();
  } catch (err) {
    console.error('Failed to load initial data:', err);
    categoryListContainer.innerHTML = '<div class="empty-state">Failed to load campaigns.</div>';
  }
});

// Render the left Sidebar
function renderCategoryList() {
  if (categories.length === 0) {
    categoryListContainer.innerHTML = `
      <div class="empty-state">
        <div style="font-size:13px; margin-bottom:12px;">No campaigns found.</div>
        <a href="/dashboard.html" class="btn btn--primary btn--sm" style="text-decoration:none">Create one</a>
      </div>
    `;
    return;
  }

  categoryListContainer.innerHTML = '';

  categories.forEach(cat => {
    // Count jobs in this category
    const jobCount = userHistory.filter(job => job.params.category === cat.id).length;

    const div = document.createElement('div');
    div.className = `category-item ${selectedCategoryId === cat.id ? 'active' : ''}`;
    div.innerHTML = `
      <div style="font-size: 14px; font-weight: 500;">${cat.name}</div>
      <div class="category-meta">${jobCount} job${jobCount === 1 ? '' : 's'} &bull; ${new Date(cat.createdAt).toLocaleDateString()}</div>
    `;

    div.addEventListener('click', () => selectCategory(cat.id));
    categoryListContainer.appendChild(div);
  });
}

// Handle Category Selection
function selectCategory(id) {
  selectedCategoryId = id;
  renderCategoryList(); // Update active states

  const cat = categories.find(c => c.id === id);
  if (!cat) return;

  centerTitle.textContent = cat.name;
  centerSubtitle.textContent = `Viewing jobs for ${cat.name}`;

  renderJobsList(cat.id);

  // Reset the file viewer when changing categories
  clearFileViewer();
}

// Render the center Panel (Jobs belonging to selected category)
function renderJobsList(categoryId) {
  const jobs = userHistory.filter(job => job.params.category === categoryId);

  if (jobs.length === 0) {
    jobsListContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>No jobs found for this campaign.</span>
      </div>
    `;
    return;
  }

  jobsListContainer.innerHTML = '';

  jobs.forEach(job => {
    const date = new Date(job.createdAt).toLocaleString();
    const params = job.params;
    const citiesList = params.cities || [];
    const statesList = params.states || [];

    let locationText = params.country;
    if (statesList.length > 0) {
      locationText += ` &ndash; ${statesList.join(", ")}`;
    }

    let citiesText = "";
    if (citiesList.length > 5) {
      citiesText = citiesList.slice(0, 5).join(", ") + ` (+${citiesList.length - 5} more)`;
    } else {
      citiesText = citiesList.join(", ");
    }

    // Categorize files
    const emailFiles = (job.files || []).filter(f =>
      f.includes("_emails.txt") || f === "all_emails.txt" || f === "google_maps_emails.txt"
    );
    const phoneFiles = (job.files || []).filter(f =>
      f.includes("_phones.txt") || f === "all_phones.txt"
    );
    const csvFiles = (job.files || []).filter(f => f.endsWith('.csv'));

    // Create chips
    const createChip = (fileName, typeClass, icon) => `
      <div class="file-chip ${typeClass}" onclick="viewFile('${job.id}', '${fileName}', this)">
        <span>${icon}</span> ${fileName}
      </div>
    `;

    const div = document.createElement('div');
    div.className = 'cat-job-card';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <span class="status-chip ${job.status}">${job.status}</span>
        <span style="font-size:11px; color:var(--text-muted);">${date}</span>
      </div>
      <div class="history-location" title="${params.country} - ${params.cities.join(", ")}" style="font-weight:600; font-size:14px; color:var(--text-primary); margin-top:10px;">
        <strong>${locationText}</strong><br>
        <span style="font-size:0.9em; color:var(--text-muted); font-weight:400">${citiesText}</span>
      </div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">
        Niches: ${params.niches.join(", ")}
      </div>
      
      <div class="files-container" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
        <div style="font-size:11px; font-weight:600; color:var(--text-secondary); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">Output Files</div>
        ${csvFiles.map(f => createChip(f, 'csv', '&#x1F4CA;')).join('')}
        ${emailFiles.map(f => createChip(f, 'email', '&#x2709;')).join('')}
        ${phoneFiles.map(f => createChip(f, 'phone', '&#x260E;')).join('')}
        ${(job.files || []).length === 0 ? '<span style="font-size:12px; color:var(--text-muted);">No files generated yet.</span>' : ''}
      </div>
    `;
    jobsListContainer.appendChild(div);
  });
}

// Fetch and display a file in the right Panel
window.viewFile = async function (jobId, fileName, chipEl) {
  // Update active state on chips
  document.querySelectorAll('.file-chip').forEach(el => el.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');

  viewerFileName.textContent = `Loading ${fileName}...`;
  viewerFileName.style.color = 'var(--text-primary)';

  downloadBtn.href = `/api/jobs/${jobId}/files/${fileName}`;
  downloadBtn.setAttribute('download', fileName);
  downloadBtn.style.display = 'inline-flex';

  viewerContent.innerHTML = `
    <div class="empty-state">
      <div class="spinner" style="width:24px; height:24px; border-width:3px; margin-bottom:16px;"></div>
      <span>Fetching file contents...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/jobs/${jobId}/files/${fileName}`);
    if (!res.ok) throw new Error("Failed to load file");

    const text = await res.text();
    viewerFileName.textContent = fileName;

    if (fileName.endsWith('.csv')) {
      renderCsv(text, fileName);
    } else {
      renderRawText(text);
    }

  } catch (err) {
    viewerFileName.textContent = fileName;
    viewerContent.innerHTML = `
      <div class="empty-state" style="color:var(--red);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>Error loading file. It may no longer exist.</span>
      </div>
    `;
    console.error(err);
  }
};

function renderCsv(text, fileName) {
  const lines = text.split('\n').filter(r => r.trim());
  if (lines.length === 0) {
    viewerContent.innerHTML = '<div class="empty-state">File is empty.</div>';
    return;
  }

  const tableRows = lines.map((row, idx) => {
    // Basic CSV parser handling quoted strings
    const cols = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || row.split(',');
    const cleanCols = cols.map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

    if (idx === 0) {
      return `<tr>${cleanCols.map(c => `<th>${c}</th>`).join('')}</tr>`;
    }
    return `<tr>${cleanCols.map(c => `<td>${c}</td>`).join('')}</tr>`;
  });

  viewerContent.innerHTML = `
    <div style="width: 100%; height: 100%; overflow: auto;">
      <table class="csv-table">
        ${tableRows.join('')}
      </table>
    </div>
  `;
}

function renderRawText(text) {
  viewerContent.innerHTML = `
    <pre style="
      margin: 0; 
      padding: 24px; 
      font-size: 13px; 
      color: #e2e8f0; 
      white-space: pre-wrap; 
      word-break: break-all;
    ">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  `;
}

function clearFileViewer() {
  viewerFileName.textContent = "No file selected";
  viewerFileName.style.color = "var(--text-muted)";
  downloadBtn.style.display = "none";
  viewerContent.innerHTML = `
    <div class="empty-state">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
       </svg>
       <span>Select a file from the list to view its contents here.</span>
    </div>
  `;
}
