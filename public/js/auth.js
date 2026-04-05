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
    
    // Populate the dashboard's profile modal if the function exists on the page
    if (typeof window.populateProfileModal === 'function') {
      window.populateProfileModal(user);
    }

    // Display the current plan explicitly in the top navigation bar
    const currentPlanEl = document.getElementById('currentPlanEl');
    if (currentPlanEl) {
      currentPlanEl.classList.remove('hidden');
      let planLabel = user.subscriptionPlan || 'none';
      if (user.subscriptionPlan === 'free' && isTrialValid) {
        const days = Math.ceil((new Date(user.trialEndsAt) - new Date()) / 86400000);
        planLabel = `Free Trial · ${days}d left`;
        currentPlanEl.style.cssText = 'border-color: #bfdbfe; color: #2563eb; background: #eff6ff; display: inline-flex; align-items: center; justify-content: center;';
      } else if (user.subscriptionPlan === 'premium') {
        currentPlanEl.style.cssText = 'border-color: #a7f3d0; color: #059669; background: #ecfdf5; display: inline-flex; align-items: center; justify-content: center;';
      } else if (user.subscriptionPlan === 'advance') {
        currentPlanEl.style.cssText = 'border-color: #c4b5fd; color: #7c3aed; background: #f5f3ff; display: inline-flex; align-items: center; justify-content: center;';
      } else {
        currentPlanEl.style.cssText = 'border-color: #e2e8f0; color: #475569; background: #f8fafc; display: inline-flex; align-items: center; justify-content: center;';
      }
      currentPlanEl.textContent = planLabel.charAt(0).toUpperCase() + planLabel.slice(1);
    }

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
