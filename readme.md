# koishi-plugin-ai-video

## 项目介绍 (Project Introduction)

### 中文
一款为 Koishi 聊天机器人框架开发的 AI 视频生成插件，支持**文生视频 + 图生视频**，**兼容 OpenAI 标准接口的同时支持自定义 API 端点**，可接入任意视频生成服务。  
内置多 API 负载均衡、调试日志、超时机制、异步轮询、全配置化提示文案（含自定义提示模板），配置灵活、开箱即用、稳定可靠。  
图生视频支持附带参考图片，自动切换模式。  
提供**黑名单管理**功能，数据持久化到数据库，管理员可通过指令添加、移除用户及查看黑名单。  

### English
An AI video generation plugin for the Koishi chatbot framework, supporting **text-to-video & image-to-video**.  
Compatible with OpenAI‑standard APIs, and also supports **custom API endpoints** for any video generation service.  
Built‑in multi‑API load balancing, debug logging, timeout mechanism, async polling, fully configurable messages and prompt templates.  
Image‑to‑video works by attaching a reference image, automatic mode switching.  
**Blacklist management** with database persistence.  

## 使用说明 (Usage)

### 中文

| 命令 (Command)                     | 功能说明 (Description) |
|------------------------------------|------------------------|
| `video <提示词>`                  | **AI 视频生成**：根据提示词生成视频；若消息中同时附带了图片，则自动切换为图生视频模式。 |
| `redraw` / `rd` / `重绘`         | 重绘：重新生成上一次的文生视频结果 |
| `blacklist list`                 | 查看当前黑名单（仅管理员） |
| `blacklist add <QQ号> [QQ号 ...]`  | 将指定 QQ 号加入黑名单（仅管理员） |
| `blacklist remove <QQ号> [QQ号 ...]` | 将指定 QQ 号移出黑名单（仅管理员） |

### English

| Command                             | Description |
|-------------------------------------|-------------|
| `video <prompt>`                   | **AI Video Generation**: Generate video from prompt. If an image is attached, automatically switches to image-to-video mode. |
| `redraw` / `rd` / `重绘`         | Redraw: Re-generate the last text-to-video result |
| `blacklist list`                  | Show current blacklist (admin only) |
| `blacklist add <QQ_number> [QQ_number ...]` | Add QQ number(s) to blacklist (admin only) |
| `blacklist remove <QQ_number> [QQ_number ...]` | Remove QQ number(s) from blacklist (admin only) |

## 配置说明 (Configuration)

### 中文

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **基本设置** | | |
| `debug` | 调试模式，输出完整请求/响应日志 | `false` |
| `timeout` | API 请求超时时间（毫秒），视频生成较慢建议加大 | `600000` |
| `rateLimit` | 每小时调用次数上限 | `50` |
| `maxVideos` | 单次生成最多视频数量 | `1` |
| `videoDuration` | 默认视频时长（秒） | `5` |
| `videoResolution` | 默认视频分辨率（宽x高） | `1024x576` |
| `enableForward` | 多视频结果是否使用合并转发 | `true` |
| `enableTxt2Video` | 启用文生视频功能 | `true` |
| `enableImg2Video` | 启用图生视频功能 | `true` |
| `videoSendMode` | 视频发送方式：`video`（仅视频文件）、`url`（仅链接）、`both`（视频文件+链接） | `video` |
| `pollEnabled` | 是否启用异步轮询（若 API 返回任务 ID 则自动轮询至完成） | `false` |
| `pollInterval` | 轮询间隔（毫秒） | `3000` |
| `pollTimeout` | 轮询总超时时间（毫秒） | `600000` |
| **代理设置** | | |
| `proxyEnabled` | 是否启用 HTTP/HTTPS 代理 | `false` |
| `proxyProtocol` | 代理协议：`http` / `https` | `http` |
| `proxyHost` | 代理地址 | (空) |
| `proxyPort` | 代理端口 | `8080` |
| `proxyAuth` | 代理是否需要认证 | `false` |
| `proxyUsername` | 代理用户名 | (空) |
| `proxyPassword` | 代理密码 | (空) |
| **内置 API 设置** | 简单模式，使用 OpenAI 格式 | |
| `useCustomApi` | 是否启用自定义 API（开启后下方自定义列表生效） | `false` |
| `apiEndpoint` | API 端点地址 | `https://api.openai.com/v1/video/generations` |
| `apiKey` | API 密钥 | (空) |
| `model` | 模型名称 | `video-generation-model` |
| `img2videoModel` | 图生视频专用模型（留空使用上方模型） | (空) |
| `videoDuration` | 视频时长（秒，留空使用全局默认） | `0` |
| `videoResolution` | 视频分辨率（留空使用全局默认） | (空) |
| `txt2videoPrompt` | 文生视频提示词模板（留空直接使用用户输入） | (空) |
| `img2videoPrompt` | 图生视频提示词模板（留空直接使用用户输入） | (空) |
| `customHeaders` | 自定义请求头 JSON（合并到默认请求头） | `{}` |
| **自定义 API 配置** | 高级模式，每个条目独立配置 | `[]` |
| `apiStrategy` | API 调度策略：`sequence` / `roundrobin` | `roundrobin` |
| `customApiList[].enable` | 是否启用此 API | `true` |
| `customApiList[].endpoint` | API 端点地址 | `https://api.openai.com/v1/video/generations` |
| `customApiList[].apiKey` | API 密钥 | (空) |
| `customApiList[].model` | 模型名称 | `video-generation-model` |
| `customApiList[].img2videoModel` | 图生视频专用模型（留空使用上方模型） | (空) |
| `customApiList[].videoDuration` | 视频时长（秒，留空使用全局默认） | `0` |
| `customApiList[].videoResolution` | 视频分辨率（留空使用全局默认） | (空) |
| `customApiList[].txt2videoPrompt` | 文生视频提示词模板 | (空) |
| `customApiList[].img2videoPrompt` | 图生视频提示词模板 | (空) |
| `customApiList[].customHeaders` | 自定义请求头 JSON，支持 `{apiKey}` 变量 | 见预设 |
| `customApiList[].bodyTemplate` | 自定义请求体 JSON（高级，留空使用内置） | 见预设 |
| **权限管理** | | |
| `blacklistAdmins` | 黑名单管理员 QQ 号列表 | `[]` |
| **消息文本** | 所有提示文案均可自定义，支持模板变量 | 见配置页 |

