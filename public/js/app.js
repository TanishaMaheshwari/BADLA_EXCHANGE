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

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  document.getElementById('page-' + name).classList.add('active');
  if (name === 'deals')   renderDeals();
  if (name === 'orders')  renderOrders();
  if (name === 'brokers') { renderBrokers(); }  // renderBrokers() calls renderBrokerSummary() internally
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
    // Use first instrument name if available, else fallback
    const instrLabel = b.instruments?.length
      ? b.instruments.map(i => i.name).join(', ')
      : 'no instruments';
    opt.textContent = `${b.brokerName}${b.accountId ? ' [' + b.accountId + ']' : ''} (${instrLabel})`;
    sel.appendChild(opt);
  });
  if (selectedBrokerId) sel.value = selectedBrokerId;
}
function autofillLotFromBroker(leg) {
  const brokerId = document.getElementById(`o-${leg}-broker`).value;
  if (!brokerId) return;
  const broker = brokers.find(b => b.id == brokerId); if (!broker) return;

  const instrName = document.getElementById('o-instrument')?.value || '';
  const matchedInstr = broker.instruments?.find(i =>
    i.name.toLowerCase().includes(instrName.toLowerCase()) ||
    instrName.toLowerCase().includes(i.name.toLowerCase())
  ) || broker.instruments?.[0];

  if (matchedInstr) {
    document.getElementById(`o-${leg}-qty`).value = matchedInstr.maxLots;
  }
}

function autofillLegBroker(leg) {
  const prefix = leg === 'mcx' ? 'd-mcx' : leg === 'comex' ? 'd-comex' : 'd-dgcx';
  const brokerId = document.getElementById(`${prefix}-broker`).value; if (!brokerId) return;
  const b = brokers.find(x => x.id === parseInt(brokerId)); if (!b) return;

  // Try to match instrument by the currently selected deal instrument
  const dealInstr = document.getElementById('d-instrument')?.value || '';
  const matchedInstr = b.instruments?.find(i =>
    i.name.toLowerCase().includes(dealInstr.toLowerCase()) ||
    dealInstr.toLowerCase().includes(i.name.toLowerCase())
  ) || b.instruments?.[0];

  if (matchedInstr) {
    document.getElementById(`${prefix}-qty`).value  = matchedInstr.maxLots;
    document.getElementById(`${prefix}-brok`).value = matchedInstr.brokerage;
    showToast(
      `Broker: ${b.brokerName}`,
      `${matchedInstr.name} — max ${matchedInstr.maxLots} lots, ₹${matchedInstr.brokerage}/lot`,
      'info', 2500
    );
  }
}

function slugify(s) { return s.replace(/[^a-z0-9]/gi,'_'); }
function fmt(v) { return (v===null||v===undefined)?'--':parseFloat(v).toFixed(2); }
function fmtComex(v) {
  if (v === null || v === undefined) return '--';
  const n = parseFloat(v);
  if (isNaN(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5, useGrouping: false });
}
function colorClass(v) { return parseFloat(v)>=0?'pos':'neg'; }

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS() {
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${proto}://${location.host}?token=${sessionToken}`);
  ws.onopen=()=>{ document.getElementById('dot').classList.add('live'); document.getElementById('status-text').textContent='Live'; };
  ws.onmessage=(e)=>{
    const msg=JSON.parse(e.data);
    try { handleEAWebSocketMessage(msg); } catch(err) { console.error("EA websocket error:", err); }
    if (msg.type==='snapshot') {
      msg.data.forEach(d=>prices[d.name]=d);
      renderPrices(); renderDashboard(); populateAllInstrumentSelects();
    } else if (msg.type==='update') {
      const prev=prices[msg.data.name]; prices[msg.data.name]=msg.data;
      updateCount++; document.getElementById('update-count').textContent=`${updateCount} ticks`;
      document.getElementById('last-update').textContent=new Date().toLocaleTimeString();
      renderPriceRow(msg.data);
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
async function loadTemplates() {
  const appTemplates = ['header', 'dashboard', 'prices', 'deals', 'orders', 'brokers', 'mobile-nav'];
  const app = document.getElementById('app');
  for (const t of appTemplates) {
    const res = await fetch(`/templates/${t}.html`);
    app.insertAdjacentHTML('beforeend', await res.text());
  }

  const bodyTemplates = [
    'modals/add-instrument', 'modals/deal-new', 'modals/deal-edit',
    'modals/deal-close', 'modals/order', 'modals/broker', 'modals/alerts'
  ];
  for (const t of bodyTemplates) {
    const res = await fetch(`/templates/${t}.html`);
    document.body.insertAdjacentHTML('beforeend', await res.text());
  }

  const loginRes = await fetch('/templates/login.html');
  document.body.insertAdjacentHTML('afterbegin', await loginRes.text());

  initApp();
}

function initApp() {
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('l-user').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('d-instrument').addEventListener('change', function() {
    const p = prices[this.value]; if (!p) return;
    if (p.mcx)   document.getElementById('d-mcx-price').value   = p.mcx.ask  || p.mcx.ltp  || '';
    if (p.comex) document.getElementById('d-comex-price').value = p.comex.bid || p.comex.ltp || '';
    if (p.dgcx)  document.getElementById('d-dgcx-price').value  = p.dgcx.ltp || '';
    if (p.dgcx && p.dgcx.ltp) document.getElementById('d-dginr').value = (10000 / parseFloat(p.dgcx.ltp)).toFixed(4);
  });
  document.getElementById('o-has-condition').addEventListener('change', toggleOrderCondition);

  if (sessionToken) verifyAndStart();
}

document.addEventListener('DOMContentLoaded', loadTemplates);
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
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('username-display').textContent = currentUser;
  await loadBrokers();
  renderBrokerSummary(); // ← add this
  loadDashboard(); loadDeals(); loadOrders(); connectWS(); initAlerts();
}
async function apiFetch(url, opts={}) {
  opts.headers={...(opts.headers||{}),'x-session-token':sessionToken};
  const res=await fetch(url,opts);
  if (res.status===401) { clearAuth(); location.reload(); }
  return res;
}

