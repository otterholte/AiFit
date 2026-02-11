/**
 * SquatDetector — state machine for counting squats within structured sets.
 *
 * Accepts an external `poseValid` flag so the caller can gate on
 * whether the detected pose is actually a real person (vs. furniture).
 */

class SquatDetector {
  constructor(options = {}) {
    this.downAngleThreshold = options.downAngle || 100;
    this.upAngleThreshold   = options.upAngle   || 160;
    this.minDownDuration    = options.minDownDuration || 150;
    this.minRepInterval     = options.minRepInterval  || 400;
    this.minConfidence      = options.minConfidence   || 0.3;
    this.trackingLostGraceMs = options.trackingLostGraceMs || 500;

    this.state              = 'UP';
    this.repCount           = 0;
    this.lastTransitionTime = 0;
    this.downStartTime      = 0;
    this._trackingLostSince = 0;
  }

  static angle(a, b, c) {
    const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs(rad * (180 / Math.PI));
    if (deg > 180) deg = 360 - deg;
    return deg;
  }

  /**
   * @param {Object} landmarks  { hip, knee, ankle } each with x, y, visibility
   * @param {boolean} poseValid  external validation flag (false = not a real person)
   */
  update(landmarks, poseValid = true) {
    const now = Date.now();
    const { hip, knee, ankle } = landmarks;

    // ---- Pose-validity gate ----
    const lowConfidence =
      !poseValid ||
      hip.visibility   < this.minConfidence ||
      knee.visibility  < this.minConfidence ||
      ankle.visibility < this.minConfidence;

    if (lowConfidence) {
      if (this._trackingLostSince === 0) this._trackingLostSince = now;
      return {
        state: this.state,
        repCount: this.repCount,
        kneeAngle: null,
        trackingLost: (now - this._trackingLostSince) >= this.trackingLostGraceMs,
      };
    }

    this._trackingLostSince = 0;
    const kneeAngle = SquatDetector.angle(hip, knee, ankle);

    // ---- State transitions ----
    if (this.state === 'UP') {
      if (kneeAngle < this.downAngleThreshold) {
        this.state = 'DOWN';
        this.downStartTime = now;
      }
    } else if (this.state === 'DOWN') {
      if (kneeAngle > this.upAngleThreshold) {
        const downDur = now - this.downStartTime;
        const repGap  = now - this.lastTransitionTime;
        if (downDur >= this.minDownDuration && repGap >= this.minRepInterval) {
          this.repCount++;
          this.lastTransitionTime = now;
        }
        this.state = 'UP';
      }
    }

    return {
      state: this.state,
      repCount: this.repCount,
      kneeAngle: Math.round(kneeAngle),
      trackingLost: false,
    };
  }

  reset() {
    this.state              = 'UP';
    this.repCount           = 0;
    this.lastTransitionTime = 0;
    this.downStartTime      = 0;
    this._trackingLostSince = 0;
  }
}
