// Catch any crash before it disappears into the void
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
  process.exit(1);
});

console.log('[boot] Starting AI FIT server...');
console.log('[boot] Node version:', process.version);
console.log('[boot] PORT env:', process.env.PORT);

let http, express, Server, crypto, path;
try {
  http = require('http');
  express = require('express');
  Server = require('socket.io').Server;
  crypto = require('crypto');
  path = require('path');
  console.log('[boot] All modules loaded OK');
} catch (err) {
  console.error('[FATAL] Module load failed:', err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Express app — serves static files from /public
// ---------------------------------------------------------------------------
const app = express();

// Prevent browser from caching JS/CSS — always serve fresh code after deploys
app.use('/js', express.static(path.join(__dirname, 'public', 'js'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  },
}));
app.use('/css', express.static(path.join(__dirname, 'public', 'css'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

// Health check for Railway
app.get('/health', (_req, res) => res.send('OK'));

// Routes
app.get('/',          (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/front',     (_req, res) => res.sendFile(path.join(__dirname, 'public', 'front.html')));
app.get('/side',      (_req, res) => res.sendFile(path.join(__dirname, 'public', 'side.html')));

// API: generate a new room code
app.get('/api/create-room', (_req, res) => {
  const code = crypto.randomBytes(2).toString('hex').toUpperCase(); // e.g. "A3F9"
  res.json({ room: code });
});

// ---------------------------------------------------------------------------
// 2. HTTP server + Socket.IO  (Railway/cloud handles HTTPS termination)
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6, // 1 MB — enough for JPEG thumbnails
});

// ---------------------------------------------------------------------------
// 3. Socket.IO — room-scoped events for multi-user isolation
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[connect]    ${socket.id}`);

  socket.on('join-room', ({ room, role }) => {
    socket.data.room = room;
    socket.data.role = role;
    socket.join(room);
    console.log(`[join-room]  ${socket.id} → room=${room} role=${role}`);
    socket.to(room).emit('client-status', { source: role, connected: true });
  });

  socket.on('pose-data', (data) => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('pose-update', data);
    }
  });

  socket.on('frame-data', (data) => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('frame-update', data);
    }
  });

  socket.on('disconnect', () => {
    const { room, role } = socket.data;
    console.log(`[disconnect] ${socket.id} (room=${room || '?'} role=${role || '?'})`);
    if (room && role) {
      socket.to(room).emit('client-status', { source: role, connected: false });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Start listening
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==========================================');
  console.log('  AI FIT — Server Running');
  console.log('==========================================');
  console.log(`  Port: ${PORT}`);
  console.log('==========================================');
  console.log('');
});
