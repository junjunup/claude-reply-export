// reply-export 原生助手：用系统自带的 WebKit 渲染，不需要额外安装任何东西。
// 从标准输入读取一个 JSON 任务：
//   {"op":"clip-rich","html":"...","plain":"..."}     剪贴板同时写入 HTML、RTF、纯文本
//   {"op":"clip-file","path":"/x.pdf"}                 把文件本身放进剪贴板（在微信里 ⌘V 发送文件）
//   {"op":"render","mode":"long","html":"...","width":750,"bg":"#fff","png":"/x.png","copyImage":true}
//   {"op":"render","mode":"pdf","html":"...","width":750,"bg":"#fff","pdf":"/x.pdf"}
//   {"op":"render","mode":"cards","html":"...","width":600,"bg":"#fff","cardHeight":800,
//        "padTop":48,"padBottom":56,"prefix":"/dir/名字","muted":"#888"}   按 3:4 切成多张卡片
// 每个任务可带 "lang":"zh"|"en"，决定报错文字的语言。
// 成功输出 {"ok":true,...}，失败输出 {"ok":false,"error":"..."} 并以 1 退出。
import Cocoa
import WebKit

func reply(_ obj: [String: Any], code: Int32 = 0) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"ok\":false}".utf8)
  FileHandle.standardOutput.write(data)
  exit(code)
}
// 报错语言跟随界面：任务里的 "lang"（zh / en），读到任务之前两种都给
var uiLang = ""
func fail(_ zh: String, _ en: String) -> Never {
  let msg = uiLang == "en" ? en : uiLang == "zh" ? zh : "\(zh) / \(en)"
  reply(["ok": false, "error": msg], code: 1)
}

