/* 模拟考试：上一题 / 选中态 / 修改答案（服务需已运行在 8787）
 * 验证：
 *  1. 考试界面有「上一题」按钮，第一题禁用
 *  2. 判断题作答后要能看出选了「正确」还是「错误」（val=0 也要有选中态）
 *  3. 上一题 / 下一题来回切，选中态与作答内容都不丢
 *  4. 交卷前可以反复修改答案，最终以最后一次作答计分
 *  5. 修改答案不会重复计入练习统计
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
  const opts = () => [...d.querySelectorAll(".exam-opts .opt")];
  const selIdx = () => opts().map((e, i) => e.classList.contains("sel") ? i : -1).filter(i => i >= 0);
  const fbText = () => (d.querySelector("#fbWrap") || {}).textContent || "";

  w.HCIA_APP.store.records.length = 0;
  w.HCIA_APP.store.stat = {};
  w.HCIA_APP.store.answers = {};
  w.HCIA_APP.save();

  console.log("\n[1] 考试界面：上一题按钮");
  await navTo("exam");
  click('[data-ratio="1"]'); await sleep(150);
  click('[data-act="start-exam"]'); await sleep(500);
  const list = w.HCIA_APP.currentList();
  ok(!!d.querySelector(".exam-shell"), "进入全屏考试界面");
  const prevBtn = d.querySelector('.exam-actions [data-act="prev"]');
  ok(!!prevBtn, "出现「上一题」按钮");
  ok(prevBtn && prevBtn.textContent.includes("上一题"), "按钮文案为「上一题」");
  ok(prevBtn && prevBtn.disabled === true, "第 1 题时「上一题」为禁用态");
  ok(!!d.querySelector('.exam-actions [data-act="next"]'), "同时保留「下一题」");

  console.log("\n[2] 判断题：选中态要能看出选了「正确」还是「错误」");
  const ji = list.findIndex(q => q.t === "judge");
  ok(ji >= 0, "试卷里有判断题（第 " + (ji + 1) + " 题）");
  // 跳到该判断题
  click('.exam-li[data-arg="' + ji + '"], .nav-cell[data-arg="' + ji + '"]');
  if (!d.querySelector(".exam-li.cur") || !d.querySelector('.exam-li.cur').textContent.includes("第" + (ji + 1) + "题")) {
    // 题卡按钮可能在侧栏，直接用 jump 动作
    w.HCIA_APP.render && null;
    const cells = [...d.querySelectorAll('[data-act="jump"]')];
    const target = cells.find(b => b.dataset.arg === String(ji));
    if (target) target.click();
  }
  await sleep(200);
  ok((d.querySelector(".exam-shell") || {}).textContent !== undefined, "已切到该题");

  // 选「正确」（下标 0 —— 之前这里因为 0 被当成假值而不显示选中态）
  click('[data-opt="0"]'); await sleep(220);
  ok(selIdx().length === 1 && selIdx()[0] === 0, "选「正确」后第 1 个选项为选中态（实际 " + JSON.stringify(selIdx()) + "）");
  ok(opts()[0] && !opts()[0].classList.contains("correct") && !opts()[0].classList.contains("wrong"),
    "未交卷时只标选中，不标对错");
  // 改选「错误」
  click('[data-opt="1"]'); await sleep(220);
  ok(selIdx().length === 1 && selIdx()[0] === 1, "改选「错误」后第 2 个选项为选中态（实际 " + JSON.stringify(selIdx()) + "）");
  ok(fbText().includes("错误"), "反馈区回显「你的作答：错误」（实际：" + fbText().replace(/\s+/g, " ").slice(0, 60) + "）");
  // 再改回「正确」
  click('[data-opt="0"]'); await sleep(220);
  ok(selIdx().length === 1 && selIdx()[0] === 0, "再次改回「正确」后选中态跟着变");
  ok(fbText().includes("正确"), "反馈区回显「你的作答：正确」");

  console.log("\n[3] 上一题 / 下一题来回切，作答不丢");
  const q0 = list[ji];
  const posText = () => (d.querySelector(".exam-pos") || {}).textContent || "";
  click('[data-act="next"]'); await sleep(220);
  ok(!posText().includes("第 " + (ji + 1) + "/"), "已切到下一题（当前：" + posText().trim() + "）");
  const prev2 = d.querySelector('.exam-actions [data-act="prev"]');
  ok(prev2 && prev2.disabled === false, "非首题时「上一题」可点");
  prev2.click(); await sleep(240);
  ok(posText().includes("第 " + (ji + 1) + "/"), "点「上一题」回到原题（当前：" + posText().trim() + "）");
  ok(selIdx().length === 1 && selIdx()[0] === 0, "回到原题后选中态仍在（实际 " + JSON.stringify(selIdx()) + "）");
  ok(fbText().includes("正确"), "回到原题后作答内容仍在");
  ok(!opts()[0].classList.contains("locked"), "未交卷时选项未被锁定（可继续改）");

  console.log("\n[4] 修改答案不重复计入统计，且以最后一次作答为准");
  const before = (w.HCIA_APP.store.stat[q0.id] || { done: 0 }).done;
  click('[data-opt="1"]'); await sleep(220);
  const after = (w.HCIA_APP.store.stat[q0.id] || { done: 0 }).done;
  ok(after === before, "改答案不重复累加练习次数（" + before + " → " + after + "）");
  const wrongVal = q0.a === 0 ? 1 : 0;      // 故意改成错的
  const rightVal = q0.a;
  click('[data-opt="' + wrongVal + '"]'); await sleep(220);
  ok((w.HCIA_APP.store.answers[q0.id] || {}).val === wrongVal, "长期留档也更新为最后一次作答");

  console.log("\n[5] 交卷后按最终作答计分");
  // 把其余题全部答对，只留这一道判断题故意答错
  for (let i = 0; i < list.length; i++) {
    if (i === ji) continue;
    const cells = [...d.querySelectorAll('[data-act="jump"]')];
    const t = cells.find(b => b.dataset.arg === String(i));
    if (t) { t.click(); await sleep(90); }
    const q = list[i];
    if (q.t === "judge") click('[data-opt="' + q.a + '"]');
    else if (q.t === "single") click('[data-opt="' + q.a + '"]');
    else if (q.t === "multi") {
      for (const k of q.a) { click('[data-opt="' + k + '"]'); await sleep(15); }
      click('[data-act="submit"]');
    } else {
      const fill = d.querySelectorAll("[data-fill]");
      for (let k = 0; k < fill.length; k++) fill[k].value = ((q.a[k] || [])[0] || "");
      click('[data-act="submit"]');
    }
    await sleep(45);
  }
  // 回到那道判断题，确认它仍是错误答案
  const cells2 = [...d.querySelectorAll('[data-act="jump"]')];
  const t2 = cells2.find(b => b.dataset.arg === String(ji));
  if (t2) { t2.click(); await sleep(150); }
  ok(selIdx()[0] === wrongVal, "交卷前该题仍是修改后的答案");
  // 交卷（交卷按钮只在最后一题出现）
  const cells3 = [...d.querySelectorAll('[data-act="jump"]')];
  const t3 = cells3.find(b => b.dataset.arg === String(list.length - 1));
  if (t3) { t3.click(); await sleep(150); }
  click('[data-act="submit-exam"]'); await sleep(600);
  const rec = w.HCIA_APP.store.records[w.HCIA_APP.store.records.length - 1] || {};
  const expect = 1000 - (list[ji].t === "judge" ? 10 : 19);
  ok(rec.score === expect, "得分 = 满分 - 该判断题分值（期望 " + expect + "，实际 " + rec.score + "）");
  ok(rec.wrong === 1, "只错 1 题（实际 " + rec.wrong + "）");
  ok(rec.right === list.length - 1, "其余全对（实际 " + rec.right + "）");

  console.log("\n[6] 交卷回顾时不可再改答案");
  click('[data-act="review"]'); await sleep(300);
  const cells4 = [...d.querySelectorAll('[data-act="jump"]')];
  const t4 = cells4.find(b => b.dataset.arg === String(ji));
  if (t4) { t4.click(); await sleep(200); }
  const locked = opts()[0] && opts()[0].classList.contains("locked");
  ok(locked, "交卷后选项被锁定，不能再改");
  const valBefore = (w.HCIA_APP.store.answers[list[ji].id] || {}).val;
  click('[data-opt="' + rightVal + '"]'); await sleep(200);
  ok((w.HCIA_APP.store.answers[list[ji].id] || {}).val === valBefore, "点击选项不再改变答案");

  console.log("\n[7] 多选题 / 填空题：交卷前也能改");
  await navTo("exam");
  click('[data-ratio="1"]'); await sleep(150);
  click('[data-act="start-exam"]'); await sleep(500);
  const list2 = w.HCIA_APP.currentList();
  const jump = async i => {
    const c = [...d.querySelectorAll('[data-act="jump"]')].find(b => b.dataset.arg === String(i));
    if (c) { c.click(); await sleep(160); }
  };
  // 多选题：先选两个 → 确认 → 再改 → 重新确认
  const mi = list2.findIndex(q => q.t === "multi");
  await jump(mi);
  click('[data-opt="' + list2[mi].a[0] + '"]'); await sleep(60);
  click('[data-opt="' + list2[mi].a[1] + '"]'); await sleep(60);
  click('[data-act="submit"]'); await sleep(200);
  ok(selIdx().sort().join() === list2[mi].a.slice(0, 2).sort().join(), "多选确认后两个选项都保持选中态");
  const extra = [0, 1, 2, 3].find(i => list2[mi].a.indexOf(i) < 0);
  click('[data-opt="' + extra + '"]'); await sleep(220);
  ok(selIdx().indexOf(extra) >= 0, "多选题确认后仍可直接加选，选中态立即更新");
  ok((w.HCIA_APP.store.answers[list2[mi].id] || {}).val.length === 3, "长期留档同步为 3 个选项");
  click('[data-opt="' + extra + '"]'); await sleep(220);       // 取消，回到原答案
  ok(selIdx().sort().join() === list2[mi].a.slice(0, 2).sort().join(), "取消后回到原选择");
  ok((w.HCIA_APP.store.answers[list2[mi].id] || {}).val.length === 2, "留档也回到 2 个选项");

  // 填空题：确认后输入框仍可编辑
  const bi = list2.findIndex(q => q.t === "blank");
  await jump(bi);
  let fill = d.querySelectorAll("[data-fill]");
  for (let k = 0; k < fill.length; k++) fill[k].value = ((list2[bi].a[k] || [])[0] || "");
  click('[data-act="submit"]'); await sleep(220);
  fill = d.querySelectorAll("[data-fill]");
  ok(fill.length > 0 && fill[0].disabled === false, "填空题确认后输入框仍可编辑（交卷前）");
  ok(!!d.querySelector("#optWrap [data-act='submit']"), "出现「重新确认」入口");
  fill[0].value = "改过的答案";
  fill[0].dispatchEvent(new w.Event("input"));
  await sleep(120);
  const b3 = [...d.querySelectorAll("#optWrap [data-act='submit']")].pop();
  if (b3) b3.click();
  await sleep(220);
  ok(fbText().includes("改过的答案"), "改完重新确认后反馈区显示新答案");

  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
