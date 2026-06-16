// ── Alert System ───────────────────────────────────────────────────────────
let priceAlerts = {};       // keyed by notification id from DB
let dealPnlAlerts = {};
let alarmFiring = null, openPopover = null;

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

async function checkDealPnlAlert(alert, data) {
  const deal = dbAll('SELECT * FROM deals WHERE id = ?', [alert.deal_id])[0];
  if (!deal) return;
  if (deal.status !== 'open') return;   // skip alerts on closed deals

  const total = computeDealLivePnl(deal, data);
  const hit = alert.direction === 'above' ? total >= alert.target : total <= alert.target;
  if (!hit) return;

  dbRun(
    "UPDATE notifications SET status='fired', fired_at=datetime('now','localtime') WHERE id=?",
    [alert.id]
  );

  await sendPushToUser(alert.user_id, {
    title: `🔔 Deal P/L: ${alert.instrument_name}`,
    body: `NET P/L ${alert.direction === 'above' ? '≥' : '≤'} ₹${alert.target} (now ₹${total.toFixed(2)})`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `alert-${alert.id}`,
    requireInteraction: true
  });

  broadcast({
    type: 'notification_fired',
    alertId: alert.id,
    instrument: alert.instrument_name,
    dealId: alert.deal_id,
    direction: alert.direction,
    target: alert.target,
    value: total
  });
}

function closePopover() {
  if (openPopover) { openPopover.remove(); openPopover = null; }
  document.removeEventListener('click', outsidePopoverClick);
}

function outsidePopoverClick(e) {
  if (openPopover && !openPopover.contains(e.target)) closePopover();
}

async function resetAlert(id) {
  await apiFetch(`/api/notifications/${id}/reset`, { method: 'POST' });
  if (priceAlerts[id]) priceAlerts[id].active = true;
  renderAlertList(); updateAllAlertButtons();
}

function getAlertForInstrument(name) {
  return Object.values(priceAlerts).find(a => a.instrument === name) || null;
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

async function saveDealPnlAlert(dealId) {
  const direction = document.getElementById('pop-dir').value;
  const target = parseFloat(document.getElementById('pop-target').value);

  if (isNaN(target)) {
    alert('Enter a valid P/L target');
    return;
  }

  const deal = deals.find(d => d.id === dealId);
  if (!deal) {
    alert('Deal not found');
    return;
  }

  try {
    const res = await apiFetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrumentName: deal.instrument,
        field: 'pnl',
        direction,
        target,
        type: 'deal_pnl_alert',
        dealId
      })
    });

    const contentType = res.headers.get('content-type') || '';
    let data;

    // ✅ Safe parsing (prevents HTML crash)
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      console.error('❌ Non-JSON response:', text);
      throw new Error(`Server returned non-JSON (${res.status})`);
    }

    // ❌ Handle API error
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    // ✅ Success
    priceAlerts[data.id] = data;

    closePopover();
    updateDealAlertButtons();
    showToast(
      'Alert Set',
      `Deal P/L ${direction === 'above' ? '≥' : '≤'} ${target}`,
      'info',
      3000
    );

  } catch (e) {
    console.error('❌ saveDealPnlAlert error:', e);
    alert('Failed to set alert: ' + e.message);
  }
}

function removeDealPnlAlert(dealId) {
  delete dealPnlAlerts[dealId]; closePopover(); updateDealAlertButtons();
}

