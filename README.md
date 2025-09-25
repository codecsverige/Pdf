# Pdf (React Native / Expo)

تطبيق ماسح PDF يعمل أوفلاين، مع ضغط صور، مشاركة، وإتاحة الترقية المدفوعة.

## الأوامر
- تشغيل محلي: `npm install && npm start`
- أندرويد: `npm run android` (قد يتطلب `npx expo prebuild --platform android` أول مرة)
- ويب: `npm run web`

## البناء والنشر
1) إن لم يوجد مجلد android/ و ios/:
   - `npx expo prebuild --platform android`
2) أندرويد (AAB):
   - `cd android && ./gradlew bundleRelease`
   - الناتج: `android/app/build/outputs/bundle/release/app-release.aab`
3) النشر إلى Google Play: ارفع ملف AAB واضبط بيانات المتجر.

## الربحية
- الشراء داخل التطبيق عبر RevenueCat (ضع المفاتيح في `app.json > expo.extra`).
- الإعلانات عبر Google Mobile Ads (مع App IDs التجريبية الافتراضية). استبدلها بمعرّفاتك قبل الإصدار.

## المزايا
- اختيار صور متعددة
- ضغط الصور قبل التضمين
- إنشاء وحفظ ومشاركة PDF
- إعلان بنر للمستخدمين المجانيين، وترقية لإزالة الإعلانات وفتح الميزات
