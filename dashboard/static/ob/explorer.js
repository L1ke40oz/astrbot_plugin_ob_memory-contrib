/* Compact memory filtering and the session-scoped galaxy bridge. */
(function () {
  'use strict';
  window.installObExplorer = function () {
    const toolbar = document.querySelector('#list-view .bucket-viewbar');
    toolbar.replaceChildren();
    document.getElementById('filters').remove();
    const label = document.createElement('label');
    label.className = 'ob-memory-filter';
    label.htmlFor = 'ob-memory-filter';
    label.append('记忆筛选');
    const picker = document.createElement('select');
    picker.id = 'ob-memory-filter';
    picker.setAttribute('aria-label', '按记忆状态或标签筛选');
    label.append(picker);
    toolbar.append(label);
    const search = document.querySelector('.header .search-bar');
    search.classList.add('ob-memory-search');
    toolbar.append(search);
    search.querySelector('button').innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
    search.querySelector('button').setAttribute('aria-label', '搜索记忆');
    document.getElementById('search-input').placeholder = '搜索记忆…';
    bucketSort = 'score';
    currentFilter = 'all';
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
      if (state) return rows.filter(state[2]);
      if (currentFilter.startsWith('tag:')) return rows.filter(b => (b.tags || []).includes(currentFilter.slice(4)));
      if (currentFilter.startsWith('domain:')) return rows.filter(b => (b.domain || []).includes(currentFilter.slice(7)));
      return rows;
    };
    window.buildFilters = function () {
      picker.replaceChildren();
      const tags = new Map(), domains = new Map();
      allBuckets.forEach(bucket => {
        new Set(bucket.tags || []).forEach(tag => tags.set(tag, (tags.get(tag) || 0) + 1));
        new Set(bucket.domain || []).forEach(domain => domains.set(domain, (domains.get(domain) || 0) + 1));
      });
      const groups = [
        ['记忆状态', states.map(item => [item[0], item[1], allBuckets.filter(item[2]).length])],
        ['记忆标签', [...tags].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([tag, count]) => ['tag:' + tag, '#' + tag, count])],
        ['记忆分类', [...domains].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([domain, count]) => ['domain:' + domain, domain, count])]
      ];
      groups.forEach(([name, entries]) => {
        if (!entries.length) return;
        const group = document.createElement('optgroup');
        group.label = name;
        entries.forEach(([key, title, count]) => group.append(new Option(title + ' · ' + count, key)));
        picker.append(group);
      });
      if (![...picker.options].some(option => option.value === currentFilter)) currentFilter = 'all';
      picker.value = currentFilter;
    };
    picker.addEventListener('change', () => {
      currentFilter = picker.value;
      selectedBucketIds.clear();
      const query = document.getElementById('search-input').value.trim();
      if (query) searchBuckets(query);
      else renderBuckets(filterBuckets(allBuckets));
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
      picker.replaceChildren(new Option('全部记忆', 'all'));
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