function updateInstrumentAlertButtons() {
  dashboardInstruments.forEach(name => {
    const btn = document.querySelector(`#dashcard-${slugify(name)} .card-alert-btn`);
    if (!btn) return;
    const alerts = Object.values(priceAlerts).filter(a => a.instrument === name && a.active);
    btn.classList.toggle('active', alerts.length > 0);
    btn.title = alerts.length > 0
      ? `${alerts.length} active alert${alerts.length > 1 ? 's' : ''} — click to add more`
      : 'Set price alert';
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

function initAlerts() {
  if ('Notification' in window) Notification.requestPermission();
  loadAlerts();  // load persisted alerts from server on startup
}


// ── Alert badge in header ──────────────────────────────────────────
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

// ── openAlertPopover — always creates NEW alert, no editing ────────
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

// ── toggleInstrumentAlert — always opens new alert popover ────────
function toggleInstrumentAlert(name, btnEl) {
  openAlertPopover(btnEl, name);  // always new — no existingAlertId
}

// ── saveAlertPopover — always creates new ─────────────────────────
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
      instrument: saved.instrument_name,
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

// ── Edit alert from modal ──────────────────────────────────────────
let editingAlertId = null;

function openEditAlertModal(alertId) {
  const al = priceAlerts[alertId]; if (!al) return;
  editingAlertId = alertId;
  const isPnl = al.type === 'deal_pnl_alert';

  document.getElementById('edit-alert-title').textContent =
    isPnl ? `🔔 ${al.instrument} P/L` : `🔔 ${al.instrument}`;

  // Show/hide field selector based on type
  const fieldGroup = document.getElementById('edit-alert-field').closest('.form-group');
  fieldGroup.style.display = isPnl ? 'none' : 'block';

  document.getElementById('edit-alert-field').value  = al.field || 'badlaLTP';
  document.getElementById('edit-alert-dir').value    = al.direction;
  document.getElementById('edit-alert-target').value = al.target;

  // Update label for P/L vs price
  document.querySelector('label[for-edit-target]')?.remove();
  const targetLabel = document.getElementById('edit-alert-target')
    .previousElementSibling;
  if (targetLabel) targetLabel.textContent = isPnl ? 'Target P/L (₹)' : 'Target Price';

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
    const isPnl = priceAlerts[editingAlertId]?.type === 'deal_pnl_alert';
    const res = await apiFetch(`/api/notifications/${editingAlertId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: isPnl ? 'pnl' : field, direction, target })
    });
    const saved = await res.json();
    priceAlerts[saved.id] = {
      id: saved.id,
      instrument: saved.instrument_name,
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

// ── renderAlertList — shows all alerts with Edit + Delete ──────────
function renderAlertList() {
  const list = document.getElementById('alert-list');
  const all  = Object.values(priceAlerts);
  if (all.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:12px 0">No alerts set.</div>';
    return;
  }
  list.innerHTML = all.map(a => {
    const isPnl = a.type === 'deal_pnl_alert';
    const desc  = isPnl
      ? `NET P/L ${a.direction === 'above' ? '≥' : '≤'} ₹${a.target}`
      : `${a.field} ${a.direction === 'above' ? '≥' : '≤'} ${a.target}`;
    const label = isPnl ? '💼 Deal P/L' : '📊 Price';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;background:var(--surface2);border:1px solid var(--border);
      border-radius:6px;margin-bottom:8px;gap:8px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="font-size:9px;font-weight:700;color:var(--muted);
            text-transform:uppercase;letter-spacing:.06em;background:var(--surface);
            border:1px solid var(--border);padding:1px 5px;border-radius:3px">${label}</span>
          <span style="font-size:11px;font-weight:700;color:var(--text);
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px">
            ${a.instrument}
          </span>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">
          ${desc}
          <span style="margin-left:8px;color:${a.active ? 'var(--accent)' : 'var(--red)'}">
            ${a.active ? '● Armed' : '✓ Fired'}
          </span>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${!a.active ? `<button onclick="resetAlert(${a.id})"
          style="font-size:10px;background:none;border:1px solid var(--border);
          color:var(--muted);padding:2px 8px;border-radius:3px;cursor:pointer">
          Reset
        </button>` : ''}
        <button onclick="openEditAlertModal(${a.id})"
          style="font-size:10px;background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.25);
          color:var(--accent);padding:2px 8px;border-radius:3px;cursor:pointer">
          Edit
        </button>
        <button onclick="removeAlert(${a.id})"
          style="font-size:10px;background:rgba(255,85,85,0.1);border:1px solid rgba(255,85,85,0.25);
          color:var(--red);padding:2px 8px;border-radius:3px;cursor:pointer">
          Delete
        </button>
      </div>
    </div>`;
  }).join('');
}
// ── openAlertModal ─────────────────────────────────────────────────
function openAlertModal() {
  renderAlertList();
  document.getElementById('alert-modal').classList.add('open');
}

function closeAlertModal() {
  document.getElementById('alert-modal').classList.remove('open');
}

// ── updateAllAlertButtons — call updateAlertBadge too ─────────────
function updateAllAlertButtons() {
  updateInstrumentAlertButtons();
  updateDealAlertButtons();
  updateAlertBadge();
}

// ── removeAlert — update badge after delete ────────────────────────
async function removeAlert(id) {
  await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
  delete priceAlerts[id];
  closePopover();
  updateAllAlertButtons();
  updateAlertBadge();
  renderAlertList();
}

// ── loadAlerts — call updateAlertBadge after loading ──────────────
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
  updateAlertBadge();
}