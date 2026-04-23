# Proxy Rules Generated Configurations

此分支由 GitHub Actions 自动生成，请勿手动编辑。

## 文件说明

- `clash-full.yaml` - 完整的 Clash Meta/Mihomo 配置模板 (无节点)
- `shadowrocket-full.conf` - 完整的 Shadowrocket 配置模板 (无节点)
- `rules/*.yaml` - 独立规则集文件 (YAML 格式，供 Clash 使用)
- `rules/*.list` - 独立规则集文件 (纯文本格式，供 Shadowrocket 使用)
- `metadata.json` - 构建元数据

## 使用方法

### 直接引用链接

```
https://raw.githubusercontent.com/uyloal/universal-proxy-rules/release/clash-full.yaml
https://raw.githubusercontent.com/uyloal/universal-proxy-rules/release/shadowrocket-full.conf
https://raw.githubusercontent.com/uyloal/universal-proxy-rules/release/rules/ai.yaml
https://raw.githubusercontent.com/uyloal/universal-proxy-rules/release/rules/ai.list
```

### Clash Verge Rev / OpenClash / Stash

在客户端中使用 `clash-full.yaml` 作为配置模板，
通过 Merge 或 Script 方式注入本地节点订阅。

### Shadowrocket

下载 `shadowrocket-full.conf` 文件到本地，
通过 Shadowrocket 的"配置"→"导入"功能加载。
节点需在客户端中手动添加或通过订阅导入。

## 上游配置仓库

https://github.com/uyloal/universal-proxy-rules
