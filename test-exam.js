/* 模拟考试结构测试（服务需已运行在 8787）
 * 验证：60 题 = 判断18 + 单选20 + 多选16 + 填空6，满分 1000，600 分合格
 */
const { JSDOM } = require("jsdom");
const HOST = "http://127.0.0.1:8787";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS - " + m); } else { fail++; console.log("  FAIL - " + m); } };

(async () => {
  const dom = await JSDOM.fromURL(HOST + "/", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
  for (let i = 0; i < 100; i++) { if (dom.window.HCIA_APP) break; await sleep(100); }
  await sleep(400);
  const w = dom.window, d = w.document;
  const click = sel => { const e = d.querySelector(sel); if (e) e.click(); return !!e; };
  const navTo = async v => { click('.nav-item[data-view="' + v + '"]'); await sleep(240); };
  const txt = () => (d.querySelector("#content") || {}).textContent || "";
  const lastRec = () => (w.HCIA_APP.store.records[w.HCIA_APP.store.records.length - 1] || null);
  // 逐「文本元素」检查反馈区是否泄题（整块 textContent 会因跨行拼接产生误判）
  const fbNodes = dd => [...(dd || d).querySelectorAll("#fbWrap .ef-head, #fbWrap .ef-meta, #fbWrap .ef-ex-title, #fbWrap .ef-ex")]
    .map(e => e.textContent || "");
  const fbHas = (kw, dd) => fbNodes(dd).some(t => t.includes(kw));

  // 清空历史记录，保证断言可重复
  w.HCIA_APP.store.records.length = 0;
  w.HCIA_APP.save();

  console.log("\n[1] 考试设置页：固定题型结构");
  await navTo("exam");
  const s = txt();
  ok(s.includes("18 题 × 10 分"), "判断题 18 题 × 10 分");
  ok(s.includes("20 题 × 19 分"), "单选题 20 题 × 19 分");
  ok(s.includes("16 题 × 20 分"), "多选题 16 题 × 20 分");
  ok(s.includes("6 题 × 20 分"), "填空题 6 题 × 20 分");
  ok(s.includes("180") && s.includes("380") && s.includes("320") && s.includes("120"), "各题型小计 180/380/320/120");
  ok(s.includes("1000 分"), "满分 1000 分");
  ok(s.includes("600") && s.includes("合格线"), "合格线 600 分");
  ok(!d.querySelector("[data-count]"), "已移除可变题量选项");

  async function startExam() {
    await navTo("exam");
    click('[data-ratio="1"]'); await sleep(150);
    click('[data-act="start-exam"]'); await sleep(450);
    return w.HCIA_APP.currentList();
  }
  async function answer(q, correct) {
    if (q.t === "judge") {
      const v = correct ? q.a : (q.a === 0 ? 1 : 0);
      click('[data-opt="' + v + '"]');
    } else if (q.t === "single") {
      const v = correct ? q.a : (q.a + 1) % q.o.length;
      click('[data-opt="' + v + '"]');
    } else if (q.t === "multi") {
      const opts = correct ? q.a : [q.a[0]];
      for (const i of opts) { click('[data-opt="' + i + '"]'); await sleep(20); }
      click('[data-act="submit"]');
    } else {
      const fill = d.querySelectorAll("[data-fill]");
      for (let i = 0; i < fill.length; i++) fill[i].value = correct ? ((q.a[i] || [])[0] || "") : "错答案" + i;
      click('[data-act="submit"]');
    }
    await sleep(35);
  }
  /* 按 mode 决定哪些题答对：
     all=全部；multi=k 表示只答对判断+单选+前 k 道多选 */
  async function runExam(mode) {
    const list = await startExam();
    let multi = 0;
    const should = list.map(q => {
      if (mode === "all") return true;
      if (q.t === "judge" || q.t === "single") return true;
      if (q.t === "multi") { if (multi < mode.multi) { multi++; return true; } return false; }
      return false;
    });
    for (let i = 0; i < list.length; i++) {
      if (should[i]) await answer(list[i], true);
      if (i < list.length - 1) { click('[data-act="next"]'); await sleep(30); }
    }
    click('[data-act="submit-exam"]'); await sleep(500);
    return lastRec();
  }

  console.log("\n[2] 抽题结构");
  let list = await startExam();
  ok(list.length === 60, "共 60 题（实际 " + list.length + "）");
  const cnt = {};
  list.forEach(q => cnt[q.t] = (cnt[q.t] || 0) + 1);
  console.log("      题型分布:", JSON.stringify(cnt));
  ok(cnt.judge === 18, "判断题 18 题（实际 " + cnt.judge + "）");
  ok(cnt.single === 20, "单选题 20 题（实际 " + cnt.single + "）");
  ok(cnt.multi === 16, "多选题 16 题（实际 " + cnt.multi + "）");
  ok(cnt.blank === 6, "填空题 6 题（实际 " + cnt.blank + "）");
  ok(new Set(list.map(q => q.id)).size === 60, "60 题互不重复");
  const chCnt = {};
  list.forEach(q => chCnt[q.chId] = (chCnt[q.chId] || 0) + 1);
  console.log("      章节分布:", Object.keys(chCnt).sort().map(c => "ch" + c + "=" + chCnt[c]).join(" "));

  console.log("\n[3] 全部答对 = 1000 分");
  let r = await runExam("all");
  ok(!!r, "交卷生成成绩");
  if (r) {
    console.log("      得分:", r.score, "｜答对:", r.right, "｜答错:", r.wrong, "｜总题:", r.total);
    ok(r.score === 1000, "满分 1000 分（实际 " + r.score + "）");
    ok(r.max === 1000 && r.pass === 600, "记录 max=1000 / pass=600");
    ok(r.right === 60, "答对 60 题");
    ok(!!r.byType && r.byType.judge.score === 180 && r.byType.single.score === 380
      && r.byType.multi.score === 320 && r.byType.blank.score === 120,
      "题型得分 180/380/320/120（实际 " +
      (r.byType ? [r.byType.judge.score, r.byType.single.score, r.byType.multi.score, r.byType.blank.score].join("/") : "无") + "）");
    const hero = (d.querySelector(".result-hero") || {}).textContent || "";
    ok(hero.includes("1000") && hero.includes("600"), "成绩页显示满分与合格线");
    ok(hero.includes("通过"), "判定为通过");
  }

  console.log("\n[4] 恰好 600 分（合格边界）");
  r = await runExam({ multi: 2 });
  if (r) {
    console.log("      得分:", r.score);
    ok(r.score === 600, "得 600 分（实际 " + r.score + "）");
    ok(txt().includes("通过"), "600 分判定为通过");
  }

  console.log("\n[5] 580 分（差 20 分）");
  r = await runExam({ multi: 1 });
  if (r) {
    console.log("      得分:", r.score);
    ok(r.score === 580, "得 580 分（实际 " + r.score + "）");
    ok(txt().includes("未通过"), "580 分判定为未通过");
  }

  console.log("\n[6] 考试记录：千分制");
  await navTo("records");
  const recs = w.HCIA_APP.store.records;
  console.log("      记录:", recs.map(x => x.score).join(", "));
  ok(recs.length === 3, "保存 3 条记录（实际 " + recs.length + "）");
  ok(recs.every(x => x.max === 1000), "全部为千分制 max=1000");
  ok(recs.filter(x => x.score >= 600).length === 2, "2 条通过 / 1 条未通过");
  const rt = txt();
  ok(rt.includes("1000"), "记录页标注满分 1000");
  ok(rt.includes("合格线 600"), "记录页标注合格线 600");

  console.log("\n[7] 旧百分制记录自动折算");
  w.HCIA_APP.store.records.push({ score: 85, right: 50, wrong: 10, total: 60, used: 1200, date: "2026-01-01 10:00" });
  const before = w.HCIA_APP.store.records.length;
  w.HCIA_APP.save();
  const migrated = w.HCIA_APP.migrateRecord({ score: 85, right: 50, wrong: 10, total: 60 });
  ok(migrated.score === 850 && migrated.max === 1000 && migrated.pass === 600,
    "85 分（百分制）→ 850 / 1000（实际 " + migrated.score + "）");
  ok(migrated.right === 50 && migrated.total === 60, "折算时保留原有字段");
  w.HCIA_APP.store.records.length = before - 1;
  w.HCIA_APP.save();

  console.log("\n[8] 指定章节（题量不足时从全库补足）");
  await navTo("exam");
  const sel = d.querySelector("#selCh");
  ok(!!sel, "章节下拉存在");
  if (sel) {
    sel.value = "7";                       // 第 7 章仅 47 题，必然不足 60 题
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    await sleep(250);
    const tip = txt();
    ok(tip.includes("补足"), "提示题量不足将自动补足");
    click('[data-act="start-exam"]'); await sleep(450);
    const l7 = w.HCIA_APP.currentList();
    const c7 = {};
    l7.forEach(q => c7[q.t] = (c7[q.t] || 0) + 1);
    console.log("      题型分布:", JSON.stringify(c7), "｜来自第7章的题数:", l7.filter(q => q.chId === 7).length);
    ok(l7.length === 60, "仍抽满 60 题（实际 " + l7.length + "）");
    ok(c7.judge === 18 && c7.single === 20 && c7.multi === 16 && c7.blank === 6, "题型结构仍为 18/20/16/6");
    ok(new Set(l7.map(q => q.id)).size === 60, "60 题互不重复");
  }

  console.log("\n[9] 考试界面的新布局");
  list = await startExam();
  ok(!!d.querySelector(".exam-shell"), "进入全屏考试界面 .exam-shell");
  ok(d.body.classList.contains("exam-fs"), "隐藏站点侧边栏/顶栏（body.exam-fs）");
  ok(((d.querySelector(".exam-brand") || {}).textContent || "").includes("模拟考试"), "顶栏标题含「模拟考试」");
  ok((d.querySelectorAll(".exam-tab").length) === 2, "标签：全部 / 只看错题");
  ok(((d.querySelector(".exam-tab") || {}).textContent || "") === "全部", "首个标签为「全部」");
  ok(!!d.querySelector(".exam-tab.dis"), "未交卷时「只看错题」为禁用态");
  const li = d.querySelectorAll(".exam-li");
  ok(li.length === 60, "左侧题卡 60 行（实际 " + li.length + "）");
  const heads = [...d.querySelectorAll(".exam-side-head")].map(x => x.textContent.replace(/\s/g, ""));
  console.log("      题型分组:", heads.join(" | "));
  ok(heads.length === 4, "题卡按题型分 4 组");
  ok(heads[0].includes("判断题18题") && heads[1].includes("单选题20题")
    && heads[2].includes("多选题16题") && heads[3].includes("填空题6题"), "分组标题与题量正确");
  ok([...li].every(x => /第\d+题（\d+分）/.test(x.textContent)), "每行显示「第N题（分值）」");
  const pos = (d.querySelector(".exam-pos") || {}).textContent || "";
  ok(pos.includes("判断题") && pos.includes("第 1/60 题"), "顶部显示题型与进度（" + pos + "）");
  ok(((d.querySelector(".exam-hint") || {}).textContent || "").includes("方向键"), "显示键盘提示");
  const lg = (d.querySelector(".exam-legend") || {}).textContent || "";
  ok(lg.includes("已答") && lg.includes("未答"), "未交卷时图例为 已答 / 未答");

  console.log("\n[10] 考试过程中不揭示答案");
  const nz = list.findIndex(q => q.t !== "blank");
  if (nz > 0) { click('[data-act="jump"][data-arg="' + nz + '"]'); await sleep(150); }
  const q9 = list[nz];
  await answer(q9, true); await sleep(80);
  ok(d.querySelectorAll(".opt.correct").length === 0, "答对后不出现绿色正确项高亮");
  ok(d.querySelectorAll(".opt.wrong").length === 0, "答对后不出现红色错误项高亮");
  ok(d.querySelectorAll(".exam-list .dot.ok").length === 0 && d.querySelectorAll(".exam-list .dot.no").length === 0,
    "题卡不标对错（无绿/红方块）");
  ok(d.querySelectorAll(".exam-list .dot.done").length === 1, "题卡标出 1 道已答");
  const fb9 = (d.querySelector("#fbWrap") || {}).textContent || "";
  ok(fb9.includes("已作答"), "反馈区显示「已作答」");
  ok(!fbHas("正确答案"), "反馈区不显示正确答案");
  ok(!fbHas("解析"), "反馈区不显示解析");
  ok(!!d.querySelector("#fbWrap .exam-fb.neutral"), "反馈块为中性样式（不是绿/红判定块）");
  ok(!d.querySelector(".last-ans"), "不回显该题历史作答");

  // 再故意答错一题，确认错误答案同样不揭示
  const bad = list.findIndex((q, i) => i !== nz && q.t !== "blank");
  if (bad >= 0) {
    click('[data-act="jump"][data-arg="' + bad + '"]'); await sleep(150);
    await answer(list[bad], false); await sleep(80);
    ok(d.querySelectorAll(".opt.correct").length === 0, "答错后也不高亮正确项");
    ok(d.querySelectorAll(".opt.wrong").length === 0, "答错后也不标红所选项");
    const fbBad = (d.querySelector("#fbWrap") || {}).textContent || "";
    ok(!fbHas("正确答案"), "答错后反馈区仍不显示正确答案");
  }

  console.log("\n[11] 交卷后逐题回顾才显示答案");
  click('[data-act="jump"][data-arg="' + (list.length - 1) + '"]'); await sleep(180);
  ok(!!d.querySelector('[data-act="submit-exam"]'), "最后一题出现交卷按钮");
  click('[data-act="submit-exam"]'); await sleep(550);
  ok(!!d.querySelector(".result-hero"), "交卷后先显示成绩单");
  ok(!d.body.classList.contains("exam-fs"), "成绩单恢复站点框架");

  click('[data-act="review"]'); await sleep(350);
  ok(!!d.querySelector(".exam-shell"), "回顾回到考试界面");
  const es = (d.querySelector(".exam-status") || {}).textContent || "";
  ok(es.includes("得分") && es.includes("答题用时"), "顶栏显示得分与用时（" + es.replace(/\s+/g, " ") + "）");
  ok(!d.querySelector(".exam-tab.dis"), "交卷后「只看错题」可用");
  ok(["答对", "答错", "未答"].every(k => (d.querySelector(".exam-legend") || {}).textContent.includes(k)),
    "图例切换为 答对 / 答错 / 未答");
  click('[data-act="jump"][data-arg="' + nz + '"]'); await sleep(180);
  ok(d.querySelectorAll(".opt.correct").length > 0, "回顾时标出正确选项");
  const fb10 = (d.querySelector("#fbWrap") || {}).textContent || "";
  ok(fb10.includes("正确答案"), "回顾时显示正确答案");
  ok(fb10.includes("答案解析"), "回顾时显示答案解析");
  ok(!d.querySelector('[data-act="submit-exam"]'), "回顾时不再显示交卷按钮");

  console.log("\n[12] 只看错题筛选");
  click('[data-act="back-result"]'); await sleep(300);
  ok(!!d.querySelector(".result-hero"), "可从回顾返回成绩单");
  click('[data-act="review"]'); await sleep(300);
  const rowsAll = d.querySelectorAll(".exam-li").length;
  click('[data-act="exam-filter"][data-arg="wrong"]'); await sleep(250);
  const rowsWrong = d.querySelectorAll(".exam-li").length;
  console.log("      全部 " + rowsAll + " 行 → 只看错题 " + rowsWrong + " 行");
  ok(rowsWrong < rowsAll, "只看错题减少了题卡行数");
  ok([...d.querySelectorAll(".exam-list .dot")].every(x => !x.classList.contains("ok")),
    "筛选后不再出现「答对」标记");
  d.querySelector('[data-act="exam-filter"][data-arg="all"]').click(); await sleep(250);
  ok(d.querySelectorAll(".exam-li").length === rowsAll, "切回全部恢复全部题卡");

  console.log("\n[13] 考试中答案持久化（模拟刷新）");
  // 重新开一场考试，答 3 题后不算交卷
  list = await startExam();
  const keepIds = [];
  for (let i = 0; i < 3; i++) { await answer(list[i], true); keepIds.push(list[i].id); if (i < 2) { click('[data-act="next"]'); await sleep(40); } }
  const posBefore = 2;
  const nDoneOnScreen = d.querySelectorAll(".exam-li .dot.done").length;
  ok(nDoneOnScreen === 3, "题卡出现 3 个「已作答」绿格（实际 " + nDoneOnScreen + "）");
  const fb13 = (d.querySelector("#fbWrap") || {}).textContent || "";
  ok(fb13.includes("你的作答"), "反馈区回显「你的作答」");
  ok(!fbHas("正确答案"), "考试进行中仍不显示正确答案");

  const seed = w.localStorage.getItem("hcia_ai_qb_v2");
  const sess = JSON.parse(seed).session;
  ok(sess && sess.mode === "exam", "会话已按 exam 模式落盘");
  ok(sess && sess.ids.length === 60, "落盘会话含 60 道题");
  ok(sess && Object.keys(sess.answers).length === 3, "落盘会话含 3 题作答内容");
  ok(sess && !!sess.startedAt && sess.timeLimit > 0, "落盘会话含考试时长信息");

  dom.window.close();   // 相当于关掉页面

  const dom2 = await JSDOM.fromURL(HOST + "/", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(win) { win.localStorage.setItem("hcia_ai_qb_v2", seed); }
  });
  for (let i = 0; i < 100; i++) { if (dom2.window.HCIA_APP) break; await sleep(100); }
  await sleep(500);
  const w2 = dom2.window, d2 = w2.document;
  const list2 = w2.HCIA_APP.currentList();
  ok(list2.length === 60, "重开后自动恢复到那场考试（60 题，实际 " + list2.length + "）");
  ok(list2.map(q => q.id).join() === list.map(q => q.id).join(), "恢复的是同一套题（顺序一致）");
  const nAns2 = Object.keys(w2.HCIA_APP.store.session ? w2.HCIA_APP.store.session.answers : {}).length;
  ok(nAns2 === 3, "已作答的 3 题答案仍在（实际 " + nAns2 + "）");
  const doneDots2 = d2.querySelectorAll(".exam-li .dot.done").length;
  ok(doneDots2 === 3, "题卡仍标出 3 个已答绿格（实际 " + doneDots2 + "）");
  const posTxt = (d2.querySelector(".exam-pos") || {}).textContent || "";
  ok(posTxt.includes("第 " + (posBefore + 1) + "/60"), "回到原来那道题（" + posTxt.trim() + "）");
  const fb2 = (d2.querySelector("#fbWrap") || {}).textContent || "";
  ok(fb2.includes("你的作答"), "恢复后该题仍回显作答内容");
  ok(!fbHas("正确答案", d2), "恢复后仍未交卷，不显示正确答案");

  // 退出考试 → 设置页给出续考入口 → 接着答
  const click2 = sel => { const e = d2.querySelector(sel); if (e) e.click(); return !!e; };
  click2('[data-act="quit"]'); await sleep(250);
  const rc = d2.querySelector(".resume-card");
  ok(!!rc, "退出后考试设置页出现续考卡片");
  ok((rc ? rc.textContent : "").includes("继续上次未完成的考试"), "卡片标题为「继续上次未完成的考试」");
  click2('[data-act="resume"]'); await sleep(320);
  ok(w2.HCIA_APP.currentList().length === 60, "从卡片继续考试，60 题列表恢复");
  ok(Object.keys(w2.HCIA_APP.store.session.answers).length === 3, "续考后 3 题作答内容仍在");

  // 交卷 → 不再保留续考会话
  click2('[data-act="jump"][data-arg="59"]'); await sleep(220);
  click2('[data-act="submit-exam"]'); await sleep(520);
  ok(!!d2.querySelector(".result-hero"), "交卷进入成绩单");
  ok(!JSON.parse(w2.localStorage.getItem("hcia_ai_qb_v2")).session, "交卷后续考会话已清除");
  dom2.window.close();

  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("异常:", e.stack); process.exit(1); });