func color(_ hex: String?) -> NSColor {
  guard var h = hex?.trimmingCharacters(in: .whitespaces), h.hasPrefix("#") else { return .white }
  h.removeFirst()
  guard h.count == 6, let v = UInt32(h, radix: 16) else { return .white }
  return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                 blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let job = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
      let op = job["op"] as? String else { fail("无法读取任务", "Couldn't read the job") }
uiLang = (job["lang"] as? String) == "en" ? "en" : "zh"

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

// ---------- 富文本剪贴板 ----------
if op == "clip-rich" {
  let html = job["html"] as? String ?? ""
  let plain = job["plain"] as? String ?? ""
  let wrapped = "<meta charset=\"utf-8\">" + html
  var rtf: Data? = nil
  if let attr = try? NSAttributedString(
      data: Data(wrapped.utf8),
      options: [.documentType: NSAttributedString.DocumentType.html,
                .characterEncoding: String.Encoding.utf8.rawValue],
      documentAttributes: nil) {
    rtf = try? attr.data(from: NSRange(location: 0, length: attr.length),
                         documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
  }
  let pb = NSPasteboard.general
  pb.clearContents()
  pb.setString(wrapped, forType: .html)
  if let rtf = rtf { pb.setData(rtf, forType: .rtf) }
  pb.setString(plain, forType: .string)
  reply(["ok": true, "rtf": rtf != nil])
}

// ---------- 文件放进剪贴板 ----------
if op == "clip-file" {
  guard let p = job["path"] as? String, FileManager.default.fileExists(atPath: p) else { fail("文件不存在", "The file doesn't exist") }
  let pb = NSPasteboard.general
  pb.clearContents()
  pb.writeObjects([URL(fileURLWithPath: p) as NSURL])
  reply(["ok": true])
}

guard op == "render" else { fail("未知操作 \(op)", "Unknown operation \(op)") }

// ---------- 渲染 ----------
let mode = job["mode"] as? String ?? "long"
let html = job["html"] as? String ?? ""
let width = (job["width"] as? NSNumber)?.doubleValue ?? 750
let bg = color(job["bg"] as? String)
let muted = color(job["muted"] as? String)
let pngPath = job["png"] as? String
let copyImage = job["copyImage"] as? Bool ?? false
let cardPrefix = job["prefix"] as? String
let pdfPath = job["pdf"] as? String

// PDF：A4 纸 595×842pt，四周留白 36pt，内容按页面宽度缩放
let a4 = CGSize(width: 595, height: 842)
let margin: CGFloat = 36
let pdfScale = (a4.width - 2 * margin) / CGFloat(width)
let pdfSlicePx = Double((a4.height - 2 * margin) / pdfScale)

// 卡片：固定 3:4，上下留白给页码
let cardH = (job["cardHeight"] as? NSNumber)?.doubleValue ?? 800
let cardTop = (job["padTop"] as? NSNumber)?.doubleValue ?? 48
let cardBottom = (job["padBottom"] as? NSNumber)?.doubleValue ?? 56
let cardSlicePx = cardH - cardTop - cardBottom

// 把会被切开的段落推到下一页（太高的代码块 / 表格允许跨页）
func avoidBreaksJS(_ h: Double) -> String {
  return """
  (() => {
    const H = \(h);
    const els = document.querySelectorAll('.hero, .content > *, .content li, .content tr, .footer');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY, bottom = top + r.height;
      if (r.height >= H * 0.85) continue;
      const pageEnd = (Math.floor(top / H) + 1) * H;
      if (bottom > pageEnd + 1 && top < pageEnd) {
        if (el.tagName === 'TR') { for (const c of el.children) c.style.paddingTop = (pageEnd - top + 12) + 'px'; }
        else { const cur = parseFloat(getComputedStyle(el).marginTop) || 0; el.style.marginTop = (cur + pageEnd - top + 6) + 'px'; }
      }
    }
    return document.documentElement.scrollHeight;
  })()
  """
}

final class Renderer: NSObject, WKNavigationDelegate {
  let web: WKWebView
  var result: [String: Any] = ["ok": true]
  init(_ w: WKWebView) { web = w }

  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { fail("页面加载失败：\(e.localizedDescription)", "Couldn't load the page: \(e.localizedDescription)") }

  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    settle {
      switch mode {
      case "pdf": self.paginate(pdfSlicePx) { self.pdf { reply(self.result) } }
      case "cards": self.paginate(cardSlicePx) { self.cards { reply(self.result) } }
      default: self.longImage { reply(self.result) }
      }
    }
  }

  // 等字体和布局稳定后，把视图拉到内容全高
  func settle(_ done: @escaping () -> Void) {
    measure { h in
      self.web.frame = NSRect(x: 0, y: 0, width: width, height: h)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
        self.measure { h2 in
          self.web.frame = NSRect(x: 0, y: 0, width: width, height: h2)
          done()
        }
      }
    }
  }

  func measure(_ done: @escaping (Double) -> Void) {
    web.evaluateJavaScript("document.documentElement.scrollHeight") { h, err in
      guard let h = (h as? NSNumber)?.doubleValue else { fail("无法测量页面高度：\(err?.localizedDescription ?? "")", "Couldn't measure the page height: \(err?.localizedDescription ?? "")") }
      done(max(h, 100))
    }
  }

  func paginate(_ slice: Double, _ done: @escaping () -> Void) {
    web.evaluateJavaScript(avoidBreaksJS(slice)) { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.settle(done) }
    }
  }

  func snapshot(hiDPI: Bool = false, _ done: @escaping (NSBitmapImageRep) -> Void) {
    let cfg = WKSnapshotConfiguration()
    cfg.rect = NSRect(x: 0, y: 0, width: width, height: Double(web.frame.height))
    // 手机宽度的长图放大到约 3 倍像素，发到手机上更清晰
    if hiDPI && width < 600 { cfg.snapshotWidth = NSNumber(value: width * 1.5) }
    web.takeSnapshot(with: cfg) { img, err in
      guard let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
        fail("截图失败：\(err?.localizedDescription ?? "")", "Couldn't capture the page: \(err?.localizedDescription ?? "")")
      }
      done(rep)
    }
  }

  func longImage(_ next: @escaping () -> Void) {
    snapshot(hiDPI: true) { rep in
      guard let png = rep.representation(using: .png, properties: [:]) else { fail("长图编码失败", "Couldn't encode the long image") }
      if let p = pngPath {
        do { try png.write(to: URL(fileURLWithPath: p)) } catch { fail("长图保存失败：\(error.localizedDescription)", "Couldn't save the long image: \(error.localizedDescription)") }
        self.result["png"] = p
      }
      if copyImage {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setData(png, forType: .png)
        if let tiff = rep.tiffRepresentation { pb.setData(tiff, forType: .tiff) }
      }
      self.result["pixels"] = [rep.pixelsWide, rep.pixelsHigh]
      next()
    }
  }

  func cards(_ next: @escaping () -> Void) {
    guard let prefix = cardPrefix else { fail("缺少卡片保存位置", "No location given for the cards") }
    snapshot { rep in
      guard let full = rep.cgImage else { fail("截图失败", "Couldn't capture the page") }
      let s = Double(rep.pixelsWide) / width                       // 像素 / CSS 像素（通常是 2）
      let totalH = Double(self.web.frame.height)
      let count = max(1, Int(ceil(totalH / cardSlicePx - 0.02)))
      let W = Int(width * s), H = Int(cardH * s)
      var files: [String] = []
      for i in 0..<count {
        let y0 = Double(i) * cardSlicePx
        let sliceH = min(cardSlicePx, totalH - y0)
        guard sliceH > 0,
              let piece = full.cropping(to: CGRect(x: 0, y: y0 * s, width: Double(W), height: sliceH * s)),
              let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
        ctx.setFillColor(bg.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
        // CG 原点在左下：内容贴着上留白往下排
        ctx.draw(piece, in: CGRect(x: 0, y: Double(H) - cardTop * s - sliceH * s, width: Double(W), height: sliceH * s))
        // 页码
        let label = NSAttributedString(string: "\(i + 1) / \(count)", attributes: [
          .font: NSFont.systemFont(ofSize: CGFloat(13 * s)), .foregroundColor: muted,
        ])
        let g = NSGraphicsContext(cgContext: ctx, flipped: false)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = g
        let sz = label.size()
        label.draw(at: NSPoint(x: CGFloat(W) - sz.width - CGFloat(40 * s), y: CGFloat(cardBottom * s / 2) - sz.height / 2))
        NSGraphicsContext.restoreGraphicsState()
        guard let img = ctx.makeImage(),
              let png = NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:]) else { continue }
        let path = "\(prefix)-\(i + 1).png"
        do { try png.write(to: URL(fileURLWithPath: path)) } catch { fail("卡片保存失败：\(error.localizedDescription)", "Couldn't save a card: \(error.localizedDescription)") }
        files.append(path)
      }
      self.result["cards"] = files
      next()
    }
  }

  func pdf(_ next: @escaping () -> Void) {
    guard let out = pdfPath else { fail("缺少 PDF 保存位置", "No location given for the PDF") }
    web.createPDF(configuration: WKPDFConfiguration()) { r in
      guard case .success(let data) = r,
            let provider = CGDataProvider(data: data as CFData),
            let longDoc = CGPDFDocument(provider),
            let longPage = longDoc.page(at: 1) else { fail("PDF 生成失败", "Couldn't create the PDF") }
      let longH = Double(longPage.getBoxRect(.mediaBox).height)
      let pages = max(1, Int(ceil(longH / pdfSlicePx - 0.02)))
      var box = CGRect(origin: .zero, size: a4)
      guard let ctx = CGContext(URL(fileURLWithPath: out) as CFURL, mediaBox: &box, nil) else { fail("无法写入 PDF：\(out)", "Couldn't write the PDF: \(out)") }
      for i in 0..<pages {
        ctx.beginPDFPage(nil)
        ctx.setFillColor(bg.cgColor)
        ctx.fill(box)
        ctx.saveGState()
        ctx.clip(to: CGRect(x: 0, y: margin, width: a4.width, height: a4.height - 2 * margin))
        // 长页面坐标原点在左下：把第 i 页对应的那一截移到纸面内容区
        let sliceTop = longH - Double(i) * pdfSlicePx
        ctx.translateBy(x: margin, y: a4.height - margin)
        ctx.scaleBy(x: pdfScale, y: pdfScale)
        ctx.translateBy(x: 0, y: -CGFloat(sliceTop))
        ctx.drawPDFPage(longPage)
        ctx.restoreGState()
        ctx.endPDFPage()
      }
      ctx.closePDF()
      self.result["pdf"] = out
      self.result["pages"] = pages
      next()
    }
  }
}

let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 800))
let renderer = Renderer(web)
web.navigationDelegate = renderer
web.loadHTMLString(html, baseURL: nil)
DispatchQueue.main.asyncAfter(deadline: .now() + 90) { fail("渲染超时", "Rendering timed out") }
app.run()
