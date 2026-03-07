class NotificationItem {
  final String id;
  final String title;
  final String body;
  final String channel;
  final String status;
  final String? readAt;
  final String createdAt;

  NotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.channel,
    required this.status,
    this.readAt,
    required this.createdAt,
  });

  bool get isRead => readAt != null || status == 'read';

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    return NotificationItem(
      id: json['id'] as String,
      title: json['title'] as String,
      body: json['body'] as String,
      channel: json['channel'] as String? ?? 'in_app',
      status: json['status'] as String,
      readAt: json['read_at'] as String?,
      createdAt: json['created_at'] as String,
    );
  }
}
