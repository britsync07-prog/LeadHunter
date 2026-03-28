
import BusinessScraper from './src/maps.js';
import fs from 'fs';

async function run() {
    const scraper = new BusinessScraper();
    try {
        await scraper.init();
        const page = await scraper.browser.newPage();
        // Set a realistic User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 900 });

        const searchQuery = '"plumber" in "Gardendale United States"';
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=en`;
        console.log(`[Test] Searching: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
        
        // --- Consent Bypass Logic ---
        console.log('[Test] Checking for Google Consent Dialog...');
        try {
            const selectors = [
                'button[aria-label*="Accept all"]',
                'button[aria-label*="Agree"]',
                'form[action*="consent.google.com"] button',
                'button::-p-text(Accept all)',
                'button::-p-text(I agree)'
            ];
            
            let clicked = false;
            for (const selector of selectors) {
                try {
                    const button = await page.waitForSelector(selector, { timeout: 3000 });
                    if (button) {
                        console.log(`[Test] Consent dialog detected (${selector}), clicking accept...`);
                        await button.click();
                        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
                        clicked = true;
                        break; 
                    }
                } catch (e) { /* Check next selector */ }
            }
            if (!clicked) console.log('[Test] No consent button found or already bypassed.');
        } catch (e) {
            console.log("[Test] Error during consent handling:", e.message);
        }
        // ----------------------------

        // Wait for results to load
        console.log('[Test] Waiting for results to load...');
        await new Promise(r => setTimeout(r, 5000));

        await page.screenshot({ path: 'debug_screenshot.png' });
        console.log('[Test] Screenshot saved as debug_screenshot.png');

        const content = await page.content();
        fs.writeFileSync('debug_page.html', content);
        console.log('[Test] Page content saved as debug_page.html');

        const wrapper = await page.$('div[role="feed"]');
        console.log('[Test] Wrapper div[role="feed"] exists:', !!wrapper);

        const cards = await page.$$('.Nv2PK, .TH17p, [role="article"]');
        console.log('[Test] Cards count (using multiple selectors):', cards.length);

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes('Before you continue') || bodyText.includes('consent.google.com')) {
            console.log('[Test] WARNING: Still detected Consent Dialog text on page!');
        } else if (cards.length > 0) {
            console.log('[Test] SUCCESS: Found result cards!');
        } else {
            console.log('[Test] Found 0 cards. Check debug_screenshot.png to see what Google is showing.');
        }

        await scraper.close();
    } catch (error) {
        console.error('[Test] Error:', error);
    }
}

run();
