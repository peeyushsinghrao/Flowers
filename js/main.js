/* ===========================================================
   Main — app bootstrap, camera lifecycle, render loop,
   settings wiring, and gesture-to-scene connections.
=========================================================== */
(function(){
  // ---------- DOM refs ----------
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const composite = document.getElementById('composite');
  const ctx = overlay.getContext('2d');
  const compositeCtx = composite.getContext('2d');

  const loading = document.getElementById('loading');
  const errorBox = document.getElementById('errorBox');
  const errTitle = document.getElementById('errTitle');
  const errDetail = document.getElementById('errDetail');

  const growVal = document.getElementById('growVal');
  const bloomVal = document.getElementById('bloomVal');
  const modeVal = document.getElementById('modeVal');
  const leftBadge = document.getElementById('leftBadge');
  const rightBadge = document.getElementById('rightBadge');

  const gearBtn = document.getElementById('gearBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const cameraSelect = document.getElementById('cameraSelect');
  const mirrorToggle = document.getElementById('mirrorToggle');
  const skeletonToggle = document.getElementById('skeletonToggle');
  const soundToggle = document.getElementById('soundToggle');
  const speciesBtns = document.querySelectorAll('.species-btn');
  const replayOnboardingBtn = document.getElementById('replayOnboarding');

  const captureBtn = document.getElementById('captureBtn');
  const recordBtn = document.getElementById('recordBtn');
  const recTimer = document.getElementById('recTimer');
  const flash = document.getElementById('flash');
  const toast = document.getElementById('toast');

  // ---------- State ----------
  let mirrored = true;
  let showSkeleton = false;
  let currentStream = null;
  let currentDeviceId = null;
  let handTracker = null;
  let gestureDetector = new GestureDetector(CONFIG);
  let scene = new FlowerScene('tulip');
  let recorder = null;

  let latestLeftLm = null;
  let latestRightLm = null;
  let latestRawResults = null;

  // ---------- Toast helper ----------
  let toastTimeout = null;
  function showToast(message, { spinner = false, duration = 2400 } = {}){
    toast.innerHTML = spinner ? `<div class="spinner-sm"></div><span>${message}</span>` : `<span>${message}</span>`;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    if (duration > 0){
      toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
    }
  }
  function hideToast(){ toast.classList.remove('show'); }

  // ---------- Error display ----------
  function showError(err){
    loading.style.display = 'none';
    errorBox.style.display = 'flex';

    const isFileProtocol = location.protocol === 'file:';
    const isInsecure = location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';

    if (isFileProtocol){
      errTitle.textContent = "Can't access camera from a local file";
      errDetail.innerHTML = 'Browsers block camera access when a page is opened directly (file://). Serve this folder over localhost, e.g. run <code>python3 -m http.server</code> in it and open <code>http://localhost:8000</code>, then reload.';
    } else if (isInsecure){
      errTitle.textContent = 'Camera needs a secure connection';
      errDetail.textContent = 'Camera access requires HTTPS (or localhost). Serve this page over https:// and reload.';
    } else if (err && err.name === 'NotAllowedError'){
      errTitle.textContent = 'Camera permission was denied';
      errDetail.textContent = "Check your browser's site settings (camera icon in the address bar) to allow access, then reload.";
    } else if (err && err.name === 'NotFoundError'){
      errTitle.textContent = 'No camera found';
      errDetail.textContent = 'No webcam was detected on this device. Connect a camera and reload.';
    } else if (err && err.name === 'NotReadableError'){
      errTitle.textContent = 'Camera is in use by another app';
      errDetail.textContent = 'Close other apps/tabs using your webcam and reload.';
    } else {
      errTitle.textContent = 'Something went wrong starting the camera or tracking model';
      errDetail.textContent = (err && (err.message || err.name)) || 'Unknown error — check the browser console for details.';
    }
  }

  // ---------- Canvas sizing ----------
  function resizeCanvases(){
    const dpr = window.devicePixelRatio || 1;
    [overlay, composite].forEach(c => {
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
    });
  }
  window.addEventListener('resize', resizeCanvases);

  // ---------- Settings: gear panel ----------
  gearBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
    gearBtn.classList.toggle('spin', settingsPanel.classList.contains('open'));
  });

  mirrorToggle.addEventListener('click', () => {
    mirrored = !mirrored;
    mirrorToggle.classList.toggle('on', mirrored);
    video.style.transform = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
  });

  skeletonToggle.addEventListener('click', () => {
    showSkeleton = !showSkeleton;
    skeletonToggle.classList.toggle('on', showSkeleton);
  });

  soundToggle.addEventListener('click', () => {
    const isOn = !soundToggle.classList.contains('on');
    soundToggle.classList.toggle('on', isOn);
    AppAudio.setEnabled(isOn);
  });

  speciesBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speciesBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scene.setSpecies(btn.dataset.species);
    });
  });

  replayOnboardingBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
    gearBtn.classList.remove('spin');
    Onboarding.show();
  });

  // ---------- Camera device list + switching ----------
  async function listCameras(){
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    cameraSelect.innerHTML = '';
    cams.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera ${i+1}`;
      cameraSelect.appendChild(opt);
    });
    if (cams.length && !currentDeviceId) currentDeviceId = cams[0].deviceId;
  }

  cameraSelect.addEventListener('change', async () => {
    currentDeviceId = cameraSelect.value;
    try {
      await startCamera(currentDeviceId);
    } catch(e){
      showError(e);
    }
  });

  async function startCamera(deviceId){
    if (currentStream){
      currentStream.getTracks().forEach(t => t.stop());
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      const err = new Error('getUserMedia unavailable (insecure context or unsupported browser)');
      err.name = 'NotSupportedError';
      throw err;
    }
    // Request camera + mic together, per spec, so recordings include audio.
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
      audio: true,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    video.srcObject = stream;
    await video.play();
    await listCameras();
    if (deviceId) cameraSelect.value = deviceId;
    resizeCanvases();
    return true;
  }

  // ---------- Gesture -> Scene wiring ----------
  gestureDetector.onFistStart = (hand) => {
    scene.startWilt();
    showToast('Wilting… relax your fist to grow again', { duration: 1800 });
  };
  gestureDetector.onFistEnd = (hand) => {
    if (!gestureDetector.isAnyFistActive()){
      scene.cancelWilt();
    }
  };
  gestureDetector.onPinch = (hand) => {
    const plucked = scene.pluckRandomPetal();
    if (plucked) AppAudio.playPluck();
  };
  gestureDetector.onCupStart = () => {
    scene.enterBouquetMode();
    modeVal.textContent = 'Bouquet';
    showToast('🌷 Bouquet mode', { duration: 1600 });
  };
  gestureDetector.onCupEnd = () => {
    scene.exitBouquetMode();
    modeVal.textContent = 'Single';
  };

  // ---------- Hand tracking results handler ----------
  function onHandResults({ leftLm, rightLm }){
    latestLeftLm = leftLm;
    latestRightLm = rightLm;

    leftBadge.style.display = leftLm ? 'block' : 'none';
    rightBadge.style.display = rightLm ? 'block' : 'none';

    const now = performance.now();

    let targetGrow = scene.getAvgGrow();
    let targetBloom = scene.getAvgBloom();

    if (rightLm){
      targetGrow = HandMetrics.openness(rightLm);
      gestureDetector.updateHand('right', rightLm, now);
    }
    if (leftLm){
      targetBloom = HandMetrics.spread(leftLm);
      gestureDetector.updateHand('left', leftLm, now);
    }

    if (!gestureDetector.isAnyFistActive()){
      scene.setTargets(targetGrow, targetBloom);
    }

    gestureDetector.updateTwoHands(leftLm, rightLm, now);

    positionBadge(rightBadge, rightLm);
    positionBadge(leftBadge, leftLm);
  }

  function positionBadge(badgeEl, lm){
    if (!lm) return;
    const wrist = lm[0];
    const x = mirrored ? (1 - wrist.x) : wrist.x;
    badgeEl.style.left = (x * overlay.clientWidth - 40) + 'px';
    badgeEl.style.top = (wrist.y * overlay.clientHeight - 46) + 'px';
  }

  function toScreen(pt){
    const x = mirrored ? (1 - pt.x) : pt.x;
    return { x: x * overlay.width, y: pt.y * overlay.height };
  }

  function drawSkeleton(lm){
    ctx.save();
    ctx.strokeStyle = 'rgba(127,174,138,0.5)';
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    HAND_CONNECTIONS.forEach(([a,b]) => {
      const p1 = toScreen(lm[a]);
      const p2 = toScreen(lm[b]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });
    lm.forEach(pt => {
      const p = toScreen(pt);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * (window.devicePixelRatio || 1), 0, Math.PI*2);
      ctx.fillStyle = 'rgba(232,135,154,0.8)';
      ctx.fill();
    });
    ctx.restore();
  }

  // ---------- Render loop (decoupled from detection rate) ----------
  function renderLoop(){
    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const dims = { width: overlay.width, height: overlay.height };

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    scene.update(now, dims);
    scene.draw(ctx, dims, dpr);

    if (showSkeleton){
      if (latestLeftLm) drawSkeleton(latestLeftLm);
      if (latestRightLm) drawSkeleton(latestRightLm);
    }

    growVal.textContent = scene.getAvgGrow().toFixed(2);
    bloomVal.textContent = scene.getAvgBloom().toFixed(2);
    AppAudio.onBloomUpdate(scene.getAvgBloom());

    // Keep the hidden composite canvas (camera + effects) in sync for
    // capture/recording, matching what's visually on screen.
    compositeCtx.save();
    if (mirrored){
      compositeCtx.translate(composite.width, 0);
      compositeCtx.scale(-1, 1);
    }
    if (video.readyState >= 2){
      compositeCtx.drawImage(video, 0, 0, composite.width, composite.height);
    }
    compositeCtx.restore();
    compositeCtx.drawImage(overlay, 0, 0, composite.width, composite.height);

    requestAnimationFrame(renderLoop);
  }

  // ---------- Capture button ----------
  captureBtn.addEventListener('click', async () => {
    flash.classList.remove('fire'); void flash.offsetWidth; flash.classList.add('fire');
    showToast('Saved to your device…', { spinner: true, duration: 0 });

    const result = await CaptureModule.captureAndSave(video, overlay, mirrored, (status, err) => {
      if (status === 'saved-local') showToast('Saved to your device. Uploading…', { spinner: true, duration: 0 });
      if (status === 'uploaded') showToast('✓ Saved locally + uploaded', { duration: 2200 });
      if (status === 'upload-error') showToast('Saved locally. Upload failed — check connection.', { duration: 3200 });
    });
  });

  // ---------- Record button ----------
  let isRecordingUI = false;
  recorder = new SessionRecorder({
    canvas: composite,
    videoEl: video,
    onStatus: (status, payload) => {
      if (status === 'mic-denied'){
        showToast('Recording without audio (mic permission denied)', { duration: 3000 });
      } else if (status === 'started'){
        showToast('Recording started', { duration: 1600 });
      } else if (status === 'uploading-chunk'){
        showToast(`Uploading chunk ${payload.index}…`, { spinner: true, duration: 0 });
      } else if (status === 'chunk-uploaded'){
        showToast(`✓ Chunk ${payload.index} uploaded`, { duration: 1600 });
      } else if (status === 'chunk-upload-error'){
        showToast(`Chunk ${payload.index} upload failed (kept locally)`, { duration: 2600 });
      } else if (status === 'finalizing'){
        showToast('Finalizing recording…', { spinner: true, duration: 0 });
      } else if (status === 'finalized-uploaded'){
        showToast('✓ Recording saved locally + uploaded', { duration: 2600 });
      } else if (status === 'max-duration-reached'){
        showToast('Reached max recording length — saving…', { duration: 2400 });
      } else if (status === 'stopped'){
        // handled by finalized-uploaded shortly after
      } else if (status === 'start-error'){
        showToast('Could not start recording on this browser.', { duration: 3200 });
      }
    },
    onTimerUpdate: (elapsedMs) => {
      recTimer.textContent = formatElapsed(elapsedMs);
    },
  });

  recordBtn.addEventListener('click', async () => {
    if (!isRecordingUI){
      isRecordingUI = true;
      recordBtn.classList.add('active');
      recTimer.style.display = 'block';
      recordBtn.title = 'Stop recording';
      await recorder.start();
    } else {
      isRecordingUI = false;
      recordBtn.classList.remove('active');
      recTimer.style.display = 'none';
      recordBtn.title = 'Start recording';
      recorder.stop();
    }
  });

  // ---------- Bootstrap ----------
  async function init(){
    Onboarding.init();

    const readyTimeout = setTimeout(() => {
      if (!handTracker || !handTracker.ready){
        showError(new Error('Timed out loading the hand-tracking model (check your network settings).'));
      }
    }, 20000);

    try {
      await startCamera(null);

      handTracker = new HandTracker(video, { onResults: onHandResults });
      await handTracker.initialize();
      clearTimeout(readyTimeout);

      loading.style.display = 'none';
      handTracker.startLoop();
      renderLoop();

      Onboarding.showIfFirstTime();
    } catch(e){
      console.error(e);
      clearTimeout(readyTimeout);
      showError(e);
    }
  }

  init();
})();
