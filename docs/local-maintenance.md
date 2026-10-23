# 本地定制分支维护

本文件记录本地源码维护流程及本次迁移证据；功能行为见 [账号与模型管理](account-management.md)。不代表当前安装版本已经更新。

## 仓库与边界

- 官方仓库：https://github.com/V1ki/dsh-plugin-subscriptions.git，remote 名为 `upstream`。
- 自有 GitHub Fork：https://github.com/hammercui/dsh-plugin-subscriptions，remote 名为 `origin`；GitHub 已确认 parent 为 `V1ki/dsh-plugin-subscriptions`。
- `main` 保持官方历史；`custom/local` 保存本地定制并跟踪 `origin/custom/local`。定制提交已推送；不向官方仓库推送。
- 开发仓库：`D:\DshProject\dsh-plugin-subscriptions`。
- 不直接修改安装目录，不将账号凭据、个人运行配置、导出包或历史构建目录加入 Git。
- 配置覆盖与登录态留在 DSH 用户目录；本仓不复制它们。

## 2026-10-23 迁移依据

- 新基线：官方 `main` / `v0.9.10`，commit `a5b01068b7f0c0cdb6f38bafe700c345fdfee4ba`。
- 原始源码在工作区 `tmp/dsh-plugin-subscriptions`，HEAD 为官方 `v0.9.9`：`9930c5ee5e3fa239db9031f47a0f6f30f7ffc443`。原目录原样保留。
- 原源码仓库的 `lib` 与 desktop 已安装插件的 `lib` 共 136 个文件，SHA256 全部一致，无缺失或新增。这证明安装产物来源相符，不证明当前源码已经重新构建成功。
- 迁移原始 TypeScript 差异与相关测试，不使用旧编译产物覆盖上游源码。
- 功能范围：智谱/阿里云 Coding Plan、API Key 账号管理、固定套餐端点、手动账号路由且排除自动 Pool、智谱配额解析、阿里配额不支持提示；另保留空 `inputModalities` 的兼容归一化。
- 不迁移旧日志、output、旧回滚脚本、账号数据和机器配置；旧部署历史不作为新版本验证证据。

## 更新流程

先确认工作区干净，保存当前已验证提交的回滚 tag，再执行：

```bash
git fetch upstream --tags
git switch main
git merge --ff-only upstream/main
git push origin main
git switch custom/local
# 默认选择已发布版本；将下面占位值换成经过核实的 tag。
git merge <release-tag>
# 若明确决定跟主干，改为 git merge upstream/main
```

解决冲突时同时保留官方修复和本地功能；不能整文件取旧版。采用合并提交保留历史，不对已共享分支强推。验证后执行 `git push origin custom/local`。本流程为手动按需同步，没有安装定时任务或自动合并工作流。

在获准安装开发依赖后，按 packageManager 指定版本使用 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

隔离浏览器脚本 `test/coding-plan-browser.mjs` 需显式设置 `PLAYWRIGHT_PATH`（可用 Playwright 包目录）及 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`（浏览器可执行文件），使用 pnpm 安装树内的 rolldown 构建 fixture，再以 `node test/coding-plan-browser.mjs` 执行。测试截图写入已忽略的 `output/`。先核实本机工具路径，不为测试擅自安装浏览器。

所有结果应以本轮命令为准；测试通过不代表真实套餐调用或当前宿主兼容性已经验证。

打包与实际安装是独立阶段：检查打包清单不含凭据，保留已安装版本及回退路径，获得安装确认后再替换，重启实际 DSH 并核验加载版本。市场更新可能覆盖定制包，不能把市场自动升级当作本分支升级流程。

## OAuth 默认账号优先（2026-10-23）

普通 OAuth 账号池按请求优先当前合格且健康的默认账号；配额感知模式仅提升配额可用的默认账号。不可用时保留原有备用调度，恢复后即使同一会话也优先默认账号。显式 tier 不增加默认账号查询，独立入口及 Coding Plan 排除规则不变，详见账号管理文档。

新增回归用例覆盖乱序成员、故障冷却与恢复、同会话配额回退与恢复、显式 tier 的直接/预备调用。最初测试因开发依赖缺失而阻塞；后经用户批准，以 pnpm 10.26.2 执行 `pnpm install --frozen-lockfile` 成功，未改变 manifest 或锁文件。

## 当前验证边界与风险

2026-10-23 经授权完成依赖安装与验证：`pnpm build` 通过；`pnpm test` 649/649 通过，失败、取消、跳过均为 0。账号池专项 `pnpm exec tsc -p tsconfig.test.json` 与 `node --test lib-test/test/pool.spec.js` 通过（49/49）。

首次测试发现新增非法模态测试的 exactOptionalPropertyTypes 类型断言问题，已用 NonNullable 修正；四项旧调度断言改为默认账号不在候选/额度不足时验证原有备用算法，另增加显式 tier 回归，不删除原有调度覆盖。最终重新执行完整构建与测试成功。

尚未执行隔离浏览器交互测试、真实服务商调用、当前旧版宿主兼容性验证，也未打包部署或替换 desktop 插件。

已完成静态检查：原始 tracked 补丁通过 `git apply --3way` 无冲突应用；`git diff --check` 与暂存区检查通过；浏览器测试脚本 `node --check test/coding-plan-browser.mjs` 语法检查通过。以上均不等于编译或测试通过。

- v0.9.10 开发依赖以 DSH 0.2.1-rc.2 为主；peer 声明仍包含当前 0.2.0-rc.2，声明兼容不等于实际运行验证。
- Coding Plan 模型表是静态建议，不证明账号授权；适配器目前按文本模型解析，模型名包含视觉能力不代表已支持图片。
- 智谱 monitor 配额接口非稳定公开契约；阿里配额仍不支持。
- 显式 Pool family 只要包含 Coding Plan 成员就会整组跳过，保留原有行为，尚未改进。
- 空模态数组归一化和“不支持配额”的 UI 涉及既有服务商，需回归。
- 没有真实套餐调用验证；不应使用真实凭据自动测试或声称端到端通过。
