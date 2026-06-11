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
function badgeClass(type) { const m={GOLD:'gold',SILVER:'silver',CRUDE:'crude',COPPER:'copper',GAS:'gas'}; return 'badge-'+(m[type]||'other'); }
