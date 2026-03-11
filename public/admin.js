// admin.js — LeadHunter Admin Dashboard Logic

let allUsers = [];
let editingUserId = null;
let deletingUserId = null;

const PLAN_CONFIG = {
    premium: { cls: 'plan-premium', label: 'Premium' },
    advance: { cls: 'plan-advance', label: 'Advance' },
    basic: { cls: 'plan-basic', label: 'Basic' },
    free: { cls: 'plan-free', label: 'Free Trial' },
    expired: { cls: 'plan-free', label: 'Expired' },
};

async function api(path, options = {}) {
    const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ─── Auth Guard ────────────────────────────────────────────────
async function init() {
    try {
        const me = await api('/api/me');
        if (!me.username) throw new Error('Not logged in');

        // Check admin
        const check = await api('/api/admin/users').catch(() => null);
        if (!check) {
            document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,sans-serif;color:#ef4444;font-size:18px;">⛔ Admin access required. <a href="/dashboard.html" style="margin-left:12px;color:#6366f1;text-decoration:underline;">Back to Dashboard</a></div>`;
            return;
        }

        document.getElementById('adminUsername').textContent = `admin: ${me.username}`;
        await loadUsers();
    } catch {
        window.location.href = '/login.html';
    }
}

// ─── Load & render users ───────────────────────────────────────
async function loadUsers(q = '') {
    const url = q ? `/api/admin/users?q=${encodeURIComponent(q)}` : '/api/admin/users';
    const data = await api(url);
    allUsers = data.users || [];
    renderTable(allUsers);
    renderStats(allUsers);
}

function renderStats(users) {
    document.getElementById('statTotal').textContent = users.length;
    document.getElementById('statAdmins').textContent = users.filter(u => u.isAdmin).length;
    document.getElementById('statPremium').textContent = users.filter(u => u.subscriptionPlan === 'premium').length;
    document.getElementById('statTrial').textContent = users.filter(u => u.trialEndsAt && new Date(u.trialEndsAt) > new Date()).length;
}

function planBadge(plan) {
    const cfg = PLAN_CONFIG[plan] || { cls: 'plan-basic', label: plan || 'Free' };
    return `<span class="plan-badge ${cfg.cls}">${cfg.label}</span>`;
}

function formatDate(iso) {
    if (!iso) return '–';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function trialNote(user) {
    if (!user.trialEndsAt) return '';
    const end = new Date(user.trialEndsAt);
    if (end <= new Date()) return `<span class="text-slate-400 text-xs ml-1">(trial expired)</span>`;
    const days = Math.ceil((end - new Date()) / 86400000);
    return `<span class="text-blue-500 text-xs ml-1">(trial ${days}d left)</span>`;
}

function renderTable(users) {
    const tbody = document.getElementById('usersTableBody');
    document.getElementById('resultCount').textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`;

    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400 text-sm">No users found.</td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(u => `
    <tr class="border-b border-slate-50 transition-colors">
      <td class="px-5 py-3.5">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full ${u.isSuspended ? 'bg-gradient-to-br from-red-400 to-rose-500' : 'bg-gradient-to-br from-indigo-400 to-purple-500'} flex items-center justify-center text-white font-bold text-sm shrink-0">
            ${(u.username || '?')[0].toUpperCase()}
          </div>
          <div>
            <div class="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
              ${escHtml(u.username)}
              ${u.isAdmin ? '<span class="plan-badge admin-badge">Admin</span>' : ''}
              ${u.isSuspended ? '<span class="plan-badge" style="background:#fee2e2;color:#b91c1c;">Suspended</span>' : ''}
            </div>
            <div class="text-xs text-slate-400 font-mono">${escHtml(u.email || '–')}</div>
          </div>
        </div>
      </td>
      <td class="px-5 py-3.5">${planBadge(u.subscriptionPlan)} ${trialNote(u)}</td>
      <td class="px-5 py-3.5">
        ${u.isSuspended
            ? '<span class="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Suspended</span>'
            : '<span class="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Active</span>'
        }
      </td>
      <td class="px-5 py-3.5 text-xs text-slate-400">${formatDate(u.createdAt)}</td>
      <td class="px-5 py-3.5">
        <div class="flex items-center justify-end gap-1">
          <!-- Edit plan -->
          <button onclick="openEdit('${u.id}','${escAttr(u.username)}','${u.subscriptionPlan}')"
            class="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer" title="Change plan">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          <!-- Reset password -->
          <button onclick="openResetPassword('${u.id}','${escAttr(u.username)}')"
            class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="Reset password">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 16v2"/><path d="M12 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>
          </button>
          <!-- Toggle admin -->
          <button onclick="toggleAdmin('${u.id}', ${u.isAdmin ? 'false' : 'true'})"
            class="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors cursor-pointer" title="${u.isAdmin ? 'Remove admin' : 'Make admin'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </button>
          <!-- Suspend / Unsuspend -->
          <button onclick="toggleSuspend('${u.id}', ${u.isSuspended ? 'false' : 'true'})"
            class="p-1.5 ${u.isSuspended ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-500 hover:bg-amber-50'} rounded-lg transition-colors cursor-pointer" title="${u.isSuspended ? 'Unsuspend user' : 'Suspend user'}">
            ${u.isSuspended
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><line x1="3" y1="3" x2="21" y2="21" stroke-width="2"/></svg>'
        }
          </button>
          <!-- Delete -->
          <button onclick="openDelete('${u.id}','${escAttr(u.username)}')"
            class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Delete user">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// ─── Search ────────────────────────────────────────────────────
let searchTimer;
function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        const q = document.getElementById('searchInput').value.trim();
        loadUsers(q);
    }, 300);
}

