# koishi-plugin-ai-video

## 项目介绍 (Project Introduction)

### 中文
一款为 Koishi 聊天机器人框架开发的 AI 视频生成插件，支持**文生视频 + 图生视频**，**兼容 OpenAI 标准接口的同时支持自定义 API 端点**，可接入任意视频生成服务。  
内置多 API 负载均衡、图片压缩、Base64 自动转换、预置提示词、主/副模型分离、端口自动适配、异步轮询、调试日志、超时等待机制，配置灵活、开箱即用、稳定可靠。  
图生视频支持附带参考图片，并可选择将图片压缩后转为 Base64 发送以兼容更多后端。  
提供**黑名单管理**功能，数据持久化到数据库，管理员可通过指令添加、移除用户及查看黑名单。

### English
An AI video generation plugin for the Koishi chatbot framework, supporting **text-to-video & image-to-video**.  
Compatible with OpenAI‑standard APIs, and also supports **custom API endpoints** for any video generation service.  
Built‑in multi‑API load balancing, image compression, automatic Base64 conversion, preset prompts, primary/secondary model separation, port auto-detection, async polling, debug logging, and timeout mechanism.  
Image‑to‑video supports attaching a reference image, with optional compression and Base64 conversion for compatibility with more backends.  
**Blacklist management** with database persistence.

## 核心指令 (Core Commands)

| 指令 (Command) | 说明 (Description) | 示例 (Example) |
|----------------|--------------------|----------------|
| `video <提示词>` | 进入收集模式：可发送文字/图片，输入「开始」生成，「取消」退出。支持 `-p <预设>` 直接应用预置提示词模板。 (Enter collection mode: send text/images, then "start" to generate. Use `-p <preset>` to apply a preset prompt template.) | `video 海上日出 -p 电影风格` |
| `video2 <提示词>` | 使用副模型进入收集模式，操作同 `video`。 (Same as `video` but using the secondary model.) | `video2 一只猫` |
| `redraw` / `rd` / `重绘` | 重绘上一次的文生视频结果。 (Redraw the last text-to-video result.) | `redraw` |
| `blacklist list` | 查看当前黑名单（仅管理员）。 (Show current blacklist, admin only.) | `blacklist list` |
| `blacklist add <QQ号...>` | 将指定 QQ 号加入黑名单（仅管理员）。 (Add QQ numbers to blacklist, admin only.) | `blacklist add 123456` |
| `blacklist remove <QQ号...>` | 将指定 QQ 号移出黑名单（仅管理员）。 (Remove QQ numbers from blacklist, admin only.) | `blacklist remove 123456` |

## 配置项说明 (Configuration)

### 基本设置 (Basic Settings)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `debug` | boolean | false | 调试模式，输出完整请求/响应日志 (Debug mode, logs full request/response) |
| `timeout` | number | 600000 | API 请求超时时间（毫秒） (Request timeout in ms) |
| `rateLimit` | number | 50 | 每小时调用次数上限 (Hourly call limit) |
| `maxVideos` | number | 1 | 单次生成最多视频数量 (Max videos per generation) |
| `videoDuration` | number | 5 | 默认视频时长（秒） (Default video duration in seconds) |
| `videoResolution` | string | 1024x576 | 默认视频分辨率（宽x高） (Default video resolution WxH) |
| `enableForward` | boolean | true | 多视频结果是否使用合并转发 (Use forward message for multiple videos) |
| `enableTxt2Video` | boolean | true | 启用文生视频功能 (Enable txt2video) |
| `enableImg2Video` | boolean | true | 启用图生视频功能 (Enable img2video) |
| `videoSendMode` | string | video | 视频发送方式：`video`（仅视频） / `url`（仅链接） / `both`（视频+链接） (Send mode: `video`, `url`, `both`) |
| `pollEnabled` | boolean | false | 启用异步轮询 (Enable async polling) |
| `pollInterval` | number | 3000 | 轮询间隔（毫秒） (Polling interval in ms) |
| `pollTimeout` | number | 600000 | 轮询超时（毫秒） (Polling timeout in ms) |
| `collectTimeout` | number | 120 | 收集模式等待用户输入的超时秒数 (Collection mode wait timeout in seconds) |

