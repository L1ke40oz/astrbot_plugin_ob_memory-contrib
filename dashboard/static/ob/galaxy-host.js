/* The parent owns authentication and session resolution; no sample data or exports. */
(function () {
  'use strict';
  const picker = document.getElementById('galaxy-picker');
  const status = document.getElementById('galaxy-status');
  const letter = document.getElementById('galaxy-letter');
  const motion = document.getElementById('galaxy-motion');
  const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
  const host = window.galaxyHost = {
    stars:null,
    active:true,
    paused:reducedMotion.matches,
    selected:null,
    error:null,
    fail(message) { host.error = message; status.textContent = message; },
    read(id) {
      const star = (host.stars || []).find(item => item.id === id);
      if (!star) return;
      host.selected = id;
      picker.value = id;
      document.getElementById('galaxy-title').textContent = star.name || '一颗记忆星';
      const day = star.created ? new Date(star.created).toLocaleDateString('zh-CN') : '日期未知';
      const tags = [...(star.domain || []), ...(star.tags || []).map(tag => '#' + tag)];
      if (star.pinned) tags.unshift('钉选');
      if (star.type === 'feel') tags.unshift('Feel');
      document.getElementById('galaxy-meta').textContent = [day,...tags].join(' · ');
      document.getElementById('galaxy-body').textContent = star.content || '这颗记忆还没有正文。';
      document.getElementById('galaxy-body').scrollTop = 0;
      letter.hidden = false;
      document.dispatchEvent(new CustomEvent('galaxy-select', {detail:id}));
    }
  };
  motion.setAttribute('aria-pressed', String(host.paused));
  motion.textContent = host.paused ? '让星河流动' : '暂停星河';
  reducedMotion.addEventListener('change', event => {
    host.paused = event.matches;
    motion.setAttribute('aria-pressed', String(host.paused));
    motion.textContent = host.paused ? '让星河流动' : '暂停星河';
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === 'ob-galaxy-active') {
      host.active = !!event.data.active;
      document.dispatchEvent(new Event('galaxy-activity'));
    }
    if (event.data?.type !== 'ob-galaxy-data' || !Array.isArray(event.data.stars)) return;
    host.stars = event.data.stars;
    const selected = host.selected;
    picker.replaceChildren(new Option('寻找一颗记忆星…', ''));
    host.stars.forEach(star => picker.append(new Option(star.name || '未命名记忆', star.id)));
    document.getElementById('galaxy-count').textContent = host.stars.length + ' 颗记忆星';
    status.textContent = host.error || (host.stars.length ? '' : '还没有记忆星。和 TA 留下第一段记忆，星河就会慢慢生长。');
    document.dispatchEvent(new Event('galaxy-data'));
    if (host.stars.some(star => star.id === selected)) host.read(selected);
    else { host.selected = null; letter.hidden = true; }
  });
  picker.addEventListener('change', () => {
    if (picker.value) host.read(picker.value);
    else document.getElementById('galaxy-close').click();
  });
  document.getElementById('galaxy-close').addEventListener('click', () => {
    letter.hidden = true;
    host.selected = null;
    picker.value = '';
    document.dispatchEvent(new Event('galaxy-clear'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !letter.hidden) document.getElementById('galaxy-close').click();
  });
  document.getElementById('galaxy-edit').addEventListener('click', () => {
    if (host.selected) parent.postMessage({type:'ob-galaxy-edit', id:host.selected}, location.origin);
  });
  motion.addEventListener('click', () => {
    host.paused = !host.paused;
    motion.textContent = host.paused ? '让星河流动' : '暂停星河';
    motion.setAttribute('aria-pressed', String(host.paused));
  });
  document.getElementById('galaxy-fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { host.fail('浏览器未开启全屏，仍可在这里探索星河。'); }
  });
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('galaxy-fullscreen').textContent = document.fullscreenElement ? '退出沉浸' : '沉浸查看';
  });
  parent.postMessage({type:'ob-galaxy-ready'}, location.origin);
  import('/ob/static/galaxy.js').catch(error => {
    console.error('Galaxy renderer unavailable:', error);
    host.fail('当前浏览器无法显示 3D 星河，仍可用上方菜单阅读记忆。');
  });
})();
