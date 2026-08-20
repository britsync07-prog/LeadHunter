/**
 * admin.js — LeadHunter Admin Dashboard Logic
 * Refactored for modularity and resiliency.
 */

import * as API from './js/api.js';
import * as Auth from './js/auth.js';
import * as Utils from './js/utils.js';

let allUsers = [];
let editingUserId = null;
let deletingUserId = null;

// Tracking toggle state (loaded from server on init)
let trackingSettings = { openTrackingEnabled: true, clickTrackingEnabled: true };

const PLAN_CONFIG = {
    premium: { cls: 'plan-premium', label: 'Premium' },
    advance: { cls: 'plan-advance', label: 'Advance' },
    none: { cls: 'plan-none', label: 'Unpaid' },
    free: { cls: 'plan-free', label: 'Free Trial' },
    expired: { cls: 'plan-expired', label: 'Expired' },
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const user = await Auth.checkAuth();
        if (!user || !user.isAdmin) {
             document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,sans-serif;color:#ef4444;font-size:18px;">⛔ Admin access required. <a href="/dashboard.html" style="margin-left:12px;color:#6366f1;text-decoration:underline;">Back to Dashboard</a></div>`;
             return;
        }

        const usernameEl = document.getElementById('adminUsername');
        if (usernameEl) usernameEl.textContent = `admin: ${user.username}`;
        
        // Load users, tracking settings, and system SMTP settings in parallel
        await Promise.all([loadUsers(), loadTrackingSettings(), loadSystemSmtpSettings()]);
    } catch (err) {
        console.error("Admin init failed:", err);
    }
});

// --- TRACKING SETTINGS ---
async function loadTrackingSettings() {
    try {
        const data = await API.fetchJson('/api/admin/tracking-settings');
        trackingSettings = data;
        renderTrackingToggles();
    } catch (err) {
        console.error('Failed to load tracking settings:', err);
    }
}

function renderTrackingToggles() {
    applyToggle('toggleOpen',  'knobOpen',  trackingSettings.openTrackingEnabled);
    applyToggle('toggleClick', 'knobClick', trackingSettings.clickTrackingEnabled);
}

function applyToggle(btnId, knobId, isEnabled) {
    const btn  = document.getElementById(btnId);
    const knob = document.getElementById(knobId);
    if (!btn || !knob) return;
    // Swap background colour class
    if (isEnabled) {
        btn.classList.remove('bg-slate-300');
        btn.classList.add('bg-emerald-500');
    } else {
        btn.classList.remove('bg-emerald-500');
        btn.classList.add('bg-slate-300');
    }
    // Slide knob
    knob.style.transform = isEnabled ? 'translateX(20px)' : 'translateX(0)';
}

window.toggleTracking = async function(type) {
    const key      = type === 'open' ? 'openTrackingEnabled' : 'clickTrackingEnabled';
    const newValue = !trackingSettings[key];

    // Optimistic update
    trackingSettings[key] = newValue;
    renderTrackingToggles();

    try {
        await API.fetchJson('/api/admin/tracking-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: newValue })
        });
    } catch (err) {
        // Rollback on server error
        trackingSettings[key] = !newValue;
        renderTrackingToggles();
        alert('Failed to update tracking setting. Please try again.');
    }
};

// --- SYSTEM SMTP SETTINGS ---
async function loadSystemSmtpSettings() {
    try {
        const data = await API.fetchJson('/api/admin/system-smtp');
        const smtp = data.smtp || {};

        const hostEl = document.getElementById('sys_smtp_host');
        const portEl = document.getElementById('sys_smtp_port');
        const secureEl = document.getElementById('sys_smtp_secure');
        const userEl = document.getElementById('sys_smtp_user');
        const passEl = document.getElementById('sys_smtp_pass');
        const fromNameEl = document.getElementById('sys_smtp_from_name');
        const fromEmailEl = document.getElementById('sys_smtp_from_email');
        const badgeEl = document.getElementById('systemSmtpStatusBadge');

        if (hostEl) hostEl.value = smtp.host || '';
        if (portEl) portEl.value = smtp.port || 587;
        if (secureEl) secureEl.checked = !!smtp.secure;
        if (userEl) userEl.value = smtp.user || '';
        if (passEl) passEl.value = smtp.pass || '';
        if (fromNameEl) fromNameEl.value = smtp.fromName || 'LeadHunter Security';
        if (fromEmailEl) fromEmailEl.value = smtp.fromEmail || '';

        if (badgeEl) {
            const isConfigured = smtp.host && smtp.user && smtp.pass;
            if (isConfigured) {
                badgeEl.textContent = 'Configured & Active';
                badgeEl.className = 'plan-badge bg-emerald-100 text-emerald-700';
            } else {
                badgeEl.textContent = 'Not Configured';
                badgeEl.className = 'plan-badge bg-amber-100 text-amber-700';
            }
        }
    } catch (err) {
        console.error('Failed to load system SMTP settings:', err);
    }
}

