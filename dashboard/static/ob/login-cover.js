/* 封面只负责表现与表单状态；密码校验、Cookie 和接口仍由原有鉴权函数处理。 */
(function () {
  'use strict';
  function mount() {
    var cover = document.getElementById('auth-overlay');
    if (!cover || !cover.classList.contains('ob-cover')) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var wasVisible = false;
    var lastForm = '';
    var pending = false;
    var savedOverflow = '';
    var focusBeforeCover = null;
    var backgroundNodes = [];
    var pendantSwayed = false;
    var openingPromise = null;
    var submitOrigin = null;

    function buttonOrigin(button) {
      var rect = button ? button.getBoundingClientRect() : null;
      return rect && rect.width ? {x:rect.left + rect.width / 2,y:rect.top + rect.height / 2,width:rect.width}
        : {x:window.innerWidth / 2,y:window.innerHeight * .7,width:300};
    }

    function pressRipple(button) {
      submitOrigin = buttonOrigin(button);
      if (reduced.matches || typeof cover.animate !== 'function') return;
      var ripple = document.createElement('div');
      ripple.className = 'ob-cover-press-ripple';
      ripple.setAttribute('aria-hidden','true');
      ripple.style.left = submitOrigin.x + 'px';
      ripple.style.top = submitOrigin.y + 'px';
      var size = Math.max(150,submitOrigin.width * 1.12);
      ripple.style.width = ripple.style.height = size + 'px';
      document.body.appendChild(ripple);
      var animation = ripple.animate([
        {opacity:0,transform:'translate(-50%,-50%) scale(.35)'},
        {opacity:.8,transform:'translate(-50%,-50%) scale(.62)',offset:.22},
        {opacity:0,transform:'translate(-50%,-50%) scale(1.5)'}
      ], {duration:520,easing:'cubic-bezier(.16,.65,.3,1)'});
      animation.finished.catch(function () {}).then(function () { ripple.remove(); });
    }

    // 只由会话验证成功后的钩子调用；径向遮罩挖开真实面板，不复制含密码的 DOM。
    window.ombreRevealDashboard = function (dashboardReady, isCurrent) {
      if (openingPromise) return openingPromise;
      var origin = submitOrigin || buttonOrigin(cover.querySelector('form:not([style*="none"]) button[type=submit]'));
      openingPromise = (async function () {
        var light = null;
        var timeout = null;
        var frame = null;
        function current() { return typeof isCurrent !== 'function' || isCurrent(); }
        function hideCover() {
          cover.style.display = 'none';
          sync();
          var target = document.querySelector('main') || document.querySelector('.main');
          if (target && !document.querySelector('[role=dialog]:not([style*="none"]):not(#auth-overlay)')) {
            var hadTabIndex = target.hasAttribute('tabindex');
            if (!hadTabIndex) target.setAttribute('tabindex','-1');
            target.focus({preventScroll:true});
            if (!hadTabIndex) target.addEventListener('blur',function () { target.removeAttribute('tabindex'); },{once:true});
          }
        }
        try {
          // 面板先在封面后初始化，网络较慢时仍允许进入原有加载状态。
          await Promise.race([
            Promise.resolve(dashboardReady).catch(function () {}),
            new Promise(function (resolve) { timeout = setTimeout(resolve,400); })
          ]);
          clearTimeout(timeout);
          if (!current()) return false;
          // 等面板首帧画完再起水波，避免首帧渲染挤占动画开头。
          await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
          if (!current()) return false;
          if (reduced.matches || !window.CSS || !CSS.supports('mask-image','radial-gradient(black,transparent)')) {
            hideCover();
            return true;
          }
          // 光晕是羽化 100px 以上的柔和渐变，没有细节可丢：画在半分辨率画布上再由合成器放大，
          // 观感不变，但手机上每帧不再以设备像素重绘 4 层全屏渐变。
          var SCALE = .5;
          var width = window.innerWidth, height = window.innerHeight;
          var x = Math.max(0,Math.min(width,origin.x));
          var y = Math.max(0,Math.min(height,origin.y));
          var reach = Math.hypot(Math.max(x,width - x),Math.max(y,height - y));
          var feather = reach * .34;
          var center = x + 'px ' + y + 'px';
          light = document.createElement('canvas');
          light.className = 'ob-cover-waterlight';
          light.setAttribute('aria-hidden','true');
          light.width = Math.max(1,Math.ceil(width * SCALE));
          light.height = Math.max(1,Math.ceil(height * SCALE));
          var paint = light.getContext('2d');
          if (!paint) throw new Error('canvas unavailable');
          document.body.appendChild(light);
          cover.classList.add('ob-cover-opening');
          // 光晕扩散：极快起步的超宽羽化光圈，前沿带几团错位光斑像云雾翻涌，
          // 已扫过的区域先过曝成白再迅速褪开，露出面板。整段约 0.68 秒。
          var lobes = [0,1,2].map(function (i) {
            var angle = Math.random() * Math.PI * 2 + i * 2.1;
            return {dx:Math.cos(angle),dy:Math.sin(angle),scale:.82 + Math.random() * .12};
          });
          var completed = await new Promise(function (resolve) {
            var started = null;
            function tick(now) {
              if (!current()) { resolve(false); return; }
              if (started === null) started = now;
              var progress = Math.min(1,(now - started) / 680);
              var grow = 1 - Math.pow(1 - progress,3.4);
              var radius = (reach + feather) * 1.06 * grow;
              var mask = 'radial-gradient(circle at ' + center + ',transparent ' + (radius - feather) + 'px,#000 ' + radius + 'px)';
              cover.style.maskImage = mask;
              cover.style.webkitMaskImage = mask;
              var wash = .8 * Math.pow(1 - progress,2.6);
              var drift = feather * .38 * grow;
              paint.setTransform(SCALE,0,0,SCALE,0,0);
              paint.clearRect(0,0,width,height);
              // 与原 CSS 叠层顺序一致：主光圈在最下，三团错位光斑依次叠在上面。
              band(paint,x,y,radius,.97,wash,feather,width,height);
              for (var i = lobes.length - 1; i >= 0; i--) {
                band(paint,x + lobes[i].dx * drift,y + lobes[i].dy * drift,radius * lobes[i].scale,.55,wash,feather,width,height);
              }
              light.style.opacity = String(Math.min(1,progress / .06) * (1 - Math.max(0,(progress - .4) / .6)));
              if (progress < 1) frame = requestAnimationFrame(tick);
              else resolve(true);
            }
            frame = requestAnimationFrame(tick);
          });
          if (!completed || !current()) return false;
          hideCover();
          return true;
        } catch (_) {
          // 表现层异常不能阻断已建立的会话，也不能覆盖真实鉴权错误。
          if (!current()) return false;
          hideCover();
          return true;
        } finally {
          clearTimeout(timeout);
          if (frame !== null) cancelAnimationFrame(frame);
          cover.classList.remove('ob-cover-opening');
          cover.style.removeProperty('mask-image');
          cover.style.removeProperty('-webkit-mask-image');
          if (light) light.remove();
          submitOrigin = null;
        }
      })();
      openingPromise.then(function () { openingPromise = null; },function () { openingPromise = null; });
      return openingPromise;
    };

    // 按 CSS radial-gradient 的色标规则（首个位置不小于 0，之后单调不减）画一圈柔光。
    function band(context, cx, cy, r, peak, wash, feather, width, height) {
      var stops = [
        [Math.max(0,r - feather * 1.1),[255,255,255,wash]],
        [r - feather * .38,[255,255,255,peak]],
        [r,[236,239,255,peak * .5]],
        [r + feather * .45,[236,239,255,0]]
      ];
      for (var i = 1; i < stops.length; i++) stops[i][0] = Math.max(stops[i][0],stops[i - 1][0]);
      var outer = stops[stops.length - 1][0];
      if (outer <= 0) return;
      var gradient = context.createRadialGradient(cx,cy,0,cx,cy,outer);
      function rgba(c) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0,Math.min(1,c[3])) + ')'; }
      stops.forEach(function (stop) { gradient.addColorStop(stop[0] / outer,rgba(stop[1])); });
      context.fillStyle = gradient;
      context.fillRect(0,0,width,height);
    }

    function play(element, frames, delay, duration) {
      if (!element || reduced.matches || typeof element.animate !== 'function') return;
      var animation = element.animate(frames, {
        duration: duration || 850, delay: delay || 0,
        easing: 'cubic-bezier(.18,.75,.2,1)', fill: 'backwards'
      });
      animation.finished.catch(function () {});
    }

    function enterPiece(selector, x, y, delay, duration) {
      var element = cover.querySelector(selector);
      if (!element) return;
      var base = getComputedStyle(element).transform;
      play(element, [
        {opacity:0,transform:(base === 'none' ? '' : base) + ' translate(' + x + 'px,' + y + 'px)'},
        {opacity:1,transform:base}
      ], delay, duration);
    }

    function enter() {
      var collage = cover.querySelector('.ob-cover-collage');
      var base = getComputedStyle(collage).transform;
      play(collage, [
        { opacity: 0, transform: (base === 'none' ? '' : base) + ' translateY(22px)' },
        { opacity: 1, transform: base }
      ], 0, 1000);
      play(cover.querySelector('.ob-cover-photo'), [
        { opacity: 0, transform: 'translate(-12px,12px) rotate(-14deg)' },
        { opacity: 1, transform: 'rotate(-9deg)' }
      ], 80, 1050);
      play(cover.querySelector('.ob-cover-paper'), [
        { opacity: 0, transform: 'translateY(18px) rotate(0deg)' },
        { opacity: 1, transform: 'rotate(-3deg)' }
      ], 140, 900);
      // 分别动画照片各层，避免给整叠建立层叠上下文，让信封仍能压住照片。
      enterPiece('.ob-polaroid-back-one', 15, 13, 100, 1000);
      enterPiece('.ob-polaroid-back-two', 13, 15, 130, 1000);
      enterPiece('.ob-polaroid-front', 12, 16, 160, 1000);
      enterPiece('.ob-photo-clip', 12, 16, 160, 1000);
      play(cover.querySelector('.ob-flower-pendant'), [{opacity:0},{opacity:1}], 180, 800);
      enterPiece('.ob-cover-stamp', 0, 9, 230, 850);
      enterPiece('.ob-cover-ticket', 16, 10, 280, 900);
      enterPiece('.ob-cover-sticker-winter', 0, 10, 210, 900);
      enterPiece('.ob-cover-sticker-sleep', 10, 12, 260, 950);
      enterPiece('.ob-cover-sticker-birdcage', -10, 12, 240, 950);
      play(cover.querySelector('.ob-cover-controls'), [{opacity:0},{opacity:1}], 300, 750);
      var pendant = cover.querySelector('.ob-flower-pendant');
      if (!pendantSwayed && pendant && !reduced.matches && typeof pendant.animate === 'function') {
        pendantSwayed = true;
        var sway = pendant.animate([
          {transform:'rotate(-9deg)',offset:0,easing:'ease-in-out'},
          {transform:'rotate(7deg)',offset:.23,easing:'ease-in-out'},
          {transform:'rotate(-5deg)',offset:.46,easing:'ease-in-out'},
          {transform:'rotate(3deg)',offset:.68,easing:'ease-in-out'},
          {transform:'rotate(-1deg)',offset:.86,easing:'ease-in-out'},
          {transform:'rotate(0deg)',offset:1}
        ], {duration:2500,delay:550,easing:'linear',fill:'backwards',iterations:1});
        sway.finished.catch(function () {});
      }
    }

    function lockBackground(visible) {
      if (visible) {
        focusBeforeCover = document.activeElement;
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        backgroundNodes = Array.from(document.body.children).filter(function (node) {
          return node !== cover && !['SCRIPT','STYLE','LINK'].includes(node.tagName);
        }).map(function (node) { var item = {node:node,inert:node.inert}; node.inert = true; return item; });
        cover.focus({preventScroll:true});
      } else {
        document.body.style.overflow = savedOverflow;
        backgroundNodes.forEach(function (item) { item.node.inert = item.inert; });
        backgroundNodes = [];
        if (cover.contains(document.activeElement)) document.activeElement.blur();
        if (focusBeforeCover && focusBeforeCover.isConnected && !cover.contains(focusBeforeCover)) focusBeforeCover.focus({preventScroll:true});
        cover.querySelectorAll('input[autocomplete=current-password],input[autocomplete=new-password]').forEach(function (input) { input.value = ''; input.type = 'password'; });
        cover.querySelectorAll('[data-password-toggle]').forEach(function (button) { button.setAttribute('aria-pressed','false'); button.setAttribute('aria-label','显示密码'); });
      }
    }

    function sync() {
      var visible = cover.style.display !== 'none';
      if (visible !== wasVisible) {
        lockBackground(visible);
        if (visible) enter();
        wasVisible = visible;
      }
      if (!visible) { lastForm = ''; return; }
      var form = Array.from(cover.querySelectorAll('form[data-auth-action]')).find(function (element) {
        return element.style.display !== 'none';
      });
      if (form && form.id !== lastForm) {
        lastForm = form.id;
        play(form, [{opacity:.1,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}], 0, 420);
      }
    }

    async function perform(action, button) {
      if (pending || typeof window[action] !== 'function') return;
      pending = true;
      cover.setAttribute('aria-busy','true');
      var original = button ? button.querySelector('[data-submit-label]') : null;
      var label = original ? original.textContent : '';
      if (button) button.disabled = true;
      if (original) original.textContent = '正在打开…';
      pressRipple(button);
      document.getElementById('auth-error').style.display = 'none';
      try {
        await window[action]();
      } catch (_) {
        if (typeof window.showAuthError === 'function') window.showAuthError('暂时无法连接，请稍后重试。');
      } finally {
        pending = false;
        cover.setAttribute('aria-busy','false');
        if (button) button.disabled = false;
        if (original) original.textContent = label;
      }
    }

    cover.querySelectorAll('form[data-auth-action]').forEach(function (form) {
      form.addEventListener('submit',function (event) {
        event.preventDefault();
        perform(form.dataset.authAction,form.querySelector('button[type=submit]'));
      });
    });
    cover.querySelectorAll('[data-cover-action]').forEach(function (button) {
      button.addEventListener('click',function () { perform(button.dataset.coverAction,button); });
    });
    cover.querySelectorAll('[data-password-toggle]').forEach(function (button) {
      button.addEventListener('click',function () {
        var input = document.getElementById(button.dataset.passwordToggle);
        var reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.setAttribute('aria-pressed',String(reveal));
        button.setAttribute('aria-label',reveal ? '隐藏密码' : '显示密码');
      });
    });
    cover.addEventListener('keydown',function (event) {
      if (event.key !== 'Tab') return;
      var controls = Array.from(cover.querySelectorAll('input:not(:disabled),button:not(:disabled),summary,a[href]')).filter(function (element) {
        return element.getClientRects().length > 0;
      });
      var first = controls[0];
      var last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cover)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    var observer = new MutationObserver(sync);
    observer.observe(cover,{attributes:true,attributeFilter:['style'],subtree:true});
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
