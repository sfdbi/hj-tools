# AGENTS.md — hj-tools 工具平台开发规范

本仓库是"汉江局技术管理室 · 工具集"网站（https://sfdbi.github.io/hj-tools/ ，GitHub Pages 自动部署）。
任何 agent 接手开发前，先读完本文件再动手。

## 架构

- HashRouter 单页应用（React + Vite + Tailwind）。站点大门密码在 `src/portal/PasswordGate.tsx`（SHA-256 校验），不要改动。
- 门户卡片注册表：`src/portal/PortalHome.tsx` 的 `TOOLS` 数组。
- 路由：`src/App.tsx`。
- **工具本体 = 自包含单文件 HTML**，放 `public/<工具名>/index.html`（JS/CSS 全部内联，不依赖外网 CDN）。
- 每个工具配一个壳页面 `src/tools/<工具名>/XxxTool.tsx`（顶栏 + iframe），照抄 `src/tools/attendance/AttendanceTool.tsx`。
- 视觉：深蓝底 `#0a2540` + 流金 `#d4af37`，署名"汉江局技术管理室"。
- 有安卓包的工具在 TOOLS 条目加 `apk: './apk/xxx.apk'`，卡片下方自动出现下载按钮。

## 构建与自检

- npm 用全路径：`"D:\KimiData\daimon-share\daimon\command-process-owner\bin\npm.cmd" run build`
- 单文件工具的内嵌 JS 用 `node --check` 检查；`dist/` 不入库。

## 提交与推送（严格遵守）

1. 只 `git add` 本次相关文件；提交后 `git show --stat HEAD` 核对无夹带。
2. github.com 主站不可达，**推送必须走 Git Data API**：
   `python C:\Users\23583\Documents\kimi\workspace\flow-discharge\ghpush.py`
   - 逐字节复现本地提交到远程（sha 一致）；新增文件先加进脚本顶部 `FILES` 列表；
   - 远程领先本地时先用同目录 `ghsync.py` 同步。
3. 推送后验证（约 90 秒）：
   `curl -H "Authorization: Bearer <TOKEN>" "https://api.github.com/repos/sfdbi/hj-tools/actions/runs?per_page=1"` → `completed success`；
   再 curl 线上文件确认内容更新（CDN 缓存可能需多刷几次）。

## 安卓 APK（可选）

- 壳工程模板：`C:\Users\23583\Documents\kimi\workspace\apk-shell-att`（WebView + AndroidSaver 下载桥 + 更新检查）。
- 构建：`set JAVA_HOME=…\toolchain\jdk17\home`，`..\toolchain\gradle\gradle-8.7\bin\gradle.bat assembleDebug`。
- 发布：`public/apk/<工具名>.apk`；更新时必须同时递增 `public/apk/version.json` 与页面内 `APP_VER`，旧 App 才会弹更新提示。

## 禁止事项

- 不要动考勤数据仓库 `sfdbi/hj-attendance-data` 的读写逻辑与 `config.json`（门禁密码云端覆盖）。
- 不要在公开代码里写入任何 Token；令牌只放在本地脚本或用户设备上。
