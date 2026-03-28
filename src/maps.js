import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

class BusinessScraper {
  constructor() {
    this.browser = null;
    this.results = [];
  }

  // Helper to clean Google's hidden icon characters from text
  cleanText(str) {
    if (!str || str === "N/A") return "N/A";
    // Strips  (phone),  (address),  (plus code),  (stars) and other glyphs
    return str.replace(/[]/g, '').trim();
  }

  async init() {
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || undefined;
    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-notifications",
      "--disable-gpu",
      "--no-zygote",
      "--lang=en-US",
    ];

    this.browser = await puppeteer.launch({
      headless: !envFlag("PUPPETEER_HEADFUL", false),
      executablePath,
      args: launchArgs,
    });
    console.log(`Browser initialized (Ultra Mode)${executablePath ? ` using ${executablePath}` : ""}`);
  }

  async scrapeGoogleMaps(searchQuery, maxResults = 30) {
    this.results = []; 
    if (!this.browser) await this.init();

    const page = await this.browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    try {
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=en`;
      console.log(`[Maps] Searching: ${searchUrl}`);
      
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });

      console.log(`[Maps] Scrolling to find up to ${maxResults} leads...`);
      const links = await page.evaluate(async (max) => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return [];

        let collected = new Map();
        let lastSize = 0;
        let idleTurns = 0;

        return await new Promise((resolve) => {
          let timer = setInterval(() => {
            wrapper.scrollBy(0, 1000);
            
            const cards = document.querySelectorAll('.Nv2PK');
            cards.forEach(card => {
              const linkEl = card.querySelector('a.hfpxzc');
              const link = linkEl?.href;
              if (!link || collected.has(link)) return;

              const name = card.querySelector('.qBF1Pd')?.textContent || "N/A";
              const rating = card.querySelector('.MW4etd')?.textContent || 
                             card.querySelector('span[aria-label*="stars"]')?.ariaLabel?.split(' ')[0] || "N/A";
              const website = card.querySelector('a[data-value="Website"]')?.href || "N/A";
              
              let phone = "N/A";
              const infoText = card.textContent;
              const phoneMatch = infoText.match(/(\+\d{1,4}[\s.-]?)?(\(?\d{2,6}\)?[\s.-]?)?(\d{2,6}[\s.-]?){1,4}\d{2,6}/);
              if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 7) {
                  phone = phoneMatch[0];
              }

              collected.set(link, { name, link, rating, website, phone });
            });

            if (collected.size >= max) {
              clearInterval(timer);
              resolve(Array.from(collected.values()).slice(0, max));
            } else {
              if (collected.size === lastSize) {
                idleTurns++;
                if (idleTurns > 15) { 
                  clearInterval(timer);
                  resolve(Array.from(collected.values()));
                }
              } else {
                lastSize = collected.size;
                idleTurns = 0;
              }
            }
          }, 1000);
        });
      }, maxResults);

      console.log(`[Maps] Found ${links.length} potential leads. Processing details...`);
      this.results = links;
      
      await page.close();
      return links;

    } catch (error) {
      console.error("[Maps] Scrape Error:", error);
      if (page) try { await page.close(); } catch(e) {}
      return [];
    }
  }

  async findEmails(websiteUrl) {
    if (!websiteUrl || websiteUrl === 'N/A' || !websiteUrl.startsWith('http')) return [];
    
    try {
      const response = await axios.get(websiteUrl, {
        timeout: 6000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        maxRedirects: 5,
        maxContentLength: 1_500_000,
        maxBodyLength: 1_500_000,
        validateStatus: (status) => status < 500, // Accept 404s etc. to try and find emails anyway
      });

      const contentType = response.headers?.['content-type'] || '';
      if (!contentType.includes('text/html')) return [];

      const html = response.data;
      if (typeof html !== 'string') return [];

      const $ = cheerio.load(html);
      const text = html;
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
      const matches = text.match(emailRegex) || [];
      
      const mailtoLinks = [];
      $('a[href^="mailto:"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          mailtoLinks.push(href.replace('mailto:', '').split('?')[0]);
        }
      });

      const allEmails = [...new Set([...matches, ...mailtoLinks])];

      return allEmails.filter(e => {
        const lower = e.toLowerCase();

        // 1. Basic format & length checks
        if (lower.length < 5 || !lower.includes('.') || lower.includes(' ')) return false;

        // 2. Filter out common file extensions
        const badExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.pdf', '.css', '.js', '.ico', '.zip', '.mp4'];
        if (badExtensions.some(ext => lower.endsWith(ext))) return false;

        // 3. Filter out placeholder emails
        const badLocals = ['your', 'email', 'user', 'example', 'test', 'admin', 'info@example', 'mail@example', 'hello@example', 'name', 'support@domain'];
        if (badLocals.some(bad => lower.startsWith(bad + '@'))) return false;

        // 4. Filter out version strings (e.g., jquery@1.14.0)
        if (/@\d+\.\d+/.test(lower)) return false;

        // 5. Filter out junk/placeholder domains
        const badDomains = ['sentry.io', 'wixpress', 'example.com', 'test.com', 'domain.com', 'yoursite.com', 'company.com', 'yourdomain.com', 'wordpress.com'];
        if (badDomains.some(bad => lower.includes(bad))) return false;

        return true;
      });

    } catch (err) {
      console.warn(`   [Maps] axios failed for ${websiteUrl}: ${err.message}`);
      return [];
    }
  }

  async processResults(targetCount = 999, onProgress = null) {
    const uniqueResults = this.results.filter(
      (business, index, self) =>
        index === self.findIndex((b) => b.name.toLowerCase() === business.name.toLowerCase())
    );

    const limitedResults = uniqueResults.slice(0, targetCount);
    const finalResults = [];

    for (let i = 0; i < limitedResults.length; i++) {
      const lead = limitedResults[i];
      const merged = {
        id: i + 1,
        name: this.cleanText(lead.name),
        address: this.cleanText(lead.address),
        phone: this.cleanText(lead.phone),
        website: lead.website || "N/A",
        referenceLink: lead.link,
        rating: this.cleanText(lead.rating),
        possibleEmails: [],
        source: "Google Maps",
        scrapedAt: new Date().toISOString(),
      };

      if (merged.website && merged.website !== 'N/A') {
        try {
          // Keep website enrichment lightweight: HTTP request only, no browser.
          merged.possibleEmails = await this.findEmails(merged.website);
        } catch (emailErr) {
          console.warn(`   [Maps] Email finding failed for ${merged.website}: ${emailErr.message}`);
        }
      }

      finalResults.push(merged);
      console.log(`   [Maps] (${i + 1}/${limitedResults.length}) Processed: ${merged.name}`);

      if (onProgress) {
        await onProgress(merged);
      }
    }

    return finalResults;
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch(e) {}
      this.browser = null;
    }
  }
}

export default BusinessScraper;
