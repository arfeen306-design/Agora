import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
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
  String _focusStudentId = '';

  int _attendanceToday = 0;
  int _upcomingHomework = 0;
  int _unreadNotifications = 0;

  int _presentCount = 0;
  int _absentCount = 0;
  int _lateCount = 0;
  int _leaveCount = 0;

  double _attendanceRate = 0;
  double _homeworkCompletionRate = 0;
  double _marksAverage = 0;
  double _monthlyTestAverage = 0;

  int _totalHomeworkAssigned = 0;
  int _missingHomeworkCount = 0;
  int _assessmentCount = 0;

  List<_TrendPoint> _trend = [];
  List<_SubjectPoint> _subjects = [];

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<Map<String, dynamic>> _safeGet(String endpoint,
      {Map<String, String>? params}) async {
    try {
      return await _api.get(endpoint, params: params);
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  int _asInt(dynamic value, [int fallback = 0]) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? fallback;
    return fallback;
  }

  double _asDouble(dynamic value, [double fallback = 0]) {
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? fallback;
    return fallback;
  }

  List<dynamic> _asList(dynamic value) {
    if (value is List) return value;
    return const [];
  }

  int _extractTotal(Map<String, dynamic> res) {
    final meta = res['meta'] as Map<String, dynamic>?;
    final pagination = meta?['pagination'] as Map<String, dynamic>?;
    return _asInt(pagination?['total_items']);
  }

  Future<void> _loadDashboard() async {
    final now = DateTime.now();
    final today = DateFormat('yyyy-MM-dd').format(now);

    if (mounted) {
      setState(() {
        _loading = true;
      });
    }

    final results = await Future.wait([
      _safeGet('/reports/attendance/summary', params: {
        'date_from': today,
        'date_to': today,
      }),
      _safeGet('/reports/attendance/summary'),
      _safeGet('/reports/homework/summary'),
      _safeGet('/reports/marks/summary'),
      _safeGet('/reports/marks/summary',
          params: {'assessment_type': 'monthly'}),
      _safeGet('/notifications', params: {'page_size': '40'}),
      _safeGet('/homework', params: {'page_size': '40'}),
      _safeGet('/attendance', params: {'page_size': '50'}),
    ]);

    final todayAttendanceData =
        results[0]['data'] as Map<String, dynamic>? ?? {};
    final attendanceData = results[1]['data'] as Map<String, dynamic>? ?? {};
    final homeworkData = results[2]['data'] as Map<String, dynamic>? ?? {};
    final marksData = results[3]['data'] as Map<String, dynamic>? ?? {};
    final monthlyMarksData = results[4]['data'] as Map<String, dynamic>? ?? {};

    final notificationsList = _asList(results[5]['data']);
    final homeworkList = _asList(results[6]['data']);
    final attendanceList = _asList(results[7]['data']);

    final unreadNotifications = notificationsList.where((item) {
      final row = item as Map<String, dynamic>;
      return (row['status']?.toString() ?? '').toLowerCase() != 'read';
    }).length;

    int upcomingHomework = 0;
    final weekAhead = now.add(const Duration(days: 7));
    for (final item in homeworkList) {
      final row = item as Map<String, dynamic>;
      final dueAtRaw = row['due_at']?.toString();
      if (dueAtRaw == null || dueAtRaw.isEmpty) continue;
      final due = DateTime.tryParse(dueAtRaw);
      if (due == null) continue;
      if (due.isAfter(now) && due.isBefore(weekAhead)) {
        upcomingHomework += 1;
      }
    }

    String focusStudentId = '';
    if (attendanceList.isNotEmpty) {
      final first = attendanceList.first as Map<String, dynamic>;
      focusStudentId = first['student_id']?.toString() ?? '';
    }

    List<_TrendPoint> trend = [];
    List<_SubjectPoint> subjects = [];
    if (focusStudentId.isNotEmpty) {
      final studentSummary =
          await _safeGet('/students/$focusStudentId/marks/summary');
      final data = studentSummary['data'] as Map<String, dynamic>? ?? {};

      trend = _asList(data['trend']).map((item) {
        final row = item as Map<String, dynamic>;
        return _TrendPoint(
          label: row['label']?.toString() ?? '',
          value: _asDouble(row['average']),
        );
      }).toList();

      subjects = _asList(data['subject_averages']).map((item) {
        final row = item as Map<String, dynamic>;
        return _SubjectPoint(
          subject: row['subject_name']?.toString() ?? 'Subject',
          value: _asDouble(row['average']),
        );
      }).toList();
    }

    if (mounted) {
      setState(() {
        _focusStudentId = focusStudentId;

        _attendanceToday = _asInt(todayAttendanceData['total_records']);
        _attendanceRate = _asDouble(attendanceData['present_rate']);
        _presentCount = _asInt(attendanceData['present_count']);
        _absentCount = _asInt(attendanceData['absent_count']);
        _lateCount = _asInt(attendanceData['late_count']);
        _leaveCount = _asInt(attendanceData['leave_count']);

        _homeworkCompletionRate = _asDouble(homeworkData['completion_rate']);
        _totalHomeworkAssigned = _asInt(homeworkData['total_assigned']);
        _missingHomeworkCount = _asInt(homeworkData['missing_count']);

        _marksAverage = _asDouble(marksData['avg_percentage']);
        _assessmentCount = _asInt(marksData['assessment_count']);
        _monthlyTestAverage = _asDouble(monthlyMarksData['avg_percentage']);

        _unreadNotifications = unreadNotifications > 0
            ? unreadNotifications
            : _extractTotal(results[5]);
        _upcomingHomework = upcomingHomework;

        _trend = trend;
        _subjects = subjects;

        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final displayName = user?.firstName ?? 'Learner';

    final performanceScore = ((_attendanceRate +
                _homeworkCompletionRate +
                (_monthlyTestAverage > 0
                    ? _monthlyTestAverage
                    : _marksAverage)) /
            3)
        .clamp(0.0, 100.0).toDouble();

    final donutTotal = _presentCount + _absentCount + _lateCount + _leaveCount;
    final goodSlice = donutTotal == 0 ? 0.0 : (_presentCount / donutTotal);

    final trendPoints = _trend.take(8).toList();
    final monthlyRows = _trend.reversed.take(5).toList();

    return RefreshIndicator(
      onRefresh: _loadDashboard,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          _HeroCard(
            name: displayName,
            focusStudentId: _focusStudentId,
            loading: _loading,
            score: performanceScore,
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _KpiCard(
                  icon: Icons.fact_check_rounded,
                  label: 'Today Attendance',
                  value: _loading ? '...' : '$_attendanceToday',
                  hint: 'Daily check',
                  color: AgoraTheme.success,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  icon: Icons.menu_book_rounded,
                  label: 'Due This Week',
                  value: _loading ? '...' : '$_upcomingHomework',
                  hint: 'Homework',
                  color: AgoraTheme.primaryColor,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  icon: Icons.notifications_active_rounded,
                  label: 'Unread Alerts',
                  value: _loading ? '...' : '$_unreadNotifications',
                  hint: 'Messages',
                  color: AgoraTheme.warning,
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
                  const SizedBox(height: 4),
                  const Text(
                    'Attendance, homework, and monthly marks progress',
                    style: TextStyle(
                        fontSize: 13, color: AgoraTheme.textSecondary),
                  ),
                  const SizedBox(height: 14),
                  _ProgressTile(
                      label: 'Attendance Consistency',
                      percent: _attendanceRate,
                      color: AgoraTheme.success),
                  const SizedBox(height: 12),
                  _ProgressTile(
                      label: 'Homework Completion',
                      percent: _homeworkCompletionRate,
                      color: AgoraTheme.primaryColor),
                  const SizedBox(height: 12),
                  _ProgressTile(
                    label: 'Monthly Test Average',
                    percent: _monthlyTestAverage > 0
                        ? _monthlyTestAverage
                        : _marksAverage,
                    color: Colors.deepPurple,
                  ),
                ],
              ),
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
                    'Graph Snapshot',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _loading
                        ? 'Loading visual analytics...'
                        : 'Attendance blend + marks trend for quick performance view',
                    style: const TextStyle(
                        fontSize: 13, color: AgoraTheme.textSecondary),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        flex: 4,
                        child: Container(
                          height: 160,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: trendPoints.isEmpty
                              ? const Center(
                                  child: Text(
                                    'No marks trend yet',
                                    style: TextStyle(
                                        color: AgoraTheme.textMuted,
                                        fontSize: 12),
                                  ),
                                )
                              : _TrendChart(points: trendPoints),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        flex: 3,
                        child: Container(
                          height: 160,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              _DonutMeter(
                                progress: goodSlice,
                                color: AgoraTheme.success,
                              ),
                              const SizedBox(height: 10),
                              Text(
                                '${_attendanceRate.toStringAsFixed(1)}% Present',
                                style: const TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _LegendPill(
                          label: 'Present $_presentCount',
                          color: AgoraTheme.success),
                      _LegendPill(
                          label: 'Absent $_absentCount',
                          color: AgoraTheme.danger),
                      _LegendPill(
                          label: 'Late $_lateCount', color: AgoraTheme.warning),
                      _LegendPill(
                          label: 'Leave $_leaveCount',
                          color: AgoraTheme.primaryColor),
                    ],
                  ),
                ],
              ),
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
                    'Monthly Test Report',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _loading
                        ? 'Loading test report...'
                        : _assessmentCount > 0
                            ? 'Based on $_assessmentCount recorded assessments'
                            : 'No test scores available yet',
                    style: const TextStyle(
                        fontSize: 13, color: AgoraTheme.textSecondary),
                  ),
                  const SizedBox(height: 10),
                  if (monthlyRows.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        'Monthly test data will appear once marks are submitted.',
                        style: TextStyle(color: AgoraTheme.textMuted),
                      ),
                    )
                  else
                    ...monthlyRows.map((row) {
                      return _MonthlyRow(label: row.label, percent: row.value);
                    }),
                ],
              ),
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
                    'Subject Strength',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  if (_subjects.isEmpty)
                    const Text(
                      'Subject wise report not available yet.',
                      style: TextStyle(color: AgoraTheme.textSecondary),
                    )
                  else
                    ..._subjects.take(4).map((item) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _ProgressTile(
                          label: item.subject,
                          percent: item.value,
                          color: AgoraTheme.primaryColor,
                          dense: true,
                        ),
                      );
                    }),
                  const SizedBox(height: 6),
                  Text(
                    'Homework assigned: $_totalHomeworkAssigned | Missing: $_missingHomeworkCount',
                    style: const TextStyle(
                        fontSize: 12, color: AgoraTheme.textMuted),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TrendPoint {
  final String label;
  final double value;
  const _TrendPoint({required this.label, required this.value});
}

class _SubjectPoint {
  final String subject;
  final double value;
  const _SubjectPoint({required this.subject, required this.value});
}

class _HeroCard extends StatelessWidget {
  final String name;
  final String focusStudentId;
  final bool loading;
  final double score;

  const _HeroCard({
    required this.name,
    required this.focusStudentId,
    required this.loading,
    required this.score,
  });

  @override
  Widget build(BuildContext context) {
    final now = DateFormat('EEE, d MMM').format(DateTime.now());

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1D4ED8), Color(0xFF2563EB), Color(0xFF38BDF8)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x332563EB),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 18,
                backgroundColor: Color(0x33FFFFFF),
                child: Icon(Icons.school_rounded, color: Colors.white),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Hi $name',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                now,
                style: const TextStyle(color: Color(0xD9FFFFFF), fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            loading
                ? 'Loading your learning analytics...'
                : 'Performance score ${score.toStringAsFixed(1)}% • Keep the momentum going',
            style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 13.5),
          ),
          if (focusStudentId.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Student ID: ${focusStudentId.substring(0, math.min(8, focusStudentId.length))}...',
              style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 11.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String hint;
  final Color color;

  const _KpiCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
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
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.w800, color: color),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
          ),
          Text(
            hint,
            style: const TextStyle(fontSize: 10.5, color: AgoraTheme.textMuted),
          ),
        ],
      ),
    );
  }
}

