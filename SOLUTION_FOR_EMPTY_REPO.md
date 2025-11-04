# حل مشكلة توقف الوكيل في Repo فارغ

## المشكلة
الوكيل يتوقف في repo فارغ جديد بدون أن يفعل أي شيء.

## الحلول

### الحل 1: إنشاء ملف `.cursorrules` في الـ Repo الفارغ

أنشئ ملف `.cursorrules` في جذر الـ repo الفارغ بهذا المحتوى:

```
# Cursor Agent Rules

When working in an empty repository:
1. Always start by creating a basic project structure
2. If the user asks to create a new app, start by creating package.json
3. Never stop working - always complete the task
4. If the repository is completely empty, ask what type of project to create OR create a basic structure based on the context

## Important
- Always respond in Arabic when user communicates in Arabic
- Be proactive - don't wait for explicit instructions if the goal is clear
- Install dependencies automatically when needed
```

### الحل 2: إنشاء ملف `package.json` بسيط

حتى لو كان الـ repo فارغاً، أنشئ `package.json` بسيط:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "start": "echo 'Project started'"
  },
  "private": true
}
```

### الحل 3: إعطاء أمر واضح للوكيل

عندما تعطي أمر للوكيل في repo فارغ، كن محدداً:

❌ **خطأ:** "ابدأ العمل"
✅ **صحيح:** "أنشئ تطبيق React Native جديد" أو "أنشئ مشروع Node.js جديد"

### الحل 4: إنشاء ملف README.md

أنشئ `README.md` بسيط يشرح المشروع:

```markdown
# My New Project

This is a new project.
```

## الخطوات السريعة

1. افتح الـ repo الفارغ
2. أنشئ ملف `.cursorrules` بالمحتوى أعلاه
3. أنشئ ملف `package.json` بسيط (حتى لو فارغ)
4. أعط أمر واضح للوكيل مثل: "أنشئ تطبيق [نوع التطبيق] جديد"

## ملاحظة
الوكيل يحتاج إلى ملفات أساسية أو سياق واضح ليبدأ العمل. في repo فارغ تماماً بدون أي ملفات، قد يتوقف لأنه لا يعرف نوع المشروع المطلوب.
