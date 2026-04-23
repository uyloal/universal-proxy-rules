/**
 * Builder 模块
 * 负责读取 config/ 配置，生成最终的 Clash 配置
 * 使用 yaml 包进行解析和序列化
 */

import { parse, stringify } from 'yaml'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  UpstreamsConfig,
  PolicyGroupsConfig,
  CustomRulesConfig,
  ProxyGroup,
  Rule,
  RuleProviderEntry,
  GeneratedConfig,
  FetchResult,
  MergedFetchResult,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const CONFIG_DIR = join(ROOT_DIR, 'config')
const TEMPLATES_DIR = join(ROOT_DIR, 'templates')
const OUTPUT_DIR = join(ROOT_DIR, 'output')

/**
 * 读取 YAML 配置文件
 */
async function readYamlFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8')
  return parse(content) as T
}

/**
 * 写入 YAML 文件
 * @param header - 可选的 YAML 头部注释（不包含 # 前缀，会自动添加）
 */
async function writeYamlFile(path: string, data: unknown, header?: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const yaml = stringify(data, {
    indent: 2,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'PLAIN',
  })
  // 如果有头部注释，添加在前面（每行添加 # 前缀）
  const content = header ? `${header}\n${yaml}` : yaml
  await writeFile(path, content, 'utf-8')
}

/**
 * 写入文本文件
 */
async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

/**
 * 读取文本模板文件
 */
async function readTextTemplate(name: string): Promise<string> {
  const path = join(TEMPLATES_DIR, name)
  return readFile(path, 'utf-8')
}

/**
 * 读取基础模板
 */
async function readBaseTemplate(name: string): Promise<Record<string, unknown>> {
  const path = join(TEMPLATES_DIR, name)
  const content = await readFile(path, 'utf-8')
  return parse(content) as Record<string, unknown>
}

/**
 * 转换规则为 Clash 格式字符串
 */
function formatRuleToClash(rule: Rule): string | null {
  switch (rule.type) {
    case 'domain':
      return `DOMAIN,${rule.payload.join(',')},${rule.policy}`
    case 'domain-suffix':
      return `DOMAIN-SUFFIX,${rule.payload.join(',')},${rule.policy}`
    case 'domain-keyword':
      return `DOMAIN-KEYWORD,${rule.payload.join(',')},${rule.policy}`
    case 'ipcidr': {
      const noResolve = rule['no-resolve'] ? ',no-resolve' : ''
      return `IP-CIDR,${rule.payload.join(',')},${rule.policy}${noResolve}`
    }
    case 'geoip': {
      const noResolve = rule['no-resolve'] ? ',no-resolve' : ''
      return `GEOIP,${rule.country},${rule.policy}${noResolve}`
    }
    case 'geosite':
      return `GEOSITE,${rule.site},${rule.policy}`
    case 'dst-port':
      return `DST-PORT,${rule.ports.join(',')},${rule.policy}`
    case 'src-port':
      return `SRC-PORT,${rule.ports.join(',')},${rule.policy}`
    case 'process-name':
      return `PROCESS-NAME,${rule.processes.join(',')},${rule.policy}`
    case 'process-path':
      return `PROCESS-PATH,${rule.processes.join(',')},${rule.policy}`
    case 'match':
      return `MATCH,${rule.policy}`
    case 'upstream':
      // 上游规则会被转换为 RULE-SET 引用
      return `RULE-SET,${rule.upstream},${rule.policy}`
    default:
      return null
  }
}

/**
 * 构建 Rule Providers
 * 使用 http 类型从 release 分支获取规则文件
 */
function buildRuleProviders(
  fetchResults: Map<string, MergedFetchResult>,
  upstreamsConfig: UpstreamsConfig,
  customConfig: CustomRulesConfig
): Record<string, RuleProviderEntry> {
  const providers: Record<string, RuleProviderEntry> = {}

  for (const [name, result] of fetchResults) {
    if (result.count === 0) continue

    const upstreamDef = upstreamsConfig.upstreams[name]
    const customDef = customConfig?.custom_rules?.[name]

    // 优先使用 upstream 定义，否则使用自定义规则定义
    const behavior = upstreamDef?.behavior || customDef?.behavior || 'domain'
    const interval = upstreamDef?.interval || customDef?.interval || 86400

    // 使用 http 方式引用外部规则文件 (Clash 使用 yaml 格式)
    providers[name] = {
      type: 'http',
      behavior,
      url: `https://raw.githubusercontent.com/uyloal/universal-proxy-rules/release/rules/${name}.yaml`,
      path: `./rules/${name}.yaml`,
      interval,
    }
  }

  return providers
}

