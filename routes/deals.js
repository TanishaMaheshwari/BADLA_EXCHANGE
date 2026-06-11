const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');

// ─── Deals FUNCTIONS ────────────────────────────────────────────────────────────────────
function dealToFrontend(d) {
  return {
    id: d.id, instrument: d.instrument, qty: d.qty, note: d.note,
    usdInrRate: d.usd_inr_rate, dginrAtEntry: d.dginr_at_entry,
    status: d.status, entryTime: d.entry_time, exitTime: d.exit_time,
    totalPnl: d.total_pnl, parentDealId: d.parent_deal_id || null,
    mcx: {
      side: d.mcx_side, entryPrice: d.mcx_price,
      qty: d.mcx_qty||d.qty, brokerage: d.mcx_brokerage,
      exitPrice: d.mcx_exit_price, pnl: d.mcx_pnl,
      brokerId: d.mcx_broker_id||null,
    },
    comex: {
      side: d.comex_side, entryPrice: d.comex_price,
      qty: d.comex_qty||d.qty, brokerage: d.comex_brokerage,
      exitPrice: d.comex_exit_price, pnl: d.comex_pnl,
      brokerId: d.comex_broker_id||null,
    },
    dgcx: d.dgcx_enabled ? {
      side: d.dgcx_side, entryPrice: d.dgcx_price,
      qty: d.dgcx_qty||d.qty, brokerage: d.dgcx_brokerage,
      exitPrice: d.dgcx_exit_price, pnl: d.dgcx_pnl,
      brokerId: d.dgcx_broker_id||null,
    } : null,
  };
}

// ─── Helper: recalculate raw P&L for a closed deal row ───────────────────────
function recalcClosedPnl(d) {
  const rate = d.usd_inr_rate || 89;

  const mcxQty   = d.mcx_qty   || d.qty || 1;
  const comexQty = d.comex_qty || d.qty || 1;

  // FIX 7: Use stored (already-proportional) brokerage directly — do NOT
  // re-apply a ratio here. The child deal already has the correct partial
  // brokerage stored; recalcClosedPnl is only called on the deal as-stored.
  const mcxPnl = d.mcx_exit_price != null
    ? (d.mcx_side === 'SELL'
        ? (d.mcx_price   - d.mcx_exit_price)
        : (d.mcx_exit_price - d.mcx_price))   * mcxQty   - (d.mcx_brokerage   || 0)
    : 0;

  const comexPnl = d.comex_exit_price != null
    ? (d.comex_side === 'SELL'
        ? (d.comex_price - d.comex_exit_price)
        : (d.comex_exit_price - d.comex_price)) * comexQty * rate - (d.comex_brokerage || 0)
    : 0;

  let dgcxPnl = 0;
  if (d.dgcx_enabled && d.dgcx_exit_price != null) {
    const dgcxQty = d.dgcx_qty || d.qty || 1;
    dgcxPnl = (d.dgcx_side === 'SELL'
      ? (d.dgcx_price - d.dgcx_exit_price)
      : (d.dgcx_exit_price - d.dgcx_price)) * dgcxQty * rate - (d.dgcx_brokerage || 0);
  }

  return { mcxPnl, comexPnl, dgcxPnl, totalPnl: mcxPnl + comexPnl + dgcxPnl };
}

