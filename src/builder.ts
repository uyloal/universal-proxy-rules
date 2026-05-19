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
  RuleProviderEntry,
  GeneratedConfig,
  MergedFetchResult,
  ProxyProvidersConfig,
  ProxiesConfig,
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
 * 读取基础模板
 */
async function readBaseTemplate(name: string): Promise<Record<string, unknown>> {
  const path = join(TEMPLATES_DIR, name)
  const content = await readFile(path, 'utf-8')
  return parse(content) as Record<string, unknown>
}

/**
 * 为规则追加策略，正确处理已有 no-resolve 标记
 */
function appendPolicyToRule(rule: string, policy: string): string {
  const trimmed = rule.trim().toLowerCase()
  const parts = trimmed.split(',')

  if (parts.length < 2) {
    return `${trimmed},${policy}`
  }

  const type = parts[0].toUpperCase()
  const value = parts[1]

  // 检查是否已有 no-resolve
  const hasNoResolve = parts.some((p, i) => i >= 2 && p.trim() === 'no-resolve')

  let result = `${type},${value},${policy}`
  if (hasNoResolve) {
    result += ',no-resolve'
  }

  return result
}

/**
 * 构建 Rule Providers
 * 使用 http 类型从 release 分支获取规则文件
 * 纯自定义规则直接内联到 rules 中，不创建 rule-provider
 */
function buildRuleProviders(
  fetchResults: Map<string, MergedFetchResult>,
  upstreamsConfig: UpstreamsConfig,
  customConfig: CustomRulesConfig
): Record<string, RuleProviderEntry> {
  const providers: Record<string, RuleProviderEntry> = {}

  for (const [name, result] of fetchResults) {
    if (result.count === 0) continue
    // 跳过纯自定义规则（直接内联到 rules 中）
    if (result.isCustomOnly) continue

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
        if (result.isCustomOnly) {
          // 纯自定义规则直接内联展开，不构建 RULE-SET
          // 优先使用自定义规则自身定义的 policy，否则使用绑定配置
          for (const rule of result.rules) {
            rules.push(appendPolicyToRule(rule, policy))
          }
        } else {
          // 使用 RULE-SET 引用 rule-provider
          rules.push(`RULE-SET,${upstreamName},${policy}`)
        }
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
 * 构建完整 Clash 配置
 */
export async function buildClashConfig(
  upstreamsConfig: UpstreamsConfig,
  policyConfig: PolicyGroupsConfig,
  customConfig: CustomRulesConfig,
  fetchResults: Map<string, MergedFetchResult>,
  proxyProvidersConfig?: ProxyProvidersConfig,
  proxiesConfig?: ProxiesConfig
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

  // 5. 合并用户定义的 proxy-providers（如果存在）
  if (proxyProvidersConfig?.['proxy-providers']) {
    finalConfig['proxy-providers'] = proxyProvidersConfig['proxy-providers']
  }

  // 6. 合并用户定义的 proxies（如果存在）
  if (proxiesConfig?.proxies) {
    finalConfig.proxies = proxiesConfig.proxies
  }

  return finalConfig
}

/**
 * 生成独立规则文件 (用于 HTTP rule-providers)
 * 输出: .yaml (Clash)
 */
export async function exportStandaloneRules(
  fetchResults: Map<string, MergedFetchResult>,
  upstreamsConfig: UpstreamsConfig,
  customConfig: CustomRulesConfig
): Promise<void> {
  const rulesDir = join(OUTPUT_DIR, 'rules')
  const generatedAt = new Date().toISOString()

  for (const [name, result] of fetchResults) {
    if (result.count === 0 || result.isCustomOnly) continue

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
    if (upstreamDef?.urls && upstreamDef.urls.length > 0) {
      metadataLines.push(`# Source: ${upstreamDef.urls[0]}`)
      for (let i = 1; i < upstreamDef.urls.length; i++) {
        metadataLines.push(`# Source: ${upstreamDef.urls[i]}`)
      }
    } else if (customDef) {
      metadataLines.push(`# Source: custom-rules.yaml`)
    }

    // YAML 格式 (Clash)
    const yamlMetadata = metadataLines.join('\n')
    const yamlContent = stringify({ payload: result.rules }, { indent: 2 })
    await writeTextFile(join(rulesDir, `${name}.yaml`), `${yamlMetadata}\n${yamlContent}`)

    // 输出信息
    const extraInfo = result.mergedFrom && result.mergedFrom.length > 0
      ? ` (merged: ${result.mergedFrom.join(', ')})`
      : ''
    console.log(`✓ Exported rules/${name}.yaml (${result.count} rules)${extraInfo}`)
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

  // 读取可选的 proxy-providers 配置（存在时才加载）
  let proxyProvidersConfig: ProxyProvidersConfig | undefined
  try {
    proxyProvidersConfig = await readYamlFile<ProxyProvidersConfig>(
      join(CONFIG_DIR, 'proxy-providers.yaml')
    )
    const providerCount = Object.keys(proxyProvidersConfig?.['proxy-providers'] || {}).length
    if (providerCount > 0) {
      console.log(`  ✓ Proxy providers: ${providerCount} providers`)
    }
  } catch {
    // 文件不存在，跳过
  }

  // 读取可选的 proxies 配置（存在时才加载）
  let proxiesConfig: ProxiesConfig | undefined
  try {
    proxiesConfig = await readYamlFile<ProxiesConfig>(
      join(CONFIG_DIR, 'proxies.yaml')
    )
    const proxyCount = proxiesConfig?.proxies?.length || 0
    if (proxyCount > 0) {
      console.log(`  ✓ Proxies: ${proxyCount} nodes`)
    }
  } catch {
    // 文件不存在，跳过
  }

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
  const clashConfig = await buildClashConfig(
    upstreamsConfig,
    policyConfig,
    customConfig,
    mergedResults,
    proxyProvidersConfig,
    proxiesConfig
  )

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
