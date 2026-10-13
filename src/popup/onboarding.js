// ============================================================
// TabMod — Onboarding Page Controller
//
// 4-step interactive tutorial shown on first install.
// Handles navigation, the "Save All Tabs Now" action,
// and marks onboarding as complete.
// ============================================================

import { initI18n, applyI18n, t } from '../lib/i18n.js';

const TOTAL_STEPS = 4;
let currentStep = 1;

// ---- DOM Cache ----
const dom = {
  progressTrack: document.getElementById('progressTrack'),
  dots: document.querySelectorAll('.step-dot'),
  steps: document.querySelectorAll('.step'),
  indicator: document.getElementById('stepIndicator'),
  skipBtn: document.getElementById('skipBtn'),
  saveNowBtn: document.getElementById('saveNowBtn'),
  finishBtn: document.getElementById('finishBtn'),
};

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  applyI18n();

  // event listeners
  dom.skipBtn.addEventListener('click', completeOnboarding);
  dom.saveNowBtn.addEventListener('click', handleSaveAll);
  dom.finishBtn.addEventListener('click', completeOnboarding);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (currentStep < TOTAL_STEPS) {
        goToStep(currentStep + 1);
      }
    }
    if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') {
      if (currentStep > 1) {
        goToStep(currentStep - 1);
      }
    }
    if (e.key === 'Escape') {
      completeOnboarding();
    }
  });
});

// ---- Step Navigation ----

/**
 * Navigate to a specific step.
 * @param {number} step - Step number (1-indexed)
 */
function goToStep(step) {
  if (step < 1 || step > TOTAL_STEPS) return;

  currentStep = step;

  // Update dots
  dom.dots.forEach((dot, i) => {
    const dotStep = parseInt(dot.dataset.step);
    dot.classList.toggle('active', dotStep === step);
    dot.classList.toggle('completed', dotStep < step);
  });

  // Update progress bar width
  const progress = Math.round((step / TOTAL_STEPS) * 100);
  dom.progressTrack.setAttribute('data-progress', progress);

  // Show/hide steps
  dom.steps.forEach((s) => s.classList.remove('active'));
  const target = document.getElementById(`step${step}`);
  if (target) target.classList.add('active');

  // Update indicator text
  dom.indicator.textContent = `${step} / ${TOTAL_STEPS}`;

  // Focus the step container for accessibility
  if (target) target.focus?.();
}

// Make goToStep available globally for onclick handlers in HTML
window.goToStep = goToStep;

// ---- Save All Tabs ----

async function handleSaveAll() {
  const btn = dom.saveNowBtn;
  btn.disabled = true;
  btn.textContent = t('statusSaving');
  btn.style.opacity = '0.7';

  try {
    // The onboarding page runs in a full tab, not the popup.
    // We can access chrome.tabs API directly here.
    const tabs = await chrome.tabs.query({});
    const tabData = tabs.map((t) => ({
      url: t.url || '',
      title: t.title || '',
      favicon: t.favIconUrl || '',
    }));

    // Store via a message to the Service Worker
    // Since we're in a full tab, use sendMessage (not port)
    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_ALL_ONBOARDING',
      payload: { tabs: tabData },
    });

    if (result && result.success) {
      btn.textContent = `✓ ${t('tabSaved_other', result.added || tabData.length)}`;
      btn.style.background = 'var(--accent-green)';
      btn.style.opacity = '1';

      setTimeout(() => {
        completeOnboarding();
      }, 1200);
    } else {
      btn.textContent = '⚡ ' + t('onboardingCTA');
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  } catch (err) {
    console.error('[TabMod Onboarding] Save failed:', err);
    btn.textContent = '⚡ ' + t('onboardingCTA');
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ---- Complete ----

async function completeOnboarding() {
  try {
    // Mark onboarding as done in storage
    await chrome.storage.local.set({ onboardingDone: true });

    // Try to open the extension popup
    try {
      await chrome.action.openPopup();
    } catch (_) {
      // openPopup might not be available in all Chrome versions
      // Fallback: just close this tab
    }

    // Close the onboarding tab
    const currentTab = await getCurrentTab();
    if (currentTab?.id) {
      chrome.tabs.remove(currentTab.id);
    }
  } catch (err) {
    // Silently handle — worst case the tab stays open
    console.warn('[TabMod Onboarding] Cleanup:', err);
  }
}

async function getCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}
