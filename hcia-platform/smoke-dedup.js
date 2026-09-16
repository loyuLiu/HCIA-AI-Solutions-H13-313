/* 去重后冒烟测试（服务需已运行在 8787） */
const { JSDOM } = require("jsdom");
const HOST = "http://127.0.0.1:8787";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS - " + m); } else { fail++; console.log("  FAIL - " + m); } };

(async () => {
  const dom = await JSDOM.fromURL(HOST + "/", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true
  });
  for (let i = 0; i < 100; i++) { if (dom.window.HCIA_APP) break; await sleep(100); }
  await sleep(500);
  const w = dom.window, d = w.document;

  const chapters = w.QB_CHAPTERS || [];
  const total = chapters.reduce((s, c) => s + c.questions.length, 0);
  console.log("\n[1] 题库加载");
  ok(total === 965, "总题数 = 965（实际 " + total + "）");
  ok(chapters.length === 8, "章节数 8");
  const perCh = chapters.map(c => c.questions.length);
  console.log("      各章题数:", perCh.join(" / "));

  const sample = chapters[0].questions[0];
  ok(!!sample.uid, "题目带固化 uid（示例 " + (sample.uid || "无") + "）");
  const allIds = [];
  chapters.forEach(c => c.questions.forEach(q => allIds.push(q.uid)));
  ok(new Set(allIds).size === allIds.length, "uid 全局唯一（" + allIds.length + " 条）");
  ok(allIds.filter(x => !x).length === 0, "无缺失 uid");

  console.log("\n[2] 题型分布");
  const byType = {};
  chapters.forEach(c => c.questions.forEach(q => byType[q.t] = (byType[q.t] || 0) + 1));
  console.log("      ", JSON.stringify(byType));
  ok(byType.judge > 0 && byType.single > 0 && byType.multi > 0 && byType.blank > 0, "四种题型均存在");

  console.log("\n[3] 模拟考试固定结构（60 题 / 1000 分 / 600 合格）");
  const meta = w.HCIA_APP.examMeta ? w.HCIA_APP.examMeta() : null;
  ok(!!meta && meta.total === 60 && meta.max === 1000 && meta.pass === 600,
    "考试常量 60 题 / 1000 分 / 600 合格（" + JSON.stringify(meta) + "）");
  d.querySelector('.nav-item[data-view="exam"]').click(); await sleep(250);
  const ratioBtn = d.querySelector('[data-ratio="1"]');
  if (ratioBtn) ratioBtn.click(); await sleep(150);
  d.querySelector('[data-act="start-exam"]').click(); await sleep(500);
  const list = w.HCIA_APP.currentList();
  ok(list.length === 60, "抽出 60 题（实际 " + list.length + "）");
  const tc = {};
  list.forEach(q => tc[q.t] = (tc[q.t] || 0) + 1);
  console.log("      题型分布:", JSON.stringify(tc));
  ok(tc.judge === 18 && tc.single === 20 && tc.multi === 16 && tc.blank === 6,
    "题型 18/20/16/6 符合设定");
  const cc = {};
  list.forEach(q => cc[q.chId] = (cc[q.chId] || 0) + 1);
  console.log("      各章抽题数:", [1, 2, 3, 4, 5, 6, 7, 8].map(c => "ch" + c + "=" + (cc[c] || 0)).join(" "));
  ok(!cc[8], "第 8 章无官方占比，不参与配比抽卷");

  console.log("\n[4] 练习模式可正常开始");
  d.querySelector('.nav-item[data-view="home"]').click(); await sleep(150);
  const quick = d.querySelector('[data-act="quick"][data-arg="all"]');
  ok(!!quick, "顺序刷全部入口存在");
  if (quick) {
    quick.click(); await sleep(400);
    ok(w.HCIA_APP.currentList().length === 965, "练习载入全部 965 题");
    ok(w.HCIA_APP.getView() === "practice", "进入练习视图");
  }

  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("异常:", e.message); process.exit(1); });
