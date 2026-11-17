# reply-export: one-click export for Claude replies

[中文](README.md) | English

Adds an "⤓ 导出" (Export) button under each reply in Claude Code that turns the reply into a format ready to share on other platforms. The button runs locally, never goes through the model, and uses no tokens.

> The plugin's interface (buttons, notifications, and the plain-text formatting) is currently in Chinese only. See [Language](#language).

## What it exports

| Group | Format | Best for |
|---|---|---|
| Copy to clipboard | Plain text | Apps that don't render Markdown, such as WeChat: symbols are removed and tables become "item: value" lines |
| | Rich text | Feishu/Lark, email, Word: writes HTML, RTF, and plain text to the clipboard at once |
| | Long image | Paste straight into a chat; also saved as a PNG |
| | Markdown | The original text |
| Save as file | Page cards | Xiaohongshu, WeChat Moments: several 3:4 cards with page numbers |
| | PDF | A4 pages that never split a line of text in half; the file is also put on the clipboard |
| | Word | .docx; the file is also put on the clipboard |
| | HTML | A standalone web page |

- Three themes (warm paper, clean white, dark) and two widths (phone, desktop); your choice is remembered.
- A reply that starts with a heading gets a title card; code blocks are syntax-highlighted; spaces are added between Chinese and Latin text.
- "Whole reply" joins the body text that tool calls split apart and skips the progress updates sent in between.
- **Privacy check before export**: when it finds local file paths, email addresses, phone numbers, or likely API keys, it asks whether to mask them before exporting.

Files are saved to `~/Downloads/Claude导出/`.

## Install

In a Claude Code session in a terminal:

```
/plugin install reply-export --marketplace junjunup/claude-reply-export
```

Then press `y` to add the marketplace and pick a scope (Enter selects the user scope).

From a shell:

```bash
claude plugin install reply-export --marketplace junjunup/claude-reply-export
```

In the Claude desktop app (where `/plugin` isn't available): click **+** next to the prompt box → **Plugins** → **Add marketplace**, enter `junjunup/claude-reply-export`, then **Add plugin**.

## Requirements

- **macOS**. Copying plain text or Markdown works on any Mac.
- Rich text, long images, page cards, and PDF are rendered with the system's built-in WebKit. On first use the plugin compiles a small helper program, which needs the **Xcode Command Line Tools** (if they're missing, run `xcode-select --install` in a terminal).
- Word export uses `textutil`, which ships with macOS.
- Windows and Linux aren't supported yet.

## Language

The interface is in Chinese for now: button labels, notifications, the export folder name, and the markers used in plain-text output (for example 【】 around headings). The export content itself is whatever language the reply is in, so English replies export as English.

## Notes

- Exporting replaces what's currently on your clipboard.
- Thinking is never exported, only the reply text.
- Markdown parsing uses [marked](https://github.com/markedjs/marked) (MIT license, see `hooks/vendor/marked.LICENSE.md`).

## License

[MIT](LICENSE)
