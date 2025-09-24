# Pdf (React Native / Expo)

تطبيق ماسح PDF بسيط يعمل أوفلاين.

## أوامر
- تشغيل: `npm start`
- أندرويد (محلي): `npm run android`
- بناء AAB:
  1) إن لم يوجد مجلد `android/`: `npx expo prebuild --platform android`
  2) `cd android && ./gradlew bundleRelease` (الناتج: `app/build/outputs/bundle/release/app-release.aab`)

## النشر على Google Play
- `android.package`: `com.codecsverige.pdf` (مضبوط في `app.json`).
- ارفع ملف `.aab` في Play Console (Internal → Production).