/**
 * 构建规则列表 (rules 字段)
 */
function buildRules(
  policyConfig: PolicyGroupsConfig,
  fetchResults: Map<string, MergedFetchResult>
): string[] {
  const rules: string[] = []

  for (const ruleDef of policyConfig.rules) {
    const type = ruleDef.type as string

    if (type === 'upstream') {
      const upstreamName = ruleDef.upstream as string
      const policy = ruleDef.policy as string

      // 检查上游是否存在且有数据
      const result = fetchResults.get(upstreamName)
      if (result && result.count > 0) {
        // 使用 RULE-SET 引用 rule-provider
        rules.push(`RULE-SET,${upstreamName},${policy}`)
      }
    } else if (type === 'domain') {
      const payload = ruleDef.payload as string[]
      const policy = ruleDef.policy as string
      for (const domain of payload) {
        rules.push(`DOMAIN,${domain},${policy}`)
      }
    } else if (type === 'domain-suffix') {
      const payload = ruleDef.payload as string[]
      const policy = ruleDef.policy as string
      for (const domain of payload) {
        rules.push(`DOMAIN-SUFFIX,${domain},${policy}`)
      }
    } else if (type === 'domain-keyword') {
      const payload = ruleDef.payload as string[]
      const policy = ruleDef.policy as string
      for (const keyword of payload) {
        rules.push(`DOMAIN-KEYWORD,${keyword},${policy}`)
      }
    } else if (type === 'ipcidr') {
      const payload = ruleDef.payload as string[]
      const policy = ruleDef.policy as string
      const noResolve = ruleDef['no-resolve'] ? ',no-resolve' : ''
      for (const cidr of payload) {
        rules.push(`IP-CIDR,${cidr},${policy}${noResolve}`)
      }
    } else if (type === 'geoip') {
      const country = ruleDef.country as string
      const policy = ruleDef.policy as string
      const noResolve = ruleDef['no-resolve'] ? ',no-resolve' : ''
      rules.push(`GEOIP,${country},${policy}${noResolve}`)
    } else if (type === 'geosite') {
      const site = ruleDef.site as string
      const policy = ruleDef.policy as string
      rules.push(`GEOSITE,${site},${policy}`)
    } else if (type === 'dst-port') {
      const ports = ruleDef.ports as string[]
      const policy = ruleDef.policy as string
      rules.push(`DST-PORT,${ports.join('/')},${policy}`)
    } else if (type === 'src-port') {
      const ports = ruleDef.ports as string[]
      const policy = ruleDef.policy as string
      rules.push(`SRC-PORT,${ports.join('/')},${policy}`)
    } else if (type === 'match') {
      const policy = ruleDef.policy as string
      rules.push(`MATCH,${policy}`)
    }
  }

  return rules
}

/**
 * 转换规则为 Shadowrocket 格式
 */
function formatRuleToShadowrocket(rule: Rule): string | null {
  switch (rule.type) {
    case 'domain':
      // Shadowrocket 不支持多 payload，取第一个
      return `DOMAIN,${rule.payload[0]},${rule.policy}`
    case 'domain-suffix':
      return `DOMAIN-SUFFIX,${rule.payload[0]},${rule.policy}`
    case 'domain-keyword':
      return `DOMAIN-KEYWORD,${rule.payload[0]},${rule.policy}`
    case 'ipcidr': {
      const noResolve = rule['no-resolve'] ? ',no-resolve' : ''
      return `IP-CIDR,${rule.payload[0]},${rule.policy}${noResolve}`
    }
    case 'geoip': {
      const noResolve = rule['no-resolve'] ? ',no-resolve' : ''
      return `GEOIP,${rule.country},${rule.policy}${noResolve}`
    }
    case 'dst-port':
      return `DST-PORT,${rule.ports[0]},${rule.policy}`
    case 'src-port':
      return `SRC-PORT,${rule.ports[0]},${rule.policy}`
    case 'match':
      return `FINAL,${rule.policy}`
    default:
      return null
  }
}

