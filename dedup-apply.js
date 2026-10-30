/* 题库去重执行脚本
 *   node dedup-apply.js          生成删除方案 dedup-removal.json 并打印（不改动文件）
 *   node dedup-apply.js --apply  固化 uid 并执行删除
 *
 * 删除前会先给每题写入永久 uid（=删除前的位置 id），
 * 这样删除后题目位置变化也不会让已保存的错题本/收藏/进度错位。
 */
const fs = require("fs");
const path = require("path");
const APPLY = process.argv.includes("--apply");

global.window = {};
const dir = path.join(__dirname, "assets/js/data");
const FILES = fs.readdirSync(dir).filter(f => /^ch\d+\.js$/.test(f)).sort();
FILES.forEach(f => eval(fs.readFileSync(path.join(dir, f), "utf8")));
const CHAPTERS = (global.window.QB_CHAPTERS || []).sort((a, b) => a.id - b.id);

const all = [];
CHAPTERS.forEach(ch => ch.questions.forEach((q, i) => {
  all.push({ id: ch.id + "-" + (i + 1), chId: ch.id, idx: i, t: q.t, q: q.q, o: q.o, a: q.a, ex: q.ex });
}));

function norm(s) {
  s = String(s == null ? "" : s);
  s = s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toLowerCase();
  return s.replace(/[\s\p{P}\p{S}]/gu, "");
}
function bg(s) { const S = new Set(); if (s.length < 2) { if (s) S.add(s); return S; } for (let i = 0; i < s.length - 1; i++) S.add(s.slice(i, i + 2)); return S; }
function dice(A, B) { if (!A.size || !B.size) return 0; const [x, y] = A.size <= B.size ? [A, B] : [B, A]; let n = 0; x.forEach(v => { if (y.has(v)) n++; }); return 2 * n / (A.size + B.size); }
function factText(q) {
  if (q.t === "blank") { let s = q.q; (Array.isArray(q.a) ? q.a : []).forEach(g => { s = s.replace(/_{3,}/, Array.isArray(g) ? String(g[0]) : String(g)); }); return s; }
  if (q.t === "single") return q.q + " " + (q.o || [])[q.a];
  if (q.t === "multi") return q.q + " " + (q.a || []).map(i => (q.o || [])[i]).join(" ");
  return q.q;
}
/* 考查强度：多选 > 单选 > 填空 > 判断(错) > 判断(对，答案已在题干里) */
function strength(q) { return q.t === "multi" ? 5 : q.t === "single" ? 4 : q.t === "blank" ? 3 : (q.a === 1 ? 2 : 1); }
all.forEach(q => { q.fbg = bg(norm(factText(q))); q.qbg = bg(norm(q.q)); q.s = strength(q); });

const T = 0.85;
const pairs = [];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const a = all[i], b = all[j];
  const fs_ = dice(a.fbg, b.fbg), qs = dice(a.qbg, b.qbg);
  const sim = (a.t === "blank" && b.t === "blank") ? Math.max(fs_, qs) : fs_;
  if (sim >= T) pairs.push({ i, j, sim: +sim.toFixed(3) });
}
const parent = all.map((_, i) => i);
const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
pairs.forEach(p => { const a = find(p.i), b = find(p.j); if (a !== b) parent[a] = b; });
const groups = new Map();
all.forEach((q, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(q); });

/* 人工裁决：这些题虽被判为重合，但实际考查的是不同事实，强制保留 */
const FORCE_KEEP = new Set([
  "2-160",   // 图神经网络缩写(GNN) ≠ 2-159 循环神经网络缩写(RNN)，不同事实
  "2-15",    // 判断题含「BN 由 Google 提出」考点，2-91 填空未覆盖，需保留
]);
/* 人工裁决：额外删除（同簇中保留信息更完整的那一道） */
const FORCE_DROP = new Set([
  "6-71",    // 同簇 6-101 同时覆盖「教师网络 / 学生网络」，信息更完整
]);

const removal = new Set();
const plan = [];
groups.forEach(g => {
  if (g.length < 2) return;
  const sorted = g.slice().sort((x, y) => (y.s - x.s) || (x.chId - y.chId) || (x.idx - y.idx));
  const keep = sorted.find(q => !FORCE_DROP.has(q.id)) || sorted[0];
  const drop = sorted.filter(q => q !== keep && !FORCE_KEEP.has(q.id));
  if (!drop.length) return;
  drop.forEach(q => removal.add(q.id));
  plan.push({
    keep: { id: keep.id, t: keep.t, q: keep.q },
    drop: drop.map(q => ({ id: q.id, t: q.t, q: q.q }))
  });
});
FORCE_DROP.forEach(id => { if (![...removal].includes(id)) { removal.add(id); plan.push({ keep: null, drop: [{ id, t: "?", q: "(强制删除)" }] }); } });

console.log("阈值", T, "｜重合簇", plan.length, "｜删除", removal.size, "题 ｜剩余", all.length - removal.size);
const dropType = {}, beforeType = {};
all.forEach(q => { beforeType[q.t] = (beforeType[q.t] || 0) + 1; if (removal.has(q.id)) dropType[q.t] = (dropType[q.t] || 0) + 1; });
console.log("题型分布 前:", JSON.stringify(beforeType), " 删除:", JSON.stringify(dropType));
plan.forEach(p => {
  console.log(`\n保留 [${p.keep ? p.keep.id + " " + p.keep.t : "-"}] ${p.keep ? p.keep.q.slice(0, 60) : ""}`);
  p.drop.forEach(d => console.log(`   删除 [${d.id} ${d.t}] ${d.q.slice(0, 60)}`));
});
fs.writeFileSync(path.join(__dirname, "dedup-removal.json"), JSON.stringify({ threshold: T, plan, remove: [...removal] }, null, 2), "utf8");
console.log("\n方案已写入 dedup-removal.json");

if (!APPLY) { console.log("（仅推演，加 --apply 才真正执行）"); process.exit(0); }

/* ================= 执行 ================= */
let totalDrop = 0, totalUid = 0;
FILES.forEach(f => {
  const fp = path.join(dir, f);
  const chId = parseInt(f.match(/ch(\d+)/)[1], 10);
  const lines = fs.readFileSync(fp, "utf8").split(/\r?\n/);
  const out = [];
  let qi = 0;
  lines.forEach(line => {
    const m = line.match(/^(\s*\{\s*t:\s*"(\w+)"\s*,\s*)/);
    if (!m) { out.push(line); return; }
    qi++;
    const id = chId + "-" + qi;
    if (removal.has(id)) { totalDrop++; return; }          // 删除
    let nl = line;
    if (!/\buid\s*:/.test(nl)) { nl = nl.replace(m[1], m[1] + 'uid: "' + id + '", '); totalUid++; }
    out.push(nl);
  });
  fs.writeFileSync(fp, out.join("\n"), "utf8");
  console.log(`  ${f}: 剩余 ${qi - [...removal].filter(x => x.startsWith(chId + "-")).length} 题`);
});
console.log(`\n完成：删除 ${totalDrop} 题，写入 uid ${totalUid} 条`);
