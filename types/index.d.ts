export type ReplyExportPrefs = {
  /** 导出主题：paper 暖纸、clean 简白、dark 深色 */
  theme: 'paper' | 'clean' | 'dark'
  /** 长图宽度：phone 手机、desktop 电脑 */
  width: 'phone' | 'desktop'
}

declare module 'claude-code' {
  interface PluginState {
    'reply-export': {
      /** 每条回复的导出菜单：'' 收起、'open' 展开 */
      menu: StateFamily<string>
      /** 每条回复正在进行的导出任务，空字符串表示空闲 */
      busy: StateFamily<string>
      /** 隐私检查待确认：'' 无，否则为 "<格式>|<发现摘要>" */
      pending: StateFamily<string>
      /** 每轮结束时 +1，让回复重新判断自己是不是最后一段 */
      turnSeq: number
      /** 导出偏好，同时存进 $.store 跨会话保留 */
      prefs: ReplyExportPrefs
    }
  }
}
