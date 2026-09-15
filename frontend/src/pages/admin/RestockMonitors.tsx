import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Grid,
  Select,
  Switch,
  SegmentedControl,
  Table,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Grip,
  History,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  XCircle,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import Loading from '../../components/Loading';
import { useApi } from '../../contexts/AuthContext';

export type RestockStatus = 'unknown' | 'in_stock' | 'out_of_stock' | 'error';
export type RestockCheckMode = 'keyword' | 'regex' | 'status_code';
export type RestockStatusFilter = 'all' | 'in_stock' | 'out_of_stock' | 'error' | 'hidden';
export type RestockSortKey = 'manual' | 'name' | 'status' | 'checked_at';

export interface RestockMonitor {
  id: number;
  name: string;
  url: string;
  check_mode: RestockCheckMode;
  stock_keywords: string[];
  out_of_stock_keywords: string[];
  stock_pattern: string;
  custom_headers: Record<string, string>;
  interval_sec: number;
  timeout_sec: number;
  enabled: boolean;
  hidden: boolean;
  notify_on_restock: boolean;
  notify_on_out_of_stock: boolean;
  sort_order: number;
  status: RestockStatus;
  last_checked_at: string | null;
  last_in_stock_at: string | null;
  last_out_of_stock_at: string | null;
  last_notified_at: string | null;
  last_error: string | null;
  last_matched_text: string | null;
  last_status_code: number | null;
  last_latency_ms: number | null;
  status_changed_at: string | null;
  created_at: string;
}

export interface RestockCheck {
  id: number;
  monitor_id: number;
  checked_at: string;
  in_stock: boolean;
  matched_text: string | null;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

interface FormState {
  name: string;
  url: string;
  check_mode: RestockCheckMode;
  stock_keywords_text: string;
  out_of_stock_keywords_text: string;
  stock_pattern: string;
  custom_headers_text: string;
  interval_sec: number;
  timeout_sec: number;
  enabled: boolean;
  hidden: boolean;
  notify_on_restock: boolean;
  notify_on_out_of_stock: boolean;
}

const emptyForm: FormState = {
  name: '',
  url: 'https://',
  check_mode: 'keyword',
  stock_keywords_text: 'Add to Cart, In Stock, 立即购买, 加入购物车',
  out_of_stock_keywords_text: 'Out of Stock, Sold Out, 缺货, 已售罄',
  stock_pattern: '',
  custom_headers_text: '',
  interval_sec: 120,
  timeout_sec: 15,
  enabled: true,
  hidden: false,
  notify_on_restock: true,
  notify_on_out_of_stock: false,
};

function statusLabel(status: RestockStatus) {
  if (status === 'in_stock') return '有货';
  if (status === 'out_of_stock') return '缺货';
  if (status === 'error') return '异常';
  return '等待';
}

function statusColor(status: RestockStatus): 'green' | 'red' | 'amber' | 'gray' {
  if (status === 'in_stock') return 'green';
  if (status === 'out_of_stock') return 'red';
  if (status === 'error') return 'amber';
  return 'gray';
}

function formatTime(value: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,，]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function parseHeaders(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      // ignore
    }
  }
  const result: Record<string, string> = {};
  for (const line of trimmed.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) result[k] = v;
    }
  }
  return result;
}

interface SortableRestockRowProps {
  monitor: RestockMonitor;
  selected: boolean;
  dragDisabled: boolean;
  checking: boolean;
  onSelect: (id: number) => void;
  onCheck: (monitor: RestockMonitor) => void;
  onHistory: (monitor: RestockMonitor) => void;
  onVisibility: (monitor: RestockMonitor, hidden: boolean) => void;
  onEnabled: (monitor: RestockMonitor, enabled: boolean) => void;
  onEdit: (monitor: RestockMonitor) => void;
  onRemove: (monitor: RestockMonitor) => void;
}

