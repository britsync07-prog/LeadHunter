/**
 * API interaction module for the SaaS frontend.
 */

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });
  if (!res.ok) {
    let msg = "API Request Failed";
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function getMe() {
  return fetchJson("/api/me");
}

export async function getMetadata() {
  return fetchJson("/api/metadata");
}

export async function getLocationDetails(country) {
  return fetchJson(`/api/location?country=${encodeURIComponent(country)}`);
}

export async function getCitiesForState(country, state) {
  return fetchJson(`/api/location?country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`);
}

export async function getCategories() {
  return fetchJson("/api/categories");
}

export async function deleteCategory(id) {
  return fetch("/api/categories/" + id, { method: "DELETE" });
}

export async function createCategory(name) {
  return fetchJson("/api/categories", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export async function stopJob(jobId) {
  return fetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
}

export async function deleteJob(jobId) {
  return fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
}

export async function getHistory() {
    return fetchJson("/api/history");
}

export async function getQueueStatus() {
    return fetchJson("/api/queue");
}

export async function getAdminUsers(query = '') {
    const url = query ? `/api/admin/users?q=${encodeURIComponent(query)}` : '/api/admin/users';
    return fetchJson(url);
}

export async function createAdminUser(data) {
    return fetchJson('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

export async function updateAdminUserPlan(userId, plan) {
    return fetchJson(`/api/admin/users/${userId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plan })
    });
}

export async function toggleAdminRole(userId, isAdmin) {
    return fetchJson(`/api/admin/users/${userId}/admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isAdmin })
    });
}

export async function toggleUserSuspension(userId, suspended) {
    return fetchJson(`/api/admin/users/${userId}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ suspended })
    });
}

export async function resetUserPassword(userId, password) {
    return fetchJson(`/api/admin/users/${userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password })
    });
}

export async function deleteAdminUser(userId) {
    return fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
}

export async function logout() {
    return fetch('/api/logout', { method: 'POST' });
}
