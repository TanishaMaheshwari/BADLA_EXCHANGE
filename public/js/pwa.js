
let deferredInstallPrompt = null;
const installBanner = document.getElementById('pwa-install-banner');
const installBtn = document.getElementById('install-pwa-btn');
const dismissBtn = document.getElementById('dismiss-pwa-btn');

function initPWA() {
  const installBanner = document.getElementById('pwa-install-banner');
  const installBtn    = document.getElementById('install-pwa-btn');
  const dismissBtn    = document.getElementById('dismiss-pwa-btn');

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallBanner();
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hideInstallBanner();
  });

  dismissBtn?.addEventListener('click', () => hideInstallBanner());
}

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

async function subscribeToPush() {
  console.log('1. starting');
  const reg = await navigator.serviceWorker.ready;
  console.log('2. sw ready', reg);
  
  const res = await fetch('/api/push/vapid-key', {
    headers: { 'x-session-token': sessionToken }
  });
  console.log('3. vapid response', res.status);
  const { publicKey } = await res.json();
  console.log('4. publicKey', publicKey);

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: publicKey
  });
  console.log('5. subscribed', sub);

  const saveRes = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken
    },
    body: JSON.stringify(sub)
  });
  console.log('6. saved', saveRes.status);
}