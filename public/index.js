// ── State ──────────────────────────────────────────────────────────────────
let prices = {};
let deals  = [];
let brokers = [];
let orders = [];
let dashboardInstruments = [];
let filter = 'ALL';
let updateCount = 0;
let closingDealId = null;
let dealTab = 'open';
let orderTab = 'all';
let sessionToken = localStorage.getItem('badla_token');
let currentUser  = localStorage.getItem('badla_user');
let editingDealId = null;
let editingBrokerId = null;
let orderModalInstrument = null; // pre-fill from dashboard card
function applyFontSize(size) {
  const scale = size / 13; // 13 is the base font size
  document.getElementById('app').style.zoom = scale;
  document.getElementById('font-size-label').textContent = size + 'px';
  localStorage.setItem('badla_font_size', size);
}
function toggleProfileMenu(e) {
  e.stopPropagation();
  e.preventDefault();
  const menu = document.getElementById('profile-menu');
  const isOpen = menu.style.display === 'block';
  if (isOpen) {
    menu.style.display = 'none';
    document.removeEventListener('click', outsideProfileClick);
  } else {
    menu.style.display = 'block';
    document.getElementById('profile-username').textContent = currentUser;
    setTimeout(() => document.addEventListener('click', outsideProfileClick), 100);
  }
}
function outsideProfileClick(e) {
  const menu = document.getElementById('profile-menu');
  const btn  = document.getElementById('profile-btn');
  if (!menu || !btn) return;
  if (!menu.contains(e.target) && !btn.contains(e.target)) {
    menu.style.display = 'none';
    document.removeEventListener('click', outsideProfileClick);
  }
}
function applyFontSize(size) {
  document.body.style.fontSize = size + 'px';
  document.getElementById('font-size-label').textContent = size + 'px';
  localStorage.setItem('badla_font_size', size);
}

// ── Alert System ───────────────────────────────────────────────────────────
let priceAlerts = {};
let dealPnlAlerts = {};
let alarmFiring = null, alertIdCounter = 0, openPopover = null;
function newAlertId() { return ++alertIdCounter; }

function startAlarm() {
  if (alarmFiring) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let beat = 0;
  const intervalId = setInterval(() => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = beat%2===0?1200:800;
    g.gain.setValueAtTime(0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.18);
    o.start(ctx.currentTime); o.stop(ctx.currentTime+0.18); beat++;
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
  if (!b) { b = document.createElement('div'); b.id='alarm-banner'; b.className='alarm-banner'; document.body.prepend(b); }
  b.innerHTML = `<span>🔔 ALARM: ${msg}</span><button class="alarm-stop-btn" onclick="stopAlarm()">■ STOP</button>`;
}
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
      startAlarm(); showAlarmBanner(msg); showToast('🔔 Price Alert', msg, 'alert', 0);
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
      startAlarm(); showAlarmBanner(msg); showToast('🔔 Deal P/L Alert', msg, 'alert', 0);
      updateDealAlertButtons();
    }
  });
}

