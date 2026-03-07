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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    try {
      final res = await _api.get('/assessments', params: {'page_size': '50'});
      final data = res['data'] as List<dynamic>;
      setState(() {
        _assessments = data.map((j) => Assessment.fromJson(j as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (_) {
      setState(() { _assessments = []; _loading = false; });
    }
  }

  Color _typeColor(String type) {
    switch (type) {
      case 'quiz': return AgoraTheme.primaryColor;
      case 'assignment': return AgoraTheme.success;
      case 'monthly': return AgoraTheme.warning;
      case 'term': return Colors.purple;
      case 'final': return AgoraTheme.danger;
      default: return AgoraTheme.textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _assessments.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.bar_chart, size: 48, color: AgoraTheme.textMuted),
                      SizedBox(height: 12),
                      Text('No assessments yet', style: TextStyle(color: AgoraTheme.textSecondary, fontSize: 16)),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(20),
                  itemCount: _assessments.length,
                  itemBuilder: (context, index) {
                    final a = _assessments[index];
                    final color = _typeColor(a.assessmentType);

                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        leading: Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Center(
                            child: Text(
                              '${a.maxMarks.toInt()}',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color),
                            ),
                          ),
                        ),
                        title: Text(a.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: color.withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Text(
                                    a.assessmentType.toUpperCase(),
                                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color),
                                  ),
                                ),
                                if (a.assessmentDate != null) ...[
                                  const SizedBox(width: 8),
                                  Text(a.assessmentDate!, style: const TextStyle(fontSize: 12, color: AgoraTheme.textMuted)),
                                ],
                              ],
                            ),
                          ],
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text('Max', style: TextStyle(fontSize: 10, color: AgoraTheme.textMuted)),
                            Text('${a.maxMarks.toInt()}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