function SortableRestockRow({
  monitor,
  selected,
  dragDisabled,
  checking,
  onSelect,
  onCheck,
  onHistory,
  onVisibility,
  onEnabled,
  onEdit,
  onRemove,
}: SortableRestockRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: monitor.id,
    disabled: dragDisabled,
  });

  const rowStyle = {
    opacity: isDragging ? 0.72 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative' as const,
    zIndex: isDragging ? 2 : 0,
  };

  return (
    <Table.Row ref={setNodeRef} className={`admin-table-row${selected ? ' is-selected' : ''}`} style={rowStyle}>
      <Table.Cell className="admin-website-control-cell">
        <Flex align="center" gap="1">
          <Tooltip content={dragDisabled ? '切到手动排序后可拖拽' : '拖拽排序'}>
            <button
              type="button"
              className="admin-row-drag-handle"
              aria-label={`拖拽排序 ${monitor.name}`}
              disabled={dragDisabled}
              {...attributes}
              {...listeners}
            >
              <Grip size={15} />
            </button>
          </Tooltip>
          <Checkbox checked={selected} onCheckedChange={() => onSelect(monitor.id)} />
        </Flex>
      </Table.Cell>
      <Table.RowHeaderCell>
        <Flex align="center" gap="2">
          {monitor.status === 'in_stock' && <CheckCircle2 size={16} className="text-emerald-500" />}
          {monitor.status === 'out_of_stock' && <XCircle size={16} className="text-rose-500" />}
          {monitor.status === 'error' && <AlertTriangle size={16} className="text-amber-500" />}
          {monitor.status === 'unknown' && <Clock size={16} className="text-gray-400" />}
          <div>
            <Text weight="bold" size="2">{monitor.name}</Text>
            {monitor.last_matched_text && (
              <Text size="1" color="gray" className="block truncate max-w-[200px]" title={monitor.last_matched_text}>
                匹配: {monitor.last_matched_text}
              </Text>
            )}
          </div>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell>
        <a
          href={monitor.url}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-website-url flex items-center gap-1 max-w-[260px] truncate text-blue-500 hover:underline"
        >
          <span className="truncate">{monitor.url}</span>
          <ExternalLink size={12} className="shrink-0" />
        </a>
      </Table.Cell>
      <Table.Cell>
        <Badge color={statusColor(monitor.status)} variant="soft">
          {statusLabel(monitor.status)}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Badge variant="outline" size="1">
          {monitor.check_mode === 'keyword' ? '关键词' : monitor.check_mode === 'regex' ? '正则' : '状态码'}
        </Badge>
      </Table.Cell>
      <Table.Cell>{monitor.interval_sec}s</Table.Cell>
      <Table.Cell>
        {monitor.last_latency_ms != null ? `${monitor.last_latency_ms}ms` : '-'}
      </Table.Cell>
      <Table.Cell>
        <Text size="1" color="gray">{formatTime(monitor.last_checked_at)}</Text>
      </Table.Cell>
      <Table.Cell>
        <Badge color={monitor.hidden ? 'orange' : 'gray'} variant="soft" size="1">
          {monitor.hidden ? '隐藏' : '公开'}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Flex gap="1" align="center" wrap="wrap">
          <Button size="1" variant="soft" disabled={checking} onClick={() => onCheck(monitor)}>
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            检测
          </Button>
          <Button size="1" variant="soft" onClick={() => onHistory(monitor)}>
            <History size={12} />
            记录
          </Button>
          <Button size="1" variant="soft" onClick={() => onVisibility(monitor, !monitor.hidden)}>
            {monitor.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
            {monitor.hidden ? '公开' : '隐藏'}
          </Button>
          <Button size="1" variant="soft" onClick={() => onEnabled(monitor, !monitor.enabled)}>
            <Power size={12} />
            {monitor.enabled ? '停用' : '启用'}
          </Button>
          <Button size="1" variant="soft" onClick={() => onEdit(monitor)}>
            <Pencil size={12} />
            编辑
          </Button>
          <Button size="1" color="red" variant="soft" onClick={() => onRemove(monitor)}>
            <Trash2 size={12} />
            删除
          </Button>
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}

export default function RestockMonitors() {
  const apiFetch = useApi();
  const [monitors, setMonitors] = useState<RestockMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RestockStatusFilter>('all');
  const [sortKey, setSortKey] = useState<RestockSortKey>('manual');

  // Selected
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Add / Edit Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  // History Modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMonitor, setHistoryMonitor] = useState<RestockMonitor | null>(null);
  const [historyChecks, setHistoryChecks] = useState<RestockCheck[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const loadMonitors = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/admin/restock');
      setMonitors(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载补货监控列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMonitors();
  }, []);

  const stats = useMemo(() => {
    return {
      total: monitors.length,
      in_stock: monitors.filter(m => m.status === 'in_stock').length,
      out_of_stock: monitors.filter(m => m.status === 'out_of_stock').length,
      error: monitors.filter(m => m.status === 'error').length,
      hidden: monitors.filter(m => m.hidden).length,
    };
  }, [monitors]);

  const filteredMonitors = useMemo(() => {
    let result = [...monitors];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(m => m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q));
    }
    if (statusFilter === 'in_stock') result = result.filter(m => m.status === 'in_stock');
    else if (statusFilter === 'out_of_stock') result = result.filter(m => m.status === 'out_of_stock');
    else if (statusFilter === 'error') result = result.filter(m => m.status === 'error');
    else if (statusFilter === 'hidden') result = result.filter(m => m.hidden);

    if (sortKey === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortKey === 'status') {
      const order = { in_stock: 0, out_of_stock: 1, error: 2, unknown: 3 };
      result.sort((a, b) => order[a.status] - order[b.status]);
    } else if (sortKey === 'checked_at') {
      result.sort((a, b) => (b.last_checked_at || '').localeCompare(a.last_checked_at || ''));
    }
    return result;
  }, [monitors, search, statusFilter, sortKey]);

  // Handlers
  const handleCheck = async (monitor: RestockMonitor) => {
    setCheckingIds(prev => new Set(prev).add(monitor.id));
    try {
      const res = await apiFetch(`/admin/restock/${monitor.id}/check`, { method: 'POST', body: '{}' }) as {
        success?: boolean;
        monitor?: RestockMonitor;
        check?: RestockCheck;
      };
      if (res.monitor) {
        setMonitors(prev => prev.map(m => (m.id === monitor.id ? res.monitor! : m)));
        if (res.monitor.status === 'in_stock') {
          toast.success(`🎉 【${monitor.name}】检测到有货！`, {
            description: res.monitor.last_matched_text ? `匹配: ${res.monitor.last_matched_text}` : undefined,
          });
        } else if (res.monitor.status === 'out_of_stock') {
          toast.info(`📦 【${monitor.name}】目前缺货中`);
        } else if (res.monitor.status === 'error') {
          toast.warning(`⚠️ 【${monitor.name}】检测异常: ${res.monitor.last_error || '未知错误'}`);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '手动检测失败');
    } finally {
      setCheckingIds(prev => {
        const next = new Set(prev);
        next.delete(monitor.id);
        return next;
      });
    }
  };

  const handleHistory = async (monitor: RestockMonitor) => {
    setHistoryMonitor(monitor);
    setHistoryOpen(true);
    setLoadingHistory(true);
    try {
      const checks = await apiFetch(`/admin/restock/${monitor.id}/checks?limit=100`);
      setHistoryChecks(Array.isArray(checks) ? checks : []);
    } catch (error) {
      toast.error('加载检测记录失败');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleVisibility = async (monitor: RestockMonitor, hidden: boolean) => {
    try {
      await apiFetch('/admin/restock/visibility', {
        method: 'POST',
        body: JSON.stringify({ id: monitor.id, hidden }),
      });
      setMonitors(prev => prev.map(m => (m.id === monitor.id ? { ...m, hidden } : m)));
      toast.success(hidden ? '已设置为隐藏' : '已设置为公开');
    } catch (error) {
      toast.error('显隐设置失败');
    }
  };

  const handleEnabled = async (monitor: RestockMonitor, enabled: boolean) => {
    try {
      await apiFetch('/admin/restock/enabled', {
        method: 'POST',
        body: JSON.stringify({ id: monitor.id, enabled }),
      });
      setMonitors(prev => prev.map(m => (m.id === monitor.id ? { ...m, enabled } : m)));
      toast.success(enabled ? '监控已启用' : '监控已停用');
    } catch (error) {
      toast.error('启停切换失败');
    }
  };

  const handleRemove = async (monitor: RestockMonitor) => {
    if (!window.confirm(`确定要删除补货监控「${monitor.name}」吗？历史记录也将一并清除。`)) return;
    try {
      await apiFetch('/admin/restock/delete', {
        method: 'POST',
        body: JSON.stringify({ id: monitor.id }),
      });
      setMonitors(prev => prev.filter(m => m.id !== monitor.id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(monitor.id);
        return next;
      });
      toast.success('已删除补货监控');
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = monitors.findIndex(m => m.id === Number(active.id));
    const newIndex = monitors.findIndex(m => m.id === Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(monitors, oldIndex, newIndex);
    setMonitors(next);
    const ids = next.map(m => m.id);
    try {
      await apiFetch('/admin/restock/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    } catch {
      toast.error('保存排序失败');
      loadMonitors();
    }
  };

  const openAddDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setEditOpen(true);
  };

  const openEditDialog = (monitor: RestockMonitor) => {
    setEditingId(monitor.id);
    setForm({
      name: monitor.name,
      url: monitor.url,
      check_mode: monitor.check_mode,
      stock_keywords_text: monitor.stock_keywords.join(', '),
      out_of_stock_keywords_text: monitor.out_of_stock_keywords.join(', '),
      stock_pattern: monitor.stock_pattern || '',
      custom_headers_text: Object.entries(monitor.custom_headers || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
      interval_sec: monitor.interval_sec,
      timeout_sec: monitor.timeout_sec,
      enabled: monitor.enabled,
      hidden: monitor.hidden,
      notify_on_restock: monitor.notify_on_restock,
      notify_on_out_of_stock: monitor.notify_on_out_of_stock,
    });
    setEditOpen(true);
  };

  const handleSaveForm = async () => {
    if (!form.name.trim()) {
      toast.error('请输入监控名称');
      return;
    }
    if (!form.url.trim() || !/^https?:\/\//i.test(form.url.trim())) {
      toast.error('请输入合法的目标网页 URL (http:// 或 https://)');
      return;
    }

    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      check_mode: form.check_mode,
      stock_keywords: parseKeywords(form.stock_keywords_text),
      out_of_stock_keywords: parseKeywords(form.out_of_stock_keywords_text),
      stock_pattern: form.stock_pattern.trim(),
      custom_headers: parseHeaders(form.custom_headers_text),
      interval_sec: Number(form.interval_sec) || 120,
      timeout_sec: Number(form.timeout_sec) || 15,
      enabled: form.enabled,
      hidden: form.hidden,
      notify_on_restock: form.notify_on_restock,
      notify_on_out_of_stock: form.notify_on_out_of_stock,
    };

    if (form.check_mode === 'keyword' && payload.stock_keywords.length === 0 && payload.out_of_stock_keywords.length === 0) {
      toast.error('关键词模式下至少需要指定一个有货或缺货关键词');
      return;
    }

    if (form.check_mode === 'regex' && !payload.stock_pattern) {
      toast.error('正则模式下请输入正则表达式');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const res = await apiFetch('/admin/restock/edit', {
          method: 'POST',
          body: JSON.stringify({ id: editingId, ...payload }),
        }) as { monitor?: RestockMonitor };
        if (res.monitor) {
          setMonitors(prev => prev.map(m => (m.id === editingId ? res.monitor! : m)));
        }
        toast.success('补货监控已保存');
      } else {
        const res = await apiFetch('/admin/restock/add', {
          method: 'POST',
          body: JSON.stringify(payload),
        }) as { monitor?: RestockMonitor };
        if (res.monitor) {
          setMonitors(prev => [...prev, res.monitor!]);
        }
        toast.success('补货监控已添加');
      }
      setEditOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredMonitors.map(m => m.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && monitors.length === 0) {
    return <Loading fullScreen />;
  }

  return (
    <Box className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* 头部导航与统计 */}
      <Flex justify="between" align="center" wrap="wrap" gap="4">
        <div>
          <Flex align="center" gap="2">
            <ShoppingCart size={26} className="text-blue-500" />
            <Text size="6" weight="bold">VPS 补货监控</Text>
          </Flex>
          <Text size="2" color="gray">
            实时监控特价 VPS / 独立服务器库存页面，监测到补货自动发送 Telegram / 邮件 / Webhook 通知
          </Text>
        </div>
        <Flex gap="2">
          <Button variant="soft" onClick={loadMonitors}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
          <Button onClick={openAddDialog}>
            <Plus size={14} />
            添加监控
          </Button>
        </Flex>
      </Flex>

      {/* 统计状态卡片 */}
      <Grid columns={{ initial: '2', sm: '4' }} gap="3">
        <Card className="p-3">
          <Text size="1" color="gray">全部监控</Text>
          <Text size="5" weight="bold" className="block mt-1">{stats.total}</Text>
        </Card>
        <Card className="p-3">
          <Flex align="center" gap="1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <Text size="1" color="gray">当前有货</Text>
          </Flex>
          <Text size="5" weight="bold" className="block mt-1 text-emerald-500">{stats.in_stock}</Text>
        </Card>
        <Card className="p-3">
          <Flex align="center" gap="1">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <Text size="1" color="gray">当前缺货</Text>
          </Flex>
          <Text size="5" weight="bold" className="block mt-1 text-rose-500">{stats.out_of_stock}</Text>
        </Card>
        <Card className="p-3">
          <Flex align="center" gap="1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <Text size="1" color="gray">检测异常</Text>
          </Flex>
          <Text size="5" weight="bold" className="block mt-1 text-amber-500">{stats.error}</Text>
        </Card>
      </Grid>

      {/* 搜索与过滤工具栏 */}
      <Card className="p-3">
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <Flex align="center" gap="2" className="flex-1 min-w-[240px]">
            <TextField.Root
              placeholder="搜索监控名称或链接..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full max-w-sm"
            >
              <TextField.Slot>
                <Search size={14} />
              </TextField.Slot>
            </TextField.Root>
          </Flex>

          <Flex align="center" gap="2" wrap="wrap">
            <SegmentedControl.Root
              value={statusFilter}
              onValueChange={v => setStatusFilter(v as RestockStatusFilter)}
            >
              <SegmentedControl.Item value="all">全部</SegmentedControl.Item>
              <SegmentedControl.Item value="in_stock">有货</SegmentedControl.Item>
              <SegmentedControl.Item value="out_of_stock">缺货</SegmentedControl.Item>
              <SegmentedControl.Item value="error">异常</SegmentedControl.Item>
              <SegmentedControl.Item value="hidden">隐藏</SegmentedControl.Item>
            </SegmentedControl.Root>

            <Select.Root value={sortKey} onValueChange={v => setSortKey(v as RestockSortKey)}>
              <Select.Trigger placeholder="排序方式" />
              <Select.Content>
                <Select.Item value="manual">手动排序</Select.Item>
                <Select.Item value="name">按名称</Select.Item>
                <Select.Item value="status">按状态</Select.Item>
                <Select.Item value="checked_at">最近检测</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
        </Flex>
      </Card>

      {/* 监控列表表格 */}
      <Card className="overflow-hidden p-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <Table.Root className="w-full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell className="w-[50px]">
                  <Checkbox
                    checked={
                      filteredMonitors.length > 0 &&
                      selectedIds.size === filteredMonitors.length
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>名称 / 匹配项</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>目标地址</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>模式</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>频率</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>延迟</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>最近检测</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>公开性</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="text-right">操作</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <SortableContext
                items={filteredMonitors.map(m => m.id)}
                strategy={rectSortingStrategy}
              >
                {filteredMonitors.map(monitor => (
                  <SortableRestockRow
                    key={monitor.id}
                    monitor={monitor}
                    selected={selectedIds.has(monitor.id)}
                    dragDisabled={sortKey !== 'manual'}
                    checking={checkingIds.has(monitor.id)}
                    onSelect={handleSelectOne}
                    onCheck={handleCheck}
                    onHistory={handleHistory}
                    onVisibility={handleVisibility}
                    onEnabled={handleEnabled}
                    onEdit={openEditDialog}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </Table.Body>
          </Table.Root>
        </DndContext>

        {filteredMonitors.length === 0 && (
          <Box className="py-12 text-center">
            <ShoppingCart size={36} className="mx-auto text-gray-400 mb-2" />
            <Text color="gray" size="2">
              {monitors.length === 0 ? '暂无监控项，点击上方「添加监控」开始监控特价 VPS 页面' : '没有符合筛选条件的监控项'}
            </Text>
          </Box>
        )}
      </Card>

      {/* 创建 / 编辑对话框 */}
      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Content className="max-w-xl max-h-[90vh] overflow-y-auto">
          <Dialog.Title>
            {editingId ? '编辑补货监控' : '添加补货监控'}
          </Dialog.Title>
          <Dialog.Description size="2" color="gray" className="mb-4">
            配置目标页面的抓取规则与有货/缺货判断条件。
          </Dialog.Description>

          <Box className="space-y-4">
            <div>
              <Text as="label" size="2" weight="bold" className="block mb-1">
                监控名称 <span className="text-red-500">*</span>
              </Text>
              <TextField.Root
                placeholder="例如: RackNerd 2024 黑五特价 1C1G"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div>
              <Text as="label" size="2" weight="bold" className="block mb-1">
                目标 URL <span className="text-red-500">*</span>
              </Text>
              <TextField.Root
                placeholder="https://..."
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              />
              <Text size="1" color="gray" className="mt-1 block">
                商家购买/购物车页面或产品配置页直达链接
              </Text>
            </div>

            <div>
              <Text as="label" size="2" weight="bold" className="block mb-1">
                检测模式
              </Text>
              <SegmentedControl.Root
                value={form.check_mode}
                onValueChange={v => setForm(f => ({ ...f, check_mode: v as RestockCheckMode }))}
              >
                <SegmentedControl.Item value="keyword">关键词匹配 (推荐)</SegmentedControl.Item>
                <SegmentedControl.Item value="regex">正则表达式</SegmentedControl.Item>
                <SegmentedControl.Item value="status_code">HTTP 状态码</SegmentedControl.Item>
              </SegmentedControl.Root>
            </div>

            {form.check_mode === 'keyword' && (
              <>
                <div>
                  <Text as="label" size="2" weight="bold" className="block mb-1">
                    有货关键词 (多个可用逗号或换行分隔)
                  </Text>
                  <TextArea
                    rows={2}
                    placeholder="例如: Add to Cart, In Stock, 立即购买, 加入购物车"
                    value={form.stock_keywords_text}
                    onChange={e => setForm(f => ({ ...f, stock_keywords_text: e.target.value }))}
                  />
                  <Text size="1" color="gray" className="mt-1 block">
                    当网页出现任一关键词时，判定为「有货」
                  </Text>
                </div>

                <div>
                  <Text as="label" size="2" weight="bold" className="block mb-1">
                    缺货关键词 (优先级高于有货关键词)
                  </Text>
                  <TextArea
                    rows={2}
                    placeholder="例如: Out of Stock, Sold Out, 缺货, 已售罄, 缺货中"
                    value={form.out_of_stock_keywords_text}
                    onChange={e => setForm(f => ({ ...f, out_of_stock_keywords_text: e.target.value }))}
                  />
                  <Text size="1" color="gray" className="mt-1 block">
                    只要网页匹配到任一缺货词即判定为「缺货」，防止页面包含静态购买文字导致的误报
                  </Text>
                </div>
              </>
            )}

            {form.check_mode === 'regex' && (
              <div>
                <Text as="label" size="2" weight="bold" className="block mb-1">
                  有货正则表达式
                </Text>
                <TextField.Root
                  placeholder="例如: 库存[:：]\s*[1-9]\d* 或 in\s*stock"
                  value={form.stock_pattern}
                  onChange={e => setForm(f => ({ ...f, stock_pattern: e.target.value }))}
                />
                <Text size="1" color="gray" className="mt-1 block">
                  当页面匹配该正则时判定为「有货」
                </Text>
              </div>
            )}

            <Grid columns="2" gap="3">
              <div>
                <Text as="label" size="2" weight="bold" className="block mb-1">
                  检测频率 (秒)
                </Text>
                <Select.Root
                  value={String(form.interval_sec)}
                  onValueChange={v => setForm(f => ({ ...f, interval_sec: Number(v) }))}
                >
                  <Select.Trigger />
                  <Select.Content>
                    <Select.Item value="60">60 秒 (1分钟)</Select.Item>
                    <Select.Item value="120">120 秒 (2分钟)</Select.Item>
                    <Select.Item value="300">300 秒 (5分钟)</Select.Item>
                    <Select.Item value="600">600 秒 (10分钟)</Select.Item>
                    <Select.Item value="1800">1800 秒 (30分钟)</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>

              <div>
                <Text as="label" size="2" weight="bold" className="block mb-1">
                  超时时间 (秒)
                </Text>
                <TextField.Root
                  type="number"
                  min="1"
                  max="30"
                  value={String(form.timeout_sec)}
                  onChange={e => setForm(f => ({ ...f, timeout_sec: Number(e.target.value) }))}
                />
              </div>
            </Grid>

            {/* 通知开关 */}
            <Card className="p-3 bg-gray-50/50 dark:bg-gray-800/30">
              <Text size="2" weight="bold" className="block mb-2">通知设置</Text>
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <div>
                    <Text size="2" weight="medium">🛒 补货时发送通知</Text>
                    <Text size="1" color="gray" className="block">当状态由缺货变为有货时，触发 Telegram/邮件/Webhook 通知</Text>
                  </div>
                  <Switch
                    checked={form.notify_on_restock}
                    onCheckedChange={c => setForm(f => ({ ...f, notify_on_restock: c }))}
                  />
                </Flex>

                <Flex justify="between" align="center" className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    <Text size="2" weight="medium">📦 缺货时发送通知</Text>
                    <Text size="1" color="gray" className="block">当商品再次售罄时触发通知（默认关闭）</Text>
                  </div>
                  <Switch
                    checked={form.notify_on_out_of_stock}
                    onCheckedChange={c => setForm(f => ({ ...f, notify_on_out_of_stock: c }))}
                  />
                </Flex>
              </Flex>
            </Card>

            {/* 自定义请求头 */}
            <div>
              <Text as="label" size="2" weight="bold" className="block mb-1">
                自定义 HTTP Headers (选填)
              </Text>
              <TextArea
                rows={2}
                placeholder="Header-Name: Value&#10;Cookie: your_cookie_here"
                value={form.custom_headers_text}
                onChange={e => setForm(f => ({ ...f, custom_headers_text: e.target.value }))}
              />
              <Text size="1" color="gray" className="mt-1 block">
                每行一个 header，适用于需要特定 Cookie 或 Token 的商家页面
              </Text>
            </div>

            <Grid columns="2" gap="4" className="pt-2">
              <Flex justify="between" align="center">
                <div>
                  <Text size="2" weight="medium">是否启用</Text>
                  <Text size="1" color="gray" className="block">停用后不再自动检测</Text>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={c => setForm(f => ({ ...f, enabled: c }))}
                />
              </Flex>

              <Flex justify="between" align="center">
                <div>
                  <Text size="2" weight="medium">对游客隐藏</Text>
                  <Text size="1" color="gray" className="block">仅在管理员后台可见</Text>
                </div>
                <Switch
                  checked={form.hidden}
                  onCheckedChange={c => setForm(f => ({ ...f, hidden: c }))}
                />
              </Flex>
            </Grid>
          </Box>

          <Flex gap="2" justify="end" className="mt-6">
            <Button variant="soft" color="gray" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={handleSaveForm}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* 历史记录对话框 */}
      <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}>
        <Dialog.Content className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <Dialog.Title>
            检测历史记录 - {historyMonitor?.name}
          </Dialog.Title>
          <Dialog.Description size="2" color="gray" className="mb-4">
            展示最近 100 次补货检测结果时间线。
          </Dialog.Description>

          {loadingHistory ? (
            <Loading />
          ) : historyChecks.length === 0 ? (
            <Box className="py-8 text-center text-gray-400">
              暂无检测记录
            </Box>
          ) : (
            <Table.Root className="w-full text-xs">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>检测时间</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>库存状态</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>匹配内容</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>状态码</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>延迟</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>错误信息</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {historyChecks.map(check => (
                  <Table.Row key={check.id}>
                    <Table.Cell>{formatTime(check.checked_at)}</Table.Cell>
                    <Table.Cell>
                      {check.error ? (
                        <Badge color="amber" size="1">异常</Badge>
                      ) : check.in_stock ? (
                        <Badge color="green" size="1">🟢 有货</Badge>
                      ) : (
                        <Badge color="red" size="1">🔴 缺货</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell className="max-w-[150px] truncate" title={check.matched_text || ''}>
                      {check.matched_text || '-'}
                    </Table.Cell>
                    <Table.Cell>{check.status_code ? `HTTP ${check.status_code}` : '-'}</Table.Cell>
                    <Table.Cell>{check.latency_ms != null ? `${check.latency_ms}ms` : '-'}</Table.Cell>
                    <Table.Cell className="text-red-500 max-w-[150px] truncate" title={check.error || ''}>
                      {check.error || '-'}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}

          <Flex justify="end" className="mt-4">
            <Button variant="soft" onClick={() => setHistoryOpen(false)}>
              关闭
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
