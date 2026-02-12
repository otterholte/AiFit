/**
 * camera-common.js  (loaded as <script type="module">)
 *
 * Shared logic for /front and /side camera pages:
 *   1. Load MediaPipe Pose Landmarker from CDN
 *   2. Open the webcam
 *   3. Run pose detection every frame
 *   4. Draw a skeleton overlay on the canvas
 *   5. Send landmarks + pose-validity flag to the server via Socket.IO
 *   6. Send periodic video+skeleton snapshots to the dashboard
 *   7. (Side page only) Allow switching front/back camera
 */

import {
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------
const source = window.location.pathname.includes('side') ? 'side' : 'front';
const isSide = source === 'side';

// Room code from URL (e.g. /side?room=A3F9)
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

// ---------------------------------------------------------------
// DOM
// ---------------------------------------------------------------
const video      = document.getElementById('webcam');
const canvas     = document.getElementById('overlay');
const ctx        = canvas.getContext('2d');
const statusText = document.getElementById('status-text');

// Side page mobile elements
const initOverlay  = document.getElementById('init-overlay');
const initText     = document.getElementById('init-text');
const initSpinner  = document.getElementById('init-spinner');
const statusDot    = document.getElementById('status-dot');
const noServerMsg  = document.getElementById('no-server-msg');

// ---------------------------------------------------------------
// Landmark indices
// ---------------------------------------------------------------
const LM = {
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
};
const UPPER = { LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12 };

const CONNECTIONS = [
  [UPPER.LEFT_SHOULDER, UPPER.RIGHT_SHOULDER],
  [UPPER.LEFT_SHOULDER, LM.LEFT_HIP],
  [UPPER.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
];
const ALL_KEYPOINTS = [
  UPPER.LEFT_SHOULDER, UPPER.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

// Indices used for pose validation
const BODY_INDICES = [11, 12, 23, 24, 25, 26, 27, 28];

// ---------------------------------------------------------------
// Socket.IO (graceful — works without a server on GitHub Pages)
// ---------------------------------------------------------------
const _noop = () => {};
const _noopSocket = { emit: _noop, on: _noop, off: _noop, connect: _noop, disconnect: _noop };

let socketConnected = false;
let socket;

try {
  socket = (typeof window.io === 'function') ? window.io() : _noopSocket;

  // Track connection state
  if (socket !== _noopSocket) {
    socket.on('connect', () => {
      socketConnected = true;
      // Join the room once connected (and on every reconnect)
      if (roomCode) {
        socket.emit('join-room', { room: roomCode, role: source });
      }
      if (statusDot) statusDot.classList.remove('offline');
      if (noServerMsg) noServerMsg.classList.add('hidden');
      updateStatus('Connected to dashboard');
    });
    socket.on('disconnect', () => {
      socketConnected = false;
      if (statusDot) statusDot.classList.add('offline');
      updateStatus('Disconnected from dashboard');
    });
    socket.on('connect_error', () => {
      socketConnected = false;
      if (statusDot) statusDot.classList.add('offline');
      showNoServerWarning();
    });
  } else {
    showNoServerWarning();
  }
} catch (_) {
  socket = _noopSocket;
  showNoServerWarning();
}

function showNoServerWarning() {
  if (noServerMsg) noServerMsg.classList.remove('hidden');
}

function updateStatus(text) {
  if (statusText) statusText.textContent = text;
}

// ---------------------------------------------------------------
// Camera state
// ---------------------------------------------------------------
let currentFacingMode = isSide ? 'environment' : 'user';
let detecting = false;
let poseLandmarker = null;
let lastVideoTime = -1;

// ---------------------------------------------------------------
// Movement tracking (to reject static objects)
// ---------------------------------------------------------------
const MOVEMENT_HISTORY = 20; // frames
const movementBuffer = [];

function trackMovement(landmarks) {
  const hipMid = {
    x: (landmarks[23].x + landmarks[24].x) / 2,
    y: (landmarks[23].y + landmarks[24].y) / 2,
  };
  movementBuffer.push(hipMid);
  if (movementBuffer.length > MOVEMENT_HISTORY) movementBuffer.shift();

  if (movementBuffer.length < 5) return true; // not enough data yet

  // Compute total displacement over the buffer
  let totalDisp = 0;
  for (let i = 1; i < movementBuffer.length; i++) {
    const dx = movementBuffer[i].x - movementBuffer[i - 1].x;
    const dy = movementBuffer[i].y - movementBuffer[i - 1].y;
    totalDisp += Math.sqrt(dx * dx + dy * dy);
  }

  return totalDisp > 0.008; // must have *some* movement
}

// ---------------------------------------------------------------
// Pose validation
// ---------------------------------------------------------------
function validatePose(landmarks) {
  // 1. Average visibility of 8 key landmarks must be > 0.5
  const avgVis = BODY_INDICES.reduce((s, i) => s + landmarks[i].visibility, 0) / BODY_INDICES.length;
  if (avgVis < 0.5) return false;

  // 2. Body height: hip-to-ankle must span > 10% of frame height
  const hipY = Math.min(landmarks[23].y, landmarks[24].y);
  const ankleY = Math.max(landmarks[27].y, landmarks[28].y);
  if (ankleY - hipY < 0.10) return false;

  // 3. Spatial coherence: hip above knee above ankle (y increases downward)
  const kneeY = Math.min(landmarks[25].y, landmarks[26].y);
  if (hipY > kneeY + 0.02 || kneeY > ankleY + 0.02) return false;

  // 4. Movement check (reject static objects)
  if (!trackMovement(landmarks)) return false;

  return true;
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
async function init() {
  updateStatus('Loading pose model…');
  if (initText) initText.textContent = 'Loading pose model…';

  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });

    updateStatus('Starting camera…');
    if (initText) initText.textContent = 'Starting camera…';
    await startCamera();
  } catch (err) {
    const msg = 'Error: ' + err.message;
    updateStatus(msg);
    if (initText) initText.textContent = msg;
    if (initSpinner) initSpinner.style.display = 'none';
    console.error(err);
  }
}

// ---------------------------------------------------------------
// Webcam — with fallback chain for mobile compatibility
// ---------------------------------------------------------------
async function requestCamera(constraints) {
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function startCamera() {
  // Try multiple constraint sets — phones can be picky
  const attempts = [
    // 1. Preferred: specific facing mode + resolution
    { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: currentFacingMode } },
    // 2. Fallback: facing mode only, let phone pick resolution
    { video: { facingMode: currentFacingMode } },
    // 3. Last resort: any camera at all
    { video: true },
  ];

  let stream = null;
  let lastErr = null;

  for (const constraints of attempts) {
    try {
      stream = await requestCamera(constraints);
      break;
    } catch (err) {
      lastErr = err;
      console.warn('Camera attempt failed:', constraints, err.message);
    }
  }

  if (!stream) {
    // All attempts failed — show helpful error
    let msg;
    if (lastErr?.name === 'NotAllowedError') {
      msg = 'Camera blocked — tap the lock icon in your browser address bar and allow camera access, then reload.';
    } else if (lastErr?.name === 'NotFoundError') {
      msg = 'No camera found on this device.';
    } else if (lastErr?.name === 'NotReadableError' || lastErr?.name === 'AbortError') {
      msg = 'Camera is in use by another app. Close other camera apps and reload.';
    } else if (window.location.protocol !== 'https:') {
      msg = 'Camera requires HTTPS. Make sure you\'re accessing this page via https://';
    } else {
      msg = 'Could not start camera: ' + (lastErr?.message || 'unknown error');
    }

    // Check if this might be a certificate issue
    if (window.location.protocol === 'https:' && window.location.hostname !== 'localhost') {
      msg += '\n\nTip: If you just scanned a QR code, you may need to accept the security certificate first. Try opening the URL directly in your browser, accept the warning, then come back.';
    }

    updateStatus(msg);
    if (initText) {
      initText.textContent = msg;
      initText.style.whiteSpace = 'pre-line';
    }
    if (initSpinner) initSpinner.style.display = 'none';
    console.error('All camera attempts failed:', lastErr);
    return;
  }

  try {
    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });

    await video.play();
    const aspect = video.videoWidth / video.videoHeight;
    thumbCanvas.width = THUMB_MAX_W;
    thumbCanvas.height = Math.round(THUMB_MAX_W / aspect);

    const isFront = currentFacingMode === 'user';
    video.classList.toggle('mirror', isFront);
    canvas.classList.toggle('mirror', isFront);

    updateStatus('Tracking active');
    // Hide init overlay (mobile side page)
    if (initOverlay) initOverlay.classList.add('hidden');
    if (statusDot && socketConnected) statusDot.classList.remove('offline');

    lastVideoTime = -1;
    movementBuffer.length = 0;

    if (!detecting) { detecting = true; detectLoop(); }
  } catch (err) {
    const msg = 'Camera error: ' + err.message;
    updateStatus(msg);
    if (initText) initText.textContent = msg;
    if (initSpinner) initSpinner.style.display = 'none';
    console.error(err);
  }
}

