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
    debug: Schema.boolean().default(false).description('开启调试模式'),
    timeout: Schema.number().default(600000).description('超时时间（毫秒）'),
    rateLimit: Schema.number().default(50).description('每小时调用次数上限'),
    maxVideos: Schema.number().default(1).description('单次生成最多视频数量'),
    videoDuration: Schema.number().default(5).description('默认视频时长（秒）'),
    videoResolution: Schema.string().default('1024x576').description('默认视频分辨率（宽x高）'),
    enableForward: Schema.boolean().default(true).description('多视频合并转发'),
    enableTxt2Video: Schema.boolean().default(true).description('启用文生视频'),
    enableImg2Video: Schema.boolean().default(true).description('启用图生视频'),
    videoSendMode: Schema.union([
      Schema.const('video').description('仅视频'),
      Schema.const('url').description('仅链接'),
      Schema.const('both').description('视频+链接'),
    ]).default('video').description('发送方式'),
    pollEnabled: Schema.boolean().default(false).description('启用异步轮询'),
    pollInterval: Schema.number().default(3000).description('轮询间隔（毫秒）'),
    pollTimeout: Schema.number().default(600000).description('轮询超时（毫秒）'),
    collectTimeout: Schema.number().default(120).description('收集模式超时（秒）'),
  }).description('基本设置'),

  Schema.object({
    proxyEnabled: Schema.boolean().default(false).description('启用代理'),
    proxyProtocol: Schema.union([Schema.const('http'), Schema.const('https')]).default('http'),
    proxyHost: Schema.string().default(''),
    proxyPort: Schema.number().default(8080),
    proxyAuth: Schema.boolean().default(false),
    proxyUsername: Schema.string().default(''),
    proxyPassword: Schema.string().role('secret').default(''),
  }).description('代理设置'),

  Schema.object({
    useCustomApi: Schema.boolean().default(false).description('使用自定义API'),
    apiEndpoint: Schema.string().default('https://apihub.agnes-ai.com/v1/videos').description('API端点'),
    apiKey: Schema.string().role('secret').default('').description('API密钥'),
    model: Schema.string().default('agnes-video-v2.0').description('模型'),
    img2videoModel: Schema.string().default('').description('图生视频模型'),
    videoDuration: Schema.number().default(0).description('时长'),
    videoResolution: Schema.string().default('').description('分辨率'),
    txt2videoPrompt: Schema.string().default('').description('文生视频提示模板'),
    img2videoPrompt: Schema.string().default('').description('图生视频提示模板'),
    customHeaders: Schema.string().role('textarea').default('{}').description('自定义请求头'),
  }).description('内置API'),

  Schema.object({
    apiStrategy: Schema.union([Schema.const('sequence'), Schema.const('roundrobin')]).default('roundrobin'),
    customApiList: Schema.array(
      Schema.object({
        enable: Schema.boolean().default(true),
        endpoint: Schema.string().default('https://apihub.agnes-ai.com/v1/videos'),
        apiKey: Schema.string().role('secret').default(''),
        model: Schema.string().default('agnes-video-v2.0'),
        img2videoModel: Schema.string().default(''),
        videoDuration: Schema.number().default(0),
        videoResolution: Schema.string().default(''),
        txt2videoPrompt: Schema.string().default(''),
        img2videoPrompt: Schema.string().default(''),
        customHeaders: Schema.string().role('textarea')
          .default('{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}'),
        bodyTemplate: Schema.string().role('textarea')
          .default(JSON.stringify({
            txt2videoBody: { model: '{model}', prompt: '{prompt}', height: 768, width: 1152, num_frames: 121, frame_rate: 24 },
            img2videoBody: { model: '{model}', prompt: '{prompt}', image: '{url}', height: 768, width: 1152, num_frames: 121, frame_rate: 24 },
            responseVideoPath: 'remixed_from_video_id',
            pollUrlTemplate: 'https://apihub.agnes-ai.com/agnesapi?video_id={task_id}',
            taskIdPath: 'video_id',
          }, null, 2))
          .description('自定义请求体'),
      })
    ).default([]).description('自定义API列表'),
  }).description('自定义API配置'),

  Schema.object({
    blacklistAdmins: Schema.array(String).default([]).description('管理员QQ'),
  }).description('权限管理'),

  Schema.object({
    messages: Schema.object({
      generating: Schema.string().default('视频生成中，请耐心等待...'),
      enterCollect: Schema.string().default('已进入收集模式，请继续发送图片/文字。发送「开始」触发生成，发送「取消」退出。当前已收集: 0 张图片, 0 段文字'),
      collectUpdate: Schema.string().default('当前已收集: {images} 张图片, 文字已更新'),
      collectTimeout: Schema.string().default('收集超时，已自动退出'),
      empty: Schema.string().default('[提示] 请输入提示词或上传图片'),
      noApi: Schema.string().default('[提示] 未配置可用API'),
      fail: Schema.string().default('[提示] 视频生成失败'),
      noContent: Schema.string().default('（未返回任何视频内容）'),
      templateError: Schema.string().default('（模板配置错误）'),
      txt2videoDisabled: Schema.string().default('[提示] 文生视频功能未启用'),
      img2videoDisabled: Schema.string().default('[提示] 图生视频功能未启用'),
      rateLimit: Schema.string().default('[提示] 调用次数已达上限'),
      needAssets: Schema.string().default('[提示] 图生视频需要正确配置 assets 服务'),
      blacklisted: Schema.string().default('[提示] 你已被加入黑名单'),
      noPermission: Schema.string().default('[提示] 无权限管理黑名单'),
      blacklistAddSuccess: Schema.string().default('已将 {targets} 加入黑名单'),
      blacklistRemoveSuccess: Schema.string().default('已将 {targets} 移出黑名单'),
      blacklistAddFail: Schema.string().default('{targets} 已在黑名单或无效'),
      blacklistRemoveFail: Schema.string().default('{targets} 不在黑名单'),
      invalidUserId: Schema.string().default('无效QQ号：{targets}'),
      blacklistListEmpty: Schema.string().default('黑名单为空'),
      blacklistListTitle: Schema.string().default('当前黑名单：'),
      noLastTask: Schema.string().default('没有上一次记录，无法重绘'),
      redrawing: Schema.string().default('正在重绘上一次文生视频...'),
      redrawImg2Video: Schema.string().default('[提示] 重绘仅支持文生视频'),
      cancelCollect: Schema.string().default('已取消收集模式'),
      pollWaiting: Schema.string().default('视频生成中（异步轮询），请稍后...'),
    }).description('消息文本'),
  }).description('消息文本'),
])