### 扩展功能 (Extended Features)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `imageCompression.enable` | boolean | false | 启用图片压缩（需安装 `sharp` 模块） (Enable image compression, requires `sharp`) |
| `imageCompression.maxWidth` | number | 1024 | 压缩后最大宽度 (Max width after compression) |
| `imageCompression.maxHeight` | number | 1024 | 压缩后最大高度 (Max height after compression) |
| `imageCompression.quality` | number | 80 | JPEG 压缩质量 0-100 (JPEG quality 0-100) |
| `imageInputAsBase64` | boolean | false | 图生视频时将参考图片转为 Base64 发送 (Convert reference image to Base64 for img2video) |
| `presetPrompts` | array | [] | 预置提示词列表，每项包含 `name`（名称）、`keywords`（触发关键词数组）、`template`（提示词模板，支持 `{prompt}` `{keyword}` 变量） (List of preset prompts: `name`, `keywords` array, `template` with `{prompt}` and `{keyword}` variables) |

### 主模型设置 (Primary Model)

主模型始终使用自定义 API 列表，支持多个端点与负载均衡。  
The primary model always uses a custom API list with multiple endpoints and load balancing.

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `apiStrategy` | string | roundrobin | 主模型调度策略：`sequence`（顺序） / `roundrobin`（轮询） (Load balancing strategy for primary model) |
| `primaryApiList` | array | [] | 主模型 API 条目列表，每个条目包含以下配置 (List of primary API entries, each with the following fields) |

**API 条目公共配置 (API Entry Common Fields)**（主模型与副模型通用）

| 字段 (Field) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|--------------|-------------|-------------------|---------------------|
| `enable` | boolean | true | 是否启用此 API (Enable this API) |
| `adapterType` | string | (空) | 接口类型：`chat` / `flat`；留空则根据端口自动判断（7860/5000/8888 → flat，其余 → chat） (Adapter type; auto-detect by port if empty) |
| `endpoint` | string | https://apihub.agnes-ai.com/v1/videos | API 端点 (Endpoint) |
| `apiKey` | string | (空) | API 密钥 (API key) |
| `model` | string | agnes-video-v2.0 | 模型名称 (Model name) |
| `img2videoModel` | string | (空) | 图生视频专用模型 (Img2video model) |
| `videoDuration` | number | 0 | 视频时长（秒），0 则使用全局默认 (Video duration in seconds, 0 = use global) |
| `videoResolution` | string | (空) | 视频分辨率，留空使用全局默认 (Video resolution, falls back to global) |
| `txt2videoPrompt` | string | (空) | 文生视频提示词模板 (Prompt template for txt2video) |
| `img2videoPrompt` | string | (空) | 图生视频提示词模板 (Prompt template for img2video) |
| `customHeaders` | string | 预设 (Preset) | 自定义请求头 JSON，支持 `{apiKey}` 变量 (Custom headers JSON) |
| `bodyTemplate` | string | 预设 (Preset) | 自定义请求体 JSON，包含 `txt2videoBody`、`img2videoBody`、`responseVideoPath`、`pollUrlTemplate`、`taskIdPath` 等字段 (Custom request body template JSON) |

### 副模型设置 (Secondary Model)

副模型通过 `video2` 指令调用，其 API 列表完全独立于主模型；若副模型列表为空，则自动回退到主模型的 `primaryApiList`。  
The secondary model is invoked via the `video2` command. Its API list is completely independent; if empty, it falls back to the primary `primaryApiList`.

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `secondaryApi.enable` | boolean | false | 启用副模型功能 (Enable secondary model) |
| `secondaryApi.strategy` | string | roundrobin | 副模型调度策略：`sequence` / `roundrobin` (Load balancing strategy for secondary model) |
| `secondaryApi.list` | array | [] | 副模型 API 条目列表，结构与主模型条目**完全相同**（留空则使用主模型列表） (Secondary API entry list, same structure as primary entries; if empty, uses primary list) |

> 副模型列表的每个条目配置项与主模型 API 条目完全一致，详见上方 **API 条目公共配置** 表格。  
> Each entry in the secondary list has the same fields as a primary API entry; see the **API Entry Common Fields** table above.

### 代理设置 (Proxy Settings)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `proxyEnabled` | boolean | false | 启用 HTTP/HTTPS 代理 (Enable proxy) |
| `proxyProtocol` | string | http | 代理协议：`http` / `https` (Proxy protocol) |
| `proxyHost` | string | (空) | 代理地址 (Proxy host) |
| `proxyPort` | number | 8080 | 代理端口 (Proxy port) |
| `proxyAuth` | boolean | false | 代理是否需要认证 (Proxy requires auth) |
| `proxyUsername` | string | (空) | 代理用户名 (Proxy username) |
| `proxyPassword` | string | (空) | 代理密码 (Proxy password) |

