

// ── Brokers ────────────────────────────────────────────────────────────────
function renderBrokers() {
  const tbody = document.getElementById('brokers-tbody'); if (!tbody) return;
  if (!brokers.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">No broker accounts yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = brokers.map(b => {
    const pnlShare = b.totalPnl * b.profitShare / 100;
    const instrCount = (b.instruments || []).length;
    const exchClass = (b.exchangeType || 'MCX').toLowerCase();
    const isExpanded = expandedBrokerId === b.id;
    return `
    <tr class="broker-row" style="cursor:pointer" onclick="toggleBrokerExpand(${b.id}, event)">
      <td style="text-align:left">
        <div style="font-weight:600;font-size:12px">${b.brokerName}</div>
        <div style="font-size:10px;color:var(--muted)">${new Date(b.createdAt).toLocaleDateString()}</div>
      </td>
      <td>${b.accountId ? `<span class="acct-badge">${b.accountId}</span>` : '<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td><span class="exchange-badge ${exchClass}">${b.exchangeType || 'MCX'}</span></td>
      <td><span class="profit-badge">${b.profitShare}%</span></td>
      <td style="font-weight:600;color:${b.totalPnl>=0?'var(--accent)':'#e24b4a'}">
        ${b.totalPnl >= 0 ? '₹' : '−₹'}${Math.abs(b.totalPnl).toLocaleString('en-IN')}
      </td>
     <td style="font-weight:600;color:${pnlShare>=0?'var(--accent)':'#e24b4a'}">
        ${pnlShare >= 0 ? '₹' : '−₹'}${Math.abs(pnlShare).toLocaleString('en-IN', {maximumFractionDigits:0})}
      </td>
      <td>
        <span class="acct-badge">${instrCount} instrument${instrCount!==1?'s':''} ${isExpanded ? '▲' : '▼'}</span>
      </td>
      <td class="broker-hide-tablet">
        <span class="pass-hidden">${b.password ? '••••••••' : '—'}</span>
        ${b.password ? `<button onclick="event.stopPropagation(); togglePass(${b.id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:10px;margin-left:4px" id="passToggle-${b.id}">show</button>
        <span id="passText-${b.id}" style="display:none;font-size:11px;color:var(--accent)">${b.password}</span>` : ''}
      </td>
      <td>
        <button class="btn btn-sm" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);margin-right:4px" onclick="event.stopPropagation(); openEditBrokerModal(${b.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteBroker(${b.id})">✕</button>
      </td>
    </tr>
    ${isExpanded ? `
    <tr>
      <td colspan="9" style="padding:0">
        ${renderBrokerExpandPanel(b)}
      </td>
    </tr>` : ''}`;
  }).join('');
  renderBrokerSummary();
}

