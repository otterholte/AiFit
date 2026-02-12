/**
 * dashboard.js  (ES module)
 *
 * Full fitness dashboard:
 *   - Local front camera with MediaPipe Pose + hand-raise pause gesture
 *   - Side camera frames + landmarks via Socket.IO
 *   - Squat state machine with structured sets (3 × 10)
 *   - Throttled coaching cues, applause on set completion
 */

/* global io, SquatDetector, FormCoach, confetti */

import {
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

// ==========================================================================
// CONFIG
// ==========================================================================
const REPS_PER_SET = 10;
const TOTAL_SETS   = 3;

// ==========================================================================
// Landmark indices
// ==========================================================================
const LM = {
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
};
const UPPER = { LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12 };
// For hand gesture
const WRIST = { LEFT: 15, RIGHT: 16 };
const NOSE = 0;

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

// ==========================================================================
// DOM
// ==========================================================================
const repCountEl       = document.getElementById('rep-count');
const repsTargetEl     = document.getElementById('reps-target');
const setInfoEl        = document.getElementById('set-info');
const setDotsEl        = document.getElementById('set-dots');
const coachingCueEl    = document.getElementById('coaching-cue');
const feedbackEl       = document.getElementById('feedback');
const timerEl          = document.getElementById('timer');
const trackingWarning  = document.getElementById('tracking-warning');
const pauseOverlay     = document.getElementById('pause-overlay');
const setCompleteOvl   = document.getElementById('set-complete-overlay');
const setCompleteTxt   = document.getElementById('set-complete-text');
const resetBtn         = document.getElementById('reset-btn');
const frontDot         = document.getElementById('front-dot');
const sideDot          = document.getElementById('side-dot');
const correctionBanner     = document.getElementById('correction-banner');
const correctionBannerText = document.getElementById('correction-banner-text');
const debugOverlay         = document.getElementById('debug-overlay');

const frontVideo       = document.getElementById('front-webcam');
const frontCanvas      = document.getElementById('front-overlay');
const frontCtx         = frontCanvas.getContext('2d');
const frontPlaceholder = document.getElementById('front-placeholder');
const sideFeedImg      = document.getElementById('side-feed');
const sidePlaceholder  = document.getElementById('side-placeholder');

// ==========================================================================
// ROOM CODE — multi-user isolation
// ==========================================================================
// Room code comes from URL (?room=XXXX) or we create one
const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get('room');

async function ensureRoom() {
  if (!roomCode) {
    try {
      const resp = await fetch('/api/create-room');
      const data = await resp.json();
      roomCode = data.room;
    } catch (_) {
      // Fallback: generate client-side
      roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    // Put room code in URL so refresh keeps the same room
    const url = new URL(window.location);
    url.searchParams.set('room', roomCode);
    window.history.replaceState({}, '', url);
  }
}

// ==========================================================================
// Socket.IO (graceful — works without a server on GitHub Pages)
// ==========================================================================
const noop = () => {};
const noopSocket = { emit: noop, on: noop, off: noop, connect: noop, disconnect: noop };
const socket = (typeof window.io === 'function') ? window.io() : noopSocket;

// Join room once we have a code (called after ensureRoom)
function joinRoom() {
  try { socket.emit('join-room', { room: roomCode, role: 'dashboard' }); } catch (_) { /* no server */ }
}

// ==========================================================================
// State
// ==========================================================================
const squat = new SquatDetector();

let currentSet    = 1;
let sideLastSeen  = 0;
let timerStart    = 0;
let timerInterval = null;
let lastState     = 'UP';
let _lastLeanLog  = 0;
let _warnedNoShoulder = false;
let _debugEnabled = false;   // toggle with Ctrl+D in browser
let _lastDebugUpdate = 0;
let _liveKneeAngle = null;
let _liveLeanDeg = null;
let isPaused      = false;
let workoutDone   = false;

// Coaching cue throttle
let lastCueText = '';
let lastCueTime = 0;
const MIN_CUE_INTERVAL = 1200; // 1.2 seconds between cue changes

// Depth tracking (within a single rep)
let reachedTargetDepth = false;
let reachedDepthTime   = 0;
let lastDepthPhase     = '';     // 'descending' | 'hold' | 'drive'
const TARGET_DEPTH_ANGLE = 95;   // consider "at depth" when knee ≤ 95°
const HOLD_DURATION_MS   = 500;  // say "Hold!" for ~0.5s, then "Drive up!"

// ==========================================================================
// FORM COACH — streak-based correction system
// ==========================================================================
const formCoach = new FormCoach();

// Per-rep metric accumulators (reset each rep)
let repMinKneeAngle   = null;   // lowest knee angle during this rep
let repMaxForwardLean  = 0;     // max hip-ankle x offset (normalised)
let repHoldMs          = 0;     // ms spent at depth (≤ target angle)
let repKneeValgusRatio = null;  // kneeWidth / hipWidth from front cam (sampled at deepest point)

// Front camera valgus sampling
let latestFrontValgusRatio = null;  // updated each front-cam frame

// Hand gesture state
let handRaisedSince  = 0;
let gestureTriggered = false;
const GESTURE_HOLD_MS = 600;

let feedbackTimeout = null;

// Camera tips state
let cameraTipsShown    = false;
let cameraTipsDismissed = false;

// ==========================================================================
// MENU STATE
// ==========================================================================
let menuActive = true;
let endScreenActive = false;
const mainMenuEl       = document.getElementById('main-menu');
const workoutAppEl     = document.getElementById('workout-app');
const gestureCursor    = document.getElementById('gesture-cursor');
const cursorFillRing   = gestureCursor?.querySelector('.cursor-fill-ring');
const workoutEndScreen = document.getElementById('workout-end-screen');
const helpTooltipEl    = document.getElementById('help-tooltip');
const CURSOR_CIRCUMFERENCE = 2 * Math.PI * 26;  // ~163.36
const RING_CIRCUMFERENCE   = 2 * Math.PI * 45;  // ~283

// Menu camera preview
const menuCamPreview = document.getElementById('menu-cam-preview');
const menuCamCanvas  = document.getElementById('menu-cam-canvas');
const menuCamCtx     = menuCamCanvas ? menuCamCanvas.getContext('2d') : null;

// Gesture cursor smoothing
let smoothCursorX = 0, smoothCursorY = 0;

// Dwell-to-select
let hoveredCard    = null;
let hoverStartTime = 0;
const DWELL_MS     = 2000; // 2 seconds

// Hand tracking toggle
let handTrackingOn = true;

// ==========================================================================
// Init
// ==========================================================================
repsTargetEl.textContent = REPS_PER_SET;
updateSetUI();

// ==========================================================================
// 1. LOCAL FRONT CAMERA
// ==========================================================================
let poseLandmarker = null;
let lastVideoTime = -1;

async function initFrontCamera() {
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
    await openWebcam();
  } catch (err) { console.error('MediaPipe init error:', err); }
}

async function openWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });
    frontVideo.srcObject = stream;
    await new Promise((r) => { frontVideo.onloadedmetadata = () => { frontCanvas.width = frontVideo.videoWidth; frontCanvas.height = frontVideo.videoHeight; r(); }; });
    await frontVideo.play();
    frontPlaceholder.style.display = 'none';
    frontDot.classList.add('live');
    frontDetectLoop();
  } catch (err) { console.error('Webcam error:', err); }
}

