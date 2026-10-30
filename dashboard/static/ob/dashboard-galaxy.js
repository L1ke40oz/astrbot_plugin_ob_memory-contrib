/* 记忆星河：替换原「记忆网络」页。每个记忆桶是一颗星——越早越靠近银河中心，越重要越大越亮；
   点一颗星，同领域的记忆一起亮起、拉出星座连线，文字从底部浮现。
   设计准则：不要做漂浮在太空里的记忆列表，要做一片活的银河。
   3D 引擎 three.js r160 随站点下发（/ob/static/galaxy-engine.js），不再依赖国内常连不上的 jsDelivr；
   本地引擎缺失时再试 CDN，两者都失败或浏览器没有 WebGL 才退回原来的记忆网络，下次进入本页会重试。 */
(function () {
  'use strict';
  var ENGINE = '/ob/static/galaxy-engine.js';
  var CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
  var CONFIG = {
    title: 'Memory',
    subtitle: 'A constellation of memories',
    motto: '这里记录着我们共同创造的回忆',
    coreEn: 'Where it all began'
  };
  // 颜色是分类的语言：粉=温柔·金=珍贵·蓝紫=思考。没配到的领域按名字哈希取柔和色。
  var PAL = {
    '恋爱':'#ff7ec4','关系核心':'#ff8fd0','婚恋':'#ff9ad0','我们的故事':'#e888d8','关系':'#ff9ad0',
    '编程':'#8f9fff','AI':'#a98cff','网络':'#8fa8ff','心理':'#9a8cf0','自省':'#a89ce8','情绪':'#b48ce8',
    '家庭':'#ffcf8a','宠物':'#ffbe7a','居家':'#ffd6a3','回忆':'#f0c88a','工作':'#ffe39a','求职':'#ffdb88',
    '学习':'#ecd8a0','创作':'#dca0ec','写作':'#cca8f0','游戏':'#f09ce8','社交':'#9cc4ff','人际':'#aac0f0',
    '日常':'#cfd8f0','出行':'#a0c8dc','健康':'#c8e0bc','饮食':'#ffcf9a','letter':'#f6c8e0'
  };
  var FALL = ['#ff9ed4','#b98cff','#8f9fff','#ffc98a','#c8a0f0','#e89ce8','#ffb0d8'];
  var NOISE_DOM = {'':1,'其他':1,'未分类':1,'feel':1,'plan':1};
  function domCol(d) {
    if (PAL[d]) return PAL[d];
    var h = 0; String(d || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return FALL[h % FALL.length];
  }
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var pw = function (p) { return Math.pow(Math.random(), p); };
  function esc(t) { return String(t || '').replace(/[&<>"]/g, function (m) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]; }); }

  function memoryDomains(value) {
    return (Array.isArray(value) ? value : [value]).filter(function (domain) {
      return typeof domain === 'string' && domain.trim();
    }).map(function (domain) { return domain.trim(); }).filter(function (domain, index, domains) {
      return domains.indexOf(domain) === index;
    });
  }

  function relatedMemories(memories, index) {
    var source = memories[index].s;
    var domains = memoryDomains(source.domains || source.domain).filter(function (domain) {
      return !Object.prototype.hasOwnProperty.call(NOISE_DOM, domain);
    });
    return memories.map(function (memory, i) { return {m:memory, i:i}; }).filter(function (item) {
      return item.i !== index && memoryDomains(item.m.s.domains || item.m.s.domain).some(function (domain) {
        return domains.indexOf(domain) >= 0;
      });
    }).sort(function (a, b) { return b.m.imp - a.m.imp; }).slice(0, 8);
  }

  var enginePromise = null;
  function loadEngine() {
    if (!enginePromise) {
      enginePromise = import(ENGINE).catch(function (err) {
        console.warn('本地星河引擎加载失败，改从 CDN 加载', err);
        return loadCdnEngine();
      });
      enginePromise.catch(function () { enginePromise = null; });
    }
    return enginePromise;
  }
  function loadCdnEngine() {
    return Promise.all([
      import(CDN + '+esm'),
      import(CDN + 'examples/jsm/controls/OrbitControls.js/+esm'),
      import(CDN + 'examples/jsm/postprocessing/EffectComposer.js/+esm'),
      import(CDN + 'examples/jsm/postprocessing/RenderPass.js/+esm'),
      import(CDN + 'examples/jsm/postprocessing/UnrealBloomPass.js/+esm'),
      import(CDN + 'examples/jsm/postprocessing/OutputPass.js/+esm')
    ]).then(function (m) {
      return {THREE:m[0], OrbitControls:m[1].OrbitControls, EffectComposer:m[2].EffectComposer,
        RenderPass:m[3].RenderPass, UnrealBloomPass:m[4].UnrealBloomPass, OutputPass:m[5].OutputPass};
    });
  }

  function fetchStars() {
    var base = typeof BASE !== 'undefined' ? BASE : '';
    return fetch(base + '/api/buckets?sort=created_asc', {credentials:'same-origin'}).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !Array.isArray(data)) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data.filter(function (b) { return !b.letter_locked; }).map(function (b) {
          var domains = memoryDomains(b.domain);
          return {id:b.id, name:b.name, domain:domains[0] || '', domains:domains, importance:Number(b.importance) || 5,
            pinned:!!b.pinned, created:b.created || '', content:b.content || b.content_preview || ''};
        });
      });
    });
  }

  // ── 粒子柔光 shader（很慢的呼吸 + 近大远小）──
  var P_VERT = [
    'attribute float aSize; attribute float aPhase; attribute vec3 aColor;',
    'uniform float uTime; uniform float uPix; varying vec3 vColor; varying float vTw;',
    'void main(){',
    '  vColor=aColor;',
    '  float br=0.9+0.1*sin(uTime*0.28+aPhase);',
    '  vTw=br;',
    '  vec4 mv=modelViewMatrix*vec4(position,1.0);',
    '  gl_PointSize=aSize*uPix*br*(1.0/-mv.z);',
    '  gl_Position=projectionMatrix*mv;',
    '}'].join('\n');
  var P_FRAG = [
    'varying vec3 vColor; varying float vTw;',
    'void main(){',
    '  float d=length(gl_PointCoord-0.5);',
    '  float a=smoothstep(0.5,0.0,d);',
    '  a=pow(a,1.6)*vTw;',
    '  if(a<0.01) discard;',
    '  gl_FragColor=vec4(vColor,a);',
    '}'].join('\n');

  function Galaxy(host, E) {
    var THREE = E.THREE;
    var self = this;
    var canvas = host.querySelector('.ob-galaxy-gl');
    var GAL_R = 5, BRANCHES = 2, SPIN = 1.15;
    var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:false});
    // 泛光后处理很吃 GPU：像素比封顶 1.5，帧率封顶 60（高刷屏上不跟着跑 144/165 帧）
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#050209');
    var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 3.1, 8.4);
    var controls = new E.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = .05;
    controls.enablePan = false; controls.autoRotate = true; controls.autoRotateSpeed = .32;
    controls.minDistance = 2.2; controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * .86;

    function C(hex) { var c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
    function particleMat(scale) {
      return new THREE.ShaderMaterial({
        uniforms:{uTime:{value:0}, uPix:{value:renderer.getPixelRatio() * scale}},
        vertexShader:P_VERT, fragmentShader:P_FRAG,
        transparent:true, depthWrite:false, blending:THREE.AdditiveBlending});
    }
    function points(pos, col, sz, ph, mat) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      return new THREE.Points(g, mat);
    }

    // 银河盘：核心重心 + 被星尘糊化的弥漫双臂
    (function buildGalaxy() {
      var N = 14000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
      var cIn = C('#ffdcf2'), cMid = C('#c891ff'), cOut = C('#8fb0ff'), gold = C('#ffcf9a');
      for (var i = 0; i < N; i++) {
        var r = pw(1.7) * GAL_R, branch = (i % BRANCHES) / BRANCHES * Math.PI * 2, spin = r * SPIN, scat = .55;
        var sx = pw(2.6) * (Math.random() < .5 ? 1 : -1) * scat * (r + .4);
        var sz2 = pw(2.6) * (Math.random() < .5 ? 1 : -1) * scat * (r + .4);
        var sy = pw(3) * (Math.random() < .5 ? 1 : -1) * scat * .34 * (r + .3);
        pos[i * 3] = Math.cos(branch + spin) * r + sx; pos[i * 3 + 1] = sy; pos[i * 3 + 2] = Math.sin(branch + spin) * r + sz2;
        var t = r / GAL_R, a = t < .5 ? cIn : cMid, b = t < .5 ? cMid : cOut, k = t < .5 ? t / .5 : (t - .5) / .5;
        var c = Math.random() < .06 ? gold : [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        sz[i] = rand(1.4, 5) * (t < .3 ? 1.15 : 1); ph[i] = Math.random() * 6.28;
      }
      self.galaxy = points(pos, col, sz, ph, particleMat(1.05)); scene.add(self.galaxy);
    })();
    // 弥漫星尘：铺满空间，增强景深
    (function buildDust() {
      var N = 6400, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
      var cols = [C('#e8b8ff'), C('#9fb8ff'), C('#ffd0ec'), C('#c8a0f0'), C('#ffe0b0')];
      for (var i = 0; i < N; i++) {
        var r = pw(1.1) * GAL_R * 1.7 + .5, th = Math.random() * Math.PI * 2, y = (Math.random() - .5) * GAL_R * 1.1;
        pos[i * 3] = Math.cos(th) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(th) * r;
        var c = cols[Math.floor(Math.random() * cols.length)];
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        sz[i] = rand(.5, 1.8); ph[i] = Math.random() * 6.28;
      }
      var m = particleMat(1); m.uniforms.uPix.value *= .9;
      self.dust = points(pos, col, sz, ph, m); scene.add(self.dust);
    })();
    // 若隐若现的淡金轨道环
    [1.3, 2.4, 3.6, 4.7].forEach(function (r) {
      var ring = new THREE.Mesh(new THREE.RingGeometry(r - .006, r + .006, 128),
        new THREE.MeshBasicMaterial({color:'#ffd9a0', transparent:true, opacity:.05, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, depthWrite:false}));
      ring.rotation.x = -Math.PI / 2; scene.add(ring);
    });
    // 中心紫色柔光晕
    (function buildCoreGlow() {
      var s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
      var g = cv.getContext('2d'), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,226,246,.5)'); grd.addColorStop(.28, 'rgba(234,178,242,.2)');
      grd.addColorStop(.62, 'rgba(186,142,236,.06)'); grd.addColorStop(1, 'rgba(162,126,226,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
      self.coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv), blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:.4}));
      self.coreGlow.scale.set(1.8, 1.8, 1); scene.add(self.coreGlow);
    })();

    var composer = new E.EffectComposer(renderer);
    composer.addPass(new E.RenderPass(scene, camera));
    var bloom = new E.UnrealBloomPass(new THREE.Vector2(1, 1), .6, .62, .12);
    composer.addPass(bloom);
    composer.addPass(new E.OutputPass());

    // ── 记忆星：时间当半径，四档大小亮度 ──
    var mem = [], memPoints = null, origColor = null, origSize = null, hlLines = null, hlActive = [];
    this.setStars = function (stars) {
      clearHighlight();
      if (memPoints) { scene.remove(memPoints); memPoints.geometry.dispose(); memPoints.material.dispose(); memPoints = null; }
      mem = [];
      if (!stars.length) return;
      var ts = stars.map(function (s) { return +new Date(s.created); }).filter(function (t) { return !isNaN(t); });
      var t0 = ts.length ? Math.min.apply(null, ts) : 0, span = Math.max(1, (ts.length ? Math.max.apply(null, ts) : 1) - t0);
      var sorted = stars.slice().sort(function (a, b) { return String(a.created).localeCompare(String(b.created)); });
      mem = sorted.map(function (s, i) {
        var t = +new Date(s.created), tt = isNaN(t) ? Math.random() : (t - t0) / span;
        var r = .15 + Math.pow(tt, .85) * GAL_R * .96, branch = (i % BRANCHES) / BRANCHES * Math.PI * 2, spin = r * SPIN;
        return {s:s, x:Math.cos(branch + spin) * r + rand(-.35, .35), y:rand(-.16, .16), z:Math.sin(branch + spin) * r + rand(-.35, .35),
          imp:s.importance || 4, color:domCol(s.domain)};
      });
      var core = mem[0]; core.x = core.y = core.z = 0; core.isCore = true;
      var N = mem.length, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
      mem.forEach(function (m, i) {
        pos[i * 3] = m.x; pos[i * 3 + 1] = m.y; pos[i * 3 + 2] = m.z;
        var imp = Math.min(m.imp, 10);
        var tier = m.isCore ? 3 : ((m.s.pinned || imp >= 9) ? 2 : (imp >= 7 ? 1 : 0));
        sz[i] = [5, 9, 12, 13][tier];
        var dim = [.62, .85, 1, 1.15][tier], c = C(m.color);
        col[i * 3] = c[0] * dim; col[i * 3 + 1] = c[1] * dim; col[i * 3 + 2] = c[2] * dim;
        ph[i] = Math.random() * 6.28;
      });
      memPoints = points(pos, col, sz, ph, particleMat(1.4));
      scene.add(memPoints);
      origColor = Float32Array.from(col); origSize = Float32Array.from(sz);
    };
    this.core = function () { return mem[0] || null; };
    this.ids = function () { return mem.map(function (m) { return m.s.id; }); };
    // 从「寻找一颗记忆星」菜单选中：点亮对应的星和同领域星座，返回这颗星
    this.focus = function (id) {
      var index = mem.findIndex(function (m) { return String(m.s.id) === String(id); });
      if (index < 0) return null;
      highlight(index);
      return mem[index];
    };

    function clearHighlight() {
      host.dataset.constellationLinks = '0';
      if (hlLines) { scene.remove(hlLines); hlLines.geometry.dispose(); hlLines.material.dispose(); hlLines = null; }
      if (hlActive.length && memPoints) {
        var cA = memPoints.geometry.attributes.aColor, sA = memPoints.geometry.attributes.aSize;
        hlActive.forEach(function (i) {
          cA.array[i * 3] = origColor[i * 3]; cA.array[i * 3 + 1] = origColor[i * 3 + 1]; cA.array[i * 3 + 2] = origColor[i * 3 + 2]; sA.array[i] = origSize[i];
        });
        cA.needsUpdate = true; sA.needsUpdate = true;
      }
      hlActive = [];
    }
    this.clearHighlight = clearHighlight;
    // 点中的星和同领域最重要的 8 颗一起变亮变大，拉出星座连线
    function highlight(index) {
      clearHighlight();
      var A = mem[index];
      var rel = relatedMemories(mem, index);
      host.dataset.constellationLinks = String(rel.length);
      var idxs = [index].concat(rel.map(function (o) { return o.i; }));
      var cA = memPoints.geometry.attributes.aColor, sA = memPoints.geometry.attributes.aSize;
      idxs.forEach(function (i, k) {
        for (var j = 0; j < 3; j++) cA.array[i * 3 + j] = Math.min(2.2, origColor[i * 3 + j] * 2.6);
        sA.array[i] = origSize[i] * (k === 0 ? 2.4 : 1.9) + 4;
      });
      cA.needsUpdate = true; sA.needsUpdate = true; hlActive = idxs;
      var lp = [];
      rel.forEach(function (o) { lp.push(A.x, A.y, A.z, o.m.x, o.m.y, o.m.z); });
      if (lp.length) {
        var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        hlLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({color:new THREE.Color(A.color), transparent:true, opacity:.55, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false}));
        hlLines.renderOrder = 1;
        scene.add(hlLines);
      }
    }

    // ── 点击（拖动不算）→ 高亮 + 卡片 ──
    var ray = new THREE.Raycaster(); ray.params.Points.threshold = .14;
    var ndc = new THREE.Vector2(), downXY = null;
    canvas.addEventListener('pointerdown', function (e) { downXY = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', function (e) {
      if (!downXY) return;
      var moved = Math.abs(e.clientX - downXY[0]) + Math.abs(e.clientY - downXY[1]);
      downXY = null;
      if (moved > 8 || !memPoints) return;
      var rect = canvas.getBoundingClientRect();
      ndc.x = (e.clientX - rect.left) / rect.width * 2 - 1;
      ndc.y = -(e.clientY - rect.top) / rect.height * 2 + 1;
      ray.setFromCamera(ndc, camera);
      var hit = ray.intersectObject(memPoints);
      if (hit.length) { highlight(hit[0].index); self.onPick(mem[hit[0].index]); }
    });

    // ── 流星 ──
    var meteors = [], meteorTimer = 2.5;
    function spawnMeteor() {
      var R = GAL_R * 1.5, TRAIL = 14;
      var start = new THREE.Vector3((Math.random() - .5) * R * 2, rand(1.5, 4.5), (Math.random() - .5) * R * 2);
      var vel = new THREE.Vector3(rand(-1, 1), -rand(.3, .7), rand(-1, 1)).normalize().multiplyScalar(rand(5, 8));
      var geo = new THREE.BufferGeometry(), pos = new Float32Array(TRAIL * 3), col = new Float32Array(TRAIL * 3);
      var tint = [[1, .92, 1], [1, .85, .95], [.9, .92, 1]][Math.floor(Math.random() * 3)];
      for (var i = 0; i < TRAIL; i++) { var a = Math.pow(1 - i / TRAIL, 1.5); col[i * 3] = tint[0] * a; col[i * 3 + 1] = tint[1] * a; col[i * 3 + 2] = tint[2] * a; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      var line = new THREE.Line(geo, new THREE.LineBasicMaterial({vertexColors:true, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false}));
      scene.add(line);
      meteors.push({line:line, vel:vel, life:0, ttl:rand(1.1, 1.8), trail:Array.from({length:TRAIL}, function () { return start.clone(); })});
    }
    function updateMeteors(dt) {
      for (var i = meteors.length - 1; i >= 0; i--) {
        var m = meteors[i]; m.life += dt;
        m.trail.unshift(m.trail[0].clone().addScaledVector(m.vel, dt)); m.trail.pop();
        var arr = m.line.geometry.attributes.position.array;
        m.trail.forEach(function (p, j) { arr[j * 3] = p.x; arr[j * 3 + 1] = p.y; arr[j * 3 + 2] = p.z; });
        m.line.geometry.attributes.position.needsUpdate = true;
        m.line.material.opacity = Math.min(1, m.life * 3) * Math.max(0, 1 - m.life / m.ttl);
        if (m.life >= m.ttl) { scene.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose(); meteors.splice(i, 1); }
      }
    }

    this.resize = function () {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    };

    // ── 主循环：页面不可见时自动停，回到本页再起 ──
    var clock = new THREE.Clock(), openT = 0, frame = null, lastDraw = 0, inView = true;
    function tick(now) {
      if (!host.isConnected || host.offsetParent === null || document.hidden || !inView) { frame = null; clock.stop(); return; }
      frame = requestAnimationFrame(tick);
      if (now - lastDraw < 1000 / 60 - 2) return;
      lastDraw = now;
      var dt = Math.min(clock.getDelta(), .1), et = clock.elapsedTime;
      self.galaxy.material.uniforms.uTime.value = et;
      self.dust.material.uniforms.uTime.value = et;
      if (memPoints) memPoints.material.uniforms.uTime.value = et;
      var p = 1 + .1 * Math.sin(et * .85);
      self.coreGlow.scale.setScalar(1.8 * p); self.coreGlow.material.opacity = .36 + .08 * Math.sin(et * .85);
      meteorTimer -= dt; if (meteorTimer <= 0) { spawnMeteor(); meteorTimer = rand(2.4, 6.5); }
      updateMeteors(dt);
      if (openT < 1) { openT = Math.min(1, openT + dt * .42); camera.position.z = 8.4 - 2.1 * (1 - Math.pow(1 - openT, 3)); }
      controls.update();
      composer.render();
    }
    // 银河滚出可视区也停
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView) self.start();
      }).observe(host);
    }
    this.start = function () {
      if (frame !== null || !inView || host.offsetParent === null) return;
      self.resize();
      clock.start();
      frame = requestAnimationFrame(tick);
    };
  }

  function mount() {
    var view = document.getElementById('network-view');
    if (!view || typeof window.loadNetwork !== 'function' || document.getElementById('ob-galaxy')) return;
    var legacyLoad = window.loadNetwork;
    var host = document.createElement('section');
    host.className = 'ob-galaxy';
    host.id = 'ob-galaxy';
    host.setAttribute('aria-label', '记忆星河');
    host.innerHTML =
      '<canvas class="ob-galaxy-gl"></canvas>' +
      '<header class="ob-galaxy-head"><h2></h2><p class="sub"></p><p class="zh"></p><p class="count"></p></header>' +
      '<div class="ob-galaxy-tools"><button type="button" id="ob-galaxy-picker" class="ob-galaxy-picker" aria-haspopup="listbox" aria-controls="ob-galaxy-menu" aria-expanded="false" disabled>寻找一颗记忆星…</button>' +
        '<div id="ob-galaxy-menu" class="ob-galaxy-menu" role="listbox" aria-label="寻找一颗记忆星" hidden></div></div>' +
      '<p class="ob-galaxy-loading">entering the galaxy…</p>' +
      '<p class="ob-galaxy-hint">drag to orbit · scroll to fly · tap a star</p>' +
      '<div class="ob-galaxy-card" aria-live="polite">' +
        '<div class="c-head"><svg class="c-star" viewBox="0 0 32 32" aria-hidden="true"></svg>' +
        '<div class="c-title"><div class="t"></div><div class="en"></div></div>' +
        '<button type="button" class="c-close" aria-label="收起">✕</button></div>' +
        '<div class="c-meta"><span class="c-date"></span><span class="c-tag"></span><span class="c-related"></span></div>' +
        '<div class="c-body"></div>' +
        '<div class="c-acts"><button type="button" class="c-open">展开这段记忆 <i>Open</i></button></div>' +
      '</div>';
    view.insertBefore(host, view.firstChild);
    view.classList.add('ob-galaxy-mode');
    host.querySelector('h2').textContent = CONFIG.title;
    host.querySelector('.sub').textContent = CONFIG.subtitle;
    host.querySelector('.zh').textContent = CONFIG.motto;

    var galaxy = null, current = null, loadingEl = host.querySelector('.ob-galaxy-loading'), card = host.querySelector('.ob-galaxy-card');
    var picker = host.querySelector('.ob-galaxy-picker'), menu = host.querySelector('.ob-galaxy-menu'), countEl = host.querySelector('.count');
    var pickedId = '', pickerStars = [];
    function closeMenu(restoreFocus) {
      menu.hidden = true;
      picker.setAttribute('aria-expanded', 'false');
      if (restoreFocus) picker.focus({preventScroll:true});
    }
    function syncPicker() {
      var selected = pickerStars.find(function (star) { return String(star.id) === pickedId; });
      picker.textContent = selected ? memoryLabel(selected) : '寻找一颗记忆星…';
      menu.querySelectorAll('[role=option]').forEach(function (option) {
        option.setAttribute('aria-selected', String(option.dataset.memoryId === pickedId));
      });
    }
    function closeCard() {
      card.classList.remove('show'); current = null; pickedId = ''; syncPicker();
      if (galaxy) galaxy.clearHighlight();
    }
    function memoryLabel(star) {
      return (star.name && String(star.name).trim()) || String(star.content || '').slice(0, 16) || '（无题）';
    }
    // 菜单按星河里的时间顺序列出每颗星；名称为空时取正文开头
    function fillPicker(stars) {
      var focused = menu.contains(document.activeElement);
      closeMenu(focused);
      pickerStars = stars;
      menu.replaceChildren();
      stars.forEach(function (s) {
        var option = document.createElement('button');
        option.type = 'button'; option.className = 'ob-galaxy-option'; option.setAttribute('role', 'option');
        option.dataset.memoryId = String(s.id); option.tabIndex = -1; option.textContent = memoryLabel(s);
        menu.appendChild(option);
      });
      picker.disabled = !stars.length;
      countEl.textContent = stars.length + ' 颗记忆星';
      if (!stars.some(function (s) { return String(s.id) === pickedId; })) pickedId = '';
      syncPicker();
    }
    function openMenu(last) {
      if (picker.disabled) return;
      menu.hidden = false;
      picker.setAttribute('aria-expanded', 'true');
      var options = Array.from(menu.querySelectorAll('[role=option]'));
      var option = last ? options[options.length - 1] : options.find(function (item) { return item.dataset.memoryId === pickedId; }) || options[0];
      if (option) { option.focus({preventScroll:true}); option.scrollIntoView({block:'nearest'}); }
    }
    picker.addEventListener('click', function () { if (menu.hidden) openMenu(false); else closeMenu(false); });
    picker.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); openMenu(event.key === 'ArrowUp');
      } else if (event.key === 'Escape') { event.preventDefault(); closeMenu(false); }
    });
    menu.addEventListener('click', function (event) {
      var option = event.target.closest('[role=option]');
      if (!option || !menu.contains(option)) return;
      var m = galaxy && galaxy.focus(option.dataset.memoryId);
      if (m) { openCard(m, m.isCore); closeMenu(true); }
    });
    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
      if (event.key === 'Tab') { closeMenu(false); return; }
      if (['ArrowDown','ArrowUp','Home','End'].indexOf(event.key) < 0) return;
      event.preventDefault();
      var options = Array.from(menu.querySelectorAll('[role=option]'));
      var index = options.indexOf(document.activeElement);
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      if (options[next]) { options[next].focus({preventScroll:true}); options[next].scrollIntoView({block:'nearest'}); }
    });
    document.addEventListener('pointerdown', function (event) {
      if (!host.querySelector('.ob-galaxy-tools').contains(event.target)) closeMenu(false);
    });
    var authCover = document.getElementById('auth-overlay');
    if (authCover) new MutationObserver(function () {
      if (authCover.style.display !== 'none') closeMenu(false);
    }).observe(authCover, {attributes:true,attributeFilter:['style']});
    new MutationObserver(function () {
      if (view.style.display === 'none') closeMenu(false);
    }).observe(view, {attributes:true,attributeFilter:['style']});
    host.querySelector('.c-close').addEventListener('click', closeCard);
    host.querySelector('.c-open').addEventListener('click', function () {
      if (current && typeof window.showDetail === 'function') window.showDetail(current.id);
    });
    function openCard(m, isCore) {
      var s = m.s; current = s; pickedId = String(s.id); syncPicker();
      card.querySelector('.t').textContent = (s.name && String(s.name).trim()) || String(s.content || '').slice(0, 16) || '（无题）';
      card.querySelector('.en').textContent = isCore ? CONFIG.coreEn : '';
      card.querySelector('.c-date').textContent = String(s.created || '').slice(0, 10).replace(/-/g, '.');
      card.querySelector('.c-tag').textContent = s.pinned ? '置顶记忆' : (s.importance >= 8 ? '重要记忆' : (s.domain || '记忆'));
      var relatedCount = Number(host.dataset.constellationLinks) || 0;
      card.querySelector('.c-related').textContent = relatedCount ? '已连接 ' + relatedCount + ' 颗同类记忆星' : '暂无同类记忆星';
      card.querySelector('.c-star').innerHTML = '<path d="M16 2l2.4 11.6L30 16l-11.6 2.4L16 30l-2.4-11.6L2 16l11.6-2.4z" fill="' + esc(m.color) + '" opacity=".9"/>';
      card.querySelector('.c-body').innerHTML = '<div>' + esc(s.content || '（这颗记忆还没有正文）') + '</div>';
      card.querySelector('.c-body').scrollTop = 0;
      card.classList.add('show');
      host.querySelector('.ob-galaxy-hint').style.opacity = 0;
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(function () { if (galaxy) galaxy.resize(); }).observe(host);

    // 只在本次进入时退回原网络；不替换 loadNetwork，下次打开本页仍会重试星河。
    function useLegacy(err) {
      console.warn('记忆星河加载失败，退回原记忆网络', err);
      view.classList.remove('ob-galaxy-mode');
      host.hidden = true;
      return legacyLoad();
    }

    var revision = 0;
    document.addEventListener('ob-session-changed', function () {
      revision += 1;
      closeCard();
      fillPicker([]);
      if (galaxy) galaxy.setStars([]);
    });
    window.loadNetwork = function () {
      var request = ++revision;
      host.hidden = false;
      view.classList.add('ob-galaxy-mode');
      loadingEl.textContent = 'entering the galaxy…';
      loadingEl.style.display = '';
      return Promise.all([loadEngine(), fetchStars()]).then(function (r) {
        if (request !== revision) return;
        if (!galaxy) {
          try {
            galaxy = new Galaxy(host, r[0]);
          } catch (err) {
            // 拿不到 WebGL 上下文（设备或浏览器关闭了硬件加速）
            galaxy = null;
            return useLegacy(err);
          }
          galaxy.onPick = function (m) { openCard(m, m.isCore); };
        }
        var reopen = pickedId;
        closeCard();
        galaxy.setStars(r[1]);
        fillPicker(galaxy.ids().map(function (id) { return r[1].find(function (s) { return s.id === id; }); }));
        if (reopen) { var again = galaxy.focus(reopen); if (again) openCard(again, again.isCore); }
        loadingEl.style.display = r[1].length ? 'none' : '';
        if (!r[1].length) loadingEl.textContent = '还没有回忆……';
        galaxy.start();
      }, function (err) {
        if (request !== revision) return;
        // 拿不到 3D 引擎就回到原网络；只是数据接口出错则留在银河里提示
        if (!galaxy && !enginePromise) return useLegacy(err);
        loadingEl.style.display = '';
        loadingEl.textContent = '还没有回忆……';
        console.error(err);
      });
    };
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && galaxy && host.offsetParent !== null) galaxy.start();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
