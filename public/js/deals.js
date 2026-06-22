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
        <label>MCX qty <span style="color:var(--muted);font-weight:400">/ ${deal.mcx.qty} open</span></label>
        <input type="number" id="c-mcx-qty" placeholder="${deal.mcx.qty}" min="0.01" step="0.01">
      </div>`;
  }
  if (deal.comex?.qty) {
    grid.innerHTML += `
      <div class="form-group">
        <label>COMEX qty <span style="color:var(--muted);font-weight:400">/ ${deal.comex.qty} open</span></label>
        <input type="number" id="c-comex-qty" placeholder="${deal.comex.qty}" min="0.000001" step="0.000001">
      </div>`;
  }
  if (deal.dgcx?.qty) {
    grid.innerHTML += `
      <div class="form-group">
        <label>DGCX qty <span style="color:var(--muted);font-weight:400">/ ${deal.dgcx.qty} open</span></label>
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
  populateLegBrokerSelect('e-mcx-broker',  deal.mcx.brokerId, 'MCX');
  populateLegBrokerSelect('e-comex-broker',deal.comex.brokerId, 'COMEX');
  populateLegBrokerSelect('e-dgcx-broker', deal.dgcx?.brokerId||null, 'DGCX');
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