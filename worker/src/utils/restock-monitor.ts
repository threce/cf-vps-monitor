/**
 * VPS 补货监控 - 核心检测逻辑
 *
 * 支持三种检测模式:
 * - keyword: 关键词匹配（优先检查缺货关键词，再检查有货关键词）
 * - regex: 正则表达式匹配
 * - status_code: HTTP 状态码范围检查
 */

import { consumeScheduledSubrequests, currentScheduledBudget, ScheduledBudgetExceeded } from './scheduled-budget.ts';
import type { RestockCheckMode, RestockMonitorInput } from '../db/types.ts';

export interface RestockProbeMonitor {
  id: number;
  url: string;
  tags?: string[];
  remark?: string;
  check_mode: RestockCheckMode;
  stock_keywords: string[];
  out_of_stock_keywords: string[];
  stock_pattern: string;
  custom_headers: Record<string, string>;
  timeout_sec: number;
  name: string;
  status: string;
  last_notified_at: string | null;
  notify_on_restock: boolean;
  notify_on_out_of_stock: boolean;
}

export interface RestockCheckResult {
  monitor_id: number;
  checked_at: string;
  in_stock: boolean;
  matched_text: string | null;
  status_code: number | null;
  latency_ms: number;
  error: string | null;
}

export type RestockMonitorValidationResult =
  | { ok: true; value: RestockMonitorInput }
  | { ok: false; error: string };

const RESTOCK_PROBE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'Cache-Control': 'no-cache',
};

function integerInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= 50) break;
  }
  return result;
}

function readHeadersObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    const key = k.trim();
    if (!key || key.length > 200) continue;
    // 不允许覆盖 Host 头
    if (key.toLowerCase() === 'host') continue;
    result[key] = v.trim().slice(0, 2000);
    if (++count >= 20) break;
  }
  return result;
}

export function validateRestockMonitorInput(input: Record<string, unknown>): RestockMonitorValidationResult {
  const name = String(input.name || '').trim();
  if (!name || name.length > 120) return { ok: false, error: 'invalid_name' };

  const url = String(input.url || '').trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'invalid_protocol' };
  }

  const checkMode: RestockCheckMode =
    input.check_mode === 'regex' ? 'regex' :
    input.check_mode === 'status_code' ? 'status_code' : 'keyword';

  const stock_keywords = readStringArray(input.stock_keywords);
  const out_of_stock_keywords = readStringArray(input.out_of_stock_keywords);
  const stock_pattern = String(input.stock_pattern || '').trim().slice(0, 2000);
  const tags = readStringArray(input.tags);
  const remark = String(input.remark || '').trim().slice(0, 500);

  if (checkMode === 'keyword' && stock_keywords.length === 0 && out_of_stock_keywords.length === 0) {
    return { ok: false, error: 'no_keywords' };
  }
  if (checkMode === 'regex' && !stock_pattern) {
    return { ok: false, error: 'no_pattern' };
  }
  // 验证正则表达式合法性
  if (checkMode === 'regex') {
    try {
      new RegExp(stock_pattern, 'i');
    } catch {
      return { ok: false, error: 'invalid_pattern' };
    }
  }

  const custom_headers = readHeadersObject(input.custom_headers);
  const interval_sec = integerInRange(input.interval_sec ?? 120, 60, 86400);
  const timeout_sec = integerInRange(input.timeout_sec ?? 15, 1, 30);

  if (interval_sec === null || timeout_sec === null) {
    return { ok: false, error: 'invalid_bounds' };
  }

  return {
    ok: true,
    value: {
      name,
      url: parsed.toString(),
      tags,
      remark,
      check_mode: checkMode,
      stock_keywords,
      out_of_stock_keywords,
      stock_pattern,
      custom_headers,
      interval_sec,
      timeout_sec,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
      hidden: typeof input.hidden === 'boolean' ? input.hidden : false,
      notify_on_restock: typeof input.notify_on_restock === 'boolean' ? input.notify_on_restock : true,
      notify_on_out_of_stock: typeof input.notify_on_out_of_stock === 'boolean' ? input.notify_on_out_of_stock : false,
    },
  };
}

/**
 * 在 HTML 内容中检测库存状态
 */
