#!/usr/bin/env node
/**
 * Proxy Rules Aggregation Engine
 * 主入口文件
 *
 * 命令:
 *   pnpm dev          - 开发模式 (tsx)
 *   pnpm generate     - 生成配置
 */

import { buildAll } from './builder.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] || 'build'

  try {
    switch (command) {
      case 'build':
      case 'generate':
        await buildAll()
        break

      default:
        console.log(`Unknown command: ${command}`)
        console.log('Usage: node index.js [build|generate]')
        process.exit(1)
    }
  } catch (error) {
    console.error('Build failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
