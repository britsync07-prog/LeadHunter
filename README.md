# LeadHunter
> A full-stack B2B lead generation and automated email outreach platform with a built-in campaign sender.

LeadHunter (repository `testingit`) combines a high-performance, multi-source scraping engine with a complete email campaign manager behind a single Express application and a modern Next.js dashboard. Operators scrape leads from Google Maps, LinkedIn, Facebook, Instagram, and other targeted search sources, manage them in a SQLite-backed workspace, then run personalized HTML campaigns through load-balanced SMTP senders with real-time open and click tracking, subscriptions, and an admin-controlled newsletter broadcast system.

## Overview

The backend (`src/`) is a Node 18+ Express server that owns everything: session-based authentication with a SQLite session store, a worker queue for scrape jobs with automatic retries and session resumption, Puppeteer/Playwright-driven scrapers supplemented by Python (undetected-chromedriver/Selenium) helpers, the "Smart Sender" CRM (multi-SMTP rotation, campaigns, tracking pixel, HMAC-signed click links), Stripe subscription billing with trials and expiry handling, and an admin panel for users, stats, SMTP configuration, and newsletters.

A second frontend lives in `frontend-next/` as a React 18 + Next.js 14 + TypeScript app styled with a dark glassmorphism SaaS design system, harmonized with the landing page palette and run alongside the API under PM2.

## Features

- Multi-channel lead scraping (Google Maps, LinkedIn, Facebook, Instagram and more) with niche expansion into specific target roles
- Geo-targeting by country, state/region, and city via live country metadata API
- Robust scraper engine: worker queue with concurrency of three, automatic retries, timeout management, stale-job cleanup on startup, and job history persistence
- Session resumption: interrupted jobs and campaigns resume from their last known state after restart
- Global duplicate filter across jobs so a lead is never scraped or contacted twice
- Smart Sender CRM: contact lists, personalized HTML campaigns, inline CSS inlining (juice), HTML validation, CSV export
- Multi-SMTP load balancing: rotate across multiple mail accounts to protect sender reputation; per-campaign sender selection
- Dedicated newsletter SMTP configuration kept separate from the system transactional SMTP
- Admin newsletter broadcast system with audience segmentation and reusable templates
- Open/click tracking with HMAC-signed tracking links and tracking pixel; admin-controlled global toggles for Open Rate and Click Rate
- User subscriptions: 3-day premium trial on registration, plan gating, expiry routing, self-service forgot-password flow
- Admin panel: user management, password resets, system SMTP config, connection tests, platform statistics
- Security hardening: helmet, express-rate-limit, compression, SQLite-backed sessions, trust-proxy support behind Nginx

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend runtime | Node.js 18+, ES modules |
| Web framework | Express 4 (sessions, helmet, rate limiting, compression) |
| Database | SQLite (better-sqlite3, connect-sqlite3 session store) |
| Scraping | Puppeteer + puppeteer-extra-stealth, Playwright, cheerio, jsdom |
| Python helpers | undetected-chromedriver, Selenium (requirements.txt) |
| Email | Nodemailer (multiple transports), custom pixel + HMAC click tracking |
| Payments | Stripe SDK (subscriptions, webhooks) |
| Frontend (classic) | Vanilla JS + Tailwind CSS (`public/`) |
| Frontend (dashboard) | Next.js 14, React 18, TypeScript, Tailwind (`frontend-next/`) |
| Process / Deployment | PM2 (`ecosystem.config.cjs`), Dockerfile, docker-compose |
| Observability | pino/pino-pretty logging, request timing middleware |

## Architecture

`src/server.js` is the composition root. It installs an EPIPE guard so closed SSE/browser sockets never crash the process, mounts global request logging, auth, and admin middleware, initializes the `JobQueue(3)` (with stale-job cleanup unless `SKIP_STARTUP_RECOVERY=1`), re-seeds/migrates auth tables, and re-asserts admin persistence on boot. Routes are grouped by concern: scraper metadata and job endpoints, sender API routes (`src/sender/routes/apiRoutes.js`), tracking routes (pixel and redirect), campaign processing, admin SMTP and newsletter SMTP routes, and Stripe webhooks.

