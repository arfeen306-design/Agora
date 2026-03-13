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
  String _selectedStudentId = '';
  List<_LinkedStudent> _linkedStudents = [];

  int _attendanceToday = 0;
  int _upcomingHomework = 0;
  int _unreadNotifications = 0;
  String _todayAttendanceStatus = 'pending';

  int _presentCount = 0;
  int _absentCount = 0;
  int _lateCount = 0;
  int _leaveCount = 0;

  double _attendanceRate = 0;
  double _homeworkCompletionRate = 0;
  double _marksAverage = 0;
  double _monthlyTestAverage = 0;

  int _totalHomeworkAssigned = 0;
  int _homeworkDoneCount = 0;
  int _homeworkPendingCount = 0;
  int _missingHomeworkCount = 0;
  int _assessmentCount = 0;
  double _participationPulse = 0;

  List<_TrendPoint> _trend = [];
  List<_SubjectPoint> _subjects = [];
  List<_RecentAssessmentPoint> _recentAssessments = [];
  List<_NotificationPreview> _recentNotifications = [];
  String _progressLoopMessage = 'Learning pattern will appear after enough records.';

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

  String _progressLoopFromTrend(List<_TrendPoint> trend) {
    if (trend.length < 4) {
      return 'Keep consistency in attendance and tests to unlock progress trend.';
    }

    final safeValues = trend.map((point) => point.value.clamp(0, 100).toDouble()).toList();
    final latest = safeValues.reversed.take(3).toList();
    final previous = safeValues.reversed.skip(3).take(3).toList();
    if (previous.isEmpty || latest.isEmpty) {
      return 'Progress is stabilizing with current performance.';
    }

    final latestAvg = latest.reduce((a, b) => a + b) / latest.length;
    final previousAvg = previous.reduce((a, b) => a + b) / previous.length;
    final delta = latestAvg - previousAvg;

    if (delta >= 4) {
      return 'Improving trend: recent tests are stronger than earlier ones.';
    }
    if (delta <= -4) {
      return 'Needs attention: recent scores dipped, plan revision support.';
    }
    return 'Stable trend: progress is consistent across recent assessments.';
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'present':
        return AgoraTheme.success;
      case 'late':
        return AgoraTheme.warning;
      case 'absent':
        return AgoraTheme.danger;
      case 'leave':
        return AgoraTheme.primaryColor;
      default:
        return AgoraTheme.textMuted;
    }
  }

  Future<void> _loadDashboard() async {
    final now = DateTime.now();
    final today = DateFormat('yyyy-MM-dd').format(now);
    final authUser = context.read<AuthProvider>().user;
    final isParentOrStudent = (authUser?.isParent ?? false) || (authUser?.isStudent ?? false);

    if (mounted) {
      setState(() {
        _loading = true;
      });
    }

    if (isParentOrStudent) {
      final linkedStudentsRes = await _safeGet('/people/me/students');
      final linkedStudentsRaw = _asList(linkedStudentsRes['data']);
      final linkedStudents = linkedStudentsRaw
          .map((item) => _LinkedStudent.fromJson(item as Map<String, dynamic>))
          .toList();

      String selectedStudentId = _selectedStudentId;
      if (selectedStudentId.isEmpty ||
          !linkedStudents.any((student) => student.id == selectedStudentId)) {
        selectedStudentId = linkedStudents.isNotEmpty ? linkedStudents.first.id : '';
      }

      if (selectedStudentId.isEmpty) {
        if (!mounted) return;
        setState(() {
          _linkedStudents = linkedStudents;
          _selectedStudentId = '';
          _focusStudentId = '';
          _attendanceToday = 0;
          _upcomingHomework = 0;
          _unreadNotifications = 0;
          _attendanceRate = 0;
          _homeworkCompletionRate = 0;
          _marksAverage = 0;
          _monthlyTestAverage = 0;
          _totalHomeworkAssigned = 0;
          _homeworkDoneCount = 0;
          _homeworkPendingCount = 0;
          _missingHomeworkCount = 0;
          _assessmentCount = 0;
          _presentCount = 0;
          _absentCount = 0;
          _lateCount = 0;
          _leaveCount = 0;
          _trend = [];
          _subjects = [];
          _recentAssessments = [];
          _recentNotifications = [];
          _todayAttendanceStatus = 'pending';
          _participationPulse = 0;
          _progressLoopMessage = 'No linked student found for this account.';
          _loading = false;
        });
        return;
      }

      final results = await Future.wait([
        _safeGet('/people/students/$selectedStudentId/academic-summary'),
        _safeGet('/people/students/$selectedStudentId/timeline', params: {
          'max_events': '60',
        }),
        _safeGet('/students/$selectedStudentId/marks/summary'),
        _safeGet('/notifications', params: {'page_size': '20'}),
        _safeGet('/attendance', params: {
          'student_id': selectedStudentId,
          'date_from': today,
          'date_to': today,
          'page_size': '5',
        }),
      ]);

      final summaryData = results[0]['data'] as Map<String, dynamic>? ?? {};
      final timelineData = results[1]['data'] as Map<String, dynamic>? ?? {};
      final marksData = results[2]['data'] as Map<String, dynamic>? ?? {};
      final notificationsList = _asList(results[3]['data']);
      final todayAttendanceList = _asList(results[4]['data']);

      final attendanceSummary =
          summaryData['attendance_summary'] as Map<String, dynamic>? ?? {};
      final homeworkSummary =
          summaryData['homework_summary'] as Map<String, dynamic>? ?? {};
      final marksSummary = summaryData['marks_summary'] as Map<String, dynamic>? ?? {};

      final presentCount = _asInt(attendanceSummary['present']);
      final absentCount = _asInt(attendanceSummary['absent']);
      final lateCount = _asInt(attendanceSummary['late']);
      final leaveCount = _asInt(attendanceSummary['leave']);
      final totalDays = _asInt(attendanceSummary['total_days']);

      final totalHomeworkAssigned = _asInt(homeworkSummary['total_assigned']);
      final homeworkSubmitted = _asInt(homeworkSummary['submitted']);
      final homeworkPending =
          math.max(0, totalHomeworkAssigned - homeworkSubmitted);

      final trend = _asList(marksData['trend']).map((item) {
        final row = item as Map<String, dynamic>;
        return _TrendPoint(
          label: row['label']?.toString() ?? '',
          value: _asDouble(row['average']),
        );
      }).toList();

      final subjects = _asList(marksData['subject_averages']).map((item) {
        final row = item as Map<String, dynamic>;
        return _SubjectPoint(
          subject: row['subject_name']?.toString() ?? 'Subject',
          value: _asDouble(row['average']),
        );
      }).toList();

      final timelineEvents = _asList(timelineData['events']);
      final recentAssessments = timelineEvents
          .where((event) => (event as Map<String, dynamic>)['type'] == 'assessment_score')
          .take(8)
          .map((event) => _RecentAssessmentPoint.fromTimeline(event as Map<String, dynamic>))
          .where((event) => event.maxMarks > 0)
          .toList();

      final recentNotifications = notificationsList
          .take(6)
          .map((item) => _NotificationPreview.fromJson(item as Map<String, dynamic>))
          .toList();

      final unreadNotifications = notificationsList.where((item) {
        final row = item as Map<String, dynamic>;
        return (row['status']?.toString() ?? '').toLowerCase() != 'read';
      }).length;

      final todayAttendanceStatus = todayAttendanceList.isNotEmpty
          ? ((todayAttendanceList.first as Map<String, dynamic>)['status']?.toString() ?? 'pending')
          : 'pending';

      final marksAverage = _asDouble(marksSummary['average_percentage']) > 0
          ? _asDouble(marksSummary['average_percentage'])
          : _asDouble(marksData['overall_average']);

      final monthlyTests = recentAssessments
          .where((event) => event.assessmentType.toLowerCase() == 'monthly')
          .toList();
      final monthlyAverage = monthlyTests.isNotEmpty
          ? monthlyTests.map((event) => event.percentage).reduce((a, b) => a + b) / monthlyTests.length
          : marksAverage;

      if (!mounted) return;
      setState(() {
        _linkedStudents = linkedStudents;
        _selectedStudentId = selectedStudentId;
        _focusStudentId = selectedStudentId;

        _attendanceToday = todayAttendanceStatus == 'pending' ? 0 : 1;
        _todayAttendanceStatus = todayAttendanceStatus;

        _presentCount = presentCount;
        _absentCount = absentCount;
        _lateCount = lateCount;
        _leaveCount = leaveCount;
        _attendanceRate = totalDays > 0
            ? _asDouble(attendanceSummary['rate'])
            : 0;

        _totalHomeworkAssigned = totalHomeworkAssigned;
        _homeworkDoneCount = homeworkSubmitted;
        _homeworkPendingCount = homeworkPending;
        _missingHomeworkCount = homeworkPending;
        _upcomingHomework = homeworkPending;
        _homeworkCompletionRate = _asDouble(homeworkSummary['completion_rate']);

        _marksAverage = marksAverage;
        _monthlyTestAverage = monthlyAverage;
        _assessmentCount = _asInt(marksSummary['assessment_count']);

        _unreadNotifications = unreadNotifications > 0
            ? unreadNotifications
            : _extractTotal(results[3]);
        _recentNotifications = recentNotifications;

        _trend = trend;
        _subjects = subjects;
        _recentAssessments = recentAssessments;

        _participationPulse =
            ((_attendanceRate * 0.55) + (_homeworkCompletionRate * 0.45))
                .clamp(0.0, 100.0)
                .toDouble();
        _progressLoopMessage = _progressLoopFromTrend(trend);
        _loading = false;
      });
      return;
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

    final attendanceToday = _asInt(todayAttendanceData['total_records']);
    final totalHomeworkAssigned = _asInt(homeworkData['total_assigned']);
    final homeworkDoneCount = _asInt(homeworkData['submitted_count']);
    final homeworkPendingCount = math.max(0, totalHomeworkAssigned - homeworkDoneCount);

    if (mounted) {
      setState(() {
        _focusStudentId = focusStudentId;
        _selectedStudentId = focusStudentId;
        _linkedStudents = [];
        _todayAttendanceStatus = attendanceToday > 0 ? 'present' : 'pending';

        _attendanceToday = attendanceToday;
        _attendanceRate = _asDouble(attendanceData['present_rate']);
        _presentCount = _asInt(attendanceData['present_count']);
        _absentCount = _asInt(attendanceData['absent_count']);
        _lateCount = _asInt(attendanceData['late_count']);
        _leaveCount = _asInt(attendanceData['leave_count']);

        _homeworkCompletionRate = _asDouble(homeworkData['completion_rate']);
        _totalHomeworkAssigned = totalHomeworkAssigned;
        _homeworkDoneCount = homeworkDoneCount;
        _homeworkPendingCount = homeworkPendingCount;
        _missingHomeworkCount = _asInt(homeworkData['missing_count']);

        _marksAverage = _asDouble(marksData['avg_percentage']);
        _assessmentCount = _asInt(marksData['assessment_count']);
        _monthlyTestAverage = _asDouble(monthlyMarksData['avg_percentage']);

        _unreadNotifications = unreadNotifications > 0
            ? unreadNotifications
            : _extractTotal(results[5]);
        _upcomingHomework = upcomingHomework;
        _recentNotifications = notificationsList
            .take(6)
            .map((item) => _NotificationPreview.fromJson(item as Map<String, dynamic>))
            .toList();

        _trend = trend;
        _subjects = subjects;
        _recentAssessments = trend
            .reversed
            .take(5)
            .map((point) => _RecentAssessmentPoint(
                  title: point.label,
                  assessmentType: 'assessment',
                  marksObtained: point.value,
                  maxMarks: 100,
                  percentage: point.value,
                  dateText: point.label,
                ))
            .toList();
        _participationPulse =
            ((_attendanceRate * 0.55) + (_homeworkCompletionRate * 0.45))
                .clamp(0.0, 100.0)
                .toDouble();
        _progressLoopMessage = _progressLoopFromTrend(trend);

        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final displayName = user?.firstName ?? 'Learner';
    final isParentOrStudent = (user?.isParent ?? false) || (user?.isStudent ?? false);

    _LinkedStudent? activeStudent;
    for (final student in _linkedStudents) {
      if (student.id == _selectedStudentId) {
        activeStudent = student;
        break;
      }
    }

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
    final monthlyRows = _recentAssessments
        .map((item) => _TrendPoint(label: item.title, value: item.percentage))
        .take(5)
        .toList();

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
            studentName: activeStudent?.fullName,
            classLabel: activeStudent?.classLabel,
            classTeacherName: activeStudent?.classTeacherName,
            progressLoop: _progressLoopMessage,
          ),
          if (isParentOrStudent && _linkedStudents.length > 1) ...[
            const SizedBox(height: 14),
            _StudentSwitcher(
              students: _linkedStudents,
              selectedStudentId: _selectedStudentId,
              onChanged: (studentId) {
                if (studentId == _selectedStudentId) return;
                setState(() {
                  _selectedStudentId = studentId;
                });
                _loadDashboard();
              },
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _KpiCard(
                  icon: Icons.fact_check_rounded,
                  label: 'Today Attendance',
                  value: _loading ? '...' : '$_attendanceToday',
                  hint: _loading ? 'Daily check' : _todayAttendanceStatus.toUpperCase(),
                  color: AgoraTheme.success,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  icon: Icons.menu_book_rounded,
                  label: 'Pending HW',
                  value: _loading ? '...' : '$_upcomingHomework',
                  hint: _loading ? 'Homework' : 'Done $_homeworkDoneCount',
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
          if (isParentOrStudent) ...[
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Child Status Snapshot',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _LegendPill(
                          label: 'Attendance: ${_todayAttendanceStatus.toUpperCase()}',
                          color: _statusColor(_todayAttendanceStatus),
                        ),
                        _LegendPill(
                          label: 'Homework Done $_homeworkDoneCount',
                          color: AgoraTheme.success,
                        ),
                        _LegendPill(
                          label: 'Homework Pending $_homeworkPendingCount',
                          color: AgoraTheme.warning,
                        ),
                        _LegendPill(
                          label: 'Participation ${_participationPulse.toStringAsFixed(1)}%',
                          color: const Color(0xFF7C3AED),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
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
                    label: 'Participation Pulse',
                    percent: _participationPulse,
                    color: const Color(0xFF7C3AED),
                  ),
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
          if (_recentAssessments.isNotEmpty) ...[
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Recent Test Marks',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    ..._recentAssessments.take(4).map((test) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    test.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    test.assessmentType.replaceAll('_', ' ').toUpperCase(),
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AgoraTheme.textMuted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              '${test.marksObtained.toStringAsFixed(0)}/${test.maxMarks.toStringAsFixed(0)}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AgoraTheme.textPrimary,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: const Color(0xFF1D4ED8).withValues(alpha: 0.10),
                                borderRadius: BorderRadius.circular(99),
                              ),
                              child: Text(
                                '${test.percentage.toStringAsFixed(0)}%',
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF1D4ED8),
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          ],
          if (_recentNotifications.isNotEmpty) ...[
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'School Notifications',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    ..._recentNotifications.take(4).map((notification) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              notification.status.toLowerCase() == 'read'
                                  ? Icons.mark_email_read_rounded
                                  : Icons.mark_email_unread_rounded,
                              size: 17,
                              color: notification.status.toLowerCase() == 'read'
                                  ? AgoraTheme.textMuted
                                  : AgoraTheme.primaryColor,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    notification.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    notification.body,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 11.5,
                                      color: AgoraTheme.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              notification.timeLabel,
                              style: const TextStyle(fontSize: 10.5, color: AgoraTheme.textMuted),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          ],
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
                    'Homework assigned: $_totalHomeworkAssigned | Done: $_homeworkDoneCount | Pending: $_homeworkPendingCount',
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

class _LinkedStudent {
  final String id;
  final String studentCode;
  final String fullName;
  final String? classLabel;
  final String? classTeacherName;

  const _LinkedStudent({
    required this.id,
    required this.studentCode,
    required this.fullName,
    this.classLabel,
    this.classTeacherName,
  });

  factory _LinkedStudent.fromJson(Map<String, dynamic> json) {
    final classroom = json['classroom'] as Map<String, dynamic>?;
    return _LinkedStudent(
      id: json['id']?.toString() ?? '',
      studentCode: json['student_code']?.toString() ?? '—',
      fullName: json['full_name']?.toString().trim().isNotEmpty == true
          ? json['full_name'].toString().trim()
          : [json['first_name'], json['last_name']]
              .where((item) => item != null && item.toString().trim().isNotEmpty)
              .join(' ')
              .trim(),
      classLabel: classroom?['display_name']?.toString(),
      classTeacherName: classroom?['class_teacher_name']?.toString(),
    );
  }
}

class _RecentAssessmentPoint {
  final String title;
  final String assessmentType;
  final double marksObtained;
  final double maxMarks;
  final double percentage;
  final String dateText;

  const _RecentAssessmentPoint({
    required this.title,
    required this.assessmentType,
    required this.marksObtained,
    required this.maxMarks,
    required this.percentage,
    required this.dateText,
  });

  factory _RecentAssessmentPoint.fromTimeline(Map<String, dynamic> timelineEvent) {
    final payload = timelineEvent['data'] as Map<String, dynamic>? ?? {};
    final marks = (payload['marks_obtained'] as num?)?.toDouble() ?? 0;
    final maxMarks = (payload['max_marks'] as num?)?.toDouble() ?? 0;
    final percentage = maxMarks > 0 ? ((marks / maxMarks) * 100) : 0;

    return _RecentAssessmentPoint(
      title: payload['title']?.toString() ?? 'Assessment',
      assessmentType: payload['assessment_type']?.toString() ?? 'assessment',
      marksObtained: marks,
      maxMarks: maxMarks,
      percentage: percentage.clamp(0, 100).toDouble(),
      dateText: timelineEvent['date']?.toString() ?? '',
    );
  }
}

class _NotificationPreview {
  final String title;
  final String body;
  final String status;
  final String timeLabel;

  const _NotificationPreview({
    required this.title,
    required this.body,
    required this.status,
    required this.timeLabel,
  });

  factory _NotificationPreview.fromJson(Map<String, dynamic> json) {
    final createdAt = json['created_at']?.toString();
    DateTime? dateTime;
    if (createdAt != null && createdAt.isNotEmpty) {
      dateTime = DateTime.tryParse(createdAt);
    }

    return _NotificationPreview(
      title: json['title']?.toString() ?? 'Notification',
      body: json['body']?.toString() ?? '',
      status: json['status']?.toString() ?? 'queued',
      timeLabel: dateTime == null ? '' : DateFormat('d MMM').format(dateTime.toLocal()),
    );
  }
}

class _StudentSwitcher extends StatelessWidget {
  final List<_LinkedStudent> students;
  final String selectedStudentId;
  final ValueChanged<String> onChanged;

  const _StudentSwitcher({
    required this.students,
    required this.selectedStudentId,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Viewing Child',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: selectedStudentId.isEmpty ? null : selectedStudentId,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
              items: students
                  .map(
                    (student) => DropdownMenuItem<String>(
                      value: student.id,
                      child: Text(
                        '${student.fullName} (${student.studentCode})',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) onChanged(value);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _HeroCard extends StatelessWidget {
  final String name;
  final String focusStudentId;
  final bool loading;
  final double score;
  final String? studentName;
  final String? classLabel;
  final String? classTeacherName;
  final String progressLoop;

  const _HeroCard({
    required this.name,
    required this.focusStudentId,
    required this.loading,
    required this.score,
    required this.studentName,
    required this.classLabel,
    required this.classTeacherName,
    required this.progressLoop,
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
          if ((studentName ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Child: $studentName',
              style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 12),
            ),
          ],
          if ((classLabel ?? '').isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'Class: $classLabel',
              style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 11.5),
            ),
          ],
          if ((classTeacherName ?? '').isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'Class Teacher: $classTeacherName',
              style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 11.5),
            ),
          ],
          if (!loading) ...[
            const SizedBox(height: 8),
            Text(
              progressLoop,
              style: const TextStyle(
                color: Color(0xE6FFFFFF),
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
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
