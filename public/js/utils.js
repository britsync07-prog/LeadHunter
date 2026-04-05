/**
 * Shared utility functions for the SaaS frontend.
 */

export function setStatus(text, mode = 'idle') {
  const statusEl = document.getElementById("status");
  const statusIndicator = document.getElementById("statusIndicator");
  if (statusEl) statusEl.textContent = text;
  if (statusIndicator) {
    const dot = statusIndicator.querySelector('.dot');
    if (dot) {
      dot.className = 'dot dot--' + mode;
    }
  }
}

export function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function selectedValues(container) {
  if (!container) return [];
  return [...container.querySelectorAll("input:checked")].map((i) => i.value);
}

export function syncSelectAllState(container, selectAllEl) {
  if (!container || !selectAllEl) return;
  const checks = container.querySelectorAll('input[type="checkbox"]');
  const checked = container.querySelectorAll('input[type="checkbox"]:checked');
  if (checked.length === 0) {
    selectAllEl.checked = false;
    selectAllEl.indeterminate = false;
  } else if (checked.length === checks.length) {
    selectAllEl.checked = true;
    selectAllEl.indeterminate = false;
  } else {
    selectAllEl.checked = false;
    selectAllEl.indeterminate = true;
  }
}

export function renderCheckboxList(container, items, selectAllEl, selectedItems = []) {
  if (!container) return;
  const currentSelected = new Set(selectedItems.length ? selectedItems : selectedValues(container));
  container.innerHTML = items.map((item) => `
    <label class="checkbox-card ${currentSelected.has(item) ? 'is-selected' : ''}">
      <input type="checkbox" value="${item}" ${currentSelected.has(item) ? "checked" : ""}>
      <span>${item}</span>
    </label>
  `).join("");

  if (selectAllEl) {
    syncSelectAllState(container, selectAllEl);
  }
}