The sender subsystem is layered MVC-style under `src/sender/`: controllers (auto-mail, campaign, SMTP, analytics, tracking), services (mailer, campaign inspector, email sanitizer, HMAC signing, pixel rendering), models (SQLite databases for sender state), and routes. Tracking honors global admin toggles before emitting events, and every outbound link uses HMAC signatures so events cannot be forged without `TRACKING_HMAC_SECRET`.

Scrape jobs flow: UI request -> queued job -> Puppeteer worker (stealth plugin, retries, timeouts) -> deduplication against historical leads -> results persisted to SQLite -> SSE progress to the dashboard. Campaigns flow: segment selection -> template personalization -> SMTP transport rotation -> per-recipient tracking IDs -> open/click events aggregated in the analytics controller.

## Project Structure

```text
testingit/
├── README.md
├── API_DOCUMENTATION.md            # Auth, scraper, and sender endpoint reference
├── package.json                    # start/dev/check/readiness/setup scripts
├── requirements.txt                # Python scraper deps (undetected-chromedriver, selenium)
├── .env.example                    # production environment template
├── ecosystem.config.cjs            # PM2: backend + Next.js frontend services
├── Dockerfile / docker-compose.yml
├── lead.py                         # Python scraping helper entrypoint
├── scripts/                        # add_user, readiness check, browser/python setup
├── data/                           # SQLite databases and persistent state (dev)
├── public/                         # Classic frontend (HTML, vanilla JS, Tailwind)
├── frontend-next/                  # Next.js 14 + React 18 dashboard (dark glass UI)
│   ├── app/ components/
│   └── tailwind.config.ts
└── src/
    ├── server.js                   # Express bootstrap, routes, guards (1,380 lines)
    ├── auth.js                     # sessions, registration, resets, SMTP configs
    ├── queue.js                    # JobQueue: retries, cleanup, resumption
    ├── scraper.js google_scraper.js maps.js social_scraper.js phone_utils.js
    └── sender/
        ├── controllers/            # autoMail, campaigns, smtp, analytics, tracking
        ├── services/               # mailer, hmac, pixel, sanitizer, inspector
        ├── models/                 # db.js schema + SQLite state databases
        └── routes/                 # apiRoutes, trackingRoutes
```

## Getting Started

### Prerequisites

- Node.js v18+
- Python 3.9+ (high-performance search/scraping helpers)
- Chrome/Chromium for the Puppeteer runtime
- On Debian/Ubuntu, Linux browser libraries: `sudo ./scripts/install_browser_deps.sh`

### Installation

```bash
# One-time Linux browser runtime packages
sudo ./scripts/install_browser_deps.sh

# Node dependencies (postinstall also installs Python deps)
npm install

# Sanity checks
npm run check              # syntax-check server.js and scraper.js
npm run check:readiness    # environment readiness probe

# Create the first admin user
npm run add-user
```

### Environment Variables

Copy `.env.example` to `.env`; variable names only below:

| Variable | Placeholder |
| --- | --- |
| NODE_ENV | production |
| PORT / HOST | 3000 / 0.0.0.0 |
| PUBLIC_URL | https://example.com |
| SESSION_SECRET | generate-a-long-random-string |
| TRACKING_HMAC_SECRET | generate-another-random-string |
| EXTERNAL_API_KEY | your-secure-api-key |
| STRIPE_SECRET_KEY | sk_test_placeholder |
| STRIPE_WEBHOOK_SECRET | whsec_placeholder |
| LOG_LEVEL | info |
| SKIP_STARTUP_RECOVERY | 0 |

### Running

```bash
# Standard start (http://localhost:3000)
npm start

# Development with automatic restarts
npm run dev

# Production under PM2 (runs backend and Next.js frontend together)
pm2 start ecosystem.config.cjs

# Docker
docker-compose up -d
```

