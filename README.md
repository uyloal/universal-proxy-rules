# Proxy Rules Aggregation Engine

基于配置驱动 (Config as Code) 的代理规则与模板聚合引擎，支持 Clash Meta/Mihomo、Shadowrocket 等客户端。

## 核心架构哲学

1. **彻底解耦**: 本仓库只存放「上游规则抓取逻辑」、「路由策略组配置」和「基础模板」。**绝对不含任何节点信息**
2. **本地聚合**: 生成的动态配置文件作为模板下发，与用户的私密节点在客户端本地完成合体
3. **配置驱动**: 所有策略组和上游地址由 `config/` 目录下的 YAML 文件动态驱动

## 技术栈

- **Runtime**: Node.js 22+
- **Package Manager**: pnpm
- **Bundler**: tsdown (基于 Rolldown)
- **Language**: TypeScript (ESM only)
- **Dependencies**: 原生 `fetch`, `yaml` 包

## 项目结构

```
.
├── config/                  # 配置驱动核心
│   ├── upstreams.yaml       # 上游规则源管理
│   └── policy-groups.yaml   # 策略组定义与路由规则
├── templates/               # 基础模板 (无节点)
│   ├── clash-base.yaml      # Clash 网络底层配置
│   └── shadowrocket-base.conf
├── src/                     # TypeScript 核心逻辑
│   ├── index.ts             # 主入口
│   ├── fetcher.ts           # 并发下载与清洗
│   ├── builder.ts           # 配置构建
│   └── types.ts             # 类型定义
├── .github/workflows/
│   └── deploy.yml           # 自动化发布
├── package.json
├── tsdown.config.ts         # 构建配置
└── tsconfig.json
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式 (直接运行 TS)
pnpm dev

# 构建项目
pnpm build

# 生成配置
pnpm generate
```

## 配置说明

### upstreams.yaml - 上游规则源

定义从哪里获取规则，支持多 URL 聚合:

```yaml
upstreams:
  ad-block:
    name: "Ad Block"
    behavior: domain
    urls:
      - "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt"
    interval: 86400
```

### policy-groups.yaml - 策略组与路由

完全解耦节点，使用 `include-all: true` 和 `filter` 实现动态分组:

```yaml
proxy-groups:
  - name: "🇭🇰 香港节点"
    type: url-test
    include-all: true          # 包含所有节点
    filter: "(?i)港|hk|hongkong" # 正则匹配节点名
    url: 'https://www.gstatic.com/generate_204'
    interval: 300

rules:
  - type: upstream
    upstream: "ad-block"
    policy: "🛑 广告拦截"
```

## 客户端使用方式

### Clash Verge Rev / OpenClash

1. 订阅 `release` 分支的 `clash-full.yaml`
2. 在客户端使用 **Merge** 或 **Script** 注入节点

**Merge 示例**:
```yaml
# 在客户端创建 Merge 配置
prepend:
  proxies:
    - { name: "节点1", ... }
  proxy-providers:
    my-sub:
      type: http
      url: "你的订阅链接"
```

### Sub-Store 脚本操作

```javascript
// 操作: Script
function operator(proxies = [], targetPlatform, context) {
  const template = $content
  template.proxies = proxies

  // 自动填充 include-all 策略组
  template['proxy-groups'].forEach(g => {
    if (g['include-all'] && g.proxies) {
      g.proxies.unshift(...proxies.map(p => p.name))
    }
  })

  return template
}
```

## 自动化发布

GitHub Actions 每天自动:
1. 拉取上游规则
2. 清洗去重
3. 生成配置
4. 推送到 `release` 分支

## License

MIT
