


// ── ORDER MODAL ────────────────────────────────────────────────────────────
function openOrderModal(instrumentName) {
  orderModalInstrument = instrumentName;
  populateInstrumentSelect('o-instrument');
  populateLegBrokerSelect('o-mcx-broker', null, 'MCX');
  populateLegBrokerSelect('o-comex-broker', null, 'COMEX');
  populateLegBrokerSelect('o-dgcx-broker', null, 'DGCX');
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
  const brokerName = id => {
    if (!id) return null;
    const b = brokers.find(x => x.id === parseInt(id));
    return b?.brokerName || b?.name || null;
  };

  const legs = [
    o.mcx_side ? { exchange: 'MCX', side: o.mcx_side, qty: o.mcx_qty, brokerId: o.mcx_broker_id } : null,
    o.comex_side ? { exchange: 'COMEX', side: o.comex_side, qty: o.comex_qty, brokerId: o.comex_broker_id } : null,
    o.dgcx_enabled && o.dgcx_side ? { exchange: 'DGCX', side: o.dgcx_side, qty: o.dgcx_qty, brokerId: o.dgcx_broker_id } : null,
  ].filter(Boolean);

  const legChips = legs.map(leg => {
    const bn = brokerName(leg.brokerId);
    const arrow = leg.side === 'BUY' ? 'ti-arrow-up' : 'ti-arrow-down';
    return `<span class="order-leg-chip ${leg.side.toLowerCase()}">
      <i class="ti ${arrow}" aria-hidden="true" style="font-size:12px;"></i>
      ${leg.exchange} ${leg.side} ${leg.qty} lots
      ${bn ? `<span class="leg-broker">· ${bn}</span>` : ''}
    </span>`;
  }).join('');

  const condTag = o.has_condition
    ? `<div class="condition-row">
        <i class="ti ti-bolt" aria-hidden="true"></i>
        <span>When <strong>${o.condition_field}</strong> 
        ${o.condition_dir?.includes('above') || o.condition_dir === '>=' ? '&ge;' : '&le;'}
        <strong>${Number(o.condition_value).toLocaleString()}</strong></span>
       </div>`
    : `<div class="immediate-tag">
        <i class="ti ti-bolt" aria-hidden="true" style="font-size:13px;"></i> Immediate execution
       </div>`;

  const tlStep = (label, time) => `
    <div class="tl-row">
      <div class="tl-dot ${time ? 'done' : 'empty'}"></div>
      <span class="tl-label">${label}</span>
      <span class="tl-time">${time ? new Date(time).toLocaleString() : '—'}</span>
    </div>`;

  const eaWarning = o.status === 'pending'
    ? `<div class="ea-warning">
        <i class="ti ti-alert-triangle" aria-hidden="true" style="font-size:13px;"></i>
        EA not checked — run preflight before condition triggers
       </div>`
    : '';

  const mt5Error = o.mt5_result
    ? `<div class="mt5-result">
        <i class="ti ti-alert-circle" aria-hidden="true" style="font-size:12px;margin-right:4px;"></i>
        ${o.mt5_result}
       </div>`
    : '';

  const cancelBtn = o.status === 'pending'
    ? `<div class="order-actions">
        <button class="btn-cancel" onclick="cancelOrder(${o.id})">
          <i class="ti ti-x" aria-hidden="true" style="font-size:12px;"></i> Cancel order
        </button>
       </div>`
    : '';

  return `
    <div class="order-card status-${o.status}">
      <div class="card-top">
        <div style="min-width:0;">
          <div class="instrument">
            ${o.instrument}
            ${o.note ? `<span class="note">· ${o.note}</span>` : ''}
          </div>
          <div class="legs">${legChips}</div>
        </div>
        <span class="order-status-pill ${o.status}">${statusLabel(o.status)}</span>
      </div>

      <div class="order-divider"></div>

      ${condTag}
      ${eaWarning}
      ${mt5Error}

      <div class="timeline">
        ${tlStep('Created',     o.created_at)}
        ${tlStep('Triggered',   o.triggered_at)}
        ${tlStep('Sent to MT5', o.sent_to_mt5_at)}
        ${tlStep('Confirmed',   o.mt5_confirmed_at)}
      </div>

      ${cancelBtn}
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


