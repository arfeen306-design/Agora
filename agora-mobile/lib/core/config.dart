import 'package:flutter/foundation.dart';

class AppConfig {
  static String get apiBaseUrl {
    const fromEnv = String.fromEnvironment('API_BASE_URL', defaultValue: '');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (kIsWeb) return 'http://127.0.0.1:8080/api/v1';
    return 'http://10.0.2.2:8080/api/v1';
  }
}
