

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