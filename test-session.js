/* 练习进度持久化 —— 端到端冒烟测试
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node test-session.js
 * 会自行拉起 server.js，测完关闭。
 */
const { JSDOM } = require("jsdom");
const { spawn } = require("child_process");

const HOST = "http://127.0.0.1:8787";
const KEY = "hcia_ai_qb_v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS" : "  FAIL") + " - " + m); if (!c) fail++; };

async function open(seed) {
  const dom = await JSDOM.fromURL(HOST + "/", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) { if (seed) window.localStorage.setItem(KEY, seed); }
  });
  for (let i = 0; i < 80; i++) {
    if (dom.window.HCIA_APP) break;
    await sleep(100);
  }
  await sleep(200);
  return dom;
}

async function waitPort() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(HOST + "/"); if (r.ok) return true; } catch (e) { }
    await sleep(200);
  }
  return false;
}

/* ---------- 服务端 API（带简易 cookie jar） ---------- */
let cookie = "";
async function req(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const resp = await fetch(HOST + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((s) => s.split(";")[0]).join("; ");
  return resp.json();
}

(async () => {
  const srv = spawn(process.execPath, ["server.js"], { cwd: __dirname, stdio: "ignore" });
  try {
    if (!await waitPort()) { console.log("  FAIL - 服务未启动"); process.exit(1); }

    /* ============ 1. 练习并落盘 ============ */
    console.log("\n[1] 开始练习 -> 作答 -> 翻页");
    const dom = await open(null);
    const w = dom.window, d = w.document;
    if (!w.HCIA_APP) { console.log("  FAIL - 应用未初始化"); process.exit(1); }

    d.querySelector('[data-act="quick"][data-arg="all"]').click();
    await sleep(150);
    ok(w.HCIA_APP.getView() === "practice", "进入练习模式");
    const total = w.HCIA_APP.currentList().length;
    ok(total > 0, "生成题目列表（" + total + " 题）");

    let pos = 0, answered = 0;
    const answeredIds = [];
    for (let step = 0; step < 15 && answered < 3; step++) {
      const q = w.HCIA_APP.currentList()[pos];
      const opt = d.querySelector('[data-opt="0"]');
      if (q.t !== "blank" && opt) {
        opt.click(); await sleep(60);
        if (q.t === "multi") {
          const b = d.querySelector('[data-act="submit"]');
          if (b) { b.click(); await sleep(60); }
        }
        answered++; answeredIds.push(q.id);
      }
      const nx = d.querySelector('[data-act="next"]');
      if (!nx) break;
      nx.click(); pos++; await sleep(60);
    }
    ok(answered > 0, "已作答 " + answered + " 题，当前第 " + (pos + 1) + " 题");

    const raw = w.localStorage.getItem(KEY);
    const st = JSON.parse(raw);
    ok(!!st.session, "localStorage 中已写入 session");
    ok(st.session.ids.length === total, "session 保存完整题目列表（" + st.session.ids.length + " 题）");
    ok(st.session.pos === pos, "session 保存当前位置（pos=" + st.session.pos + "）");
    const savedAns = Object.keys(st.session.answers).length;
    ok(savedAns === answered, "session 保存已答内容（" + savedAns + " 题）");
    dom.window.close();

    /* ============ 2. 刷新页面自动恢复 ============ */
    console.log("\n[2] 模拟刷新页面（新实例，仅注入上次的 localStorage）");
    const dom2 = await open(raw);
    const w2 = dom2.window, d2 = w2.document;
    ok(w2.HCIA_APP.getView() === "practice", "刷新后自动回到练习界面");
    ok(w2.HCIA_APP.currentList().length === total, "恢复出相同题目列表（" + w2.HCIA_APP.currentList().length + " 题）");
    const idxEl = d2.querySelector(".idx");
    const idxTxt = idxEl ? String(idxEl.textContent).replace(/\s/g, "") : "(无)";
    ok(idxTxt === (pos + 1) + "/" + total, "恢复到第 " + (pos + 1) + " 题（页面显示 " + idxTxt + "）");
    const sheetEl = d2.querySelector(".sheet h5");
    const sheetTxt = sheetEl ? String(sheetEl.textContent) : "";
    ok(sheetTxt.indexOf(savedAns + " / " + total) >= 0, "已答进度恢复（" + sheetTxt.trim() + "）");
    const marked = d2.querySelectorAll(".nav-cell.done, .nav-cell.err").length;
    ok(marked >= savedAns, "题卡标记出已答题目（" + marked + " 个）");

    /* ============ 2.5 首页续练入口 ============ */
    console.log("\n[2.5] 首页续练入口");
    d2.querySelector('.nav-item[data-view="home"]').click(); await sleep(150);
    ok(!!d2.querySelector(".resume-mini"), "首页出现「继续练习」入口");
    d2.querySelector('[data-act="resume"]').click(); await sleep(150);
    ok(w2.HCIA_APP.currentList().length === total, "从首页续练恢复题目列表");

    /* ============ 3. 退出后续练 ============ */
    console.log("\n[3] 退出 -> 继续练习");
    d2.querySelector('[data-act="quit"]').click(); await sleep(150);
    ok(!!d2.querySelector(".resume-card"), "练习设置页出现「继续上次练习」卡片");
    d2.querySelector('[data-act="resume"]').click(); await sleep(150);
    ok(w2.HCIA_APP.currentList().length === total, "点击「继续练习」后恢复题目列表");
    ok((d2.querySelector(".idx") || {}).textContent.replace(/\s/g, "") === (pos + 1) + "/" + total, "恢复到原来的题号");

    /* ============ 4. 放弃进度 ============ */
    console.log("\n[4] 放弃进度");
    d2.querySelector('[data-act="quit"]').click(); await sleep(150);
    w2.confirm = () => true;
    d2.querySelector('[data-act="drop-session"]').click(); await sleep(150);
    ok(!JSON.parse(w2.localStorage.getItem(KEY)).session, "放弃后 session 已清除");
    ok(!d2.querySelector(".resume-card"), "续练卡片消失");

    /* ============ 4.5 答题详情长期保存 ============ */
    console.log("\n[4.5] 答题详情长期保存（store.answers）");
    const ansObj = w2.HCIA_APP.store.answers;
    ok(Object.keys(ansObj).length >= answered, "store.answers 记录已答题目（" + Object.keys(ansObj).length + " 条）");
    const rec = ansObj[answeredIds[0]];
    ok(rec && rec.val !== undefined && typeof rec.ok === "boolean" && rec.t > 0,
      "记录含「选了什么 / 对没对 / 时间」（" + JSON.stringify(rec) + "）");
    // 开一轮全新练习（本轮尚未作答），重做答过的题应回显上次作答
    d2.querySelector('.nav-item[data-view="home"]').click(); await sleep(150);
    d2.querySelector('[data-act="quick"][data-arg="all"]').click(); await sleep(220);
    const ti = w2.HCIA_APP.currentList().findIndex((q) => q.id === answeredIds[0]);
    d2.querySelector('[data-act="jump"][data-arg="' + ti + '"]').click(); await sleep(180);
    // 练习模式不再回显上次作答（会直接暴露上次选了什么、对没对）
    ok(!d2.querySelector(".last-ans"), "新一轮重做已答过的题时不再显示「上次作答」");
    const qbTxt = String((d2.querySelector("#qBody") || { textContent: "" }).textContent).replace(/\s+/g, " ");
    ok(qbTxt.indexOf("上次作答") < 0, "答题区不出现「上次作答」字样");
    ok(!d2.querySelector(".feedback"), "未作答前不显示任何对错反馈");

    dom2.window.close();

    /* ============ 5. 服务端往返（跨浏览器关键） ============ */
    console.log("\n[5] 服务端 API 往返 session");
    const u = "sess" + Date.now();
    let r = await req("/api/register", { username: u, password: "test1234" });
    ok(r.ok, "注册测试账号 " + u);
    const sess = {
      mode: "practice", title: "练习模式", pos: 7,
      ids: ["1-1", "1-2", "1-3"],
      answers: { "1-1": { val: 0, ok: true, checked: true } },
      savedAt: Date.now()
    };
    const ansDemo = { "1-1": { val: 0, ok: true, t: Date.now() }, "1-2": { val: 1, ok: false, t: Date.now() } };
    r = await req("/api/state", { data: JSON.stringify({ stat: {}, answers: ansDemo, wrong: [], fav: [], records: [], theme: "light", session: sess }) });
    ok(r.ok, "上传含 session + 答题详情的进度");
    r = await req("/api/state");
    ok(r.ok && r.data, "读取云端进度");
    const back = JSON.parse(r.data);
    ok(back.session && back.session.ids.length === 3 && back.session.pos === 7,
      "session 完整往返（pos=" + back.session.pos + "，ids=" + back.session.ids.length + "，已答 " + Object.keys(back.session.answers).length + " 题）");
    ok(back.answers && Object.keys(back.answers).length === 2 && back.answers["1-1"].ok === true,
      "答题详情完整往返（" + Object.keys(back.answers || {}).length + " 条）");

    console.log("\n" + (fail === 0 ? "全部通过 ✅" : fail + " 项失败 ❌"));
  } finally {
    srv.kill();
  }
  process.exit(fail === 0 ? 0 : 1);
})();
