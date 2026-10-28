/* Compact memory filtering and the session-scoped galaxy bridge. */
(function () {
  'use strict';
  window.installObExplorer = function () {
    const toolbar = document.querySelector('#list-view .bucket-viewbar');
    toolbar.replaceChildren();
    document.getElementById('filters').remove();
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.id = 'ob-filter-toggle';
    toggle.textContent = '筛选与排序 ▾';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'ob-filter-panel');
    toolbar.append(toggle);
    const panel = document.createElement('section');
    panel.id = 'ob-filter-panel'; panel.hidden = true;
    panel.setAttribute('aria-label', '记忆筛选与排序');
    toolbar.after(panel);
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      toggle.textContent = panel.hidden ? '筛选与排序 ▾' : '筛选与排序 ▴';
    });
    const search = document.querySelector('.header .search-bar');
    search.classList.add('ob-memory-search');
    toolbar.append(search);
    search.querySelector('button').innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
    search.querySelector('button').setAttribute('aria-label', '搜索记忆');
    document.getElementById('search-input').placeholder = '搜索记忆…';
    bucketSort = 'score';
    currentFilter = 'active';
    const filters = {sort:'newest', time:'', importance:0, domain:'', tag:''};
    const states = [
      ['all', '全部记忆', () => true],
      ['pinned', '钉选 / 核心准则', b => b.pinned],
      ['feel', 'Feel / 感受', b => b.type === 'feel'],
      ['active', '活跃中', b => !b.resolved && !b.pinned && !b.digested && !['feel', 'archived'].includes(b.type)],
      ['unresolved', '未解决', b => !b.resolved && !b.pinned && !['permanent', 'archived'].includes(b.type)],
      ['resolved', '已沉底', b => (b.resolved || b.type === 'archived') && b.type !== 'feel'],
      ['digested', '已消化 / 隐藏', b => b.digested],
      ['archived', '归档', b => b.type === 'archived']
    ];
    window.filterBuckets = function (rows) {
      const state = states.find(item => item[0] === currentFilter);
      const times = new Map(rows.map(bucket => {
        const time = Number(bucket.created_epoch_ms) || Date.parse(bucket.created);
        return [bucket.id, Number.isFinite(time) && time > 0 ? time : 0];
      }));
      const cutoff = filters.time ? Date.now() - Number(filters.time) * 86400000 : 0;
      return rows.filter(bucket =>
        (!state || state[2](bucket)) &&
        (!cutoff || times.get(bucket.id) >= cutoff) &&
        Number(bucket.importance ?? 5) >= filters.importance &&
        (!filters.domain || (bucket.domain || []).includes(filters.domain)) &&
        (!filters.tag || (bucket.tags || []).includes(filters.tag))
      ).sort((a, b) => {
        const key = {activation:'activation_count', importance:'importance', weight:'score'}[filters.sort];
        const difference = key ? Number(b[key] || 0) - Number(a[key] || 0) : times.get(b.id) - times.get(a.id);
        return difference || times.get(b.id) - times.get(a.id) || String(a.id).localeCompare(String(b.id));
      });
    };
    // All six chip groups share this renderer and one delegated change handler.
    function appendGroup(key, title, choices, selected) {
      const group = document.createElement('fieldset');
      group.dataset.group = key;
      const legend = document.createElement('legend');
      legend.textContent = title;
      group.append(legend);
      const options = document.createElement('div');
      options.className = 'ob-filter-options';
      choices.forEach(([value, name]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ob-filter-chip';
        button.dataset.filter = key; button.dataset.value = value;
        button.textContent = name;
        button.setAttribute('aria-pressed', String(selected === value));
        options.append(button);
      });
      group.append(options); panel.append(group);
    }
    window.buildFilters = function () {
      const focused = panel.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.dataset.filter, focusValue = focused?.dataset.value;
      panel.replaceChildren();
      const tags = new Map(), domains = new Map();
      allBuckets.forEach(bucket => {
        new Set(bucket.tags || []).forEach(tag => tags.set(tag, (tags.get(tag) || 0) + 1));
        new Set(bucket.domain || []).forEach(domain => domains.set(domain, (domains.get(domain) || 0) + 1));
      });
      if (!states.some(state => state[0] === currentFilter)) currentFilter = 'all';
      if (!tags.has(filters.tag)) filters.tag = '';
      if (!domains.has(filters.domain)) filters.domain = '';
      appendGroup('status', '状态', states.map(([key, title, predicate]) => [key, title + ' · ' + allBuckets.filter(predicate).length]), currentFilter);
      appendGroup('sort', '排序', [['newest','最新创建'],['activation','回想次数'],['importance','重要性'],['weight','权重']], filters.sort);
      appendGroup('time', '时间范围', [['','全部'],['7','近7天'],['30','近30天'],['90','近90天']], filters.time);
      const importance = document.createElement('label');
      importance.className = 'ob-filter-importance';
      importance.htmlFor = 'ob-filter-importance';
      importance.innerHTML = '重要度：<output id="ob-filter-importance-label"></output><input id="ob-filter-importance" type="range" min="0" max="10" step="1">';
      panel.append(importance);
      const range = importance.querySelector('input');
      range.value = filters.importance;
      const output = importance.querySelector('output');
      output.value = filters.importance ? '≥ ' + filters.importance : '不限';
      range.addEventListener('input', () => { output.value = Number(range.value) ? '≥ ' + range.value : '不限'; });
      range.addEventListener('change', () => { filters.importance = Number(range.value); applyFilters(); });
      appendGroup('domain', '领域', [['','全部'], ...[...domains].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([name, count]) => [name, name + ' · ' + count])], filters.domain);
      if (tags.size) appendGroup('tag', '标签', [['','全部'], ...[...tags].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([name, count]) => [name, '#' + name + ' · ' + count])], filters.tag);
      const reset = document.createElement('button');
      reset.type = 'button'; reset.id = 'ob-filter-reset'; reset.textContent = '重置筛选';
      reset.addEventListener('click', () => {
        currentFilter = 'all';
        Object.assign(filters, {sort:'newest',time:'',importance:0,domain:'',tag:''});
        applyFilters(); toggle.focus();
      });
      panel.append(reset);
      const count = Number(currentFilter !== 'all') + Number(!!filters.time) + Number(filters.importance > 0) + Number(!!filters.domain) + Number(!!filters.tag);
      toggle.textContent = '筛选与排序' + (count ? ' (' + count + ')' : '') + (panel.hidden ? ' ▾' : ' ▴');
      if (focusKey) [...panel.querySelectorAll('[data-filter]')].find(button => button.dataset.filter === focusKey && button.dataset.value === focusValue)?.focus({preventScroll:true});
      else if (focused?.id === 'ob-filter-importance') range.focus({preventScroll:true});
    };
    function applyFilters() {
      selectedBucketIds.clear();
      buildFilters();
      const query = document.getElementById('search-input').value.trim();
      if (query) searchBuckets(query);
      else renderBuckets(filterBuckets(allBuckets));
    }
    panel.addEventListener('click', event => {
      const button = event.target.closest('button[data-filter]');
      if (!button) return;
      if (button.dataset.filter === 'status') currentFilter = button.dataset.value;
      else filters[button.dataset.filter] = button.dataset.value;
      applyFilters();
    });
    buildFilters();

    const tab = document.querySelector('.tab[data-tab="network"]');
    tab.querySelector('span:first-child').textContent = '记忆星河';
    tab.querySelector('.tab-en').textContent = 'Galaxy';
    const view = document.getElementById('network-view');
    view.replaceChildren();
    view.classList.add('ob-galaxy-view');
    const status = document.createElement('p');
    status.id = 'ob-galaxy-status';
    status.setAttribute('role', 'status');
    view.append(status);
    let frame = null;
    let revision = 0;
    let stars = null;
    let ready = false;
    const send = () => {
      if (ready && frame && stars) frame.contentWindow.postMessage({type:'ob-galaxy-data', stars}, location.origin);
    };
    window.setObGalaxyActive = active => {
      if (frame && ready) frame.contentWindow.postMessage({type:'ob-galaxy-active', active}, location.origin);
    };
    window.addEventListener('message', event => {
      if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'ob-galaxy-ready') {
        ready = true;
        send();
        window.setObGalaxyActive(view.style.display !== 'none');
      }
      if (event.data?.type === 'ob-galaxy-edit' && stars?.some(star => star.id === event.data.id)) {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        showDetail(event.data.id);
      }
    });
    window.loadNetwork = async function () {
      const request = ++revision;
      status.textContent = '正在收集这个会话的星光…';
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'ob-galaxy-frame';
        frame.title = '记忆星河：拖动旋转、缩放、点星星阅读记忆';
        frame.allowFullscreen = true;
        frame.src = '/ob/static/galaxy.html';
        view.append(frame);
      }
      try {
        const response = await fetch('/api/buckets?sort=created_asc', {cache:'no-store'});
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw Error(data.error || '读取记忆失败');
        if (request !== revision) return;
        stars = data;
        status.textContent = '';
        send();
      } catch (error) {
        if (request !== revision) return;
        status.textContent = error.message + '，重新点击「记忆星河」可重试。';
      }
    };
    document.addEventListener('ob-session-changed', () => {
      revision += 1;
      stars = null;
      ready = false;
      if (frame) frame.remove();
      frame = null;
      status.textContent = '';
      Object.assign(filters, {sort:'newest',time:'',importance:0,domain:'',tag:''});
      panel.replaceChildren();
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = '筛选与排序 ▾';
    });
    const originalUpdate = window.updateStats;
    window.updateStats = function () {
      originalUpdate();
      if (view.style.display !== 'none' && frame) window.loadNetwork();
    };
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('ob-page-hidden', document.hidden);
    });
  };
})();
