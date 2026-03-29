import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import BusinessScraper from "./maps.js";
import { extractPhones, buildPhoneQueryTerm } from "./phone_utils.js";
import db from "./sender/models/db.js";
import { v4 as uuidv4 } from 'uuid';

// Helper to check/save global duplicates
function isDuplicate(value, type, jobId) {
  try {
    const existing = db.prepare("SELECT 1 FROM scraped_leads_master WHERE value = ?").get(value);
    if (existing) return true;
    
    db.prepare("INSERT INTO scraped_leads_master (id, value, type, jobId) VALUES (?, ?, ?, ?)")
      .run(uuidv4(), value, type, jobId);
    return false;
  } catch (e) {
    return false; // Fallback to non-duplicate if DB fails
  }
}

const nicheExpansionDictionary = {
  fitness: ["Fitness Coach", "Gym Instructor", "Personal Trainer", "Yoga Instructor", "Pilates Teacher"],
  trainer: ["Coach", "Instructor", "Consultant", "Mentor"],
  yoga: ["Yoga Coach", "Yoga Therapist", "Yoga Teacher"],
  pilates: ["Pilates Coach", "Pilates Instructor"]
};

const defaultSites = [
  "linkedin.com/in", "facebook.com", "instagram.com", "reddit.com", "x.com",
  "twitter.com", "tiktok.com", "youtube.com", "pinterest.com", "threads.net",
  "snapchat.com", "medium.com", "substack.com", "quora.com", "tumblr.com",
  "yelp.com", "foursquare.com", "nextdoor.com", "alignable.com", "trustpilot.com",
  "crunchbase.com", "wellfound.com", "angel.co", "about.me", "behance.net",
  "dribbble.com", "meetup.com", "eventbrite.com", "locanto.com", "gumtree.com",
  "craigslist.org", "yellowpages.com", "yell.com", "hotfrog.com", "manta.com",
  "kompass.com", "clutch.co", "tripadvisor.com"
];

export function expandNiches(baseNiches) {
  const expanded = new Set();

  for (const niche of baseNiches) {
    const trimmed = niche.trim();
    if (!trimmed) continue;

    expanded.add(trimmed);
    const lower = trimmed.toLowerCase();

    for (const [token, matches] of Object.entries(nicheExpansionDictionary)) {
      if (lower.includes(token)) {
        matches.forEach((match) => expanded.add(match));
      }
    }

    if (lower.includes("trainer")) {
      expanded.add(trimmed.replace(/trainer/i, "coach"));
      expanded.add(trimmed.replace(/trainer/i, "instructor"));
    }
  }

  return Array.from(expanded).filter(Boolean);
}

export class LeadScraper {
  constructor({ outputRoot = "output", onProgress = () => { }, sites = defaultSites } = {}) {
    this.outputRoot = outputRoot;
    this.onProgress = onProgress;
    this.sites = Array.from(new Set((sites || []).filter(Boolean)));
    this.child = null;
    this.mapsScraper = null;
    this.isStopped = false;
  }

  stop() {
    this.isStopped = true;
    if (this.child) {
      this.child.kill("SIGTERM");
    }
    if (this.mapsScraper) {
      this.mapsScraper.close().catch(() => { });
    }
    return true;
  }

