# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm dev` - Run generator in development mode (tsx)
- `pnpm generate` - Generate configurations (outputs to `output/`)

## Architecture Overview

Config-driven proxy rules aggregation engine for Clash Meta/Mihomo and Shadowrocket. Fetches upstream rule sets, deduplicates them, and generates configuration templates containing no proxy nodes (intentionally decoupled).

### Data Flow

```
config/upstreams.yaml     - Define upstream rule sources (multiple URLs per group)
config/policy-groups.yaml - Define proxy groups and rule-to-policy mappings  
config/custom-rules.yaml  - User-defined custom rules (merge or standalone)
     │
     ▼
src/fetcher.ts  - Concurrent download, YAML/text parsing, deduplication
     │
     ▼
src/builder.ts  - Template assembly, inline rule-provider construction
     │
     ▼
output/         - clash-full.yaml, shadowrocket-full.conf, rules/
```

### Key Implementation Details

**Fetcher** (`src/fetcher.ts`): Uses `for...of` loops instead of `array.push(...largeArray)` to avoid stack overflow when processing 100k+ rules. Downloads from multiple URLs per rule set concurrently and deduplicates across sources.

**Builder** (`src/builder.ts`): Constructs `rule-providers` with `type: inline` for zero external dependencies at runtime. Parses both `payload:` YAML format and plain text rules, normalizing to `DOMAIN-SUFFIX,example.com` format.

**Custom Rules** (`config/custom-rules.yaml`): Rules with `merge_into` field are merged into the specified upstream group; rules without it become standalone groups with their own rule files.

### GitHub Actions

`.github/workflows/deploy.yml` runs daily (cron `0 0,12 * * *`) to fetch fresh rules, generate configurations, create GitHub Release with ZIP, and push to `release` branch for raw URL access.