## Challenges Faced & Solutions

- **Puppeteer crashes took the whole API down**: async "Target closed" errors and unhandled rejections from headless Chrome killed requests mid-scrape. **Solution**: layered global handlers — EPIPE from dead SSE sockets is swallowed silently while genuine exceptions still surface, and unhandled rejections are logged without process exit, keeping the server alive.
- **Newsletter sending risked the transactional sender's reputation**: broadcasts shared SMTP credentials with system mail. **Solution**: introduced a dedicated newsletter SMTP configuration stored separately and exposed via `/api/admin/newsletter-smtp*` routes with its own connection test, deliberately separated from the system transactional SMTP (commit `feat: add dedicated newsletter SMTP configuration ...`).
- **Admin panel silently broke**: a syntax error in `admin.js` prevented users and statistics from loading. **Solution**: fixed the parser error and verified the users/stats payloads render again (commit `fix: resolve syntax error in admin.js ...`).
- **Tracking could not be turned off for compliance-sensitive sends**: open/click instrumentation was always on. **Solution**: added admin-controlled global toggles for Open Rate and Click Rate checked before any event is recorded (commit `feat: admin-controlled global tracking toggles ...`).
- **Interrupted work was lost on restart**: long scrapes and campaigns died with the process. **Solution**: persisted queue state in SQLite, added stale-job cleanup at boot plus session resumption from last known state; guarded with `SKIP_STARTUP_RECOVERY` for controlled runs.
- **Expired accounts still reached paid surfaces**: login routed expired users into normal flows. **Solution**: strict routing of expired users to `expired.html`, admin ability to set users to expired/none explicitly, and correct display of plan/trial state in the dashboard (commits `0ef5e8e`, `e434c23`, `ae40bef`).
- **Admin flag lost on VPS redeploy**: fresh deployments demoted the seeded admin. **Solution**: idempotent boot-time statement re-asserts `isAdmin = 1` for the admin account ("ENSURE ADMIN PERSISTENCE" fix).
- **Two frontends, one host**: running the classic Tailwind UI and the new Next.js dashboard side by side needed orchestration. **Solution**: extended `ecosystem.config.cjs` to manage both services under PM2 and rebuilt the dashboard with a dark glass design system whose tokens match the landing page (commits `3b25969`, `94b687c`, `e77ddfe`).

## Known Limitations & Roadmap

- SQLite is pragmatic but caps concurrent write throughput; PostgreSQL migration is the natural next step for multi-instance scale.
- The classic `public/` frontend and `frontend-next/` dashboard coexist; consolidating onto the Next.js app would remove duplicated styling logic.
- LinkedIn/Facebook scraping depends on brittle third-party markup; stealth plugins mitigate but cannot eliminate breakage.
- Repository hygiene flags: `cookie.txt`, `database.sqlite`, `browser-state*.json`, `freelancer_portfolio_data.txt` (plus `src/sender/models/*.db`) are committed and should be removed and gitignored; `API_DOCUMENTATION.md` embeds a live API key that must be rotated and moved to configuration.
- Roadmap candidates: webhook-driven CRM sync, per-sender deliverability scoring, A/B subject-line testing, and multi-workspace tenancy.

## Security Notes

- Sessions use HTTPOnly cookies backed by a SQLite store; rate limiting protects auth and API surfaces; helmet is enabled (CSP relaxed for inline dashboards).
- Tracking links are HMAC-signed; keep `TRACKING_HMAC_SECRET` unique per deployment because a fallback exists in code for local development.
- Stripe webhooks require signature verification via `STRIPE_WEBHOOK_SECRET`; the client falls back to a dummy test key if unset — always configure it in production.
- Rotate the API key published in `API_DOCUMENTATION.md` and treat `cookie.txt`/committed databases as sensitive artifacts to purge from git history before any public release.
- README declares the software private/all-rights-reserved; do not redistribute without owner consent.

## License
MIT License — Copyright (c) 2026 Musfiqur Rahman Saimon. See [LICENSE](./LICENSE).
