import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const outputDir = path.join(__dirname, '..', 'output', 'test_job');

rl.question('Please enter the NICHE to scrape: ', (niche) => {
  const config = {
    jobId: "test_job",
    outputDir: outputDir,
    country: "World",
    cities: ["Global"],
    niches: [niche]
  };

  console.log(`\n--- Starting Scraper for Niche: ${niche} ---\n`);
  
  const child = spawn('node', [path.join(__dirname, 'social_scraper.js')], {
    stdio: ['pipe', 'inherit', 'inherit']
  });

  child.stdin.write(JSON.stringify(config));
  child.stdin.end();

  child.on('close', (code) => {
    console.log(`\n--- Scraper Finished with code ${code} ---`);
    console.log(`Results saved to: ${outputDir}`);
    rl.close();
  });
});
