/**
 * 核心类型定义
 * 完全基于 Clash Meta/Mihomo 官方规范
 * https://wiki.metacubex.one/
 */

// ==================== 上游规则源类型 ====================

export interface UpstreamSource {
  name: string
  behavior: 'domain' | 'ipcidr' | 'classical'
  urls: string[]
  interval?: number
  format?: 'yaml' | 'text' | 'mrs'
}

export interface UpstreamsConfig {
  upstreams: Record<string, UpstreamSource>
  cleanup: {
    exclude_patterns?: string[]
    sort?: boolean
    lowercase?: boolean
  }
}

// ==================== 策略组类型 ====================

export type ProxyGroupType =
  | 'select'
  | 'url-test'
  | 'fallback'
  | 'load-balance'
  | 'relay'

export interface ProxyGroup {
  name: string
  type: ProxyGroupType
  icon?: string
  // 代理节点引用
  proxies?: string[]
  // 引用 proxy-provider
  use?: string[]
  // 包含所有节点
  'include-all'?: boolean
  // 节点名称过滤器 (正则表达式)
  filter?: string
  // 排除过滤器
  'exclude-filter'?: string
  // url-test / fallback / load-balance 参数
  url?: string
  interval?: number
  tolerance?: number
  timeout?: number
  lazy?: boolean
  'expected-status'?: number | string
  // load-balance 专用
  strategy?: 'consistent-hashing' | 'round-robin' | 'sticky-sessions'
  // 隐藏策略组
  hidden?: boolean
  // 默认选择
  default?: string
}

// ==================== 规则类型 ====================

export type RuleType =
  | 'domain'
  | 'domain-suffix'
  | 'domain-keyword'
  | 'ipcidr'
  | 'ipcidr6'
  | 'src-ipcidr'
  | 'dst-port'
  | 'src-port'
  | 'process-name'
  | 'process-path'
  | 'geoip'
  | 'geosite'
  | 'match'
  | 'upstream'

export interface BaseRule {
  policy: string
}

export interface DomainRule extends BaseRule {
  type: 'domain'
  payload: string[]
}

export interface DomainSuffixRule extends BaseRule {
  type: 'domain-suffix'
  payload: string[]
}

export interface DomainKeywordRule extends BaseRule {
  type: 'domain-keyword'
  payload: string[]
}

export interface IPCIDRRule extends BaseRule {
  type: 'ipcidr'
  payload: string[]
  'no-resolve'?: boolean
}

export interface GeoIPRule extends BaseRule {
  type: 'geoip'
  country: string
  'no-resolve'?: boolean
}

export interface GeositeRule extends BaseRule {
  type: 'geosite'
  site: string
}

export interface PortRule extends BaseRule {
  type: 'dst-port' | 'src-port'
  ports: string[]
}

export interface ProcessRule extends BaseRule {
  type: 'process-name' | 'process-path'
  processes: string[]
}

export interface UpstreamRule extends BaseRule {
  type: 'upstream'
  upstream: string
}

export interface MatchRule extends BaseRule {
  type: 'match'
}

export type Rule =
  | DomainRule
  | DomainSuffixRule
  | DomainKeywordRule
  | IPCIDRRule
  | GeoIPRule
  | GeositeRule
  | PortRule
  | ProcessRule
  | UpstreamRule
  | MatchRule

// ==================== 策略组配置 ====================

export interface PolicyGroupsConfig {
  'proxy-groups': ProxyGroup[]
  rules: Array<{
    type: string
    [key: string]: unknown
  }>
}

// ==================== 输出配置 ====================

export interface RuleProviderEntry {
  type: 'http' | 'file' | 'inline'
  behavior: 'domain' | 'ipcidr' | 'classical'
  url?: string
  path?: string
  interval?: number
  format?: 'yaml' | 'text' | 'mrs'
  proxy?: string
  payload?: string[]
  header?: Record<string, string[]>
}

export interface GeneratedConfig {
  // 基础配置从模板合并
  [key: string]: unknown
  // 策略组
  'proxy-groups'?: ProxyGroup[]
  // 规则提供者
  'rule-providers'?: Record<string, RuleProviderEntry>
  // 规则
  rules?: string[]
}

// ==================== 自定义规则类型 ====================

export interface CustomRuleSource {
  name: string
  behavior: 'domain' | 'ipcidr' | 'classical'
  rules: string[]
  merge_into?: string
  interval?: number
}

export interface CustomRulesConfig {
  custom_rules: Record<string, CustomRuleSource>
}

// ==================== Fetcher 结果 ====================

export interface FetchedRule {
  type: string
  value: string
}

export interface FetchResult {
  upstreamName: string
  rules: string[]
  count: number
  errors: string[]
}

export interface MergedFetchResult extends FetchResult {
  mergedFrom?: string[]  // 记录合并了哪些自定义规则源
  isCustomOnly?: boolean  // 标记是否只有自定义规则(无upstream)
}
