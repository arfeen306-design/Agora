import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api_client.dart';
import '../models/user.dart';

class AuthProvider extends ChangeNotifier {
  final ApiClient _api = ApiClient();
  User? _user;
  bool _isLoading = true;

  User? get user => _user;
  bool get isLoading => _isLoading;
  bool get isLoggedIn => _user != null && _api.hasToken;

  Future<void> tryAutoLogin() async {
    _isLoading = true;
    notifyListeners();

    try {
      await _api.loadTokens();
      if (!_api.hasToken) {
        _isLoading = false;
        notifyListeners();
        return;
      }

      // Try loading cached user first
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString('user_data');
      if (cached != null) {
        _user = User.fromJson(jsonDecode(cached));
      }

      // Validate with server
      final res = await _api.get('/auth/me');
      _user = User.fromJson(res['data']);
      await prefs.setString('user_data', jsonEncode(_user!.toJson()));
    } catch (_) {
      _user = null;
      await _api.clearTokens();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> login(String schoolCode, String email, String password) async {
    final res = await _api.post('/auth/login', body: {
      'school_code': schoolCode,
      'email': email,
      'password': password,
    });

    final data = res['data'] as Map<String, dynamic>;
    await _api.saveTokens(
      data['access_token'] as String,
      data['refresh_token'] as String,
    );

    _user = User.fromJson(data['user']);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_data', jsonEncode(_user!.toJson()));

    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await _api.post('/auth/logout', body: {
        'refresh_token': (await SharedPreferences.getInstance()).getString('refresh_token') ?? '',
      });
    } catch (_) {
      // ignore
    }
    _user = null;
    await _api.clearTokens();
    notifyListeners();
  }
}