### 权限管理 (Permissions)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `blacklistAdmins` | array | [] | 黑名单管理员 QQ 号列表 (Admin QQ number list) |

### 消息文本 (Messages)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `messages.*` | object | 见配置页 (See schema) | 所有提示文案均可自定义，支持模板变量 (All messages customizable, supports template variables) |

## 功能特性 (Features)
- 文生视频 / 图生视频，支持附带参考图片 (Txt2video & img2video, with reference image)
- 多视频合并转发 / 单视频发送灵活切换 (Flexible multi-video sending: forward or single)
- 主/副模型独立，均可配置多端点负载均衡（顺序 / 轮询）(Independent primary & secondary models, each with multi-endpoint load balancing)
- 预置提示词模板，关键词自动匹配 (Preset prompts with keyword auto-matching)
- 图片压缩与 Base64 输入转换，兼容更多后端 (Image compression & Base64 conversion)
- 端口自动适配（7860/5000/8888 → flat 格式）(Port auto-detect for adapter type)
- 支持同步返回与异步轮询两种视频生成模式 (Supports both synchronous and async polling modes)
- 黑名单管理（持久化到数据库）(Blacklist with database persistence)
- 全配置化提示文案，调试日志，超时控制，频率限制 (Fully configurable messages, debug log, timeout, rate limit)

## 依赖 (Dependencies)
- **数据库 (database)**：必须启用，用于黑名单持久化。 (Required for blacklist persistence)
- **图生视频 (img2video)**：需要 `assets` 服务及正确的 `selfUrl` 配置。 (Requires `assets` service and correct `selfUrl`)
- **图片压缩 (optional)**：需要安装 `sharp` 模块。 (Optional: `sharp` module for compression)

## 自定义 API 端点示例 (Custom Endpoint Examples)

### 基础视频生成 API（同步返回）
```json
{
  "endpoint": "https://api.example.com/v1/video/generations",
  "apiKey": "sk-xxxx",
  "headers": {"Authorization":"Bearer {apiKey}","Content-Type":"application/json"},
  "txt2videoBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"duration\":{duration},\"size\":\"{size}\"}",
  "img2videoBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"duration\":{duration},\"size\":\"{size}\",\"image_url\":\"{url}\"}",
  "responseVideoPath": "video_url"
}

### 异步轮询 API（返回任务 ID）
```json
{
  "endpoint": "https://api.example.com/v1/video/tasks",
  "apiKey": "sk-xxxx",
  "headers": {"Authorization":"Bearer {apiKey}","Content-Type":"application/json"},
  "txt2videoBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"duration\":{duration},\"size\":\"{size}\"}",
  "img2videoBody": "{\"model\":\"{model}\",\"prompt\":\"{prompt}\",\"duration\":{duration},\"size\":\"{size}\",\"image_url\":\"{url}\"}",
  "responseVideoPath": "result.video_url",
  "pollUrlTemplate": "{endpoint}/{task_id}",
  "taskIdPath": "task_id"
}
```

## 项目贡献者 (Contributors)
| 贡献者 (Contributor) | 贡献内容 (Contribution) |
| --- | --- |
| Minecraft-1314 | 插件完整开发 (Complete plugin development) |
| xiaochuqiangda | 参考了 koishi-plugin-imagedraw-selfuse 插件的功能 (This feature references the koishi-plugin-imagedraw-selfuse plugin) |
| （欢迎提交 PR / Issues 加入贡献者列表） |
| (Welcome to join the contributor list via PR or Issues) |

## 许可协议 (License)
本项目采用 MIT 许可证，详情参见 LICENSE 文件。

This project is licensed under the MIT License, see the LICENSE file for details.

## 支持我们 (Support Us)
如果这个项目对您有帮助，欢迎点亮右上角的 Star 支持我们，这将是对所有贡献者最大的鼓励！

If this project is helpful to you, please feel free to star it in the upper right corner to support us, which will be the greatest encouragement to all contributors!

## 问题反馈 (Feedback)
如有问题或建议，可通过 Issues 提交反馈。

If you have any questions or suggestions, please submit feedback via Issues.