declare module 'koishi' {
  interface Tables {
    ai_video_blacklist: AIVideoBlacklist
  }
}

interface AIVideoBlacklist { id: string; createdAt: Date }

interface CollectSession {
  prompt: string
  imageUrl: string
  timer: NodeJS.Timeout
}

interface LastTask {
  prompt: string
  imageUrl: string
  isImg2Video: boolean
  model: string
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
    if (fs.existsSync(loc)) ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
  } catch { }

  const collectSessions = new Map<string, CollectSession>()
  const lastTaskMap = new Map<string, LastTask>()
  let apiRoundRobinIdx = 0
  const apiCallTimestamps: number[] = []

  ctx.model.extend('ai_video_blacklist', { id: 'string', createdAt: 'date' }, { primary: 'id' })

  ctx.on('dispose', () => {
    for (const [, s] of collectSessions) clearTimeout(s.timer)
    collectSessions.clear()
  })

  function checkRateLimit() {
    const now = Date.now()
    const oneHourAgo = now - 3600000
    let i = 0
    while (i < apiCallTimestamps.length && apiCallTimestamps[i] < oneHourAgo) i++
    if (i > 0) apiCallTimestamps.splice(0, i)
    return apiCallTimestamps.length + 1 <= cfg.rateLimit
  }
  function recordApiCall() { apiCallTimestamps.push(Date.now()) }

  const BUILTIN_TXT2VIDEO = { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}' }
  const BUILTIN_IMG2VIDEO = { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}', image_url: '{url}' }

  function parseApiEntry(entry: any): ParsedApi | null {
    if (!entry.endpoint) return null
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`
    if (entry.customHeaders) {
      try {
        const custom = JSON.parse(entry.customHeaders)
        for (const [k, v] of Object.entries(custom))
          headers[k] = typeof v === 'string' ? v.replace(/\{apiKey\}/g, entry.apiKey || '') : String(v)
      } catch { }
    }
    let txt2videoBody, img2videoBody, responseVideoPath, pollUrlTemplate, taskIdPath
    if (entry.bodyTemplate) {
      try {
        const tmpl = JSON.parse(entry.bodyTemplate)
        txt2videoBody = tmpl.txt2videoBody || BUILTIN_TXT2VIDEO
        img2videoBody = tmpl.img2videoBody || BUILTIN_IMG2VIDEO
        responseVideoPath = tmpl.responseVideoPath || 'video_url'
        pollUrlTemplate = tmpl.pollUrlTemplate || ''
        taskIdPath = tmpl.taskIdPath || ''
      } catch { return null }
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
      txt2videoBody, img2videoBody,
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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`
    if (cfg.customHeaders) {
      try {
        const custom = JSON.parse(cfg.customHeaders)
        for (const [k, v] of Object.entries(custom))
          headers[k] = typeof v === 'string' ? v.replace(/\{apiKey\}/g, cfg.apiKey || '') : String(v)
      } catch { }
    }
    return {
      endpoint: cfg.apiEndpoint || 'https://apihub.agnes-ai.com/v1/videos',
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
      model: cfg.model || 'agnes-video-v2.0',
      img2videoModel: cfg.img2videoModel || '',
    }
  }

  function getApi(): ParsedApi | null {
    if (cfg.useCustomApi) {
      const entries = cfg.customApiList.filter(e => e.enable)
      if (!entries.length) return null
      const apis = entries.map(parseApiEntry).filter(Boolean) as ParsedApi[]
      if (!apis.length) return null
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
      processed = processed.replace(new RegExp(`\\{${key}\\}`, 'g'), JSON.stringify(String(value)).slice(1, -1))
    }
    return JSON.parse(processed)
  }

  function getValueByPath(obj: any, path: string): any {
    if (!obj || !path) return undefined
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(k => k)
    let cur = obj
    for (const k of keys) {
      if (cur == null) return undefined
      cur = cur[/^\d+$/.test(k) ? parseInt(k) : k]
    }
    return cur
  }

  function findVideoUrl(obj: any): string | null {
    if (!obj) return null
    if (typeof obj === 'string') {
      const t = obj.trim()
      if (/^https?:\/\/.+\.(mp4|mov|avi|webm|mkv)(\?.*)?$/i.test(t)) return t
      return null
    }
    if (Array.isArray(obj)) {
      for (const item of obj) { const f = findVideoUrl(item); if (f) return f }
    } else if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) { const f = findVideoUrl(obj[k]); if (f) return f }
    }
    return null
  }

  function validateEndpoint(url: string) {
    try { const p = new URL(url); return p.protocol === 'http:' || p.protocol === 'https:' } catch { return false }
  }

  async function pollForResult(pollUrl: string, headers: Record<string, string>, interval: number, timeout: number) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const res = await axios.get(pollUrl, { headers, timeout: 10000 })
        const status = getValueByPath(res.data, 'status')
        if (status === 'completed' || status === 'succeeded') return res.data
        if (status === 'failed' || status === 'error') throw new Error('Task failed')
        await new Promise(r => setTimeout(r, interval))
      } catch (e) {
        if (e.message === 'Task failed') throw e
        await new Promise(r => setTimeout(r, interval))
      }
    }
    throw new Error('Polling timeout')
  }

  async function safeSend(session: any, msg: string | h) {
    try { await session.send(msg) } catch (e) { logger.error('发送失败', e) }
  }

  async function sendVideo(session: any, url: string) {
    const mode = cfg.videoSendMode
    if (mode === 'url') await safeSend(session, url)
    else {
      try { await safeSend(session, segment.video(url)) } catch { }
      if (mode === 'both') await safeSend(session, url)
    }
  }

  function sanitizeForLog(obj: any, sensitive?: string) {
    if (!sensitive) return obj
    try { return JSON.parse(JSON.stringify(obj).split(sensitive).join('***')) } catch { return obj }
  }

  async function customGenerateVideo(session: any, api: ParsedApi, prompt: string, imageUrl: string = '') {
    const isImg2Video = !!imageUrl
    const model = isImg2Video ? (api.img2videoModel || api.model) : api.model
    const duration = api.videoDuration || cfg.videoDuration || 5
    const resolution = api.videoResolution || cfg.videoResolution || '1024x576'
    const promptTemplate = isImg2Video ? api.img2videoPrompt : api.txt2videoPrompt
    let finalPrompt = prompt
    if (promptTemplate) finalPrompt = promptTemplate.replace('{prompt}', prompt).replace('{url}', imageUrl)

    const bodyTemplate = isImg2Video ? api.img2videoBody : api.txt2videoBody
    const vars: Record<string, any> = { model, prompt: finalPrompt, duration: String(duration), size: resolution }
    if (isImg2Video) vars.url = imageUrl

    let body
    try { body = resolveTemplate(bodyTemplate, vars) } catch { return safeSend(session, cfg.messages.fail + cfg.messages.templateError) }
    if (!validateEndpoint(api.endpoint)) return safeSend(session, cfg.messages.fail + '（端点无效）')

    const sensitive = api.headers?.Authorization?.split(' ')[1] || ''
    if (debug) logger.info('API请求', JSON.stringify(sanitizeForLog(body, sensitive)))

    try {
      const config: any = { url: api.endpoint, method: api.method, headers: api.headers, data: body, timeout: cfg.timeout }
      if (cfg.proxyEnabled && cfg.proxyHost) {
        config.proxy = {
          protocol: cfg.proxyProtocol, host: cfg.proxyHost, port: cfg.proxyPort,
          auth: cfg.proxyAuth && cfg.proxyUsername ? { username: cfg.proxyUsername, password: cfg.proxyPassword } : undefined
        }
      }
      let res = (await axios(config)).data
      if (cfg.pollEnabled && api.taskIdPath) {
        const taskId = getValueByPath(res, api.taskIdPath)
        if (taskId) {
          const pollUrl = api.pollUrlTemplate.replace('{endpoint}', api.endpoint).replace('{task_id}', taskId)
          safeSend(session, cfg.messages.pollWaiting)
          res = await pollForResult(pollUrl, api.headers, cfg.pollInterval, cfg.pollTimeout)
        }
      }
      const videoUrl = getValueByPath(res, api.responseVideoPath) || findVideoUrl(res)
      if (videoUrl) await sendVideo(session, videoUrl)
      else await safeSend(session, cfg.messages.fail + cfg.messages.noContent)

      const userId = `${session.guildId || 'private'}-${session.userId}`
      lastTaskMap.set(userId, { prompt, imageUrl, isImg2Video, model })
    } catch (err) {
      logger.error('视频生成失败', err)
      safeSend(session, cfg.messages.fail + ' [' + (err.message?.slice(0, 100) || '未知错误') + ']')
    }
  }

  async function generateVideo(session: any, prompt: string, imageUrl: string = '') {
    if (!checkRateLimit()) return safeSend(session, cfg.messages.rateLimit)
    const api = getApi()
    if (!api) return safeSend(session, cfg.messages.noApi)
    recordApiCall()
    return customGenerateVideo(session, api, prompt, imageUrl)
  }

  function startTimer(session: any, key: string, collect: CollectSession) {
    return setTimeout(() => {
      collectSessions.delete(key)
      safeSend(session, cfg.messages.collectTimeout)
    }, cfg.collectTimeout * 1000)
  }

  ctx.command('video [text]', 'AI视频生成')
    .action(async ({ session }: any, text?: string) => {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      const key = `${session.guildId || 'private'}-${session.userId}`
      if (collectSessions.has(key)) return safeSend(session, '你已在收集模式中')
      const hasImage = h.select(session.elements, 'img').length > 0
      if (!hasImage && !cfg.enableTxt2Video) return safeSend(session, cfg.messages.txt2videoDisabled)
      if (hasImage && !cfg.enableImg2Video) return safeSend(session, cfg.messages.img2videoDisabled)

      let imageUrl = ''
      if (hasImage) {
        const assets = (ctx as any).assets
        if (!assets) return safeSend(session, cfg.messages.needAssets)
        const img = h.select(session.elements, 'img')[0]
        try { const up = await assets.upload(img.attrs.src, 'ref_image.jpg'); if (/^https?:\/\//.test(up)) imageUrl = up } catch { }
      }

      const collect: CollectSession = { prompt: text || '', imageUrl, timer: null as any }
      collect.timer = startTimer(session, key, collect)
      collectSessions.set(key, collect)
      await safeSend(session, cfg.messages.enterCollect)
    })

  ctx.on('message', async (session: any) => {
    if (!session || !session.elements) return
    const key = `${session.guildId || 'private'}-${session.userId}`
    const collect = collectSessions.get(key)
    if (!collect) return

    const text = (session.content || '').trim()
    const imgs = h.select(session.elements, 'img')

    if (text === '取消' || text === 'cancel') {
      clearTimeout(collect.timer)
      collectSessions.delete(key)
      return safeSend(session, cfg.messages.cancelCollect)
    }

    if (text === '开始' || text === 'start' || text === '生成') {
      clearTimeout(collect.timer)
      collectSessions.delete(key)
      if (!collect.prompt && !collect.imageUrl) return safeSend(session, cfg.messages.empty)
      await safeSend(session, cfg.messages.generating)
      return generateVideo(session, collect.prompt || '默认', collect.imageUrl)
    }

    if (imgs.length > 0 && !collect.imageUrl) {
      const assets = (ctx as any).assets
      if (!assets) return safeSend(session, cfg.messages.needAssets)
      try {
        const up = await assets.upload(imgs[0].attrs.src, 'ref_image.jpg')
        if (/^https?:\/\//.test(up)) {
          collect.imageUrl = up
          clearTimeout(collect.timer)
          collect.timer = startTimer(session, key, collect)
          await safeSend(session, cfg.messages.collectUpdate.replace('{images}', '1'))
        }
      } catch { }
      return
    }

    if (text) {
      collect.prompt = collect.prompt ? collect.prompt + ' ' + text : text
      clearTimeout(collect.timer)
      collect.timer = startTimer(session, key, collect)
      await safeSend(session, cfg.messages.collectUpdate.replace('{images}', collect.imageUrl ? '1' : '0'))
    }
  })

  ctx.command('redraw', '重绘上一次文生视频')
    .action(async ({ session }: any) => {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)
      const last = lastTaskMap.get(`${session.guildId || 'private'}-${session.userId}`)
      if (!last) return safeSend(session, cfg.messages.noLastTask)
      if (last.isImg2Video) return safeSend(session, cfg.messages.redrawImg2Video)
      await safeSend(session, cfg.messages.redrawing)
      return generateVideo(session, last.prompt)
    })

  function isValidQQ(id: string) { return /^\d{5,11}$/.test(id) }
  async function isBlacklisted(userId: string) {
    try { return (await ctx.database.get('ai_video_blacklist', { id: userId })).length > 0 } catch { return false }
  }

  const blacklistCmd = ctx.command('blacklist', '黑名单管理')
  blacklistCmd.subcommand('.list').action(async ({ session }: any) => {
    if (!session || !cfg.blacklistAdmins.includes(session.userId)) return safeSend(session, cfg.messages.noPermission)
    const entries = await ctx.database.get('ai_video_blacklist', {})
    if (!entries.length) return safeSend(session, cfg.messages.blacklistListEmpty)
    return safeSend(session, cfg.messages.blacklistListTitle + '\n' + entries.map(e => e.id).join('\n'))
  })
  blacklistCmd.subcommand('.add <...targets:string>').action(async ({ session }: any, ...targets: string[]) => {
    if (!session || !cfg.blacklistAdmins.includes(session.userId)) return safeSend(session, cfg.messages.noPermission)
    const ids = targets.map(t => t.trim()).filter(Boolean)
    const invalid = ids.filter(id => !isValidQQ(id))
    if (invalid.length) return safeSend(session, cfg.messages.invalidUserId.replace('{targets}', invalid.join(', ')))
    const success: string[] = [], fail: string[] = []
    for (const id of ids) {
      try {
        const exist = await ctx.database.get('ai_video_blacklist', { id })
        if (exist.length) fail.push(id)
        else { await ctx.database.create('ai_video_blacklist', { id, createdAt: new Date() }); success.push(id) }
      } catch { fail.push(id) }
    }
    if (success.length) await safeSend(session, cfg.messages.blacklistAddSuccess.replace('{targets}', success.join(', ')))
    if (fail.length) await safeSend(session, cfg.messages.blacklistAddFail.replace('{targets}', fail.join(', ')))
  })
  blacklistCmd.subcommand('.remove <...targets:string>').action(async ({ session }: any, ...targets: string[]) => {
    if (!session || !cfg.blacklistAdmins.includes(session.userId)) return safeSend(session, cfg.messages.noPermission)
    const ids = targets.map(t => t.trim()).filter(Boolean)
    const invalid = ids.filter(id => !isValidQQ(id))
    if (invalid.length) return safeSend(session, cfg.messages.invalidUserId.replace('{targets}', invalid.join(', ')))
    const success: string[] = [], fail: string[] = []
    for (const id of ids) {
      try {
        const exist = await ctx.database.get('ai_video_blacklist', { id })
        if (exist.length) { await ctx.database.remove('ai_video_blacklist', { id }); success.push(id) }
        else fail.push(id)
      } catch { fail.push(id) }
    }
    if (success.length) await safeSend(session, cfg.messages.blacklistRemoveSuccess.replace('{targets}', success.join(', ')))
    if (fail.length) await safeSend(session, cfg.messages.blacklistRemoveFail.replace('{targets}', fail.join(', ')))
  })
}