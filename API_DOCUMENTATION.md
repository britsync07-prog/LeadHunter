# LeadHunter & Sender API Documentation

This document provides a comprehensive guide to the backend API endpoints for the LeadHunter (Scraper) and Sender (Email Campaign) platforms.

## Base URL
`https://leadhunter.uk/` (Default: `https://leadhunter.uk/`)

The api key is:1245368628749012998
---

## 1. Authentication API
Endpoints for user session management.

### **POST** `/api/auth/register`
Registers a new user. New users receive a 3-day Premium trial by default.
- **Body:**
  ```json
  {
    "username": "johndoe",
    "email": "john@example.com",
    "password": "securepassword123"
  }
  ```
- **Response (Success):** `200 OK`
  ```json
  { "success": true, "username": "johndoe" }
  ```

### **POST** `/api/login`
Authenticates a user and starts a session.
- **Body:**
  ```json
  {
    "username": "johndoe",
    "password": "securepassword123",
    "rememberMe": true
  }
  ```
- **Response (Success):** `200 OK`
  ```json
  { "username": "johndoe" }
  ```

### **POST** `/api/logout`
Destroys the current session.
- **Response:** `204 No Content`

### **GET** `/api/me`
Returns current session user details and usage statistics.
- **Response (Success):** `200 OK`
  ```json
  {
    "username": "johndoe",
    "email": "john@example.com",
    "subscriptionPlan": "premium",
    "trialEndsAt": "2026-03-14T10:00:00.000Z",
    "isAdmin": false,
    "usage": { "dailyCount": 150, "monthlyCount": 1200 },
    "activeJobId": "uuid-string-or-null"
  }
  ```

---

## 2. LeadHunter (Scraper) API
Endpoints for metadata and lead generation jobs. These require authentication.

### **GET** `/api/metadata`
Fetches available countries for scraping.
- **Response:** `{ "countries": ["USA", "Canada", ...], "source": "..." }`

### **GET** `/api/location?country=USA&state=California`
Fetches states or cities for a specific country/state.
- **Query Params:** `country` (required), `state` (optional)
- **Response:** `{ "country": "USA", "state": "California", "cities": ["Los Angeles", ...] }`

### **POST** `/api/jobs`
Starts a new scraping job.
- **Body:**
  ```json
  {
    "country": "USA",
    "cities": ["New York", "Boston"],
    "niches": ["Real Estate", "Dentists"],
    "includeGoogleMaps": true,
    "scrapeMode": "both",
    "category": "My Leads"
  }
  ```
- **Response:** `202 Accepted` - `{ "jobId": "uuid", "status": "running" }`

### **GET** `/api/jobs/:jobId/events` (SSE)
Server-Sent Events stream for real-time job progress.
- **Demo:** `const evtSource = new EventSource('/api/jobs/uuid/events');`

### **POST** `/api/jobs/:jobId/stop`
Aborts a running job.
- **Response:** `{ "message": "Stopped" }`

### **GET** `/api/history`
Returns history of all jobs for the current user.

---

## 3. Sender (Email Campaigns) API
Endpoints for managing email campaigns and SMTP accounts. Prefix: `/api/sender`.

### **POST** `/api/sender/campaigns`
Launches a new email campaign.
- **Body:**
  ```json
  {
    "campaignName": "Spring Sale",
    "senderName": "John from Sales",
    "subject": "Exclusive Offer!",
    "htmlContent": "<h1>Hello {{name}}</h1>...",
    "recipients": ["client1@email.com", "client2@email.com"],
    "smtpAccountIds": ["uuid-1", "uuid-2"] 
  }
  ```
- **Note:** `smtpAccountIds` is for Premium/Admin users. Others provide `smtpHost`, `smtpPort`, etc., directly in the body.

### **GET** `/api/sender/smtp`
Lists saved SMTP accounts for the user.

### **POST** `/api/sender/smtp`
Saves a new SMTP account. The backend verifies connection before saving.
- **Body:** `{ "host": "smtp.mail.com", "port": 587, "user": "...", "pass": "..." }`

---

## 4. Analytics API
Prefix: `/api/sender/analytics`.

### **GET** `/api/sender/analytics/account`
Aggregated stats for the entire account (Total Sent, Open Rate, CTR, etc.).

### **GET** `/api/sender/analytics/:campaignId`
Detailed stats for a specific campaign.
- **Response Example:**
  ```json
  {
    "rawCounts": { "sent": 100, "delivered": 95, "uniqueOpens": 40, "uniqueClicks": 10 },
    "metrics": { "openRate": "42.11%", "clickThroughRate": "10.53%" }
  }
  ```

### **GET** `/api/sender/analytics/history`
List of all previous campaigns with status and report file links.

---

## 5. External API (System Integration)
Designed for machine-to-machine communication. Requires `x-api-key` header.
- **Base:** `/api/external/...`
- **Endpoints:**
    - `GET /api/external/countries`
    - `POST /api/external/jobs` (Standard scraping job)
    - `GET /api/external/jobs/:jobId/status` (Returns download links if completed)

---

## 6. Admin API
Restricted to users where `isAdmin: true`. Prefix: `/api/admin`.

### **GET** `/api/admin/users`
Lists all users with search filtering (`?q=query`).

### **PATCH** `/api/admin/users/:id/plan`
Changes a user's subscription plan.
- **Body:** `{ "plan": "premium" }`

### **PATCH** `/api/admin/users/:id/suspend`
Suspends or unsuspends a user account.
- **Body:** `{ "suspended": true }`

---

## 8. Frontend Implementation Examples

### **Starting a Scraper Job**
```javascript
async function startScraper() {
  const response = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      country: "USA",
      cities: ["New York"],
      niches: ["Real Estate"],
      scrapeMode: "both"
    })
  });
  const data = await response.json();
  console.log('Job Started:', data.jobId);
}
```

### **Listening to Real-time Progress (SSE)**
```javascript
function monitorJob(jobId) {
  const eventSource = new EventSource(`/api/jobs/${jobId}/events`);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'PROGRESS') {
      console.log(`Leads found: ${data.leadsFound}`);
    } else if (data.type === 'COMPLETED') {
      console.log('Scraping finished!');
      eventSource.close();
    }
  };
}
```

### **Launching an Email Campaign**
```javascript
async function sendCampaign() {
  const payload = {
    campaignName: "Test Campaign",
    subject: "Hello World",
    htmlContent: "<p>Hi {{name}}, check this out!</p>",
    recipients: ["user@example.com"],
    smtpAccountIds: ["id-from-smtp-list"]
  };

  const response = await fetch('/api/sender/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  alert(`Campaign launched: ${result.campaignId}`);
}
```
