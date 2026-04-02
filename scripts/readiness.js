import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { JSDOM } from 'jsdom';
import { v4 as uuidv4 } from 'uuid';
import db from '../src/sender/models/db.js';
import { generateSignedUrl } from '../src/sender/services/hmac.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const outputDir = path.join(rootDir, 'output');

const syntaxFiles = [
  'src/server.js',
  'src/queue.js',
  'src/scraper.js',
  'src/sender/controllers/campaignController.js',
  'src/sender/controllers/analyticsController.js',
  'public/app.js',
  'public/sender.js',
  'public/campaign-workbench.js'
];

const domContracts = {
  'public/dashboard.html': [
    'jobCategory',
    'country',
    'states',
    'cities',
    'history'
  ],
  'public/sender.html': [
    'campaignName',
    'sequenceContainer',
    'btnLaunchCampaign',
    'historyTableBody',
    'standardSmtpBlock',
    'adminSmtpBlock',
    'scheduleTimezone'
  ],
  'public/campaign-workbench.html': [
    'modeToggleBtn',
    'saveBtn',
    'fileList',
    'filePreview',
    'sequenceEditor',
    'recipientList',
    'eventList'
  ]
};

const smokeUser = {
  username: 'smoke_readiness',
  password: 'Smoke#Ready123',
  email: 'smoke-readiness@leadhunter.local'
};

const smokeIds = {
  categoryId: 'smoke-category',
  jobId: 'smoke-job',
  autoCampaignId: 'auto_smoke-job',
  autoRecipientId: 'smoke-auto-recipient'
};

let launchedSenderCampaignId = '';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(message) {
  console.log(`• ${message}`);
}

function checkSyntax() {
  logStep('Checking critical JS syntax');
  for (const file of syntaxFiles) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`Syntax check failed for ${file}\n${result.stderr || result.stdout}`);
    }
  }
}

async function checkDomContracts() {
  logStep('Checking critical DOM contracts');
  for (const [relativePath, requiredIds] of Object.entries(domContracts)) {
    const html = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
    const dom = new JSDOM(html);
    for (const id of requiredIds) {
      const node = dom.window.document.getElementById(id);
      assert(node, `${relativePath} is missing required element #${id}`);
    }
  }
}

function ensureSmokeUser() {
  logStep('Ensuring smoke user exists');
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(smokeUser.username);
  const hashedPassword = bcrypt.hashSync(smokeUser.password, 10);
  if (existing) {
    db.prepare(`
      UPDATE users
      SET email = ?, password = ?, subscriptionPlan = 'premium', isAdmin = 1, isSuspended = 0
      WHERE id = ?
    `).run(smokeUser.email, hashedPassword, existing.id);
    return existing.id;
  }

  const userId = uuidv4();
  db.prepare(`
    INSERT INTO users (id, username, email, password, subscriptionPlan, isAdmin, isSuspended)
    VALUES (?, ?, ?, ?, 'premium', 1, 0)
  `).run(userId, smokeUser.username, smokeUser.email, hashedPassword);
  return userId;
}