> 指令名称（`video`、`redraw`、`blacklist`）为固定注册名，可在 Koishi 的指令管理页面中单独配置别名。

#### 请求范式 JSON (`bodyTemplate` 字段)

`bodyTemplate` 是高级选项，用于完全自定义请求体。留空时插件使用内置模板。

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `txt2videoBody` | 文生视频请求体 JSON 模板，支持变量 `{model}` `{prompt}` `{duration}` `{size}` | 内置 |
| `img2videoBody` | 图生视频请求体 JSON 模板，支持变量 `{model}` `{prompt}` `{duration}` `{size}` `{url}` | 内置 |
| `responseVideoPath` | 响应 JSON 中视频 URL 的字段路径，如 `video_url` | `video_url` |
| `pollUrlTemplate` | 轮询地址模板，如 `{endpoint}/{task_id}` | 无 |
| `taskIdPath` | 返回的任务 ID 字段路径，如 `task_id` | 无 |
| `method` | HTTP 方法 | `POST` |

**变量说明**  
- `{model}`：模型名称（取自配置中的全局模型或专用模型）  
- `{prompt}`：用户输入的提示词（经过提示模板处理后的最终文本）  
- `{duration}`：视频时长（秒）  
- `{size}`：视频分辨率（宽x高）  
- `{url}`：图生视频时参考图片的链接（字符串）  
- `{apiKey}`：API 密钥，仅用于 `headers` 字段  

**异步轮询说明**  
当 `pollEnabled` 开启且 API 返回任务 ID 时，插件会根据 `pollUrlTemplate` 和 `taskIdPath` 自动轮询任务状态，直到完成或超时。  

**视频 URL 自动扫描**  
当 `responseVideoPath` 未命中时，插件会自动扫描响应 JSON 中**第一个包含视频扩展名（.mp4/.mov/.avi/.webm/.mkv）的 HTTP/HTTPS URL** 作为视频地址。  

---

### English

