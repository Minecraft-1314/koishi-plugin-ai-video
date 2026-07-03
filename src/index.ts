import { Schema, Logger, segment, h } from 'koishi'
import axios from 'axios'
import yaml from 'yaml'
import fs from 'fs'
import path from 'path'

export const name = 'ai-video'
export const inject = {
  required: ['console', 'i18n', 'database'],
  optional: ['assets'],
}

const logger = new Logger('ai-video')

type Infer<T> = T extends Schema<infer U> ? U : never

export const Config = Schema.intersect([
  Schema.object({
    debug: Schema.boolean().default(false).description('开启调试模式，输出完整请求日志'),
    timeout: Schema.number().default(600000).description('接口请求超时时间（毫秒），视频生成较慢，建议加大'),
    rateLimit: Schema.number().default(50).description('每小时调用次数限制'),
    maxVideos: Schema.number().default(1).description('单次生成最多视频数量'),
    videoDuration: Schema.number().default(5).description('默认视频时长（秒）'),
    videoResolution: Schema.string().default('1024x576').description('默认视频分辨率（宽x高）'),
    enableForward: Schema.boolean().default(true).description('多视频结果是否使用合并转发'),
    enableTxt2Video: Schema.boolean().default(true).description('启用文生视频功能'),
    enableImg2Video: Schema.boolean().default(true).description('启用图生视频功能'),
    videoSendMode: Schema.union([
      Schema.const('video').description('仅发送视频文件'),
      Schema.const('url').description('仅发送视频链接'),
      Schema.const('both').description('发送视频文件和链接'),
    ]).default('video').description('生成结果发送方式'),
    pollEnabled: Schema.boolean().default(false).description('是否启用异步轮询（若 API 返回任务 ID 则自动轮询至完成）'),
    pollInterval: Schema.number().default(3000).description('轮询间隔（毫秒）'),
    pollTimeout: Schema.number().default(600000).description('轮询总超时时间（毫秒）'),
  }).description('基本设置'),

  Schema.object({
    proxyEnabled: Schema.boolean().default(false).description('是否启用 HTTP/HTTPS 代理'),
    proxyProtocol: Schema.union([
      Schema.const('http').description('HTTP'),
      Schema.const('https').description('HTTPS'),
    ]).default('http').description('代理协议'),
    proxyHost: Schema.string().default('').description('代理地址'),
    proxyPort: Schema.number().default(8080).description('代理端口'),
    proxyAuth: Schema.boolean().default(false).description('代理是否需要认证'),
    proxyUsername: Schema.string().default('').description('代理用户名'),
    proxyPassword: Schema.string().role('secret').default('').description('代理密码'),
  }).description('代理设置'),

  Schema.object({
    useCustomApi: Schema.boolean().default(false).description('是否使用自定义 API 配置（开启后下方自定义列表生效）'),
    apiEndpoint: Schema.string().default('https://api.openai.com/v1/video/generations').description('API 端点地址'),
    apiKey: Schema.string().role('secret').default('').description('API 密钥'),
    model: Schema.string().default('video-generation-model').description('模型名称'),
    img2videoModel: Schema.string().default('').description('图生视频专用模型名称（留空则使用上方模型）'),
    videoDuration: Schema.number().default(0).description('视频时长（秒，留空则使用全局默认）'),
    videoResolution: Schema.string().default('').description('视频分辨率（留空则使用全局默认）'),
    txt2videoPrompt: Schema.string().default('').description('文生视频提示词模板。变量：{prompt}（留空则直接使用用户输入）'),
    img2videoPrompt: Schema.string().default('').description('图生视频提示词模板。变量：{url} {prompt}（留空则直接使用用户输入）'),
    customHeaders: Schema.string().role('textarea').default('{}').description('自定义请求头 JSON 对象（合并到默认请求头）'),
  }).description('内置 API 设置'),

  Schema.object({
    apiStrategy: Schema.union([
      Schema.const('sequence').description('顺序模式'),
      Schema.const('roundrobin').description('负载均衡模式'),
    ]).default('roundrobin').description('API 调度策略'),
    customApiList: Schema.array(
      Schema.object({
        enable: Schema.boolean().default(true).description('是否启用此 API'),
        endpoint: Schema.string().default('https://api.openai.com/v1/video/generations').description('API 端点地址'),
        apiKey: Schema.string().role('secret').default('').description('API 密钥'),
        model: Schema.string().default('video-generation-model').description('模型名称'),
        img2videoModel: Schema.string().default('').description('图生视频专用模型名称（留空则使用上方模型）'),
        videoDuration: Schema.number().default(0).description('视频时长（秒，留空使用全局默认）'),
        videoResolution: Schema.string().default('').description('视频分辨率（留空使用全局默认）'),
        txt2videoPrompt: Schema.string().default('').description('文生视频提示词模板。变量：{prompt}（留空则直接使用用户输入）'),
        img2videoPrompt: Schema.string().default('').description('图生视频提示词模板。变量：{url} {prompt}（留空则直接使用用户输入）'),
        customHeaders: Schema.string().role('textarea')
          .default('{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}')
          .description('自定义请求头 JSON，支持 {apiKey} 变量'),
        bodyTemplate: Schema.string().role('textarea')
          .default(JSON.stringify({
            txt2videoBody: { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}' },
            img2videoBody: { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}', image_url: '{url}' },
            responseVideoPath: 'video_url',
            pollUrlTemplate: '{endpoint}/{task_id}',
            taskIdPath: 'task_id',
          }, null, 2))
          .description('自定义请求体 JSON 模板（高级，留空使用内置格式）。\n支持变量：{model}、{prompt}、{duration}、{size}、{url}。\n轮询配置可选：pollUrlTemplate、taskIdPath'),
      })
    ).default([]).description('自定义 API 配置列表（仅当"使用自定义 API 配置"开启时生效）'),
  }).description('自定义 API 配置'),

  Schema.object({
    blacklistAdmins: Schema.array(String).default([]).description('黑名单管理员的 QQ 号列表'),
  }).description('权限管理'),

  Schema.object({
    messages: Schema.object({
      generating: Schema.string().default('视频生成中，请耐心等待...').description('开始生成视频时的提示'),
      empty: Schema.string().default('[提示] 请输入提示词').description('未输入提示词时的提示'),
      noApi: Schema.string().default('[提示] 未配置可用API').description('无可用 API 时的提示'),
      fail: Schema.string().default('[提示] 视频生成失败').description('视频生成失败时的提示'),
      noContent: Schema.string().default('（未返回任何视频内容）').description('API 返回空结果时的追加提示'),
      templateError: Schema.string().default('（模板配置错误）').description('请求体模板解析失败时的追加提示'),
      txt2videoDisabled: Schema.string().default('[提示] 文生视频功能未启用').description('文生视频被禁用时的提示'),
      img2videoDisabled: Schema.string().default('[提示] 图生视频功能未启用').description('图生视频被禁用时的提示'),
      rateLimit: Schema.string().default('[提示] 调用次数已达上限，请稍后再试').description('触发频率限制时的提示'),
      needAssets: Schema.string().default('[提示] 图生视频需要正确配置 assets 服务（selfUrl 未正确设置或服务未启动）').description('缺少 assets 服务时的提示'),
      blacklisted: Schema.string().default('[提示] 你已被加入黑名单，无法使用视频生成功能').description('黑名单用户被拦截时的提示'),
      noPermission: Schema.string().default('[提示] 你没有权限管理黑名单').description('无黑名单管理权限时的提示'),
      blacklistAddSuccess: Schema.string().default('已将 {targets} 加入黑名单').description('黑名单添加成功的提示'),
      blacklistRemoveSuccess: Schema.string().default('已将 {targets} 移出黑名单').description('黑名单移除成功的提示'),
      blacklistAddFail: Schema.string().default('{targets} 已在黑名单中或无效').description('黑名单添加失败的提示'),
      blacklistRemoveFail: Schema.string().default('{targets} 不在黑名单中').description('黑名单移除失败的提示'),
      invalidUserId: Schema.string().default('无效的QQ号：{targets}').description('无效 QQ 号的提示'),
      blacklistListEmpty: Schema.string().default('当前黑名单为空').description('黑名单为空时的提示'),
      blacklistListTitle: Schema.string().default('当前黑名单：').description('黑名单列表标题'),
      noLastTask: Schema.string().default('没有上一次生成记录，无法重绘').description('无重绘历史时的提示'),
      redrawing: Schema.string().default('正在重绘上一次文生视频...').description('重绘开始时的提示'),
      redrawImg2Video: Schema.string().default('[提示] 重绘仅支持文生视频任务，图生视频任务请直接发起新的图生视频指令').description('图生视频任务无法重绘时的提示'),
    }).description('所有提示文案的自定义配置，支持模板变量'),
  }).description('消息文本'),
])

