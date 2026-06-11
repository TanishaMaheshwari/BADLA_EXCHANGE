


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
      const b = brokers.find(x =>
        x.instruments?.some(i =>
            i.name.toLowerCase().includes(instrumentName.toLowerCase()) ||
            instrumentName.toLowerCase().includes(i.name.toLowerCase())
        )
    );
    if (b) {
        const matchedInstr = b.instruments?.find(i =>
            i.name.toLowerCase().includes(instrumentName.toLowerCase()) ||
            instrumentName.toLowerCase().includes(i.name.toLowerCase())
        ) || b.instruments?.[0];
        if (matchedInstr) {
            document.getElementById('o-mcx-qty').value   = matchedInstr.maxLots;
            document.getElementById('o-comex-qty').value = matchedInstr.maxLots;
        }
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