function frontDetectLoop() {
  if (!poseLandmarker || frontVideo.readyState < 2) { requestAnimationFrame(frontDetectLoop); return; }
  const t = frontVideo.currentTime;
  if (t === lastVideoTime) { requestAnimationFrame(frontDetectLoop); return; }
  lastVideoTime = t;

  const results = poseLandmarker.detectForVideo(frontVideo, performance.now());
  frontCtx.clearRect(0, 0, frontCanvas.width, frontCanvas.height);

  if (results.landmarks && results.landmarks.length > 0) {
    const lm = results.landmarks[0];

    // Only draw skeleton overlay when hand tracking is on
    if (handTrackingOn) {
      drawSkeleton(frontCtx, frontCanvas.width, frontCanvas.height, lm);
    }

    // Sample knee valgus from front camera (only during workout)
    if (!menuActive && !endScreenActive && !isPaused && !workoutDone) {
      const lk = lm[LM.LEFT_KNEE], rk = lm[LM.RIGHT_KNEE];
      const lh = lm[LM.LEFT_HIP],  rh = lm[LM.RIGHT_HIP];
      if (lk.visibility > 0.4 && rk.visibility > 0.4 &&
          lh.visibility > 0.4 && rh.visibility > 0.4) {
        const kneeWidth = Math.abs(lk.x - rk.x);
        const hipWidth  = Math.abs(lh.x - rh.x);
        if (hipWidth > 0.01) {
          latestFrontValgusRatio = kneeWidth / hipWidth;
        }
      }
    }

    if (menuActive || endScreenActive) {
      drawMenuPreview(lm);
      if (handTrackingOn) {
        updateMenuCursor(lm);
      } else {
        hideGestureCursor();
      }
    } else {
      checkPauseGesture(lm);
    }
  } else if (menuActive || endScreenActive) {
    drawMenuPreview(null);
    hideGestureCursor();
  }
  requestAnimationFrame(frontDetectLoop);
}

// ==========================================================================
// 2. HAND GESTURE PAUSE (from front camera)
// ==========================================================================
function checkPauseGesture(landmarks) {
  const nose = landmarks[NOSE];
  const lw   = landmarks[WRIST.LEFT];
  const rw   = landmarks[WRIST.RIGHT];

  // Either wrist clearly above the nose
  const handUp =
    (lw.visibility > 0.5 && lw.y < nose.y - 0.12) ||
    (rw.visibility > 0.5 && rw.y < nose.y - 0.12);

  if (handUp) {
    if (handRaisedSince === 0) handRaisedSince = Date.now();
    if (!gestureTriggered && Date.now() - handRaisedSince > GESTURE_HOLD_MS) {
      gestureTriggered = true;
      togglePause();
    }
  } else {
    handRaisedSince = 0;
    gestureTriggered = false;
  }
}

function togglePause() {
  isPaused = !isPaused;
  pauseOverlay.style.display = isPaused ? 'flex' : 'none';

  if (isPaused) {
    clearInterval(timerInterval);
    timerInterval = null;
    // Populate pause overlay stats
    updatePauseStats();
  } else if (timerStart) {
    // Resume timer (adjust start so elapsed stays correct)
    startTimerFrom(timerStart);
  }
}

// Populate the pause overlay with current workout stats
function updatePauseStats() {
  const pauseReps  = document.getElementById('pause-reps');
  const pauseSet   = document.getElementById('pause-set');
  const pauseTimer = document.getElementById('pause-timer');
  if (pauseReps)  pauseReps.textContent  = repCountEl.textContent + ' / ' + REPS_PER_SET;
  if (pauseSet)   pauseSet.textContent   = 'Set ' + Math.min(currentSet, TOTAL_SETS) + ' of ' + TOTAL_SETS;
  if (pauseTimer) pauseTimer.textContent = timerEl.textContent;
}

// Resume button (on-screen unpause)
const resumeBtn = document.getElementById('resume-btn');
if (resumeBtn) {
  resumeBtn.addEventListener('click', () => {
    if (isPaused) togglePause();
  });
}

