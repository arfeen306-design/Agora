import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/theme.dart';
import '../models/conversation.dart';
import '../providers/auth_provider.dart';

class MessagingScreen extends StatefulWidget {
  const MessagingScreen({super.key});

  @override
  State<MessagingScreen> createState() => _MessagingScreenState();
}

class _MessagingScreenState extends State<MessagingScreen> {
  final _api = ApiClient();

  List<Conversation> _conversations = [];
  bool _loading = true;
  String _search = '';
  String _kindFilter = 'all';

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
      final res =
          await _api.get('/conversations', params: {'page_size': '100'});
      final data = res['data'] as List<dynamic>;

      if (!mounted) return;
      setState(() {
        _conversations = data
            .map((j) => Conversation.fromJson(j as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _conversations = [];
        _loading = false;
      });
    }
  }

  List<Conversation> _visibleConversations() {
    final q = _search.trim().toLowerCase();
    return _conversations.where((conv) {
      if (_kindFilter != 'all' && conv.kind != _kindFilter) return false;
      if (q.isEmpty) return true;
      return conv.displayTitle.toLowerCase().contains(q) ||
          conv.kind.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleConversations();

    final directCount =
        _conversations.where((conv) => conv.kind == 'direct').length;
    final groupCount =
        _conversations.where((conv) => conv.kind == 'group').length;

    final thisWeekCount = _conversations.where((conv) {
      final dt = DateTime.tryParse(conv.createdAt);
      if (dt == null) return false;
      return DateTime.now().difference(dt).inDays <= 7;
    }).length;

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
                colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
              ),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Messaging Center',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'Parent-teacher communication with cleaner chat flow',
                  style: TextStyle(color: Color(0xE6FFFFFF), fontSize: 13.5),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _MiniMetric(
                  title: 'Conversations',
                  value: '${_conversations.length}',
                  icon: Icons.forum_rounded,
                  color: AgoraTheme.primaryColor,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MiniMetric(
                  title: 'Direct',
                  value: '$directCount',
                  icon: Icons.person_rounded,
                  color: AgoraTheme.success,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MiniMetric(
                  title: 'This Week',
                  value: '$thisWeekCount',
                  icon: Icons.schedule_rounded,
                  color: AgoraTheme.warning,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(
              hintText: 'Search conversations',
              prefixIcon: Icon(Icons.search_rounded),
            ),
            onChanged: (value) => setState(() => _search = value),
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _KindChip(
                  label: 'All',
                  selected: _kindFilter == 'all',
                  onTap: () => setState(() => _kindFilter = 'all'),
                ),
                const SizedBox(width: 8),
                _KindChip(
                  label: 'Direct',
                  selected: _kindFilter == 'direct',
                  onTap: () => setState(() => _kindFilter = 'direct'),
                ),
                const SizedBox(width: 8),
                _KindChip(
                  label: 'Group',
                  selected: _kindFilter == 'group',
                  onTap: () => setState(() => _kindFilter = 'group'),
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
                    Icon(Icons.chat_bubble_outline_rounded,
                        size: 44, color: AgoraTheme.textMuted),
                    SizedBox(height: 10),
                    Text(
                      'No conversations found',
                      style: TextStyle(color: AgoraTheme.textSecondary),
                    ),
                  ],
                ),
              ),
            )
          else
            ...visible.map((conv) {
              final kindColor = conv.kind == 'direct'
                  ? AgoraTheme.success
                  : AgoraTheme.primaryColor;

              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  leading: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: kindColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      conv.kind == 'direct'
                          ? Icons.person_rounded
                          : Icons.groups_rounded,
                      color: kindColor,
                    ),
                  ),
                  title: Text(
                    conv.displayTitle,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    '${conv.kind.toUpperCase()} • ${DateFormat('MMM d').format(DateTime.parse(conv.createdAt))}',
                    style: const TextStyle(
                        fontSize: 12.5, color: AgoraTheme.textSecondary),
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded,
                      color: AgoraTheme.textMuted),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => _ChatScreen(conversation: conv),
                      ),
                    );
                  },
                ),
              );
            }),
          if (!_loading && groupCount > 0)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                '$groupCount group conversation(s) available',
                style:
                    const TextStyle(fontSize: 12, color: AgoraTheme.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}

