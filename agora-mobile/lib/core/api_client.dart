import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

class ApiException implements Exception {
  final int statusCode;
  final String code;
  final String message;

  ApiException(this.statusCode, this.code, this.message);

  @override
  String toString() => message;
}

class ApiClient {
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;
  ApiClient._internal();

  final String _baseUrl = AppConfig.apiBaseUrl;
  String? _accessToken;
  String? _refreshToken;
  Future<bool>? _refreshInFlight;

  String? get accessToken => _accessToken;
  bool get hasToken => _accessToken != null;

  Future<void> loadTokens() async {
    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString('access_token');
    _refreshToken = prefs.getString('refresh_token');
  }

  Future<void> saveTokens(String access, String refresh) async {
    _accessToken = access;
    _refreshToken = refresh;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('access_token', access);
    await prefs.setString('refresh_token', refresh);
  }

  Future<void> clearTokens() async {
    _accessToken = null;
    _refreshToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('access_token');
    await prefs.remove('refresh_token');
    await prefs.remove('user_data');
  }

  Map<String, String> get _headers {
    final h = <String, String>{'Content-Type': 'application/json'};
    if (_accessToken != null) {
      h['Authorization'] = 'Bearer $_accessToken';
    }
    return h;
  }

  Future<Map<String, dynamic>> get(String endpoint, {Map<String, String>? params}) async {
    final uri = Uri.parse('$_baseUrl$endpoint').replace(queryParameters: params);
    return _sendWithRefresh(() => http.get(uri, headers: _headers));
  }

  Future<Map<String, dynamic>> post(String endpoint, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$_baseUrl$endpoint');
    return _sendWithRefresh(
      () => http.post(uri, headers: _headers, body: body != null ? jsonEncode(body) : null),
    );
  }

  Future<Map<String, dynamic>> patch(String endpoint, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$_baseUrl$endpoint');
    return _sendWithRefresh(
      () => http.patch(uri, headers: _headers, body: body != null ? jsonEncode(body) : null),
    );
  }

  Future<Map<String, dynamic>> delete(String endpoint) async {
    final uri = Uri.parse('$_baseUrl$endpoint');
    return _sendWithRefresh(() => http.delete(uri, headers: _headers));
  }

  Future<Map<String, dynamic>> _sendWithRefresh(
    Future<http.Response> Function() request,
  ) async {
    final response = await request();
    if (response.statusCode == 401) {
      final refreshed = await _tryRefreshToken();
      if (refreshed) {
        final retryResponse = await request();
        return _handleResponse(retryResponse);
      }
    }
    return _handleResponse(response);
  }

  Future<bool> _tryRefreshToken() async {
    if (_refreshToken == null || _refreshToken!.isEmpty) {
      return false;
    }
    if (_refreshInFlight != null) {
      return _refreshInFlight!;
    }
    _refreshInFlight = _refreshAccessTokenInternal();
    final result = await _refreshInFlight!;
    _refreshInFlight = null;
    return result;
  }

  Future<bool> _refreshAccessTokenInternal() async {
    final refreshToken = _refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      return false;
    }

    final uri = Uri.parse('$_baseUrl/auth/refresh');
    try {
      final response = await http.post(
        uri,
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({'refresh_token': refreshToken}),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        await clearTokens();
        return false;
      }

      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final data = body['data'] as Map<String, dynamic>? ?? {};
      final newAccessToken = data['access_token']?.toString() ?? '';
      final newRefreshToken = data['refresh_token']?.toString() ?? refreshToken;

      if (newAccessToken.isEmpty) {
        await clearTokens();
        return false;
      }

      await saveTokens(newAccessToken, newRefreshToken);
      return true;
    } catch (_) {
      await clearTokens();
      return false;
    }
  }

  Map<String, dynamic> _handleResponse(http.Response response) {
    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return body;
    }

    final error = body['error'] as Map<String, dynamic>? ?? {};
    throw ApiException(
      response.statusCode,
      error['code']?.toString() ?? 'UNKNOWN',
      error['message']?.toString() ?? 'Request failed',
    );
  }
}
