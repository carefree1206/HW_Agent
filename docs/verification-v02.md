# v0.2 工程验证摘要

验证日期：2026-10-22。环境：Windows、Python 3.12、Node.js 24。范围为本地合成演练，不含华为账号、真实模型、现场通信或浏览器像素验收。

| 检查 | 结果 | 原始依据 |
| --- | --- | --- |
| TypeScript 与 Vite 生产构建 | 成功 | `npm run build` 的本机输出；CI 另行运行并记录 |
| Python HTTP 集成与独立约束测试 | 30/30 通过 | 本机 JUnit XML 汇总 |
| 界面交互与竞态测试 | 18/18 通过 | Vitest / jsdom JUnit XML 汇总 |
| 本机服务读取检查 | 通过 | 页面与构建资源 200、规则 8 条、完整工具结果摘要一致 |

仓库内的[脱敏机器可读摘要](verification/v02-summary.json)从实际 JUnit 与 HTTP 检查生成，保留用例、计数、耗时、记录摘要和实现文件摘要；移除了本机主机名、绝对路径及运行演练身份。原始运行文件留在被忽略的 `artifacts/` 中，不要求团队复制它们才能运行。

复现时先按 README 安装依赖，然后执行：

```powershell
npm run build
npm run test:web
.\.venv\Scripts\python.exe -m pytest tests -q --basetemp .pytest-tmp
```

Python 测试会启动独立端口与临时 SQLite，检查真实 HTTP 行为。界面测试模拟实际点击、切页、重开、离线确认、迟到响应、存储配额失败和重试。

关键回归包括：新通知不继承历史确认、旧页面/任务不能写新演练、同幂等键改参数拒绝、错误批准重试拒绝、区域核实不串数据、旧方案失效、无解保留电量缺口、重新计算摘要仍不能绕过约束、完整响应在归档后仍可读、已完成回执不会被重试改回等待。

这 48 项是软件回归用例，不能换算为 48 个独立灾害场景、准确率、救助人数或相对竞品优势。模型、RAG、算法对照和用户试用各有独立任务，见[后续任务](backlog.md)。GitHub Actions 运行结果以对应提交的真实状态为准，不用本机通过替代云端通过。

## GitHub 干净环境验证

仓库增加了 Ubuntu、Python 3.12、Node.js 24 的 [构建与回归工作流](../.github/workflows/ci.yml)。初次运行揭示原测试命令依赖本机已有的 `.cache/` 父目录，导致临时目录创建失败；已将测试临时目录改为仓库根目录下被忽略的 `.pytest-tmp/`，修复新成员克隆后的命令可用性。每次提交的实际结果可在 [Actions](https://github.com/carefree1206/HW_Agent/actions) 查看。
