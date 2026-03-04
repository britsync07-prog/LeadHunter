import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { expandNiches } from "./scraper.js";
import { buildPhoneQueryTerm, extractPhones } from "./phone_utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMAIL_TERMS = ["@gmail.com", "@hotmail", "@outlook.com", "email me"];

function extractEmail(text) {
    if (!text) return null;
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
    const match = text.match(emailRegex);
    return match ? match[0] : null;
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

/** Phone search: site:SITE NICHE "CITY" ("07" OR "+44") — no quotes around niche */
function buildPhoneQuery(niche, city, area, site, country) {
    const locationText = area ? `${area} ${city}`.trim() : city;
    const phoneTerm = buildPhoneQueryTerm(country);
    return `site:${site} ${niche} "${locationText}" ${phoneTerm}`;
}

function emit(event) {
    console.log(JSON.stringify(event));
}

async function runGoogleSearchCli(query, stateFile) {
    const cliPath = path.join(__dirname, "..", "google-search", "dist", "src", "index.js");
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            cliPath,
            query,
            "--limit", "10",
            "--pages", "5",
            "--state-file", stateFile
        ], {
            env: { ...process.env, LOG_LEVEL: "silent" }
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(`Google Search CLI exited with code ${code}. Stderr: ${stderr}`));
            }
            try {
                const firstBrace = stdout.indexOf("{");
                const lastBrace = stdout.lastIndexOf("}");
                if (firstBrace === -1 || lastBrace === -1) {
                    return resolve({ results: [] });
                }
                const jsonStr = stdout.slice(firstBrace, lastBrace + 1);
                const data = JSON.parse(jsonStr);
                resolve(data);
            } catch (err) {
                reject(new Error(`Failed to parse Google Search JSON: ${err.message}`));
            }
        });
    });
}

