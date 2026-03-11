import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './src/sender/models/db.js';
import { generateSignedUrl } from './src/sender/services/hmac.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
    console.log('--- STARTING TRACKING API TESTS ---');
    const HOST = 'http://localhost:3000';

    // 1. Seed Dummy Data
    console.log('[1] Seeding dummy campaign and recipient into SQLite...');
    try {
        db.exec("DELETE FROM event_logs; DELETE FROM recipients; DELETE FROM campaigns;");
        db.prepare("INSERT INTO campaigns (id, userId, name) VALUES (?, ?, ?)")
            .run('camp_123', 'user_abc', 'Curl Test Campaign');
        db.prepare("INSERT INTO recipients (id, campaignId, email, status) VALUES (?, ?, ?, ?)")
            .run('recpt_456', 'camp_123', 'target@example.com', 'sent');
        console.log('    -> Seeded recipient: recpt_456');
    } catch (e) {
        console.error('    -> DB Seed Failed:', e.message);
        process.exit(1);
    }

    // 2. Test Open Pixel
    console.log('\n[2] Testing Open Tracking Pixel (GET /track/o/:eventId.gif)');
    try {
        const openRes = await fetch(`${HOST}/track/o/recpt_456.gif`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Test)' } // Bot blocklist triggers if we don't supply a unique UA or if we supply 'Mozilla/5.0' exactly. Wait, 'Mozilla/5.0' is in the bot blocklist!
        });
        console.log(`    -> Status: ${openRes.status} ${openRes.statusText}`);
        const buffer = await openRes.arrayBuffer();
        console.log(`    -> Response: ${buffer.byteLength} bytes (1x1 GIF)`);
    } catch (e) {
        console.error('    -> Open tracking failed:', e.message);
    }

    // Wait for async log event to write to SQLite
    await sleep(200);

    // 3. Test Click Redirect
    console.log('\n[3] Testing Click Tracking Redirect (GET /track/c/:payload/:sig)');
    const clickUrl = generateSignedUrl(HOST, 'recpt_456', 'https://www.google.com/?q=success');
    console.log(`    -> Generated Signed URL: ${clickUrl}`);
    try {
        const clickRes = await fetch(clickUrl, {
            redirect: 'manual', // Don't auto-follow so we can read the 302
            headers: { 'User-Agent': 'Valid Browser User Agent' }
        });
        console.log(`    -> Status: ${clickRes.status} ${clickRes.statusText}`);
        console.log(`    -> Redirect Location: ${clickRes.headers.get('location')}`);
    } catch (e) {
        console.error('    -> Click tracking failed:', e.message);
    }

    await sleep(200);

    // 4. Verify Database State
    console.log('\n[4] Verifying SQLite Analytics Logs...');
    const logs = db.prepare("SELECT eventType, url, ipAddress FROM event_logs").all();
    console.log('    -> Event Logs:', logs);

    console.log('\n--- TESTS COMPLETED ---');
}

runTests();
