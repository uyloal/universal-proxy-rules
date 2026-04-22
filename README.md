# Universal Proxy Rules

[![Build Status](https://github.com/Uyloal/universal-proxy-rules/workflows/Build%20and%20Release/badge.svg)](https://github.com/Uyloal/universal-proxy-rules/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **Config-as-Code** driven proxy rules aggregation engine for Clash Meta/Mihomo and Shadowrocket. Fetches upstream rule sets, deduplicates them, and generates ready-to-use configuration templates.

## Philosophy

This project follows three core principles:

1. **Complete Decoupling**: This repository contains only rule aggregation logic and templates — **no proxy nodes are included**. Your node subscriptions remain private.
2. **Local Composition**: Generated configuration templates are merged with your private nodes on the client-side using Merge/Script/Sub-Store.
3. **Config-Driven**: All upstream sources and policy groups are defined in YAML files under `config/`, making changes trackable and reviewable.

## Features

- **Multi-Source Aggregation**: Fetch from multiple URLs per rule set (GitHub + CDNs) and merge automatically
- **Smart Deduplication**: Cross-source deduplication with 300k+ rules support
- **Zero Runtime Dependencies**: Generated configs use `inline` rule-providers, no external downloads needed at runtime
- **Dual Format Output**: Both Clash (YAML) and Shadowrocket (.conf) configurations
- **Automated Updates**: GitHub Actions builds twice daily (00:00 & 12:00 UTC)
- **Dual Publishing**: GitHub Releases (ZIP) + `release` branch (raw links)

## Supported Services

| Category | Services |
|----------|----------|
| **AI** | OpenAI, Gemini, Claude |
| **Streaming** | YouTube, Netflix, Disney+, HBO, Spotify, TikTok, BiliBili |
| **Social** | Telegram, Twitter/X, Facebook, Discord, Reddit, WeChat, Zhihu |
| **Gaming** | Steam, Epic, Sony, Nintendo |
| **Tech** | GitHub, Google, Microsoft, Apple, Docker |
| **Commerce** | PayPal, Amazon |
| **China** | Baidu, Douyin, Douban, Sina |

## Quick Start

### For Users

#### Clash Verge Rev / OpenClash / Stash

1. Use the configuration URL:
   ```
   https://raw.githubusercontent.com/Uyloal/universal-proxy-rules/release/clash-full.yaml
   ```

2. Inject your nodes via **Merge**:
   ```yaml
   # In Clash Verge Rev → Profiles → Right-click → Edit → Merge
   prepend:
     proxies:
       - name: "MyNode1"
         type: ss
         server: example.com
         port: 8388
         cipher: aes-256-gcm
         password: "password"
   ```

3. Or use **Script** for dynamic injection from subscriptions.

#### Shadowrocket

Import `shadowrocket-full.conf` from the latest [Release](../../releases).

### For Developers

```bash
# Clone the repository
git clone https://github.com/Uyloal/universal-proxy-rules.git
cd universal-proxy-rules

# Install dependencies
pnpm install

# Generate configurations
pnpm generate

# Output will be in ./output/
```

## Architecture

```
config/upstreams.yaml ──┐
config/policy-groups.yaml├─→ fetcher.ts ──→ builder.ts ──→ output/
config/custom-rules.yaml ─┘                    (clash-full.yaml
                                               shadowrocket-full.conf
                                               rules/*.yaml)
```

### Key Components

| File | Purpose |
|------|---------|
| `src/fetcher.ts` | Concurrent downloading with p-queue style control, YAML/text parsing, deduplication |
| `src/builder.ts` | Template assembly, rule-provider construction, policy mapping |
| `config/upstreams.yaml` | Define upstream rule sources (supports multiple URLs per group) |
| `config/policy-groups.yaml` | Strategy groups with `include-all: true` and regex filters |
| `config/custom-rules.yaml` | Custom rules (merge into upstream or standalone groups) |

## Configuration Reference

### Upstreams (`config/upstreams.yaml`)

```yaml
upstreams:
  ai:
    name: "AI"
    behavior: domain
    urls:
      - "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/.../OpenAI.list"
      - "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script/.../OpenAI.list"
    format: classical
    interval: 86400
```

### Policy Groups (`config/policy-groups.yaml`)

```yaml
proxy-groups:
  - name: "🇭🇰 香港节点"
    type: url-test
    include-all: true
    filter: "(?i)港|hk|hongkong"
    url: "https://www.gstatic.com/generate_204"
    interval: 300

rules:
  - type: upstream
    upstream: "ai"
    policy: "🤖 AI 服务"
```

### Custom Rules (`config/custom-rules.yaml`)

```yaml
custom_rules:
  my-company:
    rules:
      - DOMAIN-SUFFIX,internal.company.com
      - DOMAIN,wiki.company.com
    merge_into: "lan"  # Merge into existing group

  personal-sites:
    rules:
      - DOMAIN-SUFFIX,personal-blog.com
    # No merge_into = standalone group
```

## Automation

GitHub Actions runs on schedule (`0 0,12 * * *`) and:

1. Fetches fresh rules from all upstreams
2. Parses and deduplicates (optimized for 100k+ rules with `for...of` loops)
3. Generates configurations
4. Creates a GitHub Release with ZIP attachment
5. Pushes to `release` branch for raw URL access

## Output Files

| File | Description |
|------|-------------|
| `clash-full.yaml` | Complete Clash Meta/Mihomo config (10MB+, 300k+ rules) |
| `shadowrocket-full.conf` | Shadowrocket configuration |
| `rules/*.yaml` | Individual rule sets in YAML format |
| `rules/*.txt` | Individual rule sets in text format |
| `metadata.json` | Build statistics and timestamps |

## Sub-Store Integration

```javascript
// Script Operator
function operator(proxies = [], targetPlatform, context) {
  const template = $content;

  // Auto-populate include-all groups
  template['proxy-groups'].forEach(g => {
    if (g['include-all'] && g.proxies) {
      g.proxies.unshift(...proxies.map(p => p.name));
    }
  });

  return template;
}
```

## Contributing

1. Fork the repository
2. Edit `config/upstreams.yaml` or `config/policy-groups.yaml`
3. Test locally: `pnpm generate`
4. Submit a Pull Request

## Acknowledgments

- Rule sources: [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)
- Icons: [Koolson/Qure](https://github.com/Koolson/Qure)

## License

[MIT](LICENSE) © Uyloal
