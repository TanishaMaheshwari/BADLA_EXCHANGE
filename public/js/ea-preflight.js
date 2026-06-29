// ═══════════════════════════════════════════════════════════════════════════
// EA PREFLIGHT CHECK — JavaScript
// ═══════════════════════════════════════════════════════════════════════════

const EA_VALID_MS    = 5 * 60 * 1000;
let eaCheckData      = null;
let eaCheckedAt      = 0;
let eaAutoInterval   = null;
let eaValidityTimer  = null;
let currentDealId    = null;

function setActiveDeal(dealId) {
  currentDealId = dealId;
  refreshCommitButton();
}

async function checkEAs() {
  const btn  = document.getElementById('btn-check-eas');
  const icon = document.getElementById('check-icon');
  btn.disabled = true;
  btn.classList.add('checking');
  icon.textContent = '…';

  try {
    const body = currentDealId ? { dealId: currentDealId } : {};
    const data = await apiPost('/api/ea/check', body);
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

function toggleAutoRecheck(enabled) {
  if (eaAutoInterval) { clearInterval(eaAutoInterval); eaAutoInterval = null; }
  if (enabled) {
    eaAutoInterval = setInterval(() => {
      if (Date.now() - eaCheckedAt < 29_000) return;
      checkEAs();
    }, 30_000);
  }
}

let _autoOn = false;

function toggleAutoToggle() {
  _autoOn = !_autoOn;

  // update visual
  document.getElementById('auto-tog').style.background = _autoOn ? '#1D9E75' : 'var(--border,#1e2530)';
  document.getElementById('auto-tog-knob').style.left = _autoOn ? '17px' : '3px';

  // actually start/stop the interval
  if (_autoOn) {
    eaAutoInterval = setInterval(() => {
      if (Date.now() - eaCheckedAt < 29_000) return;
      checkEAs();
    }, 30_000);
  } else {
    if (eaAutoInterval) {
      clearInterval(eaAutoInterval);
      eaAutoInterval = null;
    }
  }
}

// ── Render panel — desktop table + mobile tabs ───────────────────────────
function renderEAPanel(data) {
  if (!data.eas || data.eas.length === 0) {
    document.getElementById('ea-desktop-body').innerHTML = `
      <tr><td colspan="8" style="padding:16px;color:var(--color-danger,#e24a4a);font-size:12px;">
        No EAs connected — check MT5 terminals
      </td></tr>`;
    document.getElementById('ea-mobile-tabs').innerHTML = '';
    document.getElementById('ea-mobile-panels').innerHTML = `
      <div style="font-size:12px;color:var(--color-danger,#e24a4a);padding:8px 0;">
        No EAs connected — check MT5 terminals
      </div>`;
    setOverallStatus('none', 'No EAs connected');
    return;
  }

  renderDesktopTable(data);
  renderMobileTabs(data);

  if (data.dealValidation) renderDealValidation(data.dealValidation);

  const allReady = data.eas.every(e => e.status === 'ready');
  const anyReady = data.eas.some(e => e.status === 'ready');
  if (allReady)      setOverallStatus('all-ready', `All ${data.eas.length} EAs ready`);
  else if (anyReady) setOverallStatus('partial',   'Some EAs not ready — check above');
  else               setOverallStatus('none',       'No EAs ready');

  refreshCommitButton();
}

// ── Desktop: table rows ──────────────────────────────────────────────────
function renderDesktopTable(data) {
  const tbody = document.getElementById('ea-desktop-body');
  if (!tbody) return;

  tbody.innerHTML = data.eas.map(ea => {
    const headroomPct  = ea.lotMax > 0 ? Math.round(ea.lotHeadroom / ea.lotMax * 100) : 0;
    const lotClass     = headroomPct > 50 ? 'ok' : headroomPct > 20 ? 'warn' : 'bad';
    const lotColor     = headroomPct > 50 ? '#639922' : headroomPct > 20 ? '#BA7517' : '#E24B4A';
    const statusClass  = ea.status === 'ready' ? 'ready' : ea.status === 'degraded' ? 'degraded' : 'offline';
    const lastSeenAgo  = ea.lastSeen ? Math.round((Date.now() - ea.lastSeen) / 1000) : null;
    const seenClass    = lastSeenAgo === null ? '' : lastSeenAgo > 60 ? 'bad' : lastSeenAgo > 10 ? 'warn' : 'ok';

    return `
    <tr>
      <td style="font-weight:500;">${ea.brokerName || '—'}</td>
      <td><span class="ea-acct-mono">${ea.accountId}</span></td>
      <td><span class="ea-badge ea-badge-${statusClass}">${ea.status.toUpperCase()}</span></td>
      <td>
        <span class="ea-val ${ea.symbolValid ? 'ok' : 'bad'}">
          ${ea.symbolValid ? '<i class="ti ti-check"></i>' : '<i class="ti ti-x"></i>'}
          ${ea.symbol || '—'}
        </span>
      </td>
      <td><span class="ea-val ${ea.marketOpen ? 'ok' : 'warn'}">${ea.marketOpen ? 'Open' : 'Closed'}</span></td>
      <td>
        <div style="font-size:12px;margin-bottom:3px;">${ea.lotUsed} / ${ea.lotMax}</div>
        <div class="ea-lot-track"><div class="ea-lot-fill" style="width:${headroomPct}%;background:${lotColor};"></div></div>
      </td>
      <td><span class="ea-val ${lotClass}">${ea.lotHeadroom} lots</span></td>
      <td><span class="ea-val ${seenClass}">${lastSeenAgo !== null ? lastSeenAgo + 's ago' : '—'}</span></td>
    </tr>`;
  }).join('');
}

// ── Mobile: tab bar + cards ──────────────────────────────────────────────
function renderMobileTabs(data) {
  const tabBar    = document.getElementById('ea-mobile-tabs');
  const panelWrap = document.getElementById('ea-mobile-panels');
  if (!tabBar || !panelWrap) return;

  tabBar.innerHTML = data.eas.map((ea, i) => `
    <button class="ea-tab-btn${i === 0 ? ' active' : ''}" onclick="switchEATab(${i})">
      ${ea.brokerName || ea.accountId}
    </button>`).join('');

  panelWrap.innerHTML = data.eas.map((ea, i) => {
    const headroomPct = ea.lotMax > 0 ? Math.round(ea.lotHeadroom / ea.lotMax * 100) : 0;
    const lotColor    = headroomPct > 50 ? '#639922' : headroomPct > 20 ? '#BA7517' : '#E24B4A';
    const statusClass = ea.status === 'ready' ? 'ready' : ea.status === 'degraded' ? 'degraded' : 'offline';
    const lastSeenAgo = ea.lastSeen ? Math.round((Date.now() - ea.lastSeen) / 1000) : null;
    const seenClass   = lastSeenAgo === null ? '' : lastSeenAgo > 60 ? 'bad' : lastSeenAgo > 10 ? 'warn' : 'ok';

    return `
    <div class="ea-tab-panel${i === 0 ? ' active' : ''}">
      <div class="ea-mob-card ${statusClass}">
        <div class="ea-mob-header">
          <div>
            <div class="ea-mob-name">${ea.brokerName || '—'}</div>
            <div class="ea-mob-acct">#${ea.accountId}</div>
          </div>
          <span class="ea-badge ea-badge-${statusClass}">${ea.status.toUpperCase()}</span>
        </div>
        <div class="ea-mob-rows">
          <div class="ea-mob-row">
            <span class="lbl">Symbol</span>
            <span class="val ${ea.symbolValid ? 'ok' : 'bad'}">
              ${ea.symbolValid ? '<i class="ti ti-check"></i>' : '<i class="ti ti-x"></i>'}
              ${ea.symbol || '—'}
            </span>
          </div>
          <div class="ea-mob-row">
            <span class="lbl">Market</span>
            <span class="val ${ea.marketOpen ? 'ok' : 'warn'}">${ea.marketOpen ? 'Open' : 'Closed'}</span>
          </div>
          <div class="ea-mob-row">
            <span class="lbl">Lots used</span>
            <span class="val">${ea.lotUsed} / ${ea.lotMax}</span>
          </div>
          <div class="ea-mob-row">
            <span class="lbl">Headroom</span>
            <span class="val ${headroomPct > 50 ? 'ok' : headroomPct > 20 ? 'warn' : 'bad'}">${ea.lotHeadroom} lots free</span>
          </div>
          <div class="ea-lot-track" style="margin:4px 0 6px;">
            <div class="ea-lot-fill" style="width:${headroomPct}%;background:${lotColor};"></div>
          </div>
          ${lastSeenAgo !== null ? `
          <div class="ea-mob-row">
            <span class="lbl">Last seen</span>
            <span class="val ${seenClass}">${lastSeenAgo}s ago</span>
          </div>` : ''}
          ${ea.error ? `
          <div class="ea-mob-row" style="margin-top:6px;padding-top:6px;border-top:0.5px solid var(--color-border-tertiary);">
            <span class="val bad" style="font-size:11px;">${ea.error}</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function switchEATab(idx) {
  document.querySelectorAll('.ea-tab-btn').forEach((b, i) =>
    b.className = 'ea-tab-btn' + (i === idx ? ' active' : ''));
  document.querySelectorAll('.ea-tab-panel').forEach((p, i) =>
    p.className = 'ea-tab-panel' + (i === idx ? ' active' : ''));
}

// ── Deal validation overlay ──────────────────────────────────────────────
function renderDealValidation(legs) {
  legs.forEach(leg => {
    document.querySelectorAll('.ea-mob-rows').forEach(rows => {
      const name = rows.closest('.ea-mob-card')?.querySelector('.ea-mob-name')?.textContent || '';
      if (name.includes(leg.exchange)) {
        const row = document.createElement('div');
        row.className = 'ea-mob-row';
        row.style.cssText = 'margin-top:8px;padding-top:8px;border-top:0.5px solid var(--color-border-tertiary);';
        row.innerHTML = `
          <span class="lbl">For this deal</span>
          <span class="val ${leg.ok ? 'ok' : 'bad'}">${leg.ok ? '✓ ' + leg.qty + ' lots' : leg.reason}</span>`;
        rows.appendChild(row);
      }
    });
  });
}

// ── Overall status ───────────────────────────────────────────────────────
function setOverallStatus(state, text) {
  const dot  = document.getElementById('ea-overall-dot');
  const span = document.getElementById('ea-overall-text');
  dot.className = 'ea-status-dot';
  if (state === 'all-ready') {
    dot.classList.add('dot-ready');
    span.innerHTML = `<strong>All clear</strong> — ${text}. Ready to commit.`;
  } else if (state === 'partial') {
    dot.classList.add('dot-partial');
    span.innerHTML = `<strong>Not ready</strong> — ${text}`;
  } else {
    dot.classList.add('dot-none');
    span.textContent = text;
  }
}

// ── Commit button gate ───────────────────────────────────────────────────
function refreshCommitButton() {
  const btn     = document.getElementById('btn-commit-deal');
  const now     = Date.now();
  const isValid = eaCheckedAt > 0 && (now - eaCheckedAt) < EA_VALID_MS;
  const allReady = eaCheckData?.allReady && isValid;
  const hasDeal  = !!currentDealId;
  const dealOk   = eaCheckData?.dealValidation
    ? eaCheckData.dealValidation.every(l => l.ok)
    : allReady;
  const armed = allReady && hasDeal && dealOk;
  btn.disabled = !armed;
  btn.className = 'btn-commit ' + (armed ? 'armed' : 'locked');
  btn.textContent = armed ? '⚡ Place Trade' : 'Place Trade';
}

// ── Validity countdown ───────────────────────────────────────────────────
function startValidityCountdown() {
  if (eaValidityTimer) clearInterval(eaValidityTimer);
  const bar   = document.getElementById('ea-validity-bar');
  const fill  = document.getElementById('validity-fill');
  const label = document.getElementById('validity-label');
  bar.style.display = 'flex';

  eaValidityTimer = setInterval(() => {
    const elapsed   = Date.now() - eaCheckedAt;
    const remaining = EA_VALID_MS - elapsed;

    if (remaining <= 0) {
      clearInterval(eaValidityTimer);
      fill.style.width = '0%';
      fill.style.background = '#E24B4A';
      label.textContent = 'EXPIRED';
      label.className = 'validity-label expired';
      setOverallStatus('none', 'Preflight expired — run Check EAs again');
      refreshCommitButton();
      if (document.getElementById('ea-auto-recheck').checked) checkEAs();
      return;
    }

    const pct  = (remaining / EA_VALID_MS) * 100;
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);

    fill.style.width = pct + '%';
    fill.style.background = pct > 40 ? '#378ADD' : pct > 15 ? '#EF9F27' : '#E24B4A';
    label.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    label.className = 'validity-label' + (pct < 15 ? ' warning' : '');

    refreshCommitButton();
  }, 1000);
}

// ── Error state ──────────────────────────────────────────────────────────
function showEAError(msg) {
  document.getElementById('ea-desktop-body').innerHTML = `
    <tr><td colspan="8" style="padding:16px;color:var(--color-danger,#e24a4a);font-size:12px;">⚠ ${msg}</td></tr>`;
  document.getElementById('ea-mobile-panels').innerHTML = `
    <div style="font-size:12px;color:var(--color-danger,#e24a4a);padding:8px 0;">⚠ ${msg}</div>`;
  setOverallStatus('none', msg);
}

// ── WebSocket handler ────────────────────────────────────────────────────
function handleEAWebSocketMessage(data) {
  if (data.type === 'ea_status_update') {
    if (!eaCheckData) return;
    if (!eaCheckData.eas) eaCheckData.eas = [];
    const idx = eaCheckData.eas.findIndex(e => e.accountId === data.ea.accountId);
    if (idx >= 0) eaCheckData.eas[idx] = data.ea;
    else eaCheckData.eas.push(data.ea);
    renderEAPanel(eaCheckData);
  }
  if (data.type === 'commit_success') showCommitResult(true, data);
  if (data.type === 'commit_failure') showCommitResult(false, data);
  if (data.type === 'commit_timeout') {
    showCommitResult(false, { message: data.message, failedLegs: data.missing.map(e => ({ exchange: e })) });
  }
}

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

// ── Commit result ────────────────────────────────────────────────────────
function showCommitResult(success, data) {
  const btn = document.getElementById('btn-commit-deal');
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = success ? 'sine' : 'square';
    osc.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.4 : 1.2));
    osc.start(); osc.stop(ctx.currentTime + (success ? 0.4 : 1.2));
  } catch (e) {}

  if (success) {
    btn.textContent = '✓ Placed';
    btn.style.background = '#1a3a20';
    btn.style.color = '#2aba7a';
    showNotification('success', `✓ Deal ${currentDealId} placed on all legs`,
      data.legs?.map(l => `${l.exchange} ticket #${l.ticket}`).join(' · ') || '');
    setTimeout(() => {
      currentDealId = null;
      btn.textContent = 'Place Trade';
      btn.style.background = '';
      btn.style.color = '';
      refreshCommitButton();
    }, 5000);
  } else {
    btn.textContent = '⚠ Failed';
    btn.style.background = '#3a1a1a';
    btn.style.color = '#e24a4a';
    showNotification('error', `⚠ All-or-none violation — deal ${currentDealId}`,
      data.message || '', data.failedLegs);
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '⚡ Place Trade';
      btn.style.background = '';
      btn.style.color = '';
      refreshCommitButton();
    }, 6000);
  }
}

