/** Conservative UI-only timings for offline BusyTeX. Never an availability or deadline guarantee. */
export type ResourceTier = 'basic' | 'recommended' | 'extra';
export type CompilePhase = 'checking' | 'loading' | 'initializing' | 'compiling' | 'finishing';
export type CompileFile = { path: string; content: string | Uint8Array };
export type CompileEstimate = { lowSeconds: number; highSeconds: number; expectedSeconds: number; tier: ResourceTier; category: string };

export function estimateCompileTime(files: CompileFile[], tier: ResourceTier, coreCached: boolean, previousSeconds?: number): CompileEstimate {
  let sourceBytes = 0;
  let imageBytes = 0;
  for (const file of files) {
    const length = typeof file.content === 'string' ? file.content.length * 2 : file.content.byteLength;
    if (/\.(?:png|jpe?g|pdf|svg|eps)$/i.test(file.path)) imageBytes += length;
    else sourceBytes += length;
  }
  const complex = files.length > 20 || sourceBytes > 100_000;
  // TeX passes, font discovery and browser CPU dominate after assets have been cached.
  const base = Math.min(600, 16 + files.length * 0.78 + sourceBytes / 1800 + imageBytes / 170_000);
  const compileSeconds = previousSeconds && previousSeconds >= 4 && previousSeconds <= 900
    ? Math.max(8, Math.min(900, previousSeconds))
    : base;
  // 90 MB core plus 192/518 MB optional bundles; bandwidth and cache can vary greatly.
  const cold = coreCached ? 0 : (tier === 'extra' ? 190 : tier === 'recommended' ? 85 : 45);
  const low = Math.max(8, Math.round(compileSeconds * (complex ? .7 : .65) + cold * .6));
  const high = Math.max(low + 15, Math.round(compileSeconds * (complex ? 2.2 : 2.4) + cold * 3));
  return { lowSeconds: low, highSeconds: high, expectedSeconds: Math.round((low + high) / 2), tier,
    category: complex ? 'large' : files.length > 3 || sourceBytes > 20_000 ? 'medium' : 'small' };
}

export function formatCompileTime(seconds: number): string {
  const secs = Math.max(0, Math.round(seconds));
  if (secs < 60) return secs + ' 秒';
  if (secs < 3600) return Math.floor(secs / 60) + ' 分 ' + (secs % 60 ? secs % 60 + ' 秒' : '');
  return Math.floor(secs / 3600) + ' 小时 ' + Math.ceil(secs % 3600 / 60) + ' 分';
}

export function describeCompileEstimate(estimate: CompileEstimate, elapsedSeconds: number): string {
  const elapsed = Math.max(0, elapsedSeconds);
  if (elapsed > estimate.highSeconds) return '已超过估计上限，仍在运行；请查看当前阶段';
  const low = Math.max(0, estimate.lowSeconds - elapsed);
  const high = Math.max(0, estimate.highSeconds - elapsed);
  return '预计剩余 ' + formatCompileTime(low) + '～' + formatCompileTime(high) + '（估算）';
}

export function historyKey(files: CompileFile[], tier: ResourceTier): string {
  const large = files.length > 20 || files.some(f => typeof f.content === 'string' && f.content.length > 100_000);
  return 'everflow.compile-history.v2.' + tier + '.' + (large ? 'large' : files.length > 3 ? 'medium' : 'small');
}

export function readCompileHistory(key: string): number | undefined {
  try {
    const value = Number(localStorage.getItem(key));
    return value >= 4 && value <= 900 ? value : undefined;
  } catch { return undefined; }
}

export function saveCompileHistory(key: string, elapsedSeconds: number): void {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 4 || elapsedSeconds > 900) return;
  try {
    const previous = readCompileHistory(key);
    localStorage.setItem(key, String(Math.round(previous ? previous * .65 + elapsedSeconds * .35 : elapsedSeconds)));
  } catch { /* Browser private mode or quota exceeded: estimates remain functional. */ }
}
