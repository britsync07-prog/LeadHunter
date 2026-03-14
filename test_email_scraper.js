
import BusinessScraper from './src/maps.js';

async function test() {
  const scraper = new BusinessScraper();
  // We don't even need to call scraper.init() because findEmails now uses axios!
  
  const testUrl = 'https://www.google.com'; // Just a test, might not have emails
  console.log(`Testing findEmails for ${testUrl}...`);
  
  try {
    const emails = await scraper.findEmails(testUrl);
    console.log('Found emails:', emails);
  } catch (err) {
    console.error('Test failed:', err);
  }
}

test();
