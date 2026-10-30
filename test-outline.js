/* 课程总纲：侧栏入口 + 展示总纲.png（服务需已运行在 8787） */
const { JSDOM } = require("jsdom");
const http = require("http");
const HOST = "http://127.0.0.1:8787";
const IMG = "/assets/img/" + encodeURIComponent("总纲.png");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS - " + m); } else { fail++; console.log("  FAIL - " + m); } };

const head = url => new Promise(res => {
  http.get(url, r => { r.resume(); res(r.statusCode); }).on("error", () => res(0));
});

(async () => {
  console.log("\n[0] 图片资源");
  const code = await head(HOST + IMG);
  ok(code === 200, "总纲.png 可通过 HTTP 访问（" + IMG + " → " + code + "）");

  const dom = await JSDOM.fromURL(HOST + "/", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
  for (let i = 0; i < 100; i++) { if (dom.window.HCIA_APP) break; await sleep(100); }
  await sleep(400);
  const w = dom.window, d = w.document;
  const click = sel => { const e = d.querySelector(sel); if (e) e.click(); return !!e; };
  const txt = () => (d.querySelector("#content") || {}).textContent || "";

  console.log("\n[1] 左侧栏入口");
  const item = d.querySelector('.nav-item[data-view="outline"]');
  ok(!!item, "侧栏出现「课程总纲」导航项");
  ok(item && item.textContent.trim() === "课程总纲", "文案为「课程总纲」（实际：" + (item ? item.textContent.trim() : "-") + "）");
  ok(item && !!item.querySelector(".ic-outline"), "带有图标 .ic-outline");
  const iconBg = w.getComputedStyle(item.querySelector(".ic-outline")).webkitMaskImage ||
    w.getComputedStyle(item.querySelector(".ic-outline")).maskImage;
  ok(!!iconBg && iconBg.indexOf("svg") > 0, "图标样式已生效（mask-image 非空）");

  console.log("\n[2] 打开后展示图片");
  item.click(); await sleep(350);
  ok((d.querySelector("#viewTitle") || {}).textContent === "课程总纲", "顶栏标题切换为「课程总纲」");
  ok(item.classList.contains("active"), "导航项高亮为当前页");
  ok(!!d.querySelector(".outline-wrap"), "内容区出现总纲容器");
  const img = d.querySelector("#outlineImg");
  ok(!!img, "渲染出 <img id=outlineImg>");
  ok(img && decodeURIComponent(img.getAttribute("src")).indexOf("总纲.png") >= 0,
    "src 指向总纲.png（实际：" + (img ? decodeURIComponent(img.getAttribute("src")) : "-") + "）");
  ok(img && img.style.width === "100%", "默认按容器宽度 100% 显示");
  ok(txt().includes("课程总纲"), "页面含「课程总纲」标题");

  console.log("\n[3] 缩放 / 适应宽度 / 新窗口");
  click('[data-act="outline-zoom"][data-arg="1"]'); await sleep(120);
  ok(d.querySelector("#outlineImg").style.width === "125%", "点「＋」放大到 125%（实际 " + d.querySelector("#outlineImg").style.width + "）");
  ok((d.querySelector("#outlineScale") || {}).textContent === "125%", "比例文字同步为 125%");
  click('[data-act="outline-zoom"][data-arg="-1"]'); await sleep(120);
  click('[data-act="outline-zoom"][data-arg="-1"]'); await sleep(120);
  ok(d.querySelector("#outlineImg").style.width === "75%", "连点两次「－」到 75%");
  click('[data-act="outline-fit"]'); await sleep(120);
  ok(d.querySelector("#outlineImg").style.width === "100%", "「适应宽度」回到 100%");
  const link = d.querySelector('.outline-bar a[target="_blank"]');
  ok(!!link && decodeURIComponent(link.getAttribute("href") || "").indexOf("总纲.png") >= 0, "有「新窗口查看原图」链接");

  console.log("\n[4] 上限保护");
  for (let i = 0; i < 12; i++) click('[data-act="outline-zoom"][data-arg="1"]');
  await sleep(150);
  ok(parseInt(d.querySelector("#outlineImg").style.width) <= 300, "放大不会超过 300%（实际 " + d.querySelector("#outlineImg").style.width + "）");
  for (let i = 0; i < 20; i++) click('[data-act="outline-zoom"][data-arg="-1"]');
  await sleep(150);
  ok(parseInt(d.querySelector("#outlineImg").style.width) >= 50, "缩小不会低于 50%（实际 " + d.querySelector("#outlineImg").style.width + "）");

  console.log("\n[5] 与其他页面互切");
  click('.nav-item[data-view="home"]'); await sleep(300);
  ok((d.querySelector("#viewTitle") || {}).textContent === "首页看板", "可切回首页看板");
  click('.nav-item[data-view="outline"]'); await sleep(300);
  ok(!!d.querySelector("#outlineImg"), "再切回课程总纲仍正常显示");
  ok(!d.body.classList.contains("exam-fs"), "不会残留考试全屏样式");

  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
