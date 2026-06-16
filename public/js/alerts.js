// ── Alert System ───────────────────────────────────────────────────────────
let priceAlerts = {};       // keyed by notification id from DB
let dealPnlAlerts = {};
let alarmFiring = null, openPopover = null;

// Load alerts from server on startup
async function loadAlerts() {
  const res = await apiFetch('/api/notifications');
  const alerts = await res.json();
  priceAlerts = {};
  alerts.forEach(a => {
    priceAlerts[a.id] = {
      id: a.id,
      instrument: a.instrument_name,
      field: a.field,
      direction: a.direction,
      target: a.target,
      active: a.status === 'armed'
    };
  });
  updateAllAlertButtons();
}

function startAlarm() {
  if (alarmFiring) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let beat = 0;
  const intervalId = setInterval(() => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = beat % 2 === 0 ? 1200 : 800;
    g.gain.setValueAtTime(0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.18); beat++;
  }, 220);
  alarmFiring = { intervalId, ctx };
}

function stopAlarm() {
  if (!alarmFiring) return;
  clearInterval(alarmFiring.intervalId);
  try { alarmFiring.ctx.close(); } catch(e) {}
  alarmFiring = null;
  const b = document.getElementById('alarm-banner'); if (b) b.remove();
}

function showAlarmBanner(msg) {
  let b = document.getElementById('alarm-banner');
  if (!b) { b = document.createElement('div'); b.id = 'alarm-banner'; b.className = 'alarm-banner'; document.body.prepend(b); }
  b.innerHTML = `<span>🔔 ALARM: ${msg}</span><button class="alarm-stop-btn" onclick="stopAlarm()">■ STOP</button>`;
}

// Called on every price update from WebSocket — checks in-memory priceAlerts
// Server also checks DB alerts and sends push + notification_fired WS message
function checkAlerts(data) {
  Object.values(priceAlerts).forEach(al => {
    if (!al.active || al.instrument !== data.name) return;
    let val;
    if (al.field.includes('.')) {
      const [obj, key] = al.field.split('.');
      val = data[obj] ? parseFloat(data[obj][key]) : NaN;
    } else {
      val = parseFloat(data[al.field]);
    }
    if (isNaN(val)) return;
    const hit = al.direction === 'above' ? val >= al.target : val <= al.target;
    if (hit) {
      al.active = false;
      const msg = `${data.displayName || data.name} ${al.field} ${al.direction === 'above' ? '≥' : '≤'} ${al.target} (now ${val.toFixed(2)})`;
      // startAlarm(); 
      // showAlarmBanner(msg);
      showToast('🔔 Price Alert', msg, 'alert', 0);
      updateAllAlertButtons();
    }
  });
}

function checkDealPnlAlerts() {
  deals.forEach(deal => {
    const al = dealPnlAlerts[deal.id];
    if (!al || !al.active || deal.status !== 'open') return;
    const pnl = parseFloat(getLivePnl(deal).total || 0);
    const hit = al.direction === 'above' ? pnl >= al.target : pnl <= al.target;
    if (hit) {
      al.active = false;
      const msg = `${deal.instrument} NET P/L ${al.direction === 'above' ? '≥' : '≤'} ${al.target} (now ${pnl.toFixed(0)})`;
      // startAlarm();
      // showAlarmBanner(msg);
      showToast('🔔 Deal P/L Alert', msg, 'alert', 0);
      updateDealAlertButtons();
    }
  });
}

function closePopover() {
  if (openPopover) { openPopover.remove(); openPopover = null; }
  document.removeEventListener('click', outsidePopoverClick);
}

function openAlertPopover(anchorEl, instrument, existingAlertId) {
  closePopover();
  const existing = existingAlertId != null ? priceAlerts[existingAlertId] : null;
  const pop = document.createElement('div'); pop.className = 'alert-popover';
  const fields = ['badlaBUY','badlaSELL','badlaLTP','mcx.bid','mcx.ask','comex.bid','comex.ask'];
  const cf = existing?.field || 'badlaLTP';
  const cd = existing?.direction || 'above';
  const ct = existing?.target || '';
  pop.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${instrument}</div>
    <label>Field</label>
    <select id="pop-field">${fields.map(f => `<option value="${f}"${f === cf ? ' selected' : ''}>${f}</option>`).join('')}</select>
    <label>Direction</label>
    <select id="pop-dir">
      <option value="above"${cd === 'above' ? ' selected' : ''}>Above ≥</option>
      <option value="below"${cd === 'below' ? ' selected' : ''}>Below ≤</option>
    </select>
    <label>Target Price</label>
    <input type="number" id="pop-target" placeholder="e.g. 1024.50" value="${ct}" step="0.01">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" id="pop-set-btn">Set</button>
      ${existing ? `<button class="btn btn-danger btn-sm" id="pop-remove-btn">Remove</button>` : ''}
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  pop.querySelector('#pop-set-btn').addEventListener('click', () => 
  saveAlertPopover(instrument, existingAlertId ?? null));
  if (existing) {
    pop.querySelector('#pop-remove-btn').addEventListener('click', () => 
      removeAlert(existingAlertId));
  }
  const rect = anchorEl.getBoundingClientRect();
  const popW = 230;
  let left = rect.left;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  if (left < 12) left = 12;
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = left + 'px';
  document.body.appendChild(pop); openPopover = pop;
  setTimeout(() => document.addEventListener('click', outsidePopoverClick), 10);
}

function outsidePopoverClick(e) {
  if (openPopover && !openPopover.contains(e.target)) closePopover();
}