// ==========================================================================
// 2b. HAND TRACKING TOGGLE BUTTON
// ==========================================================================
const handTrackToggleBtn     = document.getElementById('hand-track-toggle');
const menuHandTrackToggleBtn = document.getElementById('menu-hand-track-toggle');

function syncTrackingButtons() {
  const title = handTrackingOn ? 'Hand tracking ON' : 'Hand tracking OFF';
  [handTrackToggleBtn, menuHandTrackToggleBtn].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle('off', !handTrackingOn);
    btn.title = title;
  });
  if (!handTrackingOn) {
    hideGestureCursor();
    clearMenuHover();
  }
}

function toggleHandTracking() {
  handTrackingOn = !handTrackingOn;
  syncTrackingButtons();
}

if (handTrackToggleBtn)     handTrackToggleBtn.addEventListener('click', toggleHandTracking);
if (menuHandTrackToggleBtn) menuHandTrackToggleBtn.addEventListener('click', toggleHandTracking);

// ==========================================================================
// 3. SIDE CAMERA (via Socket.IO)
// ==========================================================================
socket.on('frame-update', (data) => {
  if (data.source === 'side') {
    sideFeedImg.src = data.frame;
    sideFeedImg.style.display = 'block';
    sidePlaceholder.style.display = 'none';
  }
});

socket.on('pose-update', (data) => {
  if (data.source !== 'side' || isPaused || workoutDone || menuActive || endScreenActive) return;

  sideLastSeen = Date.now();
  sideDot.classList.add('live');

  if (!timerStart) startTimer();

  const sideAR = data.aspectRatio || 1;  // video width/height from phone camera
  const result = squat.update(data.landmarks, data.poseValid !== false, sideAR);

  // Update rep count (relative to current set)
  const setReps = result.repCount - (currentSet - 1) * REPS_PER_SET;
  repCountEl.textContent = Math.max(0, setReps);

  if (!result.trackingLost) {
    trackingWarning.style.display = 'none';

    // ---- Accumulate per-rep form metrics ----
    const { kneeAngle } = result;
    if (kneeAngle !== null) {
      // Track minimum knee angle (deepest point of the rep)
      if (repMinKneeAngle === null || kneeAngle < repMinKneeAngle) {
        repMinKneeAngle = kneeAngle;
      }

      // Track worst (lowest) valgus ratio throughout the entire rep
      if (latestFrontValgusRatio !== null) {
        if (repKneeValgusRatio === null || latestFrontValgusRatio < repKneeValgusRatio) {
          repKneeValgusRatio = latestFrontValgusRatio;
        }
      }

      // Forward lean: torso angle from vertical in degrees (0 = upright, 45+ = severe lean)
      // Corrected for video aspect ratio to avoid portrait-mode distortion
      const shoulder = data.landmarks.shoulder;
      const hip = data.landmarks.hip;
      if (shoulder && hip && shoulder.visibility > 0.3) {
        const dx = Math.abs(shoulder.x - hip.x) * sideAR;  // correct for aspect ratio
        const dy = Math.abs(hip.y - shoulder.y);
        const leanDeg = dy > 0.01 ? Math.atan2(dx, dy) * (180 / Math.PI) : 0;
        if (leanDeg > repMaxForwardLean) repMaxForwardLean = leanDeg;
        // Throttled debug (every ~2s)
        if (Date.now() - _lastLeanLog > 2000) {
          _lastLeanLog = Date.now();
          console.log(`[debug] AR=${sideAR.toFixed(2)} kneeAngle=${kneeAngle}° lean=${leanDeg.toFixed(1)}° maxLean=${repMaxForwardLean.toFixed(1)}° minKnee=${repMinKneeAngle}°`);
        }
      } else if (!shoulder) {
        if (!_warnedNoShoulder) {
          console.warn('[lean] No shoulder data — phone may be running cached code. Reload phone page.');
          _warnedNoShoulder = true;
        }
      }

      _liveKneeAngle = kneeAngle;
      _liveLeanDeg = (shoulder && hip && shoulder.visibility > 0.3)
        ? Math.atan2(Math.abs(shoulder.x - hip.x) * sideAR, Math.abs(hip.y - shoulder.y)) * (180 / Math.PI)
        : null;
    }
    // Hold time accumulation (only when at depth)
    if (reachedTargetDepth && kneeAngle !== null && kneeAngle <= TARGET_DEPTH_ANGLE) {
      repHoldMs += 33; // ~33ms per frame at 30fps
    }

    updateDebugOverlay(_liveKneeAngle, _liveLeanDeg, sideAR);
    updateCoaching(result, setReps);

    // Check set completion
    if (setReps >= REPS_PER_SET) {
      completeSet();
    }
  } else {
    trackingWarning.style.display = 'block';
  }
});

socket.on('client-status', ({ source, connected }) => {
  if (source === 'side' && !connected) {
    sideDot.classList.remove('live');
    setCue('Side camera disconnected', false, true);
  }
  // Show camera tips the first time the side camera connects (only during workout)
  if (source === 'side' && connected && !menuActive && !cameraTipsShown && !cameraTipsDismissed) {
    cameraTipsShown = true;
    const tipsEl = document.getElementById('camera-tips');
    if (tipsEl) tipsEl.style.display = 'block';
    // Auto-dismiss after 12 seconds
    setTimeout(() => { dismissCameraTips(); }, 12000);
  }
});

// Camera tips dismiss
function dismissCameraTips() {
  const tipsEl = document.getElementById('camera-tips');
  if (tipsEl) tipsEl.style.display = 'none';
  cameraTipsDismissed = true;
}
const dismissTipsBtn = document.getElementById('dismiss-tips');
if (dismissTipsBtn) dismissTipsBtn.addEventListener('click', dismissCameraTips);

