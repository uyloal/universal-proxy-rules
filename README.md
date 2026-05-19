# Universal Proxy Rules

[![Build Status](https://github.com/Uyloal/universal-proxy-rules/workflows/Build%20and%20Release/badge.svg)](https://github.com/Uyloal/universal-proxy-rules/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Config-as-Code 驱动的代理规则聚合引擎。自动从多个上游源获取规则，去重合并后生成 Clash Meta / Mihomo 配置模板（不含节点，完全解耦）。

## 特性

- **多源聚合**：同一规则集可从多个 URL（GitHub + CDN）获取，自动合并去重
- **大规模处理**：跨源去重，支持数万条规则稳定处理（使用循环替代大数组展开避免栈溢出）
- **自定义规则**：通过 YAML 配置添加个人规则，可合并到现有分组或独立成组
- **节点信息解耦**：生成的配置模板不含任何代理节点，通过客户端 Merge/Override 或 proxy-provider 注入
- **规则集自动更新**：生成的配置通过 `rule-providers` 自动从 release 分支获取最新规则文件
- **单格式输出**：生成 Clash (YAML) 配置
- **自动构建**：GitHub Actions 每日构建两次（UTC 00:00 和 12:00）

## 使用方式

### 方式一：客户端 Merge / Override（推荐）

在 Clash Verge Rev、OpenClash、Stash 等客户端中，使用配置链接并通过 Merge 注入节点：

```
https://raw.githubusercontent.com/Uyloal/universal-proxy-rules/release/clash-full.yaml
```

**Merge 示例（Clash Verge Rev）：**
```yaml
prepend:
  proxies:
    - name: "Node1"
      type: ss
      server: example.com
      port: 8388
      cipher: aes-256-gcm
      password: "password"
```

由于策略组使用 `include-all: true` 配置，注入的节点会自动被核心策略组（选择代理、自动选择、故障转移、地区分组等）包含。

### 方式二：构建时注入节点（高级）

如需在构建阶段直接嵌入节点信息，可复制示例文件并修改：

```bash
cp config/proxy-providers.example.yaml config/proxy-providers.yaml
cp config/proxies.example.yaml config/proxies.yaml
```

编辑后运行 `pnpm generate`，节点信息将被合并到 `output/clash-full.yaml` 中。

> ⚠️ 注意：请勿将包含订阅 Token 或密码的配置提交到 Git 仓库。

### 方式三：Sub-Store 脚本

```javascript
function operator(proxies = [], targetPlatform, context) {
  const template = $content;
  template['proxy-groups'].forEach(g => {
    if (g['include-all']) {
      g.proxies = g.proxies || [];
      g.proxies.unshift(...proxies.map(p => p.name));
    }
  });
  return template;
}
```

## 支持的规则集

| 类别 | 服务 |
|------|------|
| AI | OpenAI, Gemini, Claude, Anthropic, BardAI, Copilot |
| 流媒体 | YouTube, YouTubeMusic, Netflix, Disney, HBO, Hulu, Spotify, TikTok |
| 流媒体（国内）| 哔哩哔哩, 网易云音乐, 抖音, 优酷, 腾讯视频, 爱奇艺, 喜马拉雅, CCTV |
| 社交 | Telegram, Twitter/X, Discord, Reddit, Instagram, LinkedIn, Line, Threads |
| 社交（国内）| 微信, 新浪微博, 知乎, 小红书, 微信键盘, 斗鱼 |
| Apple | iCloud Private Relay |
| Apple（国内）| Apple, App Store, iCloud, TestFlight, Fitness+, Apple Mail, Apple Music, Apple News, Apple TV, 系统更新, Siri, 查找, Apple Proxy, Apple Developer, 固件下载, 硬件服务, Apple Media, Beats, Apple ID |
| 国内 | China |
| 局域网 | LAN |

## 自定义规则

编辑 `config/custom-rules.yaml`：

```yaml
custom_rules:
  # 合并到现有分组
  apple:
    name: "Apple"
    behavior: classical
    mode: append
    merge_into: apple
    rules:
      - "DOMAIN-SUFFIX,push.apple.com"
      - "IP-CIDR,17.0.0.0/8,no-resolve"

  # 独立分组（内联到 rules，不创建 rule-provider）
  custom-direct:
    name: "Custom Direct"
    behavior: classical
    mode: standalone
    rules:
      - "DST-PORT,22,DIRECT"
```

运行 `pnpm generate` 生成配置。

## 配置结构

```
config/
  upstreams.yaml               # 上游规则源配置（多 URL 聚合）
  policy-groups.yaml           # 策略组与规则绑定
  custom-rules.yaml            # 自定义规则（append / standalone）
  proxy-providers.example.yaml # 代理提供商示例（可选）
  proxies.example.yaml         # 代理节点示例（可选）
templates/
  clash-base.yaml              # 基础配置模板（端口、DNS、TUN 等）
```

- `upstreams.yaml`：定义规则集名称、URL、格式、行为类型等
- `policy-groups.yaml`：定义策略组结构和规则到策略的映射（优先级从上到下）
- `custom-rules.yaml`：个人自定义规则，支持合并到 upstream 或独立成组
- `proxy-providers.example.yaml` / `proxies.example.yaml`：复制为 `.yaml` 后可在构建时注入节点

## 开发

```bash
pnpm install    # 安装依赖
pnpm dev        # 开发模式（热重载）
pnpm generate   # 生成配置（输出到 output/）
```

## 输出文件

| 文件 | 说明 |
|------|------|
| `clash-full.yaml` | Clash 完整配置模板 |
| `rules/*.yaml` | 独立规则集文件（供 `rule-providers` HTTP 下载） |
| `metadata.json` | 构建统计（版本、规则数量、来源等） |

## 致谢

- 规则源：[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)
- 图标：[Koolson/Qure](https://github.com/Koolson/Qure)

## License

MIT © Uyloal
