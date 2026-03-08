import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api_client.dart';
import '../core/theme.dart';
import '../models/homework.dart';

class HomeworkScreen extends StatefulWidget {
  const HomeworkScreen({super.key});

  @override
  State<HomeworkScreen> createState() => _HomeworkScreenState();
}

class _HomeworkScreenState extends State<HomeworkScreen> {
  final _api = ApiClient();

  List<Homework> _items = [];
  bool _loading = true;
  int _page = 1;
  int _totalPages = 1;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool append = false}) async {
    setState(() {
      _loading = true;
    });

    try {
      final res = await _api.get('/homework', params: {
        'page': '$_page',
        'page_size': '20',
      });

      final data = res['data'] as List<dynamic>;
      final meta = res['meta'] as Map<String, dynamic>?;
      final pagination = meta?['pagination'] as Map<String, dynamic>?;

      final fetched = data
          .map((j) => Homework.fromJson(j as Map<String, dynamic>))
          .toList();

      if (!mounted) return;

      setState(() {
        _items = append ? [..._items, ...fetched] : fetched;
        _totalPages = (pagination?['total_pages'] as int?) ?? 1;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _items = append ? _items : [];
        _loading = false;
      });
    }
  }

  Future<void> _refresh() async {
    _page = 1;
    await _load(append: false);
  }

  bool _isDueSoon(Homework hw) {
    if (hw.dueAt == null) return false;
    final due = DateTime.tryParse(hw.dueAt!);
    if (due == null) return false;
    final now = DateTime.now();
    final diff = due.difference(now).inDays;
    return !hw.isOverdue && diff <= 3;
  }

  String _dueText(Homework hw) {
    if (hw.dueAt == null) return 'No due date';

    final due = DateTime.tryParse(hw.dueAt!);
    if (due == null) return 'Invalid date';

    final now = DateTime.now();
    final days = due.difference(DateTime(now.year, now.month, now.day)).inDays;

    if (days < 0) return 'Overdue by ${days.abs()} day(s)';
    if (days == 0) return 'Due today';
    if (days == 1) return 'Due tomorrow';
    return 'Due in $days days';
  }

  List<Homework> _filteredItems() {
    switch (_filter) {
      case 'overdue':
        return _items.where((hw) => hw.isOverdue).toList();
      case 'soon':
        return _items.where(_isDueSoon).toList();
      case 'open':
        return _items.where((hw) => !hw.isOverdue).toList();
      default:
        return _items;
    }
  }

  @override
  Widget build(BuildContext context) {
    final overdue = _items.where((hw) => hw.isOverdue).length;
    final dueSoon = _items.where(_isDueSoon).length;
    final open = _items.where((hw) => !hw.isOverdue).length;

    final safeTotal = _items.isEmpty ? 1 : _items.length;
    final onTrackRate = (open * 100 / safeTotal).clamp(0.0, 100.0);

    final visible = _filteredItems();

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF1E40AF), Color(0xFF2563EB)],
              ),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Homework Board',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800),
                ),
                SizedBox(height: 6),
                Text(
                  'Track upcoming, due soon, and overdue tasks',
                  style: TextStyle(color: Color(0xE6FFFFFF), fontSize: 13.5),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _CountCard(
                  title: 'Open',
                  count: open,
                  color: AgoraTheme.success,
                  icon: Icons.playlist_add_check_circle_rounded,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CountCard(
                  title: 'Due Soon',
                  count: dueSoon,
                  color: AgoraTheme.warning,
                  icon: Icons.timelapse_rounded,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CountCard(
                  title: 'Overdue',
                  count: overdue,
                  color: AgoraTheme.danger,
                  icon: Icons.warning_amber_rounded,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Progress Checker',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  _ProgressBar(
                    label: 'On Track Tasks',
                    value: onTrackRate,
                    color: AgoraTheme.success,
                  ),
                  const SizedBox(height: 10),
                  _ProgressBar(
                    label: 'Urgent Load (Due Soon + Overdue)',
                    value: ((dueSoon + overdue) * 100 / safeTotal)
                        .clamp(0.0, 100.0),
                    color: AgoraTheme.warning,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _FilterChip(
                  label: 'All',
                  selected: _filter == 'all',
                  onTap: () => setState(() => _filter = 'all'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Open',
                  selected: _filter == 'open',
                  onTap: () => setState(() => _filter = 'open'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Due Soon',
                  selected: _filter == 'soon',
                  onTap: () => setState(() => _filter = 'soon'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Overdue',
                  selected: _filter == 'overdue',
                  onTap: () => setState(() => _filter = 'overdue'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (visible.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Column(
                  children: [
                    Icon(Icons.menu_book_rounded,
                        size: 44, color: AgoraTheme.textMuted),
                    SizedBox(height: 10),
                    Text('No homework in this filter',
                        style: TextStyle(color: AgoraTheme.textSecondary)),
                  ],
                ),
              ),
            )
          else
            ...visible.map((hw) => _HomeworkCard(
                hw: hw, dueText: _dueText(hw), dueSoon: _isDueSoon(hw))),
          if (!_loading && _totalPages > _page)
            Center(
              child: TextButton.icon(
                onPressed: () {
                  _page += 1;
                  _load(append: true);
                },
                icon: const Icon(Icons.expand_more_rounded),
                label: const Text('Load More'),
              ),
            ),
        ],
      ),
    );
  }
}

class _HomeworkCard extends StatelessWidget {
  final Homework hw;
  final String dueText;
  final bool dueSoon;

  const _HomeworkCard(
      {required this.hw, required this.dueText, required this.dueSoon});

  @override
  Widget build(BuildContext context) {
    final dueDate = hw.dueAt != null ? DateTime.tryParse(hw.dueAt!) : null;

    final Color statusColor;
    final String statusLabel;

    if (hw.isOverdue) {
      statusColor = AgoraTheme.danger;
      statusLabel = 'OVERDUE';
    } else if (dueSoon) {
      statusColor = AgoraTheme.warning;
      statusLabel = 'DUE SOON';
    } else {
      statusColor = AgoraTheme.success;
      statusLabel = 'ON TRACK';
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    hw.title,
                    style: const TextStyle(
                        fontSize: 15.5, fontWeight: FontWeight.w700),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: statusColor),
                  ),
                ),
              ],
            ),
            if ((hw.description ?? '').trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                hw.description!,
                style: const TextStyle(
                    color: AgoraTheme.textSecondary, fontSize: 13),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.calendar_today_rounded,
                    size: 14, color: AgoraTheme.textMuted),
                const SizedBox(width: 5),
                Text(
                  'Assigned ${DateFormat('MMM d').format(DateTime.parse(hw.assignedAt))}',
                  style: const TextStyle(
                      color: AgoraTheme.textMuted, fontSize: 12),
                ),
                const Spacer(),
                if (dueDate != null)
                  Text(
                    DateFormat('MMM d').format(dueDate),
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w600),
                  ),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              dueText,
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: statusColor),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountCard extends StatelessWidget {
  final String title;
  final int count;
  final Color color;
  final IconData icon;

  const _CountCard({
    required this.title,
    required this.count,
    required this.color,
    required this.icon,
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
          Icon(icon, color: color, size: 19),
          const SizedBox(height: 6),
          Text(
            '$count',
            style: TextStyle(
                fontSize: 19, fontWeight: FontWeight.w800, color: color),
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

class _ProgressBar extends StatelessWidget {
  final String label;
  final double value;
  final Color color;

  const _ProgressBar(
      {required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    final clamped = (value / 100).clamp(0.0, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
                child: Text(label,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13))),
            Text('${value.toStringAsFixed(1)}%',
                style: TextStyle(fontWeight: FontWeight.w700, color: color)),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
            value: clamped,
            minHeight: 8,
            valueColor: AlwaysStoppedAnimation<Color>(color),
            backgroundColor: color.withValues(alpha: 0.15),
          ),
        ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChip(
      {required this.label, required this.selected, required this.onTap});

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
              color: selected ? AgoraTheme.primaryColor : AgoraTheme.border),
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