// ==========================================================================
// 4. SET MANAGEMENT
// ==========================================================================
function completeSet() {
  isPaused = true; // freeze counting temporarily

  if (currentSet >= TOTAL_SETS) {
    // Workout done!
    workoutDone = true;
    setCompleteTxt.textContent = 'Workout Complete!';
    setCompleteOvl.style.display = 'flex';
    celebrateSet();
    playApplause();
    setCue('Amazing work!', true, true);
    updateSetUI();

    // After a short celebration, show the end screen with hand tracking
    setTimeout(() => {
      setCompleteOvl.style.display = 'none';
      showEndScreen();
    }, 3500);
    return;
  }

  setCompleteTxt.textContent = 'Set ' + currentSet + ' Complete!';
  setCompleteOvl.style.display = 'flex';
  celebrateSet();
  playApplause();

  // Advance to next set after 3 seconds
  setTimeout(() => {
    setCompleteOvl.style.display = 'none';
    currentSet++;
    updateSetUI();
    repCountEl.textContent = '0';
    isPaused = false;
    lastState = 'UP';
    setCue('Set ' + currentSet + ' — go when ready', false, true);
  }, 3000);
}

function updateSetUI() {
  setInfoEl.textContent = 'Set ' + Math.min(currentSet, TOTAL_SETS) + ' of ' + TOTAL_SETS;
  const dots = setDotsEl.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = 'set-dot';
    if (i < currentSet - 1) dots[i].classList.add('done');
    else if (i === currentSet - 1) dots[i].classList.add('active');
  }
}

// ==========================================================================
// 5. COACHING CUES (throttled + depth-aware)
// ==========================================================================
function updateCoaching(result, setReps) {
  const { state, kneeAngle } = result;

  // ---- State transitions ----
  if (state !== lastState) {
    if (state === 'DOWN') {
      // Just crossed the down threshold (~100°) — still on the way down
      reachedTargetDepth = false;
      reachedDepthTime   = 0;
      lastDepthPhase     = '';
      setCue('Almost there…', true);
    } else if (state === 'UP' && lastState === 'DOWN') {
      // Coming back up — rep may have counted
      reachedTargetDepth = false;
      reachedDepthTime   = 0;
      lastDepthPhase     = '';

      // ---- Form Coach: evaluate this rep ----
      const repMetrics = {
        minKneeAngle:    repMinKneeAngle,
        maxForwardLean:  Math.round(repMaxForwardLean * 10) / 10,
        kneeValgusRatio: repKneeValgusRatio !== null ? Math.round(repKneeValgusRatio * 100) / 100 : null,
        holdMs:          repHoldMs,
      };
      console.log('[FormCoach] Rep metrics:', JSON.stringify(repMetrics));
      const coachResult = formCoach.recordRep(repMetrics);
      if (coachResult.correction) {
        console.log('[FormCoach] Correction:', coachResult.correction, '| Watch:', [...coachResult.watchIssues]);
      }
      if (coachResult.clearedIssues.length > 0) {
        console.log('[FormCoach] Cleared:', coachResult.clearedIssues);
      }
      // Reset per-rep accumulators for next rep
      repMinKneeAngle   = null;
      repMaxForwardLean  = 0;
      repHoldMs          = 0;
      repKneeValgusRatio = null;

      // Handle cleared issues (positive reinforcement)
      if (coachResult.clearedIssues.length > 0) {
        const msg = formCoach.getClearedMessage(coachResult.clearedIssues[0]);
        showFeedback(msg || pickFeedback());
        setCue(msg || 'Keep going!', true, true);
        coachingCueEl.classList.remove('correction');
        coachingCueEl.classList.add('correction-cleared');
        setTimeout(() => coachingCueEl.classList.remove('correction-cleared'), 2000);
        showCorrectionBanner(msg || 'Looking good!', true, 3000);
      }
      // Handle new or ongoing correction
      else if (coachResult.correction) {
        setCue(coachResult.correction, true, true);
        coachingCueEl.classList.add('correction');
        coachingCueEl.classList.remove('correction-cleared');
        showFeedback('');  // suppress random positive feedback during correction
        showCorrectionBanner(coachResult.correction, false, 5000);
      }
      // Normal positive feedback
      else {
        coachingCueEl.classList.remove('correction', 'correction-cleared');
        hideCorrectionBanner();
        showFeedback(pickFeedback());
        const remaining = REPS_PER_SET - setReps;
        if (remaining > 0 && remaining <= 3) {
          setCue(remaining + ' more to go!', true);
        } else {
          setCue('Keep going!', true);
        }
      }
    }
    lastState = state;
    return;
  }

  // ---- Steady-state cues ----
  if (state === 'UP') {
    if (kneeAngle !== null && kneeAngle > 160) {
      setCue('Go down when ready');
    }
  } else if (state === 'DOWN' && kneeAngle !== null) {
    // Track whether they've reached target depth (≤ 95°)
    if (!reachedTargetDepth && kneeAngle <= TARGET_DEPTH_ANGLE) {
      reachedTargetDepth = true;
      reachedDepthTime   = Date.now();
    }

    if (!reachedTargetDepth) {
      // Still descending, haven't hit proper depth yet
      const forceDescend = lastDepthPhase !== 'descending';
      lastDepthPhase = 'descending';
      setCue('Go lower…', true, forceDescend);
    } else {
      // They've reached depth!
      const holdTime = Date.now() - reachedDepthTime;
      if (holdTime < HOLD_DURATION_MS) {
        const forceHold = lastDepthPhase !== 'hold';
        lastDepthPhase = 'hold';
        setCue('Hold!', true, forceHold);
      } else {
        const forceDrive = lastDepthPhase !== 'drive';
        lastDepthPhase = 'drive';
        setCue('Good! Drive up!', true, forceDrive);
      }
    }
  }
}

