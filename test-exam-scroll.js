/* 用 Chrome CDP 实测「题卡滚动位置保持」修复（需服务已运行在 8787） */
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const HOST = "http://127.0.0.1:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let b = "";
      r.on("data", (d) => (b += d));
      r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS - " + m); } else { fail++; console.log("  FAIL - " + m); } };

(async () => {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + udd,
    "--window-size=1440,900", "about:blank",
  ], { stdio: "ignore" });

  for (let i = 0; i < 60; i++) {
    try { const v = await getJSON(`http://127.0.0.1:${PORT}/json/version`); if (v && v.webSocketDebuggerUrl) break; } catch (e) {}
    await sleep(300);
  }
  const target = (await getJSON("http://127.0.0.1:" + PORT + "/json/list")).find((t) => t.type === "page");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  });
  const send = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  try {
    await send("Page.navigate", { url: HOST + "/" });
    await sleep(3000);
    await evalJS(`(async()=>{for(let i=0;i<100;i++){if(window.HCIA_APP)break;await new Promise(r=>setTimeout(r,100));}})()`);

    console.log("\n[0] 进入模拟考试");
    await evalJS(`document.querySelector('.nav-item[data-view="exam"]').click()`);
    await sleep(300);
    await evalJS(`(document.querySelector('[data-ratio="1"]')||{click(){}}).click()`);
    await sleep(200);
    await evalJS(`document.querySelector('[data-act="start-exam"]').click()`);
    await sleep(800);

    const inShell = await evalJS(`!!document.querySelector('.exam-shell')`);
    ok(inShell, "已进入全屏考试界面");

    const geo = await evalJS(`(()=>{const b=document.querySelector('#examSide .exam-list');const s=document.querySelector('#examSide');
      return {has:!!b, scrollH:b?b.scrollHeight:0, clientH:b?b.clientHeight:0, pos:s?getComputedStyle(s).position:''};})()`);
    console.log("  题卡:", JSON.stringify(geo));
    ok(geo.has && geo.scrollH > geo.clientH + 20, "题卡是一个可滚动容器（滚动高度 > 可视高度）");

    console.log("\n[1] 滚到中段后点击当前可见的题号，位置应保持");
    await evalJS(`document.querySelector('#examSide .exam-list').scrollTop = 260`);
    await sleep(120);
    const before = await evalJS(`document.querySelector('#examSide .exam-list').scrollTop`);
    // 找一个当前可见的题号按钮（第 20 题左右）
    const clicked = await evalJS(`(()=>{const box=document.querySelector('#examSide .exam-list');
      const br=box.getBoundingClientRect();
      const el=[...box.querySelectorAll('.exam-li')].find(e=>{const r=e.getBoundingClientRect();return r.top>br.top+10&&r.bottom<br.bottom-10;});
      if(!el)return null; const n=el.dataset.arg; el.click(); return n;})()`);
    await sleep(400);
    const after = await evalJS(`document.querySelector('#examSide .exam-list').scrollTop`);
    console.log(`  点击第 ${Number(clicked) + 1} 题：scrollTop ${before} -> ${after}`);
    ok(after !== 0, "切换考题后题卡没有跳回顶部");
    ok(Math.abs(after - before) <= 60, `题卡基本停在原位置（偏差 ${Math.abs(after - before)}px）`);

    console.log("\n[2] 连续「下一题」时，题卡应跟随当前题滚动");
    await evalJS(`document.querySelector('#examSide .exam-list').scrollTop = 0`);
    await sleep(120);
    for (let i = 0; i < 25; i++) { await evalJS(`document.querySelector('.exam-actions [data-act="next"]').click()`); await sleep(60); }
    await sleep(400);
    const follow = await evalJS(`(()=>{const box=document.querySelector('#examSide .exam-list');
      const cur=box.querySelector('.exam-li.cur'); if(!cur)return null;
      const br=box.getBoundingClientRect(), cr=cur.getBoundingClientRect();
      return {top:Math.round(box.scrollTop), visible: cr.top>=br.top-1 && cr.bottom<=br.bottom+1, txt:cur.textContent.trim().slice(0,10)};})()`);
    console.log("  ", JSON.stringify(follow));
    ok(follow && follow.visible, "连续下一题后，当前题仍留在题卡可视区内（题卡自动跟随）");
    ok(follow && follow.top > 0, "题卡确实向下滚动了（说明跟随生效）");

    console.log("\n[3] 作答后题卡位置也应保持");
    // 先切到当前可见的题，再作答，确保「保持原位」而非「跟随」
    await evalJS(`(()=>{const box=document.querySelector('#examSide .exam-list');const br=box.getBoundingClientRect();
      const el=[...box.querySelectorAll('.exam-li')].find(e=>{const r=e.getBoundingClientRect();return r.top>br.top+10&&r.bottom<br.bottom-10;});
      if(el)el.click();})()`);
    await sleep(400);
    await evalJS(`document.querySelector('#examSide .exam-list').scrollTop = 200`);
    await sleep(120);
    const b2 = await evalJS(`document.querySelector('#examSide .exam-list').scrollTop`);
    await evalJS(`(document.querySelector('.exam-opts .opt')||{click(){}}).click()`);
    await sleep(150);
    await evalJS(`(document.querySelector('[data-act="submit"]')||{click(){}}).click()`);
    await sleep(500);
    const a2 = await evalJS(`document.querySelector('#examSide .exam-list').scrollTop`);
    console.log(`  作答前 ${b2} -> 作答后 ${a2}`);
    ok(Math.abs(a2 - b2) <= 8, `作答后题卡停在原位置（${b2} -> ${a2}）`);

    console.log("\n[4] 答题区切题仍回到顶部（这是预期行为）");
    await evalJS(`window.scrollTo(0, 400)`);
    await sleep(150);
    await evalJS(`document.querySelector('.exam-actions [data-act="next"]').click()`);
    await sleep(400);
    const wy = await evalJS(`Math.round(window.scrollY)`);
    console.log("  切题后 window.scrollY =", wy);
    ok(wy === 0, "答题区切题后回到顶部");
  } catch (e) {
    fail++;
    console.log("\nERROR:", e.message);
  } finally {
    try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  }
})();
