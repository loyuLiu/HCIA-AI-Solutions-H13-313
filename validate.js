/* 题库数据自检脚本（node validate.js） */
const fs = require("fs");
const path = require("path");
global.window = {};
const dir = path.join(__dirname, "assets/js/data");
fs.readdirSync(dir).filter(f => /^ch\d+\.js$/.test(f)).sort().forEach(f => {
  eval(fs.readFileSync(path.join(dir, f), "utf8"));
});
const CHAPTERS = (global.window.QB_CHAPTERS || []).sort((a, b) => a.id - b.id);
let all = [], errs = [], seen = new Map(), uids = new Map();
CHAPTERS.forEach(ch => {
  ch.questions.forEach((q, i) => {
    const id = q.uid || (ch.id + "-" + (i + 1));
    const where = `${f => f}`.length; // noop
    const tag = `ch${ch.id}#${i + 1}`;
    if (!q.uid) errs.push(`${tag} 缺少 uid（题库改动后进度会错位）`);
    else if (uids.has(q.uid)) errs.push(`${tag} uid 重复: ${q.uid}（与 ${uids.get(q.uid)} 冲突）`);
    else uids.set(q.uid, tag);
    if (!["judge", "single", "multi", "blank"].includes(q.t)) errs.push(`${tag} 未知题型 ${q.t}`);
    if (!q.q || !q.q.trim()) errs.push(`${tag} 题干为空`);
    if (!q.ex || !q.ex.trim()) errs.push(`${tag} 解析为空`);
    const key = q.q.trim();
    if (seen.has(key)) errs.push(`${tag} 题干重复，与 ${seen.get(key)} 相同`);
    else seen.set(key, tag);
    if (q.t === "judge") {
      if (![0, 1].includes(q.a)) errs.push(`${tag} judge 答案非法: ${q.a}`);
    } else if (q.t === "single") {
      if (!Array.isArray(q.o) || q.o.length < 2) errs.push(`${tag} single 选项不足`);
      if (!(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length)) errs.push(`${tag} single 答案越界: ${q.a}`);
    } else if (q.t === "multi") {
      if (!Array.isArray(q.o) || q.o.length < 2) errs.push(`${tag} multi 选项不足`);
      if (!Array.isArray(q.a) || q.a.length < 2) errs.push(`${tag} multi 答案应至少 2 项`);
      (q.a || []).forEach(x => { if (!(Number.isInteger(x) && x >= 0 && x < q.o.length)) errs.push(`${tag} multi 答案越界: ${x}`); });
      if (q.a && new Set(q.a).size !== q.a.length) errs.push(`${tag} multi 答案有重复项`);
    } else if (q.t === "blank") {
      const n = (q.q.match(/____/g) || []).length;
      if (!Array.isArray(q.a) || q.a.length !== n) errs.push(`${tag} blank 空位数 ${n} 与答案组数 ${(q.a || []).length} 不一致`);
      (q.a || []).forEach(g => {
        if (!Array.isArray(g) || !g.length || g.some(x => !String(x).trim())) errs.push(`${tag} blank 答案组为空`);
      });
    }
    all.push(Object.assign({ id }, q));
  });
});
const byType = {};
all.forEach(q => byType[q.t] = (byType[q.t] || 0) + 1);
console.log("章节数:", CHAPTERS.length);
CHAPTERS.forEach(c => console.log("  ", c.name, c.questions.length, "题"));
console.log("总题数:", all.length, byType);
console.log("错题数:", errs.length);
errs.slice(0, 60).forEach(e => console.log("  ✗", e));
process.exit(errs.length ? 1 : 0);