function closePopover() {
  if (openPopover) { openPopover.remove(); openPopover=null; }
  document.removeEventListener('click', outsidePopoverClick);
}
function openAlertPopover(anchorEl, instrument, existingAlertId) {
  closePopover();
  const existing = existingAlertId!=null ? priceAlerts[existingAlertId] : null;
  const pop = document.createElement('div'); pop.className='alert-popover';
  const fields=['badlaBUY','badlaSELL','badlaLTP','mcx.bid','mcx.ask','comex.bid','comex.ask'];
  const cf=existing?.field||'badlaLTP', cd=existing?.direction||'above', ct=existing?.target||'';
  pop.innerHTML=`
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${instrument}</div>
    <label>Field</label>
    <select id="pop-field">${fields.map(f=>`<option value="${f}"${f===cf?' selected':''}>${f}</option>`).join('')}</select>
    <label>Direction</label>
    <select id="pop-dir"><option value="above"${cd==='above'?' selected':''}>Above ≥</option><option value="below"${cd==='below'?' selected':''}>Below ≤</option></select>
    <label>Target Price</label>
    <input type="number" id="pop-target" placeholder="e.g. 1024.50" value="${ct}" step="0.01">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" onclick="saveAlertPopover('${instrument}',${existingAlertId??'null'})">Set</button>
      ${existing?`<button class="btn btn-danger btn-sm" onclick="removeAlert(${existingAlertId})">Remove</button>`:''}
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  const rect=anchorEl.getBoundingClientRect();
  const popW=230;
  let left=rect.left;
  if (left+popW>window.innerWidth-12) left=window.innerWidth-popW-12;
  if (left<12) left=12;
  pop.style.top=(rect.bottom+6)+'px';
  pop.style.left=left+'px';
  document.body.appendChild(pop); openPopover=pop;
  setTimeout(()=>document.addEventListener('click', outsidePopoverClick), 10);
}
function outsidePopoverClick(e) { if (openPopover&&!openPopover.contains(e.target)) closePopover(); }
function saveAlertPopover(instrument, existingId) {
  const field=document.getElementById('pop-field').value;
  const direction=document.getElementById('pop-dir').value;
  const target=parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid target price'); return; }
  if (existingId!==null&&priceAlerts[existingId]) {
    priceAlerts[existingId]={...priceAlerts[existingId],field,direction,target,active:true};
  } else {
    const id=newAlertId(); priceAlerts[id]={id,instrument,field,direction,target,active:true};
  }
  closePopover(); updateAllAlertButtons();
  showToast('Alert Set', `${instrument} ${field} ${direction==='above'?'≥':'≤'} ${target}`, 'info', 3000);
}
function removeAlert(id) { delete priceAlerts[id]; closePopover(); updateAllAlertButtons(); renderAlertList(); }
function resetAlert(id)  { if (priceAlerts[id]) priceAlerts[id].active=true; renderAlertList(); updateAllAlertButtons(); }
function getAlertForInstrument(name) { return Object.values(priceAlerts).find(a=>a.instrument===name)||null; }
function toggleInstrumentAlert(name, btnEl) { const e=getAlertForInstrument(name); openAlertPopover(btnEl, name, e?e.id:null); }

function toggleDealAlert(dealId, btnEl) {
  dealId = parseInt(dealId);
  const d = deals.find(x => x.id === dealId); if (!d) return;
  const existing = dealPnlAlerts[dealId] || null;
  closePopover();
  const pop = document.createElement('div'); pop.className='alert-popover';
  pop.innerHTML=`
    <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:10px">🔔 ${d.instrument} P/L</div>
    <label>Direction</label>
    <select id="pop-dir">
      <option value="above" ${(existing?.direction==='above')?'selected':''}>Above ≥</option>
      <option value="below" ${(existing?.direction==='below')?'selected':''}>Below ≤</option>
    </select>
    <label>Target P/L</label>
    <input type="number" id="pop-target" placeholder="e.g. 5000" value="${existing?.target||''}" step="1">
    <div class="pop-row">
      <button class="btn btn-primary btn-sm" onclick="saveDealPnlAlert(${dealId})">Set Alarm</button>
      ${existing?`<button class="btn btn-danger btn-sm" onclick="removeDealPnlAlert(${dealId})">Remove</button>`:''}
      <button class="btn btn-cancel btn-sm" onclick="closePopover()">Cancel</button>
    </div>`;
  const rect=btnEl.getBoundingClientRect();
  pop.style.top=(rect.bottom+6)+'px';
  pop.style.left=Math.min(rect.left,window.innerWidth-240)+'px';
  document.body.appendChild(pop); openPopover=pop;
  setTimeout(()=>document.addEventListener('click', outsidePopoverClick), 10);
}
function saveDealPnlAlert(dealId) {
  const direction=document.getElementById('pop-dir').value;
  const target=parseFloat(document.getElementById('pop-target').value);
  if (isNaN(target)) { alert('Enter a valid P/L target'); return; }
  dealPnlAlerts[dealId]={id:dealId,direction,target,active:true};
  closePopover(); updateDealAlertButtons();
  showToast('Alert Set',`Deal P/L ${direction==='above'?'≥':'≤'} ${target}`,'info',3000);
}
function removeDealPnlAlert(dealId) { delete dealPnlAlerts[dealId]; closePopover(); updateDealAlertButtons(); }
function updateAllAlertButtons() { updateInstrumentAlertButtons(); updateDealAlertButtons(); }
function updateInstrumentAlertButtons() {
  dashboardInstruments.forEach(name=>{
    const btn=document.querySelector(`#dashcard-${slugify(name)} .card-alert-btn`); if (!btn) return;
    const al=getAlertForInstrument(name); btn.classList.toggle('active',!!(al?.active));
    btn.title=al?`Alert: ${al.field} ${al.direction} ${al.target}`:'Set price alert';
  });
}
function updateDealAlertButtons() {
  deals.forEach(deal=>{
    const btn=document.querySelector(`#dealcard-${deal.id} .deal-alert-btn`); if (!btn) return;
    const al=dealPnlAlerts[deal.id];
    btn.classList.toggle('active',!!(al&&al.active));
    btn.title=al?`P/L Alert: ${al.direction} ${al.target}`:'Set P/L alert';
  });
}
function openAlertModal() { renderAlertList(); document.getElementById('alert-modal').classList.add('open'); }
function closeAlertModal() { document.getElementById('alert-modal').classList.remove('open'); }
function renderAlertList() {
  const list=document.getElementById('alert-list');
  const all=Object.values(priceAlerts);
  if (all.length===0) { list.innerHTML='<div style="color:var(--muted);font-size:11px;padding:12px 0">No alerts set.</div>'; return; }
  list.innerHTML=all.map(a=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;background:var(--surface2);border-radius:4px;margin-bottom:6px;gap:8px;flex-wrap:wrap">
      <div><span style="font-size:11px;color:var(--text);font-weight:600">${a.instrument}</span>
      <span style="font-size:10px;color:var(--muted);margin-left:8px">${a.field} ${a.direction==='above'?'≥':'≤'} ${a.target}</span></div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        <span style="font-size:10px;color:${a.active?'var(--accent)':'var(--red)'}">${a.active?'● Armed':'✓ Fired'}</span>
        <button onclick="resetAlert(${a.id})" style="font-size:10px;background:none;border:1px solid var(--border);color:var(--muted);padding:2px 6px;border-radius:3px;cursor:pointer">Reset</button>
        <button onclick="removeAlert(${a.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px">✕</button>
      </div>
    </div>`).join('');
}
function initAlerts() { if ('Notification' in window) Notification.requestPermission(); }

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(title, body, type='info', duration=6000) {
  const icons={alert:'⚠️',trigger:'🎯',error:'❌',info:'ℹ️',order:'📋'};
  const container=document.getElementById('toast-container');
  const toast=document.createElement('div'); toast.className=`toast ${type}`;
  toast.innerHTML=`<span class="toast-icon">${icons[type]||'🔔'}</span><div style="min-width:0"><div class="toast-title">${title}</div><div class="toast-body">${body}</div></div><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(toast);
  if (duration>0) setTimeout(()=>toast.remove(), duration);
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function doLogin() {
  const username=document.getElementById('l-user').value.trim();
  const password=document.getElementById('l-pass').value;
  const err=document.getElementById('login-error'); err.style.display='none';
  try {
    const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const data=await res.json();
    if (!res.ok) { err.style.display='block'; return; }
    sessionToken=data.token; currentUser=data.username;
    localStorage.setItem('badla_token',sessionToken); localStorage.setItem('badla_user',currentUser);
    startApp();
  } catch(e) { err.style.display='block'; }
}
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('l-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('l-user').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  if (sessionToken) verifyAndStart();
  document.getElementById('d-instrument').addEventListener('change', function(){
    const p=prices[this.value]; if (!p) return;
    if (p.mcx)   document.getElementById('d-mcx-price').value   = p.mcx.ask  || p.mcx.ltp  || '';
    if (p.comex) document.getElementById('d-comex-price').value = p.comex.bid || p.comex.ltp || '';
    if (p.dgcx)  document.getElementById('d-dgcx-price').value  = p.dgcx.ltp || '';
    if (p.dgcx&&p.dgcx.ltp) document.getElementById('d-dginr').value=(10000/parseFloat(p.dgcx.ltp)).toFixed(4);
  });
  // Order modal: toggle confirm box when condition checkbox changes
  document.getElementById('o-has-condition').addEventListener('change', toggleOrderCondition);
});
async function verifyAndStart() {
  try { const res=await fetch('/api/me',{headers:{'x-session-token':sessionToken}}); if(res.ok) startApp(); else clearAuth(); }
  catch(e) { clearAuth(); }
}
function clearAuth() {
  sessionToken=null; currentUser=null;
  localStorage.removeItem('badla_token'); localStorage.removeItem('badla_user');
}
async function doLogout() { await apiFetch('/api/logout',{method:'POST'}); clearAuth(); location.reload(); }
async function startApp() {
  const savedFont = localStorage.getItem('badla_font_size');
  if (savedFont) { applyFontSize(savedFont); document.getElementById('font-size-slider').value = savedFont; }
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('username-display').textContent=currentUser;
  await loadBrokers(); loadDashboard(); loadDeals(); loadOrders(); connectWS(); initAlerts();
}
async function apiFetch(url, opts={}) {
  opts.headers={...(opts.headers||{}),'x-session-token':sessionToken};
  const res=await fetch(url,opts);
  if (res.status===401) { clearAuth(); location.reload(); }
  return res;
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS() {
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${proto}://${location.host}?token=${sessionToken}`);
  ws.onopen=()=>{ document.getElementById('dot').classList.add('live'); document.getElementById('status-text').textContent='Live'; };
  ws.onmessage=(e)=>{
    const msg=JSON.parse(e.data);
    if (msg.type==='snapshot') {
      msg.data.forEach(d=>prices[d.name]=d);
      renderPrices(); renderDashboard(); populateAllInstrumentSelects();
    } else if (msg.type==='update') {
      const prev=prices[msg.data.name]; prices[msg.data.name]=msg.data;
      updateCount++; document.getElementById('update-count').textContent=`${updateCount} ticks`;
      document.getElementById('last-update').textContent=new Date().toLocaleTimeString();
      flashRow(msg.data.name,prev,msg.data); renderPriceRow(msg.data);
      updateDashCard(msg.data,prev); updateDealsLivePnl(); checkDealPnlAlerts(); checkAlerts(msg.data);
    } else if (msg.type==='order_triggered') {
      const o = orders.find(x=>x.id===msg.orderId);
      showToast('⚡ Order Triggered', `${msg.instrument} order #${msg.orderId} triggered → sending to MT5`, 'order', 5000);
      loadOrders();
    } else if (msg.type==='order_confirmed') {
      showToast(
        msg.success ? '✅ MT5 Executed' : '❌ MT5 Failed',
        msg.success ? `Order #${msg.orderId} executed (ticket ${msg.ticket})` : `Order #${msg.orderId} failed: ${msg.error}`,
        msg.success ? 'trigger' : 'error', 6000
      );
      loadOrders();
    }
  };
  ws.onclose=()=>{
    document.getElementById('dot').classList.remove('live');
    document.getElementById('status-text').textContent='Reconnecting...';
    setTimeout(connectWS,2000);
  };
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  const res=await apiFetch('/api/dashboard');
  const rows=await res.json();
  dashboardInstruments=rows.map(r=>r.instrument_name);
  renderDashboard();
}
function renderDashboard() {
  const grid  = document.getElementById('dash-grid');
  const empty = document.getElementById('dash-empty');
  const tblContainer = document.getElementById('dash-tbl-container');
  const tblEmpty     = document.getElementById('dash-table-empty');

  if (dashboardInstruments.length === 0) {
    grid.innerHTML = ''; grid.appendChild(empty); empty.style.display = 'block';
    tblContainer.style.display = 'none'; tblEmpty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tblEmpty.style.display = 'none';
  tblContainer.style.display = 'block';

  // Mobile cards — only add missing ones
  [...grid.querySelectorAll('.dash-card')].forEach(card => {
    if (!dashboardInstruments.includes(card.dataset.name)) card.remove();
  });
  dashboardInstruments.forEach(name => {
    if (!document.getElementById('dashcard-' + slugify(name))) {
      grid.appendChild(buildDashCard(name, prices[name]));
    }
  });

  // Desktop table — full re-render
  renderDashTable();
  updateAllAlertButtons();
  updateOrderButtons();
}
function renderDashRowHTML(name, p) {
  const displayName = p ? (p.displayName || p.name) : name;
  const duty        = p ? (p.duty ?? '15') : '—';
  const badlaBUY    = p ? fmt(p.badlaBUY)  : '--';
  const badlaSELL   = p ? fmt(p.badlaSELL) : '--';
  const badlaLTP    = p ? fmt(p.badlaLTP)  : '--';
  const mcxBid      = p?.mcx   ? fmt(p.mcx.bid)        : '--';
  const mcxAsk      = p?.mcx   ? fmt(p.mcx.ask)        : '--';
  const mcxBidSub   = p?.comex?.convertedBID ? fmt(p.comex.convertedBID) : '';
  const mcxAskSub   = p?.comex?.convertedASK ? fmt(p.comex.convertedASK) : '';
  const comexBid    = p?.comex ? fmtComex(p.comex.bid) : '--';
  const comexAsk    = p?.comex ? fmtComex(p.comex.ask) : '--';
  const comexBidSub = p?.comex?.convertedBID ? fmt(p.comex.convertedBID) : '';
  const comexAskSub = p?.comex?.convertedASK ? fmt(p.comex.convertedASK) : '';
  const dgcxBid     = p?.dgcx  ? fmt(p.dgcx.bid ?? p.dgcx.ltp) : '--';
  const dgcxAsk     = p?.dgcx  ? fmt(p.dgcx.ask ?? p.dgcx.ltp) : '--';
  const dgcxBidSub  = p?.dgcx?.convertedBID ? p.dgcx.convertedBID : '';
  const dgcxAskSub  = p?.dgcx?.convertedASK ? p.dgcx.convertedASK : '';
  const hasOrder    = orders.some(o => o.instrument === name && o.status === 'pending');
  const hasAlert    = !!getAlertForInstrument(name)?.active;
  const uid         = slugify(name);

  return `<tr id="dashtrow-${uid}" data-name="${name}">
    <td style="text-align:left">
      <div style="font-size:11px;font-weight:700;color:var(--text);max-width:240px;overflow:hidden;text-overflow:ellipsis">${displayName}</div>
    </td>
    <td style="color:var(--muted)">${duty}</td>
    <td class="${colorClass(p?.badlaBUY)}" style="font-weight:700">${badlaBUY}</td>
    <td class="${colorClass(p?.badlaSELL)}" style="font-weight:700">${badlaSELL}</td>
    <td class="${colorClass(p?.badlaLTP)}" style="font-weight:700">${badlaLTP}</td>
    <td>
      <div style="font-weight:600">${mcxBid}</div>
      ${mcxBidSub ? `<div style="font-size:9px;color:var(--muted)">${mcxBidSub}</div>` : ''}
    </td>
    <td>
      <div style="font-weight:600">${mcxAsk}</div>
      ${mcxAskSub ? `<div style="font-size:9px;color:var(--muted)">${mcxAskSub}</div>` : ''}
    </td>
    <td>
      <div style="font-weight:600">${comexBid}</div>
      ${comexBidSub ? `<div style="font-size:9px;color:var(--muted)">${comexBidSub}</div>` : ''}
    </td>
    <td>
      <div style="font-weight:600">${comexAsk}</div>
      ${comexAskSub ? `<div style="font-size:9px;color:var(--muted)">${comexAskSub}</div>` : ''}
    </td>
    <td>
      <div style="font-weight:600">${dgcxBid}</div>
      ${dgcxBidSub ? `<div style="font-size:9px;color:var(--muted)">${dgcxBidSub}</div>` : ''}
    </td>
    <td>
      <div style="font-weight:600">${dgcxAsk}</div>
      ${dgcxAskSub ? `<div style="font-size:9px;color:var(--muted)">${dgcxAskSub}</div>` : ''}
    </td>
    <td>
      <div class="dash-tbl-actions">
        <button class="card-order-btn ${hasOrder ? 'has-order' : ''}"
          onclick="openOrderModal('${name}')" title="Place order">📋</button>
        <button class="card-alert-btn ${hasAlert ? 'active' : ''}"
          onclick="toggleInstrumentAlert('${name}',this)" title="Set alert">🔔</button>
        <button class="card-remove"
          onclick="removeDashInstr('${name}')" title="Remove">🗑</button>
      </div>
    </td>
  </tr>`;
}

function renderDashTable() {
  const tbody = document.getElementById('dash-tbody');
  if (!tbody) return;
  tbody.innerHTML = dashboardInstruments.map(name => renderDashRowHTML(name, prices[name])).join('');
}
function buildDashCard(name,p) {
  const card=document.createElement('div'); card.className='dash-card'; card.id='dashcard-'+slugify(name); card.dataset.name=name;
  card.innerHTML=dashCardHTML(name,p); return card;
}
function dashCardHTML(name, p) {
  const displayName = p ? (p.displayName || p.name) : name;
  const type = p ? p.type : '—', bc = badgeClass(type);
  const badlaBUY = p ? fmt(p.badlaBUY) : '--';
  const badlaSELL = p ? fmt(p.badlaSELL) : '--';
  const badlaLTP = p ? fmt(p.badlaLTP) : '--';
  const mcxBid = p?.mcx ? fmt(p.mcx.bid) : '--';
  const mcxAsk = p?.mcx ? fmt(p.mcx.ask) : '--';
  const mcxLtp = p?.mcx ? fmt(p.mcx.ltp) : '--';
  const convComexLTP = p?.comex?.convertedLTP ? fmt(p.comex.convertedLTP) : '--';
  const convComexBID = p?.comex?.convertedBID ? fmt(p.comex.convertedBID) : '--';
  const convComexASK = p?.comex?.convertedASK ? fmt(p.comex.convertedASK) : '--';
  const comexBid = p?.comex ? fmtComex(p.comex.bid) : '--';
  const comexAsk = p?.comex ? fmtComex(p.comex.ask) : '--';
  const comexLtp = p?.comex ? fmtComex(p.comex.ltp) : '--';
  const dgcxBid  = p?.dgcx  ? fmt(p.dgcx.bid ?? p.dgcx.ltp) : '--';
  const dgcxAsk  = p?.dgcx  ? fmt(p.dgcx.ask ?? p.dgcx.ltp) : '--';
  const dgcxLtp  = p?.dgcx  ? fmt(p.dgcx.ltp) : '--';
  const dgcxConvLTP = p?.dgcx?.convertedLTP ? p.dgcx.convertedLTP : '--';
  const dgcxConvBID = p?.dgcx?.convertedBID ? p.dgcx.convertedBID : '--';
  const dgcxConvASK = p?.dgcx?.convertedASK ? p.dgcx.convertedASK : '--';
  const hasOrder = orders.some(o => o.instrument === name && o.status === 'pending');
  const uid = slugify(name); // unique prefix for tab IDs

  return `
    <div class="card-top">
      <div style="min-width:0">
        <div class="card-name">${displayName}</div>
        <span class="card-type-badge badge ${bc}">${type}</span>
      </div>
      <div class="card-top-actions">
        <button class="card-order-btn ${hasOrder ? 'has-order' : ''}" onclick="openOrderModal('${name}')" title="Place order">📋</button>
        <button class="card-alert-btn" onclick="toggleInstrumentAlert('${name}',this)" title="Set price alert">🔔</button>
        <button class="card-remove" onclick="removeDashInstr('${name}')" title="Remove">✕</button>
      </div>
    </div>

    <div class="card-badla">
      <div class="badla-cell"><div class="badla-label">BUY</div><div class="badla-val ${colorClass(badlaBUY)}">${badlaBUY}</div></div>
      <div class="badla-cell"><div class="badla-label">SELL</div><div class="badla-val ${colorClass(badlaSELL)}">${badlaSELL}</div></div>
      <div class="badla-cell"><div class="badla-label">LTP</div><div class="badla-val ${colorClass(badlaLTP)}">${badlaLTP}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:${dgcxLtp !== '--' ? '6px' : '0'}">

      <div style="border:1px solid var(--border);border-radius:6px;padding:7px 10px">
        <div style="font-size:9px;font-weight:700;color:var(--accent);letter-spacing:.06em;margin-bottom:5px">MCX</div>
        <div class="price-row"><span class="price-key">BID</span><span class="price-val">${mcxBid}</span></div>
        <div class="price-row"><span class="price-key">ASK</span><span class="price-val">${mcxAsk}</span></div>
        <div class="price-row"><span class="price-key">LTP</span><span class="price-val">${mcxLtp}</span></div>
      </div>

      <div style="border:1px solid var(--border);border-radius:6px;padding:7px 10px">
        <div style="font-size:9px;font-weight:700;color:var(--muted);letter-spacing:.06em;margin-bottom:5px">CONV</div>
        <div class="price-row"><span class="price-key">BID</span><span class="price-val">${convComexBID}</span></div>
        <div class="price-row"><span class="price-key">ASK</span><span class="price-val">${convComexASK}</span></div>
        <div class="price-row"><span class="price-key">LTP</span><span class="price-val">${convComexLTP}</span></div>
      </div>

      <div style="border:1px solid var(--border);border-radius:6px;padding:7px 10px">
        <div style="font-size:9px;font-weight:700;color:var(--gold);letter-spacing:.06em;margin-bottom:5px">COMEX</div>
        <div class="price-row"><span class="price-key">BID</span><span class="price-val">${comexBid}</span></div>
        <div class="price-row"><span class="price-key">ASK</span><span class="price-val">${comexAsk}</span></div>
        <div class="price-row"><span class="price-key">LTP</span><span class="price-val">${comexLtp}</span></div>
      </div>

    </div>

${dgcxLtp !== '--' ? `
      <div style="border:1px solid var(--border);border-radius:6px;padding:7px 10px">
        <div style="font-size:9px;font-weight:700;color:#6cf;letter-spacing:.06em;margin-bottom:5px">DGCX</div>
        <div style="display:flex;gap:12px">
          <div style="display:flex;align-items:baseline;gap:5px">
            <span class="price-key">BID</span><span class="price-val">${dgcxBid}</span><span style="font-size:9px;color:var(--muted)">${dgcxConvBID}</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:5px">
            <span class="price-key">ASK</span><span class="price-val">${dgcxAsk}</span><span style="font-size:9px;color:var(--muted)">${dgcxConvASK}</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:5px">
            <span class="price-key">LTP</span><span class="price-val">${dgcxLtp}</span><span style="font-size:9px;color:var(--muted)">${dgcxConvLTP}</span>
        </div>
      </div>` : ''}`
}
function updateDashCard(p, prev) {
  const dir = prev && parseFloat(p.badlaLTP) > parseFloat(prev.badlaLTP) ? 'green' : 'red';

  // Mobile card
  const card = document.getElementById('dashcard-' + slugify(p.name));
  if (card) {
    card.innerHTML = dashCardHTML(p.name, p);
    card.classList.remove('flash-green', 'flash-red');
    void card.offsetWidth;
    card.classList.add(`flash-${dir}`);
  } else if (dashboardInstruments.includes(p.name)) {
    document.getElementById('dash-empty').style.display = 'none';
    document.getElementById('dash-grid').appendChild(buildDashCard(p.name, p));
  }

  // Desktop table row — cell-by-cell flash
const trow = document.getElementById('dashtrow-' + slugify(p.name));
if (trow) {
  const prev_p = prev; // already have prev from outer scope

  function flashCell(td, newHTML, newClass, oldVal, newVal) {
    td.innerHTML = newHTML;
    td.className = newClass;
    if (oldVal === undefined || oldVal === null) return;
    const changed = parseFloat(newVal) !== parseFloat(oldVal);
    if (!changed) return;
    const up = parseFloat(newVal) > parseFloat(oldVal);
    td.style.animation = 'none';
    void td.offsetHeight; // reflow
    td.style.animation = '';
    td.classList.add(up ? 'cell-flash-green' : 'cell-flash-red');
    setTimeout(() => td.classList.remove('cell-flash-green', 'cell-flash-red'), 800);
  }

  const cells = trow.cells;
  // [0]=symbol [1]=duty [2]=badlaBUY [3]=badlaSELL [4]=badlaLTP
  // [5]=mcxBid [6]=mcxAsk [7]=comexBid [8]=comexAsk
  // [9]=dgcxBid [10]=dgcxAsk [11]=actions

  flashCell(cells[2],
    fmt(p.badlaBUY), colorClass(p.badlaBUY),
    prev_p?.badlaBUY, p.badlaBUY);

  flashCell(cells[3],
    fmt(p.badlaSELL), colorClass(p.badlaSELL),
    prev_p?.badlaSELL, p.badlaSELL);

  flashCell(cells[4],
    fmt(p.badlaLTP), colorClass(p.badlaLTP),
    prev_p?.badlaLTP, p.badlaLTP);

  flashCell(cells[5],
    `<div>${fmt(p.mcx?.bid)}</div>${p.comex?.convertedBID ? `<div style="font-size:11px;color:var(--muted)">${fmt(p.comex.convertedBID)}</div>` : ''}`,
    '', prev_p?.mcx?.bid, p.mcx?.bid);

  flashCell(cells[6],
    `<div>${fmt(p.mcx?.ask)}</div>${p.comex?.convertedASK ? `<div style="font-size:11px;color:var(--muted)">${fmt(p.comex.convertedASK)}</div>` : ''}`,
    '', prev_p?.mcx?.ask, p.mcx?.ask);

  flashCell(cells[7],
    fmtComex(p.comex?.bid), '',
    prev_p?.comex?.bid, p.comex?.bid);

  flashCell(cells[8],
    fmtComex(p.comex?.ask), '',
    prev_p?.comex?.ask, p.comex?.ask);

  flashCell(cells[9],
    `<div>${fmt(p.dgcx?.bid ?? p.dgcx?.ltp)}</div>${p.dgcx?.convertedBID ? `<div style="font-size:11px;color:var(--muted)">${p.dgcx.convertedBID}</div>` : ''}`,
    '', prev_p?.dgcx?.bid ?? prev_p?.dgcx?.ltp, p.dgcx?.bid ?? p.dgcx?.ltp);

  flashCell(cells[10],
    `<div>${fmt(p.dgcx?.ask ?? p.dgcx?.ltp)}</div>${p.dgcx?.convertedASK ? `<div style="font-size:11px;color:var(--muted)">${p.dgcx.convertedASK}</div>` : ''}`,
    '', prev_p?.dgcx?.ask ?? prev_p?.dgcx?.ltp, p.dgcx?.ask ?? p.dgcx?.ltp);;
}

  updateInstrumentAlertButtons();
  updateOrderButtons();
}
async function removeDashInstr(name) {
  await apiFetch(`/api/dashboard/${encodeURIComponent(name)}`, { method: 'DELETE' });
  dashboardInstruments = dashboardInstruments.filter(n => n !== name);
  const card = document.getElementById('dashcard-' + slugify(name)); if (card) card.remove();
  const trow = document.getElementById('dashtrow-' + slugify(name)); if (trow) trow.remove();
  if (dashboardInstruments.length === 0) renderDashboard();
}
function updateOrderButtons() {
  dashboardInstruments.forEach(name=>{
    const btn=document.querySelector(`#dashcard-${slugify(name)} .card-order-btn`); if (!btn) return;
    const hasOrder=orders.some(o=>o.instrument===name&&o.status==='pending');
    btn.classList.toggle('has-order', hasOrder);
    btn.title=hasOrder?'Active pending order — click to add another':'Place order';
  });
}
function openAddInstrModal() { document.getElementById('instr-search').value=''; renderInstrList(); document.getElementById('add-instr-modal').classList.add('open'); }
function closeAddInstrModal() { document.getElementById('add-instr-modal').classList.remove('open'); }
function renderInstrList() {
  const q=document.getElementById('instr-search').value.toLowerCase(), list=document.getElementById('instr-list');
  const all=Object.values(prices).filter(p=>!q||p.name.toLowerCase().includes(q)||(p.displayName||'').toLowerCase().includes(q));
  if (all.length===0) { list.innerHTML='<div style="padding:16px;color:var(--muted);text-align:center;font-size:11px">No streaming instruments found</div>'; return; }
  list.innerHTML=all.map(p=>{
    const already=dashboardInstruments.includes(p.name);
    return `<div class="instr-item ${already?'already':''}" id="instritem-${slugify(p.name)}">
      <div style="min-width:0"><div class="instr-item-name">${p.displayName||p.name}</div><div class="instr-item-type">${p.type}</div></div>
      ${already?'<span class="instr-added-tag">✓ Added</span>':`<button class="instr-add-btn" onclick="addDashInstr('${p.name}')">+ Add</button>`}
    </div>`;
  }).join('');
}
async function addDashInstr(name) {
  if (dashboardInstruments.includes(name)) return;
  await apiFetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instrument_name:name})});
  dashboardInstruments.push(name);
  const item=document.getElementById('instritem-'+slugify(name));
  if (item) { item.classList.add('already'); const btn=item.querySelector('.instr-add-btn'); if(btn) btn.outerHTML='<span class="instr-added-tag">✓ Added</span>'; }
  document.getElementById('dash-empty').style.display='none';
  document.getElementById('dash-grid').appendChild(buildDashCard(name,prices[name]));
  document.getElementById('dash-tbl-container').style.display = 'block';
  document.getElementById('dash-table-empty').style.display = 'none';
  const tbody = document.getElementById('dash-tbody');
  if (tbody) tbody.insertAdjacentHTML('beforeend', renderDashRowHTML(name, prices[name]));
}
function flashRow(name,prev,curr) {
  const row=document.getElementById('row-'+slugify(name)); if (!row||!prev) return;
  const dir=parseFloat(curr.badlaLTP)>parseFloat(prev.badlaLTP)?'green':'red';
  row.classList.remove('flash-green','flash-red'); void row.offsetWidth; row.classList.add(`flash-${dir}`);
}
function slugify(s) { return s.replace(/[^a-z0-9]/gi,'_'); }
function badgeClass(type) { const m={GOLD:'gold',SILVER:'silver',CRUDE:'crude',COPPER:'copper',GAS:'gas'}; return 'badge-'+(m[type]||'other'); }
function fmt(v) { return (v===null||v===undefined)?'--':parseFloat(v).toFixed(2); }
function fmtComex(v) {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5, useGrouping: false });
}
function colorClass(v) { return parseFloat(v)>=0?'pos':'neg'; }