function renderBrokerSummary() {
  const summary = document.getElementById('broker-summary'); if (!summary) return;
  const totalPnl   = brokers.reduce((s, b) => s + (b.totalPnl || 0), 0);
  const totalShare = brokers.reduce((s, b) => s + (b.totalPnl * b.profitShare / 100), 0);  // ← removed > 0 guard
  const avgShare   = brokers.length ? brokers.reduce((s, b) => s + b.profitShare, 0) / brokers.length : 0;
  summary.innerHTML = `
    <div class="pnl-card"><div class="pnl-label">Total Brokers</div><div class="pnl-value">${brokers.length}</div></div>
    <div class="pnl-card"><div class="pnl-label">Total P&L</div><div class="pnl-value" style="color:${totalPnl>=0?'var(--accent)':'#e24b4a'};font-size:16px">
      ${totalPnl>=0?'₹':'−₹'}${Math.abs(totalPnl).toLocaleString('en-IN')}</div></div>
    <div class="pnl-card"><div class="pnl-label">P&L × Profit share</div><div class="pnl-value" style="color:${totalShare>=0?'#ef9f27':'#e24b4a'};font-size:16px">
      ${totalShare>=0?'₹':'−₹'}${Math.abs(totalShare).toLocaleString('en-IN',{maximumFractionDigits:0})}</div></div>
    <div class="pnl-card"><div class="pnl-label">Avg Profit Share</div><div class="pnl-value" style="font-size:16px">${avgShare.toFixed(1)}%</div></div>`;
}
async function loadBrokers() {
  const res=await apiFetch('/api/brokers'); brokers=await res.json();
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

let brokerSortField = null;
let brokerSortDir = 'asc';

function sortBrokers(field) {
  if (brokerSortField === field) {
    brokerSortDir = brokerSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    brokerSortField = field;
    brokerSortDir = 'asc';
  }

  brokers.sort((a, b) => {
    let va, vb;
    if (field === 'pnlShare') {
      va = a.totalPnl > 0 ? a.totalPnl * a.profitShare / 100 : 0;
      vb = b.totalPnl > 0 ? b.totalPnl * b.profitShare / 100 : 0;
    } else {
      va = a[field];
      vb = b[field];
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return brokerSortDir === 'asc' ? -1 : 1;
    if (va > vb) return brokerSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  document.querySelectorAll('.sort-arrow').forEach(el => el.classList.remove('asc', 'desc'));
  const arrow = document.getElementById('sort-' + field);
  if (arrow) arrow.classList.add(brokerSortDir);

  renderBrokers();
}

function openBrokerModal() {
  editingBrokerId = null;
  document.getElementById('broker-modal-title').textContent = 'Add broker account';
  document.getElementById('broker-save-btn').textContent = 'Save broker';
  ['b-name','b-account-id','b-password'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('b-exchange-type').value = 'MCX';
  document.getElementById('b-profit-share').value = '0';
  document.getElementById('b-total-pnl').value = '0';
  document.getElementById('broker-instruments-list').innerHTML = '';
  addInstrumentRow();
  document.getElementById('broker-modal').classList.add('open');
}

function openEditBrokerModal(id) {
  const b = brokers.find(x => x.id === parseInt(id));
  if (!b) { console.error('Broker not found:', id, brokers); return; }

  editingBrokerId = parseInt(id);
  document.getElementById('broker-modal-title').textContent = 'Edit broker account';
  document.getElementById('broker-save-btn').textContent = 'Save changes';
  document.getElementById('b-name').value         = b.brokerName || '';
  document.getElementById('b-exchange-type').value = b.exchangeType || 'MCX';
  document.getElementById('b-account-id').value   = b.accountId  || '';
  document.getElementById('b-password').value     = b.password   || '';
  document.getElementById('b-profit-share').value = b.profitShare ?? 0;
  document.getElementById('b-total-pnl').value    = b.totalPnl   ?? 0;

  const list = document.getElementById('broker-instruments-list');
  list.innerHTML = '';

  if (b.instruments && b.instruments.length > 0) {
    b.instruments.forEach(i => addInstrumentRow(i));
  } else {
    addInstrumentRow();
  }

  document.getElementById('broker-modal').classList.add('open');
}

// New single-leg instrument row
function addInstrumentRow(instr = {}) {
  const list = document.getElementById('broker-instruments-list');
  const div = document.createElement('div');
  div.className = 'instr-row';
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1.3fr 0.9fr 1fr 0.9fr auto;gap:8px;align-items:center;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px';

  const instrOptions = Object.values(prices).map(p =>
    `<option value="${p.name}" ${instr.name === p.name ? 'selected' : ''}>${p.displayName || p.name}</option>`
  ).join('');

  div.innerHTML = `
    <select class="i-name" style="padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px">
      <option value="">Select instrument...</option>
      ${instrOptions}
      ${instr.name && !prices[instr.name] ? `<option value="${instr.name}" selected>${instr.name}</option>` : ''}
    </select>

    <input type="text" class="i-symbol" placeholder="Broker symbol e.g. GOLD24JUN" value="${instr.brokerSymbol || ''}"
      style="padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px">

    <input type="number" class="i-lotqty" placeholder="Lot qty" value="${instr.lotQty || ''}" min="0.001" step="0.001"
      style="padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px"
      title="1 lot = this quantity">

    <input type="number" class="i-brokerage" placeholder="₹/lot" value="${instr.brokerage || ''}" min="0" step="0.01"
      style="padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px"
      title="Brokerage per lot">

    <input type="number" class="i-maxlots" placeholder="Max lots" value="${instr.maxLots || ''}" min="1"
      style="padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px"
      title="Volume limit for this instrument">

    <button onclick="this.closest('.instr-row').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0">✕</button>
  `;

  list.appendChild(div);
}

function getInstrumentsFromModal() {
  return [...document.querySelectorAll('#broker-instruments-list .instr-row')].map(row => ({
    name:          row.querySelector('.i-name').value.trim(),
    brokerSymbol:  row.querySelector('.i-symbol').value.trim()    || null,
    lotQty:        parseFloat(row.querySelector('.i-lotqty').value) || 1,
    brokerage:     parseFloat(row.querySelector('.i-brokerage').value) || 0,
    maxLots:       parseFloat(row.querySelector('.i-maxlots').value) || 1,
  })).filter(i => i.name);
}

async function saveBroker() {
  const btn = document.getElementById('broker-save-btn');
  try {
    btn.textContent = 'Saving...'; btn.disabled = true;
    const body = {
      brokerName:   document.getElementById('b-name').value.trim(),
      exchangeType: document.getElementById('b-exchange-type').value,
      accountId:    document.getElementById('b-account-id').value.trim() || null,
      password:     document.getElementById('b-password').value || null,
      profitShare:  parseFloat(document.getElementById('b-profit-share').value) || 0,
      totalPnl:     parseFloat(document.getElementById('b-total-pnl').value) || 0,
      instruments:  getInstrumentsFromModal(),
    };
    if (!body.brokerName) return alert('Broker name is required');
    const url    = editingBrokerId ? `/api/brokers/${editingBrokerId}` : '/api/brokers';
    const method = editingBrokerId ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    await loadBrokers();
    renderBrokers();
    closeBrokerModal();
  } catch(err) { alert('Failed to save broker: ' + err.message); }
  finally { btn.textContent = editingBrokerId ? 'Save changes' : 'Save broker'; btn.disabled = false; }
}

let expandedBrokerId = null;

function toggleBrokerExpand(id, event) {
  // Don't toggle if clicking Edit/Delete buttons
  if (event.target.closest('button')) return;

  expandedBrokerId = (expandedBrokerId === id) ? null : id;
  renderBrokers();
}

function renderBrokerExpandPanel(b) {
  const instruments = b.instruments || [];
  if (instruments.length === 0) {
    return `<div style="padding:14px 18px;color:var(--muted);font-size:11px">No instruments configured for this broker.</div>`;
  }
  return `
    <div style="padding:12px 18px;background:var(--surface2);border-top:1px solid var(--border)">
      ${instruments.map(i => `
        <div style="display:grid;grid-template-columns:2fr 1.3fr 0.9fr 1fr 0.9fr 1.1fr;gap:10px;align-items:center;
          padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:11px;font-weight:600;color:var(--text)">${i.name}</div>
          <div style="font-size:11px;color:var(--muted)">${i.brokerSymbol || '—'}</div>
          <div style="font-size:11px;color:var(--muted)">₹${i.totalPnl?.toLocaleString('en-IN') || 0}</div>
          <div style="font-size:11px;color:var(--muted)">${i.lotQty || '—'} qty/lot</div>
          <div style="font-size:11px;color:var(--muted)">₹${i.brokerage || 0}/lot</div>
          <div style="font-size:11px;color:var(--muted)">${i.maxLots || '—'} max</div>
        </div>
      `).join('')}
    </div>`;
}

async function saveInstrumentPnl(inputEl) {
  const brokerId = inputEl.dataset.brokerId;
  const instrName = inputEl.dataset.instr;
  const value = parseFloat(inputEl.value) || 0;

  try {
    await apiFetch(`/api/brokers/${brokerId}/instruments/pnl`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrumentName: instrName, totalPnl: value })
    });
    // update in-memory cache so it persists across re-render
    const b = brokers.find(x => x.id === parseInt(brokerId));
    const instr = b?.instruments?.find(i => i.name === instrName);
    if (instr) instr.totalPnl = value;
    showToast('Saved', `${instrName} P&L updated to ₹${value.toLocaleString('en-IN')}`, 'info', 2000);
  } catch(e) {
    alert('Failed to save P&L: ' + e.message);
  }
}