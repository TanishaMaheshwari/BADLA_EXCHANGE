

// ── Brokers ────────────────────────────────────────────────────────────────
function addInstrumentRow(instr = {}) {
  const list = document.getElementById('broker-instruments-list');
  const div = document.createElement('div');
  div.className = 'instr-row';
  div.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px;position:relative';

  const instrOptions = Object.values(prices).map(p =>
    `<option value="${p.name}" ${instr.name === p.name ? 'selected' : ''}>${p.displayName || p.name}</option>`
  ).join('');

  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <select class="i-name" onchange="onInstrumentRowChange(this)" style="flex:1;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;font-weight:600;margin-right:8px">
        <option value="">Select badla instrument...</option>
        ${instrOptions}
        ${instr.name && !prices[instr.name] ? `<option value="${instr.name}" selected>${instr.name}</option>` : ''}
      </select>
      <input type="number" class="i-maxlots" placeholder="Max lots" value="${instr.maxLots || ''}" min="1"
        style="width:90px;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;margin-right:8px"
        title="Max lots allowed for this instrument">
      <button onclick="this.closest('.instr-row').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:0;line-height:1">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <!-- MCX LEG -->
      <div style="border:1px solid rgba(0,255,136,0.2);border-radius:6px;padding:8px">
        <div style="font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.06em;margin-bottom:6px">MCX LEG</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px">BROKER SYMBOL</div>
            <input type="text" class="i-mcx-symbol" placeholder="e.g. GOLD24JUN" value="${instr.mcxSymbol || ''}"
              style="width:100%;padding:5px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px">
          </div>
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px">1 LOT = QTY</div>
            <input type="number" class="i-mcx-lotqty" placeholder="100" value="${instr.mcxLotQty || ''}" min="0.001" step="0.001"
              style="width:100%;padding:5px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px">
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px">BROKERAGE / LOT (₹)</div>
            <input type="number" class="i-mcx-brok" placeholder="45" value="${instr.mcxBrokerage || ''}" min="0" step="0.01"
              style="width:100%;padding:5px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px">
          </div>
        </div>
      </div>

      <!-- COMEX LEG -->
      <div style="border:1px solid rgba(255,215,0,0.2);border-radius:6px;padding:8px">
        <div style="font-size:10px;font-weight:700;color:var(--gold);letter-spacing:.06em;margin-bottom:6px">COMEX LEG</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px">BROKER SYMBOL</div>
            <input type="text" class="i-comex-symbol" placeholder="e.g. XAUUSD" value="${instr.comexSymbol || ''}"
              style="width:100%;padding:5px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px">
          </div>
          <div>
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px">1 LOT = QTY</div>
            <input type="number" class="i-comex-lotqty" placeholder="1" value="${instr.comexLotQty || ''}" min="0.000001" step="0.000001"
              style="width:100%;padding:5px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px">
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px">BROKERAGE / LOT (₹)</div>
            <input type="number" class="i-comex-brok" placeholder="40" value="${instr.comexBrokerage || ''}" min="0" step="0.01"
              style="width:100%;padding:5px 7px;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px">
          </div>
        </div>
      </div>
    </div>`;

  list.appendChild(div);
}
function getInstrumentsFromModal() {
  return [...document.querySelectorAll('#broker-instruments-list .instr-row')].map(row => ({
    name:          row.querySelector('.i-name').value.trim(),
    maxLots:       parseFloat(row.querySelector('.i-maxlots').value) || 1,
    mcxSymbol:     row.querySelector('.i-mcx-symbol').value.trim()    || null,
    mcxLotQty:     parseFloat(row.querySelector('.i-mcx-lotqty').value) || 1,
    mcxBrokerage:  parseFloat(row.querySelector('.i-mcx-brok').value)   || 0,
    comexSymbol:   row.querySelector('.i-comex-symbol').value.trim()  || null,
    comexLotQty:   parseFloat(row.querySelector('.i-comex-lotqty').value) || 1,
    comexBrokerage:parseFloat(row.querySelector('.i-comex-brok').value)   || 0,
  })).filter(i => i.name);
}
function openBrokerModal() {
  editingBrokerId = null;
  document.getElementById('broker-modal-title').textContent = 'Add broker account';
  document.getElementById('broker-save-btn').textContent = 'Save broker';
  ['b-name','b-account-id','b-password'].forEach(id => document.getElementById(id).value = '');
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
  document.getElementById('b-account-id').value   = b.accountId  || '';
  document.getElementById('b-password').value     = b.password   || '';
  document.getElementById('b-profit-share').value = b.profitShare ?? 0;
  document.getElementById('b-total-pnl').value    = b.totalPnl   ?? 0;

  const list = document.getElementById('broker-instruments-list');
  list.innerHTML = '';

  console.log('Loading broker instruments:', b.instruments); // debug

  if (b.instruments && b.instruments.length > 0) {
    b.instruments.forEach(i => addInstrumentRow(i));
  } else {
    addInstrumentRow();
  }

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
      profitShare: parseFloat(document.getElementById('b-profit-share').value) || 0,
      totalPnl:    parseFloat(document.getElementById('b-total-pnl').value) || 0,
      instruments: getInstrumentsFromModal(),
    };
    if (!body.brokerName) return alert('Broker name is required');
    const url    = editingBrokerId ? `/api/brokers/${editingBrokerId}` : '/api/brokers';
    const method = editingBrokerId ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    await loadBrokers();  // reload fresh from server
    renderBrokers();
    closeBrokerModal();
  } catch(err) { alert('Failed to save broker: ' + err.message); }
  finally { btn.textContent = editingBrokerId ? 'Save changes' : 'Save broker'; btn.disabled = false; }
}
function renderBrokers() {
  const tbody = document.getElementById('brokers-tbody'); if (!tbody) return;
  if (!brokers.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted)">No broker accounts yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = brokers.map(b => {
    const pnlShare = b.totalPnl > 0 ? (b.totalPnl * b.profitShare / 100) : null;
    const instrCount = (b.instruments || []).length;
    return `
    <tr class="broker-row">
      <td style="text-align:left">
        <div style="font-weight:600;font-size:12px">${b.brokerName}</div>
        <div style="font-size:10px;color:var(--muted)">${new Date(b.createdAt).toLocaleDateString()}</div>
      </td>
      <td>${b.accountId ? `<span class="acct-badge">${b.accountId}</span>` : '<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td><span class="profit-badge">${b.profitShare}%</span></td>
      <td style="font-weight:600;color:${b.totalPnl>=0?'var(--accent)':'#e24b4a'}">
        ${b.totalPnl >= 0 ? '₹' : '−₹'}${Math.abs(b.totalPnl).toLocaleString('en-IN')}
      </td>
      <td style="font-weight:600;color:#ef9f27">
        ${pnlShare !== null ? '₹' + pnlShare.toLocaleString('en-IN', {maximumFractionDigits:0}) : '—'}
      </td>
      <td>
        <span class="acct-badge" style="cursor:pointer" onclick="openEditBrokerModal(${b.id})" title="Click to manage">
          ${instrCount} instrument${instrCount!==1?'s':''}
        </span>
      </td>
      <td class="broker-hide-tablet">
        <span class="pass-hidden">${b.password ? '••••••••' : '—'}</span>
        ${b.password ? `<button onclick="togglePass(${b.id})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:10px;margin-left:4px" id="passToggle-${b.id}">show</button>
        <span id="passText-${b.id}" style="display:none;font-size:11px;color:var(--accent)">${b.password}</span>` : ''}
      </td>
      <td>
        <button class="btn btn-sm" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);margin-right:4px" onclick="openEditBrokerModal(${b.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBroker(${b.id})">✕</button>
      </td>
    </tr>`;
  }).join('');
  renderBrokerSummary();
}
function renderBrokerSummary() {
  const summary = document.getElementById('broker-summary'); if (!summary) return;
  const totalPnl   = brokers.reduce((s, b) => s + (b.totalPnl || 0), 0);
  const totalShare = brokers.reduce((s, b) => s + (b.totalPnl > 0 ? b.totalPnl * b.profitShare / 100 : 0), 0);
  const avgShare   = brokers.length ? brokers.reduce((s, b) => s + b.profitShare, 0) / brokers.length : 0;
  summary.innerHTML = `
    <div class="pnl-card"><div class="pnl-label">Total Brokers</div><div class="pnl-value">${brokers.length}</div></div>
    <div class="pnl-card"><div class="pnl-label">Total P&L</div><div class="pnl-value" style="color:${totalPnl>=0?'var(--accent)':'#e24b4a'};font-size:16px">
      ${totalPnl>=0?'₹':'−₹'}${Math.abs(totalPnl).toLocaleString('en-IN')}</div></div>
    <div class="pnl-card"><div class="pnl-label">P&L × Profit share</div><div class="pnl-value" style="color:#ef9f27;font-size:16px">₹${totalShare.toLocaleString('en-IN',{maximumFractionDigits:0})}</div></div>
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
