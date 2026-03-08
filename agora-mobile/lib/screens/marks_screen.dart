
import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/theme.dart';
import '../models/assessment.dart';

class MarksScreen extends StatefulWidget {
  const MarksScreen({super.key});

  @override
  State<MarksScreen> createState() => _MarksScreenState();
}

class _MarksScreenState extends State<MarksScreen> {
  final _api = ApiClient();

  List<Assessment> _assessments = [];
  bool _loading = true;

  double _avgPercent = 0;
  double _monthlyAvg = 0;
  int _scoreCount = 0;
  int _assessmentCount = 0;

  String _selectedType = 'all';

  @override
  void initState() {
    super.initState();
    _load();
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

  Future<void> _load() async {
    setState(() {
      _loading = true;
    });

    try {
      final results = await Future.wait([
        _safeGet('/assessments', params: {'page_size': '80'}),
        _safeGet('/reports/marks/summary'),
        _safeGet('/reports/marks/summary',
            params: {'assessment_type': 'monthly'}),
      ]);

      final list = (results[0]['data'] as List<dynamic>? ?? [])
          .map((j) => Assessment.fromJson(j as Map<String, dynamic>))
          .toList();

      final summary = results[1]['data'] as Map<String, dynamic>? ?? {};
      final monthly = results[2]['data'] as Map<String, dynamic>? ?? {};

      if (!mounted) return;

      setState(() {
        _assessments = list;
        _avgPercent = _asDouble(summary['avg_percentage']);
        _monthlyAvg = _asDouble(monthly['avg_percentage']);
        _scoreCount = _asInt(summary['score_count']);
        _assessmentCount = _asInt(summary['assessment_count']);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _assessments = [];
        _avgPercent = 0;
        _monthlyAvg = 0;
        _scoreCount = 0;
        _assessmentCount = 0;
        _loading = false;
      });
    }
  }

  Color _typeColor(String type) {
    switch (type) {
      case 'quiz':
        return AgoraTheme.primaryColor;
      case 'assignment':
        return AgoraTheme.success;
      case 'monthly':
        return AgoraTheme.warning;
      case 'term':
        return Colors.purple;
      case 'final':
        return AgoraTheme.danger;
      default:
        return AgoraTheme.textMuted;
    }
  }

  List<Assessment> _visibleAssessments() {
    if (_selectedType == 'all') return _assessments;
    return _assessments
        .where((a) => a.assessmentType == _selectedType)
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleAssessments();

    final quizCount =
        _assessments.where((a) => a.assessmentType == 'quiz').length;
    final monthlyCount =
        _assessments.where((a) => a.assessmentType == 'monthly').length;
    final finalCount =
        _assessments.where((a) => a.assessmentType == 'final').length;

    final recent = List<Assessment>.from(_assessments)
      ..sort((a, b) {
        final da = a.assessmentDate == null
            ? DateTime(1900)
            : DateTime.tryParse(a.assessmentDate!) ?? DateTime(1900);
        final db = b.assessmentDate == null
            ? DateTime(1900)
            : DateTime.tryParse(b.assessmentDate!) ?? DateTime(1900);
        return db.compareTo(da);
      });

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
                colors: [Color(0xFF7C3AED), Color(0xFF4F46E5)],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Marks & Monthly Report',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                Text(
                  _loading
                      ? 'Loading report analytics...'
                      : 'Overall ${_avgPercent.toStringAsFixed(1)}% • Monthly ${_monthlyAvg.toStringAsFixed(1)}%',
                  style:
                      const TextStyle(color: Color(0xE6FFFFFF), fontSize: 13.5),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _MetricTile(
                  title: 'Overall %',
                  value: _loading ? '...' : _avgPercent.toStringAsFixed(1),
                  suffix: '%',
                  icon: Icons.auto_graph_rounded,
                  color: AgoraTheme.primaryColor,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricTile(
                  title: 'Monthly %',
                  value: _loading ? '...' : _monthlyAvg.toStringAsFixed(1),
                  suffix: '%',
                  icon: Icons.calendar_view_month_rounded,
                  color: AgoraTheme.warning,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricTile(
                  title: 'Scores',
                  value: _loading ? '...' : '$_scoreCount',
                  suffix: '',
                  icon: Icons.score_rounded,
                  color: AgoraTheme.success,
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
                  const Text('Progress Checker',
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  _ProgressLine(
                      label: 'Overall Academic Progress',
                      value: _avgPercent,
                      color: AgoraTheme.primaryColor),
                  const SizedBox(height: 10),
                  _ProgressLine(
                      label: 'Monthly Test Progress',
                      value: _monthlyAvg,
                      color: const Color(0xFF7C3AED)),
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
                  const Text('Assessment Mix',
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  _MixRow(
                      label: 'Quiz',
                      count: quizCount,
                      total: _assessmentCount,
                      color: AgoraTheme.primaryColor),
                  const SizedBox(height: 8),
                  _MixRow(
                      label: 'Monthly',
                      count: monthlyCount,
                      total: _assessmentCount,
                      color: AgoraTheme.warning),
                  const SizedBox(height: 8),
                  _MixRow(
                      label: 'Final',
                      count: finalCount,
                      total: _assessmentCount,
                      color: AgoraTheme.danger),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _TypeChip(
                    label: 'All',
                    selected: _selectedType == 'all',
                    onTap: () => setState(() => _selectedType = 'all')),
                const SizedBox(width: 8),
                _TypeChip(
                    label: 'Quiz',
                    selected: _selectedType == 'quiz',
                    onTap: () => setState(() => _selectedType = 'quiz')),
                const SizedBox(width: 8),
                _TypeChip(
                    label: 'Assignment',
                    selected: _selectedType == 'assignment',
                    onTap: () => setState(() => _selectedType = 'assignment')),
                const SizedBox(width: 8),
                _TypeChip(
                    label: 'Monthly',
                    selected: _selectedType == 'monthly',
                    onTap: () => setState(() => _selectedType = 'monthly')),
                const SizedBox(width: 8),
                _TypeChip(
                    label: 'Final',
                    selected: _selectedType == 'final',
                    onTap: () => setState(() => _selectedType = 'final')),
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
                    Icon(Icons.bar_chart_rounded,
                        size: 44, color: AgoraTheme.textMuted),
                    SizedBox(height: 10),
                    Text('No assessments in this filter',
                        style: TextStyle(color: AgoraTheme.textSecondary)),
                  ],
                ),
              ),
            )
          else
            ...visible.map((a) {
              final color = _typeColor(a.assessmentType);
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Center(
                          child: Text(
                            '${a.maxMarks.toInt()}',
                            style: TextStyle(
                                color: color, fontWeight: FontWeight.w800),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(a.title,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: color.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(99),
                                  ),
                                  child: Text(
                                    a.assessmentType.toUpperCase(),
                                    style: TextStyle(
                                        color: color,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w700),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  a.assessmentDate ?? 'No date',
                                  style: const TextStyle(
                                      fontSize: 12,
                                      color: AgoraTheme.textMuted),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          if (!_loading && recent.isNotEmpty) ...[
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Monthly Test Report',
                        style: TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    ...recent.take(5).map((a) {
                      final typeColor = _typeColor(a.assessmentType);
                      final pseudoPercent =
                          (a.maxMarks * 4).clamp(0, 100).toDouble();
                      final label = a.assessmentDate ?? a.title;

                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          children: [
                            Expanded(
                              flex: 4,
                              child: Text(
                                label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              flex: 5,
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(99),
                                child: LinearProgressIndicator(
                                  value: (pseudoPercent / 100).clamp(0.0, 1.0),
                                  minHeight: 7,
                                  valueColor:
                                      AlwaysStoppedAnimation<Color>(typeColor),
                                  backgroundColor:
                                      typeColor.withValues(alpha: 0.12),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            SizedBox(
                              width: 42,
                              child: Text(
                                '${pseudoPercent.toStringAsFixed(0)}%',
                                textAlign: TextAlign.right,
                                style: const TextStyle(
                                    fontSize: 12, fontWeight: FontWeight.w700),
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
        ],
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  final String title;
  final String value;
  final String suffix;
  final IconData icon;
  final Color color;

  const _MetricTile({
    required this.title,
    required this.value,
    required this.suffix,
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
          RichText(
            text: TextSpan(
              style: TextStyle(
                  color: color, fontWeight: FontWeight.w800, fontSize: 19),
              children: [
                TextSpan(text: value),
                if (suffix.isNotEmpty)
                  TextSpan(text: suffix, style: const TextStyle(fontSize: 12)),
              ],
            ),
          ),
          Text(title,
              style:
                  const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _ProgressLine extends StatelessWidget {
  final String label;
  final double value;
  final Color color;

  const _ProgressLine(
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
                      fontSize: 13, fontWeight: FontWeight.w600)),
            ),
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

class _MixRow extends StatelessWidget {
  final String label;
  final int count;
  final int total;
  final Color color;

  const _MixRow(
      {required this.label,
      required this.count,
      required this.total,
      required this.color});

  @override
  Widget build(BuildContext context) {
    final safeTotal = total == 0 ? 1 : total;
    final pct = (count * 100 / safeTotal).clamp(0.0, 100.0);

    return Row(
      children: [
        SizedBox(
            width: 70,
            child: Text(label,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 12.5))),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: (pct / 100).clamp(0.0, 1.0),
              minHeight: 7,
              valueColor: AlwaysStoppedAnimation<Color>(color),
              backgroundColor: color.withValues(alpha: 0.14),
            ),
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          width: 44,
          child: Text('${pct.toStringAsFixed(0)}%',
              textAlign: TextAlign.right,
              style:
                  const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        ),
      ],
    );
  }
}

class _TypeChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _TypeChip(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF4F46E5) : Colors.white,
          borderRadius: BorderRadius.circular(99),
          border: Border.all(
              color: selected ? const Color(0xFF4F46E5) : AgoraTheme.border),
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