// ---------------------------------------------------------------
// Switch camera (side page)
// ---------------------------------------------------------------
async function switchCamera() {
  updateStatus('Switching camera…');
  const tracks = video.srcObject?.getTracks();
  if (tracks) tracks.forEach((t) => t.stop());
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  await startCamera();
}
const switchBtn = document.getElementById('switch-camera-btn');
if (switchBtn) switchBtn.addEventListener('click', switchCamera);

// ---------------------------------------------------------------
// Thumbnail snapshot
// ---------------------------------------------------------------
const THUMB_MAX_W = 320;
const FRAME_SEND_INTERVAL_MS = 100;
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = THUMB_MAX_W;
thumbCanvas.height = 240;
const thumbCtx = thumbCanvas.getContext('2d');
let lastFrameSentAt = 0;

function maybeSendFrame() {
  if (!socketConnected) return;  // skip if no server
  const now = performance.now();
  if (now - lastFrameSentAt < FRAME_SEND_INTERVAL_MS) return;
  lastFrameSentAt = now;
  try {
    const tw = thumbCanvas.width, th = thumbCanvas.height;
    thumbCtx.drawImage(video, 0, 0, tw, th);
    thumbCtx.drawImage(canvas, 0, 0, tw, th);
    socket.emit('frame-data', { source, frame: thumbCanvas.toDataURL('image/jpeg', 0.5) });
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------
// Detection loop
// ---------------------------------------------------------------
function detectLoop() {
  if (!poseLandmarker || video.readyState < 2) {
    requestAnimationFrame(detectLoop);
    return;
  }
  const now = video.currentTime;
  if (now === lastVideoTime) { requestAnimationFrame(detectLoop); return; }
  lastVideoTime = now;

  const results = poseLandmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.landmarks && results.landmarks.length > 0) {
    const lm = results.landmarks[0];
    const valid = validatePose(lm);
    if (valid) drawSkeleton(lm); // only draw skeleton on valid poses
    sendLandmarks(lm, valid);
  }

  maybeSendFrame();
  requestAnimationFrame(detectLoop);
}

// ---------------------------------------------------------------
// Draw skeleton
// ---------------------------------------------------------------
function drawSkeleton(landmarks) {
  const w = canvas.width, h = canvas.height;
  ctx.strokeStyle = '#00FF88';
  ctx.lineWidth = 3;
  for (const [i, j] of CONNECTIONS) {
    const a = landmarks[i], b = landmarks[j];
    if (a.visibility > 0.3 && b.visibility > 0.3) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }
  for (const idx of ALL_KEYPOINTS) {
    const pt = landmarks[idx];
    if (pt.visibility > 0.3) {
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, 6, 0, 2 * Math.PI);
      ctx.fillStyle = '#6c5ce7';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------
// Pick best side + send
// ---------------------------------------------------------------
function pickBestSide(landmarks) {
  const lv = landmarks[LM.LEFT_HIP].visibility + landmarks[LM.LEFT_KNEE].visibility + landmarks[LM.LEFT_ANKLE].visibility;
  const rv = landmarks[LM.RIGHT_HIP].visibility + landmarks[LM.RIGHT_KNEE].visibility + landmarks[LM.RIGHT_ANKLE].visibility;
  const use = rv > lv ? 'RIGHT' : 'LEFT';
  return {
    shoulder: landmarks[use === 'RIGHT' ? UPPER.RIGHT_SHOULDER : UPPER.LEFT_SHOULDER],
    hip:      landmarks[use === 'RIGHT' ? LM.RIGHT_HIP : LM.LEFT_HIP],
    knee:     landmarks[use === 'RIGHT' ? LM.RIGHT_KNEE : LM.LEFT_KNEE],
    ankle:    landmarks[use === 'RIGHT' ? LM.RIGHT_ANKLE : LM.LEFT_ANKLE],
  };
}

function sendLandmarks(landmarks, poseValid) {
  if (!socketConnected) return;  // skip if no server
  const best = pickBestSide(landmarks);
  // Send aspect ratio so the dashboard can correct for portrait/landscape distortion
  const ar = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
  socket.emit('pose-data', {
    source,
    timestamp: Date.now(),
    poseValid,
    aspectRatio: ar,
    landmarks: {
      shoulder: { x: best.shoulder.x, y: best.shoulder.y, visibility: best.shoulder.visibility },
      hip:      { x: best.hip.x,   y: best.hip.y,   visibility: best.hip.visibility },
      knee:     { x: best.knee.x,  y: best.knee.y,  visibility: best.knee.visibility },
      ankle:    { x: best.ankle.x, y: best.ankle.y, visibility: best.ankle.visibility },
    },
  });
}

// ---------------------------------------------------------------
init();
