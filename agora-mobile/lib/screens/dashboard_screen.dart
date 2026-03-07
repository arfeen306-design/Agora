import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/theme.dart';
import '../providers/auth_provider.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _api = ApiClient();
  bool _loading = true;
  int _attendanceCount = 0;
  int _homeworkCount = 0;
  int _notificationCount = 0;
  int _eventCount = 0;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final today = DateTime.now().toIso8601String().split('T')[0];
      final results = await Future.wait([
        _api.get('/attendance', params: {'date_from': today, 'date_to': today, 'page_size': '1'}).catchError((_) => <String, dynamic>{}),
        _api.get('/homework', params: {'page_size': '1'}).catchError((_) => <String, dynamic>{}),
        _api.get('/notifications', params: {'page_size': '1'}).catchError((_) => <String, dynamic>{}),
        _api.get('/events', params: {'date_from': today, 'page_size': '1'}).catchError((_) => <String, dynamic>{}),
      ]);

      if (mounted) {
        setState(() {
          _attendanceCount = _extractTotal(results[0]);
          _homeworkCount = _extractTotal(results[1]);
          _notificationCount = _extractTotal(results[2]);
          _eventCount = _extractTotal(results[3]);
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() { _loading = false; });
    }
  }

  int _extractTotal(Map<String, dynamic> res) {
    final meta = res['meta'] as Map<String, dynamic>?;
    final pagination = meta?['pagination'] as Map<String, dynamic>?;
    return (pagination?['total_items'] as int?) ?? 0;
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;

    return RefreshIndicator(
      onRefresh: _loadStats,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Welcome
          Text(
            'Welcome back,\n${user?.firstName ?? 'User'}!',
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, height: 1.2),
          ),
          const SizedBox(height: 4),
          Text(
            user?.isParent == true ? 'Here\'s your child\'s overview' : 'Here\'s your school overview',
            style: const TextStyle(fontSize: 15, color: AgoraTheme.textSecondary),
          ),
          const SizedBox(height: 24),

          // Stats Grid
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.5,
            children: [
              _StatCard(
                icon: Icons.fact_check,
                label: 'Attendance Today',
                value: _loading ? '...' : '$_attendanceCount',
                color: AgoraTheme.success,
                bgColor: AgoraTheme.successLight,
              ),
              _StatCard(
                icon: Icons.menu_book,
                label: 'Homework',
                value: _loading ? '...' : '$_homeworkCount',
                color: AgoraTheme.primaryColor,
                bgColor: AgoraTheme.primaryLight,
              ),
              _StatCard(
                icon: Icons.notifications,
                label: 'Notifications',
                value: _loading ? '...' : '$_notificationCount',
                color: AgoraTheme.warning,
                bgColor: AgoraTheme.warningLight,
              ),
              _StatCard(
                icon: Icons.event,
                label: 'Events',
                value: _loading ? '...' : '$_eventCount',
                color: Colors.purple,
                bgColor: Colors.purple.shade50,
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Info card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.info_outline, color: AgoraTheme.primaryColor, size: 20),
                      SizedBox(width: 8),
                      Text('Quick Info', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _InfoRow(label: 'Name', value: user?.fullName ?? '—'),
                  _InfoRow(label: 'Email', value: user?.email ?? '—'),
                  _InfoRow(label: 'Role', value: user?.roles.join(', ').replaceAll('_', ' ') ?? '—'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  final Color bgColor;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
    required this.bgColor,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const Spacer(),
            Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color)),
            Text(label, style: const TextStyle(fontSize: 12, color: AgoraTheme.textSecondary)),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(width: 70, child: Text(label, style: const TextStyle(fontSize: 13, color: AgoraTheme.textSecondary))),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }
}
