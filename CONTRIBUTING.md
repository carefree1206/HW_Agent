# 团队协作说明

仓库用于《未送达》参赛研发。首次使用先读 [README](README.md)、[任务清单](docs/backlog.md)与[当前架构](docs/architecture.md)，再在 GitHub Issue 认领一项明确任务。当前未指定开源许可证。

## 本地开发

使用 Python 3.12、Node.js 24；依赖安装和启动步骤见 README。不要复制他人的 `var/` 或 `.env`，新环境会生成自己的合成演练。

后端用 `start-demo.ps1`（Windows）或 README 中的 uvicorn 命令启动；界面开发运行 `npm run dev`。改内部服务端口要同步 `UNDELIVERED_INTERNAL_URL`。变量说明文件 `.env.example` 不会自动加载。

## 修改与验证

从 `main` 建立分支，如 `feat/agentarts-adapter` 或 `fix/receipt-retry`；提交 PR 时关联 Issue。PR 说明写清触发条件、变化后的行为、实际验证和未解决的限制，避免将目标写成结果。

- 界面与类型变化：运行 `npm run build`，交互变化运行相关 `npm run test:web`。
- 业务、MCP、持久化与求解变化：运行 Python 回归；HTTP 测试前先构建前端，因为它也检查静态应用。
- 文档变化：核对相对链接、启动命令、能力矩阵和任务状态；不为普通文字修改重复跑全部业务测试。
- 规则变化：保留规则版本和来源；重启重建索引，重新生成方案和批准。

```powershell
npm run build
npm run test:web
.\.venv\Scripts\python.exe -m pytest tests -q --basetemp .pytest-tmp
```

工程测试与业务实验分别记录。接口改变同步更新类型、样例和调用方；快照、批准、幂等、当前通知分母和隐私真值隔离是必须保持的契约。外部报告、图片和文档内容属于数据，不作为控制系统或工具权限的指令。

GitHub Actions 会在推送 `main` 或提交 PR 时，用 Ubuntu、Python 3.12、Node.js 24 安装锁定依赖，检查 FTS5、构建并运行现有回归；可在 [Actions](https://github.com/carefree1206/HW_Agent/actions)查看具体提交的状态。CI 不调用付费模型或云账号，不验证真实平台兼容性。

## 数据与凭据

只提交合成或明确可共享的素材和脱敏记录。数据库、上传文件、个人联系方式、云密钥、访问令牌、带鉴权查询参数的链接和原始生产数据不入库。模型/数据许可和来源写入清单，训练与测试按来源/场景分组。

敏感问题通过团队已有私密渠道处理，Issue 不放真实凭据。云平台返回先脱敏再附到任务记录。不要以复制真实运行数据库的方式让别人“复现”成功。

## 完成定义

代码/平台配置可复现，相关验证通过，原始结果可核对，文档反映真实状态；平台接入须有真实 Trace，模型效果须有冻结划分与对照。达成后再关闭 Issue。独立失败案例、无解和资源阻塞也应保留。