class _ProgressTile extends StatelessWidget {
  final String label;
  final double percent;
  final Color color;
  final bool dense;

  const _ProgressTile({
    required this.label,
    required this.percent,
    required this.color,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    final normalized = (percent / 100).clamp(0.0, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: dense ? 12.5 : 13.5,
                  fontWeight: FontWeight.w600,
                  color: AgoraTheme.textPrimary,
                ),
              ),
            ),
            Text(
              '${percent.toStringAsFixed(1)}%',
              style: TextStyle(
                fontSize: dense ? 12 : 13,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
            minHeight: dense ? 7 : 8,
            value: normalized,
            valueColor: AlwaysStoppedAnimation<Color>(color),
            backgroundColor: color.withValues(alpha: 0.16),
          ),
        ),
      ],
    );
  }
}

class _LegendPill extends StatelessWidget {
  final String label;
  final Color color;
  const _LegendPill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
            fontSize: 11.5, color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _MonthlyRow extends StatelessWidget {
  final String label;
  final double percent;
  const _MonthlyRow({required this.label, required this.percent});

  @override
  Widget build(BuildContext context) {
    final cleanLabel =
        label.length > 18 ? '${label.substring(0, 18)}...' : label;
    final normalized = (percent / 100).clamp(0.0, 1.0);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            flex: 4,
            child: Text(
              cleanLabel,
              style:
                  const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 6,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: normalized,
                minHeight: 8,
                valueColor:
                    const AlwaysStoppedAnimation<Color>(Color(0xFF7C3AED)),
                backgroundColor: const Color(0xFFEDE9FE),
              ),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 44,
            child: Text(
              '${percent.toStringAsFixed(0)}%',
              textAlign: TextAlign.right,
              style:
                  const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _DonutMeter extends StatelessWidget {
  final double progress;
  final Color color;
  const _DonutMeter({required this.progress, required this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 92,
      height: 92,
      child: CustomPaint(
        painter: _DonutPainter(progress: progress, color: color),
        child: Center(
          child: Text(
            '${(progress * 100).toStringAsFixed(0)}%',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
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

    final basePaint = Paint()
      ..color = const Color(0xFFE5E7EB)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    final arcPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, basePaint);
    final sweep = 2 * math.pi * progress.clamp(0.0, 1.0);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      sweep,
      false,
      arcPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.color != color;
  }
}

class _TrendChart extends StatelessWidget {
  final List<_TrendPoint> points;
  const _TrendChart({required this.points});

  @override
  Widget build(BuildContext context) {
    final values = points.map((e) => e.value.clamp(0.0, 100.0)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Marks Trend',
          style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AgoraTheme.textSecondary),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: CustomPaint(
            painter: _TrendPainter(values: values),
            child: Container(),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          points.last.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 11, color: AgoraTheme.textMuted),
        ),
      ],
    );
  }
}

class _TrendPainter extends CustomPainter {
  final List<double> values;
  const _TrendPainter({required this.values});

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;

    const padding = 12.0;
    final w = size.width - (padding * 2);
    final h = size.height - (padding * 2);

    final gridPaint = Paint()
      ..color = const Color(0x1F94A3B8)
      ..strokeWidth = 1;

    for (var i = 0; i < 4; i++) {
      final y = padding + (h * i / 3);
      canvas.drawLine(
          Offset(padding, y), Offset(size.width - padding, y), gridPaint);
    }

    final stepX = values.length == 1 ? 0 : (w / (values.length - 1));
    final points = <Offset>[];

    for (var i = 0; i < values.length; i++) {
      final x = padding + (stepX * i);
      final y = padding + (h - (h * (values[i] / 100)));
      points.add(Offset(x, y));
    }

    final linePath = Path()..moveTo(points.first.dx, points.first.dy);
    for (var i = 1; i < points.length; i++) {
      linePath.lineTo(points[i].dx, points[i].dy);
    }

    final areaPath = Path.from(linePath)
      ..lineTo(points.last.dx, size.height - padding)
      ..lineTo(points.first.dx, size.height - padding)
      ..close();

    final areaPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0x663B82F6), Color(0x003B82F6)],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));

    final linePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.8
      ..strokeCap = StrokeCap.round
      ..color = const Color(0xFF2563EB);

    final pointPaint = Paint()..color = const Color(0xFF1D4ED8);

    canvas.drawPath(areaPath, areaPaint);
    canvas.drawPath(linePath, linePaint);
    for (final point in points) {
      canvas.drawCircle(point, 3.2, pointPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _TrendPainter oldDelegate) {
    if (oldDelegate.values.length != values.length) return true;
    for (var i = 0; i < values.length; i++) {
      if (oldDelegate.values[i] != values[i]) return true;
    }
    return false;
  }
}
