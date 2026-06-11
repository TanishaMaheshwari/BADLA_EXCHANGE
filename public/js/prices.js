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
