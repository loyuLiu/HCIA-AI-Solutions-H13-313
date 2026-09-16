/* HCIA-AI Solution 题库刷题平台 —— 应用逻辑 */
(function () {
  "use strict";

  /* ================= 数据初始化 ================= */
  var CHAPTERS = (window.QB_CHAPTERS || []).slice().sort(function (a, b) { return a.id - b.id; });
  var ALL = [];
  CHAPTERS.forEach(function (ch) {
    ch.questions.forEach(function (q, i) {
      ALL.push({
        /* uid 是题库里固化的永久编号：题库增删题后位置会变，
           但 uid 不变，已保存的错题本 / 收藏 / 作答记录仍指向同一道题 */
        id: q.uid || (ch.id + "-" + (i + 1)),
        chId: ch.id,
        chName: ch.name,
        idx: i + 1,
        t: q.t,
        q: q.q,
        o: q.o || null,
        a: q.a,
        ex: q.ex || ""
      });
    });
  });

  var TYPE_NAME = { judge: "判断题", single: "单选题", multi: "多选题", blank: "填空题" };
  var TYPE_COLOR = { judge: "var(--info)", single: "var(--primary)", multi: "var(--warn)", blank: "var(--success)" };
  var LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  /* 官方认证考点占比（HCIA-AI Solution V1.0 笔试知识点占比，第 8 章无占比） */
  var EXAM_RATIO = [
    { ch: 1, pct: 17, name: "人工智能发展趋势" },
    { ch: 2, pct: 17, name: "人工智能和算力基础" },
    { ch: 3, pct: 22, name: "人工智能业务流程概述" },
    { ch: 4, pct: 22, name: "华为智算方案和产品介绍" },
    { ch: 5, pct: 6, name: "昇腾大模型解决方案概述" },
    { ch: 6, pct: 10, name: "大模型部署与商业模式介绍" },
    { ch: 7, pct: 6, name: "业界大模型及应用" }
  ];

  /* 模拟考试题型结构（固定）：60 题 / 满分 1000 分 / 600 分合格
     判断题 18×10=180　单选题 20×19=380　多选题 16×20=320　填空题 6×20=120 */
  var EXAM_PLAN = [
    { t: "judge",  n: 18, score: 10 },
    { t: "single", n: 20, score: 19 },
    { t: "multi",  n: 16, score: 20 },
    { t: "blank",  n: 6,  score: 20 }
  ];
  var EXAM_TOTAL_Q = EXAM_PLAN.reduce(function (s, p) { return s + p.n; }, 0);            // 60
  var EXAM_TOTAL_SCORE = EXAM_PLAN.reduce(function (s, p) { return s + p.n * p.score; }, 0); // 1000
  var EXAM_PASS_SCORE = 600;
  var SCORE_OF = {};   // 题型 -> 单题分值
  EXAM_PLAN.forEach(function (p) { SCORE_OF[p.t] = p.score; });

  /* ================= 本地存储 ================= */
  var KEY = "hcia_ai_qb_v2";
  /* answers：每题「最近一次」的作答详情（选了什么 / 对不对 / 什么时候答的）。
     长期累积，跨练习轮次、跨浏览器保留；stat 只记次数，answers 记内容。 */
  var store = { stat: {}, answers: {}, wrong: [], fav: [], records: [], theme: "", session: null };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var o = JSON.parse(raw);
      store.stat = o.stat || {};
      store.answers = o.answers || {};
      store.wrong = o.wrong || [];
      store.fav = o.fav || [];
      store.records = (o.records || []).map(migrateRecord);
      store.theme = o.theme || "";
      store.session = o.session || null;
    }
  } catch (e) { }
  /* 历史考试记录是百分制（满分 100 / 60 分合格），现改为千分制（满分 1000 / 600 分合格）。
     两种制度合格率同为 60%，故旧记录直接 ×10 折算，避免新旧分数混排导致误判。 */
  function migrateRecord(r) {
    if (!r || r.max) return r;
    var out = { score: Math.round((r.score || 0) * 10), max: 1000, pass: EXAM_PASS_SCORE };
    Object.keys(r).forEach(function (k) { if (!(k in out)) out[k] = r[k]; });
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { }
    // 已登录时自动同步到服务端（auth.js 内部做了防抖）
    if (window.HCIA_AUTH && window.HCIA_AUTH.markDirty) window.HCIA_AUTH.markDirty();
  }

  /* ================= 练习进度（断点续练） =================
   * S 原本只存在于内存里，刷新 / 换浏览器就丢失。
   * 这里把「当前题目列表 + 位置 + 已作答内容」存进 store.session，
   * 随 save() 一起落盘并同步到云端，从而实现练习进度持久化。
   * 考试（exam）不落盘：计时交卷不适宜中断恢复。
   * ======================================================= */
  function sessionDone(s) {
    var a = (s && s.answers) || {};
    var n = 0;
    Object.keys(a).forEach(function (k) { if (a[k] && a[k].checked) n++; });
    return n;
  }
  function saveSession() {
    if (!S.list.length) return;
    if (S.mode !== "practice" && S.mode !== "exam") return;
    if (S.mode === "exam" && S.submitted) return;   // 已交卷的考试不再保留会话
    if (S.mode === "exam" && !S.startedAt) S.startedAt = Date.now();
    store.session = {
      mode: S.mode,
      title: S.title,
      pos: S.pos,
      ids: S.list.map(function (q) { return q.id; }),
      answers: S.answers,
      savedAt: Date.now()
    };
    if (S.mode === "exam") {
      store.session.timeLimit = S.timeLimit;
      store.session.startedAt = S.startedAt;
    }
    save();
  }
  function clearSession() {
    store.session = null;
    save();
  }
  function restoreSession() {
    var s = store.session;
    if (!s || !s.ids || !s.ids.length) return false;
    if (s.mode !== "practice" && s.mode !== "exam") return false;
    var list = s.ids.map(byId).filter(Boolean);
    if (list.length !== s.ids.length) { clearSession(); return false; } // 题库变更，会话作废
    S.mode = s.mode === "exam" ? "exam" : "practice";
    S.list = list;
    S.pos = Math.min(Math.max(0, parseInt(s.pos, 10) || 0), list.length - 1);
    S.answers = s.answers || {};
    S.result = null;
    S.submitted = false; S.reviewing = false;
    if (S.mode === "exam") {
      S.timeLimit = s.timeLimit || 0;
      S.startedAt = s.startedAt || Date.now();
      // 按真实流逝时间续算剩余时长（关掉页面期间照常计时）
      var used = Math.floor((Date.now() - S.startedAt) / 1000);
      S.remain = Math.max(0, S.timeLimit - used);
      S.title = s.title || "模拟考试";
    } else {
      S.timeLimit = 0; S.startedAt = 0;
      S.title = s.title || "练习模式";
    }
    return true;
  }

  function isWrong(id) { return store.wrong.indexOf(id) >= 0; }
  function isFav(id) { return store.fav.indexOf(id) >= 0; }
  function toggleWrong(id) {
    var i = store.wrong.indexOf(id);
    if (i >= 0) { store.wrong.splice(i, 1); return false; }
    store.wrong.push(id); return true;
  }
  function toggleFav(id) {
    var i = store.fav.indexOf(id);
    if (i >= 0) { store.fav.splice(i, 1); return false; }
    store.fav.push(id); return true;
  }
  function recordStat(id, ok, val) {
    var s = store.stat[id] || { done: 0, right: 0 };
    s.done++; if (ok) s.right++;
    store.stat[id] = s;
    // 记下这次具体答了什么（val 可能是下标数字，也可能是 multi/blank 的数组）
    if (val !== undefined && val !== null) {
      store.answers[id] = { val: val, ok: !!ok, t: Date.now() };
    }
    save();
  }
  /* 把用户作答还原成可读文本（工具函数；界面已不再回显「上次作答」，保留备用） */
  function answerText(q, val) {
    if (val === null || val === undefined) return "（未作答）";
    if (q.t === "judge") return val === 0 ? "正确" : "错误";
    if (q.t === "single") return LETTERS[val] + ". " + (q.o[val] || "");
    if (q.t === "multi") return (val || []).map(function (i) { return LETTERS[i]; }).join("、") || "（空）";
    return (val || []).map(function (g) { return g[0]; }).join(" / ") || "（空）";
  }

  /* ================= 工具 ================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/\s|　|[，。、；：！？,.!?;:()（）]/g, "").trim();
  }
  function toast(msg, type) {
    var w = $("#toastWrap");
    var d = document.createElement("div");
    d.className = "toast " + (type || "");
    d.textContent = msg;
    w.appendChild(d);
    setTimeout(function () { d.style.opacity = "0"; d.style.transition = ".3s"; }, 1500);
    setTimeout(function () { d.remove(); }, 1850);
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function byId(id) {
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i];
    return null;
  }
  function correctText(q) {
    if (q.t === "judge") return q.a === 0 ? "正确" : "错误";
    if (q.t === "single") return LETTERS[q.a] + ". " + q.o[q.a];
    if (q.t === "multi") return q.a.map(function (i) { return LETTERS[i]; }).join("、");
    return q.a.map(function (g) { return g[0]; }).join(" / ");
  }

  /* ================= 状态 ================= */
  var view = "home";
  var S = {
    list: [],          // 当前题目列表
    pos: 0,
    answers: {},       // id -> {val, ok, checked}
    mode: "practice",
    timeLimit: 0,      // 秒
    remain: 0,
    timer: null,
    startedAt: 0,      // 考试开始时间戳（用于恢复/刷新后继续倒计时）
    submitted: false,  // 考试是否已交卷（未交卷时不揭示任何答案）
    reviewing: false,  // 交卷后是否处于「逐题回顾」浏览状态
    replay: null,      // 非 null 时表示正在回看某条历史考试记录（存该记录的索引）
    title: "首页看板"
  };
  /* 是否允许揭示答案：练习模式随时揭示；考试模式必须交卷后才揭示 */
  function canReveal() { return S.mode !== "exam" || S.submitted; }
  /* 考试中且未交卷：允许反复修改已作答的题目（交卷后才锁定） */
  function canEdit() { return S.mode === "exam" && !S.submitted; }
  var setup = { ch: 0, type: "all", order: "seq", limit: 0 };
  var examSetup = { ch: 0, minutes: 60, ratio: true };   // 题量固定为 EXAM_TOTAL_Q，不再可选
  var browse = { kw: "", ch: 0, type: "all", open: {} };

  /* ================= 渲染入口 ================= */

  /* 题卡是一个自带 overflow-y:auto 的滚动容器，而 render() 会把 #content 整块重建，
     滚动位置必然丢。这里渲染前记下 scrollTop，渲染后还原，切题/答题时题卡不再跳回顶部。 */
  function sideScrollBox() { return $("#examSide .exam-list"); }

  /* 当前题不在可视区时才滚动（键盘上下题、筛选切换时用），已可见则完全不动 */
  function revealCurInSide(box) {
    var cur = box.querySelector(".exam-li.cur");
    if (!cur) return;
    var br = box.getBoundingClientRect(), er = cur.getBoundingClientRect();
    var head = box.querySelector(".exam-side-head");
    var pad = (head ? head.offsetHeight : 0) + 8;   // 分组标题是 sticky 的，别被它盖住
    if (er.top < br.top + pad) box.scrollTop -= (br.top + pad - er.top);
    else if (er.bottom > br.bottom - 8) box.scrollTop += (er.bottom - br.bottom + 8);
  }

  var lastExamPos = -1;   // 上一次渲染时的题号，用来判断这次是不是「切了题」

  function render() {
    var sideBox = sideScrollBox();
    var keepSideTop = sideBox ? sideBox.scrollTop : -1;
    var posChanged = view === "exam" && S.pos !== lastExamPos;
    lastExamPos = view === "exam" ? S.pos : -1;

    $$(".nav-item").forEach(function (a) { a.classList.toggle("active", a.dataset.view === view); });
    $("#viewTitle").textContent = S.title;
    $("#badgeWrong").textContent = store.wrong.length;
    $("#badgeFav").textContent = store.fav.length;
    $("#chipTotal").textContent = "题库 " + ALL.length + " 题";
    var c = $("#content");
    var inExamShell = view === "exam" && S.list.length > 0 && !(S.result && !S.reviewing);
    document.body.classList.toggle("exam-fs", inExamShell);
    if (view === "home") c.innerHTML = viewHome();
    else if (view === "practice") c.innerHTML = S.list.length ? viewQuiz() : viewPracticeSetup();
    else if (view === "exam") c.innerHTML = S.list.length ? ((S.result && !S.reviewing) ? viewExamResult() : viewExamShell()) : viewExamSetup();
    else if (view === "wrong") c.innerHTML = viewList("wrong");
    else if (view === "fav") c.innerHTML = viewList("fav");
    else if (view === "browse") c.innerHTML = viewBrowse();
    else if (view === "records") c.innerHTML = recOpen === null ? viewRecords() : viewRecordDetail(recOpen);
    bindDynamic();

    // 还原题卡滚动位置；只有「切了题」时才把新当前题带进视野（答题、收藏等原地不动）
    if (keepSideTop >= 0) {
      var nb = sideScrollBox();
      if (nb) { nb.scrollTop = keepSideTop; if (posChanged) revealCurInSide(nb); }
    }
  }

  /* ================= 首页 ================= */
  function stats() {
    var done = 0, right = 0, attempted = 0;
    Object.keys(store.stat).forEach(function (k) {
      attempted++;
      done += store.stat[k].done;
      right += store.stat[k].right;
    });
    return { attempted: attempted, done: done, right: right, acc: done ? Math.round(right / done * 100) : 0 };
  }
  function viewHome() {
    var st = stats();
    var typeCount = { judge: 0, single: 0, multi: 0, blank: 0 };
    ALL.forEach(function (q) { typeCount[q.t]++; });
    var max = Math.max.apply(null, Object.keys(typeCount).map(function (k) { return typeCount[k]; }));

    var h = "";
    h += '<div class="grid grid-4" style="margin-bottom:18px">';
    h += '<div class="stat red"><div class="label">题库总量</div><div class="value">' + ALL.length + '</div><div class="sub">共 ' + CHAPTERS.length + ' 章</div></div>';
    h += '<div class="stat blue"><div class="label">已练习</div><div class="value">' + st.attempted + '</div><div class="sub">累计作答 ' + st.done + ' 次</div></div>';
    h += '<div class="stat green"><div class="label">总正确率</div><div class="value">' + st.acc + '%</div><div class="sub">答对 ' + st.right + ' 次</div></div>';
    h += '<div class="stat orange"><div class="label">错题 / 收藏</div><div class="value">' + store.wrong.length + ' <span style="font-size:18px;color:var(--text-3)">/ ' + store.fav.length + '</span></div><div class="sub">点击左侧菜单查看</div></div>';
    h += "</div>";

    h += '<div class="grid grid-2" style="margin-bottom:18px">';
    // 题型分布
    h += '<div class="card card-pad"><div class="section-title">题型分布</div>';
    Object.keys(typeCount).forEach(function (k) {
      h += '<div class="dist-row"><div class="name">' + TYPE_NAME[k] + '</div>';
      h += '<div class="bar"><i style="width:' + (typeCount[k] / max * 100) + '%;background:' + TYPE_COLOR[k] + '"></i></div>';
      h += '<div class="num">' + typeCount[k] + ' 题</div></div>';
    });
    h += "</div>";
    // 快捷入口
    h += '<div class="card card-pad"><div class="section-title">快速开始</div>';
    var hs = store.session;
    if (hs && hs.ids && hs.ids.length) {
      h += '<div class="resume-mini" style="margin-bottom:14px">';
      h += '<div style="font-size:13px;margin-bottom:8px">上次练到 <b>第 ' + (hs.pos + 1) + " / " + hs.ids.length + " 题</b>（" + esc(hs.title || "练习模式") + "，已答 " + sessionDone(hs) + " 题）</div>";
      h += '<button class="btn btn-sm" data-act="resume">继续练习</button> ';
      h += '<button class="btn btn-outline btn-sm" data-act="drop-session">放弃</button>';
      h += "</div>";
    }
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">';
    h += '<button class="btn" data-act="quick" data-arg="all">顺序刷全部</button>';
    h += '<button class="btn btn-outline" data-act="quick" data-arg="rand">随机 50 题</button>';
    h += '<button class="btn btn-outline" data-act="goto" data-arg="exam">进入模拟考试</button>';
    h += "</div>";
    if (store.wrong.length) {
      h += '<button class="btn btn-outline" data-act="redo-wrong" style="width:100%;margin-bottom:10px">重做错题本（' + store.wrong.length + ' 题）</button>';
    }
    if (store.fav.length) {
      h += '<button class="btn btn-outline" data-act="redo-fav" style="width:100%">练习收藏夹（' + store.fav.length + ' 题）</button>';
    }
    h += '<div class="muted" style="font-size:12px;margin-top:14px;line-height:1.8">本平台题库依据《HCIA-AI Solution V1.0 培训教材 / 实验手册》整理，覆盖全部 ' + CHAPTERS.length + ' 章知识点，支持判断题、单选题、多选题、填空题四种题型。</div>';
    h += "</div></div>";

    // 认证考点占比对照
    var RSCALE = 25; // 条形图满格 = 25%
    h += '<div class="card card-pad" style="margin-bottom:18px"><div class="section-title">认证考点占比对照 <span class="muted" style="font-size:12px;font-weight:400">（红条 = 官方笔试占比 · 蓝条 = 本题库占比）</span></div>';
    EXAM_RATIO.forEach(function (it) {
      var ch = null;
      CHAPTERS.forEach(function (c) { if (c.id === it.ch) ch = c; });
      var n = ch ? ch.questions.length : 0;
      var real = n / ALL.length * 100;
      h += '<div class="dist-row ratio-row"><div class="name wide">' + it.ch + ". " + esc(it.name) + "</div>" +
        '<div class="rbars">' +
        '<div class="bar"><i style="width:' + (it.pct / RSCALE * 100) + '%;background:var(--danger)"></i></div>' +
        '<div class="bar"><i style="width:' + (real / RSCALE * 100) + '%;background:var(--info)"></i></div>' +
        "</div>" +
        '<div class="num" style="flex:0 0 118px">考 ' + it.pct + "% · 库 " + real.toFixed(1) + "%</div></div>";
    });
    var ch8 = null;
    CHAPTERS.forEach(function (c) { if (c.id === 8) ch8 = c; });
    if (ch8) {
      var n8 = ch8.questions.length;
      var r8 = n8 / ALL.length * 100;
      h += '<div class="dist-row ratio-row"><div class="name wide" style="color:var(--text-3)">8. 职业素养与组织赋能（无官方占比）</div>' +
        '<div class="rbars"><div class="bar"></div>' +
        '<div class="bar"><i style="width:' + (r8 / RSCALE * 100) + '%;background:var(--info)"></i></div></div>' +
        '<div class="num" style="flex:0 0 118px;color:var(--text-3)">库 ' + r8.toFixed(1) + "%</div></div>";
    }
    h += "</div>";

    // 章节
    h += '<div class="section-title">章节进度</div><div class="grid grid-3">';
    CHAPTERS.forEach(function (ch) {
      var ids = ch.questions.map(function (qq, i) { return qq.uid || (ch.id + "-" + (i + 1)); });
      var att = ids.filter(function (id) { return store.stat[id]; }).length;
      var ok = ids.filter(function (id) { return store.stat[id] && store.stat[id].right > 0; }).length;
      var pct = Math.round(att / ids.length * 100);
      h += '<div class="ch-card" data-act="ch-practice" data-arg="' + ch.id + '">';
      h += "<h4>" + esc(ch.name) + "</h4>";
      h += "<p>" + esc(ch.desc) + "</p>";
      h += '<div class="ch-meta">';
      h += '<span class="tag">' + ch.questions.length + " 题</span>";
      h += '<span class="tag">已练 ' + att + "</span>";
      h += '<span class="tag">掌握 ' + ok + "</span>";
      h += "</div>";
      h += '<div class="progress"><i style="width:' + pct + '%"></i></div>';
      h += "</div>";
    });
    h += "</div>";
    return h;
  }

  /* ================= 练习设置 ================= */
  function chapterOptions(sel) {
    var h = '<option value="0"' + (sel === 0 ? " selected" : "") + ">全部章节（" + ALL.length + " 题）</option>";
    CHAPTERS.forEach(function (ch) {
      h += '<option value="' + ch.id + '"' + (sel === ch.id ? " selected" : "") + ">" + esc(ch.name) + "（" + ch.questions.length + " 题）</option>";
    });
    return h;
  }
  function typeSeg(cur, attr) {
    var items = [["all", "全部题型"], ["judge", "判断题"], ["single", "单选题"], ["multi", "多选题"], ["blank", "填空题"]];
    return '<div class="seg">' + items.map(function (it) {
      return '<button class="seg-item' + (cur === it[0] ? " on" : "") + '" data-' + attr + '="' + it[0] + '">' + it[1] + "</button>";
    }).join("") + "</div>";
  }
  function viewPracticeSetup() {
    var h = "";
    var sd = store.session;
    if (sd && sd.ids && sd.ids.length) {
      var dn = sessionDone(sd);
      var whenTxt = "";
      if (sd.savedAt) {
        var wd = new Date(sd.savedAt);
        whenTxt = " · " + (wd.getMonth() + 1) + "月" + wd.getDate() + "日 " + pad(wd.getHours()) + ":" + pad(wd.getMinutes());
      }
      h += '<div class="card card-pad resume-card" style="max-width:720px">';
      h += '<div class="section-title">继续上次练习</div>';
      h += '<div class="resume-meta">';
      h += '<span class="tag">' + esc(sd.title || "练习模式") + "</span>";
      h += '<span class="muted" style="font-size:13px">进行到第 ' + (sd.pos + 1) + " / " + sd.ids.length + " 题 · 已答 " + dn + " 题" + whenTxt + "</span>";
      h += "</div>";
      h += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">';
      h += '<button class="btn" data-act="resume">继续练习</button>';
      h += '<button class="btn btn-outline" data-act="drop-session">放弃进度</button>';
      h += "</div>";
      h += '<div class="muted" style="font-size:12px;margin-top:10px">进度已保存，刷新页面或换浏览器登录都会回到这里。</div>';
      h += "</div>";
    }
    h += '<div class="card card-pad" style="max-width:720px">';
    h += '<div class="section-title">练习模式设置</div>';
    h += '<div class="field"><label>选择章节</label><select id="selCh">' + chapterOptions(setup.ch) + "</select></div>";
    h += '<div class="field"><label>选择题型</label>' + typeSeg(setup.type, "type") + "</div>";
    h += '<div class="field"><label>答题顺序</label><div class="seg">';
    h += '<button class="seg-item' + (setup.order === "seq" ? " on" : "") + '" data-order="seq">顺序练习</button>';
    h += '<button class="seg-item' + (setup.order === "rand" ? " on" : "") + '" data-order="rand">随机打乱</button></div></div>';
    h += '<div class="field"><label>题量</label><div class="seg">';
    [[0, "全部"], [20, "20 题"], [50, "50 题"], [100, "100 题"]].forEach(function (it) {
      h += '<button class="seg-item' + (setup.limit === it[0] ? " on" : "") + '" data-limit="' + it[0] + '">' + it[1] + "</button>";
    });
    h += "</div></div>";
    h += '<div class="muted" id="cntTip" style="font-size:13px;margin-bottom:16px"></div>';
    h += '<button class="btn btn-lg" data-act="start-practice">开始练习</button>';
    h += "</div>";
    return h;
  }
  function filterQuestions(ch, type) {
    var r = ALL.filter(function (q) {
      if (ch && q.chId !== ch) return false;
      if (type !== "all" && q.t !== type) return false;
      return true;
    });
    return r;
  }

  /* ================= 考试设置 ================= */
  function viewExamSetup() {
    var h = "";
    // 有未交卷的考试 → 提供续考入口（已作答内容和倒计时都已保存）
    var ss = store.session;
    if (ss && ss.mode === "exam" && ss.ids && ss.ids.length) {
      var nd = Object.keys(ss.answers || {}).length;
      var leftMsg = "";
      if (ss.timeLimit && ss.startedAt) {
        var usedExam = Math.floor((Date.now() - ss.startedAt) / 1000);
        leftMsg = "剩余 " + fmtTime(Math.max(0, ss.timeLimit - usedExam));
      }
      h += '<div class="card card-pad resume-card" style="max-width:720px">';
      h += '<div class="section-title">继续上次未完成的考试</div>';
      h += '<div class="resume-meta">';
      h += '<span class="tag">模拟考试</span>';
      h += '<span class="muted" style="font-size:13px">已作答 ' + nd + " / " + ss.ids.length + " 题" +
        (leftMsg ? " · " + leftMsg : "") + "</span>";
      h += "</div>";
      h += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">';
      h += '<button class="btn" data-act="resume">继续这场考试</button>';
      h += '<button class="btn btn-outline" data-act="drop-session">放弃并重新抽卷</button>';
      h += "</div>";
      h += '<div class="muted" style="font-size:12px;margin-top:10px">已作答的答案与倒计时都已保存，刷新或换浏览器登录都会回到这里。</div>';
      h += "</div>";
    }
    h += '<div class="card card-pad" style="max-width:720px">';
    h += '<div class="section-title">模拟考试设置</div>';
    h += '<div class="field"><label>选择章节</label><select id="selCh">' + chapterOptions(examSetup.ch) + "</select></div>";
    h += '<div class="field"><label>题型结构（固定）</label><div class="exam-plan">';
    EXAM_PLAN.forEach(function (p) {
      h += '<div class="ep-row"><span class="qtype ' + p.t + '">' + TYPE_NAME[p.t] + "</span>";
      h += '<span class="ep-num">' + p.n + " 题 × " + p.score + " 分</span>";
      h += '<span class="ep-sum">' + (p.n * p.score) + " 分</span></div>";
    });
    h += '<div class="ep-row ep-total"><span>合计</span><span class="ep-num">' + EXAM_TOTAL_Q +
      ' 题</span><span class="ep-sum">' + EXAM_TOTAL_SCORE + " 分</span></div>";
    h += "</div>";
    h += '<div class="muted" style="font-size:12px;margin-top:8px">满分 ' + EXAM_TOTAL_SCORE +
      " 分，合格线 <b>" + EXAM_PASS_SCORE + "</b> 分</div></div>";
    h += '<div class="field"><label>抽题方式</label><div class="seg">';
    h += '<button class="seg-item' + (examSetup.ratio ? " on" : "") + '" data-ratio="1">按认证考点占比</button>';
    h += '<button class="seg-item' + (!examSetup.ratio ? " on" : "") + '" data-ratio="0">完全随机</button>';
    h += "</div>";
    h += '<div class="muted" style="font-size:12px;margin-top:8px">认证配比：发展趋势 17% · 算力基础 17% · 业务流程 22% · 华为智算 22% · 昇腾方案 6% · 部署与商业 10% · 业界大模型 6%</div></div>';
    h += '<div class="field"><label>考试时长</label><div class="seg">';
    [30, 60, 90, 120].forEach(function (n) {
      h += '<button class="seg-item' + (examSetup.minutes === n ? " on" : "") + '" data-min="' + n + '">' + n + " 分钟</button>";
    });
    h += "</div></div>";
    h += '<div class="muted" id="cntTip" style="font-size:13px;margin-bottom:16px"></div>';
    h += '<button class="btn btn-lg" data-act="start-exam">开始考试</button>';
    h += '<div class="muted" style="font-size:12px;margin-top:14px;line-height:1.8">说明：按上方题型结构随机抽题，答题过程中不显示对错，交卷后统一评分并生成错题。</div>';
    h += "</div>";
    return h;
  }

  /* ================= 答题界面 ================= */
  function viewQuiz() {
    var q = S.list[S.pos];
    var total = S.list.length;
    var isExam = S.mode === "exam";
    var reviewing = isExam && S.submitted;
    var h = "";

    if (reviewing) {
      h += '<div class="review-tip"><span>📖 逐题回顾：下方显示正确答案与解析，可前后翻看。</span>' +
        '<div class="spacer" style="flex:1"></div>' +
        '<button class="btn btn-outline btn-sm" data-act="back-result">返回成绩单</button></div>';
    }

    h += '<div class="quiz-head">';
    h += '<div class="idx"><span>' + (S.pos + 1) + "</span> / " + total + "</div>";
    h += '<span class="qtype ' + q.t + '">' + TYPE_NAME[q.t] + "</span>";
    h += '<span class="tag">' + esc(q.chName) + " · 第 " + q.idx + " 题</span>";
    h += '<div class="spacer"></div>';
    if (isExam && S.timeLimit) {
      h += '<div class="timer" id="timer">' + (reviewing ? "已交卷" : fmtTime(S.remain)) + "</div>";
    }
    h += "</div>";

    h += '<div class="q-body" id="qBody">';
    h += '<div class="q-stem">' + renderStem(q) + "</div>";
    // 不回显「上次作答」：它会直接暴露上一次选了什么、对没对，等于变相泄题
    h += '<div id="optWrap">' + renderOptions(q) + "</div>";
    h += '<div id="fbWrap">' + renderFeedback(q) + "</div>";
    h += "</div>";

    h += '<div class="q-actions">';
    h += '<button class="btn btn-outline" data-act="prev"' + (S.pos === 0 ? " disabled" : "") + ">上一题</button>";
    if (reviewing) {
      h += '<div class="spacer"></div>';
      h += '<button class="btn btn-outline btn-sm" data-act="fav">' + (isFav(q.id) ? "★ 取消收藏" : "☆ 收藏") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="wrongmark">' + (isWrong(q.id) ? "移出错题本" : "加入错题本") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="back-result">退出回顾</button>';
    } else if (S.pos === total - 1) {
      if (isExam) h += '<button class="btn" data-act="submit-exam">交卷</button>';
      else h += '<button class="btn" data-act="finish">完成练习</button>';
    } else {
      h += '<button class="btn" data-act="next">下一题</button>';
      h += '<div class="spacer"></div>';
      h += '<button class="btn btn-outline btn-sm" data-act="fav">' + (isFav(q.id) ? "★ 取消收藏" : "☆ 收藏") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="wrongmark">' + (isWrong(q.id) ? "移出错题本" : "加入错题本") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="quit">退出</button>';
    }
    h += "</div>";

    // 题卡（置于页面最后）
    h += '<div class="sheet"><h5>题卡（点击跳转，' + countDone() + " / " + total + " 已答）</h5>";
    h += '<div class="nav-grid">';
    S.list.forEach(function (item, i) {
      var cls = "nav-cell";
      if (i === S.pos) cls += " cur";
      else if (S.answers[item.id] && canReveal()) cls += S.answers[item.id].ok ? " done" : " err";
      else if (S.answers[item.id]) cls += " done";
      h += '<button class="' + cls + '" data-act="jump" data-arg="' + i + '">' + (i + 1) + "</button>";
    });
    h += "</div></div>";
    return h;
  }

  function renderStem(q) {
    if (q.t !== "blank") return esc(q.q);
    var parts = String(q.q).split("____");
    var h = "";
    parts.forEach(function (p, i) {
      h += esc(p);
      if (i < parts.length - 1) {
        var cur = "";
        var ans = S.answers[q.id];
        if (ans && ans.val && ans.val[i] != null) cur = ans.val[i];
        var lockFill = ((ans && ans.checked) || S.submitted) && !canEdit();
        h += '<input class="fill" type="text" data-fill="' + i + '" value="' + esc(cur) + '"' + (lockFill ? " disabled" : "") + ' autocomplete="off">';
      }
    });
    return h;
  }

  function renderOptions(q, examStyle) {
    var ans = S.answers[q.id];
    var checked = ans && ans.checked;
    var editable = canEdit();          // 考试中未交卷：随时可改答案
    if (q.t === "blank") {
      if (S.submitted && !checked) return '<div class="muted" style="font-size:13px">未作答</div>';
      if (!checked) return '<button class="btn" data-act="submit">确认作答</button>';
      // 已确认但还没交卷 → 输入框仍可改，改完点「重新确认」
      if (editable) {
        return '<div class="ex-edit"><button class="btn btn-outline btn-sm" data-act="submit">重新确认</button>' +
          '<span class="muted" style="font-size:12.5px">交卷前都可以改，改完再点一次确认</span></div>';
      }
      return "";
    }
    var opts = q.t === "judge" ? ["正确", "错误"] : q.o;
    // 注意：val 可能是 0（「正确」/ 选项A），不能直接用真值判断
    var sel = (ans && ans.val !== null && ans.val !== undefined)
      ? (Array.isArray(ans.val) ? ans.val.slice() : [ans.val]) : [];
    var reveal = canReveal();   // 考试未交卷时只标记「已选」，不标对错
    var h = "";
    opts.forEach(function (o, i) {
      var cls = "opt";
      if (checked && !editable) cls += " locked";
      if (sel.indexOf(i) >= 0) cls += " sel";
      if (checked && reveal) {
        var isRight = (q.t === "judge" || q.t === "single") ? (q.a === i) : (q.a.indexOf(i) >= 0);
        if (isRight) cls += " correct";
        else if (sel.indexOf(i) >= 0) cls += " wrong";
      }
      var mark = (examStyle && q.t === "judge")
        ? '<i class="rd"></i>'                                  // 考试界面：判断题用圆形单选按钮
        : '<div class="key">' + LETTERS[i] + "</div>";
      h += '<div class="' + cls + '" data-opt="' + i + '">' + mark + '<div class="txt">' + esc(o) + "</div></div>";
    });
    if (q.t === "multi" && !S.submitted && !checked) {
      h += '<div class="ex-edit" style="margin-top:6px"><button class="btn" data-act="submit">确认作答</button></div>';
    }
    return h;
  }

  function renderFeedback(q) {
    var ans = S.answers[q.id];
    if (!ans || !ans.checked) return "";
    if (!canReveal()) return '<div class="feedback" style="background:var(--surface-2);border-color:var(--border)"><div class="fb-head">✓ 已作答</div><div class="muted" style="font-size:13px">交卷前不判对错，全部答完后交卷即可统一复盘。</div></div>';
    var h = '<div class="feedback ' + (ans.ok ? "ok" : "no") + '">';
    h += '<div class="fb-head">' + (ans.ok ? "✓ 回答正确" : "✗ 回答错误") + "</div>";
    h += '<div class="fb-ans">正确答案：<b>' + esc(correctText(q)) + "</b>";
    if (q.t === "blank") h += '　你的作答：<b>' + esc((ans.val || []).join(" / ") || "（空）") + "</b>";
    h += "</div>";
    if (q.ex) h += '<div class="fb-ex"><b>解析：</b>' + esc(q.ex) + "</div>";
    h += "</div>";
    return h;
  }

  function countDone() {
    return S.list.filter(function (q) { return S.answers[q.id]; }).length;
  }
  function fmtTime(s) {
    var m = Math.floor(s / 60), ss = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (ss < 10 ? "0" : "") + ss;
  }

  /* ================= 判题 ================= */
  function judge(q, val) {
    if (q.t === "judge" || q.t === "single") return q.a === val;
    if (q.t === "multi") {
      if (!val || !val.length) return false;
      var a = val.slice().sort().join(","), b = q.a.slice().sort().join(",");
      return a === b;
    }
    // blank
    for (var i = 0; i < q.a.length; i++) {
      var got = norm(val[i]);
      var okNow = q.a[i].some(function (acc) {
        var t = norm(acc);
        return t === got || (got && t.indexOf(got) >= 0) || (t && got.indexOf(t) >= 0);
      });
      if (!okNow) return false;
    }
    return true;
  }

  /* ================= 模拟考试界面（仿官方在线考试系统） ================= */
  /* 左侧题卡按题型分组，右侧答题区；交卷前不判对错 */
  var examView = { filter: "all", sideOpen: false };

  function examGroups() {          // [{t:"judge", items:[0,1,…]}, …] 按考试题型顺序
    var groups = [], cur = null;
    S.list.forEach(function (q, i) {
      if (!cur || cur.t !== q.t) { cur = { t: q.t, items: [] }; groups.push(cur); }
      cur.items.push(i);
    });
    return groups;
  }
  /* 当前筛选下可导航的题号序列（「只看错题」交卷后才可用） */
  function examNavIdx() {
    var out = [];
    S.list.forEach(function (q, i) {
      if (examView.filter === "wrong" && S.submitted) {
        var a = S.answers[q.id];
        if (a && a.ok) return;                 // 只保留答错 / 未答
      }
      out.push(i);
    });
    return out;
  }
  function examStat() {
    var right = 0, wrong = 0, blank = 0;
    S.list.forEach(function (q) {
      var a = S.answers[q.id];
      if (!a) { blank++; return; }
      if (!S.submitted) return;                // 未交卷不判对错
      if (a.ok) right++; else wrong++;
    });
    return { right: right, wrong: wrong, blank: blank, done: S.list.length - blank };
  }
  function examGo(step) {
    var nav = examNavIdx();
    if (!nav.length) return;
    var at = nav.indexOf(S.pos);
    if (at < 0) { S.pos = nav[0]; }            // 当前题不在筛选结果里 → 跳到第一道
    else {
      var nx = at + step;
      if (nx < 0 || nx >= nav.length) return;
      S.pos = nav[nx];
    }
    saveSession(); render(); window.scrollTo(0, 0);
  }

  function viewExamShell() {
    var q = S.list[S.pos];
    var total = S.list.length;
    var reviewing = S.submitted;
    var r = S.result || null;
    var st = examStat();
    var h = '<div class="exam-shell' + (examView.sideOpen ? " side-open" : "") + '">';

    /* ---- 顶栏 ---- */
    h += '<div class="exam-top"><div class="exam-brand">HCIA-AI Solution V1.0 模拟考试</div>';
    h += '<div class="exam-status">';
    if (reviewing && r) {
      var okPass = r.score >= (r.pass || EXAM_PASS_SCORE);
      h += '<span class="es-tag ' + (okPass ? "ok" : "no") + '">' + (okPass ? "已通过" : "未通过") + "</span>";
      h += '<span class="es-cell">得分：<b>' + r.score + "</b> 分</span>";
    }
    h += '<span class="es-cell">答题用时：<b id="timer">' +
      fmtTime(reviewing && r ? r.used : (S.timeLimit - S.remain)) + "</b></span>";
    h += "</div></div>";

    /* ---- 标签行 ---- */
    h += '<div class="exam-tabs">';
    h += '<div class="exam-tabs-left">';
    h += '<button class="exam-tab' + (examView.filter === "all" ? " on" : "") +
      '" data-act="exam-filter" data-arg="all">全部</button>';
    h += '<button class="exam-tab' + (examView.filter === "wrong" ? " on" : "") + (reviewing ? "" : " dis") +
      '" data-act="exam-filter" data-arg="wrong">只看错题</button>';
    h += "</div>";
    h += '<div class="exam-tabs-right">';
    h += '<button class="btn btn-outline btn-sm exam-side-toggle" data-act="toggle-side">题卡</button>';
    h += '<span class="exam-pos">' + TYPE_NAME[q.t] + "　第 " + (S.pos + 1) + "/" + total + " 题</span>";
    if (reviewing) h += '<button class="btn btn-outline btn-sm" data-act="back-result">成绩单</button>';
    h += '<span class="exam-hint">试试键盘方向键，切换上下题吧</span>';
    h += "</div></div>";

    h += '<div class="exam-main">';

    /* ---- 左：题卡 ---- */
    h += '<aside class="exam-side" id="examSide">';
    h += '<div class="exam-list">';
    examGroups().forEach(function (g) {
      var shown = examView.filter === "wrong" && reviewing
        ? g.items.filter(function (i) { var a = S.answers[S.list[i].id]; return !(a && a.ok); })
        : g.items;
      if (!shown.length) return;
      h += '<div class="exam-side-head">' + TYPE_NAME[g.t] + "<span>" + g.items.length + "题</span></div>";
      shown.forEach(function (i) {
        var item = S.list[i], a = S.answers[item.id];
        var cls = "exam-li";
        if (i === S.pos) cls += " cur";
        h += '<button class="' + cls + '" data-act="jump" data-arg="' + i + '">';
        h += "<span>第" + (i + 1) + "题（" + (SCORE_OF[item.t] || 0) + "分）</span>";
        var dot = "none";
        if (a) dot = reviewing ? (a.ok ? "ok" : "no") : "done";
        h += '<i class="dot ' + dot + '"></i></button>';
      });
    });
    h += "</div>";
    h += '<div class="exam-legend">';
    if (reviewing) {
      h += '<span><i class="dot ok"></i>答对 <b>' + st.right + "</b></span>";
      h += '<span><i class="dot no"></i>答错 <b>' + st.wrong + "</b></span>";
      h += '<span><i class="dot none"></i>未答 <b>' + st.blank + "</b></span>";
    } else {
      h += '<span><i class="dot done"></i>已答 <b>' + st.done + "</b></span>";
      h += '<span><i class="dot none"></i>未答 <b>' + st.blank + "</b></span>";
    }
    h += "</div></aside>";
    h += '<div class="exam-mask" data-act="toggle-side"></div>';

    /* ---- 右：答题区 ---- */
    h += '<section class="exam-body">';
    h += '<div class="exam-stem"><b>' + (S.pos + 1) + "、</b>" + renderStem(q) + "</div>";
    h += '<div id="optWrap" class="exam-opts">' + renderOptions(q, true) + "</div>";
    h += '<div class="exam-actions">';
    var nav = examNavIdx(), at = nav.indexOf(S.pos);
    var hasPrev = at > 0;
    var hasNext = at >= 0 && at < nav.length - 1;
    h += '<button class="btn btn-outline exam-prev" data-act="prev"' + (hasPrev ? "" : " disabled") + ">上一题</button>";
    if (hasNext) h += '<button class="btn exam-next" data-act="next">下一题</button>';
    else if (!reviewing) h += '<button class="btn exam-next" data-act="submit-exam">交卷</button>';
    else h += '<button class="btn btn-outline exam-next" data-act="back-result">返回成绩单</button>';
    h += '<div class="spacer"></div>';
    if (reviewing) {
      h += '<button class="btn btn-outline btn-sm" data-act="fav">' + (isFav(q.id) ? "★ 取消收藏" : "☆ 收藏") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="wrongmark">' + (isWrong(q.id) ? "移出错题本" : "加入错题本") + "</button>";
    } else {
      h += '<button class="btn btn-outline btn-sm" data-act="quit">退出考试</button>';
    }
    h += "</div>";
    h += '<div id="fbWrap">' + renderExamFeedback(q) + "</div>";
    h += "</section>";

    h += "</div></div>";
    return h;
  }

  function renderExamFeedback(q) {
    var a = S.answers[q.id];
    if (!a) return "";
    if (!S.submitted) {
      // 未交卷：不判对错，但把保存下来的作答内容原样回显
      return '<div class="exam-fb neutral"><div class="ef-head"><span class="ef-mark done">✓</span>' +
        (a.checked ? "已作答" : "作答中") + "</div>" +
        '<div class="ef-meta">你的作答：<b>' + esc(ansDisplay(q, a)) + "</b>" +
        (a.checked ? "" : '　<span class="muted">（未确认，交卷时按此内容评分）</span>') + "</div>" +
        '<div class="ef-meta muted">答案已保存，切题或刷新都不会丢失；' +
        (q.t === "blank" ? "可直接改动输入框后再点一次「重新确认」" : "点其他选项即可直接改答案") +
        "，对错在交卷后统一显示。</div></div>";
    }
    var pts = a.ok ? (SCORE_OF[q.t] || 0) : 0;
    var h = '<div class="exam-fb ' + (a.ok ? "ok" : "no") + '">';
    h += '<div class="ef-head"><span class="ef-mark ' + (a.ok ? "ok" : "no") + '">' + (a.ok ? "✓" : "✕") + "</span>" +
      (a.ok ? "恭喜您，答对了！" : "很遗憾，答错了。") + "</div>";
    h += '<div class="ef-meta">我的得分：<b>' + pts + "</b> 分　正确答案：<b>" + esc(correctText(q)) + "</b>";
    if (q.t === "blank") h += '　你的作答：<b>' + esc((a.val || []).join(" / ") || "（空）") + "</b>";
    h += "</div>";
    h += '<div class="ef-ex-title">答案解析</div>';
    h += '<div class="ef-ex">' + (q.ex ? esc(q.ex) : "无") + "</div>";
    h += "</div>";
    return h;
  }

  /* ================= 考试结果 ================= */
  function viewExamResult() {
    var r = S.result;
    var max = r.max || EXAM_TOTAL_SCORE, passLine = r.pass || EXAM_PASS_SCORE;
    var pass = r.score >= passLine;
    var h = '<div class="card card-pad result-hero">';
    h += '<div class="score-circle' + (pass ? "" : " fail") + '"><div class="n">' + r.score + '<small>分</small></div><div class="t">' + (pass ? "通过" : "未通过") + "</div></div>";
    h += "<h2>" + (pass ? "恭喜，本次模拟考试通过！" : "本次未通过，继续加油！") + "</h2>";
    h += '<div class="muted" style="font-size:13px">满分 ' + max + " 分 · 合格线 " + passLine + " 分 · 用时 " + fmtTime(r.used) + " · " + r.date + "</div>";
    h += '<div class="result-stats">';
    h += '<div><div class="v" style="color:var(--text)">' + r.total + '</div><div class="l">总题数</div></div>';
    h += '<div><div class="v" style="color:var(--success)">' + r.right + '</div><div class="l">答对</div></div>';
    h += '<div><div class="v" style="color:var(--danger)">' + r.wrong + '</div><div class="l">答错</div></div>';
    h += '<div><div class="v" style="color:var(--text-3)">' + (r.total - r.right - r.wrong) + '</div><div class="l">未作答</div></div>';
    h += "</div>";
    if (r.byType) {
      h += '<div class="exam-plan" style="margin-top:18px;text-align:left">';
      EXAM_PLAN.forEach(function (p) {
        var b = r.byType[p.t];
        if (!b) return;
        h += '<div class="ep-row"><span class="qtype ' + p.t + '">' + TYPE_NAME[p.t] + "</span>";
        h += '<span class="ep-num">答对 ' + b.right + " / " + b.got + " 题</span>";
        h += '<span class="ep-sum">' + b.score + " / " + b.full + " 分</span></div>";
      });
      h += "</div>";
    }
    h += '<div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">';
    if (S.replay !== null) {
      h += '<button class="btn btn-outline" data-act="rec-back">← 返回记录列表</button>';
      h += '<button class="btn btn-outline" data-act="rec-del" data-arg="' + S.replay + '">删除本条记录</button>';
      if (S.list.length) h += '<button class="btn btn-outline" data-act="rec-redo" data-arg="' + S.replay + '">重做本套题</button>';
    }
    if (S.list.length) h += '<button class="btn" data-act="review">逐题回顾</button>';
    if (r.wrong && S.replay === null) h += '<button class="btn btn-outline" data-act="redo-wrong">重做本次错题</button>';
    if (S.replay === null) h += '<button class="btn btn-outline" data-act="restart-exam">再考一次</button>';
    h += "</div></div>";

    h += '<div class="section-title" style="margin-top:22px">答案速查</div>';
    S.list.forEach(function (q, i) {
      var ans = S.answers[q.id];
      var ok = ans && ans.ok;
      h += '<div class="list-item" style="border-left:4px solid ' + (ok ? "var(--success)" : "var(--danger)") + '">';
      h += '<div class="li-top"><span class="tag">' + (i + 1) + '</span><span class="qtype ' + q.t + '">' + TYPE_NAME[q.t] + "</span>";
      h += '<span class="tag">' + (ok ? "正确" : "错误") + "</span>";
      h += '<span class="tag">' + esc(q.chName) + "</span></div>";
      h += '<div class="li-q">' + esc(q.q.replace(/____/g, "（　）")) + "</div>";
      h += '<div class="li-foot"><span class="muted" style="font-size:13px">正确答案：<b style="color:var(--primary)">' + esc(correctText(q)) + "</b></span>";
      if (!ok && ans) h += '<span class="muted" style="font-size:13px">你的作答：' + esc(ansDisplay(q, ans)) + "</span>";
      h += "</div>";
      if (q.ex) h += '<div class="muted" style="font-size:12.5px;margin-top:8px;line-height:1.8">解析：' + esc(q.ex) + "</div>";
      h += "</div>";
    });
    return h;
  }
  function ansDisplay(q, ans) {
    if (q.t === "blank") return (ans.val || []).join(" / ") || "（空）";
    if (q.t === "judge") return ans.val === 0 ? "正确" : "错误";
    if (q.t === "single") return LETTERS[ans.val];
    return (ans.val || []).map(function (i) { return LETTERS[i]; }).join("、") || "（空）";
  }

  /* ================= 错题本 / 收藏夹 ================= */
  function viewList(kind) {
    var ids = kind === "wrong" ? store.wrong : store.fav;
    var h = '<div class="card card-pad" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
    h += "<div><strong>" + (kind === "wrong" ? "错题本" : "收藏夹") + "</strong>　<span class='muted'>共 " + ids.length + " 题</span></div>";
    h += '<div class="spacer" style="flex:1"></div>';
    if (ids.length) {
      h += '<button class="btn" data-act="redo-' + kind + '">开始重做</button>';
      h += '<button class="btn btn-outline" data-act="clear-' + kind + '">清空</button>';
    }
    h += "</div>";
    if (!ids.length) {
      return h + '<div class="card card-pad empty"><div class="ico">' + (kind === "wrong" ? "🎉" : "⭐") + "</div><p>" + (kind === "wrong" ? "还没有错题，去做几道题吧！" : "还没有收藏的题目") + '</p><button class="btn" data-act="goto" data-arg="practice">去练习</button></div>';
    }
    var list = ids.map(byId).filter(Boolean);
    list.forEach(function (q, i) {
      var st = store.stat[q.id];
      h += '<div class="list-item">';
      h += '<div class="li-top"><span class="tag">' + (i + 1) + '</span><span class="qtype ' + q.t + '">' + TYPE_NAME[q.t] + "</span>";
      h += '<span class="tag">' + esc(q.chName) + "</span>";
      if (st) h += '<span class="tag">练习 ' + st.done + " 次 / 对 " + st.right + " 次</span>";
      h += "</div>";
      h += '<div class="li-q">' + esc(q.q.replace(/____/g, "（　）")) + "</div>";
      h += '<div class="li-foot">';
      h += '<button class="btn btn-outline btn-sm" data-act="show" data-arg="' + q.id + '">查看解析</button>';
      h += '<button class="btn btn-outline btn-sm" data-act="fav-one" data-arg="' + q.id + '">' + (isFav(q.id) ? "取消收藏" : "收藏") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="rm" data-arg="' + kind + "|" + q.id + '">' + (kind === "wrong" ? "移出错题本" : "移除") + "</button>";
      h += "</div>";
      h += '<div id="exp-' + q.id + '" style="display:none;margin-top:10px">';
      h += '<div class="feedback" style="background:var(--surface-2);border-color:var(--border)">';
      h += '<div class="fb-ans">正确答案：<b style="color:var(--primary)">' + esc(correctText(q)) + "</b></div>";
      if (q.t !== "blank") {
        var opts = q.t === "judge" ? ["正确", "错误"] : q.o;
        h += '<div style="margin:8px 0">' + opts.map(function (o, i2) {
          var isR = (q.t === "judge" || q.t === "single") ? q.a === i2 : q.a.indexOf(i2) >= 0;
          return '<div style="font-size:13px;line-height:1.9;' + (isR ? "color:var(--success);font-weight:600" : "") + '">' + LETTERS[i2] + ". " + esc(o) + (isR ? "  ✓" : "") + "</div>";
        }).join("") + "</div>";
      }
      if (q.ex) h += '<div class="fb-ex"><b>解析：</b>' + esc(q.ex) + "</div>";
      h += "</div></div>";
      h += "</div>";
    });
    return h;
  }

  /* ================= 题库浏览 ================= */
  function viewBrowse() {
    var h = '<div class="card card-pad" style="margin-bottom:16px">';
    h += '<div class="search-box"><input type="text" id="kw" placeholder="搜索题干或解析关键词…" value="' + esc(browse.kw) + '">';
    h += '<button class="btn" data-act="search">搜索</button></div>';
    h += '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">';
    h += '<select id="selCh" style="max-width:320px">' + chapterOptions(browse.ch) + "</select>";
    h += typeSeg(browse.type, "btype");
    h += "</div></div>";

    var list = filterQuestions(browse.ch, browse.type);
    if (browse.kw) {
      var k = browse.kw.toLowerCase();
      list = list.filter(function (q) {
        return (q.q + " " + q.ex).toLowerCase().indexOf(k) >= 0;
      });
    }
    h += '<div class="muted" style="margin-bottom:12px;font-size:13px">共匹配 <b>' + list.length + "</b> 题</div>";
    if (!list.length) return h + '<div class="card card-pad empty"><div class="ico">🔍</div><p>没有找到匹配的题目</p></div>';

    list.slice(0, 300).forEach(function (q, i) {
      var open = !!browse.open[q.id];
      h += '<div class="list-item">';
      h += '<div class="li-top"><span class="tag">' + (i + 1) + '</span><span class="qtype ' + q.t + '">' + TYPE_NAME[q.t] + "</span>";
      h += '<span class="tag">' + esc(q.chName) + "</span>";
      if (isWrong(q.id)) h += '<span class="tag" style="color:var(--danger)">错题</span>';
      if (isFav(q.id)) h += '<span class="tag" style="color:var(--warn)">已收藏</span>';
      h += "</div>";
      h += '<div class="li-q">' + esc(q.q.replace(/____/g, "（　）")) + "</div>";
      if (open) {
        h += '<div style="margin-top:10px">';
        if (q.t !== "blank") {
          var opts = q.t === "judge" ? ["正确", "错误"] : q.o;
          h += opts.map(function (o, i2) {
            var isR = (q.t === "judge" || q.t === "single") ? q.a === i2 : q.a.indexOf(i2) >= 0;
            return '<div style="font-size:13.5px;line-height:1.9;' + (isR ? "color:var(--success);font-weight:600" : "color:var(--text-2)") + '">' + LETTERS[i2] + ". " + esc(o) + (isR ? "  ✓" : "") + "</div>";
          }).join("");
        }
        h += '<div class="feedback" style="margin-top:10px;background:var(--surface-2);border-color:var(--border)">';
        h += '<div class="fb-ans">正确答案：<b style="color:var(--primary)">' + esc(correctText(q)) + "</b></div>";
        if (q.ex) h += '<div class="fb-ex"><b>解析：</b>' + esc(q.ex) + "</div>";
        h += "</div></div>";
      }
      h += '<div class="li-foot">';
      h += '<button class="btn btn-outline btn-sm" data-act="bshow" data-arg="' + q.id + '">' + (open ? "收起" : "查看答案") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="fav-one" data-arg="' + q.id + '">' + (isFav(q.id) ? "取消收藏" : "收藏") + "</button>";
      h += '<button class="btn btn-outline btn-sm" data-act="wrong-one" data-arg="' + q.id + '">' + (isWrong(q.id) ? "移出错题" : "标记错题") + "</button>";
      h += "</div></div>";
    });
    if (list.length > 300) h += '<div class="muted" style="text-align:center;padding:12px">仅显示前 300 条，请缩小筛选范围</div>';
    return h;
  }

  /* ================= 考试记录 ================= */
  function viewRecords() {
    if (!store.records.length) recOpen = null;
    var h = '<div class="card card-pad" style="margin-bottom:16px"><div class="section-title" style="margin:0">考试记录</div>';
    h += '<div class="muted" style="font-size:13px">共 ' + store.records.length + " 次模拟考试</div></div>";
    if (!store.records.length) {
      return h + '<div class="card card-pad empty"><div class="ico">📊</div><p>还没有考试记录</p><button class="btn" data-act="goto" data-arg="exam">去考试</button></div>';
    }
    if (store.records.length) {
      var scores = store.records.map(function (r) { return r.score; });
      var avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
      h += '<div class="grid grid-3" style="margin-bottom:16px">';
      h += '<div class="stat blue"><div class="label">平均成绩</div><div class="value">' + avg + '</div><div class="sub">共 ' + store.records.length + " 次 · 满分 " + EXAM_TOTAL_SCORE + "</div></div>";
      h += '<div class="stat green"><div class="label">最高分</div><div class="value">' + Math.max.apply(null, scores) + "</div></div>";
      h += '<div class="stat orange"><div class="label">最低分</div><div class="value">' + Math.min.apply(null, scores) + "</div></div>";
      h += "</div>";
    }
    for (var ri = store.records.length - 1; ri >= 0; ri--) {
      var r = store.records[ri];
      var mx = r.max || EXAM_TOTAL_SCORE, pl = r.pass || EXAM_PASS_SCORE;
      var passed = r.score >= pl;
      var hasSnap = !!(r.ids && r.ids.length);
      h += '<div class="rec-item">';
      h += '<div class="rec-score' + (passed ? "" : " fail") + '">' + r.score + "</div>";
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="font-weight:600">第 ' + (ri + 1) + " 次　" + r.date + "　" + (passed ? "通过" : "未通过") +
        '　<span class="muted" style="font-weight:400;font-size:12.5px">/ ' + mx + " 分（合格线 " + pl + "）</span></div>";
      h += '<div class="muted" style="font-size:12.5px">共 ' + r.total + " 题 · 答对 " + r.right + " · 答错 " + r.wrong +
        " · 用时 " + fmtTime(r.used) + (r.scope ? " · " + esc(r.scope) : "") + "</div>";
      h += "</div>";
      h += '<div class="rec-ops">';
      h += '<button class="btn btn-sm" data-act="rec-detail" data-arg="' + ri + '">查看详情</button>';
      h += '<button class="btn btn-outline btn-sm" data-act="rec-del" data-arg="' + ri + '">删除</button>';
      h += "</div></div>";
      if (!hasSnap) {
        h += '<div class="muted" style="font-size:12px;margin:-4px 0 10px 86px;color:var(--text-3)">' +
          "第 " + (ri + 1) + " 次记录保存于旧版本，只有总分，无法逐题回顾</div>";
      }
    }
    h += '<button class="btn btn-outline" data-act="clear-records" style="margin-top:10px">清空记录</button>';
    return h;
  }

  /* ================= 考试记录 · 详情 =================
     详情页直接读 store.records[i] 渲染，不占用全局答题状态 S，
     因此旧版本记录（没有题目快照）也能正常显示总分信息。 */
  var recOpen = null;   // 当前查看的记录索引，null 表示在列表页

  function viewRecordDetail(i) {
    var r = store.records[i];
    if (!r) { recOpen = null; return viewRecords(); }
    var mx = r.max || EXAM_TOTAL_SCORE, pl = r.pass || EXAM_PASS_SCORE;
    var pass = r.score >= pl;
    var list = (r.ids || []).map(byId).filter(Boolean);
    var hasSnap = list.length > 0;
    var missing = (r.ids || []).length - list.length;

    var h = '<div class="card card-pad" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
    h += '<button class="btn btn-outline btn-sm" data-act="rec-back">← 返回记录列表</button>';
    h += '<div style="font-weight:700;font-size:16px">第 ' + (i + 1) + " 次模拟考试</div>";
    h += '<div class="muted" style="font-size:13px">' + r.date + (r.scope ? " · " + esc(r.scope) : "") + "</div>";
    h += "</div>";

    h += '<div class="card card-pad result-hero">';
    h += '<div class="score-circle' + (pass ? "" : " fail") + '"><div class="n">' + r.score +
      '<small>分</small></div><div class="t">' + (pass ? "通过" : "未通过") + "</div></div>";
    h += "<h2>" + (pass ? "本次模拟考试通过" : "本次未通过") + "</h2>";
    h += '<div class="muted" style="font-size:13px">满分 ' + mx + " 分 · 合格线 " + pl + " 分 · 用时 " +
      fmtTime(r.used) + "</div>";
    h += '<div class="result-stats">';
    h += '<div><div class="v" style="color:var(--text)">' + r.total + '</div><div class="l">总题数</div></div>';
    h += '<div><div class="v" style="color:var(--success)">' + r.right + '</div><div class="l">答对</div></div>';
    h += '<div><div class="v" style="color:var(--danger)">' + r.wrong + '</div><div class="l">答错</div></div>';
    h += '<div><div class="v" style="color:var(--text-3)">' + (r.total - r.right - r.wrong) + '</div><div class="l">未作答</div></div>';
    h += "</div>";
    if (r.byType) {
      h += '<div class="exam-plan" style="margin-top:18px;text-align:left">';
      EXAM_PLAN.forEach(function (p) {
        var b = r.byType[p.t];
        if (!b) return;
        h += '<div class="ep-row"><span class="qtype ' + p.t + '">' + TYPE_NAME[p.t] + "</span>";
        h += '<span class="ep-num">答对 ' + b.right + " / " + b.got + " 题</span>";
        h += '<span class="ep-sum">' + b.score + " / " + b.full + " 分</span></div>";
      });
      h += '<div class="ep-row ep-total"><span>合计</span>';
      h += '<span class="ep-num">答对 ' + r.right + " / " + r.total + " 题</span>";
      h += '<span class="ep-sum">' + r.score + " / " + mx + " 分</span></div>";
      h += "</div>";
    }
    h += '<div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">';
    if (hasSnap) {
      h += '<button class="btn" data-act="replay-review" data-arg="' + i + '">逐题回顾</button>';
      h += '<button class="btn btn-outline" data-act="rec-redo" data-arg="' + i + '">重做本套题</button>';
    }
    h += '<button class="btn btn-outline" data-act="rec-del" data-arg="' + i + '">删除本条记录</button>';
    h += "</div></div>";

    if (!hasSnap) {
      h += '<div class="card card-pad empty"><div class="ico">🗂️</div><p>这条记录保存于旧版本，只留有总分信息，没有题目快照</p></div>';
      return h;
    }
    if (missing) {
      h += '<div class="muted" style="font-size:13px;margin:14px 0 0">其中 ' + missing + " 道题已从题库中移除，下方不再列出</div>";
    }

    h += '<div class="section-title" style="margin-top:22px">答案速查</div>';
    list.forEach(function (q, n) {
      var ans = (r.answers || {})[q.id];
      var ok = ans && ans.ok;
      h += '<div class="list-item" style="border-left:4px solid ' + (ok ? "var(--success)" : "var(--danger)") + '">';
      h += '<div class="li-top"><span class="tag">' + (n + 1) + '</span><span class="qtype ' + q.t + '">' + TYPE_NAME[q.t] + "</span>";
      h += '<span class="tag">' + (ok ? "正确" : "错误") + "</span>";
      h += '<span class="tag">' + esc(q.chName) + "</span></div>";
      h += '<div class="li-q">' + esc(q.q.replace(/____/g, "（　）")) + "</div>";
      h += '<div class="li-foot"><span class="muted" style="font-size:13px">正确答案：<b style="color:var(--primary)">' + esc(correctText(q)) + "</b></span>";
      if (ans) h += '<span class="muted" style="font-size:13px">你的作答：' + esc(ansDisplay(q, ans)) + "</span>";
      else h += '<span class="muted" style="font-size:13px">你的作答：<b style="color:var(--text-3)">未作答</b></span>';
      h += "</div>";
      if (q.ex) h += '<div class="muted" style="font-size:12.5px;margin-top:8px;line-height:1.8">解析：' + esc(q.ex) + "</div>";
      h += "</div>";
    });
    return h;
  }

  /* ================= 事件绑定 ================= */
  function bindDynamic() {
    // 章节选择
    var sel = $("#selCh");
    if (sel) {
      sel.onchange = function () {
        var v = parseInt(this.value, 10);
        if (view === "exam") examSetup.ch = v;
        else if (view === "browse") { browse.ch = v; render(); }
        else setup.ch = v;
        updateTip();
      };
      updateTip();
    }
    // 分段选择
    $$("[data-type]").forEach(function (b) {
      b.onclick = function () { setup.type = this.dataset.type; render(); };
    });
    $$("[data-btype]").forEach(function (b) {
      b.onclick = function () { browse.type = this.dataset.btype; render(); };
    });
    $$("[data-order]").forEach(function (b) {
      b.onclick = function () { setup.order = this.dataset.order; render(); };
    });
    $$("[data-limit]").forEach(function (b) {
      b.onclick = function () { setup.limit = parseInt(this.dataset.limit, 10); render(); };
    });
    $$("[data-min]").forEach(function (b) {
      b.onclick = function () { examSetup.minutes = parseInt(this.dataset.min, 10); render(); };
    });
    $$("[data-ratio]").forEach(function (b) {
      b.onclick = function () { examSetup.ratio = this.dataset.ratio === "1"; render(); };
    });
    // 选项
    $$("[data-opt]").forEach(function (el) {
      el.onclick = function () {
        var q = S.list[S.pos];
        var ans = S.answers[q.id];
        if (S.submitted) return;                 // 已交卷，回顾时不可再作答
        if (ans && ans.checked && !canEdit()) return;   // 考试中未交卷可改答案
        var i = parseInt(this.dataset.opt, 10);
        if (q.t === "multi") {
          var cur = (ans && ans.val) ? ans.val.slice() : [];
          var p = cur.indexOf(i);
          if (p >= 0) cur.splice(p, 1); else cur.push(i);
          if (!cur.length) delete S.answers[q.id];   // 全部取消视为未作答
          else {
            var keep = !!(ans && ans.checked) && canEdit();   // 考试中改已确认的多选 → 立即生效
            var rec = { val: cur, checked: keep };
            if (keep) {
              rec.ok = judge(q, cur);
              store.answers[q.id] = { val: cur.slice(), ok: !!rec.ok, t: Date.now() };  // 只更新留档，不重复计数
              save();
            }
            S.answers[q.id] = rec;
          }
          saveSession();
          render();
        } else {
          submitAnswer(i);
        }
      };
    });
    // 填空题输入同步
    $$("[data-fill]").forEach(function (el) {
      el.oninput = function () {
        var q = S.list[S.pos];
        if (S.submitted) return;
        var ans = S.answers[q.id] || { val: [], checked: false };
        if (ans.checked && !canEdit()) return;   // 考试中未交卷可改答案
        ans.val = ans.val || [];
        ans.val[parseInt(this.dataset.fill, 10)] = this.value;
        if (ans.val.every(function (x) { return !String(x || "").trim(); })) delete S.answers[q.id];
        else S.answers[q.id] = ans;
        saveSession();
      };
    });
    // 通用动作
    $$("[data-act]").forEach(function (el) {
      el.onclick = function () { action(this.dataset.act, this.dataset.arg); };
    });
    // 搜索框回车
    var kw = $("#kw");
    if (kw) kw.onkeydown = function (e) { if (e.key === "Enter") { browse.kw = this.value; render(); } };
  }

  function updateTip() {
    var el = $("#cntTip");
    if (!el) return;
    if (view === "exam") {
      var n = filterQuestions(examSetup.ch, "all").length;
      var scope = examSetup.ch ? "第 " + examSetup.ch + " 章" : "全部章节";
      var lack = EXAM_PLAN.filter(function (p) { return filterQuestions(examSetup.ch, p.t).length < p.n; });
      el.textContent = scope + "共 " + n + " 题。本次考试固定 " + EXAM_TOTAL_Q + " 题 / 满分 " +
        EXAM_TOTAL_SCORE + " 分 / " + EXAM_PASS_SCORE + " 分合格，时长 " + examSetup.minutes + " 分钟。" +
        (lack.length ? "（该范围" + lack.map(function (p) { return TYPE_NAME[p.t]; }).join("、") +
          "题量不足，将自动从全库补足）" : "");
    } else if (view === "practice") {
      var m = filterQuestions(setup.ch, setup.type).length;
      var realN = setup.limit ? Math.min(setup.limit, m) : m;
      el.textContent = "当前条件下共 " + m + " 题，将练习 " + realN + " 题。";
    }
  }

  /* ================= 动作分发 ================= */
  function action(act, arg) {
    var q = S.list[S.pos];
    switch (act) {
      case "goto":
        S.list = []; S.result = null; stopTimer();
        view = arg; S.title = navTitle(arg); render(); window.scrollTo(0, 0); break;
      case "ch-practice":
        setup.ch = parseInt(arg, 10); setup.type = "all";
        startPractice(); break;
      case "quick":
        setup.ch = 0; setup.type = "all";
        if (arg === "rand") { setup.order = "rand"; setup.limit = 50; }
        else { setup.order = "seq"; setup.limit = 0; }
        startPractice(); break;
      case "redo-wrong":
        startList(store.wrong.slice(), "错题重做"); break;
      case "redo-fav":
        startList(store.fav.slice(), "收藏练习"); break;
      case "start-practice": startPractice(); break;
      case "start-exam": startExam(); break;
      case "submit": submitAnswer(null); break;
      case "jump": S.pos = parseInt(arg, 10); saveSession(); examView.sideOpen = false; render(); window.scrollTo(0, 0); break;
      case "prev": if (view === "exam" && S.list.length) { examGo(-1); break; } if (S.pos > 0) { S.pos--; saveSession(); render(); window.scrollTo(0, 0); } break;
      case "next": if (view === "exam" && S.list.length) { examGo(1); break; } if (S.pos < S.list.length - 1) { S.pos++; saveSession(); render(); window.scrollTo(0, 0); } break;
      case "exam-filter":
        if (arg === "wrong" && !S.submitted) { toast("交卷后才能只看错题", "err"); break; }
        examView.filter = arg;
        if (examNavIdx().indexOf(S.pos) < 0) { var nav0 = examNavIdx(); if (nav0.length) S.pos = nav0[0]; }
        render(); window.scrollTo(0, 0); break;
      case "toggle-side": examView.sideOpen = !examView.sideOpen; render(); break;
      case "finish":
        var d = countDone();
        toast("本轮练习完成，已作答 " + d + " / " + S.list.length + " 题", "ok");
        clearSession();
        S.list = []; S.submitted = false; S.reviewing = false; S.replay = null; view = "home"; S.title = "首页看板"; render(); window.scrollTo(0, 0); break;
      case "resume":
        if (restoreSession()) {
          view = S.mode === "exam" ? "exam" : "practice";
          if (S.mode === "exam") startTimer();
          render(); window.scrollTo(0, 0);
        }
        else { clearSession(); toast("没有可继续的进度", "err"); render(); }
        break;
      case "drop-session":
        if (confirm("放弃上次未完成的进度？")) { clearSession(); render(); toast("已放弃上次进度"); }
        break;
      case "quit": {
        // 退出不清存档：练习可续练，考试可从设置页「继续上次未完成的考试」接着答
        stopTimer();
        var back = S.mode === "exam" ? "exam" : "practice";
        S.list = []; S.result = null; S.submitted = false; S.reviewing = false; S.replay = null;
        S.mode = "practice"; S.startedAt = 0;
        view = back; S.title = navTitle(view); render(); window.scrollTo(0, 0); break;
      }
      case "fav":
        if (!q) break;
        toast(toggleFav(q.id) ? "已收藏" : "已取消收藏", "ok"); save(); render(); break;
      case "fav-one":
        toast(toggleFav(arg) ? "已收藏" : "已取消收藏", "ok"); save(); render(); break;
      case "wrongmark":
        if (!q) break;
        toast(toggleWrong(q.id) ? "已加入错题本" : "已移出错题本", "ok"); save(); render(); break;
      case "wrong-one":
        toast(toggleWrong(arg) ? "已标记错题" : "已取消标记", "ok"); save(); render(); break;
      case "show": {
        var e = $("#exp-" + arg); if (e) e.style.display = e.style.display === "none" ? "block" : "none"; break;
      }
      case "bshow": browse.open[arg] = !browse.open[arg]; render(); break;
      case "rm": {
        var p = arg.split("|");
        if (p[0] === "wrong") { store.wrong = store.wrong.filter(function (x) { return x !== p[1]; }); }
        else { store.fav = store.fav.filter(function (x) { return x !== p[1]; }); }
        save(); render(); toast("已移除"); break;
      }
      case "clear-wrong": store.wrong = []; save(); render(); toast("错题本已清空"); break;
      case "clear-fav": store.fav = []; save(); render(); toast("收藏夹已清空"); break;
      case "rec-detail":
        recOpen = parseInt(arg, 10);
        S.title = "第 " + (parseInt(arg, 10) + 1) + " 次考试详情";
        render(); window.scrollTo(0, 0); break;
      case "replay-review": openRecord(parseInt(arg, 10), true); break;
      case "rec-del": {
        var di = parseInt(arg, 10);
        if (!store.records[di]) break;
        if (!confirm("删除第 " + (di + 1) + " 次考试记录？")) break;
        store.records.splice(di, 1);
        S.replay = null; recOpen = null;
        save(); S.title = navTitle("records"); render(); toast("已删除该条记录", "ok"); break;
      }
      case "rec-back":
        recOpen = null; S.replay = null; stopTimer();
        S.list = []; S.result = null; S.submitted = false; S.reviewing = false; S.mode = "practice";
        view = "records"; S.title = navTitle(view); render(); window.scrollTo(0, 0); break;
      case "rec-redo": S.replay = null; recOpen = null; redoRecord(parseInt(arg, 10)); break;
      case "clear-records":
        if (!store.records.length) break;
        if (!confirm("清空全部 " + store.records.length + " 条考试记录？")) break;
        store.records = []; S.replay = null; save(); render(); toast("记录已清空"); break;
      case "search": browse.kw = ($("#kw") || {}).value || ""; render(); break;
      case "submit-exam": finishExam(); break;
      case "restart-exam": stopTimer(); clearSession(); S.startedAt = 0;
        S.list = []; S.result = null; S.submitted = false; S.reviewing = false; render(); window.scrollTo(0, 0); break;
      case "review":
        if (!S.list.length) { toast("旧版本记录没有题目快照，无法逐题回顾", "err"); break; }
        S.reviewing = true; render(); window.scrollTo(0, 0); break;
      case "back-result": S.reviewing = false; render(); window.scrollTo(0, 0); break;
    }
  }

  function navTitle(v) {
    return { home: "首页看板", practice: "练习模式", exam: "模拟考试", wrong: "错题本", fav: "收藏夹", browse: "题库浏览", records: "考试记录" }[v] || "首页看板";
  }

  /* ================= 流程控制 ================= */
  function startPractice() {
    var list = filterQuestions(setup.ch, setup.type);
    if (!list.length) { toast("当前条件下没有题目", "err"); return; }
    if (setup.order === "rand") list = shuffle(list);
    if (setup.limit) list = list.slice(0, setup.limit);
    startList(list.map(function (q) { return q.id; }), "练习模式");
  }
  function startList(ids, title) {
    if (!ids.length) { toast("没有可练习的题目", "err"); return; }
    S.mode = "practice";
    S.list = ids.map(byId).filter(Boolean);
    S.pos = 0; S.answers = {}; S.result = null; S.timeLimit = 0;
    S.submitted = false; S.reviewing = false; S.replay = null;
    S.title = title; view = "practice";
    saveSession();
    render(); window.scrollTo(0, 0);
  }
  /* 回看某条历史考试记录：用记录里存的 ids + answers 快照把当时那场考试还原出来，
     之后走的还是现有的「成绩单 → 逐题回顾」链路 */
  function openRecord(i, reviewNow) {
    var r = store.records[i];
    if (!r) return;
    if (!r.ids || !r.ids.length) { toast("旧版本记录没有题目快照，无法逐题回顾", "err"); return; }
    stopTimer();
    S.mode = "exam";
    S.list = r.ids.map(byId).filter(Boolean);
    S.pos = 0;
    S.answers = {};
    r.ids.forEach(function (id) {
      var a = (r.answers || {})[id];
      if (!a) return;
      S.answers[id] = { val: Array.isArray(a.val) ? a.val.slice() : a.val, ok: !!a.ok, checked: true };
    });
    S.submitted = true;                     // 回看即视为已交卷：不计时、不可改答案、允许揭示答案
    S.reviewing = !!reviewNow;              // 详情页进来直接逐题回顾，否则先落到成绩单
    S.result = r;
    S.replay = i;
    S.timeLimit = 0; S.remain = 0; S.startedAt = 0;
    S.title = "第 " + (i + 1) + " 次考试 · " + r.date;
    view = "exam";
    examView.filter = "all"; examView.sideOpen = false;
    render(); window.scrollTo(0, 0);
    if (S.list.length !== r.ids.length) {
      toast("有 " + (r.ids.length - S.list.length) + " 道题已不在题库中", "err");
    }
  }
  /* 用历史记录里那套题重练一遍（不计入考试记录） */
  function redoRecord(i) {
    var r = store.records[i];
    if (!r || !r.ids || !r.ids.length) { toast("这条记录没有题目快照", "err"); return; }
    S.replay = null;
    startList(r.ids.slice(), "重做 · 第 " + (i + 1) + " 次考试");
  }
  /* 按题型抽 n 道题：
     - 全章节 + 占比模式：先按官方章节占比把 n 分配到各章，再各章内按题型取
     - 否则：直接在指定范围（或全库）内按题型取
     任一步不足时用全库同题型补齐，保证题量严格等于 n */
  function pickExamByType(type, n) {
    var got = [], used = {};
    // 必须先剔除已选题再切片，否则 slice 到已选题会被静默丢弃，导致实际题量不足
    function take(arr, k) {
      var room = n - got.length;
      if (room <= 0) return;
      arr.filter(function (q) { return !used[q.id]; })
        .slice(0, Math.min(k, room))
        .forEach(function (q) { used[q.id] = 1; got.push(q); });
    }
    if (examSetup.ratio && !examSetup.ch) {
      // 第 8 章无官方占比，不参与配比抽卷
      var quotas = ratioQuotas(n, type);
      EXAM_RATIO.forEach(function (it, i) {
        if (quotas[i] > 0) take(shuffle(filterQuestions(it.ch, type)), quotas[i]);
      });
    } else {
      take(shuffle(filterQuestions(examSetup.ch, type)), n);
    }
    if (got.length < n) take(shuffle(ALL.filter(function (q) { return q.t === type; })), n - got.length);
    return got;
  }

  function startExam() {
    var list = [];
    EXAM_PLAN.forEach(function (p) { list = list.concat(pickExamByType(p.t, p.n)); });
    // 按考试题型顺序排列（判断→单选→多选→填空），与左侧题卡分组一致；
    // 每种题型内部抽样时已随机，故不再整体打乱顺序
    if (!list.length) { toast("题库为空", "err"); return; }
    S.mode = "exam";
    S.list = list; S.pos = 0; S.answers = {}; S.result = null;
    S.submitted = false; S.reviewing = false; S.replay = null;
    examView.filter = "all"; examView.sideOpen = false;
    S.timeLimit = examSetup.minutes * 60; S.remain = S.timeLimit;
    S.startedAt = Date.now();
    S.title = "模拟考试"; view = "exam";
    saveSession();
    render(); window.scrollTo(0, 0);
    startTimer();
  }

  /* 按占比把 total 道题分配到各章（大数优先补余数，保证总数精确） */
  function ratioQuotas(total, type) {
    var scope = type || "all";   // 传入题型时，只按该题型在章节内的可用量分配
    var q = EXAM_RATIO.map(function (it) { return Math.floor(total * it.pct / 100); });
    var rest = total - q.reduce(function (a, b) { return a + b; }, 0);
    var order = EXAM_RATIO.map(function (it, i) {
      return { i: i, r: (total * it.pct / 100) % 1 };
    }).sort(function (a, b) { return b.r - a.r; });
    for (var k = 0; k < rest; k++) q[order[k % order.length].i]++;
    // 某章题不够时，把差额挪给题量富余的章节
    EXAM_RATIO.forEach(function (it, i) {
      var avail = filterQuestions(it.ch, scope).length;
      if (q[i] > avail) {
        var surplus = q[i] - avail;
        q[i] = avail;
        for (var j = 0; j < EXAM_RATIO.length && surplus > 0; j++) {
          if (j === i) continue;
          var cap = filterQuestions(EXAM_RATIO[j].ch, scope).length;
          var add = Math.min(surplus, Math.max(0, cap - q[j]));
          q[j] += add; surplus -= add;
        }
      }
    });
    return q;
  }
  function startTimer() {
    stopTimer();
    S.timer = setInterval(function () {
      S.remain--;
      var t = $("#timer");
      if (t) {
        t.textContent = fmtTime(S.remain);
        if (S.remain <= 60) t.classList.add("warn");
      }
      if (S.remain <= 0) { stopTimer(); toast("考试时间到，自动交卷", "err"); finishExam(); }
    }, 1000);
  }
  function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  function submitAnswer(val) {
    if (S.submitted) return;
    var q = S.list[S.pos];
    var ans = S.answers[q.id] || { val: null, checked: false };
    var editing = !!(ans.checked && canEdit());   // 考试中修改已作答的题
    if (ans.checked && !editing) return;
    if (q.t === "blank") {
      var inputs = $$("[data-fill]");
      var arr = inputs.map(function (i) { return i.value.trim(); });
      if (arr.every(function (x) { return !x; })) { toast("请先填写答案", "err"); return; }
      ans.val = arr;
    } else if (val !== null) {
      ans.val = val;
    }
    if (ans.val === null || ans.val === undefined) { toast("请先作答", "err"); return; }
    ans.ok = judge(q, ans.val);
    ans.checked = true;
    S.answers[q.id] = ans;
    if (editing) {
      // 只是改答案：更新留档与会话，不重复计入练习统计（交卷时统一结算）
      if (ans.val !== null && ans.val !== undefined) {
        store.answers[q.id] = {
          val: Array.isArray(ans.val) ? ans.val.slice() : ans.val,
          ok: !!ans.ok, t: Date.now()
        };
      }
      save(); saveSession(); render();
      return;
    }
    recordStat(q.id, ans.ok, Array.isArray(ans.val) ? ans.val.slice() : ans.val);
    if (!ans.ok) { if (!isWrong(q.id)) { store.wrong.push(q.id); save(); } }
    saveSession();
    render();
  }

  function finishExam() {
    stopTimer();
    S.submitted = true; S.reviewing = false;   // 交卷后才允许揭示答案
    clearSession();                            // 考试已结束，不再需要续答会话
    examView.filter = "all";
    var right = 0, wrong = 0, score = 0;
    var byType = {};
    EXAM_PLAN.forEach(function (p) {
      byType[p.t] = { n: p.n, got: 0, right: 0, score: 0, full: p.n * p.score, per: p.score };
    });
    S.list.forEach(function (q) {
      var a = S.answers[q.id];
      if (!a) return;
      a.ok = judge(q, a.val);
      a.checked = true;
      recordStat(q.id, a.ok, Array.isArray(a.val) ? a.val.slice() : a.val);
      var b = byType[q.t], pts = SCORE_OF[q.t] || 0;
      if (b) b.got++;
      if (a.ok) {
        right++; score += pts;
        if (b) { b.right++; b.score += pts; }
        var i = store.wrong.indexOf(q.id); if (i >= 0) store.wrong.splice(i, 1);
      } else { wrong++; if (store.wrong.indexOf(q.id) < 0) store.wrong.push(q.id); }
    });
    save();
    var total = S.list.length;
    var d = new Date();
    var date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    S.result = {
      score: score, max: EXAM_TOTAL_SCORE, pass: EXAM_PASS_SCORE, byType: byType,
      right: right, wrong: wrong, total: total,
      used: S.timeLimit - S.remain, date: date,
      /* ids + answers 是「这套卷子的快照」：有了它，事后再点开这条记录仍能还原
         逐题回顾与答案速查。题库增删题不影响，因为 id 是题库里固化的永久 uid。 */
      ids: S.list.map(function (q) { return q.id; }),
      answers: snapshotAnswers(S.list),
      scope: examSetup.ch ? "第 " + examSetup.ch + " 章" : "全部章节"
    };
    store.records.push(S.result);
    save();
    render(); window.scrollTo(0, 0);
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  /* 把本场考试的作答复制一份存进记录（不能直接引用 S.answers，下次考试会覆盖它） */
  function snapshotAnswers(list) {
    var out = {};
    list.forEach(function (q) {
      var a = S.answers[q.id];
      if (!a) return;
      out[q.id] = { val: Array.isArray(a.val) ? a.val.slice() : a.val, ok: !!a.ok };
    });
    return out;
  }

  /* ================= 导航 & 主题 ================= */
  $$(".nav-item").forEach(function (a) {
    a.onclick = function () {
      stopTimer();
      S.list = []; S.result = null;
      S.submitted = false; S.reviewing = false; S.replay = null; recOpen = null;
      examView.filter = "all"; examView.sideOpen = false;
      view = this.dataset.view;
      S.title = this.textContent.replace(/\d+$/, "").trim() || navTitle(view);
      S.title = navTitle(view);
      render(); window.scrollTo(0, 0);
      closeSidebar();
    };
  });
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    var ov = $("#overlay");
    if (ov) ov.classList.remove("show");
  }
  $("#btnMenu").onclick = function () {
    $("#sidebar").classList.toggle("open");
    var ov = $("#overlay");
    if (ov) ov.classList.toggle("show");
  };
  $("#overlay").onclick = closeSidebar;
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("#themeIcon").textContent = t === "dark" ? "☀️" : "🌙";
    $("#themeText").textContent = t === "dark" ? "日间模式" : "夜间模式";
    store.theme = t; save();
  }
  $("#btnTheme").onclick = function () {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  };
  $("#btnReset").onclick = function () {
    if (!confirm("确定要清空全部学习记录（练习进度、答题内容、错题本、收藏、考试记录）吗？此操作不可恢复。")) return;
    store.stat = {}; store.answers = {}; store.wrong = []; store.fav = []; store.records = [];
    store.session = null;
    save(); S.list = []; S.result = null; render(); toast("学习记录已清空");
  };
  document.addEventListener("keydown", function (e) {
    if (!S.list.length) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    var q = S.list[S.pos];
    if (q && (q.t === "judge" || q.t === "single")) {
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= (q.t === "judge" ? 2 : q.o.length)) { submitAnswer(n - 1); return; }
    }
    var isExamShell = view === "exam" && S.list.length > 0;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Enter") {
      if (isExamShell) { e.preventDefault(); examGo(1); return; }
      if (S.pos < S.list.length - 1) { S.pos++; saveSession(); render(); }
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      if (isExamShell) { e.preventDefault(); examGo(-1); return; }
      if (S.pos > 0) { S.pos--; saveSession(); render(); }
    }
  });

  /* ================= 启动 ================= */
  applyTheme(store.theme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  // 有未完成的会话则自动恢复（练习接上次题目；考试连已作答内容和倒计时一起续上）
  var resumed = false;
  try { resumed = restoreSession(); } catch (e) { resumed = false; }
  if (resumed) view = S.mode === "exam" ? "exam" : "practice";
  render();
  if (resumed) {
    if (S.mode === "exam") startTimer();
    var rn = Object.keys(S.answers).length;
    toast(S.mode === "exam"
      ? "已恢复未完成的考试：已答 " + rn + " / " + S.list.length + " 题"
      : "已恢复上次练习进度：第 " + (S.pos + 1) + " / " + S.list.length + " 题", "ok");
  }

  /* 暴露给 auth.js（云端同步用） */
  window.HCIA_APP = {
    store: store,
    save: save,
    render: render,
    toast: toast,
    applyTheme: applyTheme,
    progress: function () {
      return {
        done: Object.keys(store.stat).length,
        wrong: store.wrong.length,
        fav: store.fav.length,
        records: store.records.length
      };
    },
    currentList: function () { return S.list; },
    migrateRecord: migrateRecord,
    examPlan: function () { return EXAM_PLAN; },
    examMeta: function () { return { total: EXAM_TOTAL_Q, max: EXAM_TOTAL_SCORE, pass: EXAM_PASS_SCORE }; },
    restoreSession: restoreSession,
    clearSession: clearSession,
    getView: function () { return view; },
    setView: function (v) { view = v; }
  };
  if (window.HCIA_AUTH && window.HCIA_AUTH.boot) window.HCIA_AUTH.boot();
})();
