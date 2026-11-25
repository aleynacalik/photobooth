/* ═══════════════════════════════════════════════════════════════
   PHOTOS — ANALOG PHOTOBOOTH CONTROLLER
   Web Audio SFX · Curtain Animation · Analog Film Engine ·
   Dispenser Slide · Interactive Sticker Drag-and-Drop · 3x Export
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── DOM Helper ── */
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* ── Canvas roundRect polyfill for older mobile Safari (iOS < 16) ── */
  if (
    typeof CanvasRenderingContext2D !== 'undefined' &&
    !CanvasRenderingContext2D.prototype.roundRect
  ) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const radius = Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2);
      this.moveTo(x + radius, y);
      this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius);
      this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius);
      this.closePath();
      return this;
    };
  }

  /* ── Application State ── */
  const state = {
    photoCount: 4,          // 4 or 3
    filter: 'bw',           // 'bw' | 'warm' | 'sepia'
    frameColor: '#ffffff',
    pattern: 'solid',       // 'solid' | 'film' | 'stripes' | 'dots' | 'check'
    caption: '',
    showDate: true,
    soundOn: true,
    busy: false,
    shooting: false,
    demoMode: false,
    facingMode: 'user',     // 'user' (front selfie) | 'environment' (rear)
    stream: null,
    rawPhotos: [],          // Offscreen HTMLCanvasElement[] (original color, cropped to frame ratio)
    filterCache: new Map(), // key: `${idx}_${filter}` -> HTMLCanvasElement
    stickers: [],           // { id, type, x, y, size, rot } in base canvas coords
    dragSticker: null,      // active dragged sticker object
    dragOffset: { x: 0, y: 0 },
    stickerCursor: 0,
    demoRaf: null,
  };

  /* ═════════════════════════════════════════════════════════════
     1. WEB AUDIO SOUND ENGINE (Zero External Dependencies)
  ═════════════════════════════════════════════════════════════ */
  const SFX = (() => {
    let ctx = null;

    function getCtx() {
      if (!state.soundOn) return null;
      if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        ctx = new AudioCtx();
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }

    function createNoiseBuffer(audioCtx, durationSec) {
      const length = Math.floor(audioCtx.sampleRate * durationSec);
      const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    return {
      click() {
        const c = getCtx();
        if (!c) return;
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.045);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      },

      curtain() {
        const c = getCtx();
        if (!c) return;
        const now = c.currentTime;
        const src = c.createBufferSource();
        src.buffer = createNoiseBuffer(c, 0.95);

        const filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(340, now);
        filter.frequency.exponentialRampToValueAtTime(980, now + 0.42);
        filter.frequency.exponentialRampToValueAtTime(280, now + 0.9);
        filter.Q.value = 1.4;

        const gain = c.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.16, now + 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.92);

        src.connect(filter).connect(gain).connect(c.destination);
        src.start(now);
        src.stop(now + 0.95);
      },

      tick(isLast) {
        const c = getCtx();
        if (!c) return;
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isLast ? 880 : 620, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.13, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      },

      shutter() {
        const c = getCtx();
        if (!c) return;
        const now = c.currentTime;

        // First mechanical curtain snap
        const snap1 = c.createBufferSource();
        snap1.buffer = createNoiseBuffer(c, 0.06);
        const f1 = c.createBiquadFilter();
        f1.type = 'highpass';
        f1.frequency.value = 1200;
        const g1 = c.createGain();
        g1.gain.setValueAtTime(0.32, now);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
        snap1.connect(f1).connect(g1).connect(c.destination);
        snap1.start(now);
        snap1.stop(now + 0.06);

        // Second mirror-return click
        const snap2 = c.createBufferSource();
        snap2.buffer = createNoiseBuffer(c, 0.05);
        const f2 = c.createBiquadFilter();
        f2.type = 'bandpass';
        f2.frequency.value = 2100;
        const g2 = c.createGain();
        g2.gain.setValueAtTime(0.001, now + 0.065);
        g2.gain.linearRampToValueAtTime(0.22, now + 0.072);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        snap2.connect(f2).connect(g2).connect(c.destination);
        snap2.start(now + 0.065);
        snap2.stop(now + 0.125);

        // Subtle vintage flash bulb whine
        const osc = c.createOscillator();
        const og = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1600, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(4200, now + 0.45);
        og.gain.setValueAtTime(0.015, now + 0.05);
        og.gain.exponentialRampToValueAtTime(0.0005, now + 0.45);
        osc.connect(og).connect(c.destination);
        osc.start(now + 0.05);
        osc.stop(now + 0.46);
      },

      dispenser() {
        const c = getCtx();
        if (!c) return;
        const now = c.currentTime;
        const dur = 2.25;

        // Soft paper slide hiss
        const noise = c.createBufferSource();
        noise.buffer = createNoiseBuffer(c, dur);
        const nf = c.createBiquadFilter();
        nf.type = 'bandpass';
        nf.frequency.setValueAtTime(1100, now);
        nf.frequency.linearRampToValueAtTime(750, now + dur);
        nf.Q.value = 1.6;
        const ng = c.createGain();
        ng.gain.setValueAtTime(0.001, now);
        ng.gain.linearRampToValueAtTime(0.06, now + 0.25);
        ng.gain.setValueAtTime(0.055, now + dur - 0.35);
        ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
        noise.connect(nf).connect(ng).connect(c.destination);
        noise.start(now);
        noise.stop(now + dur);

        // Gentle mechanical roller motor hum
        const motor = c.createOscillator();
        motor.type = 'sawtooth';
        motor.frequency.setValueAtTime(92, now);
        motor.frequency.linearRampToValueAtTime(84, now + dur);
        const mf = c.createBiquadFilter();
        mf.type = 'lowpass';
        mf.frequency.value = 260;
        const mg = c.createGain();
        mg.gain.setValueAtTime(0.001, now);
        mg.gain.linearRampToValueAtTime(0.045, now + 0.2);
        mg.gain.setValueAtTime(0.04, now + dur - 0.3);
        mg.gain.exponentialRampToValueAtTime(0.001, now + dur);
        motor.connect(mf).connect(mg).connect(c.destination);
        motor.start(now);
        motor.stop(now + dur);

        // Soft paper settle thump in tray
        const thump = c.createOscillator();
        const tg = c.createGain();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(160, now + dur - 0.12);
        thump.frequency.exponentialRampToValueAtTime(55, now + dur + 0.05);
        tg.gain.setValueAtTime(0.001, now + dur - 0.12);
        tg.gain.linearRampToValueAtTime(0.11, now + dur - 0.10);
        tg.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.06);
        thump.connect(tg).connect(c.destination);
        thump.start(now + dur - 0.12);
        thump.stop(now + dur + 0.07);
      },

      stamp() {
        const c = getCtx();
        if (!c) return;
        const now = c.currentTime;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.075);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain).connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.085);
      },
    };
  })();

  /* ═════════════════════════════════════════════════════════════
     2. SOUND TOGGLE & SHARED FILTER SYNC
  ═════════════════════════════════════════════════════════════ */
  const btnSound = $('btn-sound');
  btnSound.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    btnSound.classList.toggle('muted', !state.soundOn);
    btnSound.querySelector('.sound-label').textContent = state.soundOn ? 'SFX ON' : 'MUTED';
    btnSound.title = state.soundOn ? 'Sound On' : 'Sound Muted';
    if (state.soundOn) SFX.click();
  });

  function syncFilterUI(filter) {
    state.filter = filter;
    // Home dock
    document.querySelectorAll('.home-dock [data-filter]').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === filter);
    });
    // Booth console
    document.querySelectorAll('.console-filters [data-filter]').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === filter);
    });
    // Result editor
    document.querySelectorAll('#result-filters [data-filter]').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === filter);
    });
    // Live viewfinder filter attribute
    $('viewfinder-screen').dataset.filter = filter;

    if ($('screen-result').classList.contains('active')) {
      renderStrip();
    }
  }

  function syncCountUI(count) {
    state.photoCount = count;
    document.querySelectorAll('.home-dock [data-count]').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.count) === count);
    });
    $('editor-strip-meta').textContent = `${count}-FRAME · 35MM`;
  }

  // Home dock buttons
  document.querySelectorAll('.home-dock [data-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.click();
      syncCountUI(Number(btn.dataset.count));
    });
  });

  document.querySelectorAll('.home-dock [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.click();
      syncFilterUI(btn.dataset.filter);
    });
  });

  document.querySelectorAll('.console-filters [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.shooting) return;
      SFX.click();
      syncFilterUI(btn.dataset.filter);
    });
  });

  document.querySelectorAll('#result-filters [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.click();
      syncFilterUI(btn.dataset.filter);
    });
  });

  /* ═════════════════════════════════════════════════════════════
     3. SCREEN 1: HOME — CURTAIN OPEN & ENTER BOOTH
  ═════════════════════════════════════════════════════════════ */
  const cabinStage = $('cabin-stage');

  async function enterBooth() {
    if (state.busy) return;
    state.busy = true;

    SFX.curtain();
    $('cabin-prompt').style.opacity = '0';
    cabinStage.classList.add('opening');

    // Start requesting camera in parallel while curtains draw open
    const camPromise = initCamera();

    await sleep(920);
    cabinStage.classList.add('entering');
    await sleep(420);

    // Switch screens
    $('screen-home').classList.remove('active');
    $('screen-session').classList.add('active');
    $('screen-session').setAttribute('aria-hidden', 'false');
    document.body.classList.add('in-booth');

    buildFilmSlots();
    $('session-counter').textContent = 'READY';
    $('session-hint').textContent = 'Check your pose · Press Space or click Start Session';
    $('btn-start-shoot').disabled = false;
    $('rec-indicator').classList.remove('shooting');
    $('rec-indicator').querySelector('.rec-text').textContent = 'LIVE';

    await camPromise;
    if (state.stream) {
      $('booth-video').play().catch(() => {});
    }
    state.busy = false;
  }

  cabinStage.addEventListener('click', enterBooth);
  cabinStage.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterBooth();
    }
  });

  /* ═════════════════════════════════════════════════════════════
     4. CAMERA ACQUISITION & ILLUSTRATED DEMO MODE FALLBACK
  ═════════════════════════════════════════════════════════════ */
  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
  }

  function updateFlipUI() {
    const isRear = state.facingMode === 'environment';
    $('viewfinder-screen').classList.toggle('rear-camera', isRear);
    $('flip-cam-label').textContent = isRear ? 'REAR' : 'FRONT';
  }

  async function acquireVideoStream(facingMode) {
    const attempts = [
      { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false },
      { video: { facingMode: facingMode }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        // Stop immediately on explicit permission denial — retrying won't help
        if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  async function attachStreamToVideo(vid, stream) {
    vid.muted = true;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    vid.setAttribute('webkit-playsinline', 'true');
    vid.srcObject = stream;

    if (vid.readyState < 1) {
      await new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        vid.onloadedmetadata = finish;
        setTimeout(finish, 1800);
      });
    }

    try {
      await vid.play();
    } catch (_) {
      // iOS Safari may defer autoplay until next tap; stream is still active
    }
  }

  async function initCamera(forceReacquire = false) {
    const vid = $('booth-video');
    const vf = $('viewfinder-screen');
    const fallback = $('cam-fallback');

    fallback.classList.remove('on');
    vf.classList.remove('demo-active');
    stopDemoLoop();
    state.demoMode = false;
    updateFlipUI();

    if (forceReacquire) {
      stopStream();
    }

    if (state.stream) {
      await attachStreamToVideo(vid, state.stream);
      return true;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('cam-fallback-msg').textContent = 'Camera requires Safari or Chrome over HTTPS (in-app browsers like WhatsApp/Instagram often block camera access). Open in Safari/Chrome or try Demo Mode.';
      fallback.classList.add('on');
      return false;
    }

    try {
      const stream = await acquireVideoStream(state.facingMode);
      state.stream = stream;
      await attachStreamToVideo(vid, stream);
      updateFlipUI();
      return true;
    } catch (err) {
      if (state.facingMode === 'environment') {
        // Fallback smoothly to front camera if device only has one lens
        state.facingMode = 'user';
        updateFlipUI();
        $('session-hint').textContent = 'Rear camera unavailable · Switched back to Front';
        return initCamera(true);
      }
      const code = err && err.name ? err.name : 'Error';
      if (code === 'NotAllowedError' || code === 'PermissionDeniedError') {
        $('cam-fallback-msg').textContent = 'Camera permission was denied. In Safari/Chrome, tap the address bar (AA / lock icon) → Website Settings → Camera: Allow, then tap Retry.';
      } else if (code === 'NotReadableError') {
        $('cam-fallback-msg').textContent = 'Camera is currently in use by another app. Close other camera apps and tap Retry.';
      } else {
        $('cam-fallback-msg').textContent = `Could not start camera (${code}). Open in Safari or Chrome, tap Retry, or try Demo Mode.`;
      }
      fallback.classList.add('on');
      return false;
    }
  }

  $('btn-flip-cam').addEventListener('click', async () => {
    if (state.shooting || state.demoMode) return;
    SFX.click();
    const btn = $('btn-flip-cam');
    btn.classList.add('spinning');
    btn.disabled = true;

    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    await initCamera(true);

    setTimeout(() => {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }, 320);
  });

  function stopDemoLoop() {
    if (state.demoRaf) {
      cancelAnimationFrame(state.demoRaf);
      state.demoRaf = null;
    }
  }

  function startDemoMode() {
    SFX.click();
    state.demoMode = true;
    $('cam-fallback').classList.remove('on');
    $('viewfinder-screen').classList.add('demo-active');

    const cv = $('demo-preview-canvas');
    cv.width = 640;
    cv.height = 480;
    const ctx = cv.getContext('2d');
    const t0 = performance.now();

    function drawFrame(now) {
      if (!state.demoMode) return;
      const t = (now - t0) / 1000;
      drawDemoScene(ctx, cv.width, cv.height, t, state.rawPhotos.length);
      state.demoRaf = requestAnimationFrame(drawFrame);
    }
    state.demoRaf = requestAnimationFrame(drawFrame);
  }

  // Charming cel-shaded analog booth portrait for Demo Mode
  function drawDemoScene(ctx, W, H, t, poseIdx) {
    // Curtain backdrop matching booth-cabin.png
    ctx.fillStyle = '#182b44';
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 64) {
      ctx.fillStyle = x % 128 === 0 ? '#112138' : '#213754';
      ctx.fillRect(x, 0, 34, H);
    }
    // Warm overhead booth glow
    const grd = ctx.createRadialGradient(W * 0.5, H * 0.15, 20, W * 0.5, H * 0.45, W * 0.65);
    grd.addColorStop(0, 'rgba(235, 212, 150, 0.35)');
    grd.addColorStop(1, 'rgba(10, 18, 30, 0.35)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    const bob = Math.sin(t * 2.2) * 5;
    const tilt = Math.sin(t * 1.3 + poseIdx) * 0.05;

    ctx.save();
    ctx.translate(W * 0.5, H * 0.62 + bob);
    ctx.rotate(tilt);

    // Coat / shoulders
    ctx.fillStyle = '#c86d51';
    ctx.strokeStyle = '#132230';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 115, 118, 84, 0, Math.PI, 0, false);
    ctx.lineTo(118, 220);
    ctx.lineTo(-118, 220);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Collar
    ctx.fillStyle = '#efeee0';
    ctx.beginPath();
    ctx.moveTo(-36, 44);
    ctx.lineTo(0, 80);
    ctx.lineTo(36, 44);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Neck & Head
    ctx.fillStyle = '#f2d3b5';
    ctx.fillRect(-20, 14, 40, 42);
    ctx.beginPath();
    ctx.arc(0, -34, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Hair beret/bob
    ctx.fillStyle = '#2a221f';
    ctx.beginPath();
    ctx.arc(0, -48, 64, Math.PI * 0.92, Math.PI * 2.08);
    ctx.fill();
    ctx.stroke();

    // Vintage beret
    ctx.fillStyle = '#2c546e';
    ctx.beginPath();
    ctx.ellipse(-6, -92, 62, 22, -0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eyes & expression vary slightly per shot
    ctx.fillStyle = '#132230';
    const wink = poseIdx % 4 === 2;
    ctx.beginPath();
    ctx.arc(-20, -34, 5, 0, Math.PI * 2);
    ctx.fill();
    if (wink) {
      ctx.beginPath();
      ctx.moveTo(12, -34);
      ctx.quadraticCurveTo(20, -41, 28, -34);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(20, -34, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rosy cheeks
    ctx.fillStyle = 'rgba(218, 120, 108, 0.45)';
    ctx.beginPath(); ctx.ellipse(-34, -18, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(34, -18, 10, 6, 0, 0, Math.PI * 2); ctx.fill();

    // Smile
    ctx.strokeStyle = '#132230';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    if (poseIdx % 4 === 1) {
      ctx.arc(0, -14, 14, 0.1 * Math.PI, 0.9 * Math.PI);
    } else if (poseIdx % 4 === 3) {
      ctx.ellipse(0, -10, 9, 11, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(0, -18, 18, 0.15 * Math.PI, 0.85 * Math.PI);
    }
    ctx.stroke();

    // Peace sign hand on pose 1 & 2
    if (poseIdx % 2 === 1) {
      ctx.fillStyle = '#f2d3b5';
      ctx.beginPath();
      ctx.roundRect(62, -28, 14, 44, 7);
      ctx.roundRect(78, -24, 14, 42, 7);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(76, 22, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    // Subtle Demo label
    ctx.fillStyle = 'rgba(239, 238, 224, 0.6)';
    ctx.font = 'bold 12px "Space Mono", monospace';
    ctx.fillText('ANALOG DEMO ROLL', 18, H - 16);
  }

  $('btn-retry-cam').addEventListener('click', () => {
    SFX.click();
    initCamera();
  });
  $('btn-demo-mode').addEventListener('click', startDemoMode);

  /* ═════════════════════════════════════════════════════════════
     5. SCREEN 2: SHOOTING SEQUENCE
  ═════════════════════════════════════════════════════════════ */
  function buildFilmSlots() {
    const slots = $('film-slots');
    slots.innerHTML = '';
    for (let i = 0; i < state.photoCount; i++) {
      const div = document.createElement('div');
      div.className = 'film-slot';
      div.id = `film-slot-${i}`;
      div.dataset.num = `0${i + 1}`;
      slots.appendChild(div);
    }
  }

  function exitBoothToHome() {
    if (state.shooting) return;
    SFX.curtain();
    stopDemoLoop();
    $('screen-session').classList.remove('active');
    $('screen-session').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('in-booth');

    cabinStage.classList.remove('entering', 'opening');
    $('cabin-prompt').style.opacity = '1';
    $('screen-home').classList.add('active');
  }

  $('btn-exit-booth').addEventListener('click', exitBoothToHome);

  // Trigger shooting via button or Spacebar
  $('btn-start-shoot').addEventListener('click', startShootSequence);
  window.addEventListener('keydown', e => {
    if (
      e.code === 'Space' &&
      $('screen-session').classList.contains('active') &&
      !state.shooting &&
      !$('cam-fallback').classList.contains('on')
    ) {
      e.preventDefault();
      startShootSequence();
    }
  });

  async function startShootSequence() {
    if (state.shooting) return;
    if ($('cam-fallback').classList.contains('on')) return;

    state.shooting = true;
    state.rawPhotos = [];
    state.filterCache.clear();
    state.stickers = [];
    state.stickerCursor = 0;

    $('btn-start-shoot').disabled = true;
    $('btn-exit-booth').disabled = true;
    $('btn-flip-cam').disabled = true;
    document.querySelectorAll('.console-filters button').forEach(b => b.disabled = true);

    $('rec-indicator').classList.add('shooting');
    $('rec-indicator').querySelector('.rec-text').textContent = 'REC';
    $('session-hint').textContent = 'Hold your pose · Flash firing automatically';

    const total = state.photoCount;
    const cdown = $('countdown-overlay');
    const cnum  = $('countdown-num');
    const csub  = $('countdown-sub');
    const flash = $('flash-burst');
    const lamp  = $('flash-lamp');

    for (let i = 0; i < total; i++) {
      const slot = $(`film-slot-${i}`);
      if (slot) slot.classList.add('active-shot');

      $('session-counter').textContent = `SHOT ${i + 1} / ${total}`;
      csub.textContent = `FRAME ${i + 1} OF ${total}`;
      cdown.classList.add('on');

      for (let n = 3; n >= 1; n--) {
        cnum.textContent = n;
        cnum.classList.remove('pop');
        void cnum.offsetWidth;
        cnum.classList.add('pop');
        SFX.tick(n === 1);
        await sleep(920);
      }

      cdown.classList.remove('on');

      // Studio flash + mechanical shutter SFX
      SFX.shutter();
      lamp.classList.add('fired');
      flash.style.transition = 'none';
      flash.style.opacity = '1';

      // Capture raw color frame cropped cleanly to 4:3
      const rawCanvas = captureRawFrame();
      state.rawPhotos.push(rawCanvas);

      // Update film tray thumbnail with current analog filter
      const filtered = getFilteredPhoto(i, state.filter);
      if (slot) {
        slot.classList.remove('active-shot');
        slot.classList.add('filled');
        const thumbImg = new Image();
        thumbImg.src = filtered.toDataURL('image/jpeg', 0.85);
        slot.appendChild(thumbImg);
      }

      await sleep(75);
      lamp.classList.remove('fired');
      flash.style.transition = 'opacity 0.55s ease-out';
      flash.style.opacity = '0';

      if (i < total - 1) {
        await sleep(780);
      }
    }

    // Developing darkroom transition
    $('session-counter').textContent = 'DEVELOPING';
    const devOverlay = $('developing-overlay');
    const devFill = $('dev-film-fill');
    devFill.style.transition = 'none';
    devFill.style.width = '0%';
    devOverlay.classList.add('on');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        devFill.style.transition = 'width 2.05s cubic-bezier(0.25, 0.8, 0.25, 1)';
        devFill.style.width = '100%';
      });
    });

    await sleep(2150);

    // Clean up session state & move to Dispenser Chute
    devOverlay.classList.remove('on');
    $('screen-session').classList.remove('active');
    $('screen-session').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('in-booth');
    stopDemoLoop();

    state.shooting = false;
    $('btn-exit-booth').disabled = false;
    $('btn-flip-cam').disabled = false;
    document.querySelectorAll('.console-filters button').forEach(b => b.disabled = false);

    openResultScreen();
  }

  function captureRawFrame() {
    const outW = 800;
    const outH = 600; // crisp 4:3
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d');

    if (state.demoMode) {
      const demo = $('demo-preview-canvas');
      ctx.drawImage(demo, 0, 0, outW, outH);
      return out;
    }

    const vid = $('booth-video');
    const vw = vid.videoWidth || 1280;
    const vh = vid.videoHeight || 960;
    const targetRatio = outW / outH;
    const srcRatio = vw / vh;

    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (srcRatio > targetRatio) {
      sw = vh * targetRatio;
      sx = (vw - sw) / 2;
    } else {
      sh = vw / targetRatio;
      sy = (vh - sh) / 2;
    }

    // Mirror horizontally ONLY for front selfie camera
    ctx.save();
    if (state.facingMode === 'user') {
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, outW, outH);
    ctx.restore();
    return out;
  }

  /* ═════════════════════════════════════════════════════════════
     6. ANALOG FILM FILTER ENGINE (Cached per photo + filter)
  ═════════════════════════════════════════════════════════════ */
  function getFilteredPhoto(index, filterId) {
    const key = `${index}_${filterId}`;
    if (state.filterCache.has(key)) {
      return state.filterCache.get(key);
    }

    const src = state.rawPhotos[index];
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0);

    const imgData = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = imgData.data;

    // Deterministic subtle grain seeded by pixel index
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      const grain = (((Math.sin(i * 12.9898 + index * 78.233) * 43758.5453) % 1) - 0.5) * 14;

      if (filterId === 'bw') {
        // Classic analog silver-halide B&W with lifted matte blacks
        let lum = r * 0.299 + g * 0.587 + b * 0.114;
        lum = (lum - 128) * 1.18 + 132 + grain;
        // Soft analog black lift
        lum = lum * 0.94 + 12;
        r = g = b = clamp(lum);
      } else if (filterId === 'warm') {
        // Warm Kodak-style analog film: golden highlights, slightly cool matte shadows
        r = (r - 128) * 1.07 + 136 + grain * 0.8;
        g = (g - 128) * 1.05 + 131 + grain * 0.8;
        b = (b - 128) * 1.02 + 120 + grain * 0.8;
        // Lift shadows slightly into cool teal-charcoal
        r = r * 0.94 + 12;
        g = g * 0.95 + 11;
        b = b * 0.94 + 14;
        r = clamp(r);
        g = clamp(g);
        b = clamp(b);
      } else if (filterId === 'sepia') {
        // Archival warm vintage sepia
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        r = clamp((sr - 128) * 1.08 + 132 + grain * 0.9);
        g = clamp((sg - 128) * 1.06 + 128 + grain * 0.9);
        b = clamp((sb - 128) * 1.04 + 120 + grain * 0.9);
      }

      d[i]     = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }

    ctx.putImageData(imgData, 0, 0);

    // Subtle optical lens vignette
    const vig = ctx.createRadialGradient(
      cv.width * 0.5, cv.height * 0.5, cv.width * 0.28,
      cv.width * 0.5, cv.height * 0.5, cv.width * 0.72
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(12,18,24,0.28)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cv.width, cv.height);

    state.filterCache.set(key, cv);
    return cv;
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /* ═════════════════════════════════════════════════════════════
     7. SCREEN 3: DISPENSER CHUTE & STRIP RENDERER
  ═════════════════════════════════════════════════════════════ */
  function getStripMetrics() {
    const count = state.photoCount;
    const pw = 224;
    const ph = count === 4 ? 168 : 190; // 4:3 for 4-strip, classic tall for 3-strip
    const PAD = 16;
    const TPAD = 18;
    const GAP = 9;
    const BPAD = 58;
    const W = pw + PAD * 2;
    const H = TPAD + count * ph + (count - 1) * GAP + BPAD;
    return { count, pw, ph, PAD, TPAD, GAP, BPAD, W, H };
  }

  function openResultScreen() {
    const screen = $('screen-result');
    const carrier = $('strip-carrier');
    const panel = $('editor-panel');

    panel.classList.remove('on');
    carrier.style.transition = 'none';
    carrier.classList.remove('ejected');

    // Sync metadata & render crisp strip before sliding out
    $('editor-strip-meta').textContent = `${state.photoCount}-FRAME · 35MM`;
    updateStickerButtons();
    renderStrip();

    screen.classList.add('active');
    screen.setAttribute('aria-hidden', 'false');

    // Trigger mechanical roller slide-out animation + SFX
    triggerDispenserSlide();
  }

  function triggerDispenserSlide() {
    const carrier = $('strip-carrier');
    const panel = $('editor-panel');

    carrier.style.transition = 'none';
    carrier.classList.remove('ejected');
    void carrier.offsetWidth;

    requestAnimationFrame(() => {
      SFX.dispenser();
      carrier.style.transition = 'transform 2.35s cubic-bezier(0.22, 0.86, 0.32, 1)';
      carrier.classList.add('ejected');

      setTimeout(() => {
        panel.classList.add('on');
      }, 650);
    });
  }

  function luminance(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    const toL = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * toL(r) + 0.7152 * toL(g) + 0.0722 * toL(b);
  }

  function renderStrip(exportScale = 2) {
    const m = getStripMetrics();
    const isExport = exportScale > 2;
    const canvas = isExport ? document.createElement('canvas') : $('strip-canvas');
    canvas.width = m.W * exportScale;
    canvas.height = m.H * exportScale;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(exportScale, exportScale);

    const lum = luminance(state.frameColor);
    const isDark = lum < 0.34;
    const inkColor   = isDark ? 'rgba(239, 238, 224, 0.90)' : 'rgba(19, 34, 48, 0.88)';
    const mutedColor = isDark ? 'rgba(239, 238, 224, 0.48)' : 'rgba(19, 34, 48, 0.42)';
    const patColor   = isDark ? 'rgba(255, 255, 255, 0.11)' : 'rgba(19, 34, 48, 0.09)';

    // 1. Base paper/frame fill
    ctx.fillStyle = state.frameColor;
    ctx.fillRect(0, 0, m.W, m.H);

    // 2. Border pattern
    drawFramePattern(ctx, m, state.pattern, patColor, isDark);

    // 3. Draw each captured photo
    for (let i = 0; i < m.count; i++) {
      const x = m.PAD;
      const y = m.TPAD + i * (m.ph + m.GAP);

      if (state.rawPhotos[i]) {
        const filtered = getFilteredPhoto(i, state.filter);
        // Center-crop source to match slot aspect ratio cleanly
        const srcRatio = filtered.width / filtered.height;
        const dstRatio = m.pw / m.ph;
        let sx = 0, sy = 0, sw = filtered.width, sh = filtered.height;
        if (srcRatio > dstRatio) {
          sw = filtered.height * dstRatio;
          sx = (filtered.width - sw) / 2;
        } else {
          sh = filtered.width / dstRatio;
          sy = (filtered.height - sh) / 2;
        }
        ctx.drawImage(filtered, sx, sy, sw, sh, x, y, m.pw, m.ph);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x, y, m.pw, m.ph);
      }

      // Subtle hairline photo recess border
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(19,34,48,0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, m.pw - 1, m.ph - 1);
    }

    // 4. Footer area: Caption + Analog Date Stamp
    const footerTop = m.TPAD + m.count * m.ph + (m.count - 1) * m.GAP;
    const trimmed = state.caption.trim();

    if (trimmed) {
      ctx.fillStyle = inkColor;
      ctx.font = 'italic 600 17px "Fraunces", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(trimmed, m.W / 2, footerTop + 23, m.W - 28);
    } else {
      // Clean editorial brand mark when no caption typed
      ctx.fillStyle = inkColor;
      ctx.font = '800 13px "Fraunces", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P H O T O S', m.W / 2, footerTop + 22);
    }

    if (state.showDate) {
      ctx.fillStyle = mutedColor;
      ctx.font = '700 8px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`ANALOG · ${formatAnalogDate(new Date())}`, m.W / 2, m.H - 13);
    }

    // 5. Interactive Stickers & Stamps
    for (const st of state.stickers) {
      drawSticker(ctx, st);
    }

    ctx.restore();
    if (!isExport) {
      invalidateExportCache();
    }
    return canvas;
  }

  function formatAnalogDate(d) {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function drawFramePattern(ctx, m, pattern, patColor, isDark) {
    if (pattern === 'solid') return;
    ctx.save();

    if (pattern === 'stripes') {
      ctx.strokeStyle = patColor;
      ctx.lineWidth = 3;
      for (let x = 4; x < m.W; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, m.H);
        ctx.stroke();
      }
    } else if (pattern === 'dots') {
      ctx.fillStyle = patColor;
      for (let x = 6; x < m.W; x += 12) {
        for (let y = 6; y < m.H; y += 12) {
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (pattern === 'check') {
      const sz = 8;
      ctx.fillStyle = patColor;
      for (let x = 0; x < m.W; x += sz) {
        for (let y = 0; y < m.H; y += sz) {
          if (((x / sz) + (y / sz)) % 2 === 0) {
            ctx.fillRect(x, y, sz, sz);
          }
        }
      }
    } else if (pattern === 'film') {
      // Classic 35mm film sprocket holes along left & right edges
      ctx.fillStyle = isDark ? 'rgba(239, 238, 224, 0.24)' : 'rgba(19, 34, 48, 0.22)';
      for (let y = 12; y < m.H - 12; y += 20) {
        ctx.beginPath();
        ctx.roundRect(4, y, 7, 10, 2);
        ctx.roundRect(m.W - 11, y, 7, 10, 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /* ═════════════════════════════════════════════════════════════
     8. VECTOR CEL-SHADED STICKERS & DRAG-AND-DROP
  ═════════════════════════════════════════════════════════════ */
  function drawSticker(ctx, st) {
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.rot);
    const s = st.size;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (st.type) {
      case 'sparkle': {
        ctx.fillStyle = '#e6c86e';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s * 0.14, -s * 0.14, s, 0);
        ctx.quadraticCurveTo(s * 0.14, s * 0.14, 0, s);
        ctx.quadraticCurveTo(-s * 0.14, s * 0.14, -s, 0);
        ctx.quadraticCurveTo(-s * 0.14, -s * 0.14, 0, -s);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'star': {
        ctx.fillStyle = '#e6c86e';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? s : s * 0.46;
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'heart': {
        ctx.fillStyle = '#c86d51';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.78);
        ctx.bezierCurveTo(-s * 1.1, s * 0.1, -s * 0.95, -s * 0.85, 0, -s * 0.25);
        ctx.bezierCurveTo(s * 0.95, -s * 0.85, s * 1.1, s * 0.1, 0, s * 0.78);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'flower': {
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.4;
        ctx.fillStyle = '#efeee0';
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          ctx.save();
          ctx.rotate(a);
          ctx.beginPath();
          ctx.ellipse(0, -s * 0.56, s * 0.3, s * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = '#e6c86e';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'bow': {
        ctx.fillStyle = '#2c546e';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.6;
        // Left & right loops
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-s * 0.95, -s * 0.7, -s * 1.1, s * 0.55, 0, s * 0.15);
        ctx.bezierCurveTo(s * 1.1, s * 0.55, s * 0.95, -s * 0.7, 0, 0);
        ctx.fill();
        ctx.stroke();
        // Tails
        ctx.beginPath();
        ctx.moveTo(-2, 3); ctx.lineTo(-s * 0.52, s * 0.88);
        ctx.moveTo(2, 3);  ctx.lineTo(s * 0.52, s * 0.88);
        ctx.stroke();
        // Center knot
        ctx.fillStyle = '#e6c86e';
        ctx.beginPath();
        ctx.arc(0, 1, s * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'sun': {
        ctx.fillStyle = '#e6c86e';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * s * 0.65, Math.sin(a) * s * 0.65);
          ctx.lineTo(Math.cos(a) * s * 1.05, Math.sin(a) * s * 1.05);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.52, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'analog': {
        const w = 68, h = 22;
        ctx.fillStyle = '#2c546e';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#efeee0';
        ctx.font = '700 10px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ANALOG', 0, 0.5);
        break;
      }
      case 'enter': {
        const w = 56, h = 21;
        ctx.fillStyle = '#e6c86e';
        ctx.strokeStyle = '#132230';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#132230';
        ctx.font = '700 10px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ENTER', 0, 0.5);
        break;
      }
    }

    ctx.restore();
  }

  function addSticker(type) {
    SFX.stamp();
    const m = getStripMetrics();
    // Cycle smart curated corner/margin placements so stickers don't pile up
    const presets = [
      { x: m.W - 28, y: m.TPAD + 16, rot: 0.14 },
      { x: 28,       y: m.TPAD + m.ph + 4, rot: -0.16 },
      { x: m.W - 30, y: m.TPAD + m.ph * 2 + 12, rot: -0.12 },
      { x: 32,       y: m.H - 42, rot: 0.1 },
      { x: m.W - 36, y: m.H - 44, rot: -0.14 },
      { x: m.W * 0.5, y: m.TPAD + m.ph + m.GAP / 2, rot: 0.06 },
    ];
    const spot = presets[state.stickerCursor % presets.length];
    state.stickerCursor++;

    const jitterX = (Math.random() - 0.5) * 10;
    const jitterY = (Math.random() - 0.5) * 10;

    const isBadge = type === 'analog' || type === 'enter';
    const marginX = isBadge ? 42 : 24;
    const marginY = isBadge ? 20 : 20;

    state.stickers.push({
      id: Date.now() + Math.random(),
      type,
      x: Math.max(marginX, Math.min(m.W - marginX, spot.x + jitterX)),
      y: Math.max(marginY, Math.min(m.H - marginY, spot.y + jitterY)),
      size: isBadge ? 22 : 16,
      rot: spot.rot,
    });

    updateStickerButtons();
    renderStrip();
  }

  function updateStickerButtons() {
    const empty = state.stickers.length === 0;
    $('btn-sticker-undo').disabled = empty;
    $('btn-sticker-clear').disabled = empty;
  }

  // Pointer drag-and-drop directly on #strip-canvas
  const stripCanvas = $('strip-canvas');

  function getCanvasCoords(evt) {
    const rect = stripCanvas.getBoundingClientRect();
    const m = getStripMetrics();
    const x = ((evt.clientX - rect.left) / rect.width) * m.W;
    const y = ((evt.clientY - rect.top) / rect.height) * m.H;
    return { x, y };
  }

  stripCanvas.addEventListener('pointerdown', e => {
    if (!state.stickers.length) return;
    const pt = getCanvasCoords(e);
    // Find topmost sticker within hit radius
    for (let i = state.stickers.length - 1; i >= 0; i--) {
      const st = state.stickers[i];
      const hitR = st.type === 'analog' || st.type === 'enter' ? 36 : 24;
      const dist = Math.hypot(pt.x - st.x, pt.y - st.y);
      if (dist <= hitR) {
        state.dragSticker = st;
        state.dragOffset = { x: pt.x - st.x, y: pt.y - st.y };
        // Bring to front
        state.stickers.splice(i, 1);
        state.stickers.push(st);
        stripCanvas.classList.add('dragging');
        stripCanvas.setPointerCapture(e.pointerId);
        renderStrip();
        break;
      }
    }
  });

  stripCanvas.addEventListener('pointermove', e => {
    if (!state.dragSticker) return;
    const pt = getCanvasCoords(e);
    const m = getStripMetrics();
    state.dragSticker.x = Math.max(12, Math.min(m.W - 12, pt.x - state.dragOffset.x));
    state.dragSticker.y = Math.max(12, Math.min(m.H - 12, pt.y - state.dragOffset.y));
    renderStrip();
  });

  function endDrag() {
    if (!state.dragSticker) return;
    state.dragSticker = null;
    stripCanvas.classList.remove('dragging');
  }
  stripCanvas.addEventListener('pointerup', endDrag);
  stripCanvas.addEventListener('pointercancel', endDrag);

  /* ═════════════════════════════════════════════════════════════
     9. EDITOR CONTROLS, ZOOM & HIGH-RES EXPORT
  ═════════════════════════════════════════════════════════════ */
  document.querySelectorAll('#swatch-row .swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.click();
      document.querySelectorAll('#swatch-row .swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.frameColor = btn.dataset.color;
      renderStrip();
    });
  });

  document.querySelectorAll('#pat-row .pat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.click();
      document.querySelectorAll('#pat-row .pat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.pattern = btn.dataset.pattern;
      renderStrip();
    });
  });

  document.querySelectorAll('#sticker-grid .sticker-btn').forEach(btn => {
    btn.addEventListener('click', () => addSticker(btn.dataset.sticker));
  });

  $('btn-sticker-undo').addEventListener('click', () => {
    if (!state.stickers.length) return;
    SFX.click();
    state.stickers.pop();
    updateStickerButtons();
    renderStrip();
  });

  $('btn-sticker-clear').addEventListener('click', () => {
    if (!state.stickers.length) return;
    SFX.click();
    state.stickers = [];
    state.stickerCursor = 0;
    updateStickerButtons();
    renderStrip();
  });

  $('caption-input').addEventListener('input', e => {
    state.caption = e.target.value;
    renderStrip();
  });

  $('toggle-date').addEventListener('change', e => {
    SFX.click();
    state.showDate = e.target.checked;
    renderStrip();
  });

  $('btn-replay-slide').addEventListener('click', () => {
    triggerDispenserSlide();
  });

  /* ── Mobile & Desktop High-Res Export Engine ── */
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|WhatsApp|MicroMessenger|wv\)/i.test(ua);

  // Set clearer label on iOS so user knows it opens Save to Photos / Share
  if (isIOS && $('btn-download')) {
    $('btn-download').textContent = 'SAVE PHOTO';
  }

  let stripVersion = 0;
  let exportCache = { version: -1, blob: null, file: null, dataUrl: null, filename: '' };
  let prewarmTimer = null;

  function makeImageFile(blob, filename) {
    try {
      if (blob && typeof File === 'function') {
        return new File([blob], filename, { type: 'image/png' });
      }
    } catch (_) {}
    return null;
  }

  function invalidateExportCache() {
    stripVersion++;
    exportCache = { version: -1, blob: null, file: null, dataUrl: null, filename: '' };
    clearTimeout(prewarmTimer);
    if (!state.rawPhotos.length) return;
    const targetVersion = stripVersion;
    prewarmTimer = setTimeout(() => {
      if (targetVersion !== stripVersion) return;
      try {
        const hiRes = renderStrip(3);
        const filename = `analog-photos-${Date.now()}.png`;
        if (typeof hiRes.toBlob === 'function') {
          hiRes.toBlob(blob => {
            if (!blob || targetVersion !== stripVersion) return;
            const file = makeImageFile(blob, filename);
            exportCache = { version: targetVersion, blob, file, dataUrl: null, filename };
          }, 'image/png');
        }
      } catch (_) {}
    }, 180);
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const parts = dataUrl.split(',');
    if (parts.length < 2 || !parts[1]) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(parts[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise(resolve => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      } catch (_) {
        resolve('');
      }
    });
  }

  function getExportBundleSync() {
    if (exportCache.version === stripVersion && exportCache.blob) {
      return exportCache;
    }
    const hiRes = renderStrip(3);
    const filename = `analog-photos-${Date.now()}.png`;
    const dataUrl = hiRes.toDataURL('image/png');
    const blob = dataUrlToBlob(dataUrl);
    const file = makeImageFile(blob, filename);
    exportCache = { version: stripVersion, blob, file, dataUrl, filename };
    return exportCache;
  }

  function canShareImageFile(file) {
    try {
      return Boolean(
        file &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      );
    } catch (_) {
      return false;
    }
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function flashDownloadSuccess() {
    const btn = $('btn-download');
    if (!btn) return;
    const original = btn.dataset.origLabel || btn.textContent;
    btn.dataset.origLabel = original;
    btn.textContent = 'SAVED ✓';
    clearTimeout(btn._resetTimer);
    btn._resetTimer = setTimeout(() => {
      btn.textContent = original;
    }, 1800);
  }

  // Zoom Inspect & Mobile Save Modal
  const zoomModal = $('zoom-modal');
  let lastExportBundle = null;

  async function openZoomPreview({ saveMode = false, bundle = null } = {}) {
    const exp = bundle || getExportBundleSync();
    lastExportBundle = exp;

    let imgSrc = exp.dataUrl;
    if (!imgSrc && exp.blob) {
      imgSrc = await blobToDataUrl(exp.blob);
      exp.dataUrl = imgSrc;
    }
    if (!imgSrc) {
      const hiRes = renderStrip(3);
      imgSrc = hiRes.toDataURL('image/png');
      exp.dataUrl = imgSrc;
    }

    $('zoom-img').src = imgSrc;
    const shareBtn = $('btn-zoom-share');
    if (shareBtn) {
      shareBtn.classList.toggle('hidden', !canShareImageFile(exp.file));
    }
    zoomModal.classList.toggle('save-mode', saveMode);
    zoomModal.classList.add('open');
    zoomModal.setAttribute('aria-hidden', 'false');
  }

  $('btn-zoom-strip')?.addEventListener('click', () => {
    try { SFX.click(); } catch (_) {}
    openZoomPreview({ saveMode: false });
  });

  function closeZoom() {
    zoomModal.classList.remove('open', 'save-mode');
    zoomModal.setAttribute('aria-hidden', 'true');
  }
  $('btn-zoom-close')?.addEventListener('click', closeZoom);
  $('zoom-backdrop')?.addEventListener('click', closeZoom);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && zoomModal.classList.contains('open')) closeZoom();
  });

  $('btn-zoom-share')?.addEventListener('click', async () => {
    try { SFX.click(); } catch (_) {}
    const exp = lastExportBundle || getExportBundleSync();
    if (canShareImageFile(exp.file)) {
      try {
        await navigator.share({ files: [exp.file] });
        flashDownloadSuccess();
      } catch (_) {}
    }
  });

  $('btn-zoom-download')?.addEventListener('click', () => {
    try { SFX.click(); } catch (_) {}
    const exp = lastExportBundle || getExportBundleSync();
    if (exp.blob) {
      triggerBlobDownload(exp.blob, exp.filename);
      flashDownloadSuccess();
    }
  });

  // High-res 3x PNG Download (Instant 0ms pre-cached File for iOS Web Share + Blob download + Long-Press Fallback)
  let exporting = false;
  $('btn-download').addEventListener('click', async () => {
    if (exporting) return;
    exporting = true;
    try { SFX.click(); } catch (_) {}

    try {
      const exp = getExportBundleSync();

      if (!exp.blob) {
        await openZoomPreview({ saveMode: true, bundle: exp });
        return;
      }

      // On iOS (Safari/Chrome/WKWebView) and in-app browsers, <a download> fails or saves to Files instead of Photos.
      // Calling navigator.share synchronously with the pre-cached File opens the native iOS Share Sheet ("Save Image").
      if (isIOS || isInAppBrowser) {
        if (canShareImageFile(exp.file)) {
          try {
            await navigator.share({ files: [exp.file] });
            flashDownloadSuccess();
            return;
          } catch (err) {
            // User tapped Cancel on the native share sheet — exit cleanly
            if (err && err.name === 'AbortError') {
              return;
            }
          }
        }
        // Bulletproof fallback: open full-res <img> preview so user can long-press -> Save to Photos
        await openZoomPreview({ saveMode: true, bundle: exp });
        return;
      }

      // Desktop & standard Android browsers: Blob Object URL + DOM-attached <a download>
      if ('download' in HTMLAnchorElement.prototype) {
        triggerBlobDownload(exp.blob, exp.filename);
        flashDownloadSuccess();
      } else {
        await openZoomPreview({ saveMode: true, bundle: exp });
      }
    } catch (_) {
      try {
        await openZoomPreview({ saveMode: true });
      } catch (__) {}
    } finally {
      exporting = false;
    }
  });

  // New Session -> Back to Booth Entrance
  $('btn-retake').addEventListener('click', () => {
    SFX.click();
    $('screen-result').classList.remove('active');
    $('screen-result').setAttribute('aria-hidden', 'true');
    $('editor-panel').classList.remove('on');

    // Reset cabin entrance
    cabinStage.classList.remove('entering', 'opening');
    $('cabin-prompt').style.opacity = '1';
    $('screen-home').classList.add('active');
    state.busy = false;
  });

  /* ── Initial Sync ── */
  syncCountUI(4);
  syncFilterUI('bw');
})();