function renderPriceRow(d) {
  const tbody = document.getElementById('prices-tbody'), rowId = 'row-' + slugify(d.name);
  let row = document.getElementById(rowId);
  const search = document.getElementById('search').value.toLowerCase();
  const show = (filter === 'ALL' || d.type === filter) && d.name.toLowerCase().includes(search);
  if (!show) { if (row) row.style.display = 'none'; return; }

  // MCX: INR prices, sub = converted COMEX in INR
  const mcxBid    = d.mcx ? fmt(d.mcx.bid) : '--';
  const mcxAsk    = d.mcx ? fmt(d.mcx.ask) : '--';
  const mcxBidSub = d.mcx?.convertedComexBid  ? fmt(d.mcx.convertedComexBid)  : (d.mcx?.convertedComex ? fmt(d.mcx.convertedComex) : '');
  const mcxAskSub = d.mcx?.convertedComexAsk  ? fmt(d.mcx.convertedComexAsk)  : '';
  const convComex = d.mcx?.convertedComex      ? fmt(d.mcx.convertedComex)     : '--';

  // DGCX: USD prices, sub = converted INR (10k/DG style)
  const dgcxLtp    = d.dgcx ? fmt(d.dgcx.ltp)                    : '--';
  const dgcxBid    = d.dgcx ? fmt(d.dgcx.bid ?? d.dgcx.ltp)      : '--';
  const dgcxAsk    = d.dgcx ? fmt(d.dgcx.ask ?? d.dgcx.ltp)      : '--';
  const dgcxBidSub = d.dgcx?.convertedBid ? fmt(d.dgcx.convertedBid) : (d.dgcx?.converted ? d.dgcx.converted : '');
  const dgcxAskSub = d.dgcx?.convertedAsk ? fmt(d.dgcx.convertedAsk) : (d.dgcx?.converted ? d.dgcx.converted : '');
  const dgcxConv   = d.dgcx?.converted ?? '--';

  const sub = (val) => val ? `<div class="price-sub-line">${val}</div>` : '';

  const html = `
    <td>
      <div class="inst-name">${d.displayName || d.name}</div>
      <div class="inst-type">${d.type}</div>
    </td>
    <td><span class="badge ${badgeClass(d.type)}">${d.type}</span></td>
    <td class="${colorClass(d.badlaBUY)}">${fmt(d.badlaBUY)}</td>
    <td class="${colorClass(d.badlaSELL)}">${fmt(d.badlaSELL)}</td>
    <td class="${colorClass(d.badlaLTP)}">${fmt(d.badlaLTP)}</td>
    <td class="muted">
      <div>${mcxBid}</div>${sub(mcxBidSub)}
    </td>
    <td class="muted">
      <div>${mcxAsk}</div>${sub(mcxAskSub)}
    </td>
    <td>${convComex}</td>
    <td class="muted">${d.comex ? fmtComex(d.comex.bid) : '--'}</td>
    <td class="muted">${d.comex ? fmtComex(d.comex.ask) : '--'}</td>
    <td class="muted">
      <div>${dgcxBid}</div>${sub(dgcxBidSub)}
    </td>
    <td class="muted">
      <div>${dgcxAsk}</div>${sub(dgcxAskSub)}
    </td>
    <td class="muted">${new Date(d.timestamp).toLocaleTimeString()}</td>`;

  if (row) { row.innerHTML = html; row.style.display = ''; }
  else { row = document.createElement('tr'); row.id = rowId; row.innerHTML = html; tbody.appendChild(row); }
}
function renderPrices() { Object.values(prices).forEach(renderPriceRow); }
function setFilter(f,btn) {
  filter=f;
  document.querySelectorAll('#page-prices .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); renderPrices();
}
function showPage(name,btn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-page]').forEach(b=>b.classList.toggle('active', b.dataset.page===name));
  document.getElementById('page-'+name).classList.add('active');
  if (name==='deals')   renderDeals();
  if (name==='orders')  renderOrders();
  if (name==='brokers') { populateBrokerInstrumentSelect(); renderBrokers(); }
}
function populateAllInstrumentSelects() {
  populateInstrumentSelect('d-instrument');
  populateInstrumentSelect('o-instrument');
  populateBrokerInstrumentSelect();
}
function populateInstrumentSelect(selId) {
  const sel=document.getElementById(selId); if (!sel) return;
  const current=sel.value; sel.innerHTML='<option value="">Select...</option>';
  Object.values(prices).forEach(p=>{ const opt=document.createElement('option'); opt.value=p.name; opt.textContent=p.displayName||p.name; sel.appendChild(opt); });
  if (current) sel.value=current;
}
function populateLegBrokerSelect(selId, selectedBrokerId) {
  const sel = document.getElementById(selId); if (!sel) return;
  sel.innerHTML = '<option value="">No broker</option>';
  brokers.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    const instrList = (b.instruments||[]).map(i=>i.instrument.split('(')[0].trim()).join(', ');
    opt.textContent = `${b.brokerName}${b.accountId?' ['+b.accountId+']':''} (${instrList||'no instruments'})`;
    sel.appendChild(opt);
  });
  if (selectedBrokerId) sel.value = selectedBrokerId;
}
function autofillLotFromBroker(leg) {
  const brokerId = document.getElementById(`o-${leg}-broker`).value;
  if (!brokerId) return;
  const broker = brokers.find(b => b.id == brokerId);
  if (!broker) return;
  const instrument = document.getElementById('o-instrument')?.value;
  // find matching instrument row, fall back to first
  const instrRow = (broker.instruments||[]).find(i => i.instrument === instrument)
                || (broker.instruments||[])[0];
  if (instrRow) {
    document.getElementById(`o-${leg}-qty`).value = instrRow.lotSize;
  }
}
function autofillLegBroker(leg) {
  const prefix = leg==='mcx'?'d-mcx':leg==='comex'?'d-comex':'d-dgcx';
  const brokerId = document.getElementById(`${prefix}-broker`).value; if (!brokerId) return;
  const b = brokers.find(x => x.id === parseInt(brokerId)); if (!b) return;
  const instrument = document.getElementById('d-instrument')?.value;
  const instrRow = (b.instruments||[]).find(i => i.instrument === instrument)
                || (b.instruments||[])[0];
  if (instrRow) {
    document.getElementById(`${prefix}-qty`).value = instrRow.lotSize;
    document.getElementById(`${prefix}-brok`).value = b.brokerage;
    showToast(`Broker: ${b.brokerName}`, `lot size ${instrRow.lotSize}, brokerage ₹${b.brokerage}`, 'info', 2500);
  }
}

