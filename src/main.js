import { Client, Databases, Query } from 'node-appwrite';

/**
 * Appwrite Function: getProcessesStats
 * ------------------------------------
 * يقوم بحساب جميع إحصائيات العمليات (الوارد والصادر) مفروزة حسب العملة وحسب الشهر
 * في استدعاء واحد فقط، دون أي تكرار في البيانات المسترجعة.
 */

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  const databaseId = process.env.DATABASE_ID || 'eye_care_accounting_db';
  const collectionId = process.env.PROCESSES_COLLECTION_ID || 'processes';

  const PAGE_LIMIT = 100;

  try {
    // 1. الإحصائيات التراكمية العامة (مفروزة حسب العملة فقط)
    const statsByCurrency = {}; 
    /* الهيكل المتوقع:
       {
         "USD": { incomeSum: 500, incomeCount: 3, expenseSum: 200, expenseCount: 1, totalCount: 4 },
         "SYP": { incomeSum: 1000, incomeCount: 5, expenseSum: 0, expenseCount: 0, totalCount: 5 }
       }
    */

    // 2. الإحصائيات المفروزة شهرياً (حسب العملة داخل كل شهر)
    const monthlyStats = {};
    /* الهيكل المتوقع:
       {
         "2026-06": {
            "USD": { incomeSum: 100, incomeCount: 1, expenseSum: 50, expenseCount: 1, totalCount: 2 }
         }
       }
    */

    let totalCountAll = 0;
    let lastDocumentId = null;

    while (true) {
      const queries = [
        Query.limit(PAGE_LIMIT),
        // جلب الحقول المطلوبة فقط لتقليل البيانات المنقولة (مع التاريخ $createdAt)
        Query.select(['price', 'moneyCode', 'income', '$createdAt']),
      ];

      if (lastDocumentId) {
        queries.push(Query.cursorAfter(lastDocumentId));
      }

      const page = await databases.listDocuments(databaseId, collectionId, queries);

      for (const doc of page.documents) {
        const code = doc.moneyCode || 'UNKNOWN';
        const price = Number(doc.price) || 0;
        const isIncome = doc.income === true;
        
        // استخراج السنة والشهر من تاريخ الإنشاء (مثال: "2026-06-29..." تصبح "2026-06")
        const monthKey = doc.$createdAt ? doc.$createdAt.substring(0, 7) : 'UNKNOWN_DATE';

        // --- أولاً: تهيئة وتحديث الإحصائيات العامة حسب العملة ---
        if (!statsByCurrency[code]) {
          statsByCurrency[code] = { incomeSum: 0, incomeCount: 0, expenseSum: 0, expenseCount: 0, totalCount: 0 };
        }
        
        statsByCurrency[code].totalCount += 1;
        if (isIncome) {
          statsByCurrency[code].incomeSum += price;
          statsByCurrency[code].incomeCount += 1;
        } else {
          statsByCurrency[code].expenseSum += price;
          statsByCurrency[code].expenseCount += 1;
        }

        // --- ثانياً: تهيئة وتحديث الإحصائيات الشهرية ---
        if (!monthlyStats[monthKey]) {
          monthlyStats[monthKey] = {};
        }
        if (!monthlyStats[monthKey][code]) {
          monthlyStats[monthKey][code] = { incomeSum: 0, incomeCount: 0, expenseSum: 0, expenseCount: 0, totalCount: 0 };
        }

        monthlyStats[monthKey][code].totalCount += 1;
        if (isIncome) {
          monthlyStats[monthKey][code].incomeSum += price;
          monthlyStats[monthKey][code].incomeCount += 1;
        } else {
          monthlyStats[monthKey][code].expenseSum += price;
          monthlyStats[monthKey][code].expenseCount += 1;
        }

        totalCountAll += 1;
      }

      if (page.documents.length < PAGE_LIMIT) break;

      lastDocumentId = page.documents[page.documents.length - 1].$id;
    }

    log(`Processed ${totalCountAll} documents across all pages.`);

    // النتيجة النهائية نظيفة تماماً وبدون أي تكرار للحقول
    const responseData = {
      countAll: totalCountAll,   // العدد الإجمالي لكل العمليات في النظام
      byCurrency: statsByCurrency, // الإحصائيات العامة لكل عملة متوفرة
      byMonth: monthlyStats        // الإحصائيات مفروزة شهرياً وبداخلها العملات
    };

    log(`Result: ${JSON.stringify(responseData)}`);

    return res.json({
      success: true,
      data: responseData,
    });
  } catch (err) {
    error(err.message);
    return res.json(
      {
        success: false,
        message: err.message,
      },
      500
    );
  }
};