/**
 * 转换 Shadowrocket 策略名称：核心组引用转为 PROXY
 */
function mapShadowrocketPolicy(policy: string): string {
  return CORE_PROXY_GROUPS.includes(policy) ? 'PROXY' : policy
}

/**
 * 构建 Shadowrocket 规则列表
 * 对于上游规则，使用 DOMAIN-SET 引用外部规则文件
 * 简化策略：引用核心组的规则改为直接使用 PROXY，兜底规则为 FINAL,PROXY
 */
function buildShadowrocketRules(
  policyConfig: PolicyGroupsConfig,
  fetchResults: Map<string, MergedFetchResult>
): string[] {
  const rules: string[] = []

  for (const ruleDef of policyConfig.rules) {
    const type = ruleDef.type as string

    if (type === 'upstream') {
      const upstreamName = ruleDef.upstream as string
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)

      // 检查上游是否存在且有数据
      const result = fetchResults.get(upstreamName)
      if (result && result.count > 0) {
        // 使用 DOMAIN-SET 引用规则文件的 GitHub raw URL
        // Shadowrocket 使用 .list 格式
        const ruleUrl = `https://raw.githubusercontent.com/uyloal/universal-proxy-rules/release/rules/${upstreamName}.list`
        rules.push(`DOMAIN-SET,${ruleUrl},${policy}`)
      }
    } else if (type === 'domain') {
      const payload = ruleDef.payload as string[]
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      for (const domain of payload) {
        rules.push(`DOMAIN,${domain},${policy}`)
      }
    } else if (type === 'domain-suffix') {
      const payload = ruleDef.payload as string[]
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      for (const domain of payload) {
        rules.push(`DOMAIN-SUFFIX,${domain},${policy}`)
      }
    } else if (type === 'domain-keyword') {
      const payload = ruleDef.payload as string[]
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      for (const keyword of payload) {
        rules.push(`DOMAIN-KEYWORD,${keyword},${policy}`)
      }
    } else if (type === 'ipcidr') {
      const payload = ruleDef.payload as string[]
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      const noResolve = ruleDef['no-resolve'] ? ',no-resolve' : ''
      for (const cidr of payload) {
        rules.push(`IP-CIDR,${cidr},${policy}${noResolve}`)
      }
    } else if (type === 'geoip') {
      const country = ruleDef.country as string
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      const noResolve = ruleDef['no-resolve'] ? ',no-resolve' : ''
      rules.push(`GEOIP,${country},${policy}${noResolve}`)
    } else if (type === 'dst-port') {
      const ports = ruleDef.ports as string[]
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      for (const port of ports) {
        rules.push(`DST-PORT,${port},${policy}`)
      }
    } else if (type === 'src-port') {
      const ports = ruleDef.ports as string[]
      const policy = mapShadowrocketPolicy(ruleDef.policy as string)
      for (const port of ports) {
        rules.push(`SRC-PORT,${port},${policy}`)
      }
    } else if (type === 'match') {
      // 简化策略：兜底规则直接使用 PROXY
      rules.push('FINAL,PROXY')
    }
  }

  return rules
}

/**
 * Shadowrocket 核心组名称（这些组会被简化移除）
 */
const CORE_PROXY_GROUPS = ['🚀 节点选择', '⚡ 自动测速', '♻️ 故障转移']

/**
 * 构建 Shadowrocket 代理组配置
 * 简化策略：移除核心组，其他组引用核心组的地方替换为 PROXY
 */
