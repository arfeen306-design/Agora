class AttendanceRecord {
  final String id;
  final String studentId;
  final String classroomId;
  final String attendanceDate;
  final String status; // present, absent, late, leave
  final String? checkInAt;
  final String source;
  final String? note;

  AttendanceRecord({
    required this.id,
    required this.studentId,
    required this.classroomId,
    required this.attendanceDate,
    required this.status,
    this.checkInAt,
    required this.source,
    this.note,
  });

  bool get isPresent => status == 'present';
  bool get isAbsent => status == 'absent';
  bool get isLate => status == 'late';

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    return AttendanceRecord(
      id: json['id'] as String,
      studentId: json['student_id'] as String,
      classroomId: json['classroom_id'] as String,
      attendanceDate: json['attendance_date'] as String,
      status: json['status'] as String,
      checkInAt: json['check_in_at'] as String?,
      source: json['source'] as String? ?? 'manual',
      note: json['note'] as String?,
    );
  }
}
