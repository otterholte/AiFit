/**
 * FormCoach — streak-based form correction system.
 *
 * Tracks per-rep form issues across multiple reps and only surfaces a
 * correction after the same problem appears N times in a row.
 * Once a correction is shown, it enters "watch mode" for that issue —
 * the dashboard highlights the relevant joints until the user does
 * M consecutive clean reps, then auto-clears.
 *
 * Usage:
 *   const coach = new FormCoach();
 *   // on each completed rep:
 *   const result = coach.recordRep({ minKneeAngle, maxForwardLean, kneeValgusRatio, holdMs });
 *   // result.correction  — string to show, or null
 *   // result.watchIssues — Set of active issue keys being watched
 *   // result.clearedIssues — array of issue keys just cleared this rep
 */

/* eslint-disable no-unused-vars */
class FormCoach {
  constructor(options = {}) {
    // How many consecutive bad reps before we warn
    this.STREAK_TO_WARN  = options.streakToWarn  || 3;
    // How many consecutive clean reps to clear a watch
    this.CLEAN_TO_CLEAR  = options.cleanToClear  || 2;

    // ---- Thresholds ----
    this.DEPTH_ANGLE_OK       = options.depthAngle       || 95;    // must reach ≤ 95° (thighs near parallel)
    this.FORWARD_LEAN_LIMIT   = options.forwardLeanLimit  || 55;    // torso angle from vertical (normal squat 30-50°, flag only severe)
    this.VALGUS_RATIO_LIMIT   = options.valgusRatioLimit  || 0.70;  // kneeWidth / ankleWidth < this = severe cave-in (feet angle out naturally)
    this.MIN_HOLD_MS          = options.minHoldMs         || 400;   // ms at depth
    this.HEEL_RISE_LIMIT      = options.heelRiseLimit     || 0.025; // normalised ankle-Y rise (side cam)
    this.HIP_SHIFT_LIMIT      = options.hipShiftLimit     || 0.04;  // normalised lateral hip drift (front cam)

    // ---- Issue definitions ----
    this.ISSUES = {
      shallowDepth: {
        label: 'shallowDepth',
        test: (rep) => rep.minKneeAngle !== null && rep.minKneeAngle > this.DEPTH_ANGLE_OK,
        correction: 'Try going a bit deeper — aim to get your thighs parallel',
        cleared: 'Great depth!',
        highlights: [25, 26, 27, 28], // knees + ankles
      },
      kneeValgus: {
        label: 'kneeValgus',
        test: (rep) => rep.kneeValgusRatio !== null && rep.kneeValgusRatio < this.VALGUS_RATIO_LIMIT,
        correction: 'Knees are caving inside your ankles — push them out over your toes',
        cleared: 'Knees tracking nicely over your feet!',
        highlights: [25, 26, 27, 28], // knees + ankles
      },
      forwardLean: {
        label: 'forwardLean',
        test: (rep) => rep.maxForwardLean > this.FORWARD_LEAN_LIMIT,
        correction: 'Leaning too far forward — keep your chest up and back straight',
        cleared: 'Nice upright posture!',
        highlights: [11, 12, 23, 24], // shoulders + hips
      },
      heelRise: {
        label: 'heelRise',
        test: (rep) => rep.heelRise > this.HEEL_RISE_LIMIT,
        correction: 'Heels are lifting — press through your whole foot, especially the heels',
        cleared: 'Feet are solid!',
        highlights: [27, 28], // ankles
      },
      hipShift: {
        label: 'hipShift',
        test: (rep) => rep.hipShift > this.HIP_SHIFT_LIMIT,
        correction: 'You\'re shifting to one side — try to keep your weight centered',
        cleared: 'Nice and balanced!',
        highlights: [23, 24], // hips
      },
      shortHold: {
        label: 'shortHold',
        // Only check hold time when the person actually reached depth
        test: (rep) => rep.minKneeAngle !== null &&
                       rep.minKneeAngle <= this.DEPTH_ANGLE_OK &&
                       rep.holdMs < this.MIN_HOLD_MS,
        correction: 'Hold the bottom position a beat longer — pause for a full second',
        cleared: 'Nice hold!',
        highlights: [23, 24, 25, 26], // hips + knees
      },
    };

    // ---- Internal state ----
    // Per-issue: { badStreak, cleanStreak, watching }
    this._state = {};
    for (const key of Object.keys(this.ISSUES)) {
      this._state[key] = { badStreak: 0, cleanStreak: 0, watching: false };
    }
  }

  /**
   * Call once per completed rep with that rep's metrics.
   *
   * @param {Object} rep
   * @param {number|null} rep.minKneeAngle  — lowest knee angle during the rep
   * @param {number}      rep.maxForwardLean — torso angle from vertical in degrees (0=upright)
   * @param {number|null} rep.kneeValgusRatio — kneeWidth / hipWidth at deepest point (from front cam)
   * @param {number|null} rep.holdMs         — ms spent at depth
   *
   * @returns {{ correction: string|null, watchIssues: Set<string>, clearedIssues: string[] }}
   */
  recordRep(rep) {
    let correction = null;        // first new correction to surface (only one per rep)
    const clearedIssues = [];
    const badThisRep = new Set();  // track which issues were bad this specific rep

    for (const [key, issue] of Object.entries(this.ISSUES)) {
      const s = this._state[key];
      const bad = issue.test(rep);

      if (bad) {
        badThisRep.add(key);
        s.badStreak++;
        s.cleanStreak = 0;

        // Trigger a new correction once the streak hits the threshold
        if (s.badStreak >= this.STREAK_TO_WARN && !s.watching) {
          s.watching = true;
          if (!correction) correction = issue.correction;
        }
      } else {
        // Good rep for this issue
        s.badStreak = 0;
        s.cleanStreak++;

        if (s.watching && s.cleanStreak >= this.CLEAN_TO_CLEAR) {
          // Issue resolved
          s.watching = false;
          s.cleanStreak = 0;
          clearedIssues.push(key);
        }
      }
    }

    // Only re-show a watched correction if the issue is STILL bad this rep.
    // Don't nag on clean reps — let the user feel the improvement.
    if (!correction) {
      for (const [key, issue] of Object.entries(this.ISSUES)) {
        if (this._state[key].watching && badThisRep.has(key)) {
          correction = issue.correction;
          break;
        }
      }
    }

    return {
      correction,
      watchIssues: this.getWatchIssues(),
      clearedIssues,
    };
  }

  /** Returns a Set of issue keys currently being watched. */
  getWatchIssues() {
    const set = new Set();
    for (const [key, s] of Object.entries(this._state)) {
      if (s.watching) set.add(key);
    }
    return set;
  }

  /** Returns a Set of landmark indices that should be highlighted. */
  getHighlightIndices() {
    const indices = new Set();
    for (const [key, issue] of Object.entries(this.ISSUES)) {
      if (this._state[key].watching) {
        for (const idx of issue.highlights) indices.add(idx);
      }
    }
    return indices;
  }

  /** Get the cleared-message text for a given issue key. */
  getClearedMessage(key) {
    return this.ISSUES[key] ? this.ISSUES[key].cleared : '';
  }

  /** Full reset (e.g. on workout reset or new set). */
  reset() {
    for (const key of Object.keys(this._state)) {
      this._state[key] = { badStreak: 0, cleanStreak: 0, watching: false };
    }
  }
}