async function main() {
    let config;
    if (process.argv.length < 3) {
        // Read from stdin if no argument is provided
        try {
            const data = fs.readFileSync(0, "utf8");
            if (!data) throw new Error("No data received via stdin");
            config = JSON.parse(data);
        } catch (err) {
            emit({ type: "job-failed", message: "Failed to read config from stdin", traceback: err.message });
            process.exit(1);
        }
    } else {
        try {
            config = JSON.parse(process.argv[2]);
        } catch (err) {
            emit({ type: "job-failed", message: "Invalid JSON config in arguments", traceback: err.message });
            process.exit(1);
        }
    }

    const outputDir = config.outputDir;
    const country = config.country;
    const cities = config.cities;
    const niches = config.niches;
    const sites = config.sites || ["linkedin.com/in", "facebook.com", "instagram.com"];
    const scrapeMode = config.scrapeMode || 'emails'; 

    const doEmails = scrapeMode === 'emails' || scrapeMode === 'both';
    const doPhones = scrapeMode === 'phones' || scrapeMode === 'both';

    const expandedNiches = expandNiches(niches);
    const stateFile = path.resolve(__dirname, "..", "google-search", "browser-state.json");

    const allEmailsFile = path.join(outputDir, "all_emails.txt");
    const seenEmails = new Set();
    if (doEmails) {
        if (!fs.existsSync(allEmailsFile)) {
            fs.writeFileSync(allEmailsFile, "", "utf-8");
        } else {
            fs.readFileSync(allEmailsFile, "utf-8").split("\n").forEach(l => { if (l.trim()) seenEmails.add(l.trim().toLowerCase()); });
        }
    }

    const phoneFileName = `${sanitizeFileName(country)}_phones.txt`;
    const countryPhoneFile = path.join(outputDir, phoneFileName);
    const allPhonesFile = path.join(outputDir, "all_phones.txt");
    const seenPhones = new Set();
    if (doPhones) {
        if (!fs.existsSync(countryPhoneFile)) fs.writeFileSync(countryPhoneFile, "", "utf-8");
        if (!fs.existsSync(allPhonesFile)) fs.writeFileSync(allPhonesFile, "", "utf-8");
        const existing = fs.existsSync(allPhonesFile) ? fs.readFileSync(allPhonesFile, "utf-8").split("\n") : [];
        existing.forEach(l => { if (l.trim()) seenPhones.add(l.trim()); });
    }

    emit({ type: "job-start", message: `Starting Google Search Scraper phase (mode: ${scrapeMode})` });

    let consecutiveErrors = 0;

    for (let cIdx = 0; cIdx < cities.length; cIdx++) {
        const city = cities[cIdx];
        const sanitizedCity = sanitizeFileName(city);
        const fileName = `${sanitizeFileName(country)}_${sanitizedCity}_leads.txt`;
        const emailFileName = `${sanitizeFileName(country)}_${sanitizedCity}_emails.txt`;

        const filePath = path.join(outputDir, fileName);
        const emailFilePath = path.join(outputDir, emailFilePath);

        if (doEmails) {
            if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `--- LEADS FOR ${city}, ${country} ---\n\n`, "utf-8");
            if (!fs.existsSync(emailFilePath)) fs.writeFileSync(emailFilePath, "", "utf-8");
        }

        const currentFiles = [];
        if (doEmails) { currentFiles.push(fileName); currentFiles.push(emailFileName); currentFiles.push("all_emails.txt"); }
        if (doPhones) { currentFiles.push(phoneFileName); currentFiles.push("all_phones.txt"); }

        let savedCount = 0;

        for (let nIdx = 0; nIdx < expandedNiches.length; nIdx++) {
            const niche = expandedNiches[nIdx];

            for (let sIdx = 0; sIdx < sites.length; sIdx++) {
                const site = sites[sIdx];

                if (doEmails) {
                    const emailQuery = buildEmailQuery(niche, city, "", site);
                    emit({ type: "search-query", query: emailQuery, message: `[Google/Email] ${emailQuery}` });

                    const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");
                    try { if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch { }
                    try { if (fs.existsSync(fingerprintFile)) fs.unlinkSync(fingerprintFile); } catch { }

                    try {
                        const searchData = await runGoogleSearchCli(emailQuery, stateFile);
                        const results = (searchData?.results || []).filter(r => r.link?.startsWith("http"));

                        for (let batchStart = 0; batchStart < results.length; batchStart += 10) {
                            const batch = results.slice(batchStart, batchStart + 10);
                            for (const result of batch) {
                                const title = result.title || "";
                                const snippet = result.snippet || "";
                                const href = result.link || "";
                                const fullText = `${title} ${snippet}`;
                                const email = extractEmail(fullText);

                                if (email) {
                                    const emailLower = email.toLowerCase();
                                    if (!seenEmails.has(emailLower)) {
                                        seenEmails.add(emailLower);
                                        fs.appendFileSync(emailFilePath, email + "\n", "utf-8");
                                        fs.appendFileSync(allEmailsFile, email + "\n", "utf-8");
                                    }
                                }

                                const entry = `[RESULT] [${niche.toUpperCase()}] - ${city} [${site}]\nTitle: ${title}\nDetails: ${snippet}\nLink: ${href}\n${'-'.repeat(50)}\n`;
                                fs.appendFileSync(filePath, entry, "utf-8");
                                savedCount++;

                                const payload = {
                                    type: "lead-saved", title, city, niche, site, fileName,
                                    totalSavedForFile: savedCount,
                                    message: `[Google/Email] Saved: ${title.substring(0, 30)}...`
                                };
                                if (email) {
                                    payload.emailFileName = emailFileName;
                                    payload.allEmailsFileName = "all_emails.txt";
                                    payload.email = email;
                                }
                                emit(payload);
                            }
                            if (batchStart + 10 < results.length) await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
                        }
                        emit({ type: "log", message: `[Google/Email] Found ${results.length} for query.` });
                        consecutiveErrors = 0;
                        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                    } catch (err) {
                        emit({ type: "log", message: `[Google/Email] Error: ${err.message}` });
                        consecutiveErrors++;
                        if (consecutiveErrors >= 2 || err.message.toLowerCase().includes("captcha")) {
                            emit({ type: "log", message: "[Google] Critically failed. Aborting." });
                            process.exit(1);
                        }
                    }
                }

                if (doPhones) {
                    const phoneQuery = buildPhoneQuery(niche, city, "", site, country);
                    emit({ type: "search-query", query: phoneQuery, message: `[Google/Phone] ${phoneQuery}` });

                    const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");
                    try { if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch { }
                    try { if (fs.existsSync(fingerprintFile)) fs.unlinkSync(fingerprintFile); } catch { }

                    try {
                        const searchData = await runGoogleSearchCli(phoneQuery, stateFile);
                        const results = (searchData?.results || []).filter(r => r.link?.startsWith("http"));

                        for (let batchStart = 0; batchStart < results.length; batchStart += 10) {
                            const batch = results.slice(batchStart, batchStart + 10);
                            for (const result of batch) {
                                const title = result.title || "";
                                const snippet = result.snippet || "";
                                const href = result.link || "";
                                const fullText = `${title} ${snippet}`;

                                const phones = extractPhones(fullText, country);
                                for (const phone of phones) {
                                    if (!seenPhones.has(phone)) {
                                        seenPhones.add(phone);
                                        fs.appendFileSync(countryPhoneFile, phone + "\n", "utf-8");
                                        fs.appendFileSync(allPhonesFile, phone + "\n", "utf-8");
                                        emit({
                                            type: "phone-saved",
                                            phone, city, niche, site, title,
                                            phoneFileName,
                                            allPhonesFileName: "all_phones.txt",
                                            message: `[Google/Phone] Found: ${phone}`
                                        });
                                    }
                                }

                                savedCount++;
                                emit({
                                    type: "lead-saved", title, city, niche, site,
                                    fileName: phoneFileName,
                                    phoneFileName,
                                    allPhonesFileName: "all_phones.txt",
                                    totalSavedForFile: savedCount,
                                    message: `[Google/Phone] Saved: ${title.substring(0, 30)}...`
                                });
                            }
                            if (batchStart + 10 < results.length) await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
                        }
                        emit({ type: "log", message: `[Google/Phone] Found ${results.length} for query.` });
                        consecutiveErrors = 0;
                        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                    } catch (err) {
                        emit({ type: "log", message: `[Google/Phone] Error: ${err.message}` });
                        consecutiveErrors++;
                        if (consecutiveErrors >= 2 || err.message.toLowerCase().includes("captcha")) {
                            emit({ type: "log", message: "[Google] Critically failed. Aborting." });
                            process.exit(1);
                        }
                    }
                }
            }
        }
    }

    emit({ type: "job-complete", message: "Google scraping completed successfully." });
}

main().catch(err => {
    emit({ type: "job-failed", message: "Unhandled exception in Google Scraper", traceback: err.stack });
    process.exit(1);
});
