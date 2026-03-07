import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../providers/auth_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _schoolCodeCtrl = TextEditingController(text: 'agora_demo');
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _loading = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void dispose() {
    _schoolCodeCtrl.dispose();
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _error = null; });

    try {
      await context.read<AuthProvider>().login(
        _schoolCodeCtrl.text.trim(),
        _emailCtrl.text.trim(),
        _passwordCtrl.text,
      );
    } catch (e) {
      setState(() { _error = e.toString(); });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  void _fillDemo(String email, String password) {
    _emailCtrl.text = email;
    _passwordCtrl.text = password;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 40),

              // Logo
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: AgoraTheme.primaryColor,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Center(
                  child: Text('A', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white)),
                ),
              ),
              const SizedBox(height: 24),

              const Text('Welcome to Agora', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              const Text('Sign in to access your dashboard', style: TextStyle(fontSize: 16, color: AgoraTheme.textSecondary)),
              const SizedBox(height: 32),

              // Error
              if (_error != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: AgoraTheme.dangerLight,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AgoraTheme.danger.withValues(alpha: 0.3)),
                  ),
                  child: Text(_error!, style: const TextStyle(color: AgoraTheme.danger, fontSize: 14)),
                ),

              // Form
              Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('School Code', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    TextFormField(
                      controller: _schoolCodeCtrl,
                      decoration: const InputDecoration(hintText: 'e.g. agora_demo', prefixIcon: Icon(Icons.school_outlined)),
                      validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                    ),
                    const SizedBox(height: 16),

                    const Text('Email', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    TextFormField(
                      controller: _emailCtrl,
                      decoration: const InputDecoration(hintText: 'your@email.com', prefixIcon: Icon(Icons.email_outlined)),
                      keyboardType: TextInputType.emailAddress,
                      validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                    ),
                    const SizedBox(height: 16),

                    const Text('Password', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    TextFormField(
                      controller: _passwordCtrl,
                      obscureText: _obscurePassword,
                      decoration: InputDecoration(
                        hintText: 'Enter your password',
                        prefixIcon: const Icon(Icons.lock_outlined),
                        suffixIcon: IconButton(
                          icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() { _obscurePassword = !_obscurePassword; }),
                        ),
                      ),
                      validator: (v) => v == null || v.isEmpty ? 'Required' : null,
                    ),
                    const SizedBox(height: 24),

                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _loading ? null : _login,
                        child: _loading
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                            : const Text('Sign In'),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 32),

              // Demo credentials
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AgoraTheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AgoraTheme.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Demo Credentials', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AgoraTheme.textSecondary)),
                    const SizedBox(height: 8),
                    _DemoButton(label: 'Parent', email: 'parent1@agora.com', password: 'pass123', onTap: _fillDemo),
                    const SizedBox(height: 6),
                    _DemoButton(label: 'Student', email: 'student1@agora.com', password: 'student123', onTap: _fillDemo),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DemoButton extends StatelessWidget {
  final String label;
  final String email;
  final String password;
  final void Function(String, String) onTap;

  const _DemoButton({required this.label, required this.email, required this.password, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onTap(email, password),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AgoraTheme.primaryLight,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AgoraTheme.primaryColor)),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text('$email / $password', style: const TextStyle(fontSize: 12, color: AgoraTheme.textSecondary))),
            const Icon(Icons.arrow_forward_ios, size: 12, color: AgoraTheme.textMuted),
          ],
        ),
      ),
    );
  }
}
