// ── Alert System ───────────────────────────────────────────────────────────
// Unified store for BOTH price alerts (type:'price_alert') and
// deal P/L alerts (type:'deal_pnl_alert'), keyed by notification id from DB.
let priceAlerts = {};
let alarmFiring = null, openPopover = null;

// Load alerts from server on startup
async function loadAlerts() {
  const res = await apiFetch('/api/notifications');
  const alerts = await res.json();
  priceAlerts = {};
  alerts.forEach(a => {
    priceAlerts[a.id] = {
      id: a.id,
      type: a.type || 'price_alert',
      instrument: a.instrument_name,
      dealId: a.deal_id || null,
      field: a.field,
      direction: a.direction,
      target: a.target,
      active: a.status === 'armed'
    };
  });
  updateAllAlertButtons();
  updateAlertBadge();
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

// Called on every price update from WebSocket — checks in-memory price_alert entries
// Server also checks DB alerts and sends push + notification_fired WS message
function checkAlerts(data) {
  Object.values(priceAlerts).forEach(al => {
    if (al.type !== 'price_alert' || !al.active || al.instrument !== data.name) return;
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

// Called on every P&L tick — checks in-memory deal_pnl_alert entries
function checkDealPnlAlerts() {
  Object.values(priceAlerts).forEach(al => {
    if (al.type !== 'deal_pnl_alert' || !al.active) return;
    const deal = deals.find(d => d.id === al.dealId);
    if (!deal || deal.status !== 'open') return;
    const pnl = parseFloat(getLivePnl(deal).total || 0);
    const hit = al.direction === 'above' ? pnl >= al.target : pnl <= al.target;
    if (hit) {
      al.active = false;
      const msg = `${deal.instrument} NET P/L ${al.direction === 'above' ? '≥' : '≤'} ${al.target} (now ${pnl.toFixed(0)})`;
      // startAlarm();
      // showAlarmBanner(msg);
      showToast('🔔 Deal P/L Alert', msg, 'alert', 0);
      updateAllAlertButtons();
    }
  });
}

function closePopover() {
  if (openPopover) { openPopover.remove(); openPopover = null; }
  document.removeEventListener('click', outsidePopoverClick);
}

function openAlertPopover(anchorEl, instrument) {
  closePopover();
  const pop = document.createElement('div'); pop.className = 'alert-popover';
  const fields = ['badlaBUY','badlaSELL','badlaLTP','mcx.bid','mcx.ask','comex.bid','comex.ask'];
  pop.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${instrument}</div>
    <label>Field</label>
    <select id="pop-field">${fields.map(f => `<option value="${f}"${f === 'badlaLTP' ? ' selected' : ''}>${f}</option>`).join('')}</select>
    <label>Direction</label>
    <select id="pop-dir">
      <option value="above">Above ≥</option>
      <option value="below">Below ≤</option>
    </select>
    <label>Target Price</label>
    <input type="number" id="pop-target" placeholder="e.g. 1024.50" step="0.01">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" id="pop-set-btn">Set</button>
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  pop.querySelector('#pop-set-btn').addEventListener('click', () =>
    saveAlertPopover(instrument, null));
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

async function saveAlertPopover(instrument, existingId) {
  const field     = document.getElementById('pop-field').value;
  const direction = document.getElementById('pop-dir').value;
  const target    = parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid target price'); return; }

  try {
    let saved;
    if (existingId !== null && priceAlerts[existingId]) {
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
      saved = await res.json();
    }
    priceAlerts[saved.id] = {
      id: saved.id,
      type: 'price_alert',
      instrument: saved.instrument_name,
      dealId: null,
      field: saved.field,
      direction: saved.direction,
      target: saved.target,
      active: true
    };
    closePopover();
    updateAllAlertButtons();
    updateAlertBadge();
    showToast('Alert Set', `${instrument} ${field} ${direction === 'above' ? '≥' : '≤'} ${target}`, 'info', 3000);
  } catch(e) {
    alert('Failed to save alert: ' + e.message);
  }
}

async function removeAlert(id) {
  await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
  delete priceAlerts[id];
  closePopover();
  updateAllAlertButtons();
  updateAlertBadge();
  renderAlertList();
}

async function resetAlert(id) {
  await apiFetch(`/api/notifications/${id}/reset`, { method: 'POST' });
  if (priceAlerts[id]) priceAlerts[id].active = true;
  renderAlertList(); updateAllAlertButtons();
}

function getAlertForInstrument(name) {
  return Object.values(priceAlerts).find(a => a.type === 'price_alert' && a.instrument === name) || null;
}

function getAlertsForDeal(dealId) {
  return Object.values(priceAlerts).filter(a => a.type === 'deal_pnl_alert' && a.dealId === dealId);
}

function toggleInstrumentAlert(name, btnEl) {
  openAlertPopover(btnEl, name);  // always new — no existingAlertId
}

// Deal P/L alert popover — always opens fresh, same as toggleInstrumentAlert.
// Multiple alerts per deal are supported (mirrors dashboard price alerts).
function toggleDealAlert(dealId, btnEl) {
  dealId = parseInt(dealId);
  const d = deals.find(x => x.id === dealId); if (!d) return;
  closePopover();
  const pop = document.createElement('div'); pop.className = 'alert-popover';
  pop.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${d.instrument} P/L</div>
    <label>Direction</label>
    <select id="pop-dir">
      <option value="above">Above ≥</option>
      <option value="below">Below ≤</option>
    </select>
    <label>Target P/L</label>
    <input type="number" id="pop-target" placeholder="e.g. 5000" step="1">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" id="pop-set-btn">Set Alarm</button>
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  pop.querySelector('#pop-set-btn').addEventListener('click', () =>
    saveDealPnlAlert(dealId, null));
  const rect = btnEl.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  document.body.appendChild(pop); openPopover = pop;
  setTimeout(() => document.addEventListener('click', outsidePopoverClick), 10);
}

// ← saves to server, mirrors saveAlertPopover exactly (always creates new)
async function saveDealPnlAlert(dealId, existingId) {
  const direction = document.getElementById('pop-dir').value;
  const target    = parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid P/L target'); return; }
  const deal = deals.find(d => d.id === dealId);

  try {
    const res = await apiFetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dealId, field: 'pnl', direction, target,
        type: 'deal_pnl_alert',
        instrumentName: deal ? deal.instrument : null
      })
    });
    const saved = await res.json();
    priceAlerts[saved.id] = {
      id: saved.id,
      type: 'deal_pnl_alert',
      instrument: saved.instrument_name,
      dealId: saved.deal_id,
      field: saved.field,
      direction: saved.direction,
      target: saved.target,
      active: true
    };
    closePopover();
    updateAllAlertButtons();
    updateAlertBadge();
    showToast('Alert Set', `Deal P/L ${direction === 'above' ? '≥' : '≤'} ${target}`, 'info', 3000);
  } catch(e) {
    alert('Failed to save alert: ' + e.message);
  }
}

function updateAllAlertButtons() {
  updateInstrumentAlertButtons();
  updateDealAlertButtons();
  updateAlertBadge();
}

function updateInstrumentAlertButtons() {
  dashboardInstruments.forEach(name => {
    const btn = document.querySelector(`#dashcard-${slugify(name)} .card-alert-btn`);
    if (!btn) return;
    const alerts = Object.values(priceAlerts).filter(a => a.type === 'price_alert' && a.instrument === name && a.active);
    btn.classList.toggle('active', alerts.length > 0);
    btn.title = alerts.length > 0
      ? `${alerts.length} active alert${alerts.length > 1 ? 's' : ''} — click to add more`
      : 'Set price alert';
  });
}

function updateDealAlertButtons() {
  deals.forEach(deal => {
    const btn = document.querySelector(`#dealcard-${deal.id} .deal-alert-btn`); if (!btn) return;
    const alerts = getAlertsForDeal(deal.id).filter(a => a.active);
    btn.classList.toggle('active', alerts.length > 0);
    btn.title = alerts.length > 0
      ? `${alerts.length} active alert${alerts.length > 1 ? 's' : ''} — click to add more`
      : 'Set P/L alert';
  });
}

function openAlertModal() {
  renderAlertList();
  document.getElementById('alert-modal').classList.add('open');
}

function closeAlertModal() {
  document.getElementById('alert-modal').classList.remove('open');
}

function renderAlertList() {
  const list = document.getElementById('alert-list');
  const all  = Object.values(priceAlerts);
  if (all.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:12px 0">No alerts set. Click 🔔 on any dashboard card or deal to add one.</div>';
    return;
  }
  list.innerHTML = all.map(a => {
    const isDeal = a.type === 'deal_pnl_alert';
    const label  = isDeal ? `${a.instrument || 'Deal'} — P/L` : a.instrument;
    const fieldLine = isDeal ? 'NET P/L' : a.field;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;background:var(--surface2);border:1px solid var(--border);
      border-radius:6px;margin-bottom:8px;gap:8px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="font-size:11px;font-weight:700;color:var(--text);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px">
          ${label}
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">
          ${fieldLine} ${a.direction === 'above' ? '≥' : '≤'} ${a.target}
          <span style="margin-left:8px;color:${a.active ? 'var(--accent)' : 'var(--red)'}">
            ${a.active ? '● Active' : '✓ Pushed'}
          </span>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${!a.active ? `<button onclick="resetAlert(${a.id})"
          style="font-size:10px;background:none;border:1px solid var(--border);
          color:var(--muted);padding:2px 8px;border-radius:3px;cursor:pointer">
          Reset
        </button>` : ''}
        ${!isDeal
          ? `<button onclick="openEditAlertModal(${a.id})"
              style="font-size:10px;background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.25);
              color:var(--accent);padding:2px 8px;border-radius:3px;cursor:pointer">
              Edit
            </button>`
          : `<button onclick="openEditDealAlertPopover(${a.id}, this)"
              style="font-size:10px;background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.25);
              color:var(--accent);padding:2px 8px;border-radius:3px;cursor:pointer">
              Edit
            </button>`}
        <button onclick="removeAlert(${a.id})"
          style="font-size:10px;background:rgba(255,85,85,0.1);border:1px solid rgba(255,85,85,0.25);
          color:var(--red);padding:2px 8px;border-radius:3px;cursor:pointer">
          Delete
        </button>
      </div>
    </div>`;
  }).join('');
}

function initAlerts() {
  if ('Notification' in window) Notification.requestPermission();
  loadAlerts();  // load persisted alerts from server on startup
}

function updateAlertBadge() {
  const badge = document.getElementById('alerts-badge');
  if (!badge) return;
  const armed = Object.values(priceAlerts).filter(a => a.active).length;
  if (armed > 0) {
    badge.style.display = 'block';
    badge.textContent = armed;
  } else {
    badge.style.display = 'none';
  }
}

// Edit a deal P/L alert from the Active Alerts list — small popover,
// direction + target only (no field selector, unlike price alerts).
function openEditDealAlertPopover(alertId, anchorEl) {
  const al = priceAlerts[alertId]; if (!al || al.type !== 'deal_pnl_alert') return;
  closePopover();
  const pop = document.createElement('div'); pop.className = 'alert-popover';
  pop.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${al.instrument || 'Deal'} P/L</div>
    <label>Direction</label>
    <select id="pop-dir">
      <option value="above" ${al.direction === 'above' ? 'selected' : ''}>Above ≥</option>
      <option value="below" ${al.direction === 'below' ? 'selected' : ''}>Below ≤</option>
    </select>
    <label>Target P/L</label>
    <input type="number" id="pop-target" value="${al.target}" step="1">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" id="pop-set-btn">Save</button>
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  pop.querySelector('#pop-set-btn').addEventListener('click', () =>
    saveEditDealAlert(alertId));
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

async function saveEditDealAlert(alertId) {
  const direction = document.getElementById('pop-dir').value;
  const target    = parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid P/L target'); return; }

  try {
    const res = await apiFetch(`/api/notifications/${alertId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'pnl', direction, target })
    });
    const saved = await res.json();
    priceAlerts[saved.id] = {
      id: saved.id,
      type: 'deal_pnl_alert',
      instrument: saved.instrument_name,
      dealId: saved.deal_id,
      field: saved.field,
      direction: saved.direction,
      target: saved.target,
      active: true
    };
    closePopover();
    renderAlertList();
    updateAllAlertButtons();
    updateAlertBadge();
    showToast('Alert Updated', `Deal P/L ${direction === 'above' ? '≥' : '≤'} ${target}`, 'info', 3000);
  } catch(e) {
    alert('Failed to update alert: ' + e.message);
  }
}

