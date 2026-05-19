# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm dev` - Run generator in development mode (tsx)
- `pnpm generate` - Generate configurations (outputs to `output/`)

## Architecture Overview

Config-driven proxy rules aggregation engine for Clash Meta/Mihomo. Fetches upstream rule sets, deduplicates them, and generates configuration templates containing no proxy nodes (intentionally decoupled).

### Data Flow

```
config/upstreams.yaml        - Define upstream rule sources (multiple URLs per group)
config/policy-groups.yaml    - Define proxy groups and rule-to-policy mappings
config/custom-rules.yaml     - User-defined custom rules (append or standalone)
config/proxy-providers.yaml  - Optional: proxy provider subscriptions (merged if present)
config/proxies.yaml          - Optional: inline proxy nodes (merged if present)
templates/clash-base.yaml    - Base template (ports, DNS, TUN, sniffer)
     │
     ▼
src/fetcher.ts  - Concurrent download, YAML/text parsing, deduplication
     │
     ▼
src/builder.ts  - Template assembly, HTTP rule-provider construction
     │
     ▼
output/         - clash-full.yaml, rules/*.yaml, metadata.json
```

### Key Implementation Details

**Fetcher** (`src/fetcher.ts`): Uses `for...of` loops instead of `array.push(...largeArray)` to avoid stack overflow when processing 100k+ rules. Downloads from multiple URLs per rule set concurrently and deduplicates across sources.

**Builder** (`src/builder.ts`): Assembles the final config by merging `templates/clash-base.yaml` with generated `rule-providers` (type: `http`, pointing to the `release` branch), `proxy-groups`, and `rules`. If `config/proxy-providers.yaml` or `config/proxies.yaml` exist, they are merged into the output automatically.

**Custom Rules** (`config/custom-rules.yaml`): Each entry has a `mode` field (`append` or `standalone`). `append` rules with `merge_into` are deduplicated and merged into the specified upstream group. `standalone` rules are inlined directly into the final `rules` array without creating a rule-provider.

**Types** (`src/types.ts`): The central type contract. `UpstreamSource`, `ProxyGroup`, `Rule`, `CustomRuleSource`, `GeneratedConfig`, and `ProxyProviderConfig` are all defined here and used across `fetcher.ts` and `builder.ts`.

### GitHub Actions

`.github/workflows/deploy.yml` runs daily (cron `0 0,12 * * *`) to fetch fresh rules, generate configurations, create GitHub Release with ZIP, and force-push the `output/` contents to the `release` branch for raw URL access.