function setCue(text, highlight = false, force = false) {
  if (text === lastCueText && !force) return;
  const now = Date.now();
  if (!force && now - lastCueTime < MIN_CUE_INTERVAL) return;
  lastCueText = text;
  lastCueTime = now;
  coachingCueEl.textContent = text;
  coachingCueEl.classList.toggle('highlight', highlight);
}

// ---- Correction banner (large, center-screen) ----
let correctionBannerTimer = null;
function showCorrectionBanner(text, isCleared = false, durationMs = 4000) {
  if (!correctionBanner || !correctionBannerText) return;
  clearTimeout(correctionBannerTimer);
  correctionBannerText.textContent = text;
  correctionBanner.classList.remove('fade-out', 'cleared');
  if (isCleared) correctionBanner.classList.add('cleared');
  correctionBanner.style.display = '';
  // Force reflow so animation replays
  void correctionBanner.offsetWidth;
  correctionBanner.style.animation = 'none';
  void correctionBanner.offsetWidth;
  correctionBanner.style.animation = '';

  correctionBannerTimer = setTimeout(() => {
    correctionBanner.classList.add('fade-out');
    setTimeout(() => { correctionBanner.style.display = 'none'; }, 400);
  }, durationMs);
}

function hideCorrectionBanner() {
  if (!correctionBanner) return;
  clearTimeout(correctionBannerTimer);
  correctionBanner.style.display = 'none';
}

const FEEDBACK_LINES = ['Nice rep!', 'Solid!', 'Good form!', 'Strong!', 'Keep it up!', 'Smooth!', 'Nailed it!', 'Clean!'];
function pickFeedback() { return FEEDBACK_LINES[Math.floor(Math.random() * FEEDBACK_LINES.length)]; }

function showFeedback(text) {
  feedbackEl.textContent = text;
  feedbackEl.style.opacity = '1';
  clearTimeout(feedbackTimeout);
  feedbackTimeout = setTimeout(() => { feedbackEl.style.opacity = '0'; }, 1500);
}

// ==========================================================================
// 6. TIMER
// ==========================================================================
function startTimer() {
  timerStart = Date.now();
  startTimerFrom(timerStart);
}

function startTimerFrom(start) {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    timerEl.textContent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
  }, 250);
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerStart = 0;
  timerEl.textContent = '00:00';
}

// ==========================================================================
// 7. RESET
// ==========================================================================
resetBtn.addEventListener('click', () => {
  squat.reset();
  formCoach.reset();
  currentSet = 1;
  isPaused = false;
  workoutDone = false;
  lastState = 'UP';
  lastCueText = '';
  reachedTargetDepth = false;
  reachedDepthTime   = 0;
  lastDepthPhase     = '';
  repMinKneeAngle = null; repMaxForwardLean = 0; repHoldMs = 0; repKneeValgusRatio = null;
  repCountEl.textContent = '0';
  feedbackEl.textContent = '';
  feedbackEl.style.opacity = '0';
  trackingWarning.style.display = 'none';
  pauseOverlay.style.display = 'none';
  setCompleteOvl.style.display = 'none';
  coachingCueEl.classList.remove('correction', 'correction-cleared');
  hideCorrectionBanner();
  updateSetUI();
  setCue('Go down when ready', false, true);
  resetTimer();
});

// Stale check
setInterval(() => {
  if (sideLastSeen > 0 && Date.now() - sideLastSeen > 3000) sideDot.classList.remove('live');
}, 1000);

// ==========================================================================
// DEBUG OVERLAY — toggle with Ctrl+D
// ==========================================================================
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'd') {
    e.preventDefault();
    _debugEnabled = !_debugEnabled;
    if (debugOverlay) debugOverlay.style.display = _debugEnabled ? 'block' : 'none';
  }
});

function updateDebugOverlay(kneeAngle, leanDeg, ar) {
  if (!_debugEnabled || !debugOverlay) return;
  if (Date.now() - _lastDebugUpdate < 200) return; // throttle to 5fps
  _lastDebugUpdate = Date.now();
  const streaks = formCoach._state;
  const lines = [
    `Knee: ${kneeAngle !== null ? kneeAngle + '°' : '--'}  (down<115° good<95°)`,
    `Lean: ${leanDeg !== null ? leanDeg.toFixed(1) + '°' : '--'}  (warn>45°)`,
    `AR: ${ar.toFixed(2)}  MinKnee: ${repMinKneeAngle ?? '--'}°  MaxLean: ${repMaxForwardLean.toFixed(1)}°`,
    `Hold: ${repHoldMs}ms  Valgus: ${repKneeValgusRatio !== null ? repKneeValgusRatio.toFixed(2) : '--'}`,
    `Streaks: depth=${streaks.shallowDepth.badStreak} lean=${streaks.forwardLean.badStreak} valgus=${streaks.kneeValgus.badStreak} hold=${streaks.shortHold.badStreak}`,
    `Watch: ${[...formCoach.getWatchIssues()].join(', ') || 'none'}`,
  ];
  debugOverlay.innerHTML = lines.join('<br>');
}