  async runMapsScraper({ jobId, country, cities, niches, outputDir, userPlan }) {
    this.mapsScraper = new BusinessScraper();
    await this.mapsScraper.init();

    const allEmailsPath = path.join(outputDir, "all_emails.txt");
    const mapsOnlyEmailsPath = path.join(outputDir, "google_maps_emails.txt");
    const countryPhoneFile = path.join(outputDir, `${country.replace(/[^a-zA-Z0-9]/g, "_")}_phones.txt`);
    const allPhonesPath = path.join(outputDir, "all_phones.txt");
    const seenEmails = new Set();
    const seenPhones = new Set();

    if (fs.existsSync(allEmailsPath)) {
      const data = await fsPromises.readFile(allEmailsPath, "utf8");
      data.split("\n").forEach(e => { if (e.trim()) seenEmails.add(e.trim().toLowerCase()); });
    }
    if (fs.existsSync(allPhonesPath)) {
      const data = await fsPromises.readFile(allPhonesPath, "utf8");
      data.split("\n").forEach(p => { if (p.trim()) seenPhones.add(p.trim()); });
    }

    const progressFile = path.join(outputDir, "maps_progress.json");
    let startCityIdx = 0;
    let startNicheIdx = 0;
    if (fs.existsSync(progressFile)) {
      try {
        const prog = JSON.parse(await fsPromises.readFile(progressFile, "utf8"));
        startCityIdx = prog.cityIdx || 0;
        startNicheIdx = prog.nicheIdx || 0;
        this.onProgress({ type: "log", message: `[Maps] Auto-resuming from City index ${startCityIdx}, Niche index ${startNicheIdx}` });
      } catch (e) {}
    }

    try {
      for (let cIdx = 0; cIdx < cities.length; cIdx++) {
        if (cIdx < startCityIdx) continue;
        const city = cities[cIdx];
        if (this.isStopped) break;
        const safeCity = city.replace(/[^a-zA-Z0-9_-]/g, "_");

        for (let nIdx = 0; nIdx < niches.length; nIdx++) {
          if (cIdx === startCityIdx && nIdx < startNicheIdx) continue;
          const niche = niches[nIdx];
          if (this.isStopped) break;

          const query = `"${niche}" in "${city} ${country}"`;
          this.onProgress({ type: "log", message: `[Maps] Searching: ${query}` });

          await this.mapsScraper.scrapeGoogleMaps(query, 999);
          
          let newEmailsFound = 0;
          let newPhonesFound = 0;

          const mapsLeadsJsonName = `maps_${safeCity}_leads.json`;
          const csvFileName = `google_maps_all.csv`;
          const csvPath = path.join(outputDir, csvFileName);
          
          if (!fs.existsSync(csvPath)) {
             await fsPromises.writeFile(csvPath, "Name,Phone,Emails,Website,Rating,Address,Source Link\n");
          }

          // Pass a callback that instantly saves data AND emits to the UI for each lead
          let leads = await this.mapsScraper.processResults(999, async (lead) => {
             this.onProgress({
                type: "business-processed",
                name: lead.name,
                message: `[Maps] Processing: ${lead.name}`
             });

             // Append to CSV immediately
             const escapeCsv = (str) => {
               if (!str) return '""';
               return `"${str.toString().replace(/"/g, '""')}"`;
             };
             const csvRecord = [
                escapeCsv(lead.name), escapeCsv(lead.phone), escapeCsv(lead.possibleEmails.join('; ')),
                escapeCsv(lead.website), escapeCsv(lead.rating), escapeCsv(lead.address), escapeCsv(lead.referenceLink)
             ].join(",") + "\n";
             await fsPromises.appendFile(csvPath, csvRecord);
             this.onProgress({ type: "csv-saved", fileName: csvFileName }); // Tell queue CSV is updated

             // Instant Email Save & Emit
             for (const email of lead.possibleEmails) {
                const eLower = email.toLowerCase();
                if (!seenEmails.has(eLower) && !isDuplicate(eLower, 'email', jobId)) {
                   seenEmails.add(eLower);
                   await fsPromises.appendFile(mapsOnlyEmailsPath, email + "\n");
                   await fsPromises.appendFile(allEmailsPath, email + "\n");
                   newEmailsFound++;
                   this.onProgress({
                      type: "lead-saved",
                      email: email,
                      fileName: mapsLeadsJsonName,
                      emailFileName: "google_maps_emails.txt",
                      allEmailsFileName: "all_emails.txt",
                      message: `[Maps] Found Email: ${email}`
                   });
                }
             }

             // Instant Phone Save & Emit
             const rawPhone = lead.phone || "";
             const extractedPhones = rawPhone ? extractPhones(rawPhone, country) : extractPhones([lead.name, lead.address].join(" "), country);
             
             for (const phone of extractedPhones) {
                if (!seenPhones.has(phone) && !isDuplicate(phone, 'phone', jobId)) {
                   seenPhones.add(phone);
                   await fsPromises.appendFile(countryPhoneFile, phone + "\n");
                   await fsPromises.appendFile(allPhonesPath, phone + "\n");
                   newPhonesFound++;
                   this.onProgress({
                      type: "phone-saved",
                      phone,
                      city: lead.address || "",
                      niche: niches[0] || "",
                      site: "Google Maps",
                      title: lead.name,
                      phoneFileName: path.basename(countryPhoneFile),
                      allPhonesFileName: "all_phones.txt",
                      message: `[Maps] Phone: ${phone}`
                   });
                }
             }
          });

          // Dump the full raw JSON array at the end of the query
          await fsPromises.writeFile(path.join(outputDir, mapsLeadsJsonName), JSON.stringify(leads, null, 2));

          // Save progress after completing this niche
          await fsPromises.writeFile(progressFile, JSON.stringify({ cityIdx: cIdx, nicheIdx: nIdx + 1 }));
        }

        // Reset niche index when advancing to the next city
        await fsPromises.writeFile(progressFile, JSON.stringify({ cityIdx: cIdx + 1, nicheIdx: 0 }));
      }
    } catch (error) {
      this.onProgress({ type: "log", message: `[Maps] Error: ${error.message}` });
    } finally {
      if (this.mapsScraper) {
        await this.mapsScraper.close();
        this.mapsScraper = null;
      }
    }
  }