// ── ORDER MODAL ────────────────────────────────────────────────────────────
function openOrderModal(instrumentName) {
  orderModalInstrument = instrumentName;
  populateInstrumentSelect('o-instrument');
  populateLegBrokerSelect('o-mcx-broker', null);
  populateLegBrokerSelect('o-comex-broker', null);
  populateLegBrokerSelect('o-dgcx-broker', null);
  document.getElementById('o-mcx-enabled').checked = true;
  document.getElementById('o-comex-enabled').checked = true;
  document.getElementById('o-dgcx-enabled').checked = false;
  document.getElementById('o-mcx-fields').style.display = 'grid';
  document.getElementById('o-comex-fields').style.display = 'grid';
  document.getElementById('o-dgcx-fields').style.display = 'none';
  document.getElementById('o-has-condition').checked = false;
  document.getElementById('o-condition-fields').style.display = 'block';
  document.getElementById('o-confirm-box').style.display = 'none';
  document.getElementById('o-note').value = '';
  document.getElementById('o-mcx-qty').value = '1';
  document.getElementById('o-comex-qty').value = '1';
  document.getElementById('o-dgcx-qty').value = '1';
  document.getElementById('o-cond-value').value = '';
  if (instrumentName) {
    document.getElementById('o-instrument').value = instrumentName;
    // Autofill default broker qty from first matching broker
    const p = prices[instrumentName];
    if (p) {
      const b = brokers.find(x => x.instrument === instrumentName);
      if (b) {
        document.getElementById('o-mcx-qty').value = b.lotSize;
        document.getElementById('o-comex-qty').value = b.lotSize;
      }
      if (p.badlaLTP) document.getElementById('o-cond-value').value = parseFloat(p.badlaLTP).toFixed(2);
    }
  }
  document.getElementById('order-modal').classList.add('open');
}
function closeOrderModal() { document.getElementById('order-modal').classList.remove('open'); orderModalInstrument = null; }

function toggleOrderLeg(leg) {
  const enabled = document.getElementById(`o-${leg}-enabled`).checked;
  const fields = document.getElementById(`o-${leg}-fields`);
  fields.style.display = enabled ? 'grid' : 'none';
}
function toggleOrderCondition() {
  const checked = document.getElementById('o-has-condition').checked;
  document.getElementById('o-condition-fields').style.display = checked ? 'none' : 'block';
  document.getElementById('o-confirm-box').style.display      = checked ? 'block' : 'none';
}

