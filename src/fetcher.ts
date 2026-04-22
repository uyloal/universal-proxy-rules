/**
 * Fetcher 模块
 * 负责并发下载上游规则，执行清洗和去重
 * 使用原生 fetch API，零第三方 HTTP 依赖
 */

import { UpstreamSource, FetchResult, CustomRulesConfig, CustomRuleSource, MergedFetchResult } from './types.js'

// 并发控制配置
const DEFAULT_CONCURRENCY = 5
const DEFAULT_TIMEOUT = 30000

/**
 * 创建 AbortController 超时包装
 */
function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/**
 * 下载单个 URL 内容
 */
async function fetchUrl(
  url: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<string> {
  const signal = createTimeoutSignal(timeout)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'mihomo/1.18.3 proxy-rules-engine/1.0.0',
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.text()
}

/**
 * 解析规则内容 - 优化版
 * 支持多种格式: YAML (payload), 纯文本 (每行一条), 经典格式 (DOMAIN-SUFFIX,xxx)
 */
function parseRules(content: string, behavior: string): string[] {
  const rules: string[] = []
  const lines = content.split('\n')
  const isYaml = content.includes('payload:')
  let inPayload = false

  for (const rawLine of lines) {
    // 快速移除 \r
    const line = rawLine.charCodeAt(rawLine.length - 1) === 13
      ? rawLine.slice(0, -1)
      : rawLine

    if (isYaml) {
      const trimmed = line.trim()
      if (trimmed.startsWith('payload:')) {
        inPayload = true
        continue
      }
      if (!inPayload) continue

      // 退出条件: 非空行且非缩进
      if (trimmed && line[0] !== ' ' && line[0] !== '-') {
        inPayload = false
        continue
      }

      // 手动解析列表项: 跳过前导空格和 "- "
      let i = 0
      const len = line.length
      while (i < len && (line[i] === ' ' || line[i] === '\t')) i++
      if (i >= len || line[i] !== '-') continue
      i++ // 跳过 -
      if (i < len && line[i] === ' ') i++ // 跳过空格
      if (i < len) {
        rules.push(line.slice(i).trim())
      }
    } else {
      const trimmed = line.trim()
      if (!trimmed || trimmed[0] === '#') continue

      // 检测是否已是规则格式 (简单字符检查，避免正则)
      let isRuleFormat = false
      for (let i = 0; i < trimmed.length && i < 30; i++) {
        const c = trimmed.charCodeAt(i)
        if (c === 44) { // ','
          isRuleFormat = true
          break
        }
        // 小写字母，不是规则格式
        if (c >= 97 && c <= 122) break
      }

      if (isRuleFormat) {
        rules.push(trimmed)
      } else if (trimmed.indexOf('.') !== -1) {
        rules.push(`${behavior.toUpperCase()},${trimmed}`)
      }
    }
  }

  return rules
}

/**
 * 清洗和规范化规则
 * 使用循环避免大数组链式操作导致的栈溢出
 */
function cleanupRules(
  rules: string[],
  excludePatterns: RegExp[]
): string[] {
  const result: string[] = []

  for (const raw of rules) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // 应用排除模式
    let excluded = false
    for (const pattern of excludePatterns) {
      if (pattern.test(trimmed)) {
        excluded = true
        break
      }
    }
    if (excluded) continue

    result.push(trimmed.toLowerCase())
  }

  return result
}

/**
 * 去重并排序规则
 * 使用 Set 去重，然后排序
 */
function deduplicateRules(rules: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const rule of rules) {
    if (!seen.has(rule)) {
      seen.add(rule)
      unique.push(rule)
    }
  }

  // 按字母排序便于阅读和 diff
  // 使用 toSorted 避免修改原数组 (Node 20+)
  return unique.toSorted ? unique.toSorted() : [...unique].sort()
}

/**
 * 并发控制队列 (p-map style)
 */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<(R | Error)[]> {
  const results: (R | Error)[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++
      try {
        results[currentIndex] = await fn(items[currentIndex])
      } catch (e) {
        results[currentIndex] = e instanceof Error ? e : new Error(String(e))
      }
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker())

  await Promise.all(workers)
  return results
}

/**
 * 获取单个上游规则源
 */
