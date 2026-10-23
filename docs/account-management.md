# 账号与模型管理 / Account and model management

在 **设置 → 订阅 → 对应服务商 → 管理** 中配置账号。保存前的修改只属于本地草稿；取消不会写入配置。

## 配置含义

- **别名**：例如“个人”“工作”。独立模型条目显示别名，内部绑定使用稳定账号 key；改别名不会改变绑定。
- **加入自动 Pool**：允许这个账号参与普通对话模型入口的自动调度。默认开启。
- **Pool 模型列表**：限制该账号允许参与 Pool 的模型。“跟随全部模型”包含将来发现的新模型；显式全选只选择当前列表；全不选不允许任何模型参与。
- **独立模型入口**：为账号增加单独的模型选择条目。默认关闭，开启后直接绑定该账号，不随 Pool 切换。

## 工作与个人账号示例

| 账号 | 别名 | 加入自动 Pool | 独立模型入口 |
|---|---|---|---|
| 个人账号 | 个人 | 开启 | 可选 |
| 工作账号 | 工作 | 关闭 | 开启 |

普通模型条目只使用允许参与 Pool 的账号。选择带“工作”别名的独立模型条目后，该模型调用只使用工作账号；账号被删除、独立入口被关闭、凭据失效或额度不足时，不会静默改用个人账号。

## OAuth 账号池：默认账号优先

同一 OAuth 服务商的普通账号池优先使用当前默认账号，但默认星标不会绕过 Pool 参与开关、模型允许列表或健康检查。默认账号不符合条件、处于故障冷却，或在配额感知策略下被判定不可用时，其余候选继续沿用原有优先级、会话粘性、配额调度与故障转移规则。

默认账号恢复且通过既有健康/配额检查后，下一次请求重新优先使用它（包括同一会话）。这优先于备用账号的缓存粘性，可能牺牲部分 prompt cache 命中率；不会中断正在进行的请求。切换仍遵循原有流式安全边界：已经输出内容后，不自动重放到另一账号。

跨服务商显式 tier 的顺序及独立账号入口保持不变。下述智谱/阿里云 API Key 账号不参与此策略。

## Coding Plan：智谱中国站与阿里云

`zhipu` 与 `aliyun` 使用专用 Coding Plan API key，不执行 OAuth。添加时提供稳定账号标签；再次保存相同标签替换密钥，不新增账号。密钥仅保存在现有 auth store 中（`accessToken`；`refreshToken` 为空；`expiresAt` 为 `Number.MAX_SAFE_INTEGER`），状态与保存 RPC 响应不返回密钥。

- RPC：`subscriptions-auth.saveApiKey`，严格接收 `{ provider: 'zhipu' | 'aliyun', account, apiKey }`，返回 `{ saved: true }`。不接受自定义 URL。
- 智谱对话固定使用 `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions`；阿里固定使用 `https://coding.dashscope.aliyuncs.com/v1/chat/completions`。不回退到按量付费 API，不跟随重定向。
- **这两个服务商不参与自动 Pool，也不能作为显式 Pool family/tier 的成员**；普通模型条目固定使用默认账号。通过默认星标手动切换，或开启独立模型入口指定账号。凭据失效、429 或额度耗尽不会自动改用另一密钥。上文默认开启 Pool 的规则仅适用于既有 OAuth 服务商。
- 智谱用量查询使用公开客户端已采用、但未正式保证稳定性的 monitor 接口 `https://open.bigmodel.cn/api/monitor/usage/quota/limit`（Bearer API key）。仅解析 `TOKENS_LIMIT` / `CREDIT_LIMIT` 的有效百分比；5 小时 / 周窗口按上游 unit/number 判断，`TIME_LIMIT` 不误标为模型配额。未知或空响应返回 `supported: false`，失败明确报错，不伪造 0% 或剩余额度。
- 阿里 Coding Plan 暂无已验证的 API-key 用量接口：返回 `supported: false`；用户需在官方控制台查看额度。不读取浏览器 Cookie，不将按量余额当订阅配额。模型列表为可配置的静态建议，不代表该账号的实时授权。

## 范围与限制

这些配置约束插件的 **LLM 对话模型路由**，不是整个会话的隐私隔离开关。图片生成、视频生成和 X 搜索等工具仍使用各自的账号策略；指定其他模型的子代理也不因此自动绑定账号。需要严格的工作/个人数据隔离时，不能只依赖此设置。

服务商级“编辑模型列表”继续管理模型显示、上下文和工具偏好；账号管理不重置这些设置。默认账号星标与 Pool 参与开关是两个不同配置。

---

Open **Settings → Subscriptions → provider → Manage** to edit account aliases, automatic-pool participation, per-account pool model allowlists, and independent model entries.

Existing accounts default to participating in the pool, with independent entries disabled. An absent model allowlist follows all discovered models, including future additions; an empty allowlist permits none. Independent entries bind a stable account key, not its editable alias, and do not fall back to another account when unavailable.

These controls govern LLM model routing only. Image/video generation, X search, and agents explicitly selecting other models retain their own routing policies. This feature is not a session-wide privacy-isolation guarantee.
