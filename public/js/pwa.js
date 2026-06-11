
let deferredInstallPrompt = null;
const installBanner = document.getElementById('pwa-install-banner');
const installBtn = document.getElementById('install-pwa-btn');
const dismissBtn = document.getElementById('dismiss-pwa-btn');

function showInstallBanner() {
  if (!installBanner) return;
  installBanner.style.display = 'flex';
  requestAnimationFrame(() => installBanner.classList.add('show'));
}

function hideInstallBanner() {
  if (!installBanner) return;
  installBanner.classList.remove('show');
  setTimeout(() => { if (installBanner) installBanner.style.display = 'none'; }, 300);
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallBanner();
});

installBtn?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choiceResult = await deferredInstallPrompt.userChoice;
  if (choiceResult.outcome === 'accepted') {
    console.log('User accepted the PWA install prompt');
  } else {
    console.log('User dismissed the PWA install prompt');
  }
  deferredInstallPrompt = null;
  hideInstallBanner();
});

dismissBtn?.addEventListener('click', () => {
  hideInstallBanner();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered with scope:', registration.scope);
    } catch (err) {
      console.warn('Service Worker registration failed:', err);
    }
  });
}
