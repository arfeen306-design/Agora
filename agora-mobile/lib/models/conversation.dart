class Conversation {
  final String id;
  final String kind;
  final String? title;
  final String createdAt;

  Conversation({
    required this.id,
    required this.kind,
    this.title,
    required this.createdAt,
  });

  String get displayTitle => title ?? kind;

  factory Conversation.fromJson(Map<String, dynamic> json) {
    return Conversation(
      id: json['id'] as String,
      kind: json['kind'] as String,
      title: json['title'] as String?,
      createdAt: json['created_at'] as String,
    );
  }
}

class Message {
  final String id;
  final String senderUserId;
  final String kind;
  final String? body;
  final String sentAt;

  Message({
    required this.id,
    required this.senderUserId,
    required this.kind,
    this.body,
    required this.sentAt,
  });

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: json['id'] as String,
      senderUserId: json['sender_user_id'] as String,
      kind: json['kind'] as String,
      body: json['body'] as String?,
      sentAt: json['sent_at'] as String,
    );
  }
}
