# AI FIT — The No-Setup Home Fitness Console

**AI-powered personal training that just works.** No gym membership, no complicated equipment, no internet required — just plug in and start moving.

> 🌐 **Live Demo:** [https://otterholte.github.io/AiFit/](https://otterholte.github.io/AiFit/)
> *(front camera only — run locally for full two-camera experience)*

---

## What Is AI FIT?

AI FIT is a standalone fitness console that uses real-time pose detection and AI coaching to guide you through workouts in your living room. Think of it as a personal trainer that lives inside your TV — one that watches your form from two angles, counts your reps, tracks your sets, and talks you through every movement.

The goal is dead simple: **make working out at home as effective as having a personal trainer, with zero friction to get started.**

---

## The Problem We Solve

Home fitness today is broken in one of two ways:

1. **Video workouts** (YouTube, Peloton, etc.) can't see you. They don't know if your form is wrong, if you're half-repping, or if you've stopped entirely. You're on your own.
2. **Smart fitness tech** (Mirror, Tempo, etc.) requires expensive equipment, Wi-Fi, monthly subscriptions, cloud processing, and a complicated setup. Your workout data lives on someone else's server.

AI FIT sits in between: **real-time AI coaching that actually watches you — in a device that's as simple to use as a game console.**

---

## How It Works Today (Current Build)

The current prototype runs as a local web application on your laptop/PC with two camera sources:

### Two-Camera Setup
- **Front camera** (laptop webcam or USB cam) — faces you head-on for hand gesture detection, pause/resume control, and menu navigation.
- **Side camera** (phone propped at 90°) — captures your profile for precise joint-angle measurement and form analysis.

Both camera feeds appear on a single dashboard so you can see yourself from both angles simultaneously, right alongside your workout data — no turning your head to check a mirror.

### Real-Time Pose Analysis
- Powered by **MediaPipe Pose Landmarker** running entirely on-device (no cloud, no internet needed).
- Tracks 33 body landmarks at ~30fps.
- Calculates joint angles (knee, hip, shoulder) to assess form in real time.

### AI Coaching Cues
The system acts as a vocal coach during exercises:
- **"Go lower…"** — you haven't hit target depth yet
- **"Hold!"** — you've reached depth, maintain the position
- **"Good! Drive up!"** — you've held long enough, time to stand
- **"3 more to go!"** — countdown as you approach set completion
- Cues update in real time based on your actual joint angles and timing, not on a pre-recorded script.

### Current Exercise: Deep Squat (3 × 10 reps)
- Full state machine tracking: standing → descending → at depth → ascending → rep counted
- Target depth angle detection with configurable hold duration
- Per-set celebrations with confetti and applause
- Automatic set advancement with rest periods

### Gesture-Controlled Interface
No remote. No controller. No keyboard needed during a workout.
- **Right hand cursor** — raise your right hand on the menu to navigate; the cursor follows your wrist with amplified, smoothed tracking so small movements cover the whole screen.
- **Dwell-to-select** — hold your fist over a menu item or button for 2 seconds to "click" it. A progress ring fills to confirm.
- **Hand tracking toggle** — dedicated button to enable/disable hand tracking on demand.
- **Raise hand to pause** — during a workout, raise either hand above your head to pause/resume.
- **Mouse/click fallback** — everything also works with a standard mouse for convenience.

### Menu System
- **Main menu** at startup lets you select a workout via gesture or click.
- **Post-workout screen** after completing all sets gives you "Do It Again" or "Main Menu" options, also controllable by hand.
- **Camera preview (PiP)** — a small picture-in-picture window in the bottom-right shows your live camera feed with skeleton overlay during menus, so you can see your hand being tracked and confirm it's working.

### Dashboard Features
- Live rep counter and set counter
- Workout timer
- Set progress dots
- Exercise demonstration GIF
- Real-time coaching cue display
- Form feedback popups ("Perfect!", "Great depth!", etc.)
- Camera connection status indicators
- Help button for camera setup tips

---

## The Vision: Where This Is Going

### The Console — Inspired by NEX Playground

We love what [NEX Playground](https://www.nexplayground.com) did for kids' active play — a cute, minimal device that just works. No complicated setup, no clutter, no learning curve. Point it at the floor and go. That's the energy we want for fitness.

The end product is a **dedicated hardware console** — not an app that runs on your laptop, but a purpose-built device that feels like it belongs in your living room:

- **Plug-and-play**: HDMI directly into your TV. Power on. Work out. That's it.
- **No Wi-Fi required to function**: All pose detection and coaching runs locally on the device. Your body data never leaves your living room. Internet is optional — only needed if you choose to sync progress, compete with friends, or download new workout packs.
- **No remote control**: The entire UI is navigable through hand gestures and (planned) voice commands. Your body IS the controller.

#### Custom Hardware Design

Because we're building our own hardware, we control every detail:

- **Cute & minimal form factor** — the console itself should be small, clean, and something you'd actually want sitting on your shelf. Think friendly, not intimidating. A little device with personality — not a black box with blinking LEDs that screams "tech bro." Inspired by the approachable, playful design language of NEX Playground.
- **Two compact cameras** included in the box — one mounts on/near your TV (front-facing), one sits to the side. Both are designed to blend into your space.
- **Wide-angle lenses** — by choosing our own optics, we can use wider-angle lenses that capture your full body much more easily. No more fiddling with camera placement or backing up 10 feet. A wider field of view means the setup is more forgiving and the experience is smoother out of the box.
- **Optional physical privacy shutters** — simple manual lens covers that you can slide shut when you're done. Easy to use, tactile, satisfying — but not motorized or automatic. Just a little physical shutter you flip with your thumb. You can see at a glance whether the camera can see you or not. No software required, no trust issues.
- **Expandable with downloadable content** — just like NEX Playground's Play Pass system, new workouts, exercises, and fitness games can be added over time. The console is a platform, not a single product.

#### Why Our Own Hardware Matters

Off-the-shelf webcams are designed for video calls, not full-body fitness tracking. They have narrow fields of view, mediocre low-light performance, and no physical privacy controls. By designing our own cameras and console:

- We pick the **exact lens angle** that makes setup effortless (wide enough to see head-to-toe without backing into a wall)
- We control the **industrial design** so it looks like a consumer product people actually want, not a developer prototype
- We build **privacy into the physical product** instead of asking people to trust software
- We optimize the **onboard compute** for real-time pose detection at the frame rates and resolutions we need
- We create a **cohesive experience** from unboxing to first workout — no downloading apps, no pairing Bluetooth, no account creation

### AI Trainer

An on-screen trainer that isn't just a video playback:

- **Talks back to you** — real-time voice feedback with encouragement, form corrections, and set progress updates. Not pre-recorded clips on a loop, but contextual coaching based on what you're actually doing.
- **Shows perfect form** — the trainer demonstrates the exercise so you can mirror their movement. You see their form alongside your own two camera feeds.
- **Adapts to you** — as the AI learns your range of motion, strength, and common form mistakes, it adjusts cues accordingly. If you consistently round your back on squats, it'll start cueing you earlier.

### Planned Features

| Feature | Status | Description |
|---|---|---|
| **Deep Squat** | ✅ Built | 3×10 reps with full form tracking and coaching |
| **Lower Body Blast** | 🔜 Coming Soon | Squats, lunges, and calf raises combined |
| **Upper Body** | 🔜 Coming Soon | Push-ups, shoulder press, curls |
| **Full Body** | 🔜 Coming Soon | Mixed compound movements |
| **Recovery Day** | 🔜 Coming Soon | Stretching and mobility with hold-time tracking |
| **Voice Commands** | 🔜 Planned | "Pause", "Skip", "Restart" — hands-free control |
| **AI Voice Coach** | 🔜 Planned | Spoken cues and encouragement (text-to-speech or recorded) |
| **Smartwatch Integration** | 🔜 Planned | Pair a Garmin, Apple Watch, or similar to display heart rate, calories burned, and recovery metrics on-screen |
| **Progress Tracking** | 🔜 Planned | Track reps, form scores, and workout frequency over time. Compete against your past self. |
| **Social Challenges** | 🔜 Planned | Invite friends to weekly fitness challenges. Leaderboards, streaks, and accountability. |
| **Difficulty Progression** | 🔜 Planned | Unlock harder workouts and new exercises as you improve. Gamified progression to keep you motivated. |
| **Add-On Games & Workouts** | 🔜 Planned | Downloadable workout packs and fitness mini-games. Third-party developers could build on the platform. |

### Smartwatch & Wearable Integration

Connect a third-party wearable (Garmin, Apple Watch, Fitbit, Whoop, etc.) to pull in:
- **Real-time heart rate** displayed on the workout dashboard
- **Calories burned** calculated from actual exertion data
- **Recovery metrics** to suggest rest days or lower-intensity workouts
- **Sleep and readiness scores** to personalize workout intensity

We don't build the wearable — we integrate with the ones you already own.

### Compete & Progress

- **Personal records** — track your best form scores, fastest set completions, and longest streaks.
- **Progressive difficulty** — as your form improves and you consistently complete workouts, unlock harder variations and new exercises.
- **Friend challenges** — invite friends to a weekly squat challenge, step competition, or full workout streak. See who shows up and who doesn't.
- **Leaderboards** — optional community leaderboards for motivation without toxicity. Compete in your tier.

---

## How It Stands Out

| | AI FIT | Mirror / Tempo | YouTube / Peloton | Ring Fit |
|---|---|---|---|---|
| **Watches your form** | ✅ Two angles | ✅ One angle | ❌ No | ❌ No |
| **Real-time corrections** | ✅ Joint-angle based | ⚠️ Limited | ❌ No | ❌ No |
| **No internet required** | ✅ Fully local | ❌ Cloud required | ❌ Streaming | ✅ Local |
| **No subscription** | ✅ Buy once | ❌ Monthly fee | ❌ Monthly fee | ✅ Buy once |
| **Privacy (physical covers)** | ✅ Manual lens shutters | ❌ Software only | N/A | N/A |
| **No remote/controller** | ✅ Gesture + voice | ❌ Remote/touch | ❌ Phone/remote | ❌ Joy-Con |
| **Two camera angles** | ✅ Front + side | ❌ Front only | ❌ None | ❌ None |
| **Wearable integration** | 🔜 Planned | ⚠️ Limited | ⚠️ Limited | ❌ No |
| **Expandable (games/packs)** | 🔜 Planned | ❌ Locked ecosystem | ❌ No | ❌ No |
| **Social challenges** | 🔜 Planned | ⚠️ Limited | ✅ Yes | ❌ No |

**The key differentiators:**

1. **Zero friction** — no accounts, no Wi-Fi, no subscriptions, no setup wizard. Plug in the console, turn it on, move.
2. **True privacy** — processing is 100% on-device. Cameras have simple manual lens shutters you can flip shut. Nothing is uploaded anywhere.
3. **Two-angle analysis** — the side camera is a game-changer for form. You can't assess squat depth from the front. We use both.
4. **Your body is the controller** — gestures and voice replace remotes and touchscreens. Your hands never leave the workout.
5. **Platform, not just a product** — designed for third-party workout packs, games, and wearable integrations. The console grows with you.
6. **Purpose-built hardware** — wide-angle lenses designed for full-body tracking, cute minimal form factor that belongs in your home, and a setup that forgives imperfect camera placement. Inspired by what NEX Playground did for kids' active play — but for adult fitness.

---

## Tech Stack (Current Prototype)

| Component | Technology |
|---|---|
| Pose Detection | MediaPipe Pose Landmarker (on-device) |
| Real-Time Communication | Socket.IO |
| Dashboard UI | HTML / CSS / JavaScript |
| Exercise Logic | Custom state machine (SquatDetector) |
| Celebrations | canvas-confetti |
| Audio | Web Audio API |
| Server | Node.js + Express |

---

## Quick Start (One Command)

```bash
npm run go
```

That's it. This installs dependencies, starts the HTTPS server, and opens the dashboard in your browser automatically.

> First time? You'll see a browser warning about the self-signed certificate. Click **"Advanced" → "Proceed"** — you only need to do this once.

### Full Two-Camera Setup

1. **Run the server** on your laptop:
   ```bash
   npm run go
   ```
2. The dashboard opens automatically at `https://localhost:3000/dashboard`
3. A **QR code** appears in the main menu — scan it with your phone
4. On your phone, accept the certificate warning once (same as step 1)
5. **Position your phone** at a 90° side angle, propped at knee-to-hip height
6. Stand in front of your laptop camera
7. Select **"Deep Squat"** from the menu and start moving

> **Note:** Your phone and laptop must be on the **same Wi-Fi network**. The QR code automatically uses your laptop's local IP address so the phone can connect.

### GitHub Pages (Demo Mode)

The app also runs at [https://otterholte.github.io/AiFit/](https://otterholte.github.io/AiFit/) — this uses your laptop's front camera only. The side camera (phone) feature requires the local server since it needs Socket.IO to relay data between devices in real time.

---

## Project Structure

```
AiFit/
├── server.js                  # Express + Socket.IO HTTPS server (auto-opens browser)
├── package.json               # Dependencies & npm scripts
├── index.html                 # GitHub Pages redirect → public/dashboard.html
├── .nojekyll                  # Tells GitHub Pages not to process with Jekyll
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Pages auto-deploy workflow
├── public/
│   ├── dashboard.html         # Main workout dashboard & menu
│   ├── side.html              # Side camera page (mobile-optimized for phone)
│   ├── front.html             # Front camera page
│   ├── css/
│   │   ├── dashboard.css      # Dashboard & menu styles
│   │   └── style.css          # Shared camera page styles
│   ├── js/
│   │   ├── dashboard.js       # Dashboard logic, gesture control, coaching, QR code
│   │   ├── squat-detector.js  # Squat state machine & rep counting
│   │   ├── camera-common.js   # Shared camera/pose detection (MediaPipe)
│   │   └── qrcode.min.js     # QR code generation library
│   └── img/
│       └── DeepSquatExampleGif.webp  # Exercise demonstration
└── README.md
```

---

## The Bottom Line

People don't work out at home because it's hard to stay accountable, hard to know if you're doing it right, and hard to stay motivated alone. AI FIT solves all three:

- **Accountability** — it counts your reps and tracks your progress. You can't cheat.
- **Correctness** — it watches your form from two angles and tells you exactly what to fix.
- **Motivation** — it talks to you, celebrates your wins, and lets you compete with friends.

All in a box that plugs into your TV with no setup, no subscription, and no compromises on privacy.

---

*Built with 💪 and way too many squats.*

