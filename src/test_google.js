import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const outputDir = path.join(__dirname, '..', 'output', 'test_google_job');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

rl.question('Please enter the NICHE to scrape on Google: ', (niche) => {
  const config = {
    jobId: "test_google_job",
    outputDir: outputDir,
    country: "World",
    cities: ["Global"],
    niches: [niche],
    scrapeMode: "emails", // can be "emails", "phones", or "both"
    sites: ["linkedin.com/in", "facebook.com", "instagram.com"]
  };

  console.log(`\n--- Starting Google Scraper for Niche: ${niche} ---\n`);
  
  // Note: google_scraper.js spawned by node
  const child = spawn('node', [path.join(__dirname, 'google_scraper.js')], {
    stdio: ['pipe', 'inherit', 'inherit']
  });

  child.stdin.write(JSON.stringify(config));
  child.stdin.end();

  child.on('close', (code) => {
    console.log(`\n--- Google Scraper Finished with code ${code} ---`);
    console.log(`Results saved to: ${outputDir}`);
    rl.close();
  });
});
