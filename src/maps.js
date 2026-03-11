import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

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
    this.browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-notifications", "--lang=en-US"],
    });
    console.log("Browser initialized (Ultra Mode)");
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
    
    let page;
    try {
      page = await this.browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
const emails = await page.evaluate(() => {
  const text = document.documentElement.outerHTML;
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
  const matches = text.match(emailRegex) || [];
  const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
                           .map(a => a.href.replace('mailto:', '').split('?')[0]);
  return [...new Set([...matches, ...mailtoLinks])];
});

return emails.filter(e => {
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

    } finally {
      if (page) try { await page.close(); } catch(e) {}
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
      let detailPage = null;
      
      try {
        if (!this.browser) break;
        detailPage = await this.browser.newPage();
        
        // Reduced timeout to 10s and no retries as requested
        await detailPage.goto(lead.link, { waitUntil: 'networkidle2', timeout: 10000 });
        await new Promise(r => setTimeout(r, 1000));

        const deepData = await detailPage.evaluate(() => {
          const rating = document.querySelector('span.ceNzR')?.textContent || 
                         document.querySelector('div.F7B61b')?.textContent || 
                         document.querySelector('span[aria-label*="stars"]')?.ariaLabel?.split(' ')[0];

          const getWebsite = () => {
             const standard = document.querySelector('a[data-item-id="authority"]')?.href;
             if (standard) return standard;
             
             const ariaWebsite = document.querySelector('a[aria-label*="Website"]')?.href;
             if (ariaWebsite) return ariaWebsite;

             const allLinks = Array.from(document.querySelectorAll('a'));
             const found = allLinks.find(a => 
               a.textContent?.toLowerCase().includes('website') || 
               a.href?.includes('business.site') ||
               a.getAttribute('data-value') === 'Website'
             );
             return found ? found.href : null;
          };

          return {
            title: document.querySelector('h1.DUwDbe')?.textContent || document.querySelector('h1')?.textContent,
            rating: rating,
            category: document.querySelector('button[jsaction*="category"]')?.textContent,
            phone: document.querySelector('button[data-item-id^="phone:tel:"]')?.textContent || 
                   document.querySelector('[aria-label^="Phone:"]')?.textContent,
            website: getWebsite(),
            address: document.querySelector('button[data-item-id="address"]')?.textContent
          };
        });

        const merged = {
          id: i + 1,
          name: this.cleanText(deepData.title || lead.name),
          address: this.cleanText(deepData.address || lead.address),
          phone: this.cleanText(deepData.phone || lead.phone),
          website: deepData.website || lead.website || "N/A",
          referenceLink: lead.link,
          rating: this.cleanText(deepData.rating || lead.rating),
          possibleEmails: [], 
          source: "Google Maps",
          scrapedAt: new Date().toISOString(),
        };

        if (merged.website && merged.website !== 'N/A') {
          try {
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

      } catch (err) {
        console.error(`   [Maps] Skipping ${lead.name} due to timeout (10s) or error: ${err.message}`);
        const errorLead = {
          id: i + 1,
          name: this.cleanText(lead.name),
          address: this.cleanText(lead.address),
          phone: this.cleanText(lead.phone),
          website: lead.website,
          referenceLink: lead.link,
          rating: this.cleanText(lead.rating),
          possibleEmails: [],
          source: "Google Maps",
          scrapedAt: new Date().toISOString(),
        };
        finalResults.push(errorLead);
        if (onProgress) await onProgress(errorLead);
      } finally {
        if (detailPage) try { await detailPage.close(); } catch(e) {}
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