declare module 'koishi' {
  interface Tables {
    ai_video_blacklist: AIVideoBlacklist
  }
}

interface AIVideoBlacklist {
  id: string
  createdAt: Date
}

interface LastTask {
  prompt: string
  imageUrl: string
  isImg2Video: boolean
  model: string
  duration: number
  resolution: string
}

interface ParsedApi {
  endpoint: string
  headers: Record<string, string>
  txt2videoBody: any
  img2videoBody: any
  responseVideoPath: string
  pollUrlTemplate: string
  taskIdPath: string
  method: string
  videoDuration: number
  videoResolution: string
  txt2videoPrompt: string
  img2videoPrompt: string
  model: string
  img2videoModel: string
}

export async function apply(ctx: any, cfg: Infer<typeof Config>) {
  const debug = cfg.debug

  try {
    const loc = path.join(__dirname, 'locales', 'zh-CN.yml')
    if (fs.existsSync(loc)) {
      ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
    }
  } catch { }

  const lastTaskMap = new Map<string, LastTask>()
  let apiRoundRobinIdx = 0
  const apiCallTimestamps: number[] = []

  ctx.model.extend('ai_video_blacklist', {
    id: 'string',
    createdAt: 'date',
  }, {
    primary: 'id',
  })

  function checkRateLimit(): boolean {
    const now = Date.now()
    const oneHourAgo = now - 3600000
    let trimIdx = 0
    while (trimIdx < apiCallTimestamps.length && apiCallTimestamps[trimIdx] < oneHourAgo) {
      trimIdx++
    }
    if (trimIdx > 0) {
      apiCallTimestamps.splice(0, trimIdx)
    }
    return apiCallTimestamps.length + 1 <= cfg.rateLimit
  }

  function recordApiCall() {
    apiCallTimestamps.push(Date.now())
  }

  const BUILTIN_TXT2VIDEO = {
    model: '{model}',
    prompt: '{prompt}',
    duration: '{duration}',
    size: '{size}',
  }

  const BUILTIN_IMG2VIDEO = {
    model: '{model}',
    prompt: '{prompt}',
    duration: '{duration}',
    size: '{size}',
    image_url: '{url}',
  }

  function parseApiEntry(entry: any): ParsedApi | null {
    if (!entry.endpoint) return null
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (entry.apiKey) {
      headers['Authorization'] = `Bearer ${entry.apiKey}`
    }
    if (entry.customHeaders) {
      try {
        const custom = JSON.parse(entry.customHeaders)
        for (const [k, v] of Object.entries(custom)) {
          headers[k] = typeof v === 'string' ? v.replace(/\{apiKey\}/g, entry.apiKey || '') : String(v)
        }
      } catch { }
    }

    let txt2videoBody: any
    let img2videoBody: any
    let responseVideoPath: string
    let pollUrlTemplate: string
    let taskIdPath: string

    if (entry.bodyTemplate) {
      try {
        const tmpl = JSON.parse(entry.bodyTemplate)
        txt2videoBody = tmpl.txt2videoBody || BUILTIN_TXT2VIDEO
        img2videoBody = tmpl.img2videoBody || BUILTIN_IMG2VIDEO
        responseVideoPath = tmpl.responseVideoPath || 'video_url'
        pollUrlTemplate = tmpl.pollUrlTemplate || ''
        taskIdPath = tmpl.taskIdPath || ''
      } catch {
        return null
      }
    } else {
      txt2videoBody = BUILTIN_TXT2VIDEO
      img2videoBody = BUILTIN_IMG2VIDEO
      responseVideoPath = 'video_url'
      pollUrlTemplate = ''
      taskIdPath = ''
    }

    return {
      endpoint: entry.endpoint,
      headers,
      txt2videoBody,
      img2videoBody,
      responseVideoPath,
      pollUrlTemplate,
      taskIdPath,
      method: 'POST',
      videoDuration: entry.videoDuration || 0,
      videoResolution: entry.videoResolution || '',
      txt2videoPrompt: entry.txt2videoPrompt || '',
      img2videoPrompt: entry.img2videoPrompt || '',
      model: entry.model,
      img2videoModel: entry.img2videoModel || '',
    }
  }

  function buildBuiltinApi(): ParsedApi {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`
    }
    if (cfg.customHeaders) {
      try {
        const custom = JSON.parse(cfg.customHeaders)
        for (const [k, v] of Object.entries(custom)) {
          headers[k] = typeof v === 'string' ? v.replace(/\{apiKey\}/g, cfg.apiKey || '') : String(v)
        }
      } catch { }
    }
    return {
      endpoint: cfg.apiEndpoint || 'https://api.openai.com/v1/video/generations',
      headers,
      txt2videoBody: BUILTIN_TXT2VIDEO,
      img2videoBody: BUILTIN_IMG2VIDEO,
      responseVideoPath: 'video_url',
      pollUrlTemplate: '',
      taskIdPath: '',
      method: 'POST',
      videoDuration: cfg.videoDuration || 0,
      videoResolution: cfg.videoResolution || '',
      txt2videoPrompt: cfg.txt2videoPrompt || '',
      img2videoPrompt: cfg.img2videoPrompt || '',
      model: cfg.model || 'video-generation-model',
      img2videoModel: cfg.img2videoModel || '',
    }
  }

  function getApi(): ParsedApi | null {
    if (cfg.useCustomApi) {
      const entries = cfg.customApiList.filter((e: any) => e.enable)
      if (entries.length === 0) return null
      const apis = entries
        .map((e: any) => parseApiEntry(e))
        .filter((a): a is ParsedApi => a !== null)
      if (apis.length === 0) return null
      if (cfg.apiStrategy === 'sequence') return apis[0]
      const api = apis[apiRoundRobinIdx % apis.length]
      apiRoundRobinIdx++
      return api
    } else {
      if (!cfg.apiEndpoint && !cfg.apiKey) return null
      return buildBuiltinApi()
    }
  }

  function resolveTemplate(template: any, vars: Record<string, any>): any {
    const jsonStr = JSON.stringify(template)
    let processed = jsonStr
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined || value === null) continue
      const regex = new RegExp(`\\{${key}\\}`, 'g')
      processed = processed.replace(regex, JSON.stringify(String(value)).slice(1, -1))
    }
    return JSON.parse(processed)
  }

  function getValueByPath(obj: any, pathStr: string): any {
    if (!obj || !pathStr) return undefined
    const normalized = pathStr.replace(/\[(\d+)\]/g, '.$1')
    const keys = normalized.split('.').filter(k => k !== '')
    let current = obj
    for (const key of keys) {
      if (current === undefined || current === null) return undefined
      const numKey = /^\d+$/.test(key) ? parseInt(key) : key
      current = current[numKey]
    }
    return current
  }

  async function pollForResult(
    pollUrl: string,
    headers: Record<string, string>,
    path: string,
    interval: number,
    timeout: number
  ): Promise<any> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const res = await axios.get(pollUrl, { headers, timeout: 10000 })
        const status = getValueByPath(res.data, 'status')
        if (status === 'completed' || status === 'succeeded') {
          return res.data
        }
        if (status === 'failed' || status === 'error') {
          throw new Error('Task failed')
        }
        await new Promise(r => setTimeout(r, interval))
      } catch (e) {
        if (e.message === 'Task failed') throw e
        await new Promise(r => setTimeout(r, interval))
      }
    }
    throw new Error('Polling timeout')
  }

  async function sendVideo(session: any, url: string) {
    const mode = cfg.videoSendMode
    if (mode === 'url') {
      await safeSend(session, url)
    } else {
      try {
        await safeSend(session, segment.video(url))
      } catch {
        if (mode === 'both') await safeSend(session, url)
      }
      if (mode === 'both') await safeSend(session, url)
    }
  }

  async function handleVideoResponse(session: any, responseData: any, api: ParsedApi) {
    let videoUrl = getValueByPath(responseData, api.responseVideoPath)
    if (!videoUrl) {
      const found = findFirstVideoUrl(responseData)
      if (found) videoUrl = found
    }
    if (videoUrl && typeof videoUrl === 'string') {
      await sendVideo(session, videoUrl.trim())
    } else {
      await safeSend(session, cfg.messages.fail + cfg.messages.noContent)
    }
  }

  function findFirstVideoUrl(obj: any): string | null {
    if (!obj) return null
    if (typeof obj === 'string') {
      const trimmed = obj.trim()
      if (/^https?:\/\/.+\.(mp4|mov|avi|webm|mkv)(\?.*)?$/i.test(trimmed)) return trimmed
      return null
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFirstVideoUrl(item)
        if (found) return found
      }
    } else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const found = findFirstVideoUrl(obj[key])
        if (found) return found
      }
    }
    return null
  }

  function validateEndpointUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  async function safeSend(session: any, message: string | h) {
    try {
      await session.send(message)
    } catch (e) {
      logger.error('发送消息失败', e)
    }
  }

  function getErrorMessage(err: any): string {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') return '请求超时'
      if (err.response) {
        const status = err.response.status
        if (status === 401) return 'API Key 无效'
        if (status === 429) return '请求过于频繁'
        if (status >= 500) return '服务器错误'
        return `HTTP ${status}`
      }
      return '网络错误'
    }
    return err.message?.slice(0, 100) || '未知错误'
  }

  function sanitizeForLog(obj: any, sensitive?: string): any {
    if (!sensitive) return obj
    try {
      const str = JSON.stringify(obj)
      return JSON.parse(str.split(sensitive).join('***'))
    } catch { return obj }
  }

  function isValidQQ(id: string): boolean {
    return /^\d{5,11}$/.test(id)
  }

  async function isBlacklisted(userId: string): Promise<boolean> {
    try {
      const rows = await ctx.database.get('ai_video_blacklist', { id: userId })
      return rows.length > 0
    } catch (e) {
      return false
    }
  }

  async function addToBlacklist(ids: string[]): Promise<{ success: string[], fail: string[] }> {
    const success: string[] = []
    const fail: string[] = []
    const validIds = ids.filter(id => { if (isValidQQ(id)) return true; fail.push(id); return false })
    if (validIds.length === 0) return { success, fail }
    const existing = await ctx.database.get('ai_video_blacklist', { id: validIds })
    const existingSet = new Set(existing.map((e: any) => e.id))
    const toCreate = validIds.filter(id => !existingSet.has(id))
    for (const id of toCreate) {
      try {
        await ctx.database.create('ai_video_blacklist', { id, createdAt: new Date() })
        success.push(id)
      } catch { fail.push(id) }
    }
    for (const entry of existing) fail.push(entry.id)
    return { success, fail }
  }

  async function removeFromBlacklist(ids: string[]): Promise<{ success: string[], fail: string[] }> {
    const success: string[] = []
    const fail: string[] = []
    const validIds = ids.filter(id => { if (isValidQQ(id)) return true; fail.push(id); return false })
    if (validIds.length === 0) return { success, fail }
    const existing = await ctx.database.get('ai_video_blacklist', { id: validIds })
    const existingSet = new Set(existing.map((e: any) => e.id))
    const toRemove = validIds.filter(id => existingSet.has(id))
    for (const id of toRemove) {
      try {
        await ctx.database.remove('ai_video_blacklist', { id })
        success.push(id)
      } catch { fail.push(id) }
    }
    for (const id of validIds.filter(id => !existingSet.has(id))) fail.push(id)
    return { success, fail }
  }

  async function customGenerateVideo(
    session: any,
    api: ParsedApi,
    prompt: string,
    imageUrl: string = '',
    modelOverride?: string
  ) {
    const isImg2Video = !!imageUrl
    const model = modelOverride || (isImg2Video ? (api.img2videoModel || api.model) : api.model)
    const duration = api.videoDuration || cfg.videoDuration || 5
    const resolution = api.videoResolution || cfg.videoResolution || '1024x576'

    const promptTemplate = isImg2Video ? api.img2videoPrompt : api.txt2videoPrompt
    let finalPrompt = prompt
    if (promptTemplate) {
      finalPrompt = promptTemplate.replace('{prompt}', prompt).replace('{url}', imageUrl || '')
    }

    const bodyTemplate = isImg2Video ? api.img2videoBody : api.txt2videoBody
    const bodyVars: Record<string, any> = { model, prompt: finalPrompt, duration: String(duration), size: resolution }
    if (isImg2Video) {
      bodyVars['url'] = imageUrl
    }

    let body: any
    try {
      body = resolveTemplate(bodyTemplate, bodyVars)
    } catch {
      await safeSend(session, cfg.messages.fail + cfg.messages.templateError)
      return
    }

    if (!validateEndpointUrl(api.endpoint)) {
      await safeSend(session, cfg.messages.fail + '（API端点配置无效）')
      return
    }

    const sensitive = api.headers?.Authorization?.split(' ')[1] || ''
    if (debug) {
      logger.info('API请求', JSON.stringify(sanitizeForLog(body, sensitive)))
    }

    try {
      const config: any = {
        url: api.endpoint,
        method: api.method,
        headers: api.headers,
        data: body,
        timeout: cfg.timeout,
      }
      if (cfg.proxyEnabled && cfg.proxyHost) {
        config.proxy = {
          protocol: cfg.proxyProtocol,
          host: cfg.proxyHost,
          port: cfg.proxyPort,
          auth: cfg.proxyAuth && cfg.proxyUsername ? { username: cfg.proxyUsername, password: cfg.proxyPassword } : undefined,
        }
      }

      let responseData = (await axios(config)).data

      if (cfg.pollEnabled && api.taskIdPath) {
        const taskId = getValueByPath(responseData, api.taskIdPath)
        if (taskId) {
          const pollUrl = api.pollUrlTemplate.replace('{endpoint}', api.endpoint).replace('{task_id}', taskId)
          responseData = await pollForResult(pollUrl, api.headers, api.responseVideoPath, cfg.pollInterval, cfg.pollTimeout)
        }
      }

      await handleVideoResponse(session, responseData, api)

      const userId = `${session.guildId || 'private'}-${session.userId}`
      lastTaskMap.set(userId, {
        prompt,
        imageUrl,
        isImg2Video,
        model,
        duration,
        resolution,
      })
    } catch (err) {
      logger.error('视频生成失败', err)
      await safeSend(session, cfg.messages.fail + ` [${getErrorMessage(err)}]`)
    }
  }

  async function generateVideo(session: any, prompt: string, imageUrl: string = '', modelOverride?: string) {
    if (!checkRateLimit()) {
      await safeSend(session, cfg.messages.rateLimit)
      return
    }
    const api = getApi()
    if (!api) {
      await safeSend(session, cfg.messages.noApi)
      return
    }
    recordApiCall()
    return customGenerateVideo(session, api, prompt, imageUrl, modelOverride)
  }

  ctx.command('video <raw:text>', 'AI视频生成（文生视频/图生视频自动识别）')
    .action(async ({ session }: any, raw: string) => {
      try {
        if (!session) return
        if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)

        const prompt = (raw || '').trim()
        const imgs = h.select(session.elements, 'img')
        const hasImage = imgs.length > 0

        if (hasImage && !cfg.enableImg2Video) return safeSend(session, cfg.messages.img2videoDisabled)
        if (!hasImage && !cfg.enableTxt2Video) return safeSend(session, cfg.messages.txt2videoDisabled)

        if (!prompt) {
          if (hasImage) return safeSend(session, '图生视频请提供提示词')
          return safeSend(session, cfg.messages.empty)
        }
        if (prompt.length > 6000) return safeSend(session, '提示词过长，请限制在6000字符以内')

        if (!hasImage) {
          await safeSend(session, cfg.messages.generating)
          await generateVideo(session, prompt)
          return
        }

        const assets = (ctx as any).assets
        if (!assets) return safeSend(session, cfg.messages.needAssets)

        const uploadResult = await assets.upload(imgs[0].attrs.src, 'ref_image.jpg')
        if (!uploadResult || !/^https?:\/\//.test(uploadResult)) {
          return safeSend(session, cfg.messages.needAssets)
        }

        await safeSend(session, cfg.messages.generating)
        await generateVideo(session, prompt, uploadResult)
      } catch (e) {
        logger.error('video命令异常', e)
        await safeSend(session, cfg.messages.fail)
      }
    })

  ctx.command('redraw', '重绘上一次文生视频')
    .action(async ({ session }: any) => {
      try {
        if (!session) return
        if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)

        const userId = `${session.guildId || 'private'}-${session.userId}`
        const last = lastTaskMap.get(userId)
        if (!last) return safeSend(session, cfg.messages.noLastTask)
        if (last.isImg2Video) return safeSend(session, cfg.messages.redrawImg2Video)

        await safeSend(session, cfg.messages.redrawing)
        await generateVideo(session, last.prompt, '', last.model)
      } catch (e) {
        logger.error('重绘命令异常', e)
        await safeSend(session, cfg.messages.fail)
      }
    })

  const blacklistCmd = ctx.command('blacklist', '黑名单管理')

  blacklistCmd.subcommand('.list', '查看黑名单').action(async ({ session }: any) => {
    if (!session) return
    if (!cfg.blacklistAdmins.includes(session.userId)) return safeSend(session, cfg.messages.noPermission)
    try {
      const entries = await ctx.database.get('ai_video_blacklist', {})
      if (entries.length === 0) return safeSend(session, cfg.messages.blacklistListEmpty)
      const list = entries.map(e => e.id).join('\n')
      return safeSend(session, cfg.messages.blacklistListTitle + '\n' + list)
    } catch (e) {
      return safeSend(session, cfg.messages.fail)
    }
  })

  blacklistCmd.subcommand('.add <...targets:string>', '添加黑名单').action(async ({ session }: any, ...targets: string[]) => {
    if (!session) return
    if (!cfg.blacklistAdmins.includes(session.userId)) return safeSend(session, cfg.messages.noPermission)
    const ids = targets.map(t => t.trim()).filter(id => id.length > 0)
    const invalid = ids.filter(id => !isValidQQ(id))
    if (invalid.length) return safeSend(session, cfg.messages.invalidUserId.replace('{targets}', invalid.join(', ')))
    const { success, fail } = await addToBlacklist(ids)
    if (success.length) await safeSend(session, cfg.messages.blacklistAddSuccess.replace('{targets}', success.join(', ')))
    if (fail.length) await safeSend(session, cfg.messages.blacklistAddFail.replace('{targets}', fail.join(', ')))
  })

  blacklistCmd.subcommand('.remove <...targets:string>', '移除黑名单').action(async ({ session }: any, ...targets: string[]) => {
    if (!session) return
    if (!cfg.blacklistAdmins.includes(session.userId)) return safeSend(session, cfg.messages.noPermission)
    const ids = targets.map(t => t.trim()).filter(id => id.length > 0)
    const invalid = ids.filter(id => !isValidQQ(id))
    if (invalid.length) return safeSend(session, cfg.messages.invalidUserId.replace('{targets}', invalid.join(', ')))
    const { success, fail } = await removeFromBlacklist(ids)
    if (success.length) await safeSend(session, cfg.messages.blacklistRemoveSuccess.replace('{targets}', success.join(', ')))
    if (fail.length) await safeSend(session, cfg.messages.blacklistRemoveFail.replace('{targets}', fail.join(', ')))
  })
}