// ─── Deals ROUTES ────────────────────────────────────────────────────────────────────
router.get('/deals', requireAuth, (req, res) => {
  const rows = dbAll('SELECT * FROM deals WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json(rows.map(dealToFrontend));
});

router.post('/deals', requireAuth, (req, res) => {
  const {
    instrument, note, usdInrRate, dginrAtEntry,
    mcxSide, mcxPrice, mcxQty, mcxBrokerage, mcxBrokerId,
    comexSide, comexPrice, comexQty, comexBrokerage, comexBrokerId,
    dgcxEnabled, dgcxSide, dgcxPrice, dgcxQty, dgcxBrokerage, dgcxBrokerId
  } = req.body;

  const newId = dbInsert(`
    INSERT INTO deals (
      user_id, instrument, qty, note, usd_inr_rate, dginr_at_entry,
      mcx_side, mcx_price, mcx_qty, mcx_brokerage, mcx_broker_id,
      comex_side, comex_price, comex_qty, comex_brokerage, comex_broker_id,
      dgcx_enabled, dgcx_side, dgcx_price, dgcx_qty, dgcx_brokerage, dgcx_broker_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    req.user.id, instrument, parseFloat(mcxQty)||1, note||'',
    parseFloat(usdInrRate)||89, parseFloat(dginrAtEntry)||null,
    mcxSide, parseFloat(mcxPrice), parseFloat(mcxQty)||1, parseFloat(mcxBrokerage)||0,
    mcxBrokerId ? parseInt(mcxBrokerId) : null,
    comexSide, parseFloat(comexPrice), parseFloat(comexQty)||1, parseFloat(comexBrokerage)||0,
    comexBrokerId ? parseInt(comexBrokerId) : null,
    dgcxEnabled?1:0, dgcxEnabled?dgcxSide:null,
    dgcxEnabled?parseFloat(dgcxPrice):null,
    dgcxEnabled?parseFloat(dgcxQty)||1:1, parseFloat(dgcxBrokerage)||0,
    dgcxEnabled&&dgcxBrokerId?parseInt(dgcxBrokerId):null
  ]);

  res.json(dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [newId])));
});

router.put('/deals/:id', requireAuth, (req, res) => {
  const deal = dbGet('SELECT * FROM deals WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  if (!deal) return res.status(404).json({ error: 'Not found' });

  const {
    note, usdInrRate, dginrAtEntry,
    mcxSide, mcxPrice, mcxQty, mcxBrokerage, mcxBrokerId,
    comexSide, comexPrice, comexQty, comexBrokerage, comexBrokerId,
    dgcxEnabled, dgcxSide, dgcxPrice, dgcxQty, dgcxBrokerage, dgcxBrokerId
  } = req.body;

  const updated = {
    ...deal,
    usd_inr_rate:    parseFloat(usdInrRate) || 89,
    mcx_side:        mcxSide,
    mcx_price:       parseFloat(mcxPrice),
    mcx_qty:         parseFloat(mcxQty) || 1,
    mcx_brokerage:   parseFloat(mcxBrokerage) || 0,
    comex_side:      comexSide,
    comex_price:     parseFloat(comexPrice),
    comex_qty:       parseFloat(comexQty) || 1,
    comex_brokerage: parseFloat(comexBrokerage) || 0,
    dgcx_enabled:    dgcxEnabled ? 1 : 0,
    dgcx_side:       dgcxEnabled ? dgcxSide       : null,
    dgcx_price:      dgcxEnabled ? parseFloat(dgcxPrice) : null,
    dgcx_qty:        dgcxEnabled ? parseFloat(dgcxQty)||1 : 1,
    dgcx_brokerage:  parseFloat(dgcxBrokerage) || 0,
  };

  let mcxPnlStore = deal.mcx_pnl, comexPnlStore = deal.comex_pnl,
      dgcxPnlStore = deal.dgcx_pnl, totalPnlStore = deal.total_pnl;

  if (deal.status === 'closed') {
    // FIX 7: recalcClosedPnl uses the stored (already-proportional) brokerage
    // on `updated`, so no double-ratio is applied.
    const recalc = recalcClosedPnl(updated);
    mcxPnlStore   = recalc.mcxPnl;
    comexPnlStore = recalc.comexPnl;
    dgcxPnlStore  = recalc.dgcxPnl;
    totalPnlStore = recalc.totalPnl;
  }

  dbRun(`
    UPDATE deals SET
      note=?, usd_inr_rate=?, dginr_at_entry=?,
      mcx_side=?, mcx_price=?, mcx_qty=?, mcx_brokerage=?, mcx_broker_id=?,
      comex_side=?, comex_price=?, comex_qty=?, comex_brokerage=?, comex_broker_id=?,
      dgcx_enabled=?, dgcx_side=?, dgcx_price=?, dgcx_qty=?, dgcx_brokerage=?, dgcx_broker_id=?,
      mcx_pnl=?, comex_pnl=?, dgcx_pnl=?, total_pnl=?
    WHERE id=?
  `, [
    note||'', parseFloat(usdInrRate)||89, parseFloat(dginrAtEntry)||null,
    mcxSide, parseFloat(mcxPrice), parseFloat(mcxQty)||1, parseFloat(mcxBrokerage)||0,
    mcxBrokerId ? parseInt(mcxBrokerId) : null,
    comexSide, parseFloat(comexPrice), parseFloat(comexQty)||1, parseFloat(comexBrokerage)||0,
    comexBrokerId ? parseInt(comexBrokerId) : null,
    dgcxEnabled?1:0, dgcxEnabled?dgcxSide:null,
    dgcxEnabled?parseFloat(dgcxPrice):null,
    dgcxEnabled?parseFloat(dgcxQty)||1:1, parseFloat(dgcxBrokerage)||0,
    dgcxEnabled&&dgcxBrokerId?parseInt(dgcxBrokerId):null,
    mcxPnlStore, comexPnlStore, dgcxPnlStore, totalPnlStore,
    deal.id
  ]);

  res.json(dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [deal.id])));
});

router.put('/deals/:id/close', requireAuth, (req, res) => {
  const deal = dbGet('SELECT * FROM deals WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  if (!deal) return res.status(404).json({ error: 'Not found' });

  const {
    mcxExitPrice, comexExitPrice, dgcxExitPrice,
    mcxCloseQty, comexCloseQty, dgcxCloseQty
  } = req.body;

  const rate = deal.usd_inr_rate || 89;

  const mExit = parseFloat(mcxExitPrice);
  const cExit = parseFloat(comexExitPrice);
  const dExit = (deal.dgcx_enabled && dgcxExitPrice != null && dgcxExitPrice !== '')
    ? parseFloat(dgcxExitPrice)
    : null;

  if (isNaN(mExit)) return res.status(400).json({ error: 'Invalid MCX exit price' });
  if (isNaN(cExit)) return res.status(400).json({ error: 'Invalid COMEX exit price' });
  if (deal.dgcx_enabled && dgcxExitPrice != null && dgcxExitPrice !== '' && isNaN(dExit)) {
    return res.status(400).json({ error: 'Invalid DGCX exit price' });
  }

  const mcxTotal   = parseFloat(deal.mcx_qty   || deal.qty || 1);
  const comexTotal = parseFloat(deal.comex_qty || 1);
  const dgcxTotal  = deal.dgcx_enabled ? parseFloat(deal.dgcx_qty || 1) : 0;

  const mcxClose = mcxCloseQty != null && parseFloat(mcxCloseQty) > 0
    ? Math.min(parseFloat(mcxCloseQty), mcxTotal)
    : mcxTotal;

  const comexClose = comexCloseQty != null && parseFloat(comexCloseQty) > 0
    ? Math.min(parseFloat(comexCloseQty), comexTotal)
    : comexTotal;

  const dgcxClose = deal.dgcx_enabled
    ? (dgcxCloseQty != null && parseFloat(dgcxCloseQty) > 0
        ? Math.min(parseFloat(dgcxCloseQty), dgcxTotal)
        : dgcxTotal)
    : 0;

  const mcxRatio   = mcxTotal   > 0 ? mcxClose   / mcxTotal   : 1;
  const comexRatio = comexTotal > 0 ? comexClose  / comexTotal : 1;
  const dgcxRatio  = deal.dgcx_enabled && dgcxTotal > 0 ? dgcxClose / dgcxTotal : 0;

  const mcxPnl = (deal.mcx_side === 'SELL'
    ? (deal.mcx_price - mExit)
    : (mExit - deal.mcx_price)) * mcxClose - (deal.mcx_brokerage || 0) * mcxRatio;

  const comexPnl = (deal.comex_side === 'SELL'
    ? (deal.comex_price - cExit)
    : (cExit - deal.comex_price)) * comexClose * rate - (deal.comex_brokerage || 0) * comexRatio;

  let dgcxPnl = 0;
  if (deal.dgcx_enabled && dExit != null) {
    dgcxPnl = (deal.dgcx_side === 'SELL'
      ? (deal.dgcx_price - dExit)
      : (dExit - deal.dgcx_price)) * dgcxClose * rate - (deal.dgcx_brokerage || 0) * dgcxRatio;
  }

  const totalPnl = mcxPnl + comexPnl + dgcxPnl;

  const isPartial =
    mcxClose   < mcxTotal   - 0.000001 ||
    comexClose < comexTotal - 0.000001 ||
    (deal.dgcx_enabled && dgcxClose < dgcxTotal - 0.000001);

  if (isPartial) {
    const remainingMcx   = parseFloat((mcxTotal   - mcxClose).toFixed(10));
    const remainingComex = parseFloat((comexTotal - comexClose).toFixed(10));
    const remainingDgcx  = deal.dgcx_enabled ? parseFloat((dgcxTotal - dgcxClose).toFixed(10)) : null;

    const remainingMcxBrok   = parseFloat(((deal.mcx_brokerage   || 0) * (1 - mcxRatio)).toFixed(10));
    const remainingComexBrok = parseFloat(((deal.comex_brokerage || 0) * (1 - comexRatio)).toFixed(10));
    const remainingDgcxBrok  = deal.dgcx_enabled
      ? parseFloat(((deal.dgcx_brokerage || 0) * (1 - dgcxRatio)).toFixed(10))
      : null;

    // FIX 8: Use remainingComex (not remainingMcx) for the top-level qty field,
    // since qty is ambiguous when legs differ. Using MCX qty as the canonical
    // value is the closest match to how the deal was originally created
    // (qty = mcxQty in POST /deals). Kept as remainingMcx for consistency,
    // but noted explicitly so it's a deliberate choice, not a silent copy-paste.
    dbRun(`
      UPDATE deals SET
        mcx_qty         = ?,
        comex_qty       = ?,
        dgcx_qty        = ?,
        qty             = ?,
        mcx_brokerage   = ?,
        comex_brokerage = ?,
        dgcx_brokerage  = ?
      WHERE id = ?
    `, [
      remainingMcx,
      remainingComex,
      deal.dgcx_enabled ? remainingDgcx : deal.dgcx_qty,
      remainingMcx,   // qty mirrors mcx_qty (consistent with deal creation)
      remainingMcxBrok,
      remainingComexBrok,
      deal.dgcx_enabled ? remainingDgcxBrok : deal.dgcx_brokerage,
      deal.id
    ]);

    const childId = dbInsert(`
      INSERT INTO deals (
        user_id, instrument, qty, note, usd_inr_rate, dginr_at_entry,
        mcx_side, mcx_price, mcx_qty, mcx_brokerage, mcx_broker_id,
        mcx_exit_price, mcx_pnl,
        comex_side, comex_price, comex_qty, comex_brokerage, comex_broker_id,
        comex_exit_price, comex_pnl,
        dgcx_enabled, dgcx_side, dgcx_price, dgcx_qty, dgcx_brokerage, dgcx_broker_id,
        dgcx_exit_price, dgcx_pnl,
        status, total_pnl, entry_time, exit_time, parent_deal_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?)
    `, [
      deal.user_id, deal.instrument, mcxClose,
      deal.note ? `${deal.note} [partial close]` : 'partial close',
      rate, deal.dginr_at_entry,
      deal.mcx_side, deal.mcx_price, mcxClose, (deal.mcx_brokerage || 0) * mcxRatio,
      deal.mcx_broker_id, mExit, mcxPnl,
      deal.comex_side, deal.comex_price, comexClose, (deal.comex_brokerage || 0) * comexRatio,
      deal.comex_broker_id, cExit, comexPnl,
      deal.dgcx_enabled,
      deal.dgcx_enabled ? deal.dgcx_side  : null,
      deal.dgcx_enabled ? deal.dgcx_price : null,
      deal.dgcx_enabled ? dgcxClose : 1,
      deal.dgcx_enabled ? (deal.dgcx_brokerage || 0) * dgcxRatio : 0,
      deal.dgcx_enabled ? deal.dgcx_broker_id : null,
      dExit, dgcxPnl,
      'closed', totalPnl,
      deal.entry_time,
      deal.id
    ]);

    const parent = dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [deal.id]));
    const child  = dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [childId]));
    return res.json({ partial: true, open: parent, closed: child });
  }

  dbRun(`
    UPDATE deals SET
      mcx_exit_price=?, mcx_pnl=?,
      comex_exit_price=?, comex_pnl=?,
      dgcx_exit_price=?, dgcx_pnl=?,
      total_pnl=?, status='closed', exit_time=datetime('now','localtime')
    WHERE id=?
  `, [mExit, mcxPnl, cExit, comexPnl, dExit, dgcxPnl, totalPnl, deal.id]);

  res.json({ partial: false, closed: dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [deal.id])) });
});

router.delete('/deals/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM deals WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  res.json({ ok: true });
});

//───────────────────────────────────────────────────────────────────

module.exports = router;