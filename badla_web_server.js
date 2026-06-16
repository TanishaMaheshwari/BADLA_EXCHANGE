require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');

const { initDB }                        = require('./db');
const { initWS }                        = require('./services/websocket');
const { startBroadcastWatcher }         = require('./services/broadcast');
const { checkOrderTimeouts }            = require('./services/ea-registry');
const { router: mt5Router, pollMT5Status } = require('./routes/mt5');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/prices'));
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/deals'));
app.use('/api', require('./routes/brokers'));
app.use('/api', require('./routes/mt5').router);
app.use('/api', require('./routes/ea'));
app.use('/api', require('./routes/push'));
app.use('/api', require('./routes/notification'));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

setInterval(pollMT5Status, 1000);
setInterval(checkOrderTimeouts, 5000);

initDB().then(() => {
  initWS(server);
  server.listen(PORT, () => {
    console.log(`BadlaBoard running on port ${PORT}`);
    startBroadcastWatcher();
  });
}).catch(err => { console.error('Failed to initialize database:', err); process.exit(1); });