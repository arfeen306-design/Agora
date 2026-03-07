import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api_client.dart';
import '../core/theme.dart';
import '../models/attendance.dart';

class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  final _api = ApiClient();
  List<AttendanceRecord> _records = [];
  bool _loading = true;
  DateTime _selectedDate = DateTime.now();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
      final res = await _api.get('/attendance', params: {
        'date_from': dateStr,
        'date_to': dateStr,
        'page_size': '100',
      });
      final data = res['data'] as List<dynamic>;
      setState(() {
        _records = data.map((j) => AttendanceRecord.fromJson(j as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (_) {
      setState(() { _records = []; _loading = false; });
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2024),
      lastDate: DateTime.now(),
    );
    if (picked != null) {
      setState(() { _selectedDate = picked; });
      _load();
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'present': return AgoraTheme.success;
      case 'absent': return AgoraTheme.danger;
      case 'late': return AgoraTheme.warning;
      case 'leave': return AgoraTheme.primaryColor;
      default: return AgoraTheme.textMuted;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'present': return Icons.check_circle;
      case 'absent': return Icons.cancel;
      case 'late': return Icons.access_time;
      case 'leave': return Icons.event_busy;
      default: return Icons.help_outline;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dateStr = DateFormat('EEEE, MMM d, yyyy').format(_selectedDate);

    // Calculate stats
    final present = _records.where((r) => r.status == 'present').length;
    final absent = _records.where((r) => r.status == 'absent').length;
    final late = _records.where((r) => r.status == 'late').length;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Date picker
          InkWell(
            onTap: _pickDate,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AgoraTheme.border),
              ),
              child: Row(
                children: [
                  const Icon(Icons.calendar_today, size: 18, color: AgoraTheme.primaryColor),
                  const SizedBox(width: 12),
                  Expanded(child: Text(dateStr, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500))),
                  const Icon(Icons.keyboard_arrow_down, color: AgoraTheme.textMuted),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Stats row
          if (!_loading && _records.isNotEmpty)
            Row(
              children: [
                _MiniStat(label: 'Present', count: present, color: AgoraTheme.success),
                const SizedBox(width: 8),
                _MiniStat(label: 'Absent', count: absent, color: AgoraTheme.danger),
                const SizedBox(width: 8),
                _MiniStat(label: 'Late', count: late, color: AgoraTheme.warning),
              ],
            ),

          if (!_loading && _records.isNotEmpty) const SizedBox(height: 16),

          // Records
          if (_loading)
            const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
          else if (_records.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(40),
                child: Column(
                  children: [
                    Icon(Icons.event_available, size: 48, color: AgoraTheme.textMuted),
                    SizedBox(height: 12),
                    Text('No records for this date', style: TextStyle(color: AgoraTheme.textSecondary)),
                  ],
                ),
              ),
            )
          else
            ...List.generate(_records.length, (i) {
              final r = _records[i];
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: _statusColor(r.status).withValues(alpha: 0.15),
                    child: Icon(_statusIcon(r.status), color: _statusColor(r.status), size: 20),
                  ),
                  title: Text(
                    'Student ${r.studentId.substring(0, 8)}...',
                    style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
                  ),
                  subtitle: Text(
                    r.checkInAt != null ? 'Check-in: ${DateFormat.jm().format(DateTime.parse(r.checkInAt!))}' : 'Source: ${r.source}',
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: _statusColor(r.status).withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      r.status.toUpperCase(),
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _statusColor(r.status)),
                    ),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final int count;
  final Color color;

  const _MiniStat({required this.label, required this.count, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Text('$count', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
            Text(label, style: TextStyle(fontSize: 12, color: color)),
          ],
        ),
      ),
    );
  }
}
