/* ============================================================
 * 账号体系与云端进度同步
 * 依赖 server.js（SQLite 后端）。连不上服务器时自动降级为纯本地模式。
 * ============================================================ */
(function () {
  "use strict";

  var SAVED = localStorage.getItem("hcia_server");
  var BASE = SAVED || (location.protocol === "file:" ? "http://127.0.0.1:8787" : "");
  var user = null;
  var offline = false;
  var syncState = "idle";   // idle | syncing | saved | error | offline
  var lastSync = "";
  var dirtyTimer = null;
  var booted = false;

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "include";
    opts.headers = { "Content-Type": "application/json" };
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
    try {
      return fetch(BASE + path, opts).then(function (r) {
        return r.json().catch(function () { return { ok: false, msg: "服务端返回异常" }; });
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }
  function store() { return window.HCIA_APP ? window.HCIA_APP.store : null; }
  function toast(m, t) { if (window.HCIA_APP) window.HCIA_APP.toast(m, t); }

  /* ---------------- 顶栏用户区 ---------------- */
  function renderUser() {
    var box = document.getElementById("userBox");
    if (!box) return;
    if (offline) {
      box.innerHTML = '<button class="auth-btn muted" id="authEntry" title="未连接到服务端，数据仅保存在本机浏览器">离线模式</button>';
      document.getElementById("authEntry").onclick = function () { showModal(); };
      return;
    }
    if (!user) {
      box.innerHTML = '<button class="auth-btn" id="authEntry">登录 / 注册</button>';
      document.getElementById("authEntry").onclick = function () { showModal(); };
      return;
    }
    var dotCls = syncState === "syncing" ? "dot syncing" : (syncState === "error" ? "dot err" : (syncState === "saved" ? "dot ok" : "dot"));
    var txt = syncState === "syncing" ? "保存中…" : (syncState === "error" ? "同步失败" : (lastSync ? "已同步 " + lastSync : "云端已连接"));
    box.innerHTML =
      '<button class="auth-user" id="authEntry">' +
      '<span class="ava">' + esc(user.username.slice(0, 1).toUpperCase()) + "</span>" +
      '<span class="nm">' + esc(user.username) + "</span>" +
      '<span class="' + dotCls + '" title="' + esc(txt) + '"></span>' +
      "</button>" +
      '<div class="auth-menu" id="authMenu" style="display:none">' +
      '<div class="am-head">' + esc(user.username) + '　<span class="muted">' + esc(txt) + "</span></div>" +
      '<button class="am-item" data-am="pull">从云端恢复进度（覆盖本机）</button>' +
      '<button class="am-item" data-am="push">上传本机进度到云端（覆盖云端）</button>' +
      '<button class="am-item" data-am="pwd">修改密码</button>' +
      '<button class="am-item danger" data-am="logout">退出登录</button>' +
      "</div>";
    var entry = document.getElementById("authEntry");
    var menu = document.getElementById("authMenu");
    entry.onclick = function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    };
    document.addEventListener("click", function () { menu.style.display = "none"; });
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    Array.prototype.forEach.call(menu.querySelectorAll(".am-item"), function (b) {
      b.onclick = function () {
        var a = this.getAttribute("data-am");
        menu.style.display = "none";
        if (a === "logout") doLogout();
        else if (a === "push") push(true);
        else if (a === "pull") pull(true);
        else if (a === "pwd") showModal("pwd");
      };
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 同步 ---------------- */
  function markDirty() {
    if (offline || !user) return;
    if (dirtyTimer) clearTimeout(dirtyTimer);
    syncState = "syncing"; renderUser();
    dirtyTimer = setTimeout(function () { push(false); }, 800);
  }
  function push(manual) {
    if (!user) return;
    var s = store();
    if (!s) return;
    if (manual && !confirm("将用本机进度覆盖云端数据，确定继续？")) return;
    syncState = "syncing"; renderUser();
    api("/api/state", { method: "POST", body: { data: JSON.stringify(s) } }).then(function (r) {
      if (!r.ok) { syncState = "error"; toast(r.msg || "同步失败", "err"); }
      else {
        syncState = "saved";
        lastSync = new Date().toTimeString().slice(0, 5);
        if (manual) toast("已上传到云端", "ok");
      }
      renderUser();
    }).catch(function () {
      offline = true; syncState = "offline"; renderUser();
    });
  }
  function pull(manual) {
    if (!user) return;
    if (manual && !confirm("将用云端进度覆盖本机数据，确定继续？")) return;
    api("/api/state").then(function (r) {
      if (!r.ok) { toast(r.msg || "读取失败", "err"); return; }
      if (!r.data) {
        // 云端还没有数据：把本机现有进度作为初始数据上传
        var s = store();
        if (s && (Object.keys(s.stat || {}).length || (s.wrong || []).length || (s.fav || []).length || (s.records || []).length)) {
          push(false);
          if (manual) toast("云端暂无数据，已上传本机进度");
        } else if (manual) {
          toast("云端暂无数据");
        }
        syncState = "saved"; renderUser();
        return;
      }
      applyServerData(r.data, manual);
    }).catch(function () { offline = true; syncState = "offline"; renderUser(); });
  }
  function applyServerData(str, manual) {
    var o;
    try { o = JSON.parse(str); } catch (e) { toast("云端数据解析失败", "err"); return; }
    var s = store();
    if (!s) return;
    s.stat = o.stat || {};
    // 答题详情按题目合并，每题取时间戳较新的一份（换设备答题不会互相覆盖）
    var la = s.answers || {}, ca = o.answers || {}, merged = {};
    Object.keys(la).forEach(function (k) { merged[k] = la[k]; });
    Object.keys(ca).forEach(function (k) {
      if (!merged[k] || (ca[k].t || 0) > (merged[k].t || 0)) merged[k] = ca[k];
    });
    s.answers = merged;
    s.wrong = o.wrong || [];
    s.fav = o.fav || [];
    // 服务端可能存有旧的百分制记录，拉取后统一折算成千分制
    s.records = (o.records || []).map(function (r) {
      return (window.HCIA_APP && window.HCIA_APP.migrateRecord) ? window.HCIA_APP.migrateRecord(r) : r;
    });
    // 未完成的练习进度：本地与云端按 savedAt 时间戳取较新的一份（最后写入者胜）
    var localSess = s.session;
    var cloudSess = o.session || null;
    if (localSess && cloudSess) {
      s.session = (localSess.savedAt || 0) >= (cloudSess.savedAt || 0) ? localSess : cloudSess;
    } else {
      s.session = cloudSess || localSess;
    }
    if (o.theme && window.HCIA_APP.applyTheme) window.HCIA_APP.applyTheme(o.theme);
    window.HCIA_APP.save();
    // 云端有未完成的练习：恢复会话；若用户还停在首页则自动进入练习
    if (window.HCIA_APP.restoreSession && window.HCIA_APP.restoreSession()) {
      if (window.HCIA_APP.getView && window.HCIA_APP.getView() === "home") {
        window.HCIA_APP.setView("practice");
      }
    }
    window.HCIA_APP.render();
    syncState = "saved";
    lastSync = new Date().toTimeString().slice(0, 5);
    renderUser();
    if (manual) toast("已从云端恢复进度", "ok");
  }

  /* ---------------- 登录 / 注册 / 退出 ---------------- */
  function doLogout() {
    api("/api/logout", { method: "POST" }).then(function () {
      user = null; lastSync = ""; syncState = "idle"; renderUser(); toast("已退出登录");
    }).catch(function () { user = null; renderUser(); });
  }

  /* ---------------- 弹窗 ---------------- */
  var modal = null;
  function showModal(tab) {
    tab = tab || "login";
    if (modal) modal.remove();
    var d = document.createElement("div");
    d.className = "modal-mask";
    d.innerHTML =
      '<div class="modal auth-modal">' +
      '<div class="modal-head"><span id="mTitle">登录</span><button class="x" id="mClose">×</button></div>' +
      '<div class="modal-body">' +
      '<div class="tabs" id="mTabs">' +
      '<button class="tab-item" data-tab="login">登录</button>' +
      '<button class="tab-item" data-tab="reg">注册</button>' +
      '<button class="tab-item" data-tab="pwd">改密</button>' +
      "</div>" +
      '<div class="form">' +
      '<label>用户名<input type="text" id="iUser" autocomplete="username" placeholder="2-20 位中英文/数字"></label>' +
      '<label id="lblPwd">密码<input type="password" id="iPwd" autocomplete="current-password" placeholder="至少 6 位"></label>' +
      '<label id="lblPwd2" style="display:none">新密码<input type="password" id="iPwd2" autocomplete="new-password" placeholder="至少 6 位"></label>' +
      '<div class="err" id="mErr"></div>' +
      '<button class="btn btn-lg" id="mOk">登录</button>' +
      '<div class="muted small" style="margin-top:12px;line-height:1.7">' +
      "· 登录后进度保存在服务器 SQLite 数据库中，换浏览器 / 换设备登录即可继续。<br>" +
      "· 服务器未启动时为离线模式，数据仅存本机。" +
      "</div>" +
      "</div></div></div>";
    document.body.appendChild(d);
    modal = d;
    var cur = tab;
    var T = {
      login: { title: "登录", ok: "登录" },
      reg: { title: "注册新账号", ok: "注册并登录" },
      pwd: { title: "修改密码", ok: "确认修改" }
    };
    function apply() {
      d.querySelector("#mTitle").textContent = T[cur].title;
      d.querySelector("#mOk").textContent = T[cur].ok;
      d.querySelector("#lblPwd").firstChild.textContent = cur === "pwd" ? "原密码" : "密码";
      d.querySelector("#lblPwd2").style.display = cur === "pwd" ? "" : "none";
      Array.prototype.forEach.call(d.querySelectorAll(".tab-item"), function (b) {
        b.classList.toggle("on", b.getAttribute("data-tab") === cur);
      });
      d.querySelector("#mErr").textContent = "";
    }
    Array.prototype.forEach.call(d.querySelectorAll(".tab-item"), function (b) {
      b.onclick = function () { cur = this.getAttribute("data-tab"); apply(); };
    });
    d.querySelector("#mClose").onclick = function () { d.remove(); modal = null; };
    d.onclick = function (e) { if (e.target === d) { d.remove(); modal = null; } };
    d.querySelector("#mOk").onclick = function () {
      var u = d.querySelector("#iUser").value.trim();
      var p = d.querySelector("#iPwd").value;
      var p2 = d.querySelector("#iPwd2").value;
      var err = d.querySelector("#mErr");
      err.textContent = "";
      if (!u || !p) { err.textContent = "请填写用户名和密码"; return; }
      var req;
      if (cur === "login") req = api("/api/login", { method: "POST", body: { username: u, password: p } });
      else if (cur === "reg") req = api("/api/register", { method: "POST", body: { username: u, password: p } });
      else req = api("/api/account", { method: "POST", body: { oldPassword: p, newPassword: p2 } });
      req.then(function (r) {
        if (!r.ok) { err.textContent = r.msg || "操作失败"; return; }
        if (cur === "pwd") { d.remove(); modal = null; toast("密码已修改", "ok"); return; }
        user = r.user; offline = false; syncState = "saved";
        d.remove(); modal = null;
        renderUser();
        toast("欢迎，" + r.user.username, "ok");
        pull(false);       // 登录后立即拉取云端进度
      }).catch(function () {
        err.textContent = "无法连接服务端（" + (BASE || "同源") + "），请确认 server.js 已启动";
      });
    };
    d.querySelector("#iPwd").onkeydown = function (e) { if (e.key === "Enter") d.querySelector("#mOk").click(); };
    apply();
    setTimeout(function () { d.querySelector("#iUser").focus(); }, 50);
  }

  /* ---------------- 关闭页面前立即落云 ----------------
   * 平时是 800ms 防抖推送，若在窗口内关闭页面会丢最后一次操作，
   * 这里用 sendBeacon 同步补推一次（localStorage 始终是最及时的兜底）。
   */
  window.addEventListener("beforeunload", function () {
    if (offline || !user || !BASE) return;
    var s = store();
    if (!s) return;
    if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; }
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(BASE + "/api/state",
          new Blob([JSON.stringify({ data: JSON.stringify(s) })], { type: "application/json" }));
      }
    } catch (e) { }
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    if (booted) return;
    booted = true;
    renderUser();
    api("/api/me").then(function (r) {
      offline = false;
      if (r.ok && r.user) {
        user = r.user;
        syncState = "saved";
        renderUser();
        pull(false);
      } else {
        user = null; renderUser();
      }
    }).catch(function () {
      offline = true; user = null; renderUser();
    });
  }

window.HCIA_AUTH = { boot: boot, markDirty: markDirty, showModal: showModal, isOffline: function () { return offline; } };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); });
  } else {
    setTimeout(boot, 0);
  }
})();