| Config Item | Description | Default |
|-------------|-------------|---------|
| **Basic** | | |
| `debug` | Debug mode, logs full request/response | `false` |
| `timeout` | Request timeout (ms), video generation usually slower | `600000` |
| `rateLimit` | Hourly call limit | `50` |
| `maxVideos` | Max number of videos per generation | `1` |
| `videoDuration` | Default video duration (seconds) | `5` |
| `videoResolution` | Default video resolution (WxH) | `1024x576` |
| `enableForward` | Use forward message for multiple videos | `true` |
| `enableTxt2Video` | Enable text-to-video | `true` |
| `enableImg2Video` | Enable image-to-video | `true` |
| `videoSendMode` | Video send mode: `video`, `url`, `both` | `video` |
| `pollEnabled` | Enable async polling (polls until completion if task ID returned) | `false` |
| `pollInterval` | Polling interval (ms) | `3000` |
| `pollTimeout` | Polling total timeout (ms) | `600000` |
| **Proxy** | | |
| `proxyEnabled` | Enable HTTP/HTTPS proxy | `false` |
| `proxyProtocol` | Proxy protocol: `http` / `https` | `http` |
| `proxyHost` | Proxy host | (empty) |
| `proxyPort` | Proxy port | `8080` |
| `proxyAuth` | Proxy requires authentication | `false` |
| `proxyUsername` | Proxy username | (empty) |
| `proxyPassword` | Proxy password | (empty) |
| **Built-in API** | Simple mode, uses OpenAI format | |
| `useCustomApi` | Enable custom API (below list takes effect) | `false` |
| `apiEndpoint` | API endpoint URL | `https://api.openai.com/v1/video/generations` |
| `apiKey` | API key | (empty) |
| `model` | Model name | `video-generation-model` |
| `img2videoModel` | Image-to-video model (falls back to model) | (empty) |
| `videoDuration` | Video duration (seconds, 0 = use global) | `0` |
| `videoResolution` | Video resolution (empty = use global) | (empty) |
| `txt2videoPrompt` | Prompt template (empty = raw user input) | (empty) |
| `img2videoPrompt` | Prompt template (empty = raw user input) | (empty) |
| `customHeaders` | Custom headers JSON (merged into default) | `{}` |
| **Custom API Config** | Advanced mode, per-entry configuration | `[]` |
| `apiStrategy` | API strategy: `sequence` / `roundrobin` | `roundrobin` |
| `customApiList[].enable` | Enable this API | `true` |
| `customApiList[].endpoint` | API endpoint URL | `https://api.openai.com/v1/video/generations` |
| `customApiList[].apiKey` | API key | (empty) |
| `customApiList[].model` | Model name | `video-generation-model` |
| `customApiList[].img2videoModel` | Image-to-video model (falls back to model) | (empty) |
| `customApiList[].videoDuration` | Video duration (seconds, 0 = use global) | `0` |
| `customApiList[].videoResolution` | Video resolution (empty = use global) | (empty) |
| `customApiList[].txt2videoPrompt` | Prompt template | (empty) |
| `customApiList[].img2videoPrompt` | Prompt template | (empty) |
| `customApiList[].customHeaders` | Custom headers JSON, supports `{apiKey}` | preset |
| `customApiList[].bodyTemplate` | Custom request body JSON (advanced) | preset |
| **Permissions** | | |
| `blacklistAdmins` | Admin QQ number list | `[]` |
| **Messages** | All messages customizable with template vars | see schema |

> Command names (`video`, `redraw`, `blacklist`) are fixed; aliases can be configured via Koishi's command management page.

#### Request Template JSON (`bodyTemplate` field)

`bodyTemplate` is the advanced option for full custom request bodies. Leave empty to use built-in templates.

| Field | Description | Default |
|-------|-------------|---------|
| `txt2videoBody` | Txt2video request body template, vars `{model}` `{prompt}` `{duration}` `{size}` | built-in |
| `img2videoBody` | Img2video request body template, vars `{model}` `{prompt}` `{duration}` `{size}` `{url}` | built-in |
| `responseVideoPath` | JSON path to video URL, e.g. `video_url` | `video_url` |
| `pollUrlTemplate` | Polling URL template, e.g. `{endpoint}/{task_id}` | none |
| `taskIdPath` | JSON path to task ID, e.g. `task_id` | none |
| `method` | HTTP method | `POST` |

**Variable placeholders**  
- `{model}` — Model name  
- `{prompt}` — Processed user prompt after template expansion  
- `{duration}` — Video duration in seconds  
- `{size}` — Video resolution (WxH)  
- `{url}` — Reference image URL for image-to-video  
- `{apiKey}` — API key, used only in `headers`

**Async Polling**  
When `pollEnabled` is on and the API returns a task ID, the plugin will automatically poll using `pollUrlTemplate` and `taskIdPath` until completion or timeout.  

**Auto Video URL Scanning**  
When `responseVideoPath` fails, the plugin scans the response JSON for the **first HTTP/HTTPS URL with a video extension (.mp4/.mov/.avi/.webm/.mkv)** as the video address.  

---

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
```

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

## 依赖 (Dependencies)
- **数据库 (database)**：必须启用，用于黑名单持久化。
- **图生视频 (img2video)**：需要 `assets` 服务及正确的 `selfUrl` 配置。

## 功能特性 (Features)
- 文生视频 / 图生视频（自动识别消息中是否附带图片）
- 多 API 轮询与负载均衡（sequence / roundrobin）
- 支持同步返回与异步轮询两种模式，适配不同视频生成服务
- 灵活的请求体模板系统，变量自动替换，一套配置兼容任意平台
- 视频结果支持文件发送和链接发送
- 黑名单管理（持久化到数据库）
- 全配置化提示文案，支持模板变量
- 调试日志、超时控制、频率限制

## 项目贡献者 (Contributors)
| 贡献者 (Contributor) | 贡献内容 (Contribution) |
| --- | --- |
| Minecraft-1314 | 插件完整开发（从绘图插件改造） |
| （欢迎提交 PR / Issues 加入贡献者列表） |

## 许可协议 (License)
本项目采用 MIT 许可证，详情参见 LICENSE 文件。

This project is licensed under the MIT License, see the LICENSE file for details.

## 支持我们 (Support Us)
如果这个项目对您有帮助，欢迎点亮右上角的 Star 支持我们，这将是对所有贡献者最大的鼓励！

If this project is helpful to you, please feel free to star it in the upper right corner to support us, which will be the greatest encouragement to all contributors!

## 问题反馈 (Feedback)
如有问题或建议，可通过 Issues 提交反馈。

If you have any questions or suggestions, please submit feedback via Issues.