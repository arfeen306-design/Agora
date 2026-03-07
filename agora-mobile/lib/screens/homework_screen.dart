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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    try {
      final res = await _api.get('/homework', params: {
        'page': '$_page',
        'page_size': '20',
      });
      final data = res['data'] as List<dynamic>;
      final meta = res['meta'] as Map<String, dynamic>?;
      final pagination = meta?['pagination'] as Map<String, dynamic>?;
      setState(() {
        _items = data.map((j) => Homework.fromJson(j as Map<String, dynamic>)).toList();
        _totalPages = (pagination?['total_pages'] as int?) ?? 1;
        _loading = false;
      });
    } catch (_) {
      setState(() { _items = []; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.menu_book, size: 48, color: AgoraTheme.textMuted),
                      SizedBox(height: 12),
                      Text('No homework assigned', style: TextStyle(color: AgoraTheme.textSecondary, fontSize: 16)),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(20),
                  itemCount: _items.length + (_totalPages > _page ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (index == _items.length) {
                      return Center(
                        child: TextButton(
                          onPressed: () { _page++; _load(); },
                          child: const Text('Load More'),
                        ),
                      );
                    }

                    final hw = _items[index];
                    final dueDate = hw.dueAt != null ? DateTime.tryParse(hw.dueAt!) : null;
                    final isOverdue = hw.isOverdue;

                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Title row
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    hw.title,
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                                  ),
                                ),
                                if (isOverdue)
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AgoraTheme.dangerLight,
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: const Text('Overdue', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AgoraTheme.danger)),
                                  ),
                              ],
                            ),

                            // Description
                            if (hw.description != null && hw.description!.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Text(
                                hw.description!,
                                style: const TextStyle(fontSize: 14, color: AgoraTheme.textSecondary),
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],

                            const SizedBox(height: 12),
                            const Divider(height: 1),
                            const SizedBox(height: 12),

                            // Meta
                            Row(
                              children: [
                                const Icon(Icons.calendar_today, size: 14, color: AgoraTheme.textMuted),
                                const SizedBox(width: 4),
                                Text(
                                  'Assigned: ${DateFormat('MMM d').format(DateTime.parse(hw.assignedAt))}',
                                  style: const TextStyle(fontSize: 12, color: AgoraTheme.textSecondary),
                                ),
                                const Spacer(),
                                if (dueDate != null) ...[
                                  Icon(
                                    Icons.access_time,
                                    size: 14,
                                    color: isOverdue ? AgoraTheme.danger : AgoraTheme.textMuted,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    'Due: ${DateFormat('MMM d').format(dueDate)}',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: isOverdue ? AgoraTheme.danger : AgoraTheme.textSecondary,
                                      fontWeight: isOverdue ? FontWeight.w600 : FontWeight.normal,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
