# HCIA-AI Solution 题库刷题平台

面向 **HCIA-AI Solution V1.0** 认证的本地刷题平台(AI出题，不代表已出现过的题库)：965 道题、练习 / 模拟考试双模式、账号体系 + SQLite 进度云同步。

零框架：服务端是 Node 原生 `http`，前端是原生 JS（无 React/Vue/构建步骤），改完刷新即可生效。
效果如下：

![示意圖](hcia.png)
![示意圖](hcia1.png)
![示意圖](总纲.png)
---

## 1. 功能

| 模块 | 能力 |
| --- | --- |
| 首页看板 | 总进度、错题/收藏数量、快捷入口（顺序刷全部 / 随机 50 题 / 重做错题本 / 进入考试） |
| 练习模式 | 按章节、题型、顺序/随机、题量（20 / 50 / 100 / 全部）自由组卷 |
| 模拟考试 | 固定 60 题 1000 分制，倒计时，答题过程中不判对错，交卷统一评分 |
| 错题本 / 收藏夹 | 练习与考试都会沉淀，可一键重做 |
| 题库浏览 | 8 章全文搜索，按题型过滤，可直接跳进练习 |
| 考试记录 | 每次考试留存题目清单与作答快照，可查看详情、逐题回顾、重做本套题 |
| 断点续练 | 未答完的练习/考试自动存档，刷新、关机、换浏览器登录都能接着答 |
| 账号体系 | 注册/登录/改密，进度存服务端 SQLite，多设备同步 |
| 主题 | 亮/暗色，默认跟随系统 |

---

## 2. 快速开始(可直接下载后打开index.html，数据保存在浏览器，更换浏览器或清除缓存数据丢失)

```bash
想要不丢失数据，按以下操作，需要运行一个服务，打开后注册登入（数据保存本地 sqlite文件）
cd hcia-platform
npm install          # 只装 better-sqlite3 和 pm2
node server.js       # 默认 http://127.0.0.1:8787
```

浏览器打开 <http://127.0.0.1:8787>。**不用注册也能用**，进度存在浏览器本地；登录后才会同步到服务端。

换端口：`PORT=9000 node server.js`；对外提供访问：`HOST=0.0.0.0 node server.js`（默认已是）。

长期常驻用 pm2：

```bash
pm2 start ecosystem.config.js   # 启动
pm2 logs hcia-platform          # 看日志
pm2 stop hcia-platform          # 停止（会先归档 SQLite WAL）
```

> Node **≥ 22**（`better-sqlite3` 的硬要求，本机实测 22.22.2）。它是原生模块，换 Node 大版本需要重新 `npm install`。

---

## 3. 目录结构

```
hcia-platform/
├── server.js              # HTTP 服务 + REST 接口（原生 http，无 Express）
├── index.html             # 单页骨架
├── assets/
│   ├── css/style.css      # 主样式（含暗色主题变量）
│   ├── css/auth.css       # 登录/注册弹窗
│   ├── js/app.js          # 应用主逻辑（题库装载、渲染、判题、记录）
│   ├── js/auth.js         # 登录注册 + 云端同步合并
│   └── js/data/ch1..8.js  # 题库数据（挂载到 window.QB_CHAPTERS）
├── data/
│   └── hcia.db            # SQLite：账号、会话、进度（勿手动改）
├── ecosystem.config.js    # pm2 配置
├── validate.js            # 题库自检（题数、题型、uid 重复、去重建议）
├── dedup-apply.js         # 题库去重（已执行，保留备查）
├── dedup-removal.json     # 去重清单
├── smoke-dedup.js         # 去重后的冒烟校验
└── test-*.js              # 端到端测试，见第 8 节
```

---

## 4. 题库数据