let editingAlertId = null;

// Edit modal — price alerts only (deal alerts have no field selector;
// editing a deal alert is done by reopening its popover, same UX as before).
function openEditAlertModal(alertId) {
  const al = priceAlerts[alertId]; if (!al || al.type !== 'price_alert') return;
  editingAlertId = alertId;
  document.getElementById('edit-alert-title').textContent = `🔔 ${al.instrument}`;
  document.getElementById('edit-alert-field').value = al.field;
  document.getElementById('edit-alert-dir').value   = al.direction;
  document.getElementById('edit-alert-target').value = al.target;
  document.getElementById('edit-alert-modal').style.display = 'flex';
}

function closeEditAlertModal() {
  document.getElementById('edit-alert-modal').style.display = 'none';
  editingAlertId = null;
}

async function saveEditAlert() {
  if (!editingAlertId) return;
  const field     = document.getElementById('edit-alert-field').value;
  const direction = document.getElementById('edit-alert-dir').value;
  const target    = parseFloat(document.getElementById('edit-alert-target').value);
  if (isNaN(target)) { alert('Enter a valid target price'); return; }

  try {
    const res = await apiFetch(`/api/notifications/${editingAlertId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, direction, target })
    });
    const saved = await res.json();
    priceAlerts[saved.id] = {
      id: saved.id,
      type: 'price_alert',
      instrument: saved.instrument_name,
      dealId: null,
      field: saved.field,
      direction: saved.direction,
      target: saved.target,
      active: true
    };
    closeEditAlertModal();
    renderAlertList();
    updateAllAlertButtons();
    updateAlertBadge();
    showToast('Alert Updated', `${saved.instrument_name} ${field} ${direction === 'above' ? '≥' : '≤'} ${target}`, 'info', 3000);
  } catch(e) {
    alert('Failed to update alert: ' + e.message);
  }
}