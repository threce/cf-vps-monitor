import { useMemo, useState } from 'react';
import { Badge, Box, Button, Card, Flex, Grid, Text, TextField } from '@radix-ui/themes';
import { CheckCircle2, ExternalLink, RefreshCw, Search, ShoppingCart, Tag, XCircle, Clock } from 'lucide-react';

export interface PublicRestockMonitor {
  id: number;
  name: string;
  url: string;
  tags?: string[];
  status: 'unknown' | 'in_stock' | 'out_of_stock' | 'error';
  last_checked_at: string | null;
  last_in_stock_at: string | null;
  last_matched_text: string | null;
  interval_sec: number;
  status_changed_at: string | null;
}

interface PublicRestockListProps {
  monitors: PublicRestockMonitor[];
  loading: boolean;
  onRefresh: () => void;
}

function formatRelativeTime(dateStr: string | null) {
  if (!dateStr) return '从未';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function formatExactTime(dateStr: string | null) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN', { hour12: false });
}

export default function PublicRestockList({ monitors, loading, onRefresh }: PublicRestockListProps) {
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    monitors.forEach(m => (m.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [monitors]);

  const filtered = useMemo(() => {
    return monitors.filter(m => {
      if (selectedTag !== 'all' && !(m.tags || []).includes(selectedTag)) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.url.toLowerCase().includes(q) ||
        (m.tags || []).some(t => t.toLowerCase().includes(q))
      );
    });
  }, [monitors, search, selectedTag]);

  const inStockCount = monitors.filter(m => m.status === 'in_stock').length;
  const outOfStockCount = monitors.filter(m => m.status === 'out_of_stock').length;

  return (
    <Box className="space-y-6">
      {/* 头部信息 */}
      <Flex justify="between" align="center" wrap="wrap" gap="3">
        <div>
          <Flex align="center" gap="2">
            <ShoppingCart size={22} className="text-blue-500" />
            <Text size="5" weight="bold">特价 VPS 补货监控</Text>
          </Flex>
          <Text size="2" color="gray">
            实时监控特价服务器库存状态，检测到补货第一时间通知
          </Text>
        </div>

        <Flex align="center" gap="2">
          <Badge color="green" variant="soft" size="2">
            🟢 有货: {inStockCount}
          </Badge>
          <Badge color="red" variant="soft" size="2">
            🔴 缺货: {outOfStockCount}
          </Badge>
          <Button variant="soft" size="2" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </Flex>
      </Flex>

      {/* 搜索框 */}
      <Card className="p-3">
        <TextField.Root
          placeholder="搜索 VPS 方案名称、网址或标签..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          size="2"
        >
          <TextField.Slot>
            <Search size={14} />
          </TextField.Slot>
        </TextField.Root>
      </Card>

      {/* 分类标签导航 */}
      {allTags.length > 0 && (
        <Flex gap="2" wrap="wrap" align="center" className="px-1">
          <Flex align="center" gap="1" className="text-gray-400 mr-1">
            <Tag size={13} />
            <Text size="1" color="gray" weight="medium">分类:</Text>
          </Flex>
          <Badge
            size="2"
            variant={selectedTag === 'all' ? 'solid' : 'soft'}
            color={selectedTag === 'all' ? 'blue' : 'gray'}
            className="cursor-pointer select-none transition-all hover:opacity-85"
            onClick={() => setSelectedTag('all')}
          >
            全部 ({monitors.length})
          </Badge>
          {allTags.map(tag => {
            const count = monitors.filter(m => (m.tags || []).includes(tag)).length;
            const isSelected = selectedTag === tag;
            return (
              <Badge
                key={tag}
                size="2"
                variant={isSelected ? 'solid' : 'surface'}
                color={isSelected ? 'indigo' : 'gray'}
                className="cursor-pointer select-none transition-all hover:opacity-85"
                onClick={() => setSelectedTag(prev => prev === tag ? 'all' : tag)}
              >
                #{tag} ({count})
              </Badge>
            );
          })}
        </Flex>
      )}

      {/* 监控卡片网格 */}
      <Grid columns={{ initial: '1', sm: '2', md: '3' }} gap="4">
        {filtered.map(monitor => {
          const isInStock = monitor.status === 'in_stock';
          const isOutOfStock = monitor.status === 'out_of_stock';

          return (
            <Card
              key={monitor.id}
              className={`p-4 transition-all duration-200 hover:shadow-md border ${
                isInStock
                  ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/20 dark:bg-emerald-950/10'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <Flex direction="column" justify="between" className="h-full space-y-4">
                <div>
                  <Flex justify="between" align="start" gap="2" className="mb-2">
                    <Text size="3" weight="bold" className="leading-snug">
                      {monitor.name}
                    </Text>
                    {isInStock ? (
                      <Badge color="green" variant="solid" size="2" className="shrink-0 animate-pulse">
                        <CheckCircle2 size={12} className="mr-1" />
                        有货
                      </Badge>
                    ) : isOutOfStock ? (
                      <Badge color="red" variant="soft" size="2" className="shrink-0">
                        <XCircle size={12} className="mr-1" />
                        缺货
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="soft" size="2" className="shrink-0">
                        <Clock size={12} className="mr-1" />
                        检测中
                      </Badge>
                    )}
                  </Flex>

                  {monitor.tags && monitor.tags.length > 0 && (
                    <Flex gap="1" wrap="wrap" className="mb-2">
                      {monitor.tags.map(tag => (
                        <Badge
                          key={tag}
                          variant={selectedTag === tag ? 'solid' : 'surface'}
                          color="indigo"
                          size="1"
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={(e) => {
                            e.preventDefault();
                            setSelectedTag(prev => prev === tag ? 'all' : tag);
                          }}
                        >
                          #{tag}
                        </Badge>
                      ))}
                    </Flex>
                  )}

                  <Text size="1" color="gray" className="block line-clamp-1 mb-3" title={monitor.url}>
                    {monitor.url}
                  </Text>

                  {monitor.last_matched_text && (
                    <Box className="bg-gray-100/80 dark:bg-gray-800/60 p-2 rounded text-xs mb-3">
                      <Text color="gray" size="1">匹配标识: </Text>
                      <Text weight="medium" size="1">{monitor.last_matched_text}</Text>
                    </Box>
                  )}

                  <Box className="space-y-1 text-xs text-gray-500">
                    <Flex justify="between">
                      <span>检测频率:</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{monitor.interval_sec}秒</span>
                    </Flex>
                    <Flex justify="between">
                      <span>上次检测:</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{formatRelativeTime(monitor.last_checked_at)}</span>
                    </Flex>
                    {monitor.last_in_stock_at && (
                      <Flex justify="between">
                        <span>上次有货:</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400" title={formatExactTime(monitor.last_in_stock_at)}>
                          {formatRelativeTime(monitor.last_in_stock_at)}
                        </span>
                      </Flex>
                    )}
                  </Box>
                </div>

                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <a
                    href={monitor.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button
                      className="w-full cursor-pointer"
                      variant={isInStock ? 'solid' : 'soft'}
                      color={isInStock ? 'green' : 'blue'}
                      size="2"
                    >
                      {isInStock ? '🚀 立即抢购' : '前往官网查看'}
                      <ExternalLink size={13} className="ml-1" />
                    </Button>
                  </a>
                </div>
              </Flex>
            </Card>
          );
        })}
      </Grid>

      {filtered.length === 0 && !loading && (
        <Box className="py-16 text-center">
          <ShoppingCart size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <Text size="3" color="gray" className="block">
            {monitors.length === 0 ? '暂无公开的补货监控项' : '未找到匹配的 VPS 监控项'}
          </Text>
        </Box>
      )}
    </Box>
  );
}
