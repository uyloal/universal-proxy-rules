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
  ProxyGroup,
  Rule,
  RuleProviderEntry,
  GeneratedConfig,
  FetchResult,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const CONFIG_DIR = join(ROOT_DIR, 'config')
const TEMPLATES_DIR = join(ROOT_DIR, 'templates')
const OUTPUT_DIR = join(ROOT_DIR, 'dist', 'output')

/**
 * 读取 YAML 配置文件
 */
async function readYamlFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8')
  return parse(content) as T
}

/**
 * 写入 YAML 文件
 */
async function writeYamlFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const yaml = stringify(data, {
    indent: 2,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'PLAIN',
  })
  await writeFile(path, yaml, 'utf-8')
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
 */
function buildRuleProviders(
  fetchResults: Map<string, FetchResult>
): Record<string, RuleProviderEntry> {
  const providers: Record<string, RuleProviderEntry> = {}

  for (const [name, result] of fetchResults) {
    if (result.count === 0) continue

    // 使用内联方式存储规则 (简化部署，无需额外 HTTP 请求)
    providers[name] = {
      type: 'inline',
      behavior: 'domain', // 实际行为由规则内容决定
      payload: result.rules,
    }
  }

  return providers
}

/**
 * 构建规则列表 (rules 字段)
 */
function buildRules(
  policyConfig: PolicyGroupsConfig,
  fetchResults: Map<string, FetchResult>
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
 * 构建完整 Clash 配置
 */
export async function buildClashConfig(
  upstreamsConfig: UpstreamsConfig,
  policyConfig: PolicyGroupsConfig,
  fetchResults: Map<string, FetchResult>
): Promise<GeneratedConfig> {
  // 1. 读取基础模板
  const baseConfig = await readBaseTemplate('clash-base.yaml')

  // 2. 构建 rule-providers
  const ruleProviders = buildRuleProviders(fetchResults)

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
 */
export async function exportStandaloneRules(
  fetchResults: Map<string, FetchResult>
): Promise<void> {
  const rulesDir = join(OUTPUT_DIR, 'rules')

  for (const [name, result] of fetchResults) {
    if (result.count === 0) continue

    // YAML 格式
    const yamlContent = stringify({ payload: result.rules }, { indent: 2 })
    await writeTextFile(join(rulesDir, `${name}.yaml`), yamlContent)

    // Text 格式 (纯规则列表)
    const textContent = result.rules.join('\n')
    await writeTextFile(join(rulesDir, `${name}.txt`), textContent)

    console.log(`✓ Exported rules/${name}.yaml (${result.count} rules)`)
  }
}

/**
 * 主构建流程
 */
export async function buildAll(): Promise<void> {
  console.log('📖 Reading configurations...')

  // 读取配置
  const upstreamsConfig = await readYamlFile<UpstreamsConfig>(
    join(CONFIG_DIR, 'upstreams.yaml')
  )
  const policyConfig = await readYamlFile<PolicyGroupsConfig>(
    join(CONFIG_DIR, 'policy-groups.yaml')
  )

  console.log(`  ✓ Upstreams: ${Object.keys(upstreamsConfig.upstreams).length} sources`)
  console.log(`  ✓ Policy groups: ${policyConfig['proxy-groups'].length} groups`)

  // 获取所有上游规则
  const { fetchAllUpstreams } = await import('./fetcher.js')
  console.log('\n🌐 Fetching upstream rules...')

  const fetchResults = await fetchAllUpstreams(
    upstreamsConfig.upstreams,
    upstreamsConfig.cleanup?.exclude_patterns
  )

  // 显示结果
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

  // 构建 Clash 配置
  console.log('\n🔨 Building Clash configuration...')
  const clashConfig = await buildClashConfig(upstreamsConfig, policyConfig, fetchResults)

  // 输出完整配置
  const outputPath = join(OUTPUT_DIR, 'clash-full.yaml')
  await writeYamlFile(outputPath, clashConfig)
  console.log(`  ✓ ${outputPath}`)

  // 输出独立规则文件 (供外部引用)
  console.log('\n📦 Exporting standalone rule files...')
  await exportStandaloneRules(fetchResults)

  // 输出元数据
  const metadata = {
    generatedAt: new Date().toISOString(),
    upstreams: Object.fromEntries(
      Array.from(fetchResults).map(([name, r]) => [name, r.count])
    ),
  }
  await writeTextFile(
    join(OUTPUT_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  )
  console.log(`  ✓ metadata.json`)

  console.log('\n✅ Build complete!')
  console.log(`   Output: ${OUTPUT_DIR}`)
}
