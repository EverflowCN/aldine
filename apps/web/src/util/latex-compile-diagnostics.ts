/** Turn TeX Live / BusyTeX logs into actionable, local-only errors. */
export type CompileIssue = {
  code: 'missing-file' | 'missing-font' | 'undefined-command' | 'timeout' | 'memory' | 'font-glyph' | 'generic';
  level: 'error' | 'warning';
  title: string;
  advice: string;
};
export function diagnoseCompileLog(log: string): CompileIssue[] {
  const issues: CompileIssue[] = [];
  const seen = new Set<string>();
  function add(code: CompileIssue['code'], level: CompileIssue['level'], title: string, advice: string) {
    const key = code + '|' + title;
    if (seen.has(key) || issues.length >= 12) return;
    seen.add(key); issues.push({ code, level, title, advice });
  }
  const text = log.slice(0, 800000);
  const matches = [
    ...text.matchAll(/(?:!\s*LaTeX Error:\s*)?File\s+['`"]?([^'"`\r\n<> ]+\.(?:sty|cls|def|cfg|tex|otf|ttf|tfm|vf|png|jpe?g|pdf))['`"]?\s+not found/gi),
    ...text.matchAll(/I can't find file\s+[`'"]?([^\s'"`<>]+)[`'"]?/gi),
  ];
  for (const match of matches.slice(0, 12)) {
    const file = match[1].replace(/[.,;:]+$/, '');
    add('missing-file', 'error', '缺少文件：' + file,
      /\.(?:png|jpe?g|pdf|tex)$/i.test(file)
        ? '先检查工程 ZIP 内的相对路径、主文件以及图片/章节是否完整。'
        : '检查「本地宏包」档位：基础 → 推荐 → 扩展；仍找不到时开启按需获取宏包。');
  }
  const fonts = [
    ...text.matchAll(/(?:The\s+font|font)\s+["`']([^"'`\r\n]{2,100})["`']\s+(?:cannot\s+be\s+found|not\s+found)/gi),
    ...text.matchAll(/fontspec\s+error:\s*The\s+font\s+["`']([^"'`\r\n]+)["`']/gi),
  ];
  for (const match of fonts.slice(0, 8)) {
    add('missing-font', 'error', '缺少字体：' + match[1].trim(),
      '网页编译器无法直接使用你电脑已安装的字体。请用 TeX Live 自带的开放字体，或在有分发许可时将字体文件导入工程。');
  }
  if (/!\s*Undefined control sequence/i.test(text)) {
    add('undefined-command', 'error', '存在未定义 LaTeX 命令',
      '可能未加载对应宏包、拼写错误或模板版本不兼容。请检查日志中首个 Undefined control sequence 附近的行号。');
  }
  if (/(?:Compilation timeout|Timeout waiting|timed out|编译.*超时)/i.test(text)) {
    add('timeout', 'error', '编译超过浏览器允许的时间',
      '完整 Everflow 模板可能包含多轮目录生成或大量 TikZ 图形。可先仅编译 Exam，再逐步增加题量。');
  }
  if (/(?:out of memory|memory access out of bounds|TeX capacity exceeded|Cannot enlarge memory)/i.test(text)) {
    add('memory', 'error', '浏览器内存或 TeX 容量不足',
      '关闭其他占用内存的标签页，或在内存更大的桌面浏览器编译。不要在手机上强制加载所有扩展包。');
  }
  if (/Missing character: There is no/i.test(text)) {
    add('font-glyph', 'warning', '部分字符的字体缺少字形',
      '即使编译成功 PDF 也可能出现空白字。请核对嵌入中文字体及使用浏览器原生 PDF 预览。');
  }
  if (!issues.length && /(?:Emergency stop|Fatal error|pdf conversion failed|dvipdfmx.*error)/i.test(text)) {
    add('generic', 'error', 'LaTeX 或 PDF 转换阶段发生错误',
      '请查看下方原始编译日志的首个错误，确认是宏包、主文档、字体还是 PDF 转换问题。');
  }
  return issues;
}
