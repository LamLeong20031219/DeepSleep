/* ===== 普通话同音字 · 直读法 =====
   纯前端，无依赖。数据来自 data/dataset.js（window.DATASET） */
(function () {
  'use strict';

  var D = window.DATASET;
  if (!D) { document.getElementById('view').innerHTML =
    '<p style="padding:20px;color:#b03a2e">数据未加载：请确认 data/dataset.js 与 index.html 在同一目录。</p>'; return; }

  var SYL = D.syllables, TABLE = D.table, SIMP = D.simp, BYCHAR = D.byChar;
  var TONE_NAME = { 1: '一声', 2: '二声', 3: '三声', 4: '四声' };
  var TONE_ORDER = ['1', '2', '3', '4'];

  /* ---------------- 本地状态 ---------------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('pt_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('pt_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var mode = LS.get('mode', 'both');        // trad | simp | both
  var showRare = LS.get('rare', false);
  var favs = LS.get('favs', {});            // { "香|xiang|1": 1 }
  var recent = LS.get('recent', []);        // [ {c,s,p,syl,tone} ]

  /* ---------------- 发音（Web Speech API） ----------------
     要点：多音字直接念裸字会被引擎按自己的默认读音念错（「相」在 xiàng 组里
     可能被念成 xiāng）。所以有例词时改念该字的第一个例词 —— 源词典是按
     「音节+声调」把例词挂在字下的，w[0][0] 必然体现该组的正确读音。
     没有例词的字（约 18%）才退回念单字。 */
  var synth = window.speechSynthesis;
  var speechOK = !!(synth && window.SpeechSynthesisUtterance);
  var zhVoice = null, curUtter = null;
  var speakRate = LS.get('rate', 0.85);     // 0.85 慢速（默认） / 1 常速

  function pickVoice() {
    if (!speechOK) return null;
    var vs = synth.getVoices(), i, v, lg, best = null;
    for (i = 0; i < vs.length; i++) {
      v = vs[i]; lg = String(v.lang || '').replace('_', '-').toLowerCase();
      if (lg.indexOf('zh') === 0) {
        if (lg === 'zh-cn' || lg === 'zh-hans') return v;
        if (!best) best = v;
      }
    }
    return best;
  }
  function refreshSpeechUI() {
    var ok = speechOK && !!pickVoice();
    if (ok) document.body.classList.remove('no-speech');
    else document.body.classList.add('no-speech');
    if ($('speechHint')) $('speechHint').hidden = ok;
  }
  function initSpeech() {
    if (!speechOK) { document.body.classList.add('no-speech'); return; }
    zhVoice = pickVoice();
    // 语音列表是异步加载的，首次 getVoices() 往往为空
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = function () { zhVoice = pickVoice(); refreshSpeechUI(); };
    }
    refreshSpeechUI();
  }
  function speak(text, btn) {
    if (!speechOK || !text) return;
    synth.cancel();                          // 连点时不要排队
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = speakRate;
    if (btn) {
      u.onstart = function () { btn.classList.add('speaking'); };
      u.onend = u.onerror = function () { btn.classList.remove('speaking'); curUtter = null; };
    }
    curUtter = u;                            // 保留引用，否则 iOS 上可能被回收导致截断
    synth.speak(u);
  }
  /* 这个字该念什么：有例词念首词，没有才念单字（统一用简体，zh-CN 引擎识别最稳） */
  function sayOfNode(n) { return n.w.length ? simpWord(n.w[0][0]) : n.s; }

  /* 喇叭图标用内联 SVG，不用 emoji —— emoji 在各平台大小/配色不一致，还会和拼音挤在一起 */
  var SPK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path class="b" d="M11 4.5 6.2 8.6H2.6v6.8h3.6L11 19.5z"/>' +
    '<path class="w" d="M15.6 8.8a4.6 4.6 0 0 1 0 6.4"/>' +
    '<path class="w" d="M18.7 5.6a9 9 0 0 1 0 12.8"/></svg>';
  function spkBtn(say, cls) {
    return '<button class="spk' + (cls ? ' ' + cls : '') + '" data-say="' + esc(say) +
      '" aria-label="朗读" title="朗读">' + SPK_ICON + '</button>';
  }

  function bindSpeak(root) {
    root.querySelectorAll('.spk').forEach(function (b) {
      b.onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();  // 别把卡片/词条的点击也触发了
        speak(b.dataset.say, b);
      };
    });
  }

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function simpWord(w) {
    if (!w) return w;
    var out = '', i, c;
    for (i = 0; i < w.length; i++) { c = w.charAt(i); out += SIMP[c] || c; }
    return out;
  }
  /* 按当前字形模式渲染一个汉字，返回 {main, sub} */
  function form(node) {
    if (mode === 'trad') return { main: node.t, sub: '' };
    if (mode === 'simp') return { main: node.s, sub: '' };
    return { main: node.s, sub: node.s !== node.t ? node.t : '' };
  }
  function isRare(node) { return node.lvl !== 1; }

  function baseSyl(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/v/g, 'ü').replace(/[1-5]/g, '').toLowerCase();
  }
  function toneOfQuery(s) {
    var m = String(s).match(/[1-5]/);
    if (m) return m[0] === '5' ? 0 : +m[0];
    var d = String(s).normalize('NFD').match(/[\u0300-\u036f]/);
    if (d) return ({ '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 })[d[0]] || 0;
    return 0;
  }
  function hasCJK(s) { return /[\u3400-\u9fff]/.test(s); }

  /* ---------------- 收藏 / 最近 ---------------- */
  function favKey(node, syl, tone) { return node.t + '|' + syl + '|' + tone; }
  function isFav(node, syl, tone) { return !!favs[favKey(node, syl, tone)]; }
  function toggleFav(node, syl, tone) {
    var k = favKey(node, syl, tone);
    if (favs[k]) delete favs[k]; else favs[k] = 1;
    LS.set('favs', favs); return !!favs[k];
  }
  function pushRecent(node, syl, tone) {
    var item = { c: node.t, s: node.s, p: node.p, syl: syl, tone: tone };
    recent = recent.filter(function (x) { return !(x.c === item.c && x.syl === syl && x.tone === tone); });
    recent.unshift(item);
    if (recent.length > 24) recent = recent.slice(0, 24);
    LS.set('recent', recent);
  }

  /* ---------------- 路由 ---------------- */
  var route = { name: 'home' };
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 's' && parts[1]) return { name: 'syl', syl: parts[1], tone: parts[2] || '' };
    if (parts[0] === 'c' && parts[1]) return { name: 'char', ch: parts[1] };
    if (parts[0] === 'f') return { name: 'fav' };
    return { name: 'home' };
  }
  function go(hash) { location.hash = hash; }
  /* 替换当前历史项、不新增。用于「同一页内的状态切换」（切换声调）和返回键，
     否则每切一次声调就压一条历史，返回键要按很多次。
     location.replace 只改片段时属同文档导航，会照常触发 hashchange。 */
  function replace(hash) {
    if (location.hash === hash) return;
    location.replace(hash);
  }
  function onRoute() {
    if (speechOK) synth.cancel();            // 切页即停音
    route = parseHash();
    // 先回顶部再渲染：renderSyl 若需要定位到某个声调段，会在渲染后覆盖这个滚动位置
    window.scrollTo(0, 0);
    render();
  }

  /* ---------------- 渲染：音节表首页 ---------------- */
  function renderHome() {
    var groups = {}, order = [];
    TABLE.forEach(function (r) {
      var k = r.i || '零声母';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    var total = TABLE.filter(function (r) { return r.n > 0; }).length;

    var h = ['<div class="hero"><h2>直读法 · 同音字群</h2><p>',
      '普通话只有 <b>' + TABLE.length + '</b> 个音节，汉字却有几万个，所以大量字读法完全相同。',
      '先认准一个音，再把整组同音字一起记 —— 这就是「对比类推直读法」。',
      '点任意音节，看它下面所有同音字。<br>',
      '<span style="opacity:.75">（音节数按《通用规范汉字表》8105 字统计；不同教材口径略有出入，常见说法为 398～416 个。）</span></p></div>'];
    h.push('<div class="secttl">音节表 · 共 ' + TABLE.length + ' 个音节，已收录 ' + total + ' 个</div>');

    order.forEach(function (k) {
      var rows = groups[k];
      h.push('<div class="initgroup"><div class="inithd"><span class="i">' +
        esc(k === '零声母' ? '零声母' : k + '-') + '</span><span class="c">' + rows.length + ' 个</span></div>');
      h.push('<div class="sylgrid">');
      rows.forEach(function (r) {
        var dots = TONE_ORDER.map(function (t) {
          return '<i class="' + (r.t[t] ? 'f' + t : '') + '"></i>';
        }).join('');
        h.push('<div class="sylcell' + (r.n ? '' : ' empty') + '" data-s="' + esc(r.s) + '">' +
          '<div class="s">' + esc(r.s) + '</div>' +
          '<div class="dots">' + dots + '</div>' +
          '<div class="n">' + (r.n ? r.n + ' 字' : '暂无') + '</div></div>');
      });
      h.push('</div></div>');
    });

    if (recent.length) {
      h.push('<div class="secttl">最近看过</div><div class="sylgrid">');
      recent.slice(0, 12).forEach(function (x) {
        var nd = { t: x.c, s: x.s, p: x.p, lvl: 1 };
        var f = form(nd);
        h.push('<div class="sylcell" data-c="' + esc(x.c) + '"><div class="s">' + esc(f.main) +
          '</div><div class="n">' + esc(x.p) + '</div></div>');
      });
      h.push('</div>');
    }

    var v = $('view'); v.innerHTML = h.join('');
    v.querySelectorAll('.sylcell[data-s]').forEach(function (el) {
      if (el.classList.contains('empty')) return;
      el.onclick = function () { go('#/s/' + encodeURIComponent(el.dataset.s)); };
    });
    v.querySelectorAll('.sylcell[data-c]').forEach(function (el) {
      el.onclick = function () { go('#/c/' + encodeURIComponent(el.dataset.c)); };
    });
    $('brand').innerHTML = '普通话同音字<small>直读法</small>';
    $('backBtn').hidden = true;
    $('favBtn').hidden = !Object.keys(favs).length;
  }

  /* ---------------- 渲染：音节详情 ----------------
     一次列出该音节下全部声调的同音字，按声调分组逐段呈现。
     wantTone 只用于「从别处跳过来时滚到对应那一段」，不再做筛选。 */
  function renderSyl(syl, wantTone) {
    var s = SYL[syl];
    if (!s) { $('view').innerHTML = '<p class="emptyhint">未收录音节「' + esc(syl) + '」</p>'; return; }
    var tones = s.tones;
    var row = TABLE.filter(function (r) { return r.s === syl; })[0] || {};

    var total = 0, hiddenTotal = 0, shownByTone = {};
    TONE_ORDER.forEach(function (t) {
      var list = tones[t] || [];
      var shown = showRare ? list : list.filter(function (n) { return !isRare(n); });
      total += list.length;
      hiddenTotal += list.length - shown.length;
      shownByTone[t] = shown;
    });

    var h = [];
    h.push('<div class="sylhead"><div class="big">' + esc(syl) + '</div>' +
      '<div class="meta">声母 <b>' + esc(row.i || '—') + '</b> · 韵母 <b>' + esc(row.f || syl) +
      '</b> · 共 <b>' + total + '</b> 字</div></div>');

    TONE_ORDER.forEach(function (t) {
      var list = tones[t] || [];
      var shown = shownByTone[t];
      var hid = list.length - shown.length;
      h.push('<div class="tonesec" data-t="' + t + '">');
      h.push('<div class="secttl' + (list.length ? '' : ' toneless') + '">同音字 · ' + TONE_NAME[t] +
        ' · 共 ' + list.length + ' 字' +
        (hid ? '（隐藏生僻字 ' + hid + ' 个）' : '') + '</div>');
      if (list.length && !shown.length) {
        h.push('<div class="emptyhint">这个声调的字已全部折叠，点下方「显示生僻字」查看</div>');
      }
      if (list.length) {
        h.push('<div class="chgrid">');
        shown.forEach(function (n, i) {
          var f = form(n);
          h.push('<div class="chcard' + (isRare(n) ? ' rare' : '') + (isFav(n, syl, t) ? ' fav' : '') +
            '" data-t="' + t + '" data-i="' + i + '">' +
            spkBtn(sayOfNode(n)) +
            '<div class="py">' + esc(n.p) + '</div>' +
            '<div class="zi">' + esc(f.main) + '</div>' +
            '<div class="alt">' + esc(f.sub) + '</div>' +
            '<div class="wn">' + (n.w.length ? n.w.length + ' 词' : '') + '</div></div>');
        });
        h.push('</div>');
      }
      h.push('</div>');
    });

    if (hiddenTotal) {
      h.push('<div class="rarewrap"><button class="raretoggle" id="rareBtn">显示生僻字 (' +
        hiddenTotal + ')</button></div>');
    }

    var v = $('view'); v.innerHTML = h.join('');
    $('brand').innerHTML = esc(syl) + '<small>' + (row.i ? row.i + '-' : '') + esc(row.f || '') + '</small>';
    $('backBtn').hidden = false;
    $('favBtn').hidden = !Object.keys(favs).length;

    v.querySelectorAll('.chcard').forEach(function (el) {
      el.onclick = function () {
        var t = el.dataset.t;
        var n = shownByTone[t][+el.dataset.i];
        if (n) openSheet(n, syl, t);
      };
    });
    bindSpeak(v);
    if ($('rareBtn')) $('rareBtn').onclick = function () {
      showRare = true; LS.set('rare', true); $('chkRare').checked = true; render();
    };

    // 带声调跳进来（如从汉字页读音胶囊、弹层「同音字 N 个」）→ 滚到那一段
    if (wantTone && (tones[wantTone] || []).length) {
      var sec = v.querySelector('.tonesec[data-t="' + wantTone + '"]');
      if (sec) sec.scrollIntoView({ block: 'start' });
    }
  }

  /* ---------------- 渲染：汉字详情 ---------------- */
  function renderChar(ch) {
    var keys = BYCHAR[ch] || [];
    if (!keys.length) {
      $('view').innerHTML = '<p class="emptyhint">词典里没有收录「' + esc(ch) + '」。</p>';
      $('brand').innerHTML = '普通话同音字<small>直读法</small>';
      $('backBtn').hidden = false;
      $('favBtn').hidden = !Object.keys(favs).length; return;
    }
    var nodes = [];
    keys.forEach(function (k) {
      var m = k.match(/^([a-zü]+)(\d)$/);
      if (!m) return;
      var s = SYL[m[1]]; if (!s) return;
      (s.tones[m[2]] || []).forEach(function (n) { if (n.t === ch || n.s === ch) nodes.push({ n: n, syl: m[1], tone: m[2] }); });
    });
    if (!nodes.length) { $('view').innerHTML = '<p class="emptyhint">找不到「' + esc(ch) + '」的读音。</p>'; return; }

    var main = form(nodes[0].n);
    var h = [];
    h.push('<div class="chhero"><div class="bigzi-wrap">' +
      '<div class="bigzi">' + esc(main.main) + '</div>' +
      spkBtn(sayOfNode(nodes[0].n), 'big') +
      '</div><div class="info">' +
      (main.sub ? '<div style="font-size:13px;color:#9aa1ab">繁体：' + esc(main.sub) + '</div>' : '') +
      '<div class="rd">');
    nodes.forEach(function (x) {
      h.push('<button class="rdpill" data-t="' + x.tone + '" data-s="' + esc(x.syl) + '">' +
        esc(x.n.p) + '</button>');
    });
    h.push('</div><div class="lv">' + lvlText(nodes[0].n.lvl) +
      (nodes.length > 1 ? ' · 多音字，共 ' + nodes.length + ' 个读音' : '') + '</div></div></div>');

    nodes.forEach(function (x) {
      h.push('<div class="secttl">' + esc(x.n.p) + ' · ' + TONE_NAME[x.tone] +
        ' · 同音字 ' + ((SYL[x.syl].tones[x.tone] || []).length) + ' 个</div>');
      h.push('<div class="wordlist">');
      if (!x.n.w.length) h.push('<div class="emptyhint">暂无例词</div>');
      x.n.w.forEach(function (w) {
        h.push(wordHTML(w));
      });
      h.push('</div>');
      h.push('<div class="rarewrap" style="text-align:left"><button class="raretoggle" ' +
        'data-s="' + esc(x.syl) + '" data-t="' + x.tone + '">查看这一组全部同音字 ›</button></div>');
    });

    var v = $('view'); v.innerHTML = h.join('');
    $('brand').innerHTML = esc(main.main) + '<small>' + esc(nodes[0].n.p) + '</small>';
    $('backBtn').hidden = false;
    $('favBtn').hidden = !Object.keys(favs).length;
    v.querySelectorAll('.rdpill').forEach(function (b) {
      b.onclick = function () { go('#/s/' + encodeURIComponent(b.dataset.s) + '/' + b.dataset.t); };
    });
    v.querySelectorAll('.raretoggle[data-s]').forEach(function (b) {
      b.onclick = function () { go('#/s/' + encodeURIComponent(b.dataset.s) + '/' + b.dataset.t); };
    });
    bindWords(v);
  }

  function lvlText(l) {
    return l === 1 ? '《通用规范汉字表》一级常用字'
      : l === 2 ? '《通用规范汉字表》二级字'
      : l === 3 ? '《通用规范汉字表》三级字' : '表外字（较生僻）';
  }

  function wordHTML(w) {
    var trad = w[0], py = w[1] || '';
    var main = mode === 'trad' ? trad : simpWord(trad);
    var sub = (mode === 'both' && simpWord(trad) !== trad) ? trad : '';
    return '<div class="worditem" data-w="' + esc(trad) + '">' +
      '<span class="w">' + esc(main) + '</span>' +
      '<span class="wp">' + esc(py) + '</span>' +
      '<span class="wend">' + (sub ? '<span class="ws">' + esc(sub) + '</span>' : '') +
      spkBtn(simpWord(trad)) + '</span></div>';
  }
  function bindWords(root) {
    root.querySelectorAll('.worditem[data-w]').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.onclick = function () {
        var first = el.dataset.w.charAt(0);
        if (BYCHAR[first]) go('#/c/' + encodeURIComponent(first));
      };
    });
    bindSpeak(root);
  }

  /* ---------------- 渲染：我的收藏 ---------------- */
  function renderFav() {
    var keys = Object.keys(favs);
    $('brand').innerHTML = '我的收藏<small>' + keys.length + ' 个字</small>';
    $('backBtn').hidden = false; $('favBtn').hidden = true;
    var v = $('view');
    if (!keys.length) {
      v.innerHTML = '<p class="emptyhint">还没有收藏。点开任意同音字卡片，在弹层里点「☆ 收藏」。</p>';
      return;
    }
    var h = ['<div class="secttl">点任意字查看例词</div><div class="chgrid">'];
    keys.forEach(function (k) {
      var p = k.split('|'), s = SYL[p[1]], t = p[2];
      if (!s) return;
      var node = (s.tones[t] || []).filter(function (n) { return n.t === p[0] || n.s === p[0]; })[0];
      if (!node) return;
      var f = form(node);
      h.push('<div class="chcard fav" data-s="' + esc(p[1]) + '" data-t="' + esc(t) +
        '" data-c="' + esc(node.t) + '">' +
        spkBtn(sayOfNode(node)) +
        '<div class="py">' + esc(node.p) + '</div>' +
        '<div class="zi">' + esc(f.main) + '</div>' +
        '<div class="alt">' + esc(f.sub) + '</div>' +
        '<div class="wn">' + node.w.length + ' 词</div></div>');
    });
    h.push('</div>');
    v.innerHTML = h.join('');
    v.querySelectorAll('.chcard').forEach(function (el) {
      el.onclick = function () {
        var s = SYL[el.dataset.s], t = el.dataset.t;
        var node = (s.tones[t] || []).filter(function (n) {
          return n.t === el.dataset.c || n.s === el.dataset.c; })[0];
        if (node) openSheet(node, el.dataset.s, t);
      };
    });
    bindSpeak(v);
  }

  /* ---------------- 底部弹层 ---------------- */
  var sheetCtx = null;
  function openSheet(node, syl, tone) {
    sheetCtx = { node: node, syl: syl, tone: tone };
    var f = form(node);
    var say = sayOfNode(node);
    $('shPy').textContent = node.p + ' · ' + TONE_NAME[tone];
    $('shZi').textContent = f.main;
    $('shAlt').textContent = f.sub ? '繁体：' + f.sub : '';
    $('shSpeak').dataset.say = say;
    // 读的是例词而不是这个字本身时，说清楚在读什么，免得用户困惑
    $('shSay').textContent = (say === node.s || say === node.t) ? '' : '朗读：' + say;

    var h = [];
    h.push('<div class="secttl">例词 · ' + node.w.length + ' 个</div><div class="wordlist">');
    if (!node.w.length) h.push('<div class="emptyhint">暂无例词</div>');
    node.w.forEach(function (w) { h.push(wordHTML(w)); });
    h.push('</div>');
    h.push('<div class="acts">' +
      '<button class="actbtn' + (isFav(node, syl, tone) ? ' on' : '') + '" id="shFav">' +
      (isFav(node, syl, tone) ? '★ 已收藏' : '☆ 收藏') + '</button>' +
      '<button class="actbtn" id="shGroup">同音字 ' +
      ((SYL[syl].tones[tone] || []).length) + ' 个 ›</button></div>');
    $('shBody').innerHTML = h.join('');
    bindWords($('shBody'));

    $('shFav').onclick = function () {
      var on = toggleFav(node, syl, tone);
      this.className = 'actbtn' + (on ? ' on' : '');
      this.textContent = on ? '★ 已收藏' : '☆ 收藏';
      $('favBtn').hidden = !Object.keys(favs).length;   // 收藏后顶栏入口要立刻出现
    };
    $('shGroup').onclick = function () { closeSheet(); go('#/s/' + encodeURIComponent(syl) + '/' + tone); };

    $('sheet').hidden = false; $('mask').hidden = false;
    pushRecent(node, syl, tone);
  }
  function closeSheet() { $('sheet').hidden = true; $('mask').hidden = true; sheetCtx = null; }

  /* ---------------- 搜索 ---------------- */
  var wordIndex = null;
  function buildWordIndex() {
    if (wordIndex) return wordIndex;
    wordIndex = [];
    Object.keys(SYL).forEach(function (sy) {
      Object.keys(SYL[sy].tones).forEach(function (t) {
        SYL[sy].tones[t].forEach(function (n) {
          n.w.forEach(function (w) {
            wordIndex.push({ w: w[0], p: w[1], syl: sy, tone: t, ch: n.t, py: n.p });
          });
        });
      });
    });
    return wordIndex;
  }

  function doSearch(qraw) {
    var q = qraw.trim();
    if (!q) return [];
    var out = [];

    if (hasCJK(q)) {
      // 1) 单字
      for (var i = 0; i < q.length; i++) {
        var c = q.charAt(i);
        if (BYCHAR[c]) {
          var keys = BYCHAR[c].slice(0, 4).map(function (k) {
            var m = k.match(/^([a-zü]+)(\d)$/);
            return m ? SYL[m[1]] ? SYL[m[1]].tones[m[2]] : null : null;
          }).filter(Boolean);
          var pys = [];
          keys.forEach(function (lst) { lst.forEach(function (n) { if (n.t === c || n.s === c) pys.push(n.p); }); });
          out.push({ type: 'char', k: c, d: pys.slice(0, 3).join(' / '), tag: '汉字', href: '#/c/' + encodeURIComponent(c) });
        }
      }
      // 2) 词语
      if (q.length >= 2) {
        var idx = buildWordIndex(), n = 0;
        for (var j = 0; j < idx.length && n < 12; j++) {
          var it = idx[j];
          if (it.w.indexOf(q) >= 0 || simpWord(it.w).indexOf(q) >= 0) {
            out.push({ type: 'word', k: it.w, d: it.p, tag: '词语', href: '#/c/' + encodeURIComponent(it.ch) });
            n++;
          }
        }
      }
    } else {
      // 拼音
      var base = baseSyl(q), tone = toneOfQuery(q);
      TABLE.forEach(function (r) {
        if (r.n === 0) return;
        if (r.s === base) {
          out.push({ type: 'syl', k: r.s, d: tone && r.t[tone] ? TONE_NAME[tone] + ' ' + r.t[tone] + ' 字' : r.n + ' 字',
            tag: '音节', href: '#/s/' + encodeURIComponent(r.s) + (tone && r.t[tone] ? '/' + tone : '') });
        }
      });
      if (!out.length) {
        TABLE.forEach(function (r) {
          if (r.n && out.length < 10 && r.s.indexOf(base) === 0) {
            out.push({ type: 'syl', k: r.s, d: r.n + ' 字', tag: '音节', href: '#/s/' + encodeURIComponent(r.s) });
          }
        });
      }
    }
    return out.slice(0, 14);
  }

  var sugTimer = null;
  function onInput() {
    var q = $('q').value;
    $('clearq').hidden = !q;
    clearTimeout(sugTimer);
    sugTimer = setTimeout(function () {
      var res = doSearch(q);
      var box = $('suggest');
      if (!q.trim() || !res.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = res.map(function (r) {
        return '<div class="sug" data-h="' + esc(r.href) + '">' +
          '<span class="k' + (r.type === 'syl' ? ' py' : '') + '">' + esc(r.k) + '</span>' +
          '<span class="d">' + esc(r.d) + '</span>' +
          '<span class="tag">' + r.tag + '</span></div>';
      }).join('');
      box.hidden = false;
      box.querySelectorAll('.sug').forEach(function (el) {
        el.onclick = function () {
          box.hidden = true; $('q').value = ''; $('clearq').hidden = true; go(el.dataset.h);
        };
      });
    }, 90);
  }

  /* ---------------- 主渲染 ---------------- */
  function render() {
    if (route.name === 'syl') renderSyl(route.syl, route.tone);
    else if (route.name === 'char') renderChar(route.ch);
    else if (route.name === 'fav') renderFav();
    else renderHome();
    $('settings').hidden = true;
    var m = D.meta;
    $('footInfo').textContent = m.syllables + ' 音节 / ' +
      m.chars + ' 字条 / ' + m.words + ' 例词 · 离线可用';
  }

  /* ---------------- 事件绑定 ---------------- */
  /* 显式回到父级（首页），不用 history.back()。
     原因一：history.length 统计的是整个标签页的历史，几乎永远 > 1，从深链/PWA
     直接进来时按返回会直接退出 App。
     原因二：用 replace 而不是 go，否则历史会变成 [home, syl, home]，
     之后按原生返回会又跳回刚离开的音节页。 */
  $('backBtn').onclick = function () {
    if (route.name === 'home') return;
    replace('#/');
  };
  $('setBtn').onclick = function () { var s = $('settings'); s.hidden = !s.hidden; };
  $('favBtn').onclick = function () { go('#/f'); };
  $('q').addEventListener('input', onInput);
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var r = doSearch(this.value); if (r.length) { $('suggest').hidden = true; go(r[0].href); } }
  });
  $('clearq').onclick = function () { $('q').value = ''; $('clearq').hidden = true; $('suggest').hidden = true; };
  $('mask').onclick = closeSheet;
  $('shClose').onclick = closeSheet;
  document.addEventListener('click', function (e) {
    if (!$('suggest').hidden && !$('suggest').contains(e.target) &&
        e.target !== $('q') && !$('q').contains(e.target)) $('suggest').hidden = true;
  });

  $('segMode').querySelectorAll('button').forEach(function (b) {
    if (b.dataset.v === mode) b.classList.add('on'); else b.classList.remove('on');
    b.onclick = function () {
      mode = b.dataset.v; LS.set('mode', mode);
      $('segMode').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      render();
    };
  });
  $('chkRare').checked = showRare;
  $('chkRare').onchange = function () { showRare = this.checked; LS.set('rare', showRare); render(); };

  /* 语速切换 */
  $('segRate').querySelectorAll('button').forEach(function (b) {
    if (+b.dataset.v === speakRate) b.classList.add('on'); else b.classList.remove('on');
    b.onclick = function () {
      speakRate = +b.dataset.v; LS.set('rate', speakRate);
      $('segRate').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    };
  });

  /* 发音：静态的弹层大喇叭绑一次；其余喇叭由 bindSpeak 在每次渲染后绑定 */
  $('shSpeak').onclick = function (ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    speak($('shSpeak').dataset.say, $('shSpeak'));
  };
  initSpeech();

  /* 关掉浏览器自带的滚动恢复，否则原生回退时会和 onRoute 里的 scrollTo(0,0) 打架 */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  window.addEventListener('hashchange', onRoute);
  onRoute();
})();