class _ChatScreen extends StatefulWidget {
  final Conversation conversation;
  const _ChatScreen({required this.conversation});

  @override
  State<_ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<_ChatScreen> {
  final _api = ApiClient();
  final _messageCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  List<Message> _messages = [];
  bool _loading = true;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _loadMessages();
  }

  @override
  void dispose() {
    _messageCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMessages() async {
    try {
      final res = await _api.get(
          '/conversations/${widget.conversation.id}/messages',
          params: {'page_size': '100'});
      final data = res['data'] as List<dynamic>;

      if (!mounted) return;
      setState(() {
        _messages = data
            .map((j) => Message.fromJson(j as Map<String, dynamic>))
            .toList()
            .reversed
            .toList();
        _loading = false;
      });
      _scrollToBottom();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _messages = [];
        _loading = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send() async {
    final text = _messageCtrl.text.trim();
    if (text.isEmpty) return;

    setState(() {
      _sending = true;
    });

    try {
      await _api.post('/conversations/${widget.conversation.id}/messages',
          body: {'body': text});
      _messageCtrl.clear();
      await _loadMessages();
    } catch (_) {
      // ignore
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final userId = context.read<AuthProvider>().user?.id;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.conversation.displayTitle),
        titleTextStyle: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: AgoraTheme.textPrimary,
        ),
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            margin: const EdgeInsets.fromLTRB(12, 8, 12, 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AgoraTheme.primaryLight.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Icon(
                  widget.conversation.kind == 'direct'
                      ? Icons.person_rounded
                      : Icons.groups_rounded,
                  color: AgoraTheme.primaryColor,
                  size: 18,
                ),
                const SizedBox(width: 8),
                Text(
                  '${widget.conversation.kind.toUpperCase()} conversation',
                  style: const TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          Expanded(
            child: Container(
              color: const Color(0xFFF8FAFC),
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _messages.isEmpty
                      ? const Center(
                          child: Text(
                            'No messages yet',
                            style: TextStyle(color: AgoraTheme.textMuted),
                          ),
                        )
                      : ListView.builder(
                          controller: _scrollCtrl,
                          padding: const EdgeInsets.all(14),
                          itemCount: _messages.length,
                          itemBuilder: (context, index) {
                            final msg = _messages[index];
                            final isMe = msg.senderUserId == userId;

                            return Align(
                              alignment: isMe
                                  ? Alignment.centerRight
                                  : Alignment.centerLeft,
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 9),
                                constraints: BoxConstraints(
                                  maxWidth:
                                      MediaQuery.of(context).size.width * 0.75,
                                ),
                                decoration: BoxDecoration(
                                  color: isMe
                                      ? AgoraTheme.primaryColor
                                      : Colors.white,
                                  borderRadius: BorderRadius.only(
                                    topLeft: const Radius.circular(14),
                                    topRight: const Radius.circular(14),
                                    bottomLeft: Radius.circular(isMe ? 14 : 4),
                                    bottomRight: Radius.circular(isMe ? 4 : 14),
                                  ),
                                  border: isMe
                                      ? null
                                      : Border.all(color: AgoraTheme.border),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      msg.body ?? '',
                                      style: TextStyle(
                                        fontSize: 14,
                                        color: isMe
                                            ? Colors.white
                                            : AgoraTheme.textPrimary,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      DateFormat.jm()
                                          .format(DateTime.parse(msg.sentAt)),
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        color: isMe
                                            ? Colors.white70
                                            : AgoraTheme.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: AgoraTheme.border)),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _messageCtrl,
                      decoration: const InputDecoration(
                        hintText: 'Type a message...',
                        prefixIcon: Icon(Icons.chat_bubble_outline_rounded),
                      ),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 42,
                    height: 42,
                    child: ElevatedButton(
                      onPressed: _sending ? null : _send,
                      style: ElevatedButton.styleFrom(
                        padding: EdgeInsets.zero,
                        shape: const CircleBorder(),
                      ),
                      child: _sending
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(Icons.send_rounded, size: 18),
                    ),
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

class _MiniMetric extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _MiniMetric({
    required this.title,
    required this.value,
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
          Text(
            value,
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.w800, color: color),
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

class _KindChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _KindChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

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
            color: selected ? AgoraTheme.primaryColor : AgoraTheme.border,
          ),
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
