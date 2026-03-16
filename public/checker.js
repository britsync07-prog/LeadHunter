const templateInput = document.getElementById("templateInput");
const testEmailInput = document.getElementById("testEmail");
const subjectInput = document.getElementById("subject");
const checkTemplateBtn = document.getElementById("checkTemplate");
const resultPanel = document.getElementById("resultPanel");
const checkResult = document.getElementById("checkResult");
const spamScore = document.getElementById("spamScore");
const findingsList = document.getElementById("findingsList");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");

async function checkAuth() {
  try {
    const user = await fetchJson("/api/me");
    if (user.subscriptionPlan !== 'premium') {
      window.location.href = "/dashboard.html";
      return;
    }
    userInfoEl.textContent = `Logged in as: ${user.username}`;
  } catch (error) {
    window.location.href = "/login.html";
  }
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401 && !url.includes("/api/me")) {
    window.location.href = "/login.html";
    return;
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch { }
    throw new Error(message);
  }
  const data = await response.json();
  if (url === '/api/me' && (data.subscriptionPlan === 'expired' || data.subscriptionPlan === 'free' || data.subscriptionPlan === 'none')) {
    window.location.href = '/index.html#pricing';
    return;
  }
  return data;
}

checkTemplateBtn.addEventListener("click", async () => {
  const html = templateInput.value.trim();
  const testEmail = testEmailInput.value.trim();
  const subject = subjectInput.value.trim();

  if (!html) {
    alert("Please enter an HTML template.");
    return;
  }

  checkTemplateBtn.disabled = true;
  checkTemplateBtn.textContent = "Checking & Sending...";
  resultPanel.style.display = "none";

  try {
    const response = await fetchJson("/api/check-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, testEmail, subject })
    });

    resultPanel.style.display = "block";
    checkResult.textContent = response.status;
    checkResult.className = `result-badge ${response.status.toLowerCase()}`;

    spamScore.textContent = `Spam Risk Score: ${response.spamScore}`;
    spamScore.className = `spam-score-box ${response.passed ? 'low' : 'high'}`;

    findingsList.innerHTML = "";
    if (response.webhookStatus) {
      const li = document.createElement("li");
      const isError = response.webhookStatus.toLowerCase().includes("error") ||
        response.webhookStatus.toLowerCase().includes("failed") ||
        response.webhookStatus.toLowerCase().includes("cannot");

      li.innerHTML = `<strong>Delivery Status:</strong> <span style="color: ${isError ? '#dc2626' : '#059669'}">${response.webhookStatus}</span>`;
      findingsList.appendChild(li);
    }

    if (response.requestId && testEmail) {
      const waitingLi = document.createElement("li");
      waitingLi.id = "n8n-waiting";
      waitingLi.innerHTML = `<em>(Waiting for n8n feedback...)</em>`;
      findingsList.appendChild(waitingLi);
      pollCallback(response.requestId);
    }

    if (response.findings.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No issues found. Your template looks clean!";
      findingsList.appendChild(li);
    } else {
      response.findings.forEach(finding => {
        const li = document.createElement("li");
        li.textContent = finding;
        findingsList.appendChild(li);
      });
    }
  } catch (error) {
    alert("Check failed: " + error.message);
  } finally {
    checkTemplateBtn.disabled = false;
    checkTemplateBtn.textContent = "Check & Send Test";
  }
});

async function pollCallback(requestId) {
  console.log(`Starting poll for requestId: ${requestId}`);
  const maxAttempts = 30; // 60 seconds total
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      console.log("Polling timed out.");
      clearInterval(interval);
      const waitingEl = document.getElementById("n8n-waiting");
      if (waitingEl) {
        waitingEl.innerHTML = `<em>n8n callback timed out (no response received).</em>`;
      }
      return;
    }

    try {
      const response = await fetch(`/api/checker/status/${requestId}`);
      if (response.ok) {
        const data = await response.json();
        console.log("Received callback data:", data);
        clearInterval(interval);

        // Remove the waiting indicator
        const waitingEl = document.getElementById("n8n-waiting");
        if (waitingEl) waitingEl.remove();

        // Add callback result to top of findings
        const li = document.createElement("li");
        li.style.background = "#eff6ff";
        li.style.border = "1px solid #bfdbfe";
        li.style.padding = "10px";
        li.style.borderRadius = "4px";
        li.style.margin = "10px 0";

        const isError = data.message?.toLowerCase().includes("cannot") ||
          data.message?.toLowerCase().includes("error") ||
          data.message?.toLowerCase().includes("failed");

        li.innerHTML = `<strong style="display: block; margin-bottom: 5px;">n8n Final Status:</strong> <span style="font-size: 1.1em; font-weight: bold; color: ${isError ? '#dc2626' : '#2563eb'}">${data.message}</span>`;
        if (data.details) {
          li.innerHTML += `<br><small style="color: #4b5563;">${data.details}</small>`;
        }
        findingsList.insertBefore(li, findingsList.firstChild);
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
  }, 2000);
}

checkAuth();
