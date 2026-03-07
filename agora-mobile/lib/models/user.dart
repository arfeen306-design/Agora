class User {
  final String id;
  final String schoolId;
  final String firstName;
  final String? lastName;
  final String email;
  final List<String> roles;

  User({
    required this.id,
    required this.schoolId,
    required this.firstName,
    this.lastName,
    required this.email,
    required this.roles,
  });

  String get fullName => [firstName, lastName].where((s) => s != null && s.isNotEmpty).join(' ');
  String get initials => firstName.isNotEmpty ? firstName[0].toUpperCase() : '?';
  bool get isParent => roles.contains('parent');
  bool get isStudent => roles.contains('student');

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      schoolId: json['school_id'] as String,
      firstName: json['first_name'] as String,
      lastName: json['last_name'] as String?,
      email: json['email'] as String,
      roles: (json['roles'] as List<dynamic>).map((r) => r.toString()).toList(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'school_id': schoolId,
    'first_name': firstName,
    'last_name': lastName,
    'email': email,
    'roles': roles,
  };
}