function checkContentForStock(
  html: string,
  monitor: RestockProbeMonitor,
): { in_stock: boolean; matched_text: string | null } {
  const lowerHtml = html.toLowerCase();

  if (monitor.check_mode === 'keyword') {
    // 优先检查缺货关键词（优先级更高）
    for (const keyword of monitor.out_of_stock_keywords) {
      if (lowerHtml.includes(keyword.toLowerCase())) {
        return { in_stock: false, matched_text: keyword };
      }
    }
    // 再检查有货关键词
    for (const keyword of monitor.stock_keywords) {
      if (lowerHtml.includes(keyword.toLowerCase())) {
        return { in_stock: true, matched_text: keyword };
      }
    }
    // 如果只设置了缺货关键词但没匹配到，则视为有货
    if (monitor.out_of_stock_keywords.length > 0 && monitor.stock_keywords.length === 0) {
      return { in_stock: true, matched_text: null };
    }
    // 如果只设置了有货关键词但没匹配到，则视为缺货
    return { in_stock: false, matched_text: null };
  }

  if (monitor.check_mode === 'regex') {
    try {
      const re = new RegExp(monitor.stock_pattern, 'i');
      const match = re.exec(html);
      if (match) {
        return { in_stock: true, matched_text: match[0].slice(0, 200) };
      }
      return { in_stock: false, matched_text: null };
    } catch {
      return { in_stock: false, matched_text: null };
    }
  }

  // status_code 模式在外部处理
  return { in_stock: false, matched_text: null };
}

/**
 * 执行补货检测
 */
export async function checkRestockMonitor(monitor: RestockProbeMonitor): Promise<RestockCheckResult> {
  const started = Date.now();
  const checkedAt = new Date(started).toISOString();

  try {
    const headers: Record<string, string> = {
      ...RESTOCK_PROBE_HEADERS,
      ...monitor.custom_headers,
    };

    consumeScheduledSubrequests();

    const budget = currentScheduledBudget();
    const timeoutMs = Math.min(
      Math.max(1, monitor.timeout_sec) * 1000,
      budget?.remainingMs() ?? Infinity,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      if (budget?.remainingMs() === 0) {
        controller.abort(new ScheduledBudgetExceeded());
      } else {
        controller.abort(new Error('timeout'));
      }
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(monitor.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const latency_ms = Math.max(0, Math.round(Date.now() - started));

    if (monitor.check_mode === 'status_code') {
      // status_code 模式：200-299 视为有货，其他视为缺货
      const in_stock = response.status >= 200 && response.status <= 299;
      return {
        monitor_id: monitor.id,
        checked_at: checkedAt,
        in_stock,
        matched_text: `HTTP ${response.status}`,
        status_code: response.status,
        latency_ms,
        error: null,
      };
    }

    // keyword / regex 模式：读取页面内容
    const text = await response.text();
    const truncatedText = text.slice(0, 500_000); // 限制处理大小

    const result = checkContentForStock(truncatedText, monitor);

    return {
      monitor_id: monitor.id,
      checked_at: checkedAt,
      in_stock: result.in_stock,
      matched_text: result.matched_text,
      status_code: response.status,
      latency_ms,
      error: null,
    };
  } catch (error) {
    if (error instanceof ScheduledBudgetExceeded) throw error;
    const latency_ms = Math.max(0, Math.round(Date.now() - started));
    const message = error instanceof Error ? error.message : String(error);
    const errorType = /abort|timeout|timed out/i.test(message) ? 'timeout'
      : /dns|enotfound|getaddrinfo/i.test(message) ? 'dns_error'
      : /certificate|tls|ssl/i.test(message) ? 'tls_error'
      : 'network_error';

    return {
      monitor_id: monitor.id,
      checked_at: checkedAt,
      in_stock: false,
      matched_text: null,
      status_code: null,
      latency_ms,
      error: errorType,
    };
  }
}

/**
 * 判断是否应发送补货通知
 * 条件：之前不是 in_stock 状态，现在变为 in_stock
 */
export function shouldNotifyRestock(
  oldStatus: string,
  newStatus: string,
  notifyEnabled: boolean,
  lastNotifiedAt: string | null,
  statusChangedAt: string | null,
): boolean {
  if (!notifyEnabled) return false;
  if (newStatus !== 'in_stock') return false;
  // 如果从未发送过通知（lastNotifiedAt 为空），当前为有货状态，应发送通知
  if (!lastNotifiedAt) return true;
  // 如果之前也是有货状态，且已通知过，不重复通知
  if (oldStatus === 'in_stock') return false;
  // 避免重复通知：如果上次通知时间不早于状态变更时间，说明已通知过当前补货周期
  if (statusChangedAt && lastNotifiedAt >= statusChangedAt) return false;
  return true;
}

/**
 * 判断是否应发送缺货通知
 * 条件：之前是 in_stock 状态，现在变为 out_of_stock
 */
export function shouldNotifyOutOfStock(
  oldStatus: string,
  newStatus: string,
  notifyEnabled: boolean,
): boolean {
  if (!notifyEnabled) return false;
  if (newStatus !== 'out_of_stock') return false;
  if (oldStatus !== 'in_stock') return false;
  return true;
}