async function saveOrder() {
  const btn = document.getElementById('o-save-btn');
  try {
    btn.textContent = 'Placing...'; btn.disabled = true;
    const instrument = document.getElementById('o-instrument').value;
    if (!instrument) return alert('Please select an instrument');

    const mcxEnabled = document.getElementById('o-mcx-enabled').checked;
    const comexEnabled = document.getElementById('o-comex-enabled').checked;
    const dgcxEnabled = document.getElementById('o-dgcx-enabled').checked;
    const immediateExecution = document.getElementById('o-has-condition').checked; // checked = immediate

    if (!mcxEnabled && !comexEnabled && !dgcxEnabled) return alert('Enable at least one leg');

    const conditionValue = parseFloat(document.getElementById('o-cond-value').value);
    if (!immediateExecution && isNaN(conditionValue)) return alert('Enter a valid condition value');

    // If immediate execution, confirm before placing
    if (immediateExecution) {
      if (!confirm(`Place order immediately for ${instrument}?\nThis will be sent to MT5 for execution.`)) {
        return;
      }
    }

    const body = {
      instrument,
      note: document.getElementById('o-note').value || null,
      mcxSide:     mcxEnabled ? document.getElementById('o-mcx-side').value : null,
      mcxQty:      mcxEnabled ? parseFloat(document.getElementById('o-mcx-qty').value) || 1 : null,
      mcxBrokerId: mcxEnabled ? document.getElementById('o-mcx-broker').value || null : null,
      comexSide:     comexEnabled ? document.getElementById('o-comex-side').value : null,
      comexQty:      comexEnabled ? parseFloat(document.getElementById('o-comex-qty').value) || 1 : null,
      comexBrokerId: comexEnabled ? document.getElementById('o-comex-broker').value || null : null,
      dgcxEnabled,
      dgcxSide:     dgcxEnabled ? document.getElementById('o-dgcx-side').value : null,
      dgcxQty:      dgcxEnabled ? parseFloat(document.getElementById('o-dgcx-qty').value) || 1 : null,
      dgcxBrokerId: dgcxEnabled ? document.getElementById('o-dgcx-broker').value || null : null,
      hasCondition: !immediateExecution,                                              // flipped
      conditionField: !immediateExecution ? document.getElementById('o-cond-field').value : null,
      conditionDir:   !immediateExecution ? document.getElementById('o-cond-dir').value : null,
      conditionValue: !immediateExecution ? conditionValue : null,
      placeImmediately: immediateExecution,                                           // flipped
    };

    const res = await apiFetch('/api/orders', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    await loadOrders();
    closeOrderModal();
    const action = immediateExecution ? 'Order placed → sent to MT5' : 'Order set — waiting for condition';
    showToast('📋 Order Created', `${instrument}: ${action}`, 'order', 4000);
    updateOrderButtons();
  } catch(err) {
    alert('Failed to save order: ' + err.message);
  } finally {
    btn.textContent = 'Set Order'; btn.disabled = false;
  }
}

// ── Orders List ────────────────────────────────────────────────────────────
async function loadOrders() {
  const res = await apiFetch('/api/orders');
  orders = await res.json();
  if (document.getElementById('page-orders').classList.contains('active')) renderOrders();
  updateOrderButtons();
}

function setOrderTab(tab) {
  orderTab = tab;
  ['all','pending','executed'].forEach(t => {
    document.getElementById(`otab-${t}`)?.classList.toggle('active', t === tab);
  });
  renderOrders();
}

function renderOrders() {
  const container = document.getElementById('orders-cards');
  let filtered = orders;
  if (orderTab === 'pending')  filtered = orders.filter(o => ['pending'].includes(o.status));
  if (orderTab === 'executed') filtered = orders.filter(o => ['executed','failed'].includes(o.status));

  if (filtered.length === 0) {
    container.innerHTML = `<div style="color:var(--muted);text-align:center;padding:48px 16px;border:1px dashed var(--border);border-radius:8px">No ${orderTab === 'all' ? '' : orderTab} orders yet. Click <strong>📋</strong> on a dashboard card to place one.</div>`;
    return;
  }
  container.innerHTML = filtered.map(orderCardHTML).join('');
}

function statusLabel(status) {
  const map = { pending:'Pending', triggered:'Triggered', sent_to_mt5:'Sent to MT5', executed:'Executed', failed:'Failed' };
  return map[status] || status;
}

function orderCardHTML(o) {
  const brokerName = id => { if (!id) return null; const b = brokers.find(x=>x.id===parseInt(id)); return b?.brokerName||null; };
  const legChips = [
    o.mcx   ? `<span class="order-leg-chip ${o.mcx.side.toLowerCase()}">MCX ${o.mcx.side} ${o.mcx.qty}lot${brokerName(o.mcx.brokerId)?' · '+brokerName(o.mcx.brokerId):''}</span>` : '',
    o.comex ? `<span class="order-leg-chip ${o.comex.side.toLowerCase()}">COMEX ${o.comex.side} ${o.comex.qty}lot${brokerName(o.comex.brokerId)?' · '+brokerName(o.comex.brokerId):''}</span>` : '',
    o.dgcx  ? `<span class="order-leg-chip ${o.dgcx.side.toLowerCase()}">DGCX ${o.dgcx.side} ${o.dgcx.qty}lot${brokerName(o.dgcx.brokerId)?' · '+brokerName(o.dgcx.brokerId):''}</span>` : '',
  ].filter(Boolean).join('');
  const condTag = o.condition
    ? `<div class="order-condition-tag">⚡ When ${o.condition.field} ${o.condition.direction==='above'?'≥':'≤'} ${o.condition.value}</div>`
    : `<div class="order-condition-tag" style="border-color:rgba(0,255,136,0.2);background:rgba(0,255,136,0.05);color:var(--accent)">⚡ Immediate</div>`;

  return `
    <div class="order-card status-${o.status}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${o.instrument}${o.note?` <span style="font-size:11px;color:var(--muted);font-weight:400">· ${o.note}</span>`:''}</div>
          <div style="margin-top:4px">${legChips}</div>
          ${condTag}
          <div style="font-size:10px;color:var(--muted);margin-top:6px">Created: ${new Date(o.createdAt).toLocaleString()}${o.triggeredAt?` · Triggered: ${new Date(o.triggeredAt).toLocaleString()}`:''}${o.sentToMt5At?` · Sent MT5: ${new Date(o.sentToMt5At).toLocaleString()}`:''}${o.mt5ConfirmedAt?` · Confirmed: ${new Date(o.mt5ConfirmedAt).toLocaleString()}`:''}</div>
          ${o.mt5Result?`<div style="font-size:10px;color:var(--muted);margin-top:2px">MT5: ${o.mt5Result}</div>`:''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
          <span class="order-status-pill ${o.status}">${statusLabel(o.status)}</span>
          ${o.status==='pending'?`<button class="btn btn-sm btn-danger" onclick="cancelOrder(${o.id})">Cancel</button>`:''}
        </div>
      </div>
    </div>`;
}

async function cancelOrder(id) {
  if (!confirm('Cancel this pending order?')) return;
  const res = await apiFetch(`/api/orders/${id}`, { method: 'DELETE' });
  if (!res.ok) { const t = await res.json(); alert(t.error || 'Cannot cancel'); return; }
  await loadOrders(); renderOrders();
  showToast('Order Cancelled', `Order #${id} cancelled`, 'info', 3000);
  updateOrderButtons();
}

// ── Deals ──────────────────────────────────────────────────────────────────
function setDealTab(tab) {
  dealTab=tab;
  document.getElementById('tab-open').classList.toggle('active',tab==='open');
  document.getElementById('tab-closed').classList.toggle('active',tab==='closed');
  renderDeals();
}
function toggleDgcxLeg()     { document.getElementById('dgcx-leg-fields').style.display   = document.getElementById('d-dgcx-enabled').checked?'block':'none'; }
function toggleEditDgcxLeg() { document.getElementById('e-dgcx-leg-fields').style.display = document.getElementById('e-dgcx-enabled').checked?'block':'none'; }

function openDealModal() {
  document.getElementById('d-dgcx-enabled').checked=false;
  document.getElementById('dgcx-leg-fields').style.display='none';
  populateInstrumentSelect('d-instrument');
  populateLegBrokerSelect('d-mcx-broker',null); populateLegBrokerSelect('d-comex-broker',null); populateLegBrokerSelect('d-dgcx-broker',null);
  document.getElementById('deal-modal').classList.add('open');
}
function closeDealModal() { document.getElementById('deal-modal').classList.remove('open'); }

async function loadDeals() {
  const res=await apiFetch('/api/deals'); deals=await res.json();
  if (document.getElementById('page-deals').classList.contains('active')) renderDeals();
}
function getVal(id) { const el=document.getElementById(id); if(!el) throw new Error(`#${id} not found`); return el.value; }
function getChecked(id) { const el=document.getElementById(id); if(!el) throw new Error(`#${id} not found`); return el.checked; }

async function saveDeal() {
  try {
    const dgcxEnabled=getChecked('d-dgcx-enabled');
    const instrument=getVal('d-instrument'), note=getVal('d-note');
    const usdInrRate=parseFloat(getVal('d-usd-inr'))||89, dginrAtEntry=getVal('d-dginr')||null;
    const mcxSide=getVal('d-mcx-side'), mcxPrice=parseFloat(getVal('d-mcx-price'));
    const mcxQty=parseFloat(getVal('d-mcx-qty'))||1, mcxBrok=parseFloat(getVal('d-mcx-brok'))||0;
    const mcxBrokerId=getVal('d-mcx-broker')||null;
    const comexSide=getVal('d-comex-side'), comexPrice=parseFloat(getVal('d-comex-price'));
    const comexQty=parseFloat(getVal('d-comex-qty'))||1, comexBrok=parseFloat(getVal('d-comex-brok'))||0;
    const comexBrokerId=getVal('d-comex-broker')||null;
    const dgcxSide=dgcxEnabled?getVal('d-dgcx-side'):null;
    const dgcxPrice=dgcxEnabled?parseFloat(getVal('d-dgcx-price')):null;
    const dgcxQty=dgcxEnabled?(parseFloat(getVal('d-dgcx-qty'))||1):null;
    const dgcxBrok=dgcxEnabled?(parseFloat(getVal('d-dgcx-brok'))||0):null;
    const dgcxBrokerId=dgcxEnabled?(getVal('d-dgcx-broker')||null):null;
    if (!instrument) return alert('Please select an instrument');
    if (isNaN(mcxPrice)||mcxPrice<=0) return alert('Please enter a valid MCX entry price');
    if (isNaN(comexPrice)||comexPrice<=0) return alert('Please enter a valid COMEX entry price');
    if (dgcxEnabled&&(isNaN(dgcxPrice)||dgcxPrice<=0)) return alert('Please enter a valid DGCX entry price');
    const saveBtn=document.querySelector('#deal-modal .btn-primary');
    if (saveBtn) { saveBtn.textContent='Saving...'; saveBtn.disabled=true; }
    const res=await apiFetch('/api/deals',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({instrument,note,usdInrRate,dginrAtEntry,
        mcxSide,mcxPrice,mcxQty,mcxBrokerage:mcxBrok,mcxBrokerId,
        comexSide,comexPrice,comexQty,comexBrokerage:comexBrok,comexBrokerId,
        dgcxEnabled,dgcxSide,dgcxPrice,dgcxQty,dgcxBrokerage:dgcxBrok,dgcxBrokerId})});
    if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
    await loadDeals(); closeDealModal();
    showPage('deals',document.querySelector('.nav-btn[data-page="deals"]'));
  } catch(err) { console.error('saveDeal error:',err); alert('Failed to save deal: '+err.message); }
  finally { const saveBtn=document.querySelector('#deal-modal .btn-primary'); if(saveBtn){saveBtn.textContent='Save Deal';saveBtn.disabled=false;} }
}

