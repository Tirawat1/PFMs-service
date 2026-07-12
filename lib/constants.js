export const ORDER = [
  "notified",
  "docs_submitted",
  "verified",
  "disbursed",
  "purchase_complete",
  "closed",
];

export const STATUS = {
  notified: { label: "Notified", th: "แจ้งเรื่อง", icon: "ph-megaphone" },
  docs_submitted: { label: "Docs Submitted", th: "ส่งเอกสาร", icon: "ph-files" },
  verified: { label: "Verified", th: "ตรวจสอบแล้ว", icon: "ph-seal-check" },
  disbursed: { label: "Funds Disbursed", th: "จ่ายเงินแล้ว", icon: "ph-hand-coins" },
  purchase_complete: { label: "Purchase Complete", th: "จัดซื้อเสร็จ", icon: "ph-shopping-bag" },
  closed: { label: "Closed", th: "ปิดงาน", icon: "ph-check-circle" },
};

export const PERMKEYS = [
  "dashboard",
  "requests",
  "create",
  "verify",
  "disburse",
  "accounts",
  "notifications",
];

export const ADV_LABELS = {
  docs_submitted: "Submit documents",
  verified: "Verify documents",
  disbursed: "Disburse funds",
  purchase_complete: "Mark purchase complete",
  closed: "Close request",
};

// which permission advances a request INTO the given status
export const ADV_PERM = {
  docs_submitted: "create",
  verified: "verify",
  disbursed: "disburse",
  purchase_complete: "create",
  closed: "disburse",
};
