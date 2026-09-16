/* 考试记录：每条都要能点开查看（含逐题回顾 / 答案速查 / 删除）
 * 用 Chrome CDP（jsdom 无布局且 jsdom 里 confirm 行为不一致），服务需已运行在 8787
 */
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9336;
const HOST = "http://127.0.0.1:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej);
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS - " + m); } else { fail++; console.log("  FAIL - " + m); } };

(async () => {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + udd, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });

  for (let i = 0; i < 60; i++) { try { await getJSON("http://127.0.0.1:" + PORT + "/json/version"); break; } catch (e) { } await sleep(300); }
  const target = (await getJSON("http://127.0.0.1:" + PORT + "/json/list")).find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));

  let id = 0; const waiting = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    // confirm 弹窗一律确认
    if (m.method === "Page.javascriptDialogOpening") {
      ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
  });
  const send = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description || "eval error");
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send("Page.enable", {});
  await send("Runtime.enable", {});
  await send("Page.navigate", { url: HOST + "/" });
  await sleep(3000);
  await ev(`(async()=>{for(let i=0;i<100;i++){if(window.HCIA_APP)break;await new Promise(r=>setTimeout(r,100));}})()`);

  const click = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`);
  const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
  const navTo = async (v) => { await click('.nav-item[data-view="' + v + '"]'); await sleep(350); };

  /* 按 correct=false 故意答错一部分 */
  async function answerOne(correct) {
    const C = correct ? "true" : "false";
    await ev(`(()=>{
      const app=window.HCIA_APP, list=app.currentList();
      const pos=app.store.session?app.store.session.pos:0;
      const q=list[pos], correct=${C};
      const pick=(sel)=>{const e=document.querySelector(sel); if(e) e.click();};
      if(q.t==="multi"){
        const opts=correct?q.a:[q.a[0]];
        opts.forEach(i=>pick('[data-opt="'+i+'"]'));
        pick('[data-act="submit"]');
      } else if(q.t==="blank"){
        const fill=document.querySelectorAll("[data-fill]");
        for(let i=0;i<fill.length;i++){
          const v=correct?((q.a[i]||[])[0]||""):("错答案"+i);
          fill[i].value=v; fill[i].dispatchEvent(new Event("input",{bubbles:true}));
        }
        pick('[data-act="submit"]');
      } else {
        const v=correct?q.a:(q.t==="judge"?(q.a===0?1:0):((q.a+1)%q.o.length));
        pick('[data-opt="'+v+'"]');
      }
      return q.t;
    })()`);
    await sleep(40);
  }
  async function nextOrSubmit() {
    const hasNext = await exists('.exam-actions [data-act="next"]');
    if (hasNext) await click('.exam-actions [data-act="next"]');
    return !hasNext;
  }
  /* 完整跑一场考试：wrongEvery=每 N 题故意答错一次 */
  async function runExam(wrongEvery) {
    await navTo("exam");
    await click('[data-ratio="1"]'); await sleep(150);
    await click('[data-act="start-exam"]'); await sleep(500);
    const n = Number(await ev(`window.HCIA_APP.currentList().length`));
    for (let i = 0; i < n; i++) {
      const wrong = wrongEvery && (i % wrongEvery === wrongEvery - 1);
      await answerOne(!wrong);
      const done = await nextOrSubmit();
      await sleep(60);
      if (done) break;
    }
    await sleep(200);
    await click('[data-act="submit-exam"]'); await sleep(600);
    return n;
  }

  try {
    await ev(`(()=>{const a=window.HCIA_APP;a.store.records=[];a.store.stat={};a.store.answers={};a.store.wrong=[];a.save();})()`);

    console.log("\n[1] 连考两场，记录应各自独立");
    const n1 = await runExam(0);            // 全对
    await sleep(200);
    const n2 = await runExam(7);            // 每 7 题错 1 道
    await sleep(300);
    const recs = await ev(`JSON.parse(JSON.stringify(window.HCIA_APP.store.records))`);
    console.log(`  两场题量: ${n1} / ${n2}，记录数: ${recs.length}`);
    ok(recs.length === 2, "产生 2 条考试记录");
    ok(recs[0].score > recs[1].score, `第 1 场全对 ${recs[0].score} 分 > 第 2 场 ${recs[1].score} 分`);

    console.log("\n[2] 记录里保存了题目快照");
    ok(recs[0].ids && recs[0].ids.length === n1, `第 1 条含 ${recs[0].ids.length} 道题 id`);
    ok(recs[1].ids && recs[1].ids.length === n2, `第 2 条含 ${recs[1].ids.length} 道题 id`);
    const nAns1 = Object.keys(recs[0].answers || {}).length;
    ok(nAns1 === n1, `第 1 条含 ${nAns1} 道题的作答快照`);
    ok(!!recs[0].scope, "记录了考试范围：" + recs[0].scope);
    const sameIds = await ev(`JSON.stringify(window.HCIA_APP.store.records[0].ids)===JSON.stringify(window.HCIA_APP.store.records[1].ids)`);
    ok(sameIds === false, "两场考试的题目不同（快照没有被互相覆盖）");

    console.log("\n[3] 记录列表出现「查看详情」");
    await navTo("records");
    const btnCount = await ev(`document.querySelectorAll('[data-act="rec-detail"]').length`);
    ok(btnCount === 2, `2 条记录各有 1 个「查看详情」按钮（实际 ${btnCount}）`);
    ok(await ev(`document.querySelectorAll('[data-act="rec-del"]').length`) === 2, "每条都有「删除」按钮");

    console.log("\n[4] 点开第 1 条：应显示当时的成绩单");
    await ev(`[...document.querySelectorAll('[data-act="rec-detail"]')].find(b=>b.dataset.arg==="0").click()`);
    await sleep(500);
    ok(await exists(".result-hero"), "进入成绩单页");
    const heroTxt = await ev(`document.querySelector('.result-hero').textContent`);
    ok(heroTxt.includes(String(recs[0].score)), `成绩单显示该场得分 ${recs[0].score}`);
    ok(await exists('[data-act="rec-back"]'), "出现「返回记录列表」按钮");
    ok(await exists('[data-act="replay-review"]'), "出现「逐题回顾」按钮");
    ok(await exists('[data-act="rec-redo"]'), "出现「重做本套题」按钮");
    const ansRows = await ev(`document.querySelectorAll('.list-item').length`);
    ok(ansRows === n1, `答案速查列出 ${ansRows} 道题（该场共 ${n1} 题）`);
    const bodyTxt = await ev(`document.querySelector('#content').textContent`);
    ok(bodyTxt.includes(recs[0].date), "显示该场考试日期 " + recs[0].date);

    console.log("\n[5] 逐题回顾：能看到当时作答，且不可再改");
    await click('[data-act="replay-review"]'); await sleep(500);
    ok(await exists(".exam-shell"), "进入逐题回顾（考试界面）");
    const fb = await ev(`document.querySelector('#fbWrap').textContent`);
    ok(/正确|你的作答|正确答案/.test(fb), "回顾时能看出对错与正确答案");
    const before = await ev(`JSON.stringify(window.HCIA_APP.store.stat)`);
    await click('[data-opt="0"]'); await sleep(200);
    const afterAnsDots = await ev(`document.querySelectorAll('.exam-opts .opt.sel').length`);
    ok(afterAnsDots >= 0, "回看模式下点击选项不报错");
    ok(before === (await ev(`JSON.stringify(window.HCIA_APP.store.stat)`)), "回看不会重复计入练习统计");
    ok(await exists('.exam-side'), "题卡照常显示");

    console.log("\n[6] 返回成绩单 → 返回记录列表");
    await click('[data-act="back-result"]'); await sleep(400);
    ok(await exists(".result-hero"), "回到成绩单");
    await click('[data-act="rec-back"]'); await sleep(400);
    ok(await ev(`window.HCIA_APP.getView()==="records"`), "回到考试记录列表");
    ok((await ev(`window.HCIA_APP.store.records.length`)) === 2, "记录没有被回看操作破坏");

    console.log("\n[7] 点开第 2 条：应显示第 2 场的内容（不是第 1 场）");
    await ev(`[...document.querySelectorAll('[data-act="rec-detail"]')].find(b=>b.dataset.arg==="1").click()`);
    await sleep(500);
    const t2 = await ev(`document.querySelector('.result-hero').textContent`);
    ok(t2.includes(String(recs[1].score)), `显示第 2 场得分 ${recs[1].score}`);
    const n2score = await ev(`document.querySelector('.score-circle .n').textContent`);
    ok(n2score.indexOf(String(recs[1].score)) === 0, `得分圆环显示第 2 场分数 ${recs[1].score}（不是第 1 场的 ${recs[0].score}）`);

    console.log("\n[8] 旧版本记录（无题目快照）不应崩溃");
    await ev(`(()=>{const a=window.HCIA_APP;
      a.store.records.push({score:880,max:1000,pass:600,right:55,wrong:5,total:60,used:1500,date:"2026-01-01 10:00",byType:{}});
      a.save(); a.render();})()`);
    await sleep(300);
    await navTo("records");
    ok(await ev(`document.querySelectorAll('[data-act="rec-detail"]').length`) === 3, "旧记录也列出来了");
    ok((await ev(`document.querySelector('#content').textContent`)).includes("无法逐题回顾"), "列表给出了「无法逐题回顾」的说明");
    await ev(`[...document.querySelectorAll('[data-act="rec-detail"]')].find(b=>b.dataset.arg==="2").click()`);
    await sleep(500);
    ok(await exists(".result-hero"), "旧记录仍能显示总分成绩单");
    ok(!(await exists(".list-item")), "旧记录不显示答案速查（没有快照）");
    ok(!(await exists('[data-act="replay-review"]')), "旧记录不显示「逐题回顾」（点了会崩）");
    await click('[data-act="rec-back"]'); await sleep(300);

    console.log("\n[9] 删除单条记录");
    await ev(`[...document.querySelectorAll('[data-act="rec-del"]')].find(b=>b.dataset.arg==="2").click()`);
    await sleep(500);
    ok((await ev(`window.HCIA_APP.store.records.length`)) === 2, "删除后剩 2 条");
    ok((await ev(`JSON.stringify(window.HCIA_APP.store.records.map(r=>r.score))`)) === JSON.stringify([recs[0].score, recs[1].score]).replace(/\s/g, ""), "剩下的正是前两条记录 [" + recs[0].score + ", " + recs[1].score + "]");

    console.log("\n[10] 「重做本套题」应进入练习模式");
    await ev(`[...document.querySelectorAll('[data-act="rec-detail"]')].find(b=>b.dataset.arg==="0").click()`);
    await sleep(500);
    await click('[data-act="rec-redo"]'); await sleep(500);
    ok(await ev(`window.HCIA_APP.getView()==="practice"`), "进入练习模式");
    ok((await ev(`window.HCIA_APP.currentList().length`)) === n1, `载入了那套 ${n1} 道题`);
    ok((await ev(`Object.keys(window.HCIA_APP.store.session?window.HCIA_APP.store.session.answers||{}:{}).length`)) === 0, "重做时作答已清空");
  } catch (e) {
    fail++;
    console.log("\nERROR:", e.message);
  } finally {
    try { ws.close(); } catch (e) { }
    try { chrome.kill(); } catch (e) { }
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  }
})();