| 章节 | 名称 | 题数 |
| --- | --- | --- |
| 1 | 人工智能发展趋势 | 138 |
| 2 | 人工智能和算力基础 | 151 |
| 3 | 人工智能业务流程概述 | 204 |
| 4 | 华为智算方案和产品介绍 | 176 |
| 5 | 昇腾大模型解决方案概述 | 71 |
| 6 | 大模型部署与商业模式介绍 | 100 |
| 7 | 业界大模型及应用 | 47 |
| 8 | 专业技术人员职业素养与组织赋能 | 78 |
| | **合计** | **965**（判断 276 / 单选 352 / 多选 164 / 填空 173） |

**题型字段**：`t` = `judge` 判断 / `single` 单选 / `multi` 多选 / `blank` 填空；`q` 题干（填空用 `____` 占位）、`o` 选项、`a` 答案、`ex` 解析。

**关键约定**：每道题必须有 `uid`。它是题库增删题后仍不变的永久编号，错题本、收藏、作答记录都按 `uid` 归档。没有 `uid` 时会退化成 `章号-序号`，一旦章节内插入或删除题目，历史记录就会错位。

改完题库跑一次自检：

```bash
node validate.js     # 输出章节题数、题型分布、uid 重复、疑似重复题
```

---

## 5. 数据存储与同步

**本地**（未登录时全部存在浏览器）：localStorage key = `hcia_ai_qb_v2`

```js
{
  stat:    { [uid]: {done, right} },   // 每题练习次数/答对次数
  answers: { [uid]: {val, ok, t} },    // 每题最近一次具体作答（仅在后台留档，界面不展示）
  wrong:   [uid],                      // 错题本
  fav:     [uid],                      // 收藏夹
  records: [ ... ],                    // 考试记录
  session: { mode, pos, ids, answers, savedAt },  // 未完成的练习/考试断点
  theme:   "dark" | "light"
}
```

**服务端**：SQLite `data/hcia.db`（WAL 模式），三张表 —— `users` / `sessions` / `progress`。
密码用 `scrypt`（16 字节随机 salt，64 字节摘要）加盐哈希，不存明文；会话是 32 字节随机 token，写入 `HttpOnly + SameSite=Lax` 的 Cookie，有效期 30 天。

**合并策略**（`assets/js/auth.js` 的 `applyServerData`）：

| 数据 | 策略 |
| --- | --- |
| `answers` | 按题目逐条合并，取时间戳较新的那份（换设备答题不互相覆盖） |
| `session` | 按 `savedAt` 比较，最后写入者胜 |
| `stat` / `wrong` / `fav` / `records` | 以云端为准（云端是唯一权威副本） |

首次登录时若本机有数据而云端为空，会自动上传；关闭页面前也会强制落云一次。

---

## 6. 模拟考试规则

固定卷结构，与官方题型分布对齐：

| 题型 | 题数 | 单题分 | 小计 |
| --- | --- | --- | --- |
| 判断题 | 18 | 10 | 180 |
| 单选题 | 20 | 19 | 380 |
| 多选题 | 16 | 20 | 320 |
| 填空题 | 6 | 20 | 120 |
| **合计** | **60** | | **1000（600 分合格）** |

- 时长可选 30 / 60 / 90 / 120 分钟
- 抽题方式：**按认证考点占比**（1 章 17% / 2 章 17% / 3 章 22% / 4 章 22% / 5 章 6% / 6 章 10% / 7 章 6%）或**完全随机**
- 答题过程中**不显示对错**，交卷后统一评分
- 未答完可中途退出，倒计时与已作答内容都会存档，回来继续考
- 交卷后：成绩单（分题型得分）→ 逐题回顾 → 重做本次错题 / 再考一次

**记录详情**：每条记录包含 60 道题的 id 和作答快照（JSON 约 2.4 KB），所以离开成绩单后仍能回看当时每道题答了什么、正确答案是什么。安装本功能之前产生的旧记录没有快照，只能看总分，列表里会标注「无法逐题回顾」。记录多了建议偶尔「清空记录」。