// ── P&L calculation ────────────────────────────────────────────────────────
function getLivePnl(deal) {
  const p=prices[deal.instrument], rate=parseFloat(deal.usdInrRate)||89;
  let mcxPnl=null, comexPnl=null, dgcxPnl=null, mcxNow=null, comexNow=null, dgcxNow=null;
  if (p?.mcx&&deal.mcx) {
    const qty=parseFloat(deal.mcx.qty)||1, brok=parseFloat(deal.mcx.brokerage)||0;
    mcxNow=deal.mcx.side==='SELL'?p.mcx.bid:p.mcx.ask;
    if (mcxNow!=null) {
      const raw=deal.mcx.side==='SELL'?(parseFloat(deal.mcx.entryPrice)-parseFloat(mcxNow)):(parseFloat(mcxNow)-parseFloat(deal.mcx.entryPrice));
      const broker=deal.mcx.brokerId?brokers.find(b=>b.id===parseInt(deal.mcx.brokerId)):null;
      const share=broker?(broker.profitShare/100):1;
      mcxPnl=(raw*qty-brok)*share;
    }
  }
  if (p?.comex&&deal.comex) {
    const qty=parseFloat(deal.comex.qty)||1, brok=parseFloat(deal.comex.brokerage)||0;
    comexNow=deal.comex.side==='SELL'?p.comex.bid:p.comex.ask;
    if (comexNow!=null) {
      const raw=deal.comex.side==='SELL'?(parseFloat(deal.comex.entryPrice)-parseFloat(comexNow)):(parseFloat(comexNow)-parseFloat(deal.comex.entryPrice));
      const convRate = raw >= 0 ? 88.88 : 89;
      const broker=deal.comex.brokerId?brokers.find(b=>b.id===parseInt(deal.comex.brokerId)):null;
      const share=broker?(broker.profitShare/100):1;
      comexPnl=(raw*qty*convRate-brok)*share;
    }
  }
  if (deal.dgcx&&p?.dgcx) {
    const qty=parseFloat(deal.dgcx.qty)||1, brok=parseFloat(deal.dgcx.brokerage)||0;
    dgcxNow=p.dgcx.ltp;
    if (dgcxNow!=null) {
      const raw=deal.dgcx.side==='SELL'?(parseFloat(deal.dgcx.entryPrice)-parseFloat(dgcxNow)):(parseFloat(dgcxNow)-parseFloat(deal.dgcx.entryPrice));
      const convRate = raw >= 0 ? 88.88 : 89;
      const broker=deal.dgcx.brokerId?brokers.find(b=>b.id===parseInt(deal.dgcx.brokerId)):null;
      const share=broker?(broker.profitShare/100):1;
      dgcxPnl=(raw*qty*convRate-brok)*share;
    }
  }
  return {mcxPnl,comexPnl,dgcxPnl,total:(mcxPnl||0)+(comexPnl||0)+(dgcxPnl||0),mcxNow,comexNow,dgcxNow};
}
function applyBrokerShare(rawPnl, brokerId) {
  if (rawPnl===null||rawPnl===undefined) return rawPnl;
  const broker=brokerId?brokers.find(b=>b.id===parseInt(brokerId)):null;
  const share=broker?(broker.profitShare/100):1;
  return rawPnl*share;
}
function brokerNameById(id) {
  if (!id) return null;
  const b=brokers.find(x=>x.id===parseInt(id));
  return b?b.brokerName:null;
}
function dealCardHTML(deal) {
  const isOpen=deal.status==='open';
  const live=isOpen?getLivePnl(deal):null;
  const mcxPnl   = isOpen ? live.mcxPnl   : applyBrokerShare(deal.mcx.pnl,   deal.mcx.brokerId);
  const comexPnl = isOpen ? live.comexPnl : applyBrokerShare(deal.comex.pnl, deal.comex.brokerId);
  const dgcxPnl  = isOpen ? live.dgcxPnl  : (deal.dgcx ? applyBrokerShare(deal.dgcx.pnl, deal.dgcx.brokerId) : null);
  const totalPnl = isOpen ? live.total : (mcxPnl||0)+(comexPnl||0)+(dgcxPnl||0);
  const mcxNow   = isOpen?live.mcxNow   :deal.mcx.exitPrice;
  const comexNow = isOpen?live.comexNow :deal.comex.exitPrice;
  const dgcxNow  = isOpen?live.dgcxNow  :(deal.dgcx?deal.dgcx.exitPrice:null);
  const pc   = v=>(v===null||v===undefined?'--':parseFloat(v).toFixed(0));
  const pcls = v=>(v===null||v===undefined?'':(parseFloat(v)>=0?'pos':'neg'));
  const isPartialChild = !!deal.parentDealId;
  const legHTML=(label,color,side,entry,now,pnl,brok,qty,brokerId,ff=fmt)=>{
    const bName=brokerNameById(brokerId);
    const broker=brokerId?brokers.find(b=>b.id==parseInt(brokerId)):null;
    const brokerShare=broker?broker.profitShare:100;
    return `
    <div class="deal-leg">
      <div class="deal-leg-label" style="color:${color}">${label}</div>
      <div class="deal-leg-row"><span>SIDE</span><span style="font-weight:700;color:${side==='SELL'?'var(--red)':'var(--green)'}">${side}</span></div>
      <div class="deal-leg-row"><span>QTY</span><span>${qty}</span></div>
      <div class="deal-leg-row"><span>ENTRY</span><span>${ff(entry)}</span></div>
      <div class="deal-leg-row"><span>${isOpen?'NOW':'EXIT'}</span><span class="muted">${now!=null?ff(now):'--'}</span></div>
      <div class="deal-leg-row"><span>BROK</span><span class="muted">${fmt(brok)}</span></div>
      ${bName?`<div class="deal-leg-broker">🏦 ${bName} — ${brokerShare}%</div>`:''}
      <div class="deal-leg-pnl"><span class="label">P/L</span><span class="value ${pcls(pnl)}">${pc(pnl)}</span></div>
    </div>`;
  };
  return `
    <div class="deal-card ${!isOpen?'closed':''} ${isPartialChild?'partial-child':''}" id="dealcard-${deal.id}">
      <div class="deal-card-head">
        <div class="deal-card-title">
          <div class="deal-card-name">${deal.instrument}${isPartialChild?' <span style="font-size:10px;color:var(--gold)">[partial]</span>':''}</div>
          <div class="deal-card-meta">USDINR ${deal.usdInrRate}${deal.dginrAtEntry?` • DGINR ${parseFloat(deal.dginrAtEntry).toFixed(2)}`:''}${deal.note?` • ${deal.note}`:''}</div>
          <div class="deal-card-time">Entry: ${new Date(deal.entryTime).toLocaleString()}${deal.exitTime ? ` • Exit: ${new Date(deal.exitTime).toLocaleString()}` : ''}</div>
        </div>
        <div class="deal-card-side">
          <div class="deal-card-pnl">
            <div class="deal-card-pnl-label">NET P/L</div>
            <div class="deal-card-pnl-value ${pcls(totalPnl)}">${pc(totalPnl)}</div>
          </div>
          <div class="deal-card-actions">
            ${isOpen?`
              <button class="deal-alert-btn" onclick="toggleDealAlert('${deal.id}',this)" title="Set P/L alert">🔔</button>
              <button class="btn btn-sm" style="background:var(--surface2);border:1px solid var(--border);color:var(--text)" onclick="openEditModal('${deal.id}')">Edit</button>
              <button class="btn btn-sm btn-primary" onclick="openCloseModal('${deal.id}')">Close</button>
              <button class="btn btn-sm btn-danger" onclick="deleteDeal('${deal.id}')">Delete</button>`
            :`<button class="btn btn-sm" style="background:var(--surface2);border:1px solid var(--border);color:var(--text)" onclick="openEditModal('${deal.id}')">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deleteDeal('${deal.id}')">Delete</button>`}
          </div>
        </div>
      </div>
      <div class="deal-card-grid ${deal.dgcx?'has-dgcx':''}">
        ${legHTML('MCX LEG',  'var(--accent)',deal.mcx.side,  deal.mcx.entryPrice,  mcxNow,  mcxPnl,  deal.mcx.brokerage,  deal.mcx.qty,  deal.mcx.brokerId)}
        ${legHTML('COMEX LEG','var(--gold)',  deal.comex.side,deal.comex.entryPrice,comexNow,comexPnl,deal.comex.brokerage,deal.comex.qty,deal.comex.brokerId,fmtComex)}
        ${deal.dgcx?legHTML('DGCX LEG','#6cf',deal.dgcx.side,deal.dgcx.entryPrice,dgcxNow,dgcxPnl,deal.dgcx.brokerage,deal.dgcx.qty,deal.dgcx.brokerId,fmtComex):''}
      </div>
    </div>`;
}
function renderDeals() {
  const container=document.getElementById('deals-cards');
  const filtered=deals.filter(d=>d.status===dealTab);
  let livePnl=0, closedPnl=0, openCount=0;
  deals.forEach(d=>{
    if (d.status==='open') {
      openCount++; livePnl+=getLivePnl(d).total;
    } else {
      const mp=applyBrokerShare(d.mcx?.pnl, d.mcx?.brokerId)||0;
      const cp=applyBrokerShare(d.comex?.pnl, d.comex?.brokerId)||0;
      const dp=d.dgcx?applyBrokerShare(d.dgcx?.pnl, d.dgcx?.brokerId)||0:0;
      closedPnl+=mp+cp+dp;
    }
  });
  container.innerHTML=filtered.length===0
    ?`<div style="color:var(--muted);text-align:center;padding:48px 16px;border:1px dashed var(--border);border-radius:8px">No ${dealTab} deals</div>`
    :filtered.map(dealCardHTML).join('');
  const total=livePnl+closedPnl;
  document.getElementById('open-count').textContent=openCount;
  document.getElementById('live-pnl').textContent=`₹${livePnl.toFixed(0)}`;
  document.getElementById('closed-pnl').textContent=`₹${closedPnl.toFixed(0)}`;
  document.getElementById('total-pnl').textContent=`₹${total.toFixed(0)}`;
  document.getElementById('live-pnl').className='pnl-value '+(livePnl>=0?'pos':'neg');
  document.getElementById('total-pnl').className='pnl-value '+(total>=0?'pos':'neg');
  updateDealAlertButtons();
}
function updateDealsLivePnl() { if (document.getElementById('page-deals').classList.contains('active')) renderDeals(); }

let closeMode = 'manual';

function setCloseMode(mode) {
  closeMode = mode;
  ['manual','condition','immediate'].forEach(m => {
    document.getElementById('panel-'+m).style.display = m === mode ? 'block' : 'none';
    const tab = document.getElementById('tab-'+m);
    tab.classList.remove('active-manual','active-condition','active-immediate');
    if (m === mode) tab.classList.add('active-'+m);
  });
  const btn = document.getElementById('c-confirm-btn');
  if (mode === 'immediate') {
    btn.style.background = '#ff5555'; btn.textContent = 'Close Now';
  } else if (mode === 'condition') {
    btn.style.background = 'var(--gold)'; btn.textContent = 'Set Condition';
  } else {
    btn.style.background = '#6cf'; btn.textContent = 'Confirm Close';
  }
}

// Call setCloseMode('manual') inside your openCloseModal to reset on open
function openCloseModal(dealId) {
  closingDealId = dealId;
  const deal = deals.find(d => d.id === parseInt(dealId));
  if (!deal) return;

  const grid = document.getElementById('close-qty-grid');
  grid.innerHTML = '';

  if (deal.mcx?.qty) {
    grid.innerHTML += `
      <div class="form-group">
        <label>MCX qty (lots) <span style="color:var(--muted);font-weight:400">/ ${deal.mcx.qty} open</span></label>
        <input type="number" id="c-mcx-qty" placeholder="${deal.mcx.qty}" min="0.01" step="0.01">
      </div>`;
  }
  if (deal.comex?.qty) {
    grid.innerHTML += `
      <div class="form-group">
        <label>COMEX qty (lots) <span style="color:var(--muted);font-weight:400">/ ${deal.comex.qty} open</span></label>
        <input type="number" id="c-comex-qty" placeholder="${deal.comex.qty}" min="0.000001" step="0.000001">
      </div>`;
  }
  if (deal.dgcx?.qty) {
    grid.innerHTML += `
      <div class="form-group">
        <label>DGCX qty (lots) <span style="color:var(--muted);font-weight:400">/ ${deal.dgcx.qty} open</span></label>
        <input type="number" id="c-dgcx-qty" placeholder="${deal.dgcx.qty}" min="0.000001" step="0.000001">
      </div>`;
    document.getElementById('c-dgcx-wrap').style.display = 'block';
  } else {
    document.getElementById('c-dgcx-wrap').style.display = 'none';
  }

  setCloseMode('manual');
  document.getElementById('c-mcx-price').value = '';
  document.getElementById('c-comex-price').value = '';
  if (document.getElementById('c-dgcx-price')) document.getElementById('c-dgcx-price').value = '';
  document.getElementById('c-cond-value').value = '';
  document.getElementById('close-modal').classList.add('open');
}
function closeCloseModal() {
  document.getElementById('close-modal').classList.remove('open');
  closingDealId = null;
}

async function confirmClose() {
  const deal = deals.find(d => d.id === parseInt(closingDealId));
  if (!deal) return alert('Deal not found');

  if (closeMode === 'condition') {
    const condValue = parseFloat(document.getElementById('c-cond-value').value);
    if (isNaN(condValue)) return alert('Enter a valid condition value');
  }

  if (closeMode === 'immediate') {
    if (!confirm('Send market close order to MT5 immediately? This cannot be undone.')) return;
  }

  const body = {
      closeMode,
      mcxCloseQty:   document.getElementById('c-mcx-qty')?.value || null,
      comexCloseQty: document.getElementById('c-comex-qty')?.value || null,
      dgcxCloseQty:  deal.dgcx ? (document.getElementById('c-dgcx-qty')?.value || null) : null,
      mcxExitPrice:   closeMode === 'manual' ? document.getElementById('c-mcx-price').value : null,
      comexExitPrice: closeMode === 'manual' ? document.getElementById('c-comex-price').value : null,
      dgcxExitPrice:  closeMode === 'manual' && deal.dgcx ? (document.getElementById('c-dgcx-price')?.value || null) : null,
      conditionField: closeMode === 'condition' ? document.getElementById('c-cond-field').value : null,
      conditionDir:   closeMode === 'condition' ? document.getElementById('c-cond-dir').value : null,
      conditionValue: closeMode === 'condition' ? parseFloat(document.getElementById('c-cond-value').value) : null,
      placeImmediately: closeMode === 'immediate',
  };

  const res = await apiFetch(`/api/deals/${closingDealId}/close`, {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.text()) || 'Failed to close deal');
  const data = await res.json();
  await loadDeals(); closeCloseModal(); renderDeals();

  const msg = closeMode === 'immediate' ? 'Market order sent to MT5'
            : closeMode === 'condition' ? 'Close order set — waiting for condition'
            : data.partial ? 'Partial close completed' : 'Deal closed successfully';
  showToast('Deal Closed', msg, 'trigger', 3000);
}

async function deleteDeal(id) {
  id=parseInt(id);
  if (!confirm('Delete this deal?')) return;
  await apiFetch(`/api/deals/${id}`,{method:'DELETE'});
  await loadDeals(); renderDeals();
}
function openEditModal(id) {
  id=parseInt(id); const deal=deals.find(d=>d.id===id); if (!deal) return;
  editingDealId=id;
  document.getElementById('e-instrument-display').value=deal.instrument;
  document.getElementById('e-usd-inr').value=deal.usdInrRate||89;
  document.getElementById('e-dginr').value=deal.dginrAtEntry||'';
  document.getElementById('e-note').value=deal.note||'';
  document.getElementById('e-mcx-side').value=deal.mcx.side;
  document.getElementById('e-mcx-price').value=deal.mcx.entryPrice;
  document.getElementById('e-mcx-qty').value=deal.mcx.qty||1;
  document.getElementById('e-mcx-brok').value=deal.mcx.brokerage||0;
  document.getElementById('e-comex-side').value=deal.comex.side;
  document.getElementById('e-comex-price').value=deal.comex.entryPrice;
  document.getElementById('e-comex-qty').value=deal.comex.qty||1;
  document.getElementById('e-comex-brok').value=deal.comex.brokerage||0;
  const hasDgcx=!!deal.dgcx;
  document.getElementById('e-dgcx-enabled').checked=hasDgcx;
  document.getElementById('e-dgcx-leg-fields').style.display=hasDgcx?'block':'none';
  if (hasDgcx) {
    document.getElementById('e-dgcx-side').value=deal.dgcx.side;
    document.getElementById('e-dgcx-price').value=deal.dgcx.entryPrice;
    document.getElementById('e-dgcx-qty').value=deal.dgcx.qty||1;
    document.getElementById('e-dgcx-brok').value=deal.dgcx.brokerage||0;
  }
  populateLegBrokerSelect('e-mcx-broker',  deal.mcx.brokerId);
  populateLegBrokerSelect('e-comex-broker',deal.comex.brokerId);
  populateLegBrokerSelect('e-dgcx-broker', deal.dgcx?.brokerId||null);
  document.getElementById('edit-modal').classList.add('open');
}
function closeEditModal() { document.getElementById('edit-modal').classList.remove('open'); editingDealId=null; }
async function saveEditDeal() {
  const btn=document.getElementById('edit-save-btn');
  try {
    btn.textContent='Saving...'; btn.disabled=true;
    const dgcxEnabled=document.getElementById('e-dgcx-enabled').checked;
    const body={
      note:           document.getElementById('e-note').value,
      usdInrRate:     parseFloat(document.getElementById('e-usd-inr').value)||89,
      dginrAtEntry:   document.getElementById('e-dginr').value||null,
      mcxSide:        document.getElementById('e-mcx-side').value,
      mcxPrice:       parseFloat(document.getElementById('e-mcx-price').value),
      mcxQty:         parseFloat(document.getElementById('e-mcx-qty').value)||1,
      mcxBrokerage:   parseFloat(document.getElementById('e-mcx-brok').value)||0,
      mcxBrokerId:    document.getElementById('e-mcx-broker').value||null,
      comexSide:      document.getElementById('e-comex-side').value,
      comexPrice:     parseFloat(document.getElementById('e-comex-price').value),
      comexQty:       parseFloat(document.getElementById('e-comex-qty').value)||1,
      comexBrokerage: parseFloat(document.getElementById('e-comex-brok').value)||0,
      comexBrokerId:  document.getElementById('e-comex-broker').value||null,
      dgcxEnabled,
      dgcxSide:       dgcxEnabled?document.getElementById('e-dgcx-side').value:null,
      dgcxPrice:      dgcxEnabled?parseFloat(document.getElementById('e-dgcx-price').value):null,
      dgcxQty:        dgcxEnabled?(parseFloat(document.getElementById('e-dgcx-qty').value)||1):null,
      dgcxBrokerage:  dgcxEnabled?(parseFloat(document.getElementById('e-dgcx-brok').value)||0):null,
      dgcxBrokerId:   dgcxEnabled?(document.getElementById('e-dgcx-broker').value||null):null,
    };
    if (isNaN(body.mcxPrice)||body.mcxPrice<=0) return alert('Please enter a valid MCX entry price');
    if (isNaN(body.comexPrice)||body.comexPrice<=0) return alert('Please enter a valid COMEX entry price');
    const res=await apiFetch(`/api/deals/${editingDealId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
    await loadDeals(); closeEditModal(); renderDeals();
  } catch(err) { console.error('saveEditDeal error:',err); alert('Failed to save: '+err.message); }
  finally { btn.textContent='Save Changes'; btn.disabled=false; }
}

