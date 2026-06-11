// services/broadcast.js
const fs = require('fs');
const path = require('path');
const { broadcast, latestPrices } = require('./websocket');

const BROADCAST_FILE = path.join(__dirname, '../broadcast.json');

function startBroadcastWatcher() {
  // seed on startup
  if (fs.existsSync(BROADCAST_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(BROADCAST_FILE, 'utf8'));
      for (const [id, result] of Object.entries(raw.data || {}))
        latestPrices[id] = result;
      console.log(`Seeded ${Object.keys(latestPrices).length} instruments`);
    } catch(e) { console.warn('Could not seed:', e.message); }
  }

  let debounceTimer = null;
  const watchDir  = path.dirname(BROADCAST_FILE);
  const watchFile = path.basename(BROADCAST_FILE);

  fs.watch(watchDir, (eventType, filename) => {
    if (filename !== watchFile) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const raw = JSON.parse(fs.readFileSync(BROADCAST_FILE, 'utf8'));
        for (const [id, result] of Object.entries(raw.data || {})) {
          latestPrices[id] = result;
          broadcast({ type: 'update', data: result });
        }
      } catch(e) {}
    }, 4);
  });

  console.log(`Watching ${BROADCAST_FILE}`);
}

module.exports = { startBroadcastWatcher };