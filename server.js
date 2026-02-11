const https = require('https');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');
const selfsigned = require('selfsigned');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Self-signed certificate — persisted to disk so the browser only shows
//    the warning once (instead of every server restart).
// ---------------------------------------------------------------------------
const certDir  = path.join(__dirname, 'certs');
const keyPath  = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

let pems;
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('[cert] Reusing existing certificate from certs/');
  pems = {
    private: fs.readFileSync(keyPath, 'utf8'),
    cert:    fs.readFileSync(certPath, 'utf8'),
  };
} else {
  console.log('[cert] Generating new self-signed certificate…');
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const generated = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
  });
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyPath, generated.private);
  fs.writeFileSync(certPath, generated.cert);
  pems = generated;
}

// ---------------------------------------------------------------------------
// 2. Express app — serves static files from /public
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/front',     (_req, res) => res.sendFile(path.join(__dirname, 'public', 'front.html')));
app.get('/side',      (_req, res) => res.sendFile(path.join(__dirname, 'public', 'side.html')));

// API: return LAN IP so QR code points to the right address for phones
app.get('/api/lan-ip', (_req, res) => {
  const interfaces = os.networkInterfaces();
  let lanIP = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanIP = iface.address;
      }
    }
  }
  res.json({ ip: lanIP, port: PORT });
});

// ---------------------------------------------------------------------------
// 3. HTTPS server + Socket.IO
// ---------------------------------------------------------------------------
const server = https.createServer({ key: pems.private, cert: pems.cert }, app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6, // 1 MB — enough for JPEG thumbnails
});

io.on('connection', (socket) => {
  console.log(`[connect]    ${socket.id}`);

  socket.on('register', (role) => {
    socket.data.role = role;
    socket.join(role);
    console.log(`[register]   ${socket.id} → ${role}`);
    io.emit('client-status', { source: role, connected: true });
  });

  socket.on('pose-data', (data) => {
    io.emit('pose-update', data);
  });

  // Camera pages send periodic video+skeleton snapshots; relay only to dashboards
  socket.on('frame-data', (data) => {
    io.to('dashboard').emit('frame-update', data);
  });

  socket.on('disconnect', () => {
    const role = socket.data.role;
    console.log(`[disconnect] ${socket.id} (${role || 'unknown'})`);
    if (role) {
      io.emit('client-status', { source: role, connected: false });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Start listening — print helpful URLs
// ---------------------------------------------------------------------------
const PORT = 3000;

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  let lanIP = '<unknown>';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanIP = iface.address;
      }
    }
  }

  console.log('');
  console.log('==========================================');
  console.log('  Two-Camera Squat POC — Server Running');
  console.log('==========================================');
  console.log(`  Dashboard (laptop):  https://localhost:${PORT}/dashboard`);
  console.log(`  Side cam  (phone):   https://${lanIP}:${PORT}/side`);
  console.log('==========================================');
  console.log('  Accept the self-signed cert warning ONCE');
  console.log('  in each browser — it won\'t ask again.');
  console.log('==========================================');
  console.log('');
});