function showNotification(type, title, subtitle, failedLegs) {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;top:20px;right:20px;width:360px;
    background:${type === 'success' ? '#0d1f14' : '#1f0d0d'};
    border:1px solid ${type === 'success' ? '#2a5a30' : '#5a2a2a'};
    border-radius:10px;padding:16px 18px;
    box-shadow:0 8px 24px rgba(0,0,0,0.4);
    z-index:99999;font-family:monospace;font-size:12px;
    color:${type === 'success' ? '#2aba7a' : '#e24a4a'};`;
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">${title}</div>
    ${subtitle ? `<div style="color:#7a8299;font-size:11px;">${subtitle}</div>` : ''}
    ${failedLegs?.length ? `
      <div style="margin-top:8px;color:#e24a4a;font-size:11px;">
        Failed: ${failedLegs.map(l => l.exchange + (l.error ? ` (${l.error})` : '')).join(', ')}
      </div>
      <div style="margin-top:4px;color:#e2a44a;font-size:11px;">Reversal orders sent to successful legs.</div>` : ''}
    <div style="margin-top:10px;text-align:right;">
      <button onclick="this.parentElement.parentElement.remove()"
        style="background:none;border:1px solid #333;color:#666;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;">
        Dismiss
      </button>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), type === 'success' ? 8000 : 30000);
}