function buildShadowrocketProxyGroups(policyConfig: PolicyGroupsConfig): string[] {
  const lines: string[] = []

  for (const group of policyConfig['proxy-groups']) {
    // 跳过核心组（这些在 Shadowrocket 中用 FINAL,PROXY 替代）
    if (CORE_PROXY_GROUPS.includes(group.name)) {
      continue
    }

    const parts: string[] = []

    // 基本格式: name = type, options...
    if (group.type === 'select') {
      // select 类型: name = select, option1, option2, ...
      // Shadowrocket: include-all=true 时使用 PROXY 代表所有实际节点
      let options: string[]
      if (group.proxies) {
        // 将引用核心组的项替换为 PROXY，并去重
        options = group.proxies.map(p => CORE_PROXY_GROUPS.includes(p) ? 'PROXY' : p)
        options = [...new Set(options)]
      } else if (group['include-all']) {
        options = ['PROXY', 'DIRECT']
      } else {
        options = ['DIRECT', 'REJECT']
      }
      parts.push(`${group.name} = ${group.type}, ${options.join(', ')}`)
    } else if (group.type === 'url-test' || group.type === 'fallback') {
      // url-test/fallback: name = type, PROXY, url=..., interval=...
      const options: string[] = []

      // Shadowrocket: 使用 PROXY 作为所有节点的占位符
      if (group['include-all']) {
        options.push('PROXY')
      } else if (group.proxies) {
        // 同样替换核心组引用
        const proxyList = group.proxies.map(p => CORE_PROXY_GROUPS.includes(p) ? 'PROXY' : p)
        options.push(...[...new Set(proxyList)])
      }
      if (group.filter) {
        options.push(`policy-regex-filter=${group.filter}`)
      }
      if (group.url) {
        options.push(`url=${group.url}`)
      }
      if (group.interval) {
        options.push(`interval=${group.interval}`)
      }
      if (group.tolerance) {
        options.push(`tolerance=${group.tolerance}`)
      }
      if (group.timeout) {
        options.push(`timeout=${group.timeout}`)
      }

      parts.push(`${group.name} = ${group.type}, ${options.join(', ')}`)
    }

    if (parts.length > 0) {
      lines.push(parts[0])
    }
  }

  return lines
}

/**
 * 构建完整 Shadowrocket 配置
 */