// ← KEY CHANGE: now saves to server
async function saveAlertPopover(instrument, existingId) {
  const field     = document.getElementById('pop-field').value;
  const direction = document.getElementById('pop-dir').value;
  const target    = parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid target price'); return; }

  try {
    let saved;
    if (existingId !== null && priceAlerts[existingId]) {
      // Update existing
      const res = await apiFetch(`/api/notifications/${existingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, direction, target })
      });
      saved = await res.json();
    } else {
      const res = await apiFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrumentName: instrument, field, direction, target, type: 'price_alert' })
      });
      saved = await res.json();  // ← remove 'const', use outer saved
    }

    // Update in-memory cache
    priceAlerts[saved.id] = {
      id: saved.id,
      instrument: saved.instrument_name,
      field: saved.field,
      direction: saved.direction,
      target: saved.target,
      active: true
    };

    closePopover();
    updateAllAlertButtons();
    showToast('Alert Set', `${instrument} ${field} ${direction === 'above' ? '≥' : '≤'} ${target}`, 'info', 3000);
  } catch(e) {
    alert('Failed to save alert: ' + e.message);
  }
}

async function removeAlert(id) {
  await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
  delete priceAlerts[id];
  closePopover(); updateAllAlertButtons(); renderAlertList();
}

async function resetAlert(id) {
  await apiFetch(`/api/notifications/${id}/reset`, { method: 'POST' });
  if (priceAlerts[id]) priceAlerts[id].active = true;
  renderAlertList(); updateAllAlertButtons();
}

function getAlertForInstrument(name) {
  return Object.values(priceAlerts).find(a => a.instrument === name) || null;
}

function toggleInstrumentAlert(name, btnEl) {
  const e = getAlertForInstrument(name);
  openAlertPopover(btnEl, name, e ? e.id : null);
}

function toggleDealAlert(dealId, btnEl) {
  dealId = parseInt(dealId);
  const d = deals.find(x => x.id === dealId); if (!d) return;
  const existing = dealPnlAlerts[dealId] || null;
  closePopover();
  const pop = document.createElement('div'); pop.className = 'alert-popover';
  pop.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${d.instrument} P/L</div>
    <label>Direction</label>
    <select id="pop-dir">
      <option value="above" ${existing?.direction === 'above' ? 'selected' : ''}>Above ≥</option>
      <option value="below" ${existing?.direction === 'below' ? 'selected' : ''}>Below ≤</option>
    </select>
    <label>Target P/L</label>
    <input type="number" id="pop-target" placeholder="e.g. 5000" value="${existing?.target || ''}" step="1">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" onclick="saveDealPnlAlert(${dealId})">Set Alarm</button>
      ${existing ? `<button class="btn btn-danger btn-sm" onclick="removeDealPnlAlert(${dealId})">Remove</button>` : ''}
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  const rect = btnEl.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  document.body.appendChild(pop); openPopover = pop;
  setTimeout(() => document.addEventListener('click', outsidePopoverClick), 10);
}

function saveDealPnlAlert(dealId) {
  const direction = document.getElementById('pop-dir').value;
  const target    = parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid P/L target'); return; }
  dealPnlAlerts[dealId] = { id: dealId, direction, target, active: true };
  closePopover(); updateDealAlertButtons();
  showToast('Alert Set', `Deal P/L ${direction === 'above' ? '≥' : '≤'} ${target}`, 'info', 3000);
}

function removeDealPnlAlert(dealId) {
  delete dealPnlAlerts[dealId]; closePopover(); updateDealAlertButtons();
}

function updateAllAlertButtons() { updateInstrumentAlertButtons(); updateDealAlertButtons(); }

function updateInstrumentAlertButtons() {
  dashboardInstruments.forEach(name => {
    const btn = document.querySelector(`#dashcard-${slugify(name)} .card-alert-btn`); if (!btn) return;
    const al = getAlertForInstrument(name);
    btn.classList.toggle('active', !!(al?.active));
    btn.title = al ? `Alert: ${al.field} ${al.direction} ${al.target}` : 'Set price alert';
  });
}

function updateDealAlertButtons() {
  deals.forEach(deal => {
    const btn = document.querySelector(`#dealcard-${deal.id} .deal-alert-btn`); if (!btn) return;
    const al = dealPnlAlerts[deal.id];
    btn.classList.toggle('active', !!(al && al.active));
    btn.title = al ? `P/L Alert: ${al.direction} ${al.target}` : 'Set P/L alert';
  });
}

function openAlertModal() { renderAlertList(); document.getElementById('alert-modal').classList.add('open'); }
function closeAlertModal() { document.getElementById('alert-modal').classList.remove('open'); }

function renderAlertList() {
  const list = document.getElementById('alert-list');
  const all  = Object.values(priceAlerts);
  if (all.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:12px 0">No alerts set.</div>';
    return;
  }
  list.innerHTML = all.map(a => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;background:var(--surface2);border-radius:4px;margin-bottom:6px;gap:8px;flex-wrap:wrap">
      <div>
        <span style="font-size:11px;color:var(--text);font-weight:600">${a.instrument}</span>
        <span style="font-size:10px;color:var(--muted);margin-left:8px">${a.field} ${a.direction === 'above' ? '≥' : '≤'} ${a.target}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        <span style="font-size:10px;color:${a.active ? 'var(--accent)' : 'var(--red)'}">
          ${a.active ? '● Armed' : '✓ Fired'}
        </span>
        <button onclick="resetAlert(${a.id})" style="font-size:10px;background:none;border:1px solid var(--border);color:var(--muted);padding:2px 6px;border-radius:3px;cursor:pointer">Reset</button>
        <button onclick="removeAlert(${a.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px">✕</button>
      </div>
    </div>`).join('');
}

function initAlerts() {
  if ('Notification' in window) Notification.requestPermission();
  loadAlerts();  // load persisted alerts from server on startup
}