// ─── Create user ───────────────────────────────────────────────
function openCreate() { document.getElementById('createModal').classList.add('open'); }
function closeCreate(e) {
    if (e && e.target !== document.getElementById('createModal')) return;
    document.getElementById('createModal').classList.remove('open');
    document.getElementById('createForm').reset();
    document.getElementById('createError').classList.add('hidden');
}

async function submitCreate(e) {
    e.preventDefault();
    const errEl = document.getElementById('createError');
    const btn = document.getElementById('createSubmitBtn');
    errEl.classList.add('hidden');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        await api('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({
                username: document.getElementById('c_username').value.trim(),
                email: document.getElementById('c_email').value.trim(),
                password: document.getElementById('c_password').value,
                plan: document.getElementById('c_plan').value,
                isAdmin: document.getElementById('c_isAdmin').checked,
            }),
        });
        document.getElementById('createModal').classList.remove('open');
        document.getElementById('createForm').reset();
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = 'Create User';
    }
}

// ─── Edit plan ─────────────────────────────────────────────────
function openEdit(id, username, plan) {
    editingUserId = id;
    document.getElementById('editUsername').textContent = username;
    document.getElementById('editPlan').value = plan;
    document.getElementById('editError').classList.add('hidden');
    document.getElementById('editModal').classList.add('open');
}
function closeEdit(e) {
    if (e && e.target !== document.getElementById('editModal')) return;
    document.getElementById('editModal').classList.remove('open');
    editingUserId = null;
}

async function submitEdit() {
    const errEl = document.getElementById('editError');
    errEl.classList.add('hidden');
    try {
        await api(`/api/admin/users/${editingUserId}/plan`, {
            method: 'PATCH',
            body: JSON.stringify({ plan: document.getElementById('editPlan').value }),
        });
        document.getElementById('editModal').classList.remove('open');
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
}

// ─── Toggle admin ──────────────────────────────────────────────
async function toggleAdmin(userId, makeAdmin) {
    try {
        await api(`/api/admin/users/${userId}/admin`, {
            method: 'PATCH',
            body: JSON.stringify({ isAdmin: makeAdmin === 'true' || makeAdmin === true }),
        });
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        alert(err.message);
    }
}

// ─── Suspend / Unsuspend ───────────────────────────────────────
async function toggleSuspend(userId, suspend) {
    try {
        await api(`/api/admin/users/${userId}/suspend`, {
            method: 'PATCH',
            body: JSON.stringify({ suspended: suspend === 'true' || suspend === true }),
        });
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        alert(err.message);
    }
}

// ─── Delete user ───────────────────────────────────────────────
function openDelete(id, username) {
    deletingUserId = id;
    document.getElementById('deleteUsername').textContent = username;
    document.getElementById('deleteError').classList.add('hidden');
    document.getElementById('deleteModal').classList.add('open');
}
function closeDelete(e) {
    if (e && e.target !== document.getElementById('deleteModal')) return;
    document.getElementById('deleteModal').classList.remove('open');
    deletingUserId = null;
}

async function submitDelete() {
    const errEl = document.getElementById('deleteError');
    errEl.classList.add('hidden');
    try {
        await api(`/api/admin/users/${deletingUserId}`, { method: 'DELETE' });
        document.getElementById('deleteModal').classList.remove('open');
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
}

// ─── Reset password ─────────────────────────────────────────────
function openResetPassword(id, username) {
    editingUserId = id;
    document.getElementById('resetPasswordUsername').textContent = username;
    document.getElementById('resetNewPassword').value = '';
    document.getElementById('resetPasswordError').classList.add('hidden');
    document.getElementById('resetPasswordModal').classList.add('open');
}
function closeResetPassword(e) {
    if (e && e.target !== document.getElementById('resetPasswordModal')) return;
    document.getElementById('resetPasswordModal').classList.remove('open');
    editingUserId = null;
}

async function submitResetPassword() {
    const errEl = document.getElementById('resetPasswordError');
    const newPass = document.getElementById('resetNewPassword').value;
    errEl.classList.add('hidden');

    if (newPass.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.';
        errEl.classList.remove('hidden');
        return;
    }

    try {
        await api(`/api/admin/users/${editingUserId}/password`, {
            method: 'PATCH',
            body: JSON.stringify({ password: newPass }),
        });
        document.getElementById('resetPasswordModal').classList.remove('open');
        alert('Password updated successfully.');
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
}

// ─── Logout ────────────────────────────────────────────────────
async function logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
}

// ─── Boot ──────────────────────────────────────────────────────
init();
