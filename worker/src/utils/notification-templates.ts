export type NotificationMessage = {
  subject: string;
  body: string;
  url?: string;
  event?: string;
  clients?: string;
  message?: string;
  time?: string;
  emoji?: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatNotificationTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    beijing.getUTCFullYear(),
    pad2(beijing.getUTCMonth() + 1),
    pad2(beijing.getUTCDate()),
  ].join('-') + ' ' + [
    pad2(beijing.getUTCHours()),
    pad2(beijing.getUTCMinutes()),
    pad2(beijing.getUTCSeconds()),
  ].join(':');
}

function message(subject: string, lines: string[], meta: Omit<NotificationMessage, 'subject' | 'body'> = {}): NotificationMessage {
  return { subject, body: lines.join('\n'), ...meta };
}

function eventMessage(input: {
  emoji: string;
  event: string;
  clients?: string;
  message: string;
  time?: string | Date;
}): NotificationMessage {
  const subject = `${input.emoji} CF VPS Monitor ${input.event}`;
  const time = formatNotificationTime(input.time || new Date());
  return message(subject, [
    input.emoji.repeat(3),
    `事件: ${input.event}`,
    ...(input.clients ? [`节点: ${input.clients}`] : []),
    `消息: ${input.message}`,
    `时间: ${formatNotificationTime(input.time || new Date())}`,
  ], {
    emoji: input.emoji,
    event: input.event,
    clients: input.clients || '',
    message: input.message,
    time,
  });
}

export function buildOfflineNotification(input: {
  nodeName: string;
  offlineMinutes: number;
  lastSeen: string;
  createdAt?: string;
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '🔴',
    event: '离线告警',
    clients: input.nodeName,
    message: [
      `离线 ${input.offlineMinutes} 分钟`,
      `最后上报 ${input.lastSeen === '从未上报' ? input.lastSeen : formatNotificationTime(input.lastSeen)}`,
      ...(input.createdAt ? [`创建时间 ${formatNotificationTime(input.createdAt)}`] : []),
    ].join('；'),
    time: input.eventTime,
  });
}

export function buildNodeRecoveryNotification(input: {
  nodeName: string;
  recoveredAt: string;
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '🟢',
    event: '恢复上线',
    clients: input.nodeName,
    message: `节点已恢复上报；最新上报 ${formatNotificationTime(input.recoveredAt)}`,
    time: input.eventTime,
  });
}

export function buildExpiryNotification(input: {
  nodeName: string;
  expiredAt: string;
  daysLeft: number;
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '⏳',
    event: '到期提醒',
    clients: input.nodeName,
    message: `剩余 ${input.daysLeft} 天；到期时间 ${formatNotificationTime(input.expiredAt)}`,
    time: input.eventTime,
  });
}

export function buildLoadNotification(input: {
  ruleName: string;
  nodeName: string;
  metricLabel: string;
  avgValue: number;
  threshold: number;
  exceedRatio: number;
  requiredRatio: number;
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '⚠️',
    event: '负载告警',
    clients: input.nodeName,
    message: `${input.ruleName || `${input.metricLabel} 告警`}；${input.metricLabel} 平均 ${input.avgValue.toFixed(1)}% (阈值 ${input.threshold}%)；超标率 ${(input.exceedRatio * 100).toFixed(0)}% / ${(input.requiredRatio * 100).toFixed(0)}%`,
    time: input.eventTime,
  });
}

export function buildWebsiteAlertNotification(input: {
  name: string;
  url: string;
  downMinutes: number;
  lastStatus: string;
  checkedAt: string;
}): NotificationMessage {
  return eventMessage({
    emoji: '🌐',
    event: '网站告警',
    clients: input.name,
    message: `${input.url}；状态 ${input.lastStatus}；持续 ${input.downMinutes} 分钟`,
    time: input.checkedAt,
  });
}

export function buildWebsiteRecoveryNotification(input: {
  name: string;
  url: string;
  downMinutes: number;
  statusCode: number | null;
  latencyMs: number | null;
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '🟢',
    event: '网站恢复',
    clients: input.name,
    message: `${input.url}；HTTP ${input.statusCode ?? 'unknown'}；延迟 ${input.latencyMs ?? 0}ms；故障时长 ${input.downMinutes} 分钟`,
    time: input.eventTime,
  });
}

export function buildIpChangeNotification(input: {
  nodeName: string;
  parts: string[];
  eventTime?: string | Date;
}): NotificationMessage {
  return eventMessage({
    emoji: '🔁',
    event: 'IP 变更通知',
    clients: input.nodeName,
    message: input.parts.join('；'),
    time: input.eventTime,
  });
}

export function buildRestockNotification(input: {
  name: string;
  url: string;
  tags?: string[];
  matchedText: string | null;
  eventTime?: string | Date;
}): NotificationMessage {
  const time = formatNotificationTime(input.eventTime || new Date());
  const subject = `🛒 VPS 补货提醒: ${input.name}`;
  const tagsLine = input.tags && input.tags.length > 0
    ? `分类标签: ${input.tags.map(t => `#${t}`).join(' ')}`
    : null;
  const lines = [
    `🛒🛒🛒 VPS 补货提醒`,
    `商品名称: ${input.name}`,
    ...(tagsLine ? [tagsLine] : []),
    `当前状态: ✅ 已检测到补货 (${input.matchedText ? `匹配: ${input.matchedText}` : '检测到有货'})`,
    `直达购买: ${input.url}`,
    `检测时间: ${time}`,
    `💡 特价商品库存有限，请尽快点击链接或按钮前往抢购！`,
  ];
  return {
    subject,
    body: lines.join('\n'),
    url: input.url,
    event: 'VPS 补货通知',
    clients: input.name,
    message: `已检测到补货！购买链接: ${input.url}`,
    time,
    emoji: '🛒',
  };
}

export function buildOutOfStockNotification(input: {
  name: string;
  url: string;
  tags?: string[];
  eventTime?: string | Date;
}): NotificationMessage {
  const time = formatNotificationTime(input.eventTime || new Date());
  const subject = `📦 VPS 缺货通知: ${input.name}`;
  const tagsLine = input.tags && input.tags.length > 0
    ? `分类标签: ${input.tags.map(t => `#${t}`).join(' ')}`
    : null;
  const lines = [
    `📦📦📦 VPS 缺货通知`,
    `商品名称: ${input.name}`,
    ...(tagsLine ? [tagsLine] : []),
    `当前状态: ❌ 已售罄或下架`,
    `商品链接: ${input.url}`,
    `检测时间: ${time}`,
  ];
  return {
    subject,
    body: lines.join('\n'),
    url: input.url,
    event: 'VPS 缺货通知',
    clients: input.name,
    message: `${input.name} 已售罄或下架`,
    time,
    emoji: '📦',
  };
}