async function seedSmokeData(userId, baseUrl) {
  logStep('Seeding smoke-test job, files, and linked campaign');
  const username = smokeUser.username;

  db.prepare("DELETE FROM event_logs WHERE campaignId IN (?, ?)").run(smokeIds.autoCampaignId, 'smoke-sender-campaign');
  db.prepare("DELETE FROM recipients WHERE campaignId IN (?, ?)").run(smokeIds.autoCampaignId, 'smoke-sender-campaign');
  db.prepare("DELETE FROM campaigns WHERE id IN (?, ?)").run(smokeIds.autoCampaignId, 'smoke-sender-campaign');
  db.prepare("DELETE FROM jobs WHERE id = ?").run(smokeIds.jobId);
  db.prepare("DELETE FROM job_categories WHERE id = ? AND userId = ?").run(smokeIds.categoryId, username);

  db.prepare(`
    INSERT INTO job_categories (id, userId, name)
    VALUES (?, ?, ?)
  `).run(smokeIds.categoryId, username, 'Smoke Campaign');

  const jobParams = {
    country: 'United Kingdom',
    states: ['England'],
    cities: ['London'],
    niches: ['Smoke Test Niche'],
    category: smokeIds.categoryId,
    includeGoogleMaps: true,
    includeSocial: false,
    scrapeMode: 'both'
  };

  db.prepare(`
    INSERT INTO jobs (id, userId, status, params, events, files, leadsFound, phonesFound, error)
    VALUES (?, ?, 'completed', ?, ?, ?, 2, 1, '')
  `).run(
    smokeIds.jobId,
    username,
    JSON.stringify(jobParams),
    JSON.stringify([{ type: 'email', value: 'smoke@test.dev', time: new Date().toISOString() }]),
    JSON.stringify(['google_maps_all.csv', 'all_phones.txt', 'all_emails.txt'])
  );

  const jobOutputDir = path.join(outputDir, smokeIds.jobId);
  await fs.rm(jobOutputDir, { recursive: true, force: true });
  await fs.mkdir(jobOutputDir, { recursive: true });
  await fs.writeFile(path.join(jobOutputDir, 'google_maps_all.csv'), 'name,email,phone\nSmoke Co,smoke@test.dev,+44123456789\n');
  await fs.writeFile(path.join(jobOutputDir, 'all_phones.txt'), '+44123456789\n');
  await fs.writeFile(path.join(jobOutputDir, 'all_emails.txt'), 'smoke@test.dev\n');

  const campaignConfig = {
    sequences: [
      {
        delayDays: 0,
        senderName: 'Smoke Bot',
        subject: 'Smoke Job Intro',
        htmlContent: '<p>Hello from smoke test</p>',
        templateId: ''
      }
    ],
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'bot@example.com',
    smtpPass: 'app-pass',
    timezone: 'UTC',
    startTime: '09:00',
    endTime: '17:00',
    publicBaseUrl: baseUrl
  };

  db.prepare(`
    INSERT INTO campaigns (id, userId, name, status, config)
    VALUES (?, ?, ?, 'completed', ?)
  `).run(smokeIds.autoCampaignId, userId, 'Smoke Auto Campaign', JSON.stringify(campaignConfig));

  db.prepare(`
    INSERT INTO recipients (id, campaignId, email, status, sentAt, currentStep, nextSendAt)
    VALUES (?, ?, ?, 'delivered', CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
  `).run(smokeIds.autoRecipientId, smokeIds.autoCampaignId, 'tracked-smoke@test.dev');

  db.prepare(`
    INSERT INTO event_logs (id, eventId, campaignId, recipientId, eventType, ipAddress, userAgent)
    VALUES (?, ?, ?, ?, 'DELIVERED', '127.0.0.1', 'Readiness Script')
  `).run(uuidv4(), smokeIds.autoRecipientId, smokeIds.autoCampaignId, smokeIds.autoRecipientId);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, child, getLogs) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Server exited early with code ${child.exitCode}\n${getLogs()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/login.html`);
      if (res.ok) return;
    } catch {
      // ignore until ready
    }
    await wait(350);
  }
  throw new Error('Server did not start in time.');
}

function startServer(port) {
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    SKIP_STARTUP_RECOVERY: '1',
    SESSION_SECRET: 'smoke-session-secret',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_dummy'
  };

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  let spawnError = null;
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.on('error', (error) => {
    spawnError = error;
    logs += `${error.stack || error.message}\n`;
  });

  return { child, getLogs: () => logs, getSpawnError: () => spawnError };
}

function createClient(baseUrl) {
  let cookieJar = '';

  const updateCookies = (headers) => {
    const setCookie = headers.getSetCookie ? headers.getSetCookie() : headers.get('set-cookie') ? [headers.get('set-cookie')] : [];
    if (!setCookie.length) return;
    const nextParts = new Map();
    for (const cookie of cookieJar.split('; ').filter(Boolean)) {
      const [name, ...value] = cookie.split('=');
      nextParts.set(name, value.join('='));
    }
    for (const cookie of setCookie) {
      const first = cookie.split(';')[0];
      const [name, ...value] = first.split('=');
      nextParts.set(name, value.join('='));
    }
    cookieJar = [...nextParts.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  };

  return async function request(method, pathname, { json, expect = 'json', redirect = 'follow' } = {}) {
    const headers = {};
    if (cookieJar) headers.cookie = cookieJar;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }

    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body,
      redirect
    });

    updateCookies(res.headers);

    if (expect === 'text') {
      return { res, data: await res.text() };
    }
    if (expect === 'buffer') {
      return { res, data: Buffer.from(await res.arrayBuffer()) };
    }
    const data = await res.json().catch(() => null);
    return { res, data };
  };
}

async function runSmokeChecks(baseUrl) {
  const request = createClient(baseUrl);

  logStep('Logging in through /api/login');
  {
    const { res, data } = await request('POST', '/api/login', {
      json: {
        username: smokeUser.username,
        password: smokeUser.password,
        rememberMe: true
      }
    });
    assert(res.ok, `Login failed: ${JSON.stringify(data)}`);
  }

  logStep('Checking authenticated account route');
  {
    const { res, data } = await request('GET', '/api/me');
    assert(res.ok, '/api/me failed');
    assert(data.username === smokeUser.username, 'Authenticated username mismatch');
  }

  logStep('Checking main app pages');
  for (const pathname of ['/dashboard.html', '/sender.html', '/campaign-workbench.html']) {
    const { res, data } = await request('GET', pathname, { expect: 'text' });
    assert(res.ok, `${pathname} did not load`);
    assert(data.includes('<'), `${pathname} did not return HTML`);
  }

  logStep('Checking dashboard list routes');
  {
    const categories = await request('GET', '/api/categories');
    assert(categories.res.ok, '/api/categories failed');
    assert(Array.isArray(categories.data.categories), '/api/categories did not return categories[]');

    const history = await request('GET', '/api/history');
    assert(history.res.ok, '/api/history failed');
    assert(Array.isArray(history.data), '/api/history did not return an array');
    assert(history.data.some((job) => job.id === smokeIds.jobId), 'Seeded smoke job is missing from history');
  }

  logStep('Checking dashboard job detail and file preview routes');
  {
    const detail = await request('GET', `/api/jobs/${smokeIds.jobId}`);
    assert(detail.res.ok, 'Job detail failed');
    assert(detail.data.job.category?.name === 'Smoke Campaign', 'Job category name missing in detail');
    assert(detail.data.job.files.includes('all_emails.txt'), 'Job files missing in detail payload');
    assert(detail.data.job.campaign?.name === 'Smoke Auto Campaign', 'Linked auto campaign missing in job detail');

    const fileRaw = await request('GET', `/api/jobs/${smokeIds.jobId}/files/all_emails.txt/raw`, { expect: 'text' });
    assert(fileRaw.res.ok, 'Raw file preview failed');
    assert(fileRaw.data.includes('smoke@test.dev'), 'Raw file preview content mismatch');
  }

  logStep('Checking dashboard job update contract');
  {
    const update = await request('PATCH', `/api/jobs/${smokeIds.jobId}`, {
      json: {
        campaignName: 'Smoke Auto Campaign Updated',
        niches: ['Updated Smoke Niche'],
        cities: ['Manchester'],
        timezone: 'Europe/London',
        startTime: '10:00',
        endTime: '16:00',
        sequences: [
          {
            delayDays: 0,
            senderName: 'Smoke Bot Updated',
            subject: 'Updated Subject',
            htmlContent: '<p>Updated body</p>',
            templateId: ''
          }
        ]
      }
    });
    assert(update.res.ok, `Job patch failed: ${JSON.stringify(update.data)}`);
    assert(update.data.job.params.cities.includes('Manchester'), 'Job patch did not update cities');
    assert(update.data.job.campaign.name === 'Smoke Auto Campaign Updated', 'Linked campaign name did not update');
  }

  logStep('Checking sender launch/detail/update/history routes');
  {
    const launch = await request('POST', '/api/sender/campaigns', {
      json: {
        campaignName: 'Smoke Sender Campaign',
        recipients: ['recipient-one@test.dev'],
        sequences: [
          {
            delayDays: 0,
            senderName: 'Sender Smoke',
            subject: 'Hello',
            htmlContent: '<p>Hello smoke sender</p>',
            templateId: ''
          }
        ],
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'sender@example.com',
        smtpPass: 'app-pass'
      }
    });
    assert(launch.res.status === 202, `Sender campaign launch failed: ${JSON.stringify(launch.data)}`);
    launchedSenderCampaignId = launch.data.campaignId;
    assert(launchedSenderCampaignId, 'Sender campaign id missing from launch response');

    const detail = await request('GET', `/api/sender/campaigns/${launchedSenderCampaignId}`);
    assert(detail.res.ok, 'Sender campaign detail failed');
    assert(detail.data.campaign.name === 'Smoke Sender Campaign', 'Sender campaign detail name mismatch');

    const update = await request('PATCH', `/api/sender/campaigns/${launchedSenderCampaignId}`, {
      json: {
        campaignName: 'Smoke Sender Campaign Updated',
        timezone: 'UTC',
        startTime: '08:00',
        endTime: '12:00',
        sequences: [
          {
            delayDays: 0,
            senderName: 'Sender Smoke Updated',
            subject: 'Hello Updated',
            htmlContent: '<p>Hello updated</p>',
            templateId: ''
          },
          {
            delayDays: 2,
            senderName: 'Follow Up',
            subject: 'Follow Up',
            htmlContent: '<p>Follow up body</p>',
            templateId: ''
          }
        ]
      }
    });
    assert(update.res.ok, `Sender campaign patch failed: ${JSON.stringify(update.data)}`);
    assert(update.data.campaign.name === 'Smoke Sender Campaign Updated', 'Sender campaign patch did not update name');

    const history = await request('GET', '/api/sender/analytics/history');
    assert(history.res.ok, 'Sender history failed');
    assert(Array.isArray(history.data.history), 'Sender history payload shape changed');
    assert(history.data.history.some((campaign) => campaign.id === launchedSenderCampaignId), 'Launched sender campaign missing from sender history');
  }

  logStep('Checking tracking pixel and click routes');
  {
    const pixel = await request('GET', `/track/o/${smokeIds.autoRecipientId}.gif`, { expect: 'buffer' });
    assert(pixel.res.ok, 'Tracking pixel request failed');
    assert((pixel.res.headers.get('content-type') || '').includes('image/gif'), 'Tracking pixel content-type is wrong');

    const signedUrl = new URL(generateSignedUrl(baseUrl, smokeIds.autoRecipientId, 'https://example.com/target'));
    const click = await request('GET', `${signedUrl.pathname}${signedUrl.search}`, { expect: 'text', redirect: 'manual' });
    assert(click.res.status === 302, 'Tracking click did not redirect');
    assert(click.res.headers.get('location') === 'https://example.com/target', 'Tracking click redirect target mismatch');

    await wait(150);
    const openCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM event_logs
      WHERE campaignId = ? AND recipientId = ? AND eventType = 'OPEN'
    `).get(smokeIds.autoCampaignId, smokeIds.autoRecipientId)?.count || 0;
    const clickCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM event_logs
      WHERE campaignId = ? AND recipientId = ? AND eventType = 'CLICK'
    `).get(smokeIds.autoCampaignId, smokeIds.autoRecipientId)?.count || 0;

    assert(openCount > 0, 'Tracking pixel did not log an OPEN event');
    assert(clickCount > 0, 'Tracking click did not log a CLICK event');
  }

  logStep('Checking sender account analytics');
  {
    const analytics = await request('GET', '/api/sender/analytics/account');
    assert(analytics.res.ok, 'Sender account analytics failed');
    assert(typeof analytics.data.metrics?.deliveryRate !== 'undefined', 'Sender analytics payload is missing metrics');
  }
}

async function cleanupSmokeArtifacts() {
  if (launchedSenderCampaignId) {
    db.prepare("DELETE FROM event_logs WHERE campaignId = ?").run(launchedSenderCampaignId);
    db.prepare("DELETE FROM recipients WHERE campaignId = ?").run(launchedSenderCampaignId);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(launchedSenderCampaignId);
  }
  db.prepare("DELETE FROM event_logs WHERE campaignId IN (?, ?)").run(smokeIds.autoCampaignId, 'smoke-sender-campaign');
  db.prepare("DELETE FROM recipients WHERE campaignId IN (?, ?)").run(smokeIds.autoCampaignId, 'smoke-sender-campaign');
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(smokeIds.autoCampaignId);
  db.prepare("DELETE FROM jobs WHERE id = ?").run(smokeIds.jobId);
  db.prepare("DELETE FROM job_categories WHERE id = ? AND userId = ?").run(smokeIds.categoryId, smokeUser.username);
  await fs.rm(path.join(outputDir, smokeIds.jobId), { recursive: true, force: true });
}

async function main() {
  checkSyntax();
  await checkDomContracts();

  const userId = ensureSmokeUser();
  const externalBaseUrl = process.env.READINESS_BASE_URL || '';
  const port = Number(process.env.READINESS_PORT || 3299);
  const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;

  if (process.env.READINESS_SKIP_SEED !== '1') {
    await seedSmokeData(userId, baseUrl);
  }

  if (process.env.READINESS_SEED_ONLY === '1') {
    console.log('\nReadiness seed prepared.');
    return;
  }

  if (externalBaseUrl) {
    try {
      await runSmokeChecks(baseUrl);
      console.log('\nReadiness checks passed.');
    } finally {
      await cleanupSmokeArtifacts();
    }
    return;
  }

  const { child, getLogs, getSpawnError } = startServer(port);

  try {
    await waitForServer(baseUrl, child, getLogs);
    await runSmokeChecks(baseUrl);
    console.log('\nReadiness checks passed.');
  } catch (error) {
    console.error('\nReadiness checks failed.');
    console.error(error.message);
    const spawnError = getSpawnError();
    if (spawnError) {
      console.error('\nSpawn error:\n');
      console.error(spawnError.stack || spawnError.message);
    }
    const logs = getLogs().trim();
    if (logs) {
      console.error('\nServer logs:\n');
      console.error(logs.slice(-6000));
    }
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    await cleanupSmokeArtifacts();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
