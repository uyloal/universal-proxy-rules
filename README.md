# Universal Proxy Rules

[![Build Status](https://github.com/Uyloal/universal-proxy-rules/workflows/Build%20and%20Release/badge.svg)](https://github.com/Uyloal/universal-proxy-rules/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

支持自定义与多源代理规则聚合的程序。自动从多个上游源获取规则，去重合并后生成 Clash Meta/Mihomo 和 Shadowrocket 配置文件。

## 特性

- **多源聚合**：同一规则集可从多个 URL（GitHub + CDN）获取，自动合并
- **智能去重**：跨源去重，支持 30 万+ 条规则
- **自定义规则**：通过 YAML 配置添加个人规则，可合并到现有分组或独立成组
- **零运行时依赖**：生成的配置使用 `inline` 规则提供者，无需外部下载
- **双格式输出**：同时生成 Clash (YAML) 和 Shadowrocket (.conf) 配置
- **自动更新**：GitHub Actions 每日构建两次（UTC 00:00 和 12:00）

## 使用方式

### Clash Verge Rev / OpenClash / Stash

1. 使用配置链接：
   ```
   https://raw.githubusercontent.com/Uyloal/universal-proxy-rules/release/clash-full.yaml
   ```

2. 通过 Merge 注入节点：
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

### Shadowrocket

从 [Releases](../../releases) 下载 `shadowrocket-full.conf` 导入。

## 支持的规则集

| 类别 | 服务 |
|------|------|
| AI | OpenAI, Gemini, Claude |
| 流媒体 | YouTube, Netflix, Disney+, HBO, Spotify, TikTok, 哔哩哔哩 |
| 社交 | Telegram, Twitter/X, Facebook, Discord, Reddit, 微信，知乎 |
| 游戏 | Steam, Epic, Sony, Nintendo |
| 科技 | GitHub, Google, Microsoft, Apple, Docker |
| 电商 | PayPal, Amazon |
| 国内 | 百度，抖音，豆瓣，新浪 |

## 自定义规则

编辑 `config/custom-rules.yaml`：

```yaml
custom_rules:
  # 合并到现有分组
  company:
    rules:
      - DOMAIN-SUFFIX,internal.company.com
    merge_into: "direct"

  # 独立分组
  personal:
    rules:
      - DOMAIN-SUFFIX,personal-blog.com
```

运行 `pnpm generate` 生成配置。

## 配置结构

```
config/
  upstreams.yaml      # 上游规则源配置
  policy-groups.yaml  # 策略组配置
  custom-rules.yaml   # 自定义规则
```

- `upstreams.yaml`：定义规则集名称、URL、格式等
- `policy-groups.yaml`：定义策略组和规则映射
- `custom-rules.yaml`：个人自定义规则

## 开发

```bash
pnpm install    # 安装依赖
pnpm dev        # 开发模式
pnpm generate   # 生成配置（输出到 output/）
```

## 输出文件

| 文件 | 说明 |
|------|------|
| `clash-full.yaml` | Clash 完整配置（30 万+ 条规则） |
| `shadowrocket-full.conf` | Shadowrocket 配置 |
| `rules/*.yaml` | 独立规则集（YAML） |
| `rules/*.txt` | 独立规则集（文本） |
| `metadata.json` | 构建统计 |

## Sub-Store 脚本

```javascript
function operator(proxies = [], targetPlatform, context) {
  const template = $content;
  template['proxy-groups'].forEach(g => {
    if (g['include-all'] && g.proxies) {
      g.proxies.unshift(...proxies.map(p => p.name));
    }
  });
  return template;
}
```

## 致谢

- 规则源：[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)
- 图标：[Koolson/Qure](https://github.com/Koolson/Qure)

## License

MIT © Uyloal
