import fs from 'fs';
import * as cheerio from 'cheerio';

const HTML_FILES = ['public/sender.html', 'public/dashboard.html', 'public/checker.html'];

for (const file of HTML_FILES) {
    let html = fs.readFileSync(file, 'utf8');

    // 1. Remove the "dark" class from the HTML tag
    html = html.replace('<html lang="en" class="dark">', '<html lang="en">');

    const $ = cheerio.load(html, null, false);

    // 2. Update Sidebar background and shadow for Light Mode
    $('aside').removeClass('bg-brand-surface shadow-xl border-brand-border');
    $('aside').addClass('bg-white/80 backdrop-blur-xl border-slate-200 shadow-[0_8px_32px_rgba(31,38,135,0.07)]');

    // 3. Update Sidebar footer
    $('.bg-\\[\\#0A0F1C\\]').removeClass('bg-[#0A0F1C]').addClass('bg-slate-50 border-t border-slate-200');

    // 4. Update Topbar for Light Mode glassmorphism
    $('header').removeClass('bg-brand-base/80 border-brand-border');
    $('header').addClass('bg-white/70 backdrop-blur-xl border-slate-200 shadow-sm');

    // 5. Update UI Cards
    $('.bg-brand-card').removeClass('bg-brand-card border-brand-border shadow-card');
    $('.bg-brand-card').addClass('bg-white border-slate-200 shadow-[0_8px_32px_rgba(31,38,135,0.05)]');

    $('.bg-brand-surface\\/50').removeClass('bg-brand-surface/50 border-brand-border').addClass('bg-slate-50/80 border-slate-200');
    $('.border-brand-border').removeClass('border-brand-border').addClass('border-slate-200');

    // Checker specific surface overrides
    $('.bg-brand-surface').removeClass('bg-brand-surface').addClass('bg-white');

    // 6. Update Inputs and Textareas
    $('input, textarea, select').each((i, el) => {
        if ($(el).attr('type') === 'checkbox' || $(el).attr('type') === 'radio') return;
        $(el).removeClass('bg-brand-base bg-\\[\\#020617\\] border-brand-border');
        $(el).addClass('bg-white border-slate-200 shadow-sm');
    });

    // 7. Update generic backgrounds
    $('body').removeClass('bg-brand-base');
    $('body').addClass('bg-slate-50');

    fs.writeFileSync(file, $.html());
    console.log(`Rebuilt ${file} for Light Mode Glassmorphism!`);
}
