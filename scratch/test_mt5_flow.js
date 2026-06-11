const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// Helper: HTTP Request
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(dataString);
    }
    
    const req = http.request(options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        let parsed = responseBody;
        try {
          if (res.headers['content-type']?.includes('application/json')) {
            parsed = JSON.parse(responseBody);
          }
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    if (body) {
      req.write(dataString);
    }
    req.end();
  });
}

async function run() {
  console.log('==================================================');
  console.log('STARTING AUTOMATED MT5 EA FLOW INTEGRATION TEST');
  console.log('==================================================');
  
  try {
    // 1. Log in as admin
    console.log('\n[1] Logging in...');
    const loginRes = await request('POST', '/api/login', {
      username: 'admin',
      password: 'admin123'
    });
    
    if (loginRes.statusCode !== 200) {
      throw new Error(`Login failed (HTTP ${loginRes.statusCode}): ${JSON.stringify(loginRes.body)}`);
    }
    
    const token = loginRes.body.token;
    console.log(`✓ Logged in. Session token: ${token.substring(0, 10)}...`);
    
    const authHeaders = { 'x-session-token': token };
    
    // 2. Set up test brokers & symbol mappings
    console.log('\n[2] Setting up mock brokers & instrument mappings...');
    
    // Create MCX Broker
    const mcxBrokerRes = await request('POST', '/api/brokers', {
      brokerName: 'Test MCX Broker',
      accountId: 'MCX_ACCT',
      password: 'broker_password_123',
      profitShare: 10,
      totalPnl: 0,
      exchangeType: 'MCX',
      instruments: [{
        name: 'GOLD-15%(COMEXJUNE-MCXJUNE)@MAYDG',
        maxLots: 10,
        mcxSymbol: 'GOLD24JUN',
        mcxLotQty: 100,
        mcxBrokerage: 45,
        comexSymbol: 'XAUUSD',
        comexLotQty: 1,
        comexBrokerage: 40
      }]
    }, authHeaders);
    
    const mcxBrokerId = mcxBrokerRes.body.id;
    console.log(`✓ MCX Broker created (ID: ${mcxBrokerId})`);
    
    // Create COMEX Broker
    const comexBrokerRes = await request('POST', '/api/brokers', {
      brokerName: 'Test COMEX Broker',
      accountId: 'COMEX_ACCT',
      password: 'broker_password_456',
      profitShare: 0,
      totalPnl: 0,
      exchangeType: 'COMEX',
      instruments: [{
        name: 'GOLD-15%(COMEXJUNE-MCXJUNE)@MAYDG',
        maxLots: 10,
        mcxSymbol: 'GOLD24JUN',
        mcxLotQty: 100,
        mcxBrokerage: 45,
        comexSymbol: 'XAUUSD',
        comexLotQty: 1,
        comexBrokerage: 40
      }]
    }, authHeaders);
    
    const comexBrokerId = comexBrokerRes.body.id;
    console.log(`✓ COMEX Broker created (ID: ${comexBrokerId})`);
    
    // 3. Create a test deal
    console.log('\n[3] Creating a mock trading deal...');
    const dealRes = await request('POST', '/api/deals', {
      instrument: 'GOLD-15%(COMEXJUNE-MCXJUNE)@MAYDG',
      note: 'MT5 Flow Test Deal',
      usdInrRate: 83.5,
      dginrAtEntry: 83.5,
      mcxSide: 'BUY',
      mcxPrice: 72000,
      mcxQty: 100,
      mcxBrokerage: 45,
      mcxBrokerId: mcxBrokerId,
      comexSide: 'SELL',
      comexPrice: 2350,
      comexQty: 1,
      comexBrokerage: 40,
      comexBrokerId: comexBrokerId,
      dgcxEnabled: false
    }, authHeaders);
    
    const dealId = dealRes.body.id;
    console.log(`✓ Deal created (ID: ${dealId})`);
    
    // 4. Simulate EA heartbeats (Check-in)
    console.log('\n[4] Simulating initial EA heartbeats...');
    
    // MCX EA checks in
    const mcxHbRes = await request('POST', '/api/ea/heartbeat', {
      accountId: 'MCX_ACCT',
      brokerName: 'Test MCX Broker',
      exchange: 'MCX',
      symbol: 'GOLD24JUN',
      symbolValid: true,
      marketOpen: true,
      lotUsed: 0,
      lotMax: 10,
      lotHeadroom: 10
    });
    console.log(`✓ MCX EA Heartbeat: ${JSON.stringify(mcxHbRes.body)}`);
    
    // COMEX EA checks in
    const comexHbRes = await request('POST', '/api/ea/heartbeat', {
      accountId: 'COMEX_ACCT',
      brokerName: 'Test COMEX Broker',
      exchange: 'COMEX',
      symbol: 'XAUUSD',
      symbolValid: true,
      marketOpen: true,
      lotUsed: 0,
      lotMax: 10,
      lotHeadroom: 10
    });
    console.log(`✓ COMEX EA Heartbeat: ${JSON.stringify(comexHbRes.body)}`);
    
    // 5. Pre-flight check via /api/ea/check
    console.log('\n[5] Querying pre-flight check endpoint for our deal...');
    const checkRes = await request('POST', '/api/ea/check', { dealId }, authHeaders);
    console.log(`✓ Pre-flight response: status=${checkRes.statusCode}, body=`);
    console.log(JSON.stringify(checkRes.body, null, 2));
    
    if (!checkRes.body.allReady) {
      throw new Error('Preflight checks failed but both EAs are registered!');
    }
    console.log('✓ All legs validated successfully (Headroom, Symbols, and Markets match)');
    
    // 6. Commit the deal via /api/ea/commit
    console.log('\n[6] Committing the deal for execution...');
    const commitRes = await request('POST', '/api/ea/commit', { dealId }, authHeaders);
    console.log(`✓ Commit response: status=${commitRes.statusCode}, body=${JSON.stringify(commitRes.body)}`);
    
    // 7. EAs download pending orders on next heartbeat (Verify CSV response format support)
    console.log('\n[7] Simulating EA polls to retrieve pending orders...');
    
    // MCX EA polls
    const mcxPoll = await request('POST', '/api/ea/heartbeat?format=csv', {
      accountId: 'MCX_ACCT',
      brokerName: 'Test MCX Broker',
      exchange: 'MCX',
      symbol: 'GOLD24JUN',
      symbolValid: true,
      marketOpen: true,
      lotUsed: 0,
      lotMax: 10,
      lotHeadroom: 10
    }, { 'Accept': 'text/plain' });
    console.log(`✓ MCX EA CSV Response:\n${mcxPoll.body}`);
    
    // Parse order ID from MCX poll
    const mcxMatch = mcxPoll.body.match(/order:(\d+),GOLD24JUN,BUY,1.00/);
    if (!mcxMatch) throw new Error('Pending MCX order not found in heartbeat CSV response!');
    const mcxOrderId = parseInt(mcxMatch[1]);
    console.log(`✓ Retrieved MCX Order ID: ${mcxOrderId}`);
    
    // COMEX EA polls
    const comexPoll = await request('POST', '/api/ea/heartbeat?format=csv', {
      accountId: 'COMEX_ACCT',
      brokerName: 'Test COMEX Broker',
      exchange: 'COMEX',
      symbol: 'XAUUSD',
      symbolValid: true,
      marketOpen: true,
      lotUsed: 0,
      lotMax: 10,
      lotHeadroom: 10
    }, { 'Accept': 'text/plain' });
    console.log(`✓ COMEX EA CSV Response:\n${comexPoll.body}`);
    
    // Parse order ID from COMEX poll
    const comexMatch = comexPoll.body.match(/order:(\d+),XAUUSD,SELL,1.00/);
    if (!comexMatch) throw new Error('Pending COMEX order not found in heartbeat CSV response!');
    const comexOrderId = parseInt(comexMatch[1]);
    console.log(`✓ Retrieved COMEX Order ID: ${comexOrderId}`);
    
    // 8. Execute one leg successfully and fail the other leg (Triggers automatic reversal)
    console.log('\n[8] Executing MCX order successfully, but failing COMEX order...');
    
    // Report success on MCX
    const mcxReport = await request('POST', '/api/ea/report', {
      accountId: 'MCX_ACCT',
      orderId: mcxOrderId,
      success: true,
      ticket: 987654,
      price: 72005.5,
      error: ''
    });
    console.log(`✓ MCX Leg reported success: ${JSON.stringify(mcxReport.body)}`);
    
    // Report failure on COMEX
    const comexReport = await request('POST', '/api/ea/report', {
      accountId: 'COMEX_ACCT',
      orderId: comexOrderId,
      success: false,
      ticket: 0,
      price: 0,
      error: 'RETCODE_REJECTED (Insufficient margin)'
    });
    console.log(`✓ COMEX Leg reported failure: ${JSON.stringify(comexReport.body)}`);
    
    // 9. Verify that a reversal order is queued for the successful MCX leg
    console.log('\n[9] Simulating subsequent MCX EA heartbeat to poll for reversal orders...');
    const mcxRevPoll = await request('POST', '/api/ea/heartbeat?format=csv', {
      accountId: 'MCX_ACCT',
      brokerName: 'Test MCX Broker',
      exchange: 'MCX',
      symbol: 'GOLD24JUN',
      symbolValid: true,
      marketOpen: true,
      lotUsed: 0,
      lotMax: 10,
      lotHeadroom: 10
    }, { 'Accept': 'text/plain' });
    console.log(`✓ MCX EA Reversal CSV Response:\n${mcxRevPoll.body}`);
    
    const mcxRevMatch = mcxRevPoll.body.match(/order:(\d+),GOLD24JUN,SELL,1.00/);
    if (!mcxRevMatch) {
      throw new Error('Reversal order (SELL 1.00 GOLD24JUN) was NOT queued for the successful MCX leg!');
    }
    const mcxRevOrderId = parseInt(mcxRevMatch[1]);
    console.log(`✓ SUCCESS: Reversal order #${mcxRevOrderId} queued for MCX broker!`);
    
    // Cleanup: execute reversal order
    await request('POST', '/api/ea/report', {
      accountId: 'MCX_ACCT',
      orderId: mcxRevOrderId,
      success: true,
      ticket: 987655,
      price: 72004.0,
      error: ''
    });
    console.log('✓ Reversal order reported executed successfully.');
    
    console.log('\n==================================================');
    console.log('ALL TESTS COMPLETED SUCCESSFULLY! INTEGRATION OK.');
    console.log('==================================================');
    
  } catch (err) {
    console.error('\n❌ TEST RUN FAILED with error:', err);
    process.exit(1);
  }
}

run();
