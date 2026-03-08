import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api_client.dart';
import '../core/theme.dart';
import '../models/notification_item.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _api = ApiClient();

  List<NotificationItem> _notifications = [];
  bool _loading = true;
  bool _markingVisibleRead = false;

  String _query = '';
  String _statusFilter = 'all';
  String _channelFilter = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
      });
    }

    try {
      final res = await _api.get('/notifications', params: {'page_size': '80'});
      final data = res['data'] as List<dynamic>? ?? const [];

      if (!mounted) return;
      setState(() {
        _notifications = data
            .map((j) => NotificationItem.fromJson(j as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _notifications = [];
        _loading = false;
      });
    }
  }

  Future<void> _markRead(NotificationItem item) async {
    if (item.isRead) return;

    try {
      await _api.patch('/notifications/${item.id}/read');
      if (!mounted) return;
      setState(() {
        _notifications = _notifications.map((n) {
          if (n.id != item.id) return n;
          return NotificationItem(
            id: n.id,
            title: n.title,
            body: n.body,
            channel: n.channel,
            status: 'read',
            readAt: DateTime.now().toIso8601String(),
            createdAt: n.createdAt,
          );
        }).toList();
      });
    } catch (_) {
      // ignore
    }
  }

  Future<void> _markVisibleAsRead() async {
    final unreadVisible =
        _visibleNotifications().where((item) => !item.isRead).toList();
    if (unreadVisible.isEmpty || _markingVisibleRead) return;

    setState(() {
      _markingVisibleRead = true;
    });

    try {
      for (final item in unreadVisible) {
        await _api.patch('/notifications/${item.id}/read');
      }
      await _load();
    } catch (_) {
      // ignore
    } finally {
      if (mounted) {
        setState(() {
          _markingVisibleRead = false;
        });
      }
    }
  }

  List<NotificationItem> _visibleNotifications() {
    final q = _query.trim().toLowerCase();

    final filtered = _notifications.where((item) {
      if (_statusFilter == 'read' && !item.isRead) return false;
      if (_statusFilter == 'unread' && item.isRead) return false;

      if (_channelFilter != 'all' && item.channel != _channelFilter) {
        return false;
      }

      if (q.isEmpty) return true;
      return item.title.toLowerCase().contains(q) ||
          item.body.toLowerCase().contains(q) ||
          item.channel.toLowerCase().contains(q);
    }).toList();

    filtered.sort(
        (a, b) => _safeDate(b.createdAt).compareTo(_safeDate(a.createdAt)));
    return filtered;
  }

  DateTime _safeDate(String value) {
    return DateTime.tryParse(value) ?? DateTime.fromMillisecondsSinceEpoch(0);
  }

  IconData _channelIcon(String channel) {
    switch (channel) {
      case 'push':
        return Icons.phone_iphone_rounded;
      case 'email':
        return Icons.email_rounded;
      case 'sms':
        return Icons.sms_rounded;
      default:
        return Icons.notifications_active_rounded;
    }
  }

  Color _channelColor(String channel) {
    switch (channel) {
      case 'push':
        return AgoraTheme.primaryColor;
      case 'email':
        return AgoraTheme.warning;
      case 'sms':
        return AgoraTheme.success;
      default:
        return AgoraTheme.primaryDark;
    }
  }

  String _channelLabel(String channel) {
    return channel.replaceAll('_', ' ').toUpperCase();
  }

  String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat('MMM d').format(dt);
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleNotifications();

    final unreadCount = _notifications.where((item) => !item.isRead).length;
    final readCount = _notifications.length - unreadCount;
    final recentCount = _notifications.where((item) {
      final dt = DateTime.tryParse(item.createdAt);
      if (dt == null) return false;
      return DateTime.now().difference(dt).inDays <= 7;
    }).length;

    final channelCounts = <String, int>{
      'in_app': 0,
      'push': 0,
      'email': 0,
      'sms': 0,
    };
    for (final item in _notifications) {
      channelCounts[item.channel] = (channelCounts[item.channel] ?? 0) + 1;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF0F766E), Color(0xFF0D9488)],
                ),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Notification Hub',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Track alerts, announcements, and class updates in one place',
                    style: TextStyle(color: Color(0xE6FFFFFF), fontSize: 13.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _MiniMetric(
                    title: 'Total',
                    value: '${_notifications.length}',
                    icon: Icons.notifications_rounded,
                    color: AgoraTheme.primaryColor,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _MiniMetric(
                    title: 'Unread',
                    value: '$unreadCount',
                    icon: Icons.mark_email_unread_rounded,
                    color: AgoraTheme.warning,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _MiniMetric(
                    title: 'This Week',
                    value: '$recentCount',
                    icon: Icons.schedule_rounded,
                    color: AgoraTheme.success,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(
                          Icons.bar_chart_rounded,
                          color: AgoraTheme.textSecondary,
                          size: 18,
                        ),
                        const SizedBox(width: 6),
                        const Text(
                          'Delivery Mix',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AgoraTheme.textPrimary,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          '$readCount read',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AgoraTheme.textMuted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    _ChannelMixBar(counts: channelCounts),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              decoration: const InputDecoration(
                hintText: 'Search notifications',
                prefixIcon: Icon(Icons.search_rounded),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 10),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _FilterChip(
                    label: 'All',
                    selected: _statusFilter == 'all',
                    onTap: () => setState(() => _statusFilter = 'all'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Unread',
                    selected: _statusFilter == 'unread',
                    onTap: () => setState(() => _statusFilter = 'unread'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Read',
                    selected: _statusFilter == 'read',
                    onTap: () => setState(() => _statusFilter = 'read'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _FilterChip(
                    label: 'Any Channel',
                    selected: _channelFilter == 'all',
                    onTap: () => setState(() => _channelFilter = 'all'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'In-App',
                    selected: _channelFilter == 'in_app',
                    onTap: () => setState(() => _channelFilter = 'in_app'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Push',
                    selected: _channelFilter == 'push',
                    onTap: () => setState(() => _channelFilter = 'push'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Email',
                    selected: _channelFilter == 'email',
                    onTap: () => setState(() => _channelFilter = 'email'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'SMS',
                    selected: _channelFilter == 'sms',
                    onTap: () => setState(() => _channelFilter = 'sms'),
                  ),
                ],
              ),
            ),
            if (!_loading)
              Padding(
                padding: const EdgeInsets.only(top: 10, bottom: 4),
                child: Row(
                  children: [
                    Text(
                      '${visible.length} item(s)',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AgoraTheme.textMuted,
                      ),
                    ),
                    const Spacer(),
                    if (unreadCount > 0)
                      TextButton.icon(
                        onPressed:
                            _markingVisibleRead ? null : _markVisibleAsRead,
                        icon: _markingVisibleRead
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.done_all_rounded, size: 16),
                        label: const Text('Mark visible read'),
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (visible.isEmpty)
              const Card(
                margin: EdgeInsets.only(top: 8),
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 18, vertical: 26),
                  child: Column(
                    children: [
                      Icon(
                        Icons.notifications_off_outlined,
                        size: 44,
                        color: AgoraTheme.textMuted,
                      ),
                      SizedBox(height: 10),
                      Text(
                        'No notifications found',
                        style: TextStyle(color: AgoraTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
              )
            else
              ...visible.map(
                (item) => _NotificationCard(
                  item: item,
                  icon: _channelIcon(item.channel),
                  color: _channelColor(item.channel),
                  channelLabel: _channelLabel(item.channel),
                  timeAgo: _timeAgo(_safeDate(item.createdAt)),
                  createdLabel: DateFormat('MMM d, h:mm a')
                      .format(_safeDate(item.createdAt)),
                  onMarkRead: () => _markRead(item),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  final NotificationItem item;
  final IconData icon;
  final Color color;
  final String channelLabel;
  final String timeAgo;
  final String createdLabel;
  final VoidCallback onMarkRead;

  const _NotificationCard({
    required this.item,
    required this.icon,
    required this.color,
    required this.channelLabel,
    required this.timeAgo,
    required this.createdLabel,
    required this.onMarkRead,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 9),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: item.isRead ? null : onMarkRead,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 11),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 21),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14.2,
                              fontWeight: item.isRead
                                  ? FontWeight.w600
                                  : FontWeight.w800,
                              color: AgoraTheme.textPrimary,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (!item.isRead)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: AgoraTheme.primaryLight,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Text(
                              'NEW',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                color: AgoraTheme.primaryDark,
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      item.body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.8,
                        color: AgoraTheme.textSecondary,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(99),
                            border:
                                Border.all(color: color.withValues(alpha: 0.2)),
                          ),
                          child: Text(
                            channelLabel,
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: color,
                            ),
                          ),
                        ),
                        const SizedBox(width: 7),
                        Text(
                          timeAgo,
                          style: const TextStyle(
                            fontSize: 11,
                            color: AgoraTheme.textMuted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      createdLabel,
                      style: const TextStyle(
                        fontSize: 10.8,
                        color: AgoraTheme.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              if (!item.isRead)
                IconButton(
                  tooltip: 'Mark as read',
                  onPressed: onMarkRead,
                  icon: const Icon(
                    Icons.check_circle_outline_rounded,
                    color: AgoraTheme.primaryColor,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniMetric extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _MiniMetric({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AgoraTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          Text(
            title,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? AgoraTheme.primaryColor : Colors.white,
          borderRadius: BorderRadius.circular(99),
          border: Border.all(
            color: selected ? AgoraTheme.primaryColor : AgoraTheme.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : AgoraTheme.textPrimary,
            fontWeight: FontWeight.w700,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

class _ChannelMixBar extends StatelessWidget {
  final Map<String, int> counts;

  const _ChannelMixBar({required this.counts});

  @override
  Widget build(BuildContext context) {
    final items = [
      _ChannelSlice('In-App', counts['in_app'] ?? 0, AgoraTheme.primaryDark),
      _ChannelSlice('Push', counts['push'] ?? 0, AgoraTheme.primaryColor),
      _ChannelSlice('Email', counts['email'] ?? 0, AgoraTheme.warning),
      _ChannelSlice('SMS', counts['sms'] ?? 0, AgoraTheme.success),
    ];

    final total = items.fold<int>(0, (sum, item) => sum + item.count);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: Row(
            children: items
                .map(
                  (item) => Expanded(
                    flex: total == 0 ? 1 : (item.count == 0 ? 1 : item.count),
                    child: Container(
                      height: 10,
                      color: total == 0 || item.count > 0
                          ? item.color
                          : item.color.withValues(alpha: 0.18),
                    ),
                  ),
                )
                .toList(),
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: items
              .map(
                (item) => Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: item.color,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${item.label} ${item.count}',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AgoraTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}

class _ChannelSlice {
  final String label;
  final int count;
  final Color color;

  _ChannelSlice(this.label, this.count, this.color);
}