// ── Brokers ────────────────────────────────────────────────────────────────
function renderInstrumentRows(instruments=[]) {
  const container = document.getElementById('b-instr-rows');
  container.innerHTML = '';
  if (instruments.length === 0) addInstrumentRow();
  else instruments.forEach(i => addInstrumentRow(i));
}

function addInstrumentRow(data={}) {
  const container = document.getElementById('b-instr-rows');
  const row = document.createElement('div');
  row.className = 'order-leg-fields';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 80px 80px 36px;gap:8px;margin-bottom:8px;align-items:end';
  const instrOpts = Object.values(prices).map(p =>
    `<option value="${p.name}" ${data.instrument===p.name?'selected':''}>${p.displayName||p.name}</option>`
  ).join('');
  row.innerHTML = `
    <select class="bi-instrument"><option value="">Select...</option>${instrOpts}</select>
    <input type="number" class="bi-lotsize"  placeholder="1"   value="${data.lotSize||1}"  min="0.001" step="0.001">
    <input type="number" class="bi-lotqty"   placeholder="100" value="${data.lotQty||''}"  min="0.001" step="0.001">
    <input type="number" class="bi-maxlots"  placeholder="—"   value="${data.maxLots||''}" min="0.01"  step="0.01">
    <button type="button" onclick="this.closest('div').remove()"
      style="width:32px;height:32px;border-radius:6px;border:0.5px solid var(--border);
             background:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1">×</button>`;
  container.appendChild(row);
}

function getBrokerInstruments() {
  return [...document.querySelectorAll('#b-instr-rows > div')].map(row => ({
    instrument: row.querySelector('.bi-instrument').value,
    lotSize:    parseFloat(row.querySelector('.bi-lotsize').value) || 1,
    lotQty:     parseFloat(row.querySelector('.bi-lotqty').value)  || 1,
    maxLots:    parseFloat(row.querySelector('.bi-maxlots').value) || null,
  })).filter(i => i.instrument);
}

function openBrokerModal() {
  editingBrokerId = null;
  document.getElementById('broker-modal-title').textContent = 'Add broker account';
  document.getElementById('broker-save-btn').textContent = 'Save broker';
  ['b-name','b-account-id','b-password','b-brokerage','b-profit-share']
    .forEach(id => { const el=document.getElementById(id); if(el) el.value = id.includes('brok')||id.includes('profit') ? '0' : ''; });
  renderInstrumentRows([]);
  document.getElementById('broker-modal').classList.add('open');
}

function openEditBrokerModal(id) {
  const b = brokers.find(x => x.id === id); if (!b) return;
  editingBrokerId = id;
  document.getElementById('broker-modal-title').textContent = 'Edit broker account';
  document.getElementById('broker-save-btn').textContent = 'Save changes';
  document.getElementById('b-name').value         = b.brokerName;
  document.getElementById('b-account-id').value   = b.accountId || '';
  document.getElementById('b-password').value     = b.password  || '';
  document.getElementById('b-brokerage').value    = b.brokerage;
  document.getElementById('b-profit-share').value = b.profitShare;
  renderInstrumentRows(b.instruments || []);
  document.getElementById('broker-modal').classList.add('open');
}

async function saveBroker() {
  const btn = document.getElementById('broker-save-btn');
  try {
    btn.textContent = 'Saving...'; btn.disabled = true;
    const body = {
      brokerName:  document.getElementById('b-name').value.trim(),
      accountId:   document.getElementById('b-account-id').value.trim() || null,
      password:    document.getElementById('b-password').value || null,
      brokerage:   parseFloat(document.getElementById('b-brokerage').value) || 0,
      profitShare: parseFloat(document.getElementById('b-profit-share').value) || 0,
      instruments: getBrokerInstruments(),
    };
    if (!body.brokerName) return alert('Broker name is required');
    const url    = editingBrokerId ? `/api/brokers/${editingBrokerId}` : '/api/brokers';
    const method = editingBrokerId ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    await loadBrokers(); renderBrokers(); closeBrokerModal();
  } catch(err) { alert('Failed to save broker: ' + err.message); }
  finally { btn.textContent = editingBrokerId ? 'Save changes' : 'Save broker'; btn.disabled = false; }
}
async function loadBrokers() {
  const res=await apiFetch('/api/brokers'); brokers=await res.json();
}
function renderBrokers() {
  const tbody=document.getElementById('brokers-tbody'); if (!tbody) return;
  if (brokers.length===0) {
    tbody.innerHTML=`<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">No broker accounts yet.</td></tr>`;
    return;
  }
  tbody.innerHTML=brokers.map(b=>`
    <tr class="broker-row">
      <td style="text-align:left"><div style="font-weight:600;font-size:12px">${b.brokerName}</div></td>
      <td style="text-align:left">${b.accountId?`<span class="acct-badge">${b.accountId}</span>`:'<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td style="text-align:left" class="broker-hide-tablet"><div style="font-size:11px;color:var(--text)">${b.instrument}</div></td>
      <td class="broker-hide-tablet">${b.lotSize}</td>
      <td>₹${parseFloat(b.brokerage).toFixed(2)}</td>
      <td><span class="profit-badge">${b.profitShare}%</span></td>
      <td class="broker-hide-tablet">
        <span class="pass-hidden">${b.password?'':'—'}</span>
        ${b.password?`<button onclick="togglePass(${b.id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:10px;margin-left:4px" id="passToggle-${b.id}">show</button>
        <span id="passText-${b.id}" style="display:none;font-size:11px;color:var(--accent)">${b.password}</span>`:''}
      </td>
      <td class="broker-hide-tablet" style="color:var(--muted);font-size:10px">${new Date(b.createdAt).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-sm" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);margin-right:4px" onclick="openEditBrokerModal(${b.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBroker(${b.id})">✕</button>
      </td>
    </tr>`).join('');
  renderBrokerSummary();
}
function renderBrokerSummary() {
  const summary=document.getElementById('broker-summary'); if (!summary) return;
  summary.innerHTML=`
    <div class="pnl-card"><div class="pnl-label">Total Brokers</div><div class="pnl-value">${brokers.length}</div></div>
    <div class="pnl-card"><div class="pnl-label">Avg Brokerage</div><div class="pnl-value" style="font-size:16px">₹${brokers.length?(brokers.reduce((s,b)=>s+b.brokerage,0)/brokers.length).toFixed(0):0}</div></div>
    <div class="pnl-card"><div class="pnl-label">Avg Profit Share</div><div class="pnl-value" style="font-size:16px">${brokers.length?(brokers.reduce((s,b)=>s+b.profitShare,0)/brokers.length).toFixed(1):0}%</div></div>`;
}
function togglePass(id) {
  const text=document.getElementById('passText-'+id), btn=document.getElementById('passToggle-'+id);
  if (!text||!btn) return;
  const showing=text.style.display!=='none';
  text.style.display=showing?'none':'inline'; btn.textContent=showing?'show':'hide';
}
function closeBrokerModal() { document.getElementById('broker-modal').classList.remove('open'); editingBrokerId=null; }
function populateBrokerInstrumentSelect() {
  const sel=document.getElementById('b-instrument'); if (!sel) return;
  const current=sel.value; sel.innerHTML='<option value="">Select instrument...</option>';
  Object.values(prices).forEach(p=>{ const opt=document.createElement('option'); opt.value=p.name; opt.textContent=p.displayName||p.name; sel.appendChild(opt); });
  if (current) sel.value=current;
}
async function deleteBroker(id) {
  const b=brokers.find(x=>x.id===id);
  if (!confirm(`Delete broker "${b?.brokerName}"?`)) return;
  await apiFetch(`/api/brokers/${id}`,{method:'DELETE'});
  await loadBrokers(); renderBrokers();
}

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


// ═══════════════════════════════════════════════════════════════════════════
// EA CHECK PANEL — JavaScript
// ═══════════════════════════════════════════════════════════════════════════
 
const EA_VALID_MS      = 5 * 60 * 1000;   // 5 min
let   eaCheckData      = null;             // last /api/ea/status response
let   eaCheckedAt      = 0;               // timestamp of last check
let   eaAutoInterval   = null;            // setInterval handle
let   eaValidityTimer  = null;            // countdown timer
let   currentDealId    = null;            // set this when operator selects a deal
 
// ── Call this when operator selects a deal to trade ──────────────────────
function setActiveDeal(dealId) {
  currentDealId = dealId;
  refreshCommitButton();
}
 
