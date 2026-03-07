class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8080/api/v1', // Android emulator -> localhost
  );

  // For iOS simulator, use: http://localhost:8080/api/v1
  // For physical device, use your machine's LAN IP: http://192.168.x.x:8080/api/v1
}
