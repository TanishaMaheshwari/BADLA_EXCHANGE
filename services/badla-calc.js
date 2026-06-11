function evalEquation(equation, L1, L2, L3, D1) {
  const vars = { L1, L2, L3, D1 };
  // Replace all variable names in a single pass (longest-first to be safe)
  const substituted = equation.replace(/\bL1\b|\bL2\b|\bL3\b|\bD1\b/g, m => vars[m]);
  // eslint-disable-next-line no-new-func
  return Function('"use strict"; return (' + substituted + ')')();
}

function calculateBadla(data) {
  const DISPLAY_NAME_OVERRIDES = {
    'GOLD-6%(COMEXJUNE-MCXJUNE)@MAYDG': 'GOLD15%-(COMEXJUNE-MCXJUNE)@MAYDG',
    'SILVER6%-(COMEXJULY-MCXJULY)@MAYDG': 'SILVER15%-(COMEXJULY-MCXJULY)@MAYDG'
  };
  const latestTimestamp = Object.keys(data)[0];
  const latestData = data[latestTimestamp];
  if (!latestData || !latestData.raw_data) return null;
  const { equation } = latestData.raw_data;
  const instruments = latestData.raw_data.data;
  if (!instruments || instruments.length < 2) return null;
  const mcxData   = instruments.find(i => i.exchange === 'MCX')    ?? null;
  const comexData = instruments.find(i => i.exchange === 'COMEX' || i.exchange === 'SPOT') ?? null;
  const dgcxData  = instruments.find(i => i.exchange === 'DGCX')   ?? null;
  if (!comexData || !mcxData) return null;
  const reverse = latestData.reverse || "0";
  try {
    const D1 = 15;
    const L1 = comexData.last_price;
    const L2 = mcxData ? mcxData.last_price : 0;
    const L3 = dgcxData ? (10000 / dgcxData.last_price) : 1;

    // FIX 6: Use single-pass safe evaluator instead of chained string replace
    const ltp  = evalEquation(equation, L1, L2, L3, D1);
    const buy  = evalEquation(equation,
      comexData.buy_price_0  || L1,
      mcxData  ? (mcxData.buy_price_0  || L2) : 0,
      dgcxData ? (10000 / (dgcxData.sell_price_0 || dgcxData.last_price)) : 1,
      D1
    );
    const sell = evalEquation(equation,
      comexData.sell_price_0 || L1,
      mcxData  ? (mcxData.sell_price_0 || L2) : 0,
      dgcxData ? (10000 / (dgcxData.buy_price_0  || dgcxData.last_price)) : 1,
      D1
    );

    const finalLTP  = reverse === "1" ? ltp  - L2 : L2 - ltp;
    const finalBUY  = reverse === "1" ? sell - (mcxData ? mcxData.buy_price_0  : 0)
                                      : (mcxData ? mcxData.buy_price_0  : 0) - sell;
    const finalSELL = reverse === "1" ? buy  - (mcxData ? mcxData.sell_price_0 : 0)
                                      : (mcxData ? mcxData.sell_price_0 : 0) - buy;

    const convertedComexLTP = evalEquation(equation, L1, 0, L3, D1);
    const convertedComexBID = sell;
    const convertedComexASK = buy;

    const dgcxL3BID = dgcxData ? (10000 / (dgcxData.buy_price_0  || dgcxData.last_price)) : 1;
    const dgcxL3ASK = dgcxData ? (10000 / (dgcxData.sell_price_0 || dgcxData.last_price)) : 1;

    return {
      id: latestData.instrument_id, name: latestData.instrument_name,
      displayName: DISPLAY_NAME_OVERRIDES[latestData.raw_data.displayName]
        || DISPLAY_NAME_OVERRIDES[latestData.instrument_name]
        || latestData.raw_data.displayName
        || latestData.instrument_name,
      type: latestData.badla_type, timestamp: latestTimestamp,
      badlaLTP: finalLTP.toFixed(2), badlaBUY: finalBUY.toFixed(2), badlaSELL: finalSELL.toFixed(2),
      mcx:   mcxData   ? { bid: mcxData.buy_price_0,   ask: mcxData.sell_price_0,   ltp: mcxData.last_price }   : null,
      comex: comexData ? {
        bid: comexData.buy_price_0, ask: comexData.sell_price_0, ltp: comexData.last_price,
        convertedLTP: convertedComexLTP.toFixed(2),
        convertedBID: convertedComexBID.toFixed(2),
        convertedASK: convertedComexASK.toFixed(2),
      } : null,
      dgcx: dgcxData ? {
        bid: dgcxData.buy_price_0, ask: dgcxData.sell_price_0, ltp: dgcxData.last_price,
        convertedLTP: (10000 / dgcxData.last_price).toFixed(4),
        convertedBID: dgcxL3BID.toFixed(4),
        convertedASK: dgcxL3ASK.toFixed(4),
      } : null,
    };
  } catch(e) { return null; }
}

module.exports = { evalEquation, calculateBadla };