// ==========================================================================
// 8. CELEBRATIONS & SOUNDS
// ==========================================================================
function celebrateSet() {
  if (window.confetti) {
    // Big burst from multiple origins, with high z-index to stay above overlays
    const defaults = { zIndex: 9999, disableForReducedMotion: true };
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        window.confetti({ ...defaults, particleCount: 80, spread: 100, startVelocity: 45, origin: { x: 0.1 + i * 0.2, y: 0.6 } });
        window.confetti({ ...defaults, particleCount: 40, spread: 60, startVelocity: 55, origin: { x: 0.1 + i * 0.2, y: 0.8 }, scalar: 1.4 });
      }, i * 150);
    }
  }
}

function playApplause() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Chord (C major) for a triumphant feel
    const freqs = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05 + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2 + i * 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.08);
      osc.stop(ctx.currentTime + 1.5);
    });

    // Applause-like noise burst
    const duration = 2;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.8));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 3000;
    bandpass.Q.value = 0.5;
    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + duration);

    setTimeout(() => ctx.close(), 3000);
  } catch (e) { /* audio unsupported */ }
}

// ==========================================================================
// 9. DRAW SKELETON (with optional form-correction highlights)
// ==========================================================================
function drawSkeleton(ctx, w, h, landmarks) {
  const highlights = formCoach.getHighlightIndices(); // Set of landmark indices to highlight

  // ---- Draw connections ----
  ctx.lineWidth = 3;
  for (const [i, j] of CONNECTIONS) {
    const a = landmarks[i], b = landmarks[j];
    if (a.visibility > 0.3 && b.visibility > 0.3) {
      // Amber if either end is highlighted
      ctx.strokeStyle = (highlights.has(i) || highlights.has(j))
        ? 'rgba(255, 180, 50, 0.9)'
        : 'rgba(0, 210, 160, 0.8)';
      ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
    }
  }

  // ---- Draw keypoints ----
  for (const idx of ALL_KEYPOINTS) {
    const pt = landmarks[idx];
    if (pt.visibility > 0.3) {
      const isHighlighted = highlights.has(idx);
      const radius = isHighlighted ? 7 : 5;

      ctx.beginPath(); ctx.arc(pt.x * w, pt.y * h, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isHighlighted ? 'rgba(255, 160, 40, 0.95)' : 'rgba(124, 108, 240, 0.9)';
      ctx.fill();
      ctx.strokeStyle = isHighlighted ? 'rgba(255, 100, 20, 0.8)' : '#fff';
      ctx.lineWidth = isHighlighted ? 2.5 : 1.5;
      ctx.stroke();

      // Pulsing glow on highlighted joints
      if (isHighlighted) {
        ctx.beginPath(); ctx.arc(pt.x * w, pt.y * h, 12, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 160, 40, 0.15)'; ctx.fill();
      }
    }
  }
}

// ==========================================================================
// 10. MAIN MENU — GESTURE CURSOR + SELECTION
// ==========================================================================

// ---- Camera preview (PiP) ----
const SKELETON_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]
];

function drawMenuPreview(lm) {
  if (!menuCamCtx || !menuCamCanvas || !frontVideo) return;
  // Match canvas resolution to element size once
  const rect = menuCamCanvas.getBoundingClientRect();
  if (menuCamCanvas.width !== rect.width || menuCamCanvas.height !== rect.height) {
    menuCamCanvas.width  = rect.width  * devicePixelRatio;
    menuCamCanvas.height = rect.height * devicePixelRatio;
  }
  const w = menuCamCanvas.width, h = menuCamCanvas.height;
  menuCamCtx.clearRect(0, 0, w, h);

  // Draw camera frame
  if (frontVideo.readyState >= 2) {
    menuCamCtx.drawImage(frontVideo, 0, 0, w, h);
  }

  if (!lm || !handTrackingOn) return;

  // Draw skeleton lines
  menuCamCtx.strokeStyle = 'rgba(124,108,240,0.7)';
  menuCamCtx.lineWidth = 2;
  for (const [a, b] of SKELETON_CONNECTIONS) {
    if (lm[a].visibility > 0.4 && lm[b].visibility > 0.4) {
      menuCamCtx.beginPath();
      menuCamCtx.moveTo(lm[a].x * w, lm[a].y * h);
      menuCamCtx.lineTo(lm[b].x * w, lm[b].y * h);
      menuCamCtx.stroke();
    }
  }

  // Draw joints
  menuCamCtx.fillStyle = '#7c6cf0';
  for (let i = 0; i < lm.length; i++) {
    if (lm[i].visibility > 0.4) {
      menuCamCtx.beginPath();
      menuCamCtx.arc(lm[i].x * w, lm[i].y * h, 3, 0, Math.PI * 2);
      menuCamCtx.fill();
    }
  }

  // Highlight the tracked wrist with a ring
  const lw = lm[WRIST.LEFT], rw = lm[WRIST.RIGHT];
  let wrist = null;
  if (lw.visibility > 0.5 && rw.visibility > 0.5) wrist = lw.y < rw.y ? lw : rw;
  else if (lw.visibility > 0.5) wrist = lw;
  else if (rw.visibility > 0.5) wrist = rw;

  if (wrist) {
    menuCamCtx.strokeStyle = '#00ffa0';
    menuCamCtx.lineWidth = 2;
    menuCamCtx.beginPath();
    menuCamCtx.arc(wrist.x * w, wrist.y * h, 10, 0, Math.PI * 2);
    menuCamCtx.stroke();
  }
}

// ---- Cursor tracking ----
// ---- Right-hand cursor settings ----
// GAIN: how much small wrist movements get amplified.
//   2.0 = moving wrist across half the camera frame covers the full screen.
const CURSOR_CENTER_X = 0.50;
const CURSOR_CENTER_Y = 0.50;
const CURSOR_GAIN_X   = 2.0;
const CURSOR_GAIN_Y   = 1.8;
const CURSOR_SMOOTH   = 0.14;   // lower = smoother / less twitchy

