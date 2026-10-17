/* DRIFT-1: the hero is the instrument.
   One liquid-chrome form (Three.js shader) and one drone synth (Web Audio) share three parameters:
   Drift, Tone and Space. Turning a knob changes the sound and the surface together; the synth's
   loudness drives the surface in real time. Everything below the hero is deliberately still. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Parameters (0..1) and their real-unit mappings ---------------- */
  const P = { drift: 0.4, tone: 0.45, space: 0.35 };
  const lfoHz = (v) => 0.02 * Math.pow(200, v);               // 0.02 – 4 Hz
  const cutoffHz = (v) => 280 * Math.pow(3200 / 280, v);       // 280 Hz – 3.2 kHz
  const feedback = (v) => v * 0.82;                            // 0 – 82 %
  const fmtHz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : hz >= 10 ? `${Math.round(hz)} Hz` : `${hz < 1 ? hz.toFixed(2) : hz.toFixed(1)} Hz`);
  const FORMAT = {
    drift: (v) => fmtHz(lfoHz(v)),
    tone: (v) => fmtHz(cutoffHz(v)),
    space: (v) => `${Math.round(feedback(v) * 100)} %`,
  };

  /* ---------------- Knobs ---------------- */
  function knob(id, key) {
    const el = document.getElementById(id);
    const dial = el.querySelector(".knob-dial"), out = el.querySelector(".knob-val");
    let v = P[key], startY = 0, startV = 0;
    function set(nv) {
      v = clamp(nv, 0, 1);
      P[key] = v;
      dial.style.transform = `rotate(${-135 + v * 270}deg)`;
      el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      el.setAttribute("aria-valuetext", FORMAT[key](v));
      out.textContent = FORMAT[key](v);
      applyAudio();
    }
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId); startY = e.clientY; startV = v; el.classList.add("drag"); el.focus();
    });
    el.addEventListener("pointermove", (e) => { if (el.hasPointerCapture(e.pointerId)) set(startV + (startY - e.clientY) / 180); });
    const end = (e) => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); el.classList.remove("drag"); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      const step = { ArrowUp: 0.04, ArrowRight: 0.04, ArrowDown: -0.04, ArrowLeft: -0.04, PageUp: 0.2, PageDown: -0.2 }[e.key];
      if (step !== undefined) { e.preventDefault(); set(v + step); }
      else if (e.key === "Home") { e.preventDefault(); set(0); }
      else if (e.key === "End") { e.preventDefault(); set(1); }
    });
    el.addEventListener("wheel", (e) => { e.preventDefault(); set(v - e.deltaY / 900); }, { passive: false });
    set(v);
  }

  /* ---------------- Synth (Web Audio) ---------------- */
  let ac = null, A = null, playing = false;
  const playBtn = $("#play"), led = $("#led"), scopeLabel = $("#scope-label");

  function buildSynth() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
    const master = ac.createGain(); master.gain.value = 0;
    const filter = ac.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 6;
    const lfo = ac.createOscillator(); lfo.type = "sine";
    const lfoDepth = ac.createGain();
    lfo.connect(lfoDepth); lfoDepth.connect(filter.frequency); lfo.start();

    // three voices: D2, A2, F3, each with its own slow detune wander
    const voices = [[73.42, "sawtooth", 0.2], [110.0, "triangle", 0.2], [174.61, "sawtooth", 0.1]].map(([f, type, level], i) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = level;
      const wob = ac.createOscillator(); wob.frequency.value = 0.07 + i * 0.043;
      const wobDepth = ac.createGain(); wob.connect(wobDepth); wobDepth.connect(o.detune); wob.start();
      o.connect(g); g.connect(filter); o.start();
      return { wobDepth };
    });

    // tape-style delay with damped feedback
    const dry = ac.createGain(); dry.gain.value = 0.9;
    const delay = ac.createDelay(2); delay.delayTime.value = 0.42;
    const damp = ac.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 2200;
    const fb = ac.createGain(), wet = ac.createGain();
    filter.connect(dry); filter.connect(delay);
    delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(wet);
    dry.connect(master); wet.connect(master);

    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    const analyser = ac.createAnalyser(); analyser.fftSize = 1024;
    master.connect(comp); comp.connect(analyser); analyser.connect(ac.destination);
    return { master, filter, lfo, lfoDepth, voices, fb, wet, analyser, buf: new Float32Array(analyser.fftSize) };
  }

  function applyAudio() {
    if (!A) return;
    const t = ac.currentTime, c = cutoffHz(P.tone);
    A.filter.frequency.setTargetAtTime(c, t, 0.08);
    A.lfo.frequency.setTargetAtTime(lfoHz(P.drift), t, 0.2);
    A.lfoDepth.gain.setTargetAtTime(c * (0.1 + 0.55 * P.drift), t, 0.2);
    A.voices.forEach((v) => v.wobDepth.gain.setTargetAtTime(P.drift * 18, t, 0.3));
    A.fb.gain.setTargetAtTime(feedback(P.space), t, 0.1);
    A.wet.gain.setTargetAtTime(0.15 + P.space * 0.6, t, 0.1);
  }

  async function togglePlay() {
    if (!A) { A = buildSynth(); if (!A) { scopeLabel.textContent = "AUDIO UNAVAILABLE"; return; } applyAudio(); }
    playing = !playing;
    if (playing) {
      if (ac.state !== "running") await ac.resume();
      A.master.gain.cancelScheduledValues(ac.currentTime);
      A.master.gain.setTargetAtTime(0.42, ac.currentTime, 0.6);
    } else {
      A.master.gain.cancelScheduledValues(ac.currentTime);
      A.master.gain.setTargetAtTime(0, ac.currentTime, 0.35);
    }
    playBtn.setAttribute("aria-pressed", String(playing));
    playBtn.querySelector(".play-label").textContent = playing ? "Stop" : "Hear it";
    led.classList.toggle("on", playing);
    scopeLabel.textContent = playing ? "D2 · A2 · F3" : "IDLE";
  }
  playBtn.addEventListener("click", togglePlay);

  // loudness, smoothed; also kept for the scope
  let level = 0;
  function readLevel() {
    if (!A) return 0;
    A.analyser.getFloatTimeDomainData(A.buf);
    let sum = 0;
    for (let i = 0; i < A.buf.length; i++) sum += A.buf[i] * A.buf[i];
    return clamp(Math.sqrt(sum / A.buf.length) * 4.5, 0, 1);
  }

  /* ---------------- Oscilloscope ---------------- */
  const scope = $("#scope"), sctx = scope.getContext("2d");
  function sizeScope() {
    const r = scope.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    scope.width = Math.max(1, Math.round(r.width * d)); scope.height = Math.max(1, Math.round(r.height * d));
  }
  function drawScope(time) {
    const w = scope.width, h = scope.height;
    sctx.clearRect(0, 0, w, h);
    sctx.strokeStyle = "rgba(255,255,255,0.06)"; sctx.lineWidth = 1;
    for (let x = 0; x < w; x += w / 8) { sctx.beginPath(); sctx.moveTo(x, 0); sctx.lineTo(x, h); sctx.stroke(); }
    sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();
    sctx.strokeStyle = playing ? "#ff5a1f" : "#5d6362"; sctx.lineWidth = Math.max(1.5, w / 260);
    sctx.beginPath();
    const N = 220;
    for (let i = 0; i < N; i++) {
      let y;
      if (A && playing) y = A.buf[Math.floor((i / N) * A.buf.length * 0.5)] * 1.8;
      else y = Math.sin(i * 0.12 + time * 1.5) * 0.015;
      const px = (i / (N - 1)) * w, py = h / 2 - clamp(y, -1, 1) * h * 0.42;
      i ? sctx.lineTo(px, py) : sctx.moveTo(px, py);
    }
    sctx.stroke();
  }

  /* ---------------- Waitlist (POST /api/waitlist) ---------------- */
  const form = $("#wl-form"), email = $("#wl-email"), msg = $("#wl-msg"), countEl = $("#wl-count");
  const submitBtn = form.querySelector("button[type=submit]");
  const NO_SERVER = "This copy of the page has no server behind it, so the waitlist only works on the live site.";
  const showCount = (n) => {
    if (typeof n !== "number") return;
    countEl.textContent = n === 1 ? "1 person is on the list." : `${n.toLocaleString("en-US")} people are on the list.`;
    countEl.hidden = false;
  };
  fetch("api/waitlist", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null)).then((d) => d && showCount(d.count)).catch(() => {});

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!email.value || !email.checkValidity()) { msg.textContent = "Enter an email address like name@example.com."; email.focus(); return; }
    submitBtn.disabled = true; msg.textContent = "Adding you…";
    try {
      const r = await fetch("api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email.value, company: form.company.value }),
      });
      const data = await r.json().catch(() => null);
      if (!data) msg.textContent = NO_SERVER;
      else if (data.status === "joined") { msg.textContent = "You're on the list. We'll email you when the first batch opens."; form.reset(); }
      else if (data.status === "already_joined") msg.textContent = "That email is already on the list.";
      else msg.textContent = data.message || "Something went wrong. Try again shortly.";
      showCount(data && data.count);
    } catch (err) {
      msg.textContent = NO_SERVER;
    } finally {
      submitBtn.disabled = false;
    }
  });

  ["k-drift", "k-tone", "k-space"].forEach((id) => knob(id, id.slice(2)));

  /* ---------------- The surface (Three.js) ---------------- */
  const canvas = $("#stage");
  if (!window.THREE) { sizeScope(); scopeLoop(); return; }
  try { initStage(); } catch (err) { console.warn("WebGL unavailable:", err); canvas.remove(); sizeScope(); scopeLoop(); }

  function scopeLoop() {
    const tick = (now) => { level = lerp(level, readLevel(), 0.2); drawScope(now / 1000); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  function initStage() {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0, 5.2);

    const NOISE = `
      vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
      vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
      float snoise(vec3 v){
        const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
        vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
        vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
        vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
        i=mod289(i);
        vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
        float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
        vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
        vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
        vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
        vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
        vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
        vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
        vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
        p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
        vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
        return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
      }`;

    const uniforms = {
      uTime: { value: 0 }, uAmp: { value: 0.2 }, uFreq: { value: 1.4 }, uLevel: { value: 0 },
      uPress: { value: 0 }, uPointer: { value: new THREE.Vector3(0, 0, 1) }, uWarm: { value: 0.5 },
      uAccent: { value: new THREE.Vector3(1.0, 0.36, 0.13) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: NOISE + `
        uniform float uTime, uAmp, uFreq, uLevel, uPress; uniform vec3 uPointer;
        varying vec3 vN; varying vec3 vWorld; varying float vDisp;
        float field(vec3 p){
          vec3 q = p*uFreq;
          float n = snoise(q + vec3(0.0, uTime*0.55, uTime*0.27));
          n += 0.18*snoise(q*1.9 - vec3(uTime*0.38, 0.0, uTime*0.21));
          float d = uAmp * n * (1.0 + uLevel*1.4);
          d += uLevel * 0.05 * sin(p.y*16.0 - uTime*7.0);
          float pd = distance(normalize(p), uPointer);
          d -= uPress * 0.32 * exp(-pd*pd*7.0);
          d += uPress * 0.06 * exp(-pow(pd-0.55, 2.0)*30.0);   // the rim that bulges around a press
          return d;
        }
        vec3 displaced(vec3 p){ return normalize(p) * (1.0 + field(p)); }
        void main(){
          vec3 n = normalize(position);
          vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
          vec3 b = normalize(cross(n, t));
          float e = 0.012;
          vec3 P0 = displaced(n);
          vec3 P1 = displaced(normalize(n + t*e));
          vec3 P2 = displaced(normalize(n + b*e));
          vec3 nn = normalize(cross(P1 - P0, P2 - P0));
          if (dot(nn, n) < 0.0) nn = -nn;
          vDisp = length(P0) - 1.0;
          vec4 wp = modelMatrix * vec4(P0, 1.0);
          vWorld = wp.xyz;
          vN = normalize(mat3(modelMatrix) * nn);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uAccent; uniform float uWarm; uniform float uLevel;
        varying vec3 vN; varying vec3 vWorld; varying float vDisp;
        // a procedural photo studio: dark floor, pale cyc wall, two softboxes and an amber kicker
        vec3 env(vec3 r){
          vec3 c = mix(vec3(0.22,0.23,0.235), vec3(0.84,0.85,0.84), smoothstep(-0.45, 0.45, r.y));
          c += vec3(0.35) * exp(-abs(r.y + 0.04) * 26.0);
          float box1 = smoothstep(0.2, 0.0, abs(r.x - 0.5)) * smoothstep(-0.05, 0.45, r.y);
          float box2 = smoothstep(0.09, 0.0, abs(r.z + 0.25 + r.x * 0.35)) * smoothstep(0.25, 0.75, r.y);
          c += vec3(0.9) * box1 + vec3(0.55) * box2;
          float kick = smoothstep(0.7, 1.0, dot(r, normalize(vec3(-0.8, -0.3, 0.5))));
          c += uAccent * kick * (0.55 + uLevel * 2.0);
          return c;
        }
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 R = reflect(-V, N);
          vec3 c = env(R);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 tint = mix(vec3(0.80, 0.87, 0.96), vec3(1.0, 0.88, 0.76), uWarm);
          c *= tint;
          c += fres * 0.28 * mix(vec3(0.75, 0.82, 0.95), uAccent, 0.4 + uLevel * 0.4);
          c *= clamp(0.88 + vDisp * 1.1, 0.55, 1.2);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });

    let W = 1, H = 1, wide = true;
    const seg = innerWidth < 700 ? 140 : 240;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)), material);
    const rig = new THREE.Group(); rig.add(blob); scene.add(rig);

    // soft contact shadow
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uK: { value: 1 } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "uniform float uK; varying vec2 vUv; void main(){ float d = length(vUv-0.5)*2.0; float a = pow(smoothstep(1.0,0.0,d),2.2)*0.32*uK; gl_FragColor = vec4(0.07,0.08,0.08,a); }",
      })
    );
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.15;
    scene.add(shadow);

    const DPR = Math.min(window.devicePixelRatio || 1, innerWidth < 700 ? 1.5 : 2);
    renderer.setPixelRatio(DPR);
    const hero = $(".hero");
    function resize() {
      const r = hero.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height); wide = W > 900;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      if (wide) camera.setViewOffset(W, H, -W * 0.2, H * 0.06, W, H);
      else camera.setViewOffset(W, H, 0, H * 0.27, W, H);
      camera.fov = wide ? 34 : 44;
      camera.updateProjectionMatrix();
      sizeScope();
    }
    resize();
    addEventListener("resize", resize);

    // pointer: hover dents gently, press dents deeply
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1.08);
    let hovering = false, pressing = false, tiltX = 0, tiltY = 0, pTiltX = 0, pTiltY = 0;
    function locate(e) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      tiltX = ndc.x; tiltY = ndc.y;
      ray.setFromCamera(ndc, camera);
      sphere.center.setFromMatrixPosition(blob.matrixWorld);
      sphere.radius = 1.08 * rig.scale.x;
      hovering = !!ray.ray.intersectSphere(sphere, hit);
      if (hovering) uniforms.uPointer.value.copy(blob.worldToLocal(hit.clone()).normalize());
    }
    canvas.addEventListener("pointermove", locate, { passive: true });
    canvas.addEventListener("pointerleave", () => { hovering = false; pressing = false; canvas.classList.remove("pressing"); });
    canvas.addEventListener("pointerdown", (e) => { locate(e); if (hovering) { pressing = true; canvas.classList.add("pressing"); } });
    addEventListener("pointerup", () => { pressing = false; canvas.classList.remove("pressing"); });

    // only render while the hero is on screen
    let visible = true;
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(hero);

    const start = performance.now();
    let last = start, t = 0, press = 0;
    const S = { amp: 0.12, freq: 1.1, speed: 0.4, warm: 0.5 };

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      level = lerp(level, readLevel(), 0.18);
      drawScope(now / 1000);
      if (!visible) return;

      // knob targets → smoothed visual params
      const k = 1 - Math.pow(0.002, dt);
      S.speed = lerp(S.speed, 0.12 + P.drift * 0.95, k);
      S.freq = lerp(S.freq, 0.75 + P.tone * 0.85, k);
      S.amp = lerp(S.amp, 0.07 + P.space * 0.12 + P.drift * 0.04, k);
      S.warm = lerp(S.warm, 1 - P.tone, k);
      t += dt * S.speed * (reduce ? 0.2 : 1);

      press = lerp(press, pressing ? 1 : hovering ? 0.3 : 0, 1 - Math.pow(0.001, dt));
      uniforms.uTime.value = t;
      uniforms.uAmp.value = S.amp;
      uniforms.uFreq.value = S.freq;
      uniforms.uWarm.value = S.warm;
      uniforms.uLevel.value = level;
      uniforms.uPress.value = press;

      // intro: the form settles in from slightly smaller
      const intro = reduce ? 1 : 1 - Math.pow(1 - clamp((now - start) / 1600, 0, 1), 3);
      const base = wide ? 0.74 : 0.6;
      rig.scale.setScalar(base * (0.72 + 0.28 * intro) * (1 + level * 0.06));
      pTiltX = lerp(pTiltX, tiltX, 0.05); pTiltY = lerp(pTiltY, tiltY, 0.05);
      rig.rotation.y += dt * (reduce ? 0 : 0.08 + P.drift * 0.12);
      rig.rotation.x = -pTiltY * 0.18;
      rig.rotation.z = pTiltX * -0.06;
      shadow.material.uniforms.uK.value = intro * (1 - level * 0.25);
      shadow.scale.setScalar(base * (0.9 + level * 0.1));

      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
})();
