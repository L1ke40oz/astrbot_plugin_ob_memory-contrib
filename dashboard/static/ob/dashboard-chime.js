/* 主页星星导航：点「Ombre Brain」左边的星星，一串星星从它身上喷射出来，
   沿小弧线飞到各自位置；一颗星对应一个页面，彼此不相连。收起时再旋转着收回。
   原有 .tab 按钮保留在 DOM 里负责切页逻辑，这里只做表现层并转发点击。
   （类名沿用 ob-chime-*：内容让位、遮罩、标签等样式都挂在这些类上。） */
(function () {
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';
  var STORE = 'ob-chime-open';

  // 星形轮廓：64×64 画布，中心 (32,32)。圆角交给 stroke-linejoin。
  function star(points, outer, inner, rotate) {
    var d = '';
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 ? inner : outer;
      var a = (rotate || -90) * Math.PI / 180 + i * Math.PI / points;
      d += (i ? 'L' : 'M') + (32 + r * Math.cos(a)).toFixed(2) + ' ' + (32 + r * Math.sin(a)).toFixed(2);
    }
    return d + 'Z';
  }
  // 五角、六角、八角（像封蜡印）轮流用，大小也略有差别，避免一排整齐划一
  var SHAPES = [
    {d:star(5, 30, 15.5), scale:1},
    {d:star(6, 29, 18.5), scale:.94},
    {d:star(8, 28, 21.5, -90 + 22.5), scale:.9},
    {d:star(5, 30, 15.5, -90 + 36), scale:.97}
  ];
  var GLINT = 'M0 -7C.6 -2 2 -.6 7 0 2 .6.6 2 0 7-.6 2-2 .6-7 0-2-.6-.6-2 0-7Z';
  var ICONS = {
    list: '<path d="M7 3.5h10V6H7zM8 6v2.5C6.5 9.5 6 11 6 13v5.5A2.5 2.5 0 0 0 8.5 21h7a2.5 2.5 0 0 0 2.5-2.5V13c0-2-.5-3.5-2-4.5V6"/><path d="M12 17.6c-1.8-1.2-2.8-2.2-2.8-3.4a1.4 1.4 0 0 1 2.8-.4 1.4 1.4 0 0 1 2.8.4c0 1.2-1 2.2-2.8 3.4z" class="ob-star-fill"/>',
    breath: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 17h6"/>',
    network: '<path d="M5 6l7 5 5-7M12 11l7 4M12 11l-3 8 10-4"/><circle cx="5" cy="6" r="1.6" class="ob-star-fill"/><circle cx="17" cy="4" r="1.3" class="ob-star-fill"/><circle cx="19" cy="15" r="1.6" class="ob-star-fill"/><circle cx="9" cy="19" r="1.3" class="ob-star-fill"/><circle cx="12" cy="11" r="2"/>',
    plan: '<path d="M5 5h14v16H5zM8 3v4M12 3v4M16 3v4M8 11h8M8 14.5h8M8 18h5"/>',
    letters: '<path d="M3 6h18v13H3zM3 6.5l9 7 9-7"/><circle cx="12" cy="15.6" r="2.1" class="ob-star-fill"/>',
    anchors: '<circle cx="12" cy="4.6" r="2.2"/><path d="M12 7v14M7.5 11h9M5 15c0 3.5 3 6 7 6s7-2.5 7-6"/>',
    'import': '<path d="M4 11l1.5 9h13L20 11M2.5 11h19M12 2v9.5M8.5 8L12 11.5 15.5 8"/>',
    logs: '<path d="M19 3C13 4 8.5 9 6.5 16.5L5 21M19 3c-1 5-4 9-9.5 11M9.6 10.4l3.2.5M7.9 13.9l3 .3"/>',
    self: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c.8-4 3.6-6.2 7-6.2s6.2 2.2 7 6.2"/>',
    settings: '<circle cx="8" cy="8" r="4.2"/><circle cx="8" cy="8" r="1.4" class="ob-star-fill"/><path d="M11 11l9 9M15.8 15.8l2.2-2.2M18.4 18.4l2.2-2.2"/>'
  };

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG, name);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (parent) parent.appendChild(node);
    return node;
  }

  function starSvg(key, index) {
    var shape = SHAPES[index % SHAPES.length];
    var svg = el('svg', {viewBox:'0 0 64 64', 'aria-hidden':'true', focusable:'false', 'class':'ob-star'});
    var g = el('g', {transform:'translate(32 32) scale(' + shape.scale + ') translate(-32 -32)'}, svg);
    el('path', {d:shape.d, 'class':'ob-star-body'}, g);
    el('path', {d:shape.d, 'class':'ob-star-stitch', transform:'translate(32 32) scale(.78) translate(-32 -32)'}, g);
    var icon = el('g', {'class':'ob-star-icon', transform:'translate(22 22) scale(.84)'}, svg);
    icon.innerHTML = ICONS[key] || '<circle cx="12" cy="12" r="4"/>';
    // 每颗星旁边一点小闪光，位置轮流换
    var spots = [[53, 11], [11, 15], [54, 50], [9, 48]];
    var spot = spots[index % spots.length];
    el('path', {d:GLINT, 'class':'ob-star-glint', transform:'translate(' + spot[0] + ' ' + spot[1] + ') scale(.8)'}, svg);
    return svg;
  }

  function toggleSvg() {
    var svg = el('svg', {viewBox:'0 0 64 64', 'aria-hidden':'true', focusable:'false', 'class':'ob-star ob-star-hook'});
    el('circle', {cx:32, cy:32, r:30, 'class':'ob-star-halo'}, svg);
    el('path', {d:star(5, 25, 12), 'class':'ob-star-body'}, svg);
    el('path', {d:star(5, 25, 12), 'class':'ob-star-stitch', transform:'translate(32 32) scale(.74) translate(-32 -32)'}, svg);
    el('circle', {cx:32, cy:33, r:3, 'class':'ob-star-core'}, svg);
    el('path', {d:GLINT, 'class':'ob-star-glint', transform:'translate(53 12)'}, svg);
    el('path', {d:GLINT, 'class':'ob-star-glint ob-star-glint-b', transform:'translate(12 52) scale(.6)'}, svg);
    return svg;
  }

  function mount() {
    var nav = document.querySelector('nav.tabs');
    if (!nav || document.querySelector('.ob-chime')) return;
    var tabs = Array.from(nav.querySelectorAll('.tab[data-tab]'));
    if (!tabs.length) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var narrow = window.matchMedia('(max-width: 1100px)');
    document.body.classList.add('ob-journal');

    // 「Ombre Brain」左边换成一颗星星按钮；原品牌图标仍留在 DOM（其它脚本会更新它），只是隐藏。
    var header = document.querySelector('.header');
    var brand = header && header.querySelector('h1 .ob-logo');
    if (!header || !brand) return;
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ob-chime-hook';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'ob-chime-list');
    toggle.setAttribute('aria-label', '页面导航');
    toggle.title = '放出星星';
    var logo = toggleSvg();
    toggle.appendChild(logo);
    brand.parentNode.insertBefore(toggle, brand);
    brand.classList.add('ob-chime-brand-hidden');

    var root = document.createElement('nav');
    root.className = 'ob-chime';
    root.id = 'ob-chime';
    root.setAttribute('aria-label', '页面导航');
    var scrim = document.createElement('div');
    scrim.className = 'ob-chime-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    var list = document.createElement('ul');
    list.className = 'ob-chime-list';
    list.id = 'ob-chime-list';
    list.hidden = true;

    // Breath 模拟没什么使用场景，它的位置换成原来左下角的「我」面板入口。
    var pluginView = location.pathname === '/ob' || location.pathname === '/ob/';
    var entries = tabs.filter(function (tab) { return pluginView ? ['list','network','plan','letters','settings'].includes(tab.dataset.tab) : tab.dataset.tab !== 'breath'; }).map(function (tab) {
      var spans = tab.querySelectorAll('span');
      return {key:tab.dataset.tab, tab:tab,
        zh:spans[0] ? spans[0].textContent.trim() : tab.dataset.tab,
        en:tab.querySelector('.tab-en') ? tab.querySelector('.tab-en').textContent.trim() : ''};
    });
    if (!pluginView && typeof window.openSelfPanel === 'function') {
      entries.splice(1, 0, {key:'self', zh:'我', en:'Me · You · Them', action:function () { window.openSelfPanel(); }});
    }

    var items = entries.map(function (entry, index) {
      var li = document.createElement('li');
      li.className = 'ob-chime-item';
      li.style.setProperty('--i', index);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ob-chime-tag';
      button.dataset.chimeTab = entry.key;
      button.setAttribute('aria-label', entry.zh + (entry.en ? ' ' + entry.en : ''));
      var float = document.createElement('span');
      float.className = 'ob-chime-swing';
      var svg = starSvg(entry.key, index);
      float.appendChild(svg);
      button.appendChild(float);
      var label = document.createElement('span');
      label.className = 'ob-chime-label';
      label.setAttribute('aria-hidden', 'true');
      label.innerHTML = '<b></b><i></i>';
      label.firstChild.textContent = entry.zh;
      label.lastChild.textContent = entry.en;
      button.appendChild(label);
      button.addEventListener('click', function () {
        twirl(svg);
        if (entry.action) entry.action();
        else if (!entry.tab.classList.contains('active')) entry.tab.click();
        if (narrow.matches) setOpen(false, true);
      });
      li.appendChild(button);
      list.appendChild(li);
      return {li:li, button:button, svg:svg, tab:entry.tab};
    });
    root.appendChild(list);
    var defs = el('svg', {width:0, height:0, 'aria-hidden':'true', style:'position:absolute'});
    // 渐变色用 CSS 变量着色，跟随色系与明暗
    defs.innerHTML = '<defs><linearGradient id="ob-star-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ob-star-stop-a"/><stop offset="1" class="ob-star-stop-b"/></linearGradient>'
      + '<linearGradient id="ob-star-active" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ob-star-stop-c"/><stop offset="1" class="ob-star-stop-d"/></linearGradient></defs>';
    root.appendChild(defs);
    header.appendChild(root);
    document.body.appendChild(scrim);

    // 头部在桌面端是 sticky，星星挂在头部里随它固定；位置对齐按钮正下方。
    function place() {
      var h = header.getBoundingClientRect(), l = logo.getBoundingClientRect();
      root.style.left = (l.left - h.left + l.width / 2 - root.offsetWidth / 2) + 'px';
      root.style.top = (l.bottom - h.top + 16) + 'px';
    }
    window.addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();

    function syncActive() {
      items.forEach(function (item) {
        var on = !!item.tab && item.tab.classList.contains('active');
        item.li.classList.toggle('is-active', on);
        if (on) item.button.setAttribute('aria-current', 'page');
        else item.button.removeAttribute('aria-current');
      });
    }
    new MutationObserver(syncActive).observe(nav, {subtree:true, attributes:true, attributeFilter:['class']});
    syncActive();

    function twirl(node) {
      if (reduced.matches || typeof node.animate !== 'function') return;
      node.animate([{transform:'rotate(0) scale(1)'}, {transform:'rotate(216deg) scale(1.15)', offset:.55}, {transform:'rotate(360deg) scale(1)'}],
        {duration:560, easing:'cubic-bezier(.3,.7,.3,1)'});
    }

    // 从按钮中心喷出一把小火花
    function sparks(cx, cy) {
      var layer = document.createElement('div');
      layer.className = 'ob-star-sparks';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
      var done = [];
      for (var i = 0; i < 16; i++) {
        var s = document.createElement('span');
        s.className = 'ob-star-spark' + (i % 3 === 0 ? ' is-star' : '');
        s.style.left = cx + 'px';
        s.style.top = cy + 'px';
        layer.appendChild(s);
        // 主要往下、往右喷（星星飞去的方向），带一点随机
        var angle = (-35 + Math.random() * 160) * Math.PI / 180;
        var dist = 40 + Math.random() * 110;
        var dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
        done.push(s.animate([
          {transform:'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity:1},
          {transform:'translate(calc(-50% + ' + dx * .7 + 'px),calc(-50% + ' + dy * .7 + 'px)) scale(1) rotate(90deg)', opacity:1, offset:.55},
          {transform:'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + (dy + 14) + 'px)) scale(.2) rotate(180deg)', opacity:0}
        ], {duration:520 + Math.random() * 380, delay:Math.random() * 90, easing:'cubic-bezier(.2,.7,.3,1)', fill:'backwards'}).finished);
      }
      Promise.all(done).catch(function () {}).then(function () { layer.remove(); });
    }

    var open = false;
    var running = [];
    function stopRunning() { running.forEach(function (a) { a.cancel(); }); running = []; }
    function origin() {
      var r = logo.getBoundingClientRect();
      return {x:r.left + r.width / 2, y:r.top + r.height / 2};
    }

    function setOpen(next, animate) {
      if (next === open) return;
      open = next;
      try { localStorage.setItem(STORE, open ? '1' : '0'); } catch (_) {}
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? '收回星星' : '放出星星';
      root.classList.toggle('is-open', open);
      document.body.classList.toggle('ob-chime-open', open);
      if (open) place();
      stopRunning();
      var motion = animate && !reduced.matches && typeof list.animate === 'function';
      if (open) {
        list.hidden = false;
        if (!motion) return;
        var o = origin();
        sparks(o.x, o.y);
        items.forEach(function (item, i) {
          var r = item.li.getBoundingClientRect();
          var dx = o.x - (r.left + r.width / 2), dy = o.y - (r.top + r.height / 2);
          // 喷射：从按钮出发，先往右甩出一道弧线，再旋转着落位，最后轻轻回弹
          var bow = 26 + i * 6;
          running.push(item.li.animate([
            {opacity:0, transform:'translate(' + dx + 'px,' + dy + 'px) scale(.15) rotate(-220deg)'},
            {opacity:1, transform:'translate(' + (dx * .45 + bow) + 'px,' + (dy * .45) + 'px) scale(.8) rotate(-90deg)', offset:.38},
            {transform:'translate(0,0) scale(1.14) rotate(14deg)', offset:.72},
            {transform:'translate(0,0) scale(.96) rotate(-5deg)', offset:.87},
            {opacity:1, transform:'translate(0,0) scale(1) rotate(0deg)'}
          ], {duration:640 + i * 18, delay:i * 42, easing:'cubic-bezier(.22,.8,.3,1)', fill:'backwards'}));
        });
      } else {
        if (!motion) { list.hidden = true; return; }
        var p = origin();
        var last = null;
        items.forEach(function (item, i) {
          var r = item.li.getBoundingClientRect();
          var dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2);
          last = item.li.animate([
            {opacity:1, transform:'translate(0,0) scale(1) rotate(0deg)'},
            {opacity:0, transform:'translate(' + dx + 'px,' + dy + 'px) scale(.2) rotate(200deg)'}
          ], {duration:300, delay:(items.length - 1 - i) * 24, easing:'cubic-bezier(.55,0,.8,.4)', fill:'forwards'});
          running.push(last);
        });
        last.finished.then(function () {
          if (open) return;
          list.hidden = true;
          stopRunning();
        }).catch(function () {});
      }
    }

    toggle.addEventListener('click', function () {
      setOpen(!open, true);
      twirl(logo);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && open && (root.contains(document.activeElement) || document.activeElement === toggle)) {
        setOpen(false, true);
        toggle.focus();
      }
    });
    document.addEventListener('click', function (event) {
      if (open && narrow.matches && !root.contains(event.target) && !toggle.contains(event.target)) setOpen(false, true);
    });

    var remembered = null;
    try { remembered = localStorage.getItem(STORE); } catch (_) {}
    if (remembered !== '0' && !narrow.matches) {
      // 记住上次展开：等登录封面揭开后再放出星星，让喷射动画被看见。
      var cover = document.getElementById('auth-overlay');
      var drop = function () { setTimeout(function () { setOpen(true, true); }, 260); };
      if (cover && cover.style.display !== 'none') {
        var watch = new MutationObserver(function () {
          if (cover.style.display === 'none') { watch.disconnect(); drop(); }
        });
        watch.observe(cover, {attributes:true, attributeFilter:['style']});
      } else drop();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
