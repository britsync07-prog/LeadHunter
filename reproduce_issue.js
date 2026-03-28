
import BusinessScraper from './src/maps.js';
import fs from 'fs';

async function run() {
    const scraper = new BusinessScraper();
    try {
        await scraper.init();
        const page = await scraper.browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });

        const searchQuery = '"plumber" in "Gardendale United States"';
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}?hl=en`;
        console.log(`[Test] Searching: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
        
        // Wait a bit for any overlays
        await new Promise(r => setTimeout(r, 5000));

        await page.screenshot({ path: 'debug_screenshot.png' });
        console.log('[Test] Screenshot saved as debug_screenshot.png');

        const content = await page.content();
        fs.writeFileSync('debug_page.html', content);
        console.log('[Test] Page content saved as debug_page.html');

        const wrapper = await page.$('div[role="feed"]');
        console.log('[Test] Wrapper div[role="feed"] exists:', !!wrapper);

        const cards = await page.$$('.Nv2PK');
        console.log('[Test] Cards .Nv2PK count:', cards.length);

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes('Before you continue') || bodyText.includes('consent.google.com')) {
            console.log('[Test] Detected Consent Dialog!');
        }

        await scraper.close();
    } catch (error) {
        console.error('[Test] Error:', error);
    }
}

run();