// ── Manual Check EAs button ──────────────────────────────────────────────
async function checkEAs() {
  const btn  = document.getElementById('btn-check-eas');
  const icon = document.getElementById('check-icon');
 
  btn.disabled = true;
  btn.classList.add('checking');
  icon.textContent = '…';
 
  try {
    const body = currentDealId ? { dealId: currentDealId } : {};
    const data = await apiPost('/api/ea/check', body);   // waits 3s server-side
 
    eaCheckData = data;
    eaCheckedAt = Date.now();
 
    renderEAPanel(data);
    startValidityCountdown();
 
    const ts = new Date().toLocaleTimeString();
    document.getElementById('ea-last-checked').textContent = `Checked at ${ts}`;
 
  } catch (err) {
    showEAError('Server unreachable — ' + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('checking');
    icon.textContent = '↻';
  }
}
 
// ── Toggle auto-recheck ──────────────────────────────────────────────────
function toggleAutoRecheck(enabled) {
  if (eaAutoInterval) { clearInterval(eaAutoInterval); eaAutoInterval = null; }
  if (enabled) {
    eaAutoInterval = setInterval(() => {
      if (Date.now() - eaCheckedAt < 29_000) return;  // skip if just checked
      checkEAs();
    }, 30_000);
  }
}
 
// ── Render EA leg cards ──────────────────────────────────────────────────
function renderEAPanel(data) {
  const grid = document.getElementById('ea-legs-grid');
  if (!data.eas || data.eas.length === 0) {
    grid.innerHTML = '<div style="font-size:11px;color:#e24a4a;padding:8px 0;">No EAs connected — check MT5 terminals</div>';
    setOverallStatus('none', 'No EAs connected');
    return;
  }
 
  grid.innerHTML = data.eas.map(ea => {
    const headroomPct = ea.lotMax > 0 ? (ea.lotHeadroom / ea.lotMax * 100) : 0;
    const lotFillClass = headroomPct > 50 ? '' : headroomPct > 20 ? 'warn' : 'bad';
    const statusClass  = ea.status === 'ready' ? 'ready'
                       : ea.status === 'expired' ? 'expired'
                       : ea.status === 'degraded' ? 'degraded' : 'offline';
    const badgeClass   = `badge-${statusClass}`;
    const badgeText    = ea.status.toUpperCase();
    const lastSeenAgo  = ea.lastSeen ? Math.round((Date.now() - ea.lastSeen) / 1000) : null;
 
    return `
    <div class="ea-leg-card ${statusClass}">
      <div class="ea-leg-header">
        <span class="ea-leg-name">${ea.brokerName || ea.accountId}</span>
        <span class="ea-leg-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="ea-leg-rows">
        <div class="ea-leg-row">
          <span class="label">Symbol</span>
          <span class="value ${ea.symbolValid ? 'ok' : 'bad'}">${ea.symbol || '—'} ${ea.symbolValid ? '✓' : '✗'}</span>
        </div>
        <div class="ea-leg-row">
          <span class="label">Market</span>
          <span class="value ${ea.marketOpen ? 'ok' : 'warn'}">${ea.marketOpen ? 'Open' : 'Closed'}</span>
        </div>
        <div class="ea-leg-row">
          <span class="label">Lots used</span>
          <span class="value">${ea.lotUsed} / ${ea.lotMax}</span>
        </div>
        <div class="ea-leg-row">
          <span class="label">Headroom</span>
          <span class="value ${lotFillClass === 'bad' ? 'bad' : lotFillClass === 'warn' ? 'warn' : 'ok'}">${ea.lotHeadroom} lots free</span>
        </div>
        <div class="lot-bar">
          <div class="lot-fill ${lotFillClass}" style="width:${headroomPct}%"></div>
        </div>
        ${lastSeenAgo !== null ? `
        <div class="ea-leg-row" style="margin-top:4px;">
          <span class="label">Last seen</span>
          <span class="value ${lastSeenAgo > 60 ? 'bad' : 'ok'}">${lastSeenAgo}s ago</span>
        </div>` : ''}
        ${ea.error ? `<div class="ea-leg-row"><span class="value bad" style="font-size:10px;">${ea.error}</span></div>` : ''}
      </div>
    </div>`;
  }).join('');
 
  // Deal-specific leg validation
  if (data.dealValidation) {
    renderDealValidation(data.dealValidation);
  }
 
  // Overall status
  const allReady = data.eas.every(e => e.status === 'ready');
  const anyReady = data.eas.some(e => e.status === 'ready');
  if (allReady)     setOverallStatus('all-ready', `All ${data.eas.length} EAs ready`);
  else if (anyReady) setOverallStatus('partial',  'Some EAs not ready — check above');
  else               setOverallStatus('none',     'No EAs ready');
 
  refreshCommitButton();
}
 
// ── Deal validation overlay ──────────────────────────────────────────────
function renderDealValidation(legs) {
  legs.forEach(leg => {
    // Find the card for this leg and add a deal-specific indicator
    const cards = document.querySelectorAll('.ea-leg-card');
    cards.forEach(card => {
      const name = card.querySelector('.ea-leg-name')?.textContent;
      if (name && name.includes(leg.exchange)) {
        const indicator = document.createElement('div');
        indicator.className = 'ea-leg-row';
        indicator.style.marginTop = '6px';
        indicator.style.paddingTop = '6px';
        indicator.style.borderTop = '1px solid #1e2530';
        indicator.innerHTML = `
          <span class="label">For this deal</span>
          <span class="value ${leg.ready ? 'ok' : 'bad'}">${leg.ready ? `✓ ${leg.qty} lots` : leg.reason}</span>`;
        card.querySelector('.ea-leg-rows').appendChild(indicator);
      }
    });
  });
}
 
// ── Overall status dot + text ────────────────────────────────────────────
function setOverallStatus(state, text) {
  const dot  = document.getElementById('ea-overall-dot');
  const span = document.getElementById('ea-overall-text');
  dot.className = 'ea-status-dot';
  if (state === 'all-ready') {
    dot.classList.add('dot-all-ready');
    span.innerHTML = `<strong>All clear</strong> — ${text}. Ready to commit.`;
  } else if (state === 'partial') {
    dot.classList.add('dot-partial');
    span.innerHTML = `<strong>Not ready</strong> — ${text}`;
  } else {
    dot.classList.add('dot-none');
    span.innerHTML = text;
  }
}
 
// ── Commit button gate ───────────────────────────────────────────────────
function refreshCommitButton() {
  const btn      = document.getElementById('btn-commit-deal');
  const now      = Date.now();
  const isValid  = eaCheckedAt > 0 && (now - eaCheckedAt) < EA_VALID_MS;
  const allReady = eaCheckData?.allReady && isValid;
  const hasDeal  = !!currentDealId;
 
  // If deal has specific validation, use that
  const dealOk = eaCheckData?.dealValidation
    ? eaCheckData.dealValidation.every(l => l.ready)
    : allReady;
 
  const armed = allReady && hasDeal && dealOk;
 
  btn.disabled = !armed;
  btn.className = 'btn-commit ' + (armed ? 'armed' : 'locked');
  btn.textContent = armed ? '⚡ Place Trade' : 'Place Trade';
}
 
// ── Validity countdown bar ───────────────────────────────────────────────
function startValidityCountdown() {
  if (eaValidityTimer) clearInterval(eaValidityTimer);
 
  const bar     = document.getElementById('ea-validity-bar');
  const fill    = document.getElementById('validity-fill');
  const label   = document.getElementById('validity-label');
  bar.style.display = 'flex';
 
  eaValidityTimer = setInterval(() => {
    const elapsed  = Date.now() - eaCheckedAt;
    const remaining = EA_VALID_MS - elapsed;
 
    if (remaining <= 0) {
      clearInterval(eaValidityTimer);
      fill.style.width = '0%';
      fill.style.background = '#e24a4a';
      label.textContent = 'EXPIRED';
      label.className   = 'validity-label expired';
      setOverallStatus('none', 'Preflight expired — run Check EAs again');
      refreshCommitButton();
 
      // If auto-recheck is on, trigger immediately
      if (document.getElementById('ea-auto-recheck').checked) checkEAs();
      return;
    }
 
    const pct = (remaining / EA_VALID_MS) * 100;
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
 
    fill.style.width = pct + '%';
    fill.style.background = pct > 40 ? '#4a90e2' : pct > 15 ? '#e2a44a' : '#e24a4a';
    label.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    label.className   = 'validity-label' + (pct < 15 ? ' warning' : '');
 
    refreshCommitButton();
  }, 1000);
}
 
// ── Error state ──────────────────────────────────────────────────────────
function showEAError(msg) {
  document.getElementById('ea-legs-grid').innerHTML =
    `<div style="font-size:11px;color:#e24a4a;padding:8px 0;">⚠ ${msg}</div>`;
  setOverallStatus('none', msg);
}
 
// ── Handle WebSocket messages from server ────────────────────────────────
function handleEAWebSocketMessage(data) {
  if (data.type === 'ea_status_update') {
    // A single EA just sent a heartbeat — update its card live
    if (!eaCheckData) return;
    const idx = eaCheckData.eas.findIndex(e => e.accountId === data.ea.accountId);
    if (idx >= 0) eaCheckData.eas[idx] = data.ea;
    else eaCheckData.eas.push(data.ea);
    renderEAPanel(eaCheckData);
  }
 
  if (data.type === 'commit_success') {
    showCommitResult(true, data);
  }
 
  if (data.type === 'commit_failure') {
    showCommitResult(false, data);
  }
 
  if (data.type === 'commit_timeout') {
    showCommitResult(false, { message: data.message, failedLegs: data.missing.map(e => ({ exchange: e })) });
  }
}
 
// ── Wire up to your existing WebSocket ──────────────────────────────────
// IMPORTANT: call this after your ws is created:
//   ws.addEventListener('message', e => {
//     const data = JSON.parse(e.data);
//     handleEAWebSocketMessage(data);
//     // ... your existing handlers
//   });
 
// ── Commit deal ──────────────────────────────────────────────────────────
async function commitDeal() {
  if (!currentDealId) { alert('No deal selected'); return; }
 
  const btn = document.getElementById('btn-commit-deal');
  btn.disabled = true;
  btn.textContent = '⟳ Committing…';
 
  try {
    const resp = await apiPost('/api/ea/commit', { dealId: currentDealId });
    if (resp.ok) {
      btn.textContent = '⟳ Waiting for EAs…';
      // Result comes via WebSocket (commit_success / commit_failure)
    } else {
      showCommitResult(false, { message: resp.error || 'Commit rejected', failedLegs: resp.notReady?.map(e => ({ exchange: e })) || [] });
      btn.disabled = false;
      btn.className = 'btn-commit armed';
      btn.textContent = '⚡ Place Trade';
    }
  } catch (err) {
    showCommitResult(false, { message: 'Network error: ' + err.message, failedLegs: [] });
    btn.disabled = false;
    btn.textContent = '⚡ Place Trade';
  }
}
 
// ── Commit result overlay ────────────────────────────────────────────────
function showCommitResult(success, data) {
  const btn = document.getElementById('btn-commit-deal');
 
  // Play browser beep via Web Audio API (no external CDN needed)
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = success ? 'sine' : 'square';
    osc.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.4 : 1.2));
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.4 : 1.2));
  } catch (e) {}
 
  if (success) {
    btn.textContent = '✓ Placed';
    btn.style.background = '#1a3a20';
    btn.style.color      = '#2aba7a';
 
    // Show success notification
    showNotification('success',
      `✓ Deal ${currentDealId} placed on all legs`,
      data.legs?.map(l => `${l.exchange} ticket #${l.ticket}`).join(' · ') || ''
    );
 
    // Reset panel after 5s
    setTimeout(() => {
      currentDealId = null;
      btn.textContent = 'Place Trade';
      btn.style.background = '';
      btn.style.color      = '';
      refreshCommitButton();
    }, 5000);
 
  } else {
    btn.textContent = '⚠ Failed';
    btn.style.background = '#3a1a1a';
    btn.style.color      = '#e24a4a';
 
    showNotification('error',
      `⚠ All-or-none violation — deal ${currentDealId}`,
      data.message || '',
      data.failedLegs
    );
 
    setTimeout(() => {
      btn.disabled    = false;
      btn.textContent = '⚡ Place Trade';
      btn.style.background = '';
      btn.style.color      = '';
      refreshCommitButton();
    }, 6000);
  }
}
 
function showNotification(type, title, subtitle, failedLegs) {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; top:20px; right:20px; width:360px;
    background:${type === 'success' ? '#0d1f14' : '#1f0d0d'};
    border:1px solid ${type === 'success' ? '#2a5a30' : '#5a2a2a'};
    border-radius:10px; padding:16px 18px;
    box-shadow:0 8px 24px rgba(0,0,0,0.4);
    z-index:99999; font-family:monospace; font-size:12px;
    color:${type === 'success' ? '#2aba7a' : '#e24a4a'};
    animation: slideIn 0.2s ease;
  `;
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">${title}</div>
    ${subtitle ? `<div style="color:#7a8299;font-size:11px;">${subtitle}</div>` : ''}
    ${failedLegs?.length ? `
      <div style="margin-top:8px;color:#e24a4a;font-size:11px;">
        Failed: ${failedLegs.map(l => l.exchange + (l.error ? ` (${l.error})` : '')).join(', ')}
      </div>
      <div style="margin-top:4px;color:#e2a44a;font-size:11px;">
        Reversal orders sent to successful legs.
      </div>` : ''}
    <div style="margin-top:10px;text-align:right;">
      <button onclick="this.parentElement.parentElement.remove()"
              style="background:none;border:1px solid #333;color:#666;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;">
        Dismiss
      </button>
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), type === 'success' ? 8000 : 30000);
}
 
// ── apiPost helper (if you don't already have one) ───────────────────────
// async function apiPost(url, body) {
//   const r = await fetch(url, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify(body)
//   });
//   return r.json();
// }