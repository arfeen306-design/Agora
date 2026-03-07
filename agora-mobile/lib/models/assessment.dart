class Assessment {
  final String id;
  final String classroomId;
  final String? subjectId;
  final String title;
  final String assessmentType;
  final double maxMarks;
  final String? assessmentDate;

  Assessment({
    required this.id,
    required this.classroomId,
    this.subjectId,
    required this.title,
    required this.assessmentType,
    required this.maxMarks,
    this.assessmentDate,
  });

  factory Assessment.fromJson(Map<String, dynamic> json) {
    return Assessment(
      id: json['id'] as String,
      classroomId: json['classroom_id'] as String,
      subjectId: json['subject_id'] as String?,
      title: json['title'] as String,
      assessmentType: json['assessment_type'] as String,
      maxMarks: (json['max_marks'] as num).toDouble(),
      assessmentDate: json['assessment_date'] as String?,
    );
  }
}

class AssessmentScore {
  final String id;
  final String assessmentId;
  final String studentId;
  final double marksObtained;
  final String? remarks;

  AssessmentScore({
    required this.id,
    required this.assessmentId,
    required this.studentId,
    required this.marksObtained,
    this.remarks,
  });

  factory AssessmentScore.fromJson(Map<String, dynamic> json) {
    return AssessmentScore(
      id: json['id'] as String,
      assessmentId: json['assessment_id'] as String,
      studentId: json['student_id'] as String,
      marksObtained: (json['marks_obtained'] as num).toDouble(),
      remarks: json['remarks'] as String?,
    );
  }
}
