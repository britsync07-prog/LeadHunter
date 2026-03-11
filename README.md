# LeadHunter — Ultimate B2B Lead Generation & Outreach System

LeadHunter is a powerful, full-stack lead generation and automated outreach platform. It combines a high-performance scraping engine with a sophisticated email campaign manager, all within a sleek, modern dashboard.

## 🚀 Key Features

- **Multi-Channel Scraping**: Extract leads from Google Maps, LinkedIn, Facebook, Instagram, and dozens of other sources via targeted search.
- **Intelligent Niche Expansion**: Automatically expand broad niches into specific target roles using AI-driven keyword suggestions.
- **Global Reach**: Precision targeting by Country, State/Region, and City.
- **Robust Scraper Engine**: Built for scale with automatic retries, timeout management, and graceful error handling.
- **Smart Sender (CRM)**:
  - Multi-SMTP Load Balancing: Rotate through multiple mail accounts to protect your sender reputation.
  - Automated Outreach: Send personalized HTML campaigns to your scraped leads instantly.
  - Tracking & Analytics: Monitor opens and clicks in real-time.
- **Global Duplicate Filter**: Cross-job lead tracking ensures you never scrape or contact the same lead twice.
- **Session Resumption**: Interrupted jobs and campaigns automatically resume from their last known state on server restart.

## 🛠 Project Structure

- `src/`: Backend logic (Express, Puppeteer, Worker Queue).
- `public/`: Modern frontend (HTML, Vanilla JS, Tailwind CSS).
- `data/`: SQLite databases and persistent state (Local development).
- `scripts/`: Utility scripts for user management and setup.

## 🚦 Getting Started

### 1. Prerequisites
- **Node.js**: v18+ recommended.
- **Python**: v3.9+ (For the high-performance search engine).
- **Chrome/Chromium**: Required for the Puppeteer scraping runtime.

### 2. Installation
```bash
# Install Node & Python dependencies
npm install
```

### 3. Configuration
Copy the example environment file and fill in your secrets:
```bash
cp .env.example .env
```

### 4. Running the Application
```bash
# Standard start
npm start

# Development with automatic restarts
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🛡 Security & Reliability
- **Rate Limiting**: Protection against brute-force and API abuse.
- **Error Handling**: Comprehensive global error handlers prevent Puppeteer crashes from affecting the server.
- **Data Persistence**: SQLite-based state management ensures no lead is lost.

## 📦 Deployment
LeadHunter is ready for production deployment via **Docker** or **PM2**.

### PM2 Example
```bash
pm2 start ecosystem.config.cjs
```

### Docker Example
```bash
docker-compose up -d
```

## 📜 License
Private Software. All Rights Reserved.
