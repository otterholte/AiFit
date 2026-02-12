console.log('[boot] Starting AI FIT server...');

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

console.log('[boot] All modules loaded OK');

// ---------------------------------------------------------------------------
// 1. Express app — serves static files from /public
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

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

  // Client joins a room (both dashboard and phone call this)
  socket.on('join-room', ({ room, role }) => {
    socket.data.room = room;
    socket.data.role = role;
    socket.join(room);
    console.log(`[join-room]  ${socket.id} → room=${room} role=${role}`);

    // Notify others in the room that this role connected
    socket.to(room).emit('client-status', { source: role, connected: true });
  });

  // Pose landmarks — relay to same room only
  socket.on('pose-data', (data) => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('pose-update', data);
    }
  });

  // Camera frame snapshots — relay to same room only
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
  console.log(`  http://localhost:${PORT}/dashboard`);
  console.log('==========================================');
  console.log('');
});