function updateMenuCursor(landmarks) {
  // Always use the RIGHT wrist (landmark 16)
  const wrist = landmarks[WRIST.RIGHT];
  if (!wrist || wrist.visibility < 0.4) { hideGestureCursor(); return; }

  // Mirror the x-axis (front camera) then amplify from centre
  const mirroredX = 1 - wrist.x;
  const dx = (mirroredX - CURSOR_CENTER_X) * CURSOR_GAIN_X;
  const dy = (wrist.y   - CURSOR_CENTER_Y) * CURSOR_GAIN_Y;

  // Map to screen, clamped to viewport
  const targetX = Math.max(0, Math.min(window.innerWidth,  (0.5 + dx) * window.innerWidth));
  const targetY = Math.max(0, Math.min(window.innerHeight, (0.5 + dy) * window.innerHeight));

  // Heavy smoothing to kill jitter
  smoothCursorX += (targetX - smoothCursorX) * CURSOR_SMOOTH;
  smoothCursorY += (targetY - smoothCursorY) * CURSOR_SMOOTH;

  showGestureCursor(smoothCursorX, smoothCursorY);
  checkMenuDwell(smoothCursorX, smoothCursorY);
}

function showGestureCursor(x, y) {
  if (!gestureCursor) return;
  gestureCursor.style.left = x + 'px';
  gestureCursor.style.top  = y + 'px';
  gestureCursor.style.opacity = '1';
}

function hideGestureCursor() {
  if (gestureCursor) gestureCursor.style.opacity = '0';
  clearMenuHover();
}

// ---- Dwell-to-select ----
function checkMenuDwell(cx, cy) {
  // Find element under cursor — works on both menu cards and end-screen buttons
  const el = document.elementFromPoint(cx, cy);
  const card = el ? (el.closest('.menu-card.selectable') || el.closest('.end-btn.selectable')) : null;

  if (card) {
    if (card !== hoveredCard) {
      // Entering a new card
      clearMenuHover();
      hoveredCard = card;
      hoverStartTime = Date.now();
      card.classList.add('gesture-hover');
    }

    // Update progress
    const elapsed = Date.now() - hoverStartTime;
    const progress = Math.min(elapsed / DWELL_MS, 1);
    updateCursorProgress(progress);
    updateCardRingProgress(card, progress);

    if (progress >= 1) {
      // Determine what was selected
      if (card.dataset.workout) {
        selectWorkout(card.dataset.workout);
      } else if (card.dataset.action) {
        handleEndScreenAction(card.dataset.action);
      }
    }
  } else {
    clearMenuHover();
  }
}

function clearMenuHover() {
  if (hoveredCard) {
    hoveredCard.classList.remove('gesture-hover');
    updateCardRingProgress(hoveredCard, 0);
  }
  hoveredCard = null;
  hoverStartTime = 0;
  updateCursorProgress(0);
}

function updateCursorProgress(progress) {
  if (!cursorFillRing) return;
  const offset = CURSOR_CIRCUMFERENCE * (1 - progress);
  cursorFillRing.style.strokeDashoffset = offset;
  cursorFillRing.style.stroke = progress > 0.7 ? '#00d2a0' : '#7c6cf0';
}

function updateCardRingProgress(card, progress) {
  const fill = card.querySelector('.ring-fill');
  if (!fill) return;
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  fill.style.strokeDashoffset = offset;
}

// ---- Selection ----
function selectWorkout(workoutId) {
  menuActive = false;
  endScreenActive = false;

  // Hide menu + cursor + camera preview
  if (mainMenuEl)      mainMenuEl.style.display = 'none';
  if (gestureCursor)   gestureCursor.style.opacity = '0';
  if (menuCamPreview)  menuCamPreview.style.display = 'none';
  if (workoutEndScreen) workoutEndScreen.style.display = 'none';

  // Reset workout state
  squat.reset();
  formCoach.reset();
  currentSet = 1;
  isPaused = false;
  workoutDone = false;
  lastState = 'UP';
  lastCueText = '';
  reachedTargetDepth = false;
  reachedDepthTime   = 0;
  lastDepthPhase     = '';
  repMinKneeAngle = null; repMaxForwardLean = 0; repHoldMs = 0; repKneeValgusRatio = null;
  repCountEl.textContent = '0';
  feedbackEl.textContent = '';
  feedbackEl.style.opacity = '0';
  trackingWarning.style.display = 'none';
  pauseOverlay.style.display = 'none';
  setCompleteOvl.style.display = 'none';
  coachingCueEl.classList.remove('correction', 'correction-cleared');
  hideCorrectionBanner();
  updateSetUI();
  resetTimer();
  setCue('Go down when ready', false, true);

  // Show a small tooltip near the help button for 5 seconds
  showHelpTooltip();
}

// Click to select (mouse alternative)
document.querySelectorAll('.menu-card.selectable').forEach((card) => {
  card.addEventListener('click', () => {
    selectWorkout(card.dataset.workout);
  });
});

// ==========================================================================
// 11. HELP BUTTON — reopen camera tips
// ==========================================================================
const helpBtn = document.getElementById('help-btn');
if (helpBtn) {
  helpBtn.addEventListener('click', () => {
    const tipsEl = document.getElementById('camera-tips');
    if (tipsEl) {
      cameraTipsDismissed = false;
      cameraTipsShown = true;
      tipsEl.style.display = 'block';
      setTimeout(() => dismissCameraTips(), 12000);
    }
  });
}

// ==========================================================================
// 12. EXERCISE DEMO IMAGE / GIF
// ==========================================================================
const demoImg = document.getElementById('exercise-demo-img');
const demoPlaceholder = document.getElementById('demo-placeholder');

