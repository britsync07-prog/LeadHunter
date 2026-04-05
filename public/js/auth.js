/**
 * Auth, Sidebar, and Profile management module for the SaaS frontend.
 */
import { getMe, logout } from './api.js';

let currentUser = null;

// Bind logout functionality globally
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await logout();
      window.location.href = '/login.html';
    });
  }
});

export async function checkAuth(callbacks = {}) {
  try {
    const user = await getMe();
    currentUser = user;

    const isTrialValid = user.trialEndsAt && new Date(user.trialEndsAt) > new Date();

    if (user.subscriptionPlan === 'expired' || user.subscriptionPlan === 'none' || (user.subscriptionPlan === 'free' && !isTrialValid)) {
      window.location.href = "/expired.html";
      return;
    }

    if (user.subscriptionPlan === 'advance' && !user.isAdmin) {
      const navScraper = document.getElementById('navScraper');
      if (navScraper) navScraper.style.display = 'none';

      const backToDashboardLinks = document.querySelectorAll('a[href="/dashboard.html"]');
      backToDashboardLinks.forEach(link => {
        link.href = "/sender.html";
        link.innerHTML = link.innerHTML.replace("Dashboard", "Sender Panel");
      });
      
      if (window.location.pathname.includes('/dashboard.html')) {
        window.location.href = "/sender.html";
        return;
      }
    }

    // Logic specifically for profile display
    const userInfoEl = document.getElementById("userInfo");
    if (userInfoEl) userInfoEl.textContent = `Logged in as: ${user.username}`;

    if (user.isAdmin) {
      const adminLink = document.getElementById('adminPanelLink');
      if (adminLink) adminLink.style.display = 'flex';
    }

    if (typeof callbacks.onAuthSuccess === 'function') {
      callbacks.onAuthSuccess(user);
    }

    setupMobileMenu();
    return user;
  } catch (error) {
    if (!window.location.pathname.includes('login.html')) {
        window.location.href = "/login.html";
    }
  }
}

export function setupMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileOverlay = document.getElementById('mobileOverlay');
  const sidebar = document.querySelector('aside');

  if (!mobileMenuBtn || !mobileOverlay || !sidebar) return;

  const toggle = () => {
    sidebar.classList.toggle('active');
    mobileOverlay.classList.toggle('active');
  };

  mobileMenuBtn.onclick = toggle;
  mobileOverlay.onclick = toggle;

  sidebar.querySelectorAll('nav a').forEach(link => {
    link.onclick = () => {
      if (sidebar.classList.contains('active')) {
        toggle();
      }
    };
  });
}

export function getCurrentUser() {
  return currentUser;
}
