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

let sharp: any
try {
  sharp = require('sharp')
} catch {}

function guessAdapterType(endpoint: string): 'chat' | 'flat' {
  try {
    const url = new URL(endpoint)
    const port = url.port
    if (port === '7860' || port === '5000' || port === '8888') return 'flat'
  } catch {}
  return 'chat'
}

function compressImage(buffer: Buffer, cfg: any): Promise<Buffer> {
  if (!sharp || !cfg.imageCompression?.enable) return Promise.resolve(buffer)
  const { maxWidth, maxHeight, quality } = cfg.imageCompression
  return sharp(buffer)
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: quality || 80 })
    .toBuffer()
    .catch(() => buffer)
}

async function downloadAndCompress(url: string, cfg: any): Promise<string | null> {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    let buffer = Buffer.from(res.data)
    const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : ''
    let mime = 'image/png'
    if (/^image\/[a-zA-Z0-9.+-]+/.test(contentType)) {
      mime = contentType.split(';')[0].trim()
    } else {
      const ext = url.replace(/[?#].*$/, '').split('.').pop()?.toLowerCase() || 'png'
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        svg: 'image/svg+xml', ico: 'image/x-icon', tiff: 'image/tiff',
        tif: 'image/tiff', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
      }
      mime = mimeMap[ext] || 'image/png'
    }
    buffer = await compressImage(buffer, cfg)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch (e) {
    logger.warn('下载或压缩图片失败', url, e)
    return null
  }
}

const apiEntrySchema = Schema.object({
  enable: Schema.boolean().default(true).description('启用'),
  adapterType: Schema.union([
    Schema.const('').description('自动'),
    Schema.const('chat').description('Chat格式'),
    Schema.const('flat').description('平铺格式'),
  ]).default('').description('接口类型（留空自动根据端口判断）'),
  endpoint: Schema.string().default('https://apihub.agnes-ai.com/v1/videos').description('端点'),
  apiKey: Schema.string().role('secret').default('').description('密钥'),
  model: Schema.string().default('agnes-video-v2.0').description('模型'),
  img2videoModel: Schema.string().default('').description('图生视频模型'),
  videoDuration: Schema.number().default(0).description('默认视频时长（秒）'),
  videoResolution: Schema.string().default('').description('默认视频分辨率（宽x高）'),
  txt2videoPrompt: Schema.string().default('').description('文生视频模板'),
  img2videoPrompt: Schema.string().default('').description('图生视频模板'),
  customHeaders: Schema.string().role('textarea')
    .default('{"Authorization":"Bearer {apiKey}","Content-Type":"application/json"}')
    .description('自定义请求头（JSON）'),
  bodyTemplate: Schema.string().role('textarea')
    .default(JSON.stringify({
      txt2videoBody: { model: '{model}', prompt: '{prompt}', height: 768, width: 1152, num_frames: 121, frame_rate: 24 },
      img2videoBody: { model: '{model}', prompt: '{prompt}', image: '{url}', height: 768, width: 1152, num_frames: 121, frame_rate: 24 },
      responseVideoPath: 'remixed_from_video_id',
      pollUrlTemplate: 'https://apihub.agnes-ai.com/agnesapi?video_id={task_id}',
      taskIdPath: 'video_id',
    }, null, 2))
    .description('自定义请求体（JSON）'),
})

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
    imageCompression: Schema.object({
      enable: Schema.boolean().default(false).description('启用图片压缩'),
      maxWidth: Schema.number().default(1024).description('最大宽度'),
      maxHeight: Schema.number().default(1024).description('最大高度'),
      quality: Schema.number().default(80).description('压缩质量(0-100)'),
    }).description('图片压缩设置'),
    imageInputAsBase64: Schema.boolean().default(false).description('图生视频输入转为Base64'),
    presetPrompts: Schema.array(Schema.object({
      name: Schema.string().required().description('预设名称'),
      keywords: Schema.array(String).default([]).description('触发关键词'),
      template: Schema.string().default('{prompt}').description('提示词模板，支持 {prompt} {keyword}'),
    })).default([]).description('预置提示词列表'),
  }).description('扩展功能'),

  Schema.object({
    apiStrategy: Schema.union([
      Schema.const('sequence').description('顺序'),
      Schema.const('roundrobin').description('轮询'),
    ]).default('roundrobin').description('调度策略'),
    primaryApiList: Schema.array(apiEntrySchema).default([]).description('主模型API列表'),
  }).description('主模型设置'),

  Schema.object({
    secondaryApi: Schema.object({
      enable: Schema.boolean().default(false).description('启用副模型'),
      strategy: Schema.union([
        Schema.const('sequence').description('顺序'),
        Schema.const('roundrobin').description('轮询'),
      ]).default('roundrobin').description('调度策略'),
      list: Schema.array(apiEntrySchema).default([]).description('副模型API列表（留空则使用主模型列表）'),
    }).description('副模型配置（启用后 video2 使用此配置）'),
  }).description('副模型设置'),

  Schema.object({
    proxyEnabled: Schema.boolean().default(false).description('启用代理'),
    proxyProtocol: Schema.union([Schema.const('http'), Schema.const('https')]).default('http').description('代理协议'),
    proxyHost: Schema.string().default('').description('代理主机地址'),
    proxyPort: Schema.number().default(8080).description('代理端口'),
    proxyAuth: Schema.boolean().default(false).description('启用代理认证'),
    proxyUsername: Schema.string().default('').description('代理用户名'),
    proxyPassword: Schema.string().role('secret').default('').description('代理密码'),
  }).description('代理设置'),

  Schema.object({
    blacklistAdmins: Schema.array(String).default([]).description('管理员QQ号'),
  }).description('权限管理'),

  Schema.object({
    messages: Schema.object({
      generating: Schema.string().default('视频生成中，请耐心等待...').description('生成中提示'),
      enterCollect: Schema.string().default('已进入收集模式，请继续发送图片/文字。发送「开始」触发生成，发送「取消」退出。当前已收集: 0 张图片, 0 段文字').description('进入收集模式提示'),
      collectUpdate: Schema.string().default('当前已收集: {images} 张图片, 文字已更新').description('收集更新提示'),
      collectTimeout: Schema.string().default('收集超时，已自动退出').description('收集超时提示'),
      empty: Schema.string().default('[提示] 请输入提示词或上传图片').description('空输入提示'),
      noApi: Schema.string().default('[提示] 未配置可用API').description('无API提示'),
      fail: Schema.string().default('[提示] 视频生成失败').description('生成失败提示'),
      noContent: Schema.string().default('（未返回任何视频内容）').description('无内容提示'),
      templateError: Schema.string().default('（模板配置错误）').description('模板错误提示'),
      txt2videoDisabled: Schema.string().default('[提示] 文生视频功能未启用').description('文生视频禁用提示'),
      img2videoDisabled: Schema.string().default('[提示] 图生视频功能未启用').description('图生视频禁用提示'),
      rateLimit: Schema.string().default('[提示] 调用次数已达上限').description('频率限制提示'),
      needAssets: Schema.string().default('[提示] 图生视频需要正确配置 assets 服务').description('需要Assets提示'),
      blacklisted: Schema.string().default('[提示] 你已被加入黑名单').description('黑名单提示'),
      noPermission: Schema.string().default('[提示] 无权限管理黑名单').description('无权限提示'),
      blacklistAddSuccess: Schema.string().default('已将 {targets} 加入黑名单').description('添加黑名单成功提示'),
      blacklistRemoveSuccess: Schema.string().default('已将 {targets} 移出黑名单').description('移除黑名单成功提示'),
      blacklistAddFail: Schema.string().default('{targets} 已在黑名单或无效').description('添加黑名单失败提示'),
      blacklistRemoveFail: Schema.string().default('{targets} 不在黑名单').description('移除黑名单失败提示'),
      invalidUserId: Schema.string().default('无效QQ号：{targets}').description('无效用户ID提示'),
      blacklistListEmpty: Schema.string().default('黑名单为空').description('黑名单为空提示'),
      blacklistListTitle: Schema.string().default('当前黑名单：').description('黑名单标题提示'),
      noLastTask: Schema.string().default('没有上一次记录，无法重绘').description('无上一次任务提示'),
      redrawing: Schema.string().default('正在重绘上一次文生视频...').description('重绘中文生视频提示'),
      redrawImg2Video: Schema.string().default('[提示] 重绘仅支持文生视频').description('重绘图生视频提示'),
      cancelCollect: Schema.string().default('已取消收集模式').description('取消收集提示'),
      pollWaiting: Schema.string().default('视频生成中（异步轮询），请稍后...').description('轮询等待提示'),
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
  presetName?: string
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
  adapterType: 'chat' | 'flat'
}

export async function apply(ctx: any, cfg: Infer<typeof Config>) {
  const debug = cfg.debug

  try {
    const loc = path.join(__dirname, 'locales', 'zh-CN.yml')
    if (fs.existsSync(loc)) ctx.i18n.define('zh-CN', yaml.parse(fs.readFileSync(loc, 'utf8')))
  } catch { }

  const collectSessions = new Map<string, CollectSession>()
  const lastTaskMap = new Map<string, LastTask>()
  let primaryRoundRobinIdx = 0
  let secondaryRoundRobinIdx = 0
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
    let adapterType: 'chat' | 'flat'
    if (entry.adapterType && entry.adapterType !== '') {
      adapterType = entry.adapterType
    } else {
      adapterType = guessAdapterType(entry.endpoint)
    }
    let txt2videoBody, img2videoBody, responseVideoPath, pollUrlTemplate, taskIdPath
    if (entry.bodyTemplate) {
      try {
        const tmpl = JSON.parse(entry.bodyTemplate)
        txt2videoBody = tmpl.txt2videoBody || { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}' }
        img2videoBody = tmpl.img2videoBody || { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}', image_url: '{url}' }
        responseVideoPath = tmpl.responseVideoPath || 'video_url'
        pollUrlTemplate = tmpl.pollUrlTemplate || ''
        taskIdPath = tmpl.taskIdPath || ''
      } catch { return null }
    } else {
      txt2videoBody = { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}' }
      img2videoBody = { model: '{model}', prompt: '{prompt}', duration: '{duration}', size: '{size}', image_url: '{url}' }
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
      adapterType,
    }
  }

  function getApi(secondary = false): ParsedApi | null {
    if (secondary && cfg.secondaryApi?.enable) {
      const list = cfg.secondaryApi.list?.length ? cfg.secondaryApi.list : cfg.primaryApiList
      if (!list?.length) return null
      const entries = list.filter(e => e.enable)
      if (!entries.length) return null
      const apis = entries.map(parseApiEntry).filter(Boolean) as ParsedApi[]
      if (!apis.length) return null
      const strategy = cfg.secondaryApi.strategy || 'roundrobin'
      if (strategy === 'sequence') return apis[0]
      const api = apis[secondaryRoundRobinIdx % apis.length]
      secondaryRoundRobinIdx++
      return api
    }
    const entries = cfg.primaryApiList.filter(e => e.enable)
    if (!entries.length) return null
    const apis = entries.map(parseApiEntry).filter(Boolean) as ParsedApi[]
    if (!apis.length) return null
    if (cfg.apiStrategy === 'sequence') return apis[0]
    const api = apis[primaryRoundRobinIdx % apis.length]
    primaryRoundRobinIdx++
    return api
  }

  function resolveTemplate(templateObj: any, vars: Record<string, any>): any {
    if (templateObj === null || templateObj === undefined) return templateObj
    if (typeof templateObj === 'string') {
      const match = templateObj.match(/^\{(\w+)\}$/)
      if (match && vars.hasOwnProperty(match[1])) {
        return vars[match[1]]
      }
      return templateObj
    }
    if (Array.isArray(templateObj)) {
      return templateObj.map(item => resolveTemplate(item, vars))
    }
    if (typeof templateObj === 'object') {
      const result: any = {}
      for (const key of Object.keys(templateObj)) {
        result[key] = resolveTemplate(templateObj[key], vars)
      }
      return result
    }
    return templateObj
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

  async function sendSingleVideo(session: any, url: string) {
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

  function applyPresetPrompts(prompt: string, presetName?: string): string {
    if (!prompt) return prompt
    if (presetName && cfg.presetPrompts) {
      const preset = cfg.presetPrompts.find(p => p.name === presetName)
      if (preset) {
        return preset.template.replace(/\{prompt\}/g, prompt).replace(/\{keyword\}/g, preset.keywords?.[0] || '')
      }
    }
    if (cfg.presetPrompts && cfg.presetPrompts.length) {
      for (const preset of cfg.presetPrompts) {
        if (preset.keywords?.length) {
          for (const kw of preset.keywords) {
            if (prompt.toLowerCase().includes(kw.toLowerCase())) {
              return preset.template.replace(/\{prompt\}/g, prompt).replace(/\{keyword\}/g, kw)
            }
          }
        }
      }
    }
    return prompt
  }

  async function customGenerateVideo(
    session: any,
    api: ParsedApi,
    prompt: string,
    imageUrl: string = '',
    presetName?: string
  ): Promise<string | null> {
    const isImg2Video = !!imageUrl
    const model = isImg2Video ? (api.img2videoModel || api.model) : api.model
    const duration = api.videoDuration || cfg.videoDuration || 5
    const resolution = api.videoResolution || cfg.videoResolution || '1024x576'
    const promptTemplate = isImg2Video ? api.img2videoPrompt : api.txt2videoPrompt

    let processedPrompt = applyPresetPrompts(prompt, presetName)
    let finalPrompt = processedPrompt
    if (promptTemplate) finalPrompt = promptTemplate.replace('{prompt}', processedPrompt).replace('{url}', imageUrl)

    const bodyTemplate = isImg2Video ? api.img2videoBody : api.txt2videoBody
    const vars: Record<string, any> = {
      model,
      prompt: finalPrompt,
      duration,
      size: resolution,
    }
    if (isImg2Video) {
      if (cfg.imageInputAsBase64 && imageUrl) {
        const b64 = await downloadAndCompress(imageUrl, cfg)
        vars.url = b64 || imageUrl
      } else {
        vars.url = imageUrl
      }
    }

    let body
    try { body = resolveTemplate(bodyTemplate, vars) } catch {
      await safeSend(session, cfg.messages.fail + cfg.messages.templateError)
      return null
    }
    if (!validateEndpoint(api.endpoint)) {
      await safeSend(session, cfg.messages.fail + '（端点无效）')
      return null
    }

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
          const pollUrl = api.pollUrlTemplate.replace('{task_id}', taskId)
          await safeSend(session, cfg.messages.pollWaiting)
          res = await pollForResult(pollUrl, api.headers, cfg.pollInterval, cfg.pollTimeout)
        }
      }
      const videoUrl = getValueByPath(res, api.responseVideoPath) || findVideoUrl(res)
      return videoUrl || null
    } catch (err) {
      logger.error('视频生成失败', err)
      await safeSend(session, cfg.messages.fail + ' [' + (err.message?.slice(0, 100) || '未知错误') + ']')
      return null
    }
  }

  async function generateVideos(session: any, prompt: string, imageUrl: string, count: number, presetName?: string, secondary = false) {
    const videoUrls: string[] = []
    for (let i = 0; i < count; i++) {
      if (!checkRateLimit()) {
        await safeSend(session, cfg.messages.rateLimit)
        break
      }
      const api = getApi(secondary)
      if (!api) {
        await safeSend(session, cfg.messages.noApi)
        break
      }
      recordApiCall()
      const url = await customGenerateVideo(session, api, prompt, imageUrl, presetName)
      if (url) videoUrls.push(url)
      if (i < count - 1) await new Promise(r => setTimeout(r, 1000))
    }

    if (videoUrls.length === 0) {
      await safeSend(session, cfg.messages.fail + cfg.messages.noContent)
      return
    }

    if (videoUrls.length === 1 || !cfg.enableForward) {
      for (const url of videoUrls) {
        await sendSingleVideo(session, url)
      }
    } else {
      const children = videoUrls.map(url => h('message', h.video(url)))
      try {
        await safeSend(session, h('message', { forward: true }, ...children))
      } catch {
        for (const url of videoUrls) await sendSingleVideo(session, url)
      }
    }

    const userId = `${session.guildId || 'private'}-${session.userId}`
    if (videoUrls.length > 0) {
      lastTaskMap.set(userId, { prompt, imageUrl, isImg2Video: !!imageUrl, model: 'multiple' })
    }
  }

  function startTimer(session: any, key: string, collect: CollectSession) {
    return setTimeout(() => {
      collectSessions.delete(key)
      safeSend(session, cfg.messages.collectTimeout)
    }, cfg.collectTimeout * 1000)
  }

  ctx.command('video [text]', 'AI视频生成（主模型）')
    .option('preset', '-p <preset:string>')
    .action(async ({ session, options }: any, text?: string) => {
      if (!session) return
      if (await isBlacklisted(session.userId)) return safeSend(session, cfg.messages.blacklisted)

      const preset = options?.preset || undefined
      const hasImage = h.select(session.elements, 'img').length > 0

      if (preset && text) {
        if (!cfg.enableTxt2Video && !hasImage) return safeSend(session, cfg.messages.txt2videoDisabled)
        if (hasImage && !cfg.enableImg2Video) return safeSend(session, cfg.messages.img2videoDisabled)
        let imageUrl = ''
        if (hasImage) {
          const assets = (ctx as any).assets
          if (!assets) return safeSend(session, cfg.messages.needAssets)
          const img = h.select(session.elements, 'img')[0]
          try { const up = await assets.upload(img.attrs.src, 'ref_image.jpg'); if (/^https?:\/\//.test(up)) imageUrl = up } catch { }
        }
        await safeSend(session, cfg.messages.generating)
        return generateVideos(session, text, imageUrl, cfg.maxVideos, preset, false)
      }

      const key = `${session.guildId || 'private'}-${session.userId}`
      if (collectSessions.has(key)) return safeSend(session, '你已在收集模式中')
      if (!hasImage && !cfg.enableTxt2Video) return safeSend(session, cfg.messages.txt2videoDisabled)
      if (hasImage && !cfg.enableImg2Video) return safeSend(session, cfg.messages.img2videoDisabled)

      let imageUrl = ''
      if (hasImage) {
        const assets = (ctx as any).assets
        if (!assets) return safeSend(session, cfg.messages.needAssets)
        const img = h.select(session.elements, 'img')[0]
        try { const up = await assets.upload(img.attrs.src, 'ref_image.jpg'); if (/^https?:\/\//.test(up)) imageUrl = up } catch { }
      }

      const collect: CollectSession = { prompt: text || '', imageUrl, timer: null as any, presetName: preset }
      collect.timer = startTimer(session, key, collect)
      collectSessions.set(key, collect)
      await safeSend(session, cfg.messages.enterCollect)
    })

  ctx.command('video2 [text]', '使用副模型生成视频')
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
    if (session.command) return

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
      if (!cfg.enableTxt2Video && !collect.imageUrl) return safeSend(session, cfg.messages.txt2videoDisabled)
      if (!cfg.enableImg2Video && collect.imageUrl) return safeSend(session, cfg.messages.img2videoDisabled)

      const isVideo2 = session.content?.startsWith('video2') ?? false
      await safeSend(session, cfg.messages.generating)
      return generateVideos(session, collect.prompt || '默认', collect.imageUrl, cfg.maxVideos, collect.presetName, isVideo2)
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
      return generateVideos(session, last.prompt, '', cfg.maxVideos)
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