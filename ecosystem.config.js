/**
 * pm2 启动配置 —— HCIA-AI Solution 题库刷题平台
 *
 * 前置：在本目录执行 `npm install pm2`（已装则可跳过）
 * 用法（在本目录下执行 pm2）：
 *   pm2 start ecosystem.config.js      # 启动
 *   pm2 stop hcia-platform             # 停止（已做数据库归档）
 *   pm2 restart hcia-platform          # 重启
 *   pm2 logs hcia-platform             # 查看实时日志
 *   pm2 delete hcia-platform           # 从 pm2 列表移除
 *   pm2 save                           # 保存当前进程列表
 *   pm2 startup                        # 生成开机自启脚本（用于服务器常驻）
 */
module.exports = {
  apps: [
    {
      name: "hcia-platform",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",        // 单实例：服务有状态（SQLite 本地文件），不可用 cluster 多开
      autorestart: true,        // 意外崩溃自动拉起
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,             // 不监听文件改动自动重启（避免开发时误重启）
      kill_timeout: 8000,       // 给 SIGINT 留足时间做 WAL 归档
      env: {
        PORT: 8787,
        HOST: "0.0.0.0"
      }
    }
  ]
};
