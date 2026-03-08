import 'dart:math' as math;

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
    setState(() {
      _loading = true;
    });

    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
      final res = await _api.get('/attendance', params: {
        'date_from': dateStr,
        'date_to': dateStr,
        'page_size': '100',
      });

      final data = res['data'] as List<dynamic>;
      if (!mounted) return;

      setState(() {
        _records = data
            .map((j) => AttendanceRecord.fromJson(j as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _records = [];
        _loading = false;
      });
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
      setState(() {
        _selectedDate = picked;
      });
      _load();
    }
  }

  void _goPrevDay() {
    setState(() {
      _selectedDate = _selectedDate.subtract(const Duration(days: 1));
    });
    _load();
  }

  void _goNextDay() {
    final next = _selectedDate.add(const Duration(days: 1));
    if (next.isAfter(DateTime.now())) return;
    setState(() {
      _selectedDate = next;
    });
    _load();
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'present':
        return AgoraTheme.success;
      case 'absent':
        return AgoraTheme.danger;
      case 'late':
        return AgoraTheme.warning;
      case 'leave':
        return AgoraTheme.primaryColor;
      default:
        return AgoraTheme.textMuted;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'present':
        return Icons.check_circle_rounded;
      case 'absent':
        return Icons.cancel_rounded;
      case 'late':
        return Icons.schedule_rounded;
      case 'leave':
        return Icons.event_busy_rounded;
      default:
        return Icons.help_outline_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final titleDate = DateFormat('EEEE, d MMM yyyy').format(_selectedDate);

    final total = _records.length;
    final present = _records.where((r) => r.status == 'present').length;
    final absent = _records.where((r) => r.status == 'absent').length;
    final late = _records.where((r) => r.status == 'late').length;
    final leave = _records.where((r) => r.status == 'leave').length;

    final presentRate = total == 0 ? 0.0 : (present * 100 / total);
    final onTrackRate = total == 0 ? 0.0 : ((present + leave) * 100 / total);

    return RefreshIndicator(
      onRefresh: _load,
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
                colors: [Color(0xFF0EA5E9), Color(0xFF2563EB)],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Attendance Tracker',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  titleDate,
                  style:
                      const TextStyle(color: Color(0xE6FFFFFF), fontSize: 13.5),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    _DateAction(
                        icon: Icons.chevron_left_rounded, onTap: _goPrevDay),
                    const SizedBox(width: 8),
                    _DateAction(
                        icon: Icons.calendar_month_rounded, onTap: _pickDate),
                    const SizedBox(width: 8),
                    _DateAction(
                        icon: Icons.chevron_right_rounded, onTap: _goNextDay),
                    const Spacer(),
                    Text(
                      '$total records',
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Daily Progress Checker',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  _ProgressRow(
                      label: 'Present Rate',
                      value: presentRate,
                      color: AgoraTheme.success),
                  const SizedBox(height: 10),
                  _ProgressRow(
                      label: 'On Track (Present + Leave)',
                      value: onTrackRate,
                      color: AgoraTheme.primaryColor),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      children: [
                        _Donut(
                          progress: total == 0 ? 0 : (present / total),
                          color: AgoraTheme.success,
                        ),
                        const SizedBox(height: 10),
                        Text(
                          '${presentRate.toStringAsFixed(1)}% Present',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _Legend(
                            label: 'Present $present',
                            color: AgoraTheme.success),
                        _Legend(
                            label: 'Absent $absent', color: AgoraTheme.danger),
                        _Legend(label: 'Late $late', color: AgoraTheme.warning),
                        _Legend(
                            label: 'Leave $leave',
                            color: AgoraTheme.primaryColor),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text(
            'Daily Log',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_records.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Column(
                  children: [
                    Icon(Icons.event_available_rounded,
                        size: 42, color: AgoraTheme.textMuted),
                    SizedBox(height: 10),
                    Text('No attendance records for this date',
                        style: TextStyle(color: AgoraTheme.textSecondary)),
                  ],
                ),
              ),
            )
          else
            ..._records.map((record) {
              return _AttendanceRow(
                record: record,
                color: _statusColor(record.status),
                icon: _statusIcon(record.status),
              );
            }),
        ],
      ),
    );
  }
}

class _AttendanceRow extends StatelessWidget {
  final AttendanceRecord record;
  final Color color;
  final IconData icon;

  const _AttendanceRow({
    required this.record,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final time = record.checkInAt != null
        ? DateFormat.jm().format(DateTime.parse(record.checkInAt!))
        : 'No check-in';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Student ${record.studentId.substring(0, math.min(8, record.studentId.length))}...',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$time • ${record.source}',
                    style: const TextStyle(
                        color: AgoraTheme.textSecondary, fontSize: 12),
                  ),
                  if ((record.note ?? '').trim().isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      record.note!,
                      style: const TextStyle(
                          color: AgoraTheme.textMuted, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                record.status.toUpperCase(),
                style: TextStyle(
                    color: color, fontWeight: FontWeight.w700, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateAction extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _DateAction({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: const Color(0x26FFFFFF),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: Colors.white),
      ),
    );
  }
}

class _ProgressRow extends StatelessWidget {
  final String label;
  final double value;
  final Color color;

  const _ProgressRow(
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
              child: Text(
                label,
                style:
                    const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ),
            Text(
              '${value.toStringAsFixed(1)}%',
              style: TextStyle(fontWeight: FontWeight.w700, color: color),
            ),
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

class _Legend extends StatelessWidget {
  final String label;
  final Color color;
  const _Legend({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
            color: color, fontWeight: FontWeight.w700, fontSize: 11.5),
      ),
    );
  }
}

class _Donut extends StatelessWidget {
  final double progress;
  final Color color;
  const _Donut({required this.progress, required this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 90,
      height: 90,
      child: CustomPaint(
        painter: _DonutPainter(progress: progress, color: color),
        child: Center(
          child: Text(
            '${(progress * 100).toStringAsFixed(0)}%',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  final double progress;
  final Color color;

  const _DonutPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 10.0;
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - stroke) / 2;

    final base = Paint()
      ..color = const Color(0xFFE5E7EB)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    final arc = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, base);
    final sweep = 2 * math.pi * progress.clamp(0.0, 1.0);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      sweep,
      false,
      arc,
    );
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.color != color;
  }
}
