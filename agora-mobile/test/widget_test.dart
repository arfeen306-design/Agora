import 'package:flutter_test/flutter_test.dart';
import 'package:agora_mobile/main.dart';

void main() {
  testWidgets('App renders splash screen', (WidgetTester tester) async {
    await tester.pumpWidget(const AgoraApp());
    expect(find.text('Agora'), findsOneWidget);
  });
}
