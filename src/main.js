import { Client, Databases, Query } from 'node-appwrite';

/**
 * Appwrite Function: getProcessesStats
 * ------------------------------------
 * يحسب إحصائيات العمليات (الوارد والصادر):
 *
 * 1. الإحصائيات العامة حسب العملة.
 * 2. الإحصائيات الشهرية حسب العملة.
 *
 * يعتمد تحديد الشهر بالكامل على الحقل:
 * accounting_date
 *
 * ولا يعتمد على $createdAt.
 */

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key']);

  const databases = new Databases(client);

  const databaseId =
    process.env.DATABASE_ID || 'eye_care_accounting_db';

  const collectionId =
    process.env.PROCESSES_COLLECTION_ID || 'processes';

  const PAGE_LIMIT = 100;

  try {
    // =========================================================
    // الإحصائيات العامة حسب العملة
    // =========================================================

    const statsByCurrency = {};

    // =========================================================
    // الإحصائيات الشهرية حسب العملة
    // =========================================================

    const monthlyStats = {};

    // العدد الإجمالي لجميع العمليات
    let totalCountAll = 0;

    // Cursor للتصفح بين الصفحات
    let lastDocumentId = null;

    // =========================================================
    // جلب جميع العمليات على دفعات
    // =========================================================

    while (true) {
      const queries = [
        Query.limit(PAGE_LIMIT),

        // جلب الحقول المطلوبة فقط
        Query.select([
          'price',
          'moneyCode',
          'income',
          'accounting_date',
        ]),
      ];

      if (lastDocumentId) {
        queries.push(Query.cursorAfter(lastDocumentId));
      }

      const page = await databases.listDocuments(
        databaseId,
        collectionId,
        queries
      );

      // =======================================================
      // معالجة العمليات الموجودة في الصفحة الحالية
      // =======================================================

      for (const doc of page.documents) {
        // -----------------------------------------------------
        // العملة
        // -----------------------------------------------------

        const code =
          doc.moneyCode !== null &&
          doc.moneyCode !== undefined &&
          String(doc.moneyCode).trim() !== ''
            ? String(doc.moneyCode).trim()
            : 'UNKNOWN';

        // -----------------------------------------------------
        // السعر
        // -----------------------------------------------------

        const price = Number(doc.price) || 0;

        // -----------------------------------------------------
        // نوع العملية
        // true  = وارد
        // false = صادر
        // -----------------------------------------------------

        const isIncome = doc.income === true;

        // -----------------------------------------------------
        // التاريخ المحاسبي
        //
        // مثال:
        // 2026-06-29
        // 2026-06-29T12:30:00.000+00:00
        //
        // يتم استخراج YYYY-MM فقط.
        // -----------------------------------------------------

        let monthKey = 'UNKNOWN_DATE';

        if (
          doc.accounting_date !== null &&
          doc.accounting_date !== undefined
        ) {
          const accountingDate = String(doc.accounting_date).trim();

          if (accountingDate.length >= 7) {
            monthKey = accountingDate.substring(0, 7);
          }
        }

        // =====================================================
        // الإحصائيات العامة حسب العملة
        // =====================================================

        if (!statsByCurrency[code]) {
          statsByCurrency[code] = {
            incomeSum: 0,
            incomeCount: 0,
            expenseSum: 0,
            expenseCount: 0,
            totalCount: 0,
          };
        }

        statsByCurrency[code].totalCount += 1;

        if (isIncome) {
          statsByCurrency[code].incomeSum += price;
          statsByCurrency[code].incomeCount += 1;
        } else {
          statsByCurrency[code].expenseSum += price;
          statsByCurrency[code].expenseCount += 1;
        }

        // =====================================================
        // الإحصائيات الشهرية حسب العملة
        // =====================================================

        if (!monthlyStats[monthKey]) {
          monthlyStats[monthKey] = {};
        }

        if (!monthlyStats[monthKey][code]) {
          monthlyStats[monthKey][code] = {
            incomeSum: 0,
            incomeCount: 0,
            expenseSum: 0,
            expenseCount: 0,
            totalCount: 0,
          };
        }

        monthlyStats[monthKey][code].totalCount += 1;

        if (isIncome) {
          monthlyStats[monthKey][code].incomeSum += price;
          monthlyStats[monthKey][code].incomeCount += 1;
        } else {
          monthlyStats[monthKey][code].expenseSum += price;
          monthlyStats[monthKey][code].expenseCount += 1;
        }

        // =====================================================
        // العدد الإجمالي
        // =====================================================

        totalCountAll += 1;
      }

      // =======================================================
      // إذا كانت الصفحة الأخيرة نتوقف
      // =======================================================

      if (page.documents.length < PAGE_LIMIT) {
        break;
      }

      // Cursor للصفحة التالية
      lastDocumentId =
        page.documents[page.documents.length - 1].$id;
    }

    // =========================================================
    // تسجيل النتيجة
    // =========================================================

    log(
      `Processed ${totalCountAll} documents using accounting_date.`
    );

    const responseData = {
      countAll: totalCountAll,

      // الإحصائيات الإجمالية حسب العملة
      byCurrency: statsByCurrency,

      // الإحصائيات الشهرية حسب accounting_date
      byMonth: monthlyStats,
    };

    log(`Result: ${JSON.stringify(responseData)}`);

    // =========================================================
    // الاستجابة
    // =========================================================

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