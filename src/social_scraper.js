import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURATION ---
const DEFAULT_SITES = [
    "linkedin.com/in", "facebook.com", "instagram.com", "reddit.com", "x.com",
    "twitter.com", "tiktok.com", "youtube.com", "pinterest.com", "threads.net",
    "snapchat.com", "medium.com", "substack.com", "quora.com", "tumblr.com",
    "yelp.com", "foursquare.com", "nextdoor.com", "alignable.com", "trustpilot.com",
    "crunchbase.com", "wellfound.com", "angel.co", "about.me", "behance.net",
    "dribbble.com", "meetup.com", "eventbrite.com", "locanto.com", "gumtree.com",
    "craigslist.org", "yellowpages.com", "yell.com", "hotfrog.com", "manta.com",
    "kompass.com", "clutch.co", "tripadvisor.com"
];

const EMAIL_TERMS = ["@gmail.com", "@hotmail", "@outlook.com", "email me"];

const NICHE_EXPANSION_DICTIONARY = {
    "fitness": ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
    "trainer": ["Coach", "Instructor", "Consultant", "Mentor"],
    "yoga": ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
    "pilates": ["Pilates Coach", "Pilates Instructor"],
};

function emit(event) {
    console.log(JSON.stringify(event));
}

function extractEmail(text) {
    if (!text) return null;
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
    const match = text.match(emailRegex);
    return match ? match[0] : null;
}

function expandNiches(baseNiches) {
    const expanded = new Set();
    for (let niche of baseNiches) {
        const trimmed = niche.trim();
        if (!trimmed) continue;

        expanded.add(trimmed);
        const lower = trimmed.toLowerCase();

        for (const [token, matches] of Object.entries(NICHE_EXPANSION_DICTIONARY)) {
            if (lower.includes(token)) {
                matches.forEach(m => expanded.add(m));
            }
        }

        if (lower.includes("trainer")) {
            expanded.add(trimmed.replace(/trainer/i, "Coach"));
            expanded.add(trimmed.replace(/trainer/i, "Instructor"));
        }
    }
    return Array.from(expanded).filter(Boolean);
}

function sanitizeFileName(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Email search: site:SITE "NICHE" "CITY" ("@gmail.com" OR ...) */
function buildEmailQuery(niche, city, area, site) {
    const locationText = area ? `${area} ${city}`.trim() : city;
    const emailClause = "(" + EMAIL_TERMS.map((term) => `"${term}"`).join(" OR ") + ")";
    return `site:${site} "${niche}" "${locationText}" ${emailClause}`;
}

async function run() {
    let config;
    try {
        const inputData = fs.readFileSync(0, 'utf8');
        config = JSON.parse(inputData);
    } catch (err) {
        emit({ type: 'log', message: 'Failed to read config from stdin: ' + err.message });
        process.exit(1);
    }

    const { outputDir, country, cities, niches, sites = DEFAULT_SITES } = config;
    const allEmailsFile = path.join(outputDir, "all_emails.txt");
    const progressFile = path.join(outputDir, "social_progress.json");
    const seenEmails = new Set();

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    if (!fs.existsSync(allEmailsFile)) fs.writeFileSync(allEmailsFile, "");
    else {
        fs.readFileSync(allEmailsFile, 'utf8').split('\n').forEach(e => {
            if (e.trim()) seenEmails.add(e.trim().toLowerCase());
        });
    }

    const expandedNiches = expandNiches(niches);
    
    let startCityIdx = 0, startNicheIdx = 0, startSiteIdx = 0;
    if (fs.existsSync(progressFile)) {
        try {
            const state = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
            startCityIdx = state.cityIdx || 0;
            startNicheIdx = state.nicheIdx || 0;
            startSiteIdx = state.siteIdx || 0;
        } catch (e) { }
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");

    emit({ type: "job-start", message: `Starting Social Scraper (DuckDuckGo) JS Port` });

    try {
        for (let cIdx = startCityIdx; cIdx < cities.length; cIdx++) {
            const city = cities[cIdx];
            const sanitizedCity = sanitizeFileName(city);
            const sanitizedCountry = sanitizeFileName(country);
            const fileName = `${sanitizedCountry}_${sanitizedCity}_leads.txt`;
            const emailFileName = `${sanitizedCountry}_${sanitizedCity}_emails.txt`;
            const filePath = path.join(outputDir, fileName);
            const emailFilePath = path.join(outputDir, emailFileName);

            if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `--- LEADS FOR ${city}, ${country} ---\n\n`);
            if (!fs.existsSync(emailFilePath)) fs.writeFileSync(emailFilePath, "");

            for (let nIdx = (cIdx === startCityIdx ? startNicheIdx : 0); nIdx < expandedNiches.length; nIdx++) {
                const niche = expandedNiches[nIdx];
                for (let sIdx = (cIdx === startCityIdx && nIdx === startNicheIdx ? startSiteIdx : 0); sIdx < sites.length; sIdx++) {
                    const site = sites[sIdx];
                    const query = buildEmailQuery(niche, city, config.area || "", site);
                    
                    emit({ type: "search-query", query, message: `Searching DDG: ${query}` });

                    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`, { waitUntil: 'networkidle2' });

                    let pageExhausted = false;
                    const processedLinks = new Set();
                    let consecutiveNoNewResults = 0;
                    let totalSavedForQuery = 0;
                    let lastHeight = await page.evaluate(() => document.body.scrollHeight);

                    while (!pageExhausted) {
                        // 1. Extract results currently visible
                        const results = await page.evaluate(() => {
                            const items = [];
                            document.querySelectorAll('li[data-layout="organic"], article').forEach(el => {
                                const titleEl = el.querySelector('a[data-testid="result-title-a"]');
                                const snippetEl = el.querySelector('div[data-result="snippet"]');
                                if (titleEl) {
                                    items.push({
                                        title: titleEl.innerText,
                                        link: titleEl.href,
                                        snippet: snippetEl ? snippetEl.innerText : ""
                                    });
                                }
                            });
                            return items;
                        });

                        let newItemsThisPass = false;
                        for (const res of results) {
                            if (processedLinks.has(res.link)) continue;
                            processedLinks.add(res.link);
                            newItemsThisPass = true;

                            const email = extractEmail(res.title + " " + res.snippet);
                            if (email) {
                                const eLower = email.toLowerCase();
                                if (!seenEmails.has(eLower)) {
                                    seenEmails.add(eLower);
                                    fs.appendFileSync(emailFilePath, email + "\n");
                                    fs.appendFileSync(allEmailsFile, email + "\n");
                                    emit({
                                        type: "lead-saved",
                                        email: email,
                                        title: res.title,
                                        city, niche, site,
                                        fileName,
                                        emailFileName,
                                        allEmailsFileName: "all_emails.txt",
                                        message: `Found Email: ${email}`
                                    });
                                }
                            }

                            const entry = `[RESULT] [${niche.toUpperCase()}] - ${city} [${site}]\nTitle:      ${res.title}\nDetails:    ${res.snippet}\nLink:       ${res.link}\n${'-'.repeat(50)}\n`;
                            fs.appendFileSync(filePath, entry);
                            totalSavedForQuery++;
                        }

                        if (!newItemsThisPass) {
                            consecutiveNoNewResults++;
                        } else {
                            consecutiveNoNewResults = 0;
                        }

                        // 2. Aggressive Scroll to Bottom
                        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                        await new Promise(r => setTimeout(r, 2000));

                        // 3. Handle "More Results" Button
                        const moreBtn = await page.$('#more-results');
                        if (moreBtn) {
                            try {
                                await moreBtn.click();
                                await new Promise(r => setTimeout(r, 3000));
                            } catch (e) {
                                // Sometimes click fails if intercepted, try JS click
                                await page.evaluate((btn) => btn.click(), moreBtn);
                                await new Promise(r => setTimeout(r, 3000));
                            }
                        }

                        // 4. Check if height changed or if we are truly at the end
                        const newHeight = await page.evaluate(() => document.body.scrollHeight);
                        const isEnd = await page.evaluate(() => {
                            const noResults = document.querySelector('.no-results');
                            const endMessage = document.querySelector('.result--sep--hr');
                            return !!noResults || !!endMessage;
                        });

                        if (isEnd || (newHeight === lastHeight && consecutiveNoNewResults >= 3)) {
                            pageExhausted = true;
                        }
                        lastHeight = newHeight;
                    }

                    fs.writeFileSync(progressFile, JSON.stringify({ cityIdx: cIdx, nicheIdx: nIdx, siteIdx: sIdx + 1 }));
                    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
                }
            }
        }
        emit({ type: "job-complete", message: "Social scraping completed." });
    } catch (err) {
        emit({ type: "log", message: `Error: ${err.message}` });
    } finally {
        await browser.close();
    }
}

run();
