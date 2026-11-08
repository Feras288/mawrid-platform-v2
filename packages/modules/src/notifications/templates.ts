/**
 * Default bilingual email/in-app templates. Admins may override subject/body per locale via
 * `notification_templates`. Placeholders: {{name}} (HTML-escaped). An optional action button uses
 * the `actionUrl` param.
 */
export interface TemplateDef {
  subject: string;
  body: string;
  action?: string;
}

export type TemplateKey =
  | "auth.verify_email"
  | "auth.reset_password"
  | "auth.two_factor_otp"
  | "org.invitation"
  | "supplier.status_changed"
  | "rfq.invitation"
  | "rfq.cancelled"
  | "rfq.revision_requested"
  | "rfq.closing_soon"
  | "quotation.submitted"
  | "approval.requested"
  | "approval.decided"
  | "award.decided"
  | "po.issued"
  | "po.status_changed"
  | "po.shipment_created"
  | "order.confirmed"
  | "order.status_changed"
  | "order.new_for_supplier"
  | "return.status_changed"
  | "price.alert"
  | "boq.processed"
  | "privacy.export_ready"
  | "system.test";

export const TEMPLATES: Record<TemplateKey, Record<"ar" | "en", TemplateDef>> = {
  "auth.verify_email": {
    ar: { subject: "تأكيد بريدك الإلكتروني", body: "مرحباً {{name}}،\nيرجى تأكيد بريدك الإلكتروني لإكمال تسجيل حسابك.", action: "تأكيد البريد" },
    en: { subject: "Verify your email", body: "Hello {{name}},\nPlease verify your email address to complete your registration.", action: "Verify email" },
  },
  "auth.reset_password": {
    ar: { subject: "إعادة تعيين كلمة المرور", body: "تلقينا طلباً لإعادة تعيين كلمة المرور. إذا لم تطلب ذلك فتجاهل هذه الرسالة.", action: "إعادة التعيين" },
    en: { subject: "Reset your password", body: "We received a request to reset your password. If you did not request it, ignore this email.", action: "Reset password" },
  },
  "auth.two_factor_otp": {
    ar: { subject: "رمز التحقق", body: "رمز التحقق الخاص بك هو: {{code}}" },
    en: { subject: "Your verification code", body: "Your verification code is: {{code}}" },
  },
  "org.invitation": {
    ar: { subject: "دعوة للانضمام إلى {{orgName}}", body: "دعاك {{inviterName}} للانضمام إلى {{orgName}} على منصة {{brand}}.\nتنتهي صلاحية الدعوة خلال 7 أيام.", action: "قبول الدعوة" },
    en: { subject: "Invitation to join {{orgName}}", body: "{{inviterName}} invited you to join {{orgName}} on {{brand}}.\nThis invitation expires in 7 days.", action: "Accept invitation" },
  },
  "supplier.status_changed": {
    ar: { subject: "تحديث حالة اعتماد المورد", body: "تم تغيير حالة اعتماد {{orgName}} إلى: {{status}}.\n{{note}}", action: "عرض الملف" },
    en: { subject: "Supplier verification update", body: "The verification status of {{orgName}} changed to: {{status}}.\n{{note}}", action: "View profile" },
  },
  "rfq.invitation": {
    ar: { subject: "طلب عرض سعر جديد {{rfqNumber}}", body: "أرسلت {{buyerName}} طلب عرض سعر بعنوان «{{title}}».\nآخر موعد لاستقبال العروض: {{closesAt}}.", action: "عرض الطلب وتقديم العرض" },
    en: { subject: "New request for quotation {{rfqNumber}}", body: "{{buyerName}} sent you a request for quotation “{{title}}”.\nQuotations close on {{closesAt}}.", action: "View RFQ and quote" },
  },
  "rfq.cancelled": {
    ar: { subject: "إلغاء طلب عرض السعر {{rfqNumber}}", body: "تم إلغاء طلب عرض السعر «{{title}}». السبب: {{reason}}" },
    en: { subject: "RFQ {{rfqNumber}} cancelled", body: "The request for quotation “{{title}}” was cancelled. Reason: {{reason}}" },
  },
  "rfq.revision_requested": {
    ar: { subject: "طلب تعديل العرض {{rfqNumber}}", body: "طلبت {{buyerName}} تعديل عرضك على «{{title}}» قبل {{closesAt}}.\n{{note}}", action: "تعديل العرض" },
    en: { subject: "Revision requested for {{rfqNumber}}", body: "{{buyerName}} requested a revised quotation for “{{title}}” by {{closesAt}}.\n{{note}}", action: "Revise quotation" },
  },
  "rfq.closing_soon": {
    ar: { subject: "اقتراب موعد إغلاق {{rfqNumber}}", body: "يغلق استقبال العروض على «{{title}}» في {{closesAt}}.", action: "تقديم العرض" },
    en: { subject: "{{rfqNumber}} closes soon", body: "Quotations for “{{title}}” close on {{closesAt}}.", action: "Submit quotation" },
  },
  "quotation.submitted": {
    ar: { subject: "عرض سعر جديد على {{rfqNumber}}", body: "قدّم {{supplierName}} عرض سعر على «{{title}}».", action: "عرض المقارنة" },
    en: { subject: "New quotation for {{rfqNumber}}", body: "{{supplierName}} submitted a quotation for “{{title}}”.", action: "Open comparison" },
  },
  "approval.requested": {
    ar: { subject: "طلب اعتماد: {{subject}}", body: "مطلوب اعتمادك على {{subject}} بقيمة {{amount}}.", action: "مراجعة الطلب" },
    en: { subject: "Approval requested: {{subject}}", body: "Your approval is requested for {{subject}} ({{amount}}).", action: "Review request" },
  },
  "approval.decided": {
    ar: { subject: "قرار الاعتماد: {{subject}}", body: "تم {{decision}} طلب الاعتماد الخاص بـ {{subject}}.", action: "عرض التفاصيل" },
    en: { subject: "Approval decision: {{subject}}", body: "The approval request for {{subject}} was {{decision}}.", action: "View details" },
  },
  "award.decided": {
    ar: { subject: "نتيجة الترسية {{rfqNumber}}", body: "تمت ترسية بنود من «{{title}}» على شركتكم. سيصلكم أمر الشراء بعد اكتمال الاعتمادات." },
    en: { subject: "Award result {{rfqNumber}}", body: "Lines from “{{title}}” were awarded to your company. A purchase order follows once approvals complete." },
  },
  "po.issued": {
    ar: { subject: "أمر شراء جديد {{poNumber}}", body: "أصدرت {{buyerName}} أمر الشراء {{poNumber}} بقيمة {{total}}.", action: "عرض أمر الشراء" },
    en: { subject: "New purchase order {{poNumber}}", body: "{{buyerName}} issued purchase order {{poNumber}} totaling {{total}}.", action: "View purchase order" },
  },
  "po.status_changed": {
    ar: { subject: "تحديث أمر الشراء {{poNumber}}", body: "تم تحديث حالة أمر الشراء {{poNumber}} إلى: {{status}}.", action: "عرض التفاصيل" },
    en: { subject: "Purchase order {{poNumber}} updated", body: "Purchase order {{poNumber}} status changed to: {{status}}.", action: "View details" },
  },
  "po.shipment_created": {
    ar: { subject: "شحنة جديدة لأمر الشراء {{poNumber}}", body: "تم شحن جزء من أمر الشراء {{poNumber}}. رقم التتبع: {{tracking}}", action: "متابعة الشحنة" },
    en: { subject: "New shipment for {{poNumber}}", body: "A shipment was dispatched for {{poNumber}}. Tracking: {{tracking}}", action: "Track shipment" },
  },
  "order.confirmed": {
    ar: { subject: "تأكيد الطلب {{orderNumber}}", body: "شكراً لطلبك. إجمالي الطلب {{total}}.", action: "متابعة الطلب" },
    en: { subject: "Order {{orderNumber}} confirmed", body: "Thank you for your order. Total: {{total}}.", action: "Track order" },
  },
  "order.status_changed": {
    ar: { subject: "تحديث الطلب {{orderNumber}}", body: "تم تحديث حالة طلبك من {{supplierName}} إلى: {{status}}.", action: "متابعة الطلب" },
    en: { subject: "Order {{orderNumber}} update", body: "Your order from {{supplierName}} is now: {{status}}.", action: "Track order" },
  },
  "order.new_for_supplier": {
    ar: { subject: "طلب متجر جديد {{orderNumber}}", body: "لديك طلب جديد بقيمة {{total}} بانتظار التجهيز.", action: "عرض الطلب" },
    en: { subject: "New store order {{orderNumber}}", body: "You have a new order totaling {{total}} awaiting preparation.", action: "View order" },
  },
  "return.status_changed": {
    ar: { subject: "تحديث طلب الإرجاع", body: "حالة طلب الإرجاع للطلب {{orderNumber}}: {{status}}." },
    en: { subject: "Return request update", body: "Return request for order {{orderNumber}}: {{status}}." },
  },
  "price.alert": {
    ar: { subject: "تنبيه سعر: {{productName}}", body: "تغير مؤشر السعر لـ {{productName}} بنسبة {{change}} خلال {{period}}.", action: "عرض المؤشر" },
    en: { subject: "Price alert: {{productName}}", body: "The price index for {{productName}} changed by {{change}} over {{period}}.", action: "View index" },
  },
  "boq.processed": {
    ar: { subject: "اكتملت معالجة جدول الكميات", body: "تمت معالجة «{{fileName}}»: {{lines}} بند، منها {{review}} بحاجة لمراجعة.", action: "مراجعة البنود" },
    en: { subject: "BOQ processing completed", body: "“{{fileName}}” was processed: {{lines}} lines, {{review}} need review.", action: "Review lines" },
  },
  "privacy.export_ready": {
    ar: { subject: "بياناتك جاهزة للتنزيل", body: "تم تجهيز نسخة من بياناتك الشخصية. يمكنك تنزيلها من صفحة الخصوصية في حسابك." },
    en: { subject: "Your data export is ready", body: "A copy of your personal data is ready. Download it from the privacy page in your account." },
  },
  "system.test": {
    ar: { subject: "رسالة اختبار", body: "هذه رسالة اختبار من إعدادات البريد في منصة {{brand}}." },
    en: { subject: "Test message", body: "This is a test message from the {{brand}} email settings." },
  },
};
