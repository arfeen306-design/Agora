class Homework {
  final String id;
  final String classroomId;
  final String? subjectId;
  final String title;
  final String? description;
  final String assignedAt;
  final String? dueAt;
  final bool isPublished;

  Homework({
    required this.id,
    required this.classroomId,
    this.subjectId,
    required this.title,
    this.description,
    required this.assignedAt,
    this.dueAt,
    required this.isPublished,
  });

  bool get isOverdue {
    if (dueAt == null) return false;
    return DateTime.tryParse(dueAt!)?.isBefore(DateTime.now()) ?? false;
  }

  factory Homework.fromJson(Map<String, dynamic> json) {
    return Homework(
      id: json['id'] as String,
      classroomId: json['classroom_id'] as String,
      subjectId: json['subject_id'] as String?,
      title: json['title'] as String,
      description: json['description'] as String?,
      assignedAt: json['assigned_at'] as String,
      dueAt: json['due_at'] as String?,
      isPublished: json['is_published'] as bool? ?? true,
    );
  }
}
