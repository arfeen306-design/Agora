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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    try {
      final res = await _api.get('/conversations', params: {'page_size': '50'});
      final data = res['data'] as List<dynamic>;
      setState(() {
        _conversations = data.map((j) => Conversation.fromJson(j as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (_) {
      setState(() { _conversations = []; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _conversations.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.chat_bubble_outline, size: 48, color: AgoraTheme.textMuted),
                      SizedBox(height: 12),
                      Text('No conversations yet', style: TextStyle(color: AgoraTheme.textSecondary, fontSize: 16)),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(20),
                  itemCount: _conversations.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 1),
                  itemBuilder: (context, index) {
                    final conv = _conversations[index];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: AgoraTheme.primaryLight,
                          child: Icon(
                            conv.kind == 'direct' ? Icons.person : Icons.group,
                            color: AgoraTheme.primaryColor,
                            size: 20,
                          ),
                        ),
                        title: Text(conv.displayTitle, style: const TextStyle(fontWeight: FontWeight.w500)),
                        subtitle: Text(
                          '${conv.kind} conversation',
                          style: const TextStyle(fontSize: 12, color: AgoraTheme.textMuted),
                        ),
                        trailing: Text(
                          DateFormat('MMM d').format(DateTime.parse(conv.createdAt)),
                          style: const TextStyle(fontSize: 12, color: AgoraTheme.textMuted),
                        ),
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => _ChatScreen(conversation: conv)),
                          );
                        },
                      ),
                    );
                  },
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
      final res = await _api.get('/conversations/${widget.conversation.id}/messages', params: {'page_size': '100'});
      final data = res['data'] as List<dynamic>;
      setState(() {
        _messages = data.map((j) => Message.fromJson(j as Map<String, dynamic>)).toList().reversed.toList();
        _loading = false;
      });
      _scrollToBottom();
    } catch (_) {
      setState(() { _messages = []; _loading = false; });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send() async {
    final text = _messageCtrl.text.trim();
    if (text.isEmpty) return;
    setState(() { _sending = true; });
    try {
      await _api.post('/conversations/${widget.conversation.id}/messages', body: {'body': text});
      _messageCtrl.clear();
      await _loadMessages();
    } catch (_) {
      // ignore
    } finally {
      if (mounted) setState(() { _sending = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final userId = context.read<AuthProvider>().user?.id;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.conversation.displayTitle),
        titleTextStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraTheme.textPrimary),
      ),
      body: Column(
        children: [
          // Messages
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? const Center(child: Text('No messages yet', style: TextStyle(color: AgoraTheme.textMuted)))
                    : ListView.builder(
                        controller: _scrollCtrl,
                        padding: const EdgeInsets.all(16),
                        itemCount: _messages.length,
                        itemBuilder: (context, index) {
                          final msg = _messages[index];
                          final isMe = msg.senderUserId == userId;

                          return Align(
                            alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                              decoration: BoxDecoration(
                                color: isMe ? AgoraTheme.primaryColor : Colors.white,
                                borderRadius: BorderRadius.only(
                                  topLeft: const Radius.circular(16),
                                  topRight: const Radius.circular(16),
                                  bottomLeft: Radius.circular(isMe ? 16 : 4),
                                  bottomRight: Radius.circular(isMe ? 4 : 16),
                                ),
                                border: isMe ? null : Border.all(color: AgoraTheme.border),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    msg.body ?? '',
                                    style: TextStyle(fontSize: 14, color: isMe ? Colors.white : AgoraTheme.textPrimary),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    DateFormat.jm().format(DateTime.parse(msg.sentAt)),
                                    style: TextStyle(fontSize: 10, color: isMe ? Colors.white60 : AgoraTheme.textMuted),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),

          // Input
          Container(
            padding: const EdgeInsets.all(12),
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
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(horizontal: 16),
                      ),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 44,
                    height: 44,
                    child: ElevatedButton(
                      onPressed: _sending ? null : _send,
                      style: ElevatedButton.styleFrom(padding: EdgeInsets.zero, shape: const CircleBorder()),
                      child: _sending
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Icon(Icons.send, size: 18),
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