function showDemoImg() {
  if (demoPlaceholder) demoPlaceholder.style.display = 'none';
  if (demoImg) demoImg.style.display = 'block';
}
function hideDemoImg() {
  if (demoImg) demoImg.style.display = 'none';
  if (demoPlaceholder) demoPlaceholder.style.display = 'flex';
}

if (demoImg) {
  demoImg.addEventListener('load', showDemoImg);
  demoImg.addEventListener('error', hideDemoImg);

  // Handle case where image already loaded/errored before listeners attached
  if (demoImg.complete) {
    if (demoImg.naturalWidth > 0) showDemoImg();
    else hideDemoImg();
  }
}

// GIF pause/play toggle
const gifPauseBtn = document.getElementById('gif-pause-btn');
let gifPaused = false;
let gifOriginalSrc = demoImg ? demoImg.src : '';
let gifFrozenDataUrl = null;

if (gifPauseBtn && demoImg) {
  gifPauseBtn.addEventListener('click', () => {
    if (!gifPaused) {
      // Freeze: capture current frame to a canvas, swap src to data URL
      const c = document.createElement('canvas');
      c.width = demoImg.naturalWidth;
      c.height = demoImg.naturalHeight;
      c.getContext('2d').drawImage(demoImg, 0, 0);
      gifFrozenDataUrl = c.toDataURL();
      demoImg.src = gifFrozenDataUrl;
      gifPauseBtn.textContent = '▶';
      gifPauseBtn.title = 'Play demo';
    } else {
      // Resume: restore original animated source
      demoImg.src = gifOriginalSrc;
      gifPauseBtn.textContent = '⏸';
      gifPauseBtn.title = 'Pause demo';
    }
    gifPaused = !gifPaused;
  });
}

// ==========================================================================
// 13. BACK TO MENU BUTTON
// ==========================================================================
const backToMenuBtn = document.getElementById('back-to-menu-btn');
if (backToMenuBtn) {
  backToMenuBtn.addEventListener('click', () => {
    // Stop workout, reset state
    isPaused = true;
    workoutDone = false;
    clearInterval(timerInterval);
    timerInterval = null;

    // Hide all overlays
    pauseOverlay.style.display = 'none';
    setCompleteOvl.style.display = 'none';
    trackingWarning.style.display = 'none';
    if (workoutEndScreen) workoutEndScreen.style.display = 'none';

    // Show the main menu with hand tracking
    menuActive = true;
    endScreenActive = false;
    if (mainMenuEl)     mainMenuEl.style.display = '';
    if (menuCamPreview) menuCamPreview.style.display = '';
  });
}

// ==========================================================================
// 14. HELP TOOLTIP (5-second popup)

// ==========================================================================
let helpTooltipTimer = null;
function showHelpTooltip() {
  if (!helpTooltipEl) return;
  clearTimeout(helpTooltipTimer);
  helpTooltipEl.style.display = 'block';
  helpTooltipTimer = setTimeout(() => {
    if (helpTooltipEl) helpTooltipEl.style.display = 'none';
  }, 5000);
}

// ==========================================================================
// 15. WORKOUT END SCREEN
// ==========================================================================
function showEndScreen() {
  endScreenActive = true;
  if (workoutEndScreen) workoutEndScreen.style.display = 'flex';
  if (menuCamPreview)   menuCamPreview.style.display = '';  // show cam preview
  if (gestureCursor)    gestureCursor.style.opacity = '0';  // will show on hand detect
}

function handleEndScreenAction(action) {
  clearMenuHover();
  endScreenActive = false;
  if (workoutEndScreen) workoutEndScreen.style.display = 'none';
  if (gestureCursor)    gestureCursor.style.opacity = '0';
  if (menuCamPreview)   menuCamPreview.style.display = 'none';

  if (action === 'again') {
    selectWorkout('deep-squat');
  } else if (action === 'menu') {
    // Go back to main menu
    menuActive = true;
    if (mainMenuEl)     mainMenuEl.style.display = '';
    if (menuCamPreview) menuCamPreview.style.display = '';
  }
}

// Click support for end-screen buttons
document.querySelectorAll('.end-btn.selectable').forEach((btn) => {
  btn.addEventListener('click', () => {
    handleEndScreenAction(btn.dataset.action);
  });
});

// ==========================================================================
// 16. QR CODE FOR PHONE CAMERA (room-aware)
// ==========================================================================
const qrBox  = document.getElementById('qr-box');
const qrNote = document.getElementById('qr-note');
const roomCodeEl = document.getElementById('room-code');

function generateMenuQR() {
  if (!qrBox || typeof qrcode === 'undefined' || !roomCode) return;

  // Build the side-camera URL using the current origin + room code
  const loc = window.location;
  const sideUrl = `${loc.protocol}//${loc.host}/side?room=${roomCode}`;

  // Show the room code on screen
  if (roomCodeEl) roomCodeEl.textContent = roomCode;

  try {
    const qr = qrcode(0, 'M');
    qr.addData(sideUrl);
    qr.make();
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
    const svg = qrBox.querySelector('svg');
    if (svg) {
      svg.style.width = '80px';
      svg.style.height = '80px';
      svg.style.borderRadius = '6px';
      svg.style.background = '#fff';
      svg.style.padding = '4px';
    }
    console.log('QR code URL:', sideUrl);
  } catch (e) {
    console.warn('QR generation failed:', e);
    qrBox.style.display = 'none';
  }
}

// ==========================================================================
// GO — ensure room is created, then init everything
// ==========================================================================
(async () => {
  await ensureRoom();
  joinRoom();
  generateMenuQR();
  initFrontCamera();
})();
