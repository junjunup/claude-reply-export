import { expect, test } from 'claude-code/testing'

const FINAL = '## 结论\n\n导出功能可用，表格和代码块都正常。'
const MSGS = [
  { role: 'user', text: '帮我做导出功能', toolUses: [] },
  { role: 'assistant', text: '我先看一下代码。', toolUses: [] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] },
  { role: 'assistant', text: FINAL, toolUses: [] },
]

const msg = (text: string, surface: 'desktop' | 'terminal') => ({
  plugin: 'reply-export',
  component: 'AssistantMessage',
  requestId: `m-${surface}-${text.length}`,
  surface,
  props: { text, isFirstOfReply: false },
}) as const

test('最后一段显示导出入口，展开后是分组卡片', async ($, on) => {
  on('session.messages', () => ({ value: MSGS }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount(msg(FINAL, surface))
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.press({ key: 'export' })
    expect(await ui.find({ type: 'Button', key: 'plain' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'image' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'more' })).toBeFalsy()
    expect(await ui.find({ type: 'Button', key: 'cards' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'theme' })).toBeTruthy()
    const before = (await ui.find({ type: 'Button', key: 'theme' }))?.text
    await ui.press({ key: 'theme' })
    expect((await ui.find({ type: 'Button', key: 'theme' }))?.text).not.toBe(before)
    await ui.unmount()
  }
})

test('中间的过渡段落不显示导出入口', async ($, on) => {
  on('session.messages', () => ({ value: MSGS }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(msg('我先看一下代码。', 'desktop'))
  expect(await ui.find({ type: 'Button', key: 'export' })).toBeFalsy()
  await ui.unmount()
})

test('切换到 English 后界面变成英文', async ($, on) => {
  on('session.messages', () => ({ value: MSGS }))
  on('store.set', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...msg(FINAL, 'desktop'), requestId: 'm-lang' })
  await ui.press({ key: 'export' })
  // 跟随系统（默认中文）→ 中文 → English
  await ui.press({ key: 'lang' })
  await ui.press({ key: 'lang' })
  expect((await ui.find({ type: 'Button', key: 'lang' }))?.text).toContain('English')
  expect((await ui.find({ type: 'Button', key: 'plain' }))?.text).toContain('Plain text')
  expect((await ui.find({ type: 'Button', key: 'close' }))?.text).toContain('Collapse')
  await ui.unmount()
})
