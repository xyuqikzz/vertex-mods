import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const rendererAssets = path.join(root, 'out', 'renderer', 'assets')
const rendererHtml = readFileSync(path.join(root, 'out', 'renderer', 'index.html'), 'utf8')
const rendererEntryName = rendererHtml.match(/src="\.\/assets\/([^"]+\.js)"/)?.[1]
assert.ok(rendererEntryName, '未找到 renderer 入口脚本')

const budgets = [
  {
    name: 'renderer 首屏入口',
    file: path.join(rendererAssets, rendererEntryName),
    maxBytes: 3 * 1024 * 1024
  },
  {
    name: 'main 入口',
    file: path.join(root, 'out', 'main', 'index.js'),
    maxBytes: 1.8 * 1024 * 1024
  }
]

for (const budget of budgets) {
  const size = statSync(budget.file).size
  assert.ok(
    size <= budget.maxBytes,
    `${budget.name} 超出预算：${size} B > ${Math.round(budget.maxBytes)} B`
  )
  console.log(`${budget.name}: ${size} B / ${Math.round(budget.maxBytes)} B`)
}
