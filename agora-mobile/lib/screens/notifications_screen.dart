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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    try {
      final res = await _api.get('/notifications', params: {'page_size': '50'});
      final data = res['data'] as List<dynamic>;
      setState(() {
        _notifications = data.map((j) => NotificationItem.fromJson(j as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (_) {
      setState(() { _notifications = []; _loading = false; });
    }
  }

  Future<void> _markRead(NotificationItem n) async {
    if (n.isRead) return;
    try {
      await _api.patch('/notifications/${n.id}/read');
      _load();
    } catch (_) {
      // ignore
    }
  }

  IconData _channelIcon(String channel) {
    switch (channel) {
      case 'push': return Icons.phone_android;
      case 'email': return Icons.email_outlined;
      case 'sms': return Icons.sms_outlined;
      default: return Icons.notifications_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _notifications.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.notifications_off_outlined, size: 48, color: AgoraTheme.textMuted),
                        SizedBox(height: 12),
                        Text('No notifications', style: TextStyle(color: AgoraTheme.textSecondary, fontSize: 16)),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _notifications.length,
                    itemBuilder: (context, index) {
                      final n = _notifications[index];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        color: n.isRead ? Colors.white : AgoraTheme.primaryLight.withValues(alpha: 0.3),
                        child: InkWell(
                          onTap: () => _markRead(n),
                          borderRadius: BorderRadius.circular(16),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                CircleAvatar(
                                  radius: 18,
                                  backgroundColor: n.isRead ? AgoraTheme.surface : AgoraTheme.primaryLight,
                                  child: Icon(
                                    _channelIcon(n.channel),
                                    size: 18,
                                    color: n.isRead ? AgoraTheme.textMuted : AgoraTheme.primaryColor,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        n.title,
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: n.isRead ? FontWeight.w500 : FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        n.body,
                                        style: const TextStyle(fontSize: 13, color: AgoraTheme.textSecondary),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        _timeAgo(DateTime.parse(n.createdAt)),
                                        style: const TextStyle(fontSize: 11, color: AgoraTheme.textMuted),
                                      ),
                                    ],
                                  ),
                                ),
                                if (!n.isRead)
                                  Container(
                                    width: 8,
                                    height: 8,
                                    margin: const EdgeInsets.only(top: 4),
                                    decoration: const BoxDecoration(
                                      color: AgoraTheme.primaryColor,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
      ),
    );
  }

  String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat('MMM d').format(dt);
  }
}