export async function buildShadowrocketConfig(
  policyConfig: PolicyGroupsConfig,
  fetchResults: Map<string, MergedFetchResult>,
  buildInfo?: { version?: string; commitSha?: string; generatedAt?: string }
): Promise<string> {
  // 1. 读取基础模板
  let baseConfig = await readTextTemplate('shadowrocket-base.conf')

  // 1.5 添加动态生成信息头部
  if (buildInfo) {
    const generatedAt = buildInfo.generatedAt || new Date().toISOString()
    const version = buildInfo.version || 'dev'
    const commitSha = buildInfo.commitSha || 'unknown'
    const generatedHeader = `# --- Build Info ---
# Generated: ${generatedAt}
# Version: ${version}
# Commit: ${commitSha}
#`
    // 在第一个 [Section] 之前插入生成信息
    baseConfig = baseConfig.replace(/^(\[General\])/m, `${generatedHeader}\n$1`)
  }

  // 2. 构建代理组配置
  const proxyGroups = buildShadowrocketProxyGroups(policyConfig)

  // 3. 替换 [Proxy Group] 部分（保留 [Proxy Group] 标题行）
  const proxyGroupPattern = /(\[Proxy Group\])[^\[]*/
  const proxyGroupContent = proxyGroups.join('\n')
  baseConfig = baseConfig.replace(proxyGroupPattern, `$1\n${proxyGroupContent}\n\n`)

  // 4. 构建规则列表
  const rules = buildShadowrocketRules(policyConfig, fetchResults)

  // 5. 替换 [Rule] 部分（保留 [Rule] 标题行，并确保换行）
  const rulePattern = /(\[Rule\])[^\[]*/
  const ruleContent = rules.join('\n')
  baseConfig = baseConfig.replace(rulePattern, `$1\n${ruleContent}\n\n`)

  return baseConfig
}

/**
 * 构建完整 Clash 配置
 */
export async function buildClashConfig(
  upstreamsConfig: UpstreamsConfig,
  policyConfig: PolicyGroupsConfig,
  customConfig: CustomRulesConfig,
  fetchResults: Map<string, MergedFetchResult>
): Promise<GeneratedConfig> {
  // 1. 读取基础模板
  const baseConfig = await readBaseTemplate('clash-base.yaml')

  // 2. 构建 rule-providers (使用 http 类型)
  const ruleProviders = buildRuleProviders(fetchResults, upstreamsConfig, customConfig)

  // 3. 构建规则列表
  const rules = buildRules(policyConfig, fetchResults)

  // 4. 组装最终配置
  const finalConfig: GeneratedConfig = {
    ...baseConfig,
    'proxy-groups': policyConfig['proxy-groups'],
    'rule-providers': ruleProviders,
    rules,
  }

  return finalConfig
}

/**
 * 生成独立规则文件 (用于 HTTP rule-providers)
 * 输出: .yaml (Clash) 和 .list (Shadowrocket)
 */
export async function exportStandaloneRules(
  fetchResults: Map<string, MergedFetchResult>,
  upstreamsConfig: UpstreamsConfig,
  customConfig: CustomRulesConfig
): Promise<void> {
  const rulesDir = join(OUTPUT_DIR, 'rules')
  const generatedAt = new Date().toISOString()

  for (const [name, result] of fetchResults) {
    if (result.count === 0) continue

    const upstreamDef = upstreamsConfig.upstreams[name]
    const customDef = customConfig?.custom_rules?.[name]

    const metadataLines: string[] = []

    // 基础元数据
    if (upstreamDef) {
      metadataLines.push(`# Name: ${upstreamDef.name}`)
      metadataLines.push(`# Behavior: ${upstreamDef.behavior || 'domain'}`)
    } else if (customDef) {
      metadataLines.push(`# Name: ${customDef.name}`)
      metadataLines.push(`# Behavior: ${customDef.behavior || 'domain'}`)
      metadataLines.push(`# Type: Custom`)
    } else {
      metadataLines.push(`# Name: ${name}`)
      metadataLines.push(`# Behavior: domain`)
    }

    metadataLines.push(`# Count: ${result.count}`)
    metadataLines.push(`# Generated: ${generatedAt}`)

    // 添加合并来源信息
    if (result.mergedFrom && result.mergedFrom.length > 0) {
      metadataLines.push(`# Merged From: ${result.mergedFrom.join(', ')}`)
    }

    // 源信息
    if (upstreamDef?.urls?.[0]) {
      metadataLines.push(`# Source: ${upstreamDef.urls[0]}`)
    } else if (customDef) {
      metadataLines.push(`# Source: custom-rules.yaml`)
    }

    // YAML 格式 (Clash)
    const yamlMetadata = metadataLines.join('\n')
    const yamlContent = stringify({ payload: result.rules }, { indent: 2 })
    await writeTextFile(join(rulesDir, `${name}.yaml`), `${yamlMetadata}\n${yamlContent}`)

    // List 格式 (Shadowrocket) - 纯规则列表带头部注释
    const listMetadata = metadataLines.map(line => line.replace(/^# /, '# ')).join('\n')
    const listContent = result.rules.join('\n')
    await writeTextFile(join(rulesDir, `${name}.list`), `${listMetadata}\n${listContent}`)

    // 输出信息
    const extraInfo = result.mergedFrom && result.mergedFrom.length > 0
      ? ` (merged: ${result.mergedFrom.join(', ')})`
      : ''
    console.log(`✓ Exported rules/${name}.yaml / ${name}.list (${result.count} rules)${extraInfo}`)
  }
}

/**
 * 获取构建版本信息
 */
async function getBuildInfo(): Promise<{ version: string; commitSha: string; generatedAt: string }> {
  const generatedAt = new Date().toISOString()
  const dateVersion = generatedAt.replace(/[:T-]/g, '').slice(0, 14) // YYYYMMDDHHMMSS

  let commitSha = 'unknown'
  try {
    const { execSync } = await import('node:child_process')
    commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch {
    // git 不可用，使用默认值
  }

  return {
    version: `v${dateVersion}`,
    commitSha,
    generatedAt,
  }
}

/**
 * 主构建流程
 */
export async function buildAll(): Promise<void> {
  // 获取构建信息
  const buildInfo = await getBuildInfo()
  console.log(`📖 Reading configurations... (Build: ${buildInfo.version})`)

  // 读取配置
  const upstreamsConfig = await readYamlFile<UpstreamsConfig>(
    join(CONFIG_DIR, 'upstreams.yaml')
  )
  const policyConfig = await readYamlFile<PolicyGroupsConfig>(
    join(CONFIG_DIR, 'policy-groups.yaml')
  )

  // 读取自定义规则配置 (如果不存在则使用空配置)
  let customConfig: CustomRulesConfig = { custom_rules: {} }
  try {
    customConfig = await readYamlFile<CustomRulesConfig>(
      join(CONFIG_DIR, 'custom-rules.yaml')
    )
    const customCount = Object.keys(customConfig?.custom_rules || {}).length
    if (customCount > 0) {
      console.log(`  ✓ Custom rules: ${customCount} sources`)
    }
  } catch {
    // 文件不存在，使用空配置
  }

  console.log(`  ✓ Upstreams: ${Object.keys(upstreamsConfig.upstreams).length} sources`)
  console.log(`  ✓ Policy groups: ${policyConfig['proxy-groups'].length} groups`)

  // 获取所有上游规则
  const { fetchAllUpstreams, mergeCustomRules } = await import('./fetcher.js')
  console.log('\n🌐 Fetching upstream rules...')

  const fetchResults = await fetchAllUpstreams(
    upstreamsConfig.upstreams,
    upstreamsConfig.cleanup?.exclude_patterns
  )

  // 显示上游结果
  for (const [name, result] of fetchResults) {
    if (result.count > 0) {
      console.log(`  ✓ ${name}: ${result.count} rules`)
    } else {
      console.log(`  ✗ ${name}: empty or failed`)
    }
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.log(`    ! ${error}`)
      }
    }
  }

  // 合并自定义规则
  console.log('\n📝 Processing custom rules...')
  const mergedResults = mergeCustomRules(fetchResults, customConfig)

  // 统计合并后的结果
  let mergedCount = 0
  let standaloneCount = 0
  for (const [, result] of mergedResults) {
    if (result.isCustomOnly) {
      standaloneCount++
    } else if (result.mergedFrom && result.mergedFrom.length > 0) {
      mergedCount++
    }
  }
  if (mergedCount > 0 || standaloneCount > 0) {
    console.log(`  ✓ Merged into upstreams: ${mergedCount} groups`)
    console.log(`  ✓ Standalone groups: ${standaloneCount} groups`)
  }

  // 构建 Clash 配置
  console.log('\n🔨 Building Clash configuration...')
  const clashConfig = await buildClashConfig(upstreamsConfig, policyConfig, customConfig, mergedResults)

  // 准备 Clash 头部注释
  const clashHeader = `# Universal Proxy Rules for Clash Meta/Mihomo
# Generated: ${buildInfo.generatedAt}
# Version: ${buildInfo.version}
# Commit: ${buildInfo.commitSha}
#`

  // 输出完整配置
  const outputPath = join(OUTPUT_DIR, 'clash-full.yaml')
  await writeYamlFile(outputPath, clashConfig, clashHeader)
  console.log(`  ✓ ${outputPath}`)

  // 构建 Shadowrocket 配置
  console.log('\n🚀 Building Shadowrocket configuration...')
  const shadowrocketConfig = await buildShadowrocketConfig(policyConfig, mergedResults, buildInfo)
  const srOutputPath = join(OUTPUT_DIR, 'shadowrocket-full.conf')
  await writeTextFile(srOutputPath, shadowrocketConfig)
  console.log(`  ✓ ${srOutputPath}`)

  // 输出独立规则文件 (供外部引用)
  console.log('\n📦 Exporting standalone rule files...')
  await exportStandaloneRules(mergedResults, upstreamsConfig, customConfig)

  // 输出元数据
  const totalRules = Array.from(mergedResults.values()).reduce((sum, r) => sum + r.count, 0)
  const metadata = {
    version: buildInfo.version,
    generatedAt: buildInfo.generatedAt,
    commitSha: buildInfo.commitSha,
    totalRules,
    upstreams: Object.fromEntries(
      Array.from(mergedResults).map(([name, r]) => [name, r.count])
    ),
    custom: {
      merged: mergedCount,
      standalone: standaloneCount,
    },
  }
  await writeTextFile(
    join(OUTPUT_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  )
  console.log(`  ✓ metadata.json (${totalRules} total rules)`)

  console.log('\n✅ Build complete!')
  console.log(`   Output: ${OUTPUT_DIR}`)
}