async function fetchSingleUpstream(
  key: string,
  source: UpstreamSource,
  excludePatterns: RegExp[]
): Promise<FetchResult> {
  const errors: string[] = []
  const allRules: string[] = []

  // 并发获取所有 URL
  const results = await runWithConcurrency(
    source.urls,
    async url => {
      try {
        const content = await fetchUrl(url)
        return { url, content, error: null }
      } catch (e) {
        return { url, content: '', error: e instanceof Error ? e.message : String(e) }
      }
    },
    DEFAULT_CONCURRENCY
  )

  for (const result of results) {
    if (result instanceof Error) {
      errors.push(`Unexpected error: ${result.message}`)
      continue
    }

    if (result.error) {
      errors.push(`${result.url}: ${result.error}`)
      continue
    }

    try {
      const parsed = parseRules(result.content, source.behavior)
      const cleaned = cleanupRules(parsed, excludePatterns)
      // 避免使用展开运算符导致栈溢出
      for (const rule of cleaned) {
        allRules.push(rule)
      }
    } catch (e) {
      errors.push(`${result.url}: Parse error - ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 去重
  const finalRules = deduplicateRules(allRules)

  return {
    upstreamName: key,
    rules: finalRules,
    count: finalRules.length,
    errors,
  }
}

/**
 * 主入口: 并发获取所有上游规则
 */
export async function fetchAllUpstreams(
  upstreams: Record<string, UpstreamSource>,
  excludePatterns: string[] = []
): Promise<Map<string, FetchResult>> {
  // 编译排除正则
  const compiledPatterns = excludePatterns.map(p => new RegExp(p, 'i'))

  const entries = Object.entries(upstreams)

  // 并发获取所有上游
  const results = await runWithConcurrency(
    entries,
    async ([key, source]) => {
      const result = await fetchSingleUpstream(key, source, compiledPatterns)
      return { key, result }
    },
    DEFAULT_CONCURRENCY
  )

  const map = new Map<string, FetchResult>()
  for (const item of results) {
    if (item instanceof Error) {
      console.error('Unexpected error in fetchAllUpstreams:', item)
      continue
    }
    map.set(item.key, item.result)
  }

  return map
}

/**
 * 将规则转换为 YAML payload 格式
 */
export function rulesToYamlPayload(rules: string[]): string {
  const lines = ['payload:']
  for (const rule of rules) {
    lines.push(`  - ${rule}`)
  }
  return lines.join('\n')
}

/**
 * 导出规则到文件内容 (用于 rule-providers 的 inline 或 text 格式)
 */
export function exportRules(
  rules: string[],
  format: 'yaml' | 'text' = 'yaml'
): string {
  if (format === 'text') {
    return rules.join('\n')
  }
  return rulesToYamlPayload(rules)
}

/**
 * 解析单行规则，提取类型和值用于去重
 */
function parseRuleForDedup(rule: string): { type: string; value: string } {
  const trimmed = rule.trim().toLowerCase()

  // 已经是 DOMAIN-SUFFIX,example.com 格式
  const commaIndex = trimmed.indexOf(',')
  if (commaIndex > 0) {
    const type = trimmed.substring(0, commaIndex).toUpperCase()
    const rest = trimmed.substring(commaIndex + 1)

    // 处理可能的 policy (第三个逗号后)
    const secondComma = rest.indexOf(',')
    if (secondComma > 0) {
      return { type, value: rest.substring(0, secondComma) }
    }
    return { type, value: rest }
  }

  // 纯域名格式，默认 DOMAIN-SUFFIX
  if (trimmed.includes('.')) {
    return { type: 'DOMAIN-SUFFIX', value: trimmed }
  }

  return { type: 'UNKNOWN', value: trimmed }
}

/**
 * 创建去重键
 */
function createDedupKey(type: string, value: string): string {
  return `${type}:${value}`
}

/**
 * 合并自定义规则到 upstream 结果
 * - merge_into 指定的: 合并到对应 upstream，检查重复
 * - 未指定的: 创建新的独立分组
 */
export function mergeCustomRules(
  fetchResults: Map<string, FetchResult>,
  customConfig: CustomRulesConfig
): Map<string, MergedFetchResult> {
  const mergedResults = new Map<string, MergedFetchResult>()

  // 首先复制所有 upstream 结果
  for (const [key, result] of fetchResults) {
    mergedResults.set(key, {
      ...result,
      mergedFrom: [],
      isCustomOnly: false,
    })
  }

  if (!customConfig?.custom_rules) {
    return mergedResults
  }

  // 处理每个自定义规则
  for (const [customKey, customRule] of Object.entries(customConfig.custom_rules)) {
    const customRulesList = customRule.rules || []

    if (!customRulesList.length) {
      continue
    }

    // 解析并清洗自定义规则
    const parsedCustomRules: string[] = []
    for (const rule of customRulesList) {
      const trimmed = rule.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      // 标准化规则格式
      const commaIndex = trimmed.indexOf(',')
      if (commaIndex > 0) {
        // 已经是规则格式
        parsedCustomRules.push(trimmed.toLowerCase())
      } else if (trimmed.includes('.')) {
        // 纯域名，添加前缀
        const behavior = customRule.behavior || 'domain'
        parsedCustomRules.push(`${behavior.toUpperCase()},${trimmed.toLowerCase()}`)
      }
    }

    if (customRule.merge_into) {
      // 合并到指定 upstream
      const targetUpstream = customRule.merge_into
      const targetResult = mergedResults.get(targetUpstream)

      if (targetResult) {
        // 使用 Set 去重合并
        const existingSet = new Set<string>()
        for (const rule of targetResult.rules) {
          const parsed = parseRuleForDedup(rule)
          existingSet.add(createDedupKey(parsed.type, parsed.value))
        }

        let addedCount = 0
        for (const rule of parsedCustomRules) {
          const parsed = parseRuleForDedup(rule)
          const key = createDedupKey(parsed.type, parsed.value)

          if (!existingSet.has(key)) {
            existingSet.add(key)
            targetResult.rules.push(rule)
            addedCount++
          }
        }

        // 重新排序
        targetResult.rules = targetResult.rules.toSorted()
        targetResult.count = targetResult.rules.length
        targetResult.mergedFrom = targetResult.mergedFrom || []
        targetResult.mergedFrom.push(customKey)

        console.log(`  ↪ Merged ${customKey} → ${targetUpstream} (+${addedCount} rules)`)
      } else {
        console.warn(`  ⚠ Custom rule "${customKey}" wants to merge into unknown upstream "${targetUpstream}", treating as standalone`)

        // 作为独立组创建
        mergedResults.set(customKey, {
          upstreamName: customKey,
          rules: parsedCustomRules.toSorted(),
          count: parsedCustomRules.length,
          errors: [],
          mergedFrom: [customKey],
          isCustomOnly: true,
        })
      }
    } else {
      // 单独成组
      mergedResults.set(customKey, {
        upstreamName: customKey,
        rules: parsedCustomRules.toSorted(),
        count: parsedCustomRules.length,
        errors: [],
        mergedFrom: [customKey],
        isCustomOnly: true,
      })

      console.log(`  ↪ Created standalone group: ${customKey} (${parsedCustomRules.length} rules)`)
    }
  }

  return mergedResults
}