  async run({ jobId, country, cities, states = [], niches, includeGoogleMaps = true, scrapeMode = 'emails', sites, userPlan = 'basic' }) {
    if (sites && sites.length) this.sites = sites;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const scriptPath = path.join(__dirname, "scraper.py");
    const outputDir = path.join(this.outputRoot, jobId);

    if (!fs.existsSync(outputDir)) {
      await fsPromises.mkdir(outputDir, { recursive: true });
    }

    const expandedNichesList = expandNiches(niches);

    if (includeGoogleMaps && !this.isStopped) {
      this.onProgress({ type: "log", message: "Starting Google Maps phase..." });
      await this.runMapsScraper({ jobId, country, cities, niches: expandedNichesList, outputDir, userPlan });
    }

    if (this.isStopped) return { files: [], expandedNiches: expandedNichesList, sites: this.sites };

    this.onProgress({ type: "log", message: "Starting Google Search phase..." });

    const payload = { outputDir, country, cities, states, niches, includeGoogleMaps: false, sites: this.sites, scrapeMode };

    const runScraperProcess = (cmd, args, name, payloadData) => {
      return new Promise((resolve, reject) => {
        // Use stdin to pass large payloads to avoid E2BIG (ARG_MAX limit)
        this.child = spawn(cmd, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONUNBUFFERED: "1" }
        });

        if (payloadData) {
          this.child.stdin.write(JSON.stringify(payloadData));
          this.child.stdin.end();
        }

        let stderr = "";
        this.child.stderr.on("data", (chunk) => stderr += chunk.toString());
        let buffer = "";
        let finalResult = null;
        this.child.stdout.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);
              if (event.type === "result" || event.type === "job-complete" || event.type === "job-completed") { finalResult = event; continue; }
              this.onProgress(event);
            } catch {
              this.onProgress({ type: "log", message: `[${name}] ${trimmed}` });
            }
          }
        });
        this.child.on("close", (code) => {
          if (code !== 0 && code !== null) {
            // Check if it's a missing Python package
            let errMsg = stderr || `${name} failed with code ${code}`;
            if (stderr.includes('ModuleNotFoundError') || stderr.includes('No module named')) {
              const match = stderr.match(/No module named '([^']+)'/);
              const mod = match ? match[1] : 'a required Python module';
              errMsg = `Python dependency missing: "${mod}". Please run: pip3 install ${mod} --break-system-packages`;
            }
            reject(new Error(errMsg));
            return;
          }
          resolve(finalResult);
        });
      });
    };

    try {
      const googleScriptPath = path.join(__dirname, "google_scraper.js");
      await runScraperProcess(process.execPath, [googleScriptPath], "Google", payload);
    } catch (err) {
      this.onProgress({ type: "log", message: `Google failed: ${err.message}. Falling back to Python...` });
      if (!this.isStopped) {
        const venvPython = path.join(__dirname, "..", "venv", "bin", "python3");
        const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";
        try {
          await runScraperProcess(pythonCmd, [scriptPath], "Python", payload);
        } catch (pyErr) {
          // If Python fails with a missing module error, show a user-friendly message
          if (pyErr.message.includes('Python dependency missing') || pyErr.message.includes('ModuleNotFoundError')) {
            this.onProgress({ type: "log", message: `⚠️ ${pyErr.message}` });
            this.onProgress({ type: "log", message: `ℹ️ Run this command on the server: pip3 install undetected-chromedriver selenium --break-system-packages` });
          } else {
            this.onProgress({ type: "log", message: `Python fallback also failed: ${pyErr.message}` });
          }
        }
      }
    }

    const filesList = await fsPromises.readdir(outputDir);
    const files = filesList.filter(f => f.endsWith('.txt') || f.endsWith('.json') || f.endsWith('.csv'));
    this.onProgress({ type: "job-complete", files, message: "Scraping completed." });

    this.child = null;
    this.isStopped = false;
    return { files, expandedNiches: expandedNichesList, sites: this.sites };
  }
}
