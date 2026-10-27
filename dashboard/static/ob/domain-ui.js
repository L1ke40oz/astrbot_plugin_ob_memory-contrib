/* Persistent plans and letters for the AstrBot-backed OB dashboard. */
(function () {
  'use strict';
  var planRevision = 0, letterRevision = 0, planDraft = false, letterDraft = false, busy = false;
  async function api(path, options) {
    var response = await fetch('/api/' + path, options);
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败');
    return result;
  }
  function json(method, body) { return {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}; }

  window.installObDomains = function () {
    var form = document.createElement('form');
    form.id = 'ob-plan-create';
    form.innerHTML = '<label for="ob-plan-name">计划名称<input id="ob-plan-name" maxlength="120" placeholder="可选，简短描述这份承诺"></label>' +
      '<label for="ob-plan-content">计划内容<textarea id="ob-plan-content" required rows="3" placeholder="想完成什么，或答应了什么…"></textarea></label>' +
      '<label for="ob-plan-weight">承诺重量<input id="ob-plan-weight" type="range" min="0" max="100" value="50"></label>' +
      '<div class="ob-domain-actions"><button type="submit">新增计划</button><span id="ob-plan-message" role="status"></span></div>';
    document.getElementById('plan-board').before(form);
    form.addEventListener('input', function () { planDraft = true; });
    document.getElementById('letter-content').addEventListener('input', function () { letterDraft = true; });
    ['letter-title','letter-username','letter-date','letter-lock-type','letter-unlock-date'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () { letterDraft = true; });
    });
    var author = document.getElementById('letter-author');
    Array.from(author.options).forEach(function (option) { if (option.value !== 'user') option.remove(); });
    author.options[0].textContent = '我（用户）';
    window.hasObDomainDrafts = function () { return planDraft || letterDraft; };
    window.isObDomainSaving = function () { return busy; };
    window.discardObDomainDrafts = function () {
      planDraft = false; letterDraft = false; form.reset();
      ['letter-content','letter-title','letter-username','letter-date','letter-unlock-date'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('letter-lock-type').value = 'none'; toggleLetterUnlockInput();
    };
    document.addEventListener('ob-session-changed', function () {
      planRevision += 1; letterRevision += 1;
      document.getElementById('plan-board').replaceChildren();
      document.getElementById('letters-list').replaceChildren();
      _lettersCache = [];
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy) return;
      busy = true; form.inert = true;
      var message = document.getElementById('ob-plan-message'); message.textContent = '保存中…';
      try {
        await api('plans', json('POST', {name:document.getElementById('ob-plan-name').value, content:document.getElementById('ob-plan-content').value, weight:Number(document.getElementById('ob-plan-weight').value)/100}));
        planDraft = false; form.reset();
        await refreshAstrbotSessions(); await loadPlans(); message.textContent = '计划已保存。';
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; form.inert = false; }
    });

    window.loadPlans = async function () {
      var generation = ++planRevision;
      var board = document.getElementById('plan-board');
      board.textContent = '加载中…';
      try {
        var data = await api('plans');
        if (generation !== planRevision) return;
        document.getElementById('plan-stats').textContent = '共 ' + data.total + ' 条 · 进行中 ' + data.active.length + ' / 已完成 ' + data.resolved.length + ' / 已放弃 ' + data.abandoned.length;
        board.innerHTML = [['进行中',data.active],['已完成',data.resolved],['已放弃',data.abandoned]].map(function (group) {
          return group[1].length ? '<section><h4>' + group[0] + '</h4>' + group[1].map(_planCard).join('') + '</section>' : '';
        }).join('') || '<p class="ob-letter-meta">暂无计划，可以在上方记下一份承诺。</p>';
        if (window.lucide) lucide.createIcons();
      } catch (error) { if (generation === planRevision) board.textContent = error.message; }
    };
    window.loadLetters = async function () {
      var generation = ++letterRevision;
      var list = document.getElementById('letters-list'); list.textContent = '加载中…';
      try {
        var filter = document.getElementById('letter-filter').value;
        var data = await api('letters' + (filter ? '?author=' + encodeURIComponent(filter) : ''));
        if (generation !== letterRevision) return;
        _lettersCache = data.letters;
        document.getElementById('letter-count').textContent = data.total + ' 封';
        list.innerHTML = data.letters.map(function (letter) {
          var lock = letter.lock_type === 'timed' ? '定时解锁 · ' + new Date(letter.unlock_date).toLocaleString() : letter.lock_type === 'permanent' ? '永久锁' : '立即可读';
          return '<article class="ob-letter-card" data-id="' + escAttr(letter.id) + '"><div class="ob-letter-meta">' + esc(letter.writer_name) + ' · ' + esc(letter.date) + '<br>' + esc(lock) + '</div>' +
            (letter.locked ? '<p class="ob-letter-meta">这封信尚未向你开放。</p>' : '<h4>' + esc(letter.title || '无题') + '</h4><div class="ob-letter-body">' + esc(letter.content || '') + '</div>') +
            (letter.lock_owner ? '<div class="ob-letter-actions"><button data-id="' + escAttr(letter.id) + '" onclick="editLetter(this.dataset.id)">编辑</button><button data-id="' + escAttr(letter.id) + '" onclick="manageLetterLock(this.dataset.id)">管理锁</button><button data-id="' + escAttr(letter.id) + '" onclick="deleteLetter(this.dataset.id)">归档</button></div>' : '') + '</article>';
        }).join('') || '<p class="ob-letter-meta">尚无信件，可以在上方写下第一封。</p>';
      } catch (error) { if (generation === letterRevision) list.textContent = error.message; }
    };
    window.sendLetter = async function () {
      if (busy) return;
      var status = document.getElementById('letter-status');
      var lockType = document.getElementById('letter-lock-type').value;
      var body = {author:'user',content:document.getElementById('letter-content').value,title:document.getElementById('letter-title').value,user_name:document.getElementById('letter-username').value,date:document.getElementById('letter-date').value,lock_type:lockType};
      if (lockType === 'timed') {
        var raw = document.getElementById('letter-unlock-date').value;
        if (!raw) { status.textContent = '请选择解锁时间。'; return; }
        body.unlock_date = new Date(raw).toISOString();
      }
      busy = true; status.textContent = '寄送中…';
      var section = document.getElementById('letter-content').closest('.config-section'); section.inert = true;
      try {
        await api('letter',json('POST',body));
        letterDraft = false; document.getElementById('letter-content').value = ''; document.getElementById('letter-title').value = '';
        document.getElementById('letter-lock-type').value = 'none'; document.getElementById('letter-unlock-date').value = ''; toggleLetterUnlockInput();
        await refreshAstrbotSessions(); await loadLetters(); status.textContent = '信已寄出。';
      } catch (error) { status.textContent = error.message; }
      finally { busy = false; section.inert = false; }
    };
    window.deleteLetter = async function (id) {
      if (!confirm('归档这封信？原文会保留。')) return;
      try { await api('letter/' + encodeURIComponent(id),{method:'DELETE'}); await loadLetters(); }
      catch (error) { alert(error.message); }
    };
  };
})();
