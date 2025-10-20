import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';

interface QueryResult {
  question: string;
  analysis: string;
  recommendation: string;
  factors: string[];
  timestamp: Date;
}

export default function ImmigrationQuery() {
  const [query, setQuery] = useState<string>('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const processQuery = () => {
    if (!query.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال سؤال');
      return;
    }

    setIsProcessing(true);

    // Simulate processing
    setTimeout(() => {
      const analysis = analyzeImmigrationQuery(query);
      setResult(analysis);
      setIsProcessing(false);
    }, 1000);
  };

  const analyzeImmigrationQuery = (queryText: string): QueryResult => {
    // Analyze Swedish family reunification and permanent residence query
    const lowerQuery = queryText.toLowerCase();
    
    // Check for Swedish immigration keywords
    const isSwedenQuery = lowerQuery.includes('سويد') || lowerQuery.includes('sweden');
    const isFamilyReunification = lowerQuery.includes('لم شمل') || lowerQuery.includes('family reunification');
    const isPermanentResidence = lowerQuery.includes('دائمة') || lowerQuery.includes('permanent');
    const hasUnemployment = lowerQuery.includes('اكاسا') || lowerQuery.includes('a-kassa') || lowerQuery.includes('عمل');
    const hasSwedishFamilyMembers = lowerQuery.includes('جنسية سويدية') || lowerQuery.includes('swedish citizenship');

    let analysis = '';
    let recommendation = '';
    const factors: string[] = [];

    if (isSwedenQuery && isFamilyReunification && isPermanentResidence) {
      analysis = `بناءً على استفسارك حول الإقامة الدائمة في السويد:

• لديك خبرة 4 سنوات بتصريح لم الشمل (سنتان + سنتان)
• زوجتك وابنك لديهم الجنسية السويدية
• أنت مسجل في A-kassa (صندوق البطالة)

وفقاً لقوانين الهجرة السويدية، عندما يكون لديك أفراد عائلة بالجنسية السويدية (زوج/زوجة أو أطفال)، فإن شروط الإقامة الدائمة عادة ما تكون أكثر مرونة.`;

      recommendation = `احتمالية القبول: عالية إلى متوسطة

الأسباب الإيجابية:
✓ زوجتك وابنك لديهم الجنسية السويدية (عامل قوي جداً)
✓ لديك 4 سنوات من الإقامة القانونية المتواصلة
✓ التسجيل في A-kassa يظهر الاندماج في سوق العمل السويدي
✓ روابط عائلية قوية في السويد

نقاط يجب مراعاتها:
! عدم وجود عمل حالياً قد يكون نقطة ضعف، لكنه ليس عائقاً كبيراً
! تأكد من استيفاء شرط الإعالة الذاتية أو أن زوجتك تستطيع إثبات القدرة المالية
! بعض الحالات تتطلب إثبات الاندماج (لغة، تاريخ السويد، إلخ)

التوصيات:
1. اجمع إثبات الدعم المالي من زوجتك (إن كانت تعمل)
2. احتفظ بوثائق التسجيل في A-kassa كدليل على البحث عن عمل
3. إذا كنت قد أخذت دورات اللغة السويدية، أرفق الشهادات
4. تابع مع مكتب الهجرة السويدية (Migrationsverket) للتحديثات
5. فكر في استشارة محامي هجرة للحصول على تقييم شخصي أدق`;

      factors.push(
        'الزوجة والابن لديهم الجنسية السويدية - عامل إيجابي قوي',
        '4 سنوات إقامة قانونية متواصلة',
        'التسجيل في A-kassa يظهر الاندماج',
        'عدم وجود عمل حالي - قد يتطلب إثبات دعم مالي بديل',
        'الروابط العائلية القوية تزيد فرص القبول'
      );
    } else {
      analysis = 'يرجى تقديم المزيد من التفاصيل حول وضع الهجرة والعمل الخاص بك.';
      recommendation = 'للحصول على تحليل دقيق، يرجى تضمين: البلد، نوع الإقامة، المدة، الوضع العائلي، ووضع العمل.';
      factors.push('معلومات غير كافية للتحليل');
    }

    return {
      question: queryText,
      analysis,
      recommendation,
      factors,
      timestamp: new Date(),
    };
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>استفسارات الهجرة والعمل</Text>
      <Text style={styles.subtitle}>اطرح سؤالك حول الإقامة والعمل</Text>
      
      <TextInput
        style={styles.input}
        placeholder="مثال: أعيش في السويد بتصريح لم الشمل وأريد التقدم للإقامة الدائمة..."
        placeholderTextColor="#999"
        multiline
        numberOfLines={4}
        value={query}
        onChangeText={setQuery}
        textAlign="right"
      />

      <Pressable 
        style={[styles.button, isProcessing && styles.buttonDisabled]} 
        onPress={processQuery}
        disabled={isProcessing}
      >
        <Text style={styles.buttonText}>
          {isProcessing ? 'جارٍ التحليل...' : 'تحليل الاستفسار'}
        </Text>
      </Pressable>

      {result && (
        <ScrollView style={styles.resultContainer}>
          <View style={styles.resultSection}>
            <Text style={styles.sectionTitle}>التحليل:</Text>
            <Text style={styles.sectionText}>{result.analysis}</Text>
          </View>

          <View style={styles.resultSection}>
            <Text style={styles.sectionTitle}>التوصية:</Text>
            <Text style={styles.sectionText}>{result.recommendation}</Text>
          </View>

          <View style={styles.resultSection}>
            <Text style={styles.sectionTitle}>العوامل المؤثرة:</Text>
            {result.factors.map((factor, index) => (
              <Text key={index} style={styles.factorText}>• {factor}</Text>
            ))}
          </View>

          <Text style={styles.disclaimer}>
            ⚠️ ملاحظة: هذا التحليل إرشادي فقط. للحصول على معلومات دقيقة ومحدثة، يرجى استشارة محامي هجرة مختص أو مراجعة الموقع الرسمي لمكتب الهجرة في بلدك.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f9fafb',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#111827',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 20,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  resultSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
    textAlign: 'right',
  },
  sectionText: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 24,
    textAlign: 'right',
  },
  factorText: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 6,
    textAlign: 'right',
  },
  disclaimer: {
    fontSize: 13,
    color: '#dc2626',
    fontStyle: 'italic',
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 6,
    textAlign: 'right',
    lineHeight: 20,
  },
});
