import fs from 'fs';
import * as cheerio from 'cheerio';

const HTML_FILES = ['public/sender.html', 'public/dashboard.html'];

const buildSidebar = (active) => `
  <!-- Sidebar -->
  <aside class="w-[220px] bg-brand-surface border-r border-brand-border flex flex-col fixed inset-y-0 left-0 z-50 shadow-xl">
    <div class="flex items-center gap-3 p-5 pb-4 border-b border-brand-border text-brand-primary font-bold text-lg tracking-tight">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
        <path d="M11 8v6M8 11h6" />
      </svg>
      <span>LeadHunter</span>
    </div>
    <nav class="flex-1 p-3 flex flex-col gap-1.5 overflow-y-auto">
      <a href="/dashboard.html" class="flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition-all ${active === 'dashboard' ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] cursor-default' : 'text-brand-secondary hover:bg-brand-hover hover:text-brand-text border border-transparent'}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        Scraper
      </a>
      <a href="/sender.html" id="navSender" class="flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition-all ${active === 'sender' ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] cursor-default' : 'text-brand-secondary hover:bg-brand-hover hover:text-brand-text border border-transparent'}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
        Sender
      </a>
      <a href="/categories.html" class="flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition-all text-brand-secondary hover:bg-brand-hover hover:text-brand-text border border-transparent">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
        Categories
      </a>
      <a href="/checker.html" id="navChecker" class="flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition-all text-brand-secondary hover:bg-brand-hover hover:text-brand-text border border-transparent">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3"/><path d="M3 12c1 0 3-1 3-3S4 6 3 6 0 7 0 9s2 3 3 3"/><path d="M12 3c0 1-1 3-3 3S6 4 6 3s1-3 3-3 3 2 3 3"/><path d="M12 21c0-1-1-3-3-3s-3 1-3 3 1 3 3 3 3-2 3-3"/></svg>
        Checker
      </a>
    </nav>
    <div class="p-3 border-t border-brand-border flex flex-col gap-2 bg-[#0A0F1C]">
      <div class="flex items-center gap-2 px-3 py-2.5 bg-brand-base rounded-md border border-brand-border text-sm text-brand-secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-brand-primary shrink-0"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
        <span id="userInfo" class="truncate font-mono text-xs">Loading...</span>
      </div>
      <button id="logoutBtn" class="flex items-center justify-center gap-2 px-3 py-2 w-full text-sm font-medium text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all cursor-pointer border border-transparent hover:border-red-500/20">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Logout
      </button>
    </div>
  </aside>
`;

for (const file of HTML_FILES) {
    const active = file.includes('dashboard') ? 'dashboard' : 'sender';
    let html = fs.readFileSync(file, 'utf8');

    // Wrap in a body class for Global styles
    html = html.replace('<body>', '<body class="bg-brand-base text-brand-text font-sans antialiased flex min-h-screen selection:bg-brand-primary/30">');

    const $ = cheerio.load(html, null, false);

    // Replace Sidebar
    $('.sidebar').replaceWith(buildSidebar(active));

    // Modify wrapper
    $('.main-wrapper').removeClass('main-wrapper').addClass('ml-[220px] flex-1 flex flex-col min-h-screen');

    // Replace Topbar classes
    $('.topbar').removeClass('topbar').addClass('h-[64px] bg-brand-base/80 backdrop-blur-md border-b border-brand-border flex items-center justify-between px-6 sticky top-0 z-40');
    $('.topbar-left').removeClass('topbar-left').addClass('flex items-center gap-4');
    $('.page-title').removeClass('page-title').addClass('text-xl font-semibold text-brand-text tracking-tight');
    $('.topbar-right').removeClass('topbar-right').addClass('flex items-center gap-3');

    // Replace Grid
    $('.content-grid').removeClass('content-grid').addClass('p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-7xl mx-auto overflow-y-auto');

    // Convert ui-cards
    $('.ui-card, .col-config, .col-results').each((i, el) => {
        $(el).removeClass('ui-card compact card--live col-config col-results');
        $(el).addClass('bg-brand-card border border-brand-border rounded-xl shadow-card overflow-hidden h-fit flex flex-col gap-4 p-5');
    });

    // Convert headers
    $('.card-header').each((i, el) => {
        $(el).removeClass('card-header').addClass('pb-3 border-b border-brand-border flex items-center gap-2.5 text-brand-text font-semibold');
        $(el).find('svg').addClass('text-brand-primary');
        $(el).find('h2').addClass('font-semibold text-brand-text m-0 text-base');
    });

    // Convert Inputs
    $('.ui-input, input[type="text"], input[type="email"], select, .ui-textarea, textarea').each((i, el) => {
        if ($(el).attr('type') === 'checkbox' || $(el).attr('type') === 'radio') return;
        $(el).removeClass('ui-input ui-textarea');
        $(el).addClass('w-full px-3 py-2.5 bg-brand-base border border-brand-border rounded-md text-sm text-brand-text font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all placeholder:text-brand-border');
        $(el).removeAttr('style');
    });

    // Convert Labels
    $('.field-label, label').each((i, el) => {
        if ($(el).closest('.checkbox-group').length > 0) return; // Skip inside checkboxes
        $(el).removeClass('field-label');
        $(el).addClass('block text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wide');
    });

    // Convert Buttons
    $('.ui-btn, .btn, button').each((i, el) => {
        if ($(el).attr('id') === 'logoutBtn') return;
        $(el).removeClass('ui-btn ui-btn-primary full-width mt-4 btn btn--primary btn--full btn--ghost btn--sm');
        if ($(el).text().includes('Expand') || $(el).text().includes('New')) {
            $(el).addClass('text-xs px-2 py-1 text-brand-primary hover:bg-brand-primary/10 rounded border border-transparent transition-colors cursor-pointer');
        } else {
            $(el).addClass('mt-2 w-full py-2.5 bg-brand-primary hover:bg-blue-600 text-white rounded-md text-sm font-semibold transition-all duration-200 flex items-center justify-center shadow-glow cursor-pointer gap-2');
        }
        $(el).removeAttr('style');
    });

    fs.writeFileSync(file, $.html());
    console.log(`Rebuilt ${file} with Tailwind CSS!`);
}