window.saveSystemSmtp = async function(e) {
    e.preventDefault();
    const alertEl = document.getElementById('systemSmtpAlert');
    const btn = document.getElementById('btnSaveSystemSmtp');

    if (alertEl) {
        alertEl.className = 'text-xs font-medium hidden p-3 rounded-lg mb-3';
        alertEl.textContent = '';
    }

    const payload = {
        host: document.getElementById('sys_smtp_host')?.value?.trim() || '',
        port: parseInt(document.getElementById('sys_smtp_port')?.value || '587', 10),
        secure: document.getElementById('sys_smtp_secure')?.checked || false,
        user: document.getElementById('sys_smtp_user')?.value?.trim() || '',
        pass: document.getElementById('sys_smtp_pass')?.value?.trim() || '',
        fromName: document.getElementById('sys_smtp_from_name')?.value?.trim() || 'LeadHunter Security',
        fromEmail: document.getElementById('sys_smtp_from_email')?.value?.trim() || ''
    };

    if (btn) btn.disabled = true;

    try {
        const res = await API.fetchJson('/api/admin/system-smtp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (alertEl) {
            alertEl.className = 'text-xs font-medium p-3 rounded-lg mb-3 bg-emerald-50 text-emerald-700 border border-emerald-200';
            alertEl.textContent = res.message || 'System SMTP configuration saved successfully.';
            alertEl.classList.remove('hidden');
        }

        const badgeEl = document.getElementById('systemSmtpStatusBadge');
        if (badgeEl) {
            badgeEl.textContent = 'Configured & Active';
            badgeEl.className = 'plan-badge bg-emerald-100 text-emerald-700';
        }
    } catch (err) {
        if (alertEl) {
            alertEl.className = 'text-xs font-medium p-3 rounded-lg mb-3 bg-red-50 text-red-600 border border-red-200';
            alertEl.textContent = err.message || 'Failed to save system SMTP configuration.';
            alertEl.classList.remove('hidden');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.togglePasswordVisibility = function(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
        }
    }
};

window.openTestSmtpModal = function() {
    const modal = document.getElementById('testSmtpModal');
    const resultEl = document.getElementById('testSmtpResult');
    if (resultEl) {
        resultEl.className = 'text-xs font-medium hidden p-3 rounded-lg';
        resultEl.textContent = '';
    }
    if (modal) modal.classList.add('open');
};

window.closeTestSmtpModal = function(e) {
    if (e && e.target !== e.currentTarget && e.currentTarget !== e.target.closest('.modal-backdrop')) return;
    const modal = document.getElementById('testSmtpModal');
    if (modal) modal.classList.remove('open');
};

window.submitTestSmtp = async function(e) {
    e.preventDefault();
    const recipient = document.getElementById('test_smtp_recipient')?.value?.trim();
    const resultEl = document.getElementById('testSmtpResult');
    const btn = document.getElementById('btnRunSmtpTest');

    if (!recipient) return;

    if (resultEl) {
        resultEl.className = 'text-xs font-medium p-3 rounded-lg bg-blue-50 text-blue-700 border border-blue-200';
        resultEl.textContent = 'Connecting to SMTP server and verifying credentials...';
        resultEl.classList.remove('hidden');
    }

    if (btn) btn.disabled = true;

    // Collect current form inputs to test in-flight values
    const payload = {
        host: document.getElementById('sys_smtp_host')?.value?.trim() || '',
        port: parseInt(document.getElementById('sys_smtp_port')?.value || '587', 10),
        secure: document.getElementById('sys_smtp_secure')?.checked || false,
        user: document.getElementById('sys_smtp_user')?.value?.trim() || '',
        pass: document.getElementById('sys_smtp_pass')?.value?.trim() || '',
        fromName: document.getElementById('sys_smtp_from_name')?.value?.trim() || 'LeadHunter Security',
        fromEmail: document.getElementById('sys_smtp_from_email')?.value?.trim() || '',
        testRecipient: recipient
    };

    try {
        const res = await API.fetchJson('/api/admin/system-smtp/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (resultEl) {
            resultEl.className = 'text-xs font-medium p-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200';
            resultEl.textContent = res.message || 'SMTP verified and test email sent successfully!';
        }
    } catch (err) {
        if (resultEl) {
            resultEl.className = 'text-xs font-medium p-3 rounded-lg bg-red-50 text-red-600 border border-red-200';
            resultEl.textContent = err.message || 'SMTP verification failed.';
        }
    } finally {
        if (btn) btn.disabled = false;
    }
// --- VIEW NAVIGATION (USERS vs NEWSLETTER) ---
window.switchAdminView = function(view) {
    const tabUsers = document.getElementById('navTabUsers');
    const tabNews = document.getElementById('navTabNewsletters');
    const viewUsers = document.getElementById('viewUsersSection');
    const viewNews = document.getElementById('viewNewslettersSection');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');
    const btnCreate = document.getElementById('btnHeaderCreateUser');

    if (view === 'newsletters') {
        if (tabUsers) {
            tabUsers.className = 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 w-full text-left transition-colors cursor-pointer';
        }
        if (tabNews) {
            tabNews.className = 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 w-full text-left transition-colors cursor-pointer';
        }
        if (viewUsers) viewUsers.classList.add('hidden');
        if (viewNews) viewNews.classList.remove('hidden');

        if (pageTitle) pageTitle.textContent = 'Newsletter & Announcements Broadcast';
        if (pageSubtitle) pageSubtitle.textContent = 'Broadcast targeted emails across user tiers using your platform SMTP';
        if (btnCreate) btnCreate.classList.add('hidden');

        // Init newsletter view data
        onNewsletterSegmentChange();
        loadNewsletterHistory();

        // If editor is empty, pre-load announcement template
        const editor = document.getElementById('news_htmlContent');
        if (editor && !editor.value.trim()) {
            loadNewsletterTemplate('announcement');
        }
    } else {
        if (tabUsers) {
            tabUsers.className = 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 w-full text-left transition-colors cursor-pointer';
        }
        if (tabNews) {
            tabNews.className = 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 w-full text-left transition-colors cursor-pointer';
        }
        if (viewUsers) viewUsers.classList.remove('hidden');
        if (viewNews) viewNews.classList.add('hidden');

        if (pageTitle) pageTitle.textContent = 'Users & Platform Settings';
        if (pageSubtitle) pageSubtitle.textContent = 'Manage accounts, global tracking, and system SMTP';
        if (btnCreate) btnCreate.classList.remove('hidden');
    }
};

// --- NEWSLETTER TEMPLATES ---
const NEWSLETTER_TEMPLATES = {
    announcement: {
        subject: "🚀 Big Updates & New Features inside LeadHunter!",
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .hero { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%); padding: 36px 28px; text-align: center; color: #ffffff; }
    .hero h1 { margin: 0 0 10px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .hero p { margin: 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .badge { display: inline-block; background: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; margin-bottom: 12px; }
    .feature-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .btn { display: inline-block; background: #4f46e5; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 10px; margin: 20px 0; }
    .footer { padding: 20px 28px; background: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="hero">
      <div class="badge">Major Platform Update</div>
      <h1>Hello, {{username}}!</h1>
      <p>We've rolled out powerful new enhancements to supercharge your workflow.</p>
    </div>
    <div class="content">
      <p style="font-size: 15px; color: #334155;">We are thrilled to announce a brand new suite of features designed to make lead discovery and email outreach faster and more effective than ever before.</p>
      
      <div class="feature-box">
        <h3 style="margin-top: 0; font-size: 16px; color: #1e1b4b;">✨ What's New:</h3>
        <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 13px; line-height: 1.7;">
          <li><strong>Real-time Audience Filtering:</strong> Laser-target leads by country, niche, and tier.</li>
          <li><strong>High-Speed Sender Engine:</strong> Accelerated delivery with intelligent SMTP rotation.</li>
          <li><strong>Advanced Deliverability Tracking:</strong> Granular insights into open rates and click performance.</li>
        </ul>
      </div>

      <div style="text-align: center;">
        <a href="{{loginUrl}}" class="btn" target="_blank">Access Your Dashboard</a>
      </div>

      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px;">Your Current Account Tier: <strong style="color: #4f46e5;">{{plan}}</strong></p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} LeadHunter Platform. All rights reserved.
    </div>
  </div>
</body>
</html>`
    },
    feature: {
        subject: "✨ Feature Release: Discover the latest tools in LeadHunter",
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; }
    .header { padding: 28px; border-bottom: 1px solid #f1f5f9; text-align: center; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .pill { background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; display: inline-block; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="pill">Feature Spotlight</span>
      <h2 style="margin: 12px 0 0; color: #0f172a;">New Tools Are Now Live</h2>
    </div>
    <div class="content">
      <p>Hi <strong>{{username}}</strong>,</p>
      <p>We're constantly improving LeadHunter to provide you with the highest quality data and fastest outreach pipeline. Here is what just landed in your account:</p>
      <ul style="color: #475569; font-size: 14px; line-height: 1.8;">
        <li>⚡ Instant Verification & Deliverability Health Checks</li>
        <li>🎯 Smart Category Segmentation for Bulk Campaigns</li>
        <li>📊 Redesigned KPI Metrics and Real-time Activity Logs</li>
      </ul>
      <div style="text-align: center;">
        <a href="{{loginUrl}}" class="btn" target="_blank">Try New Features Now</a>
      </div>
    </div>
  </div>
</body>
</html>`
    },
    maintenance: {
        subject: "⚠️ Scheduled System Maintenance Notice",
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; }
    .header { background: #fef3c7; border-bottom: 1px solid #fde68a; padding: 24px 28px; }
    .content { padding: 28px; line-height: 1.6; }
    .time-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 14px; margin: 16px 0; font-family: monospace; font-size: 13px; color: #92400e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 style="margin: 0; color: #92400e; font-size: 18px;">⚠️ Scheduled System Maintenance</h2>
    </div>
    <div class="content">
      <p>Dear <strong>{{username}}</strong>,</p>
      <p>To ensure optimal platform reliability and performance, we will be conducting scheduled system maintenance during the window below:</p>
      <div class="time-box">
        <strong>Window:</strong> Sunday, 02:00 UTC – 04:00 UTC (Estimated 2 Hours)
      </div>
      <p style="font-size: 13px; color: #64748b;">During this brief maintenance window, campaign dispatching may experience momentary pauses. All queues will automatically resume immediately following completion.</p>
    </div>
  </div>
</body>
</html>`
    },
    offer: {
        subject: "🎁 Special Invitation: Upgrade your LeadHunter Account",
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #059669, #10b981); color: #ffffff; padding: 32px 28px; text-align: center; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .btn { display: inline-block; background: #059669; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 10px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 style="margin: 0 0 8px; font-size: 22px;">Upgrade Your LeadHunter Tier</h1>
      <p style="margin: 0; opacity: 0.9; font-size: 14px;">Unlock Unlimited Scrapes, Multi-SMTP Rotation & Priority Queues</p>
    </div>
    <div class="content">
      <p>Hello <strong>{{username}}</strong>,</p>
      <p>Take your outreach to the next level by upgrading your account plan. Premium accounts enjoy full access to our multi-SMTP rotating pool, unlimited niche expansions, and high-priority lead scrapers.</p>
      <div style="text-align: center;">
        <a href="{{loginUrl}}" class="btn" target="_blank">Upgrade to Premium Today</a>
      </div>
    </div>
  </div>
</body>
</html>`
    },
    blank: {
        subject: "LeadHunter Announcement",
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 28px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Hello {{username}},</h2>
    <p>Write your message here...</p>
  </div>
</body>
</html>`
    }
};

window.loadNewsletterTemplate = function(tplKey) {
    const tpl = NEWSLETTER_TEMPLATES[tplKey];
    if (!tpl) return;
    const subjectEl = document.getElementById('news_subject');
    const contentEl = document.getElementById('news_htmlContent');

    if (subjectEl) subjectEl.value = tpl.subject;
    if (contentEl) contentEl.value = tpl.html;

    updateNewsletterPreview();
};

window.updateNewsletterPreview = function() {
    const content = document.getElementById('news_htmlContent')?.value || '';
    const iframe = document.getElementById('news_previewIframe');
    if (!iframe) return;

    // Substitute preview sample placeholders
    const rendered = content
        .replace(/\{\{\s*username\s*\}\}/gi, 'John Doe')
        .replace(/\{\{\s*email\s*\}\}/gi, 'johndoe@example.com')
        .replace(/\{\{\s*plan\s*\}\}/gi, 'PREMIUM')
        .replace(/\{\{\s*loginUrl\s*\}\}/gi, window.location.origin + '/login.html')
        .replace(/\{\{\s*appUrl\s*\}\}/gi, window.location.origin);

    iframe.srcdoc = rendered;
};

window.insertNewsletterTag = function(tag) {
    const editor = document.getElementById('news_htmlContent');
    if (!editor) return;

    const startPos = editor.selectionStart || editor.value.length;
    const endPos = editor.selectionEnd || editor.value.length;
    const textBefore = editor.value.substring(0, startPos);
    const textAfter = editor.value.substring(endPos, editor.value.length);

    editor.value = textBefore + tag + textAfter;
    editor.selectionStart = editor.selectionEnd = startPos + tag.length;
    editor.focus();

    updateNewsletterPreview();
};

window.onNewsletterSegmentChange = async function() {
    const select = document.getElementById('news_targetSegment');
    const counter = document.getElementById('audienceLiveCounter');
    const segment = select?.value || 'all';

    if (counter) counter.textContent = 'Calculating...';

    try {
        const data = await API.fetchJson(`/api/admin/newsletter/audience-count?segment=${encodeURIComponent(segment)}`);
        if (counter) {
            const count = data.count || 0;
            counter.textContent = `${count} recipient${count !== 1 ? 's' : ''} eligible`;
        }
    } catch (err) {
        if (counter) counter.textContent = 'Error loading count';
    }
};

window.sendNewsletterTestEmail = async function() {
    const subject = document.getElementById('news_subject')?.value?.trim();
    const htmlContent = document.getElementById('news_htmlContent')?.value?.trim();
    const testEmail = document.getElementById('news_testEmail')?.value?.trim();
    const alertEl = document.getElementById('newsletterAlert');
    const btn = document.getElementById('btnSendNewsTest');

    if (!subject || !htmlContent) {
        alert('Please provide both a subject line and HTML body for your newsletter.');
        return;
    }

    if (alertEl) {
        alertEl.className = 'text-xs font-medium p-3 rounded-lg mb-4 bg-blue-50 text-blue-700 border border-blue-200';
        alertEl.textContent = 'Sending test newsletter via System SMTP...';
        alertEl.classList.remove('hidden');
    }

    if (btn) btn.disabled = true;

    try {
        const res = await API.fetchJson('/api/admin/newsletter/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, htmlContent, testEmail })
        });

        if (alertEl) {
            alertEl.className = 'text-xs font-medium p-3 rounded-lg mb-4 bg-emerald-50 text-emerald-700 border border-emerald-200';
            alertEl.textContent = res.message || 'Test newsletter delivered successfully!';
        }
    } catch (err) {
        if (alertEl) {
            alertEl.className = 'text-xs font-medium p-3 rounded-lg mb-4 bg-red-50 text-red-600 border border-red-200';
            alertEl.textContent = err.message || 'Failed to send test newsletter.';
        }
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.openBroadcastConfirmModal = async function() {
    const subject = document.getElementById('news_subject')?.value?.trim();
    const htmlContent = document.getElementById('news_htmlContent')?.value?.trim();
    const segment = document.getElementById('news_targetSegment')?.value || 'all';

    if (!subject || !htmlContent) {
        alert('Please provide both a subject line and HTML content before broadcasting.');
        return;
    }

    const modal = document.getElementById('broadcastConfirmModal');
    const segmentNameEl = document.getElementById('confirmSegmentName');
    const recipientCountEl = document.getElementById('confirmRecipientCount');

    const segmentLabels = {
        all: 'All Registered Users',
        premium: 'Premium Plan Users',
        advance: 'Advance Plan Users',
        free: 'Free Trial Users',
        expired: 'Expired / Unpaid Users',
        admins: 'Admin Accounts Only'
    };

    if (segmentNameEl) segmentNameEl.textContent = segmentLabels[segment] || segment;
    if (recipientCountEl) recipientCountEl.textContent = 'Counting recipients...';

    if (modal) modal.classList.add('open');

    try {
        const data = await API.fetchJson(`/api/admin/newsletter/audience-count?segment=${encodeURIComponent(segment)}`);
        if (recipientCountEl) {
            recipientCountEl.textContent = `${data.count || 0} active users`;
        }
    } catch (err) {
        if (recipientCountEl) recipientCountEl.textContent = 'Error calculating';
    }
};

window.closeBroadcastConfirmModal = function(e) {
    if (e && e.target !== e.currentTarget && e.currentTarget !== e.target.closest('.modal-backdrop')) return;
    const modal = document.getElementById('broadcastConfirmModal');
    if (modal) modal.classList.remove('open');
};

window.executeNewsletterBroadcast = async function() {
    const subject = document.getElementById('news_subject')?.value?.trim();
    const htmlContent = document.getElementById('news_htmlContent')?.value?.trim();
    const targetSegment = document.getElementById('news_targetSegment')?.value || 'all';
    const alertEl = document.getElementById('newsletterAlert');
    const btn = document.getElementById('btnExecuteBroadcast');

    if (btn) btn.disabled = true;

    try {
        const res = await API.fetchJson('/api/admin/newsletter/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, htmlContent, targetSegment })
        });

        closeBroadcastConfirmModal();

        if (alertEl) {
            alertEl.className = 'text-xs font-medium p-3 rounded-lg mb-4 bg-emerald-50 text-emerald-700 border border-emerald-200';
            alertEl.textContent = `🚀 ${res.message || 'Broadcast successfully queued and transmitting in background.'}`;
            alertEl.classList.remove('hidden');
        }

        // Refresh broadcast history table
        setTimeout(loadNewsletterHistory, 1000);
    } catch (err) {
        alert(`Broadcast Failed: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.loadNewsletterHistory = async function() {
    const tbody = document.getElementById('newsletterHistoryTableBody');
    if (!tbody) return;

    try {
        const data = await API.fetchJson('/api/admin/newsletter/history');
        const list = data.broadcasts || [];

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-400 text-xs">No newsletters broadcast yet.</td></tr>`;
            return;
        }

        const segmentBadgeCls = {
            premium: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            advance: 'bg-purple-50 text-purple-700 border-purple-200',
            free: 'bg-blue-50 text-blue-700 border-blue-200',
            expired: 'bg-slate-100 text-slate-600 border-slate-200',
            admins: 'bg-violet-50 text-violet-700 border-violet-200',
            all: 'bg-indigo-50 text-indigo-700 border-indigo-200'
        };

        tbody.innerHTML = list.map(b => {
            const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
            const badgeClass = segmentBadgeCls[b.targetSegment] || 'bg-slate-100 text-slate-600 border-slate-200';
            const statusColor = b.status === 'completed' ? 'text-emerald-600' : b.status === 'sending' ? 'text-blue-600 animate-pulse' : 'text-amber-600';

            return `
                <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td class="px-5 py-3.5 font-semibold text-slate-800 max-w-xs truncate">${Utils.escapeHtml(b.subject)}</td>
                    <td class="px-5 py-3.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border ${badgeClass}">${b.targetSegment}</span></td>
                    <td class="px-5 py-3.5 text-center font-mono font-bold text-slate-700">${b.recipientCount || 0}</td>
                    <td class="px-5 py-3.5 text-center font-mono text-xs">
                        <span class="font-bold ${statusColor}">${b.sentCount || 0} sent</span>
                        ${b.failedCount > 0 ? `<span class="text-red-500 font-bold ml-1">(${b.failedCount} fail)</span>` : ''}
                    </td>
                    <td class="px-5 py-3.5 text-xs text-slate-400 font-mono">${dateStr}</td>
                    <td class="px-5 py-3.5 text-right">
                        <button onclick="viewArchivedNewsletter('${b.id}')"
                            class="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 rounded border border-indigo-200 transition-colors cursor-pointer">
                            View HTML
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-red-500 text-xs">Failed to load broadcast history.</td></tr>`;
    }
};

window.viewArchivedNewsletter = async function(id) {
    const modal = document.getElementById('viewNewsletterModal');
    const subjectEl = document.getElementById('viewNewsSubject');
    const metaEl = document.getElementById('viewNewsMeta');
    const iframe = document.getElementById('viewNewsIframe');

    if (modal) modal.classList.add('open');
    if (metaEl) metaEl.textContent = 'Fetching archive content...';

    try {
        const data = await API.fetchJson(`/api/admin/newsletter/broadcasts/${id}`);
        const b = data.broadcast || {};

        if (subjectEl) subjectEl.textContent = b.subject || 'Newsletter Archive';
        if (metaEl) {
            metaEl.textContent = `Segment: ${b.targetSegment.toUpperCase()} · Sent to: ${b.recipientCount || 0} users · Date: ${new Date(b.createdAt).toLocaleString()}`;
        }
        if (iframe) iframe.srcdoc = b.htmlContent || '<p>No content archived.</p>';
    } catch (err) {
        if (metaEl) metaEl.textContent = 'Failed to load archive content.';
    }
};

window.closeViewNewsletterModal = function(e) {
    if (e && e.target !== e.currentTarget && e.currentTarget !== e.target.closest('.modal-backdrop')) return;
    const modal = document.getElementById('viewNewsletterModal');
    if (modal) modal.classList.remove('open');
};


    try {
        const data = await API.getAdminUsers(q);
        allUsers = data.users || [];
        renderTable(allUsers);
        renderStats(allUsers);
    } catch (err) {
        console.error("Failed to load users:", err);
    }
}

function renderStats(users) {
    const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setStat('statTotal', users.length);
    setStat('statAdmins', users.filter(u => u.isAdmin).length);
    setStat('statPremium', users.filter(u => u.subscriptionPlan === 'premium').length);
    setStat('statTrial', users.filter(u => u.subscriptionPlan === 'none' || u.subscriptionPlan === 'expired').length);
}

function renderTable(users) {
    const tbody = document.getElementById('usersTableBody');
    const resCount = document.getElementById('resultCount');
    if (resCount) resCount.textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`;

    if (!tbody) return;
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
              ${Utils.escapeHtml(u.username)}
              ${u.isAdmin ? '<span class="plan-badge admin-badge">Admin</span>' : ''}
              ${u.isSuspended ? '<span class="plan-badge" style="background:#fee2e2;color:#b91c1c;">Suspended</span>' : ''}
            </div>
            <div class="text-xs text-slate-400 font-mono">${Utils.escapeHtml(u.email || '–')}</div>
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
          <button onclick="openEdit('${u.id}','${Utils.escapeHtml(u.username).replace(/'/g, "\\'")}','${u.subscriptionPlan}')"
            class="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer" title="Change plan">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          <button onclick="openResetPassword('${u.id}','${Utils.escapeHtml(u.username).replace(/'/g, "\\'")}')"
            class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="Reset password">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 16v2"/><path d="M12 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>
          </button>
          <button onclick="toggleAdmin('${u.id}', ${u.isAdmin ? 'false' : 'true'})"
            class="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors cursor-pointer" title="${u.isAdmin ? 'Remove admin' : 'Make admin'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </button>
          <button onclick="toggleSuspend('${u.id}', ${u.isSuspended ? 'false' : 'true'})"
            class="p-1.5 ${u.isSuspended ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-500 hover:bg-amber-50'} rounded-lg transition-colors cursor-pointer" title="${u.isSuspended ? 'Unsuspend user' : 'Suspend user'}">
            ${u.isSuspended
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/><line x1="3" y1="3" x2="21" y2="21" stroke-width="2"/></svg>'
        }
          </button>
          <button onclick="openDelete('${u.id}','${Utils.escapeHtml(u.username).replace(/'/g, "\\'")}')"
            class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Delete user">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
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

// --- ACTIONS ---

window.onSearch = () => {
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(() => {
        const q = document.getElementById('searchInput').value.trim();
        loadUsers(q);
    }, 300);
};

window.openCreate = () => document.getElementById('createModal').classList.add('open');
window.closeCreate = (e) => {
    if (e && e.target !== document.getElementById('createModal')) return;
    document.getElementById('createModal').classList.remove('open');
    document.getElementById('createForm').reset();
    document.getElementById('createError').classList.add('hidden');
};

window.submitCreate = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('createError');
    const btn = document.getElementById('createSubmitBtn');
    errEl.classList.add('hidden');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        await API.createAdminUser({
            username: document.getElementById('c_username').value.trim(),
            email: document.getElementById('c_email').value.trim(),
            password: document.getElementById('c_password').value,
            plan: document.getElementById('c_plan').value,
            isAdmin: document.getElementById('c_isAdmin').checked,
        });
        window.closeCreate();
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false; btn.textContent = 'Create User';
    }
};

window.openEdit = (id, username, plan) => {
    editingUserId = id;
    document.getElementById('editUsername').textContent = username;
    document.getElementById('editPlan').value = plan;
    document.getElementById('editError').classList.add('hidden');
    document.getElementById('editModal').classList.add('open');
};

window.closeEdit = (e) => {
    if (e && e.target !== document.getElementById('editModal')) return;
    document.getElementById('editModal').classList.remove('open');
    editingUserId = null;
};

window.submitEdit = async () => {
    const errEl = document.getElementById('editError');
    errEl.classList.add('hidden');
    try {
        await API.updateAdminUserPlan(editingUserId, document.getElementById('editPlan').value);
        window.closeEdit();
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
};

window.toggleAdmin = async (userId, makeAdmin) => {
    try {
        await API.toggleAdminRole(userId, makeAdmin);
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        alert(err.message);
    }
};

window.toggleSuspend = async (userId, suspend) => {
    try {
        await API.toggleUserSuspension(userId, suspend);
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        alert(err.message);
    }
};

window.openDelete = (id, username) => {
    deletingUserId = id;
    document.getElementById('deleteUsername').textContent = username;
    document.getElementById('deleteError').classList.add('hidden');
    document.getElementById('deleteModal').classList.add('open');
};

window.closeDelete = (e) => {
    if (e && e.target !== document.getElementById('deleteModal')) return;
    document.getElementById('deleteModal').classList.remove('open');
    deletingUserId = null;
};

window.submitDelete = async () => {
    const errEl = document.getElementById('deleteError');
    errEl.classList.add('hidden');
    try {
        await API.deleteAdminUser(deletingUserId);
        window.closeDelete();
        await loadUsers(document.getElementById('searchInput').value.trim());
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
};

window.openResetPassword = (id, username) => {
    editingUserId = id;
    document.getElementById('resetPasswordUsername').textContent = username;
    document.getElementById('resetNewPassword').value = '';
    document.getElementById('resetPasswordError').classList.add('hidden');
    document.getElementById('resetPasswordModal').classList.add('open');
};

window.closeResetPassword = (e) => {
    if (e && e.target !== document.getElementById('resetPasswordModal')) return;
    document.getElementById('resetPasswordModal').classList.remove('open');
    editingUserId = null;
};

window.submitResetPassword = async () => {
    const errEl = document.getElementById('resetPasswordError');
    const newPass = document.getElementById('resetNewPassword').value;
    errEl.classList.add('hidden');

    if (newPass.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.';
        errEl.classList.remove('hidden');
        return;
    }

    try {
        await API.resetUserPassword(editingUserId, newPass);
        window.closeResetPassword();
        alert('Password updated successfully.');
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
};

window.logout = async () => {
    await API.logout();
    window.location.href = '/login.html';
};