---

## 7. 界面交互约定

- **练习模式不回显上次作答**。原先做过的题会显示「上次作答：B ✗ 错误」，等于变相泄题，现已移除（`store.answers` 仍留档，只是不展示）。
- **题卡滚动位置**在切题后保持不变，只有当当前题滚出视野时才把它带回可视区内；答题、收藏这类原地重渲染不会移动题卡。
- 答题区（右侧）切题时回到题干顶部，这是刻意的 —— 换了一道新题从开头看才合理。
- 键盘：判断/单选题按数字键 `1`~`N` 直接选选项，`←` `↑` 上一题，`→` `↓` `Enter` 下一题。

---

## 8. 测试

端到端测试用**系统 Chrome + CDP** 跑（本机没装 playwright/puppeteer）。**先确保 8787 上的服务已启动**。

```bash
node test-exam.js          # 模拟考试全流程   97 项
node test-exam-nav.js      # 考试导航/题卡     35 项
node test-exam-scroll.js   # 题卡滚动定位       8 项
node test-records.js       # 考试记录详情      36 项
```

`test-session.js` 用的是 jsdom，必须带上模块路径：

```bash
# Windows Git Bash
NODE_PATH="C:/Users/cheny/.workbuddy/binaries/node/workspace/node_modules" node test-session.js
```

> 为什么不全用 jsdom：jsdom 没有布局引擎，`scrollTop` 恒为 0，滚动相关的行为测不出来。
> 测试用 Vite-less 静态资源，改了 `app.js` 直接重跑即可，不用重启服务。

---

## 9. 服务端接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/me` | 当前登录用户（未登录返回 `user: null`） |
| POST | `/api/register` | 注册；用户名 2–20 位（中英文/数字/`_.-`），密码 ≥ 6 位 |
| POST | `/api/login` | 登录，下发 `sid` Cookie |
| POST | `/api/logout` | 注销当前会话 |
| GET | `/api/state` | 拉取云端进度（需登录） |
| POST | `/api/state` | 上传进度，单份上限 4 MB（需登录） |
| POST | `/api/account` | 修改密码（需登录，会踢掉该账号其他会话） |

静态资源：`data/` 与 `node_modules/` 目录不可通过 HTTP 访问（返回 403）。请求体上限 2 MB。

---

## 10. 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 端口被占用 | `PORT=xxxx node server.js` 换端口，或关掉占用程序 |
| 改了 `style.css`/`app.js` 没生效 | 浏览器缓存，Ctrl+F5 强刷（静态资源是 `Cache-Control: no-cache`，一般不用） |
| 登录后进度丢了 | 云端覆盖本地（`stat`/`wrong`/`fav`/`records` 以云端为准）。换账号前先确认 |
| `Cannot find module 'jsdom'` | 跑 `test-session.js` 时漏了 `NODE_PATH`，见第 8 节 |
| CDP 测试起不来浏览器 | 脚本里写死了本机 Chrome 路径 `C:\Program Files\Google\Chrome\Application\chrome.exe`，换机器要改 |
| `data/hcia.db-wal` 很大 | 正常，WAL 预写日志。停止服务时会 `wal_checkpoint(TRUNCATE)` 归档成单文件 |
| 想彻底重置 | 停服务 → 删 `data/hcia.db*` → 重启；浏览器里清掉 `hcia_ai_qb_v2` 这个 localStorage key |

---

## 11. 题库去重历史

2026-09 对 965 题做过一轮全量去重（`dedup-apply.js` + `dedup-removal.json`），删除记录与去重前的原始备份都在：

- 备份：`data/_backup_before_dedup/`
- 删除清单：`dedup-removal.json`
- 事后冒烟校验：`smoke-dedup.js`

如需回滚，把备份目录下的 `chN.js` 覆盖回 `assets/js/data/`，再跑 `node validate.js` 确认题数。
