# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm dev` - Run generator in development mode (tsx, no build needed)
- `pnpm build` - Build with tsdown (outputs to `dist/`)
- `pnpm generate` - Run the built generator (outputs to `dist/output/`)
- `pnpm start` - Run built generator

## Architecture Overview

This is a **config-driven proxy rules aggregation engine** for Clash Meta/Mihomo. It fetches upstream rule sets from the internet, deduplicates them, and generates ready-to-use configuration templates that contain **no proxy nodes** (intentionally decoupled).

### Data Flow

```
config/upstreams.yaml ──┐
config/policy-groups.yaml├─→ fetcher.ts ──→ builder.ts ──→ dist/output/
templates/clash-base.yaml─┘                  (full config + rules/)
```

1. **Fetcher** (`src/fetcher.ts`): Concurrently downloads rule files from URLs defined in `upstreams.yaml`, parses YAML/text formats, cleans and deduplicates rules. **Critical implementation detail**: Uses `for...of` loops instead of `array.push(...largeArray)` to avoid stack overflow with 100k+ rules.

2. **Builder** (`src/builder.ts`): Reads templates, constructs `rule-providers` (type: `inline` for zero external dependencies at runtime), maps rules to policies per `policy-groups.yaml`, outputs `clash-full.yaml`.

3. **Output** (`dist/output/`):
   - `clash-full.yaml` - Complete config with inline rule-providers (10MB+ with 300k+ rules)
   - `rules/*.yaml` - Standalone rule sets for external reference
   - `metadata.json` - Build stats

### Key Design Decisions

**No proxy nodes in repo**: The output templates use `include-all: true` with `filter` regex patterns (e.g., `(?i)港|hk|hongkong`) for region groups. Nodes are injected client-side via Merge/Script/Sub-Store.

**Upstream rule aggregation**: Same logical rule set can have multiple URLs (GitHub + CDN); fetcher downloads all, deduplicates across sources.

**Rule format support**: Parser handles both `payload:` YAML format and plain text, normalizes to `DOMAIN-SUFFIX,example.com` format.

### GitHub Actions

`.github/workflows/deploy.yml` runs daily (cron `0 0,12 * * *`) to:
1. Fetch fresh rules
2. Build project
3. Push `dist/output/` contents to `release` branch (squashed, no history)

Users subscribe to the `release` branch `clash-full.yaml`, not `main`.
