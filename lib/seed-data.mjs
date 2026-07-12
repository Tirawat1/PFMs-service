import bcrypt from "bcryptjs";

const D = 86400000;

export const ROLES = [
  { key: "admin", name: "Admin (Project Finance)", nameTh: "ผู้ดูแลระบบ (การเงินโครงการ)", perms: ["*"], contact: "Pikajuz", system: true },
  { key: "project_manager", name: "Project Manager", nameTh: "ผู้จัดการโครงการ", perms: ["dashboard", "requests", "accounts", "notifications"], contact: "Dr. Somchai P." },
  { key: "faculty_finance", name: "Faculty Finance Officer", nameTh: "เจ้าหน้าที่การเงินคณะ", perms: ["dashboard", "requests", "accounts", "notifications", "verify", "disburse"], contact: "K. Ratchanee" },
  { key: "faculty_purchasing", name: "Faculty Purchasing Officer", nameTh: "เจ้าหน้าที่พัสดุคณะ", perms: ["dashboard", "requests", "notifications", "verify"], contact: "K. Anucha" },
  { key: "department", name: "Department User", nameTh: "ผู้ใช้ระดับภาควิชา", perms: ["dashboard", "requests", "create", "notifications"], contact: "Dept. representatives" },
];

const MASTER_DOCS = ["ใบสำคัญรับเงิน (Receipt voucher)", "โครงการที่ได้รับอนุมัติ (Approved project)", "บันทึกแต่งตั้งเป็นกรรมการ (Committee appointment)", "เกณฑ์การตัดสิน (Judging criteria)", "ภาพถ่ายตอนมอบรางวัล (Award ceremony photo)", "ประกาศผู้ชนะ (Winner announcement)", "บันทึกข้อความ (Internal memo)", "สำเนาบัตรประชาชน (ID card copy)", "Bookbank (Bank account copy)", "ข้อมูลผู้ขาย / Vendor details", "ใบเสนอราคา (Quotation)", "ใบเสร็จรับเงิน (Official receipt)", "TOR ขอบเขตของงาน", "แบบฟอร์ม บก.06 ราคากลาง (Median price)", "หนังสือรับรองบริษัท (Company certificate)", "สำเนา ภพ.20 (VAT registration)", "สำเนาทะเบียนการค้า (Commercial reg.)"];

const CATEGORIES = [
  { name: "Prize Money", nameTh: "ค่าเงินรางวัลการแข่งขัน", icon: "ph-trophy", docs: [MASTER_DOCS[0], MASTER_DOCS[1], MASTER_DOCS[2], MASTER_DOCS[3], MASTER_DOCS[4], MASTER_DOCS[5]], notes: "" },
  { name: "Judge Compensation", nameTh: "ค่าตอบแทนกรรมการตัดสิน", icon: "ph-gavel", docs: [MASTER_DOCS[6], MASTER_DOCS[0], MASTER_DOCS[7], MASTER_DOCS[2], MASTER_DOCS[3], MASTER_DOCS[8], MASTER_DOCS[9]], notes: "" },
  { name: "Hotel Accommodation", nameTh: "ค่าห้องพักโรงแรมสำหรับผู้เข้าร่วม", icon: "ph-bed", docs: [MASTER_DOCS[10], MASTER_DOCS[11]], notes: "" },
  { name: "Catering (Food)", nameTh: "ค่าจัดเลี้ยง (อาหาร)", icon: "ph-fork-knife", docs: [MASTER_DOCS[10], MASTER_DOCS[11]], notes: "" },
  { name: "Snacks / Refreshments", nameTh: "ค่าอาหารว่าง", icon: "ph-coffee", docs: [MASTER_DOCS[11]], notes: "ตรวจสอบ: ชื่อลูกค้าต้องเป็นคณะเภสัชศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย · ที่อยู่ 254 ถ.พญาไท แขวงวังใหม่ เขตปทุมวัน กรุงเทพฯ 10330 · เลขผู้เสียภาษี 0994000158734" },
  { name: "Staff Travel", nameTh: "ค่าเดินทางสำหรับผู้ปฏิบัติงาน", icon: "ph-airplane-tilt", docs: [MASTER_DOCS[11]], notes: "" },
  { name: "Beverage Booth", nameTh: "ค่าบูธเครื่องดื่ม", icon: "ph-storefront", docs: [MASTER_DOCS[10], MASTER_DOCS[11]], notes: "" },
  { name: "Museum Entry Fee", nameTh: "ค่าธรรมเนียมเข้าพิพิธภัณฑ์", icon: "ph-ticket", docs: [MASTER_DOCS[11]], notes: "กรณียังไม่มี vendor กับจุฬา: แนบแบบฟอร์มรายละเอียดผู้ขาย" },
  { name: "Science Officer Compensation", nameTh: "ค่าตอบแทนเจ้าหน้าที่วิทยาศาสตร์", icon: "ph-flask", docs: [MASTER_DOCS[6], MASTER_DOCS[0], MASTER_DOCS[8]], notes: "" },
];

// Creates baseline data (roles + accounts + master docs + categories + admin).
// Always safe to run on an empty database.
export async function seedBaseline(prisma) {
  const roleIds = {};
  for (const r of ROLES) {
    const created = await prisma.role.create({
      data: { name: r.name, nameTh: r.nameTh, perms: r.perms, contact: r.contact, system: !!r.system },
    });
    roleIds[r.key] = created.id;
  }
  await prisma.account.createMany({
    data: [
      { id: "faculty", name: "Faculty Bank Account", nameTh: "บัญชีธนาคารคณะ", icon: "ph-buildings", balance: 0 },
      { id: "project", name: "Project Bank Account", nameTh: "บัญชีธนาคารโครงการ", icon: "ph-wallet", balance: 0 },
    ],
  });
  await prisma.masterDoc.createMany({ data: MASTER_DOCS.map((name) => ({ name })) });
  for (const c of CATEGORIES) await prisma.category.create({ data: c });
  await prisma.counter.create({ data: { id: "request", value: 1000 } });

  const admin = await prisma.user.create({
    data: {
      name: process.env.ADMIN_USERNAME || "Pikajuz",
      username: process.env.ADMIN_USERNAME || "Pikajuz",
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || "WCFin", 10),
      dept: "Project Finance",
      roleId: roleIds.admin,
    },
  });
  return { roleIds, admin };
}

// Adds the demo dataset (demo users, balances, txns, requests, audit).
export async function seedDemo(prisma, roleIds) {
  const demoUsers = [
    { name: "Dr. Somchai P.", username: "pm", password: "pm123", role: "project_manager", dept: "IPSF World Congress 2026" },
    { name: "K. Ratchanee", username: "finance", password: "fin123", role: "faculty_finance", dept: "Faculty Finance" },
    { name: "K. Anucha", username: "purchasing", password: "pur123", role: "faculty_purchasing", dept: "Faculty Purchasing" },
    { name: "Asst. Prof. Naruemon", username: "dept", password: "dept123", role: "department", dept: "Dept. of Pharmacology" },
  ];
  const users = {};
  for (const u of demoUsers) {
    users[u.username] = await prisma.user.create({
      data: { name: u.name, username: u.username, passwordHash: bcrypt.hashSync(u.password, 10), dept: u.dept, roleId: roleIds[u.role] },
    });
  }

  await prisma.account.update({ where: { id: "faculty" }, data: { balance: 2450000 } });
  await prisma.account.update({ where: { id: "project" }, data: { balance: 812000 } });

  const now = Date.now();
  await prisma.txn.createMany({
    data: [
      { acctId: "faculty", type: "in", amount: 3000000, desc: "Faculty budget allocation", date: new Date(now - 40 * D) },
      { acctId: "project", type: "in", amount: 1200000, desc: "Transfer from faculty account (advance)", date: new Date(now - 30 * D) },
      { acctId: "project", type: "out", amount: 185000, desc: "Disbursement — Catering (opening)", date: new Date(now - 14 * D) },
      { acctId: "project", type: "out", amount: 42000, desc: "Disbursement — Prize money", date: new Date(now - 9 * D) },
      { acctId: "faculty", type: "out", amount: 120000, desc: "Disbursement — Hotel accommodation", date: new Date(now - 5 * D) },
      { acctId: "project", type: "out", amount: 16000, desc: "Disbursement — Judge compensation", date: new Date(now - 2 * D) },
    ],
  });

  const cats = await prisma.category.findMany();
  const cat = (name) => cats.find((c) => c.name === name);
  const mkdocs = (c, filled) => c.docs.map((d, i) => ({ name: d, submitted: i < filled, link: i < filled ? "https://drive.google.com/file/d/demo-" + i + "/view" : null, fileName: null, disc: null }));

  const reqs = [
    { id: "RB-1042", title: "Opening ceremony catering", cat: "Catering (Food)", amount: 185000, dept: "Dept. of Pharmacology", requester: "dept", status: "closed", age: 15, filled: 2 },
    { id: "RB-1051", title: "Quiz competition prize money", cat: "Prize Money", amount: 42000, dept: "Dept. of Pharmacognosy", requester: "dept", status: "disbursed", age: 10, filled: 6 },
    { id: "RB-1058", title: "Judge honorarium — poster session", cat: "Judge Compensation", amount: 16000, dept: "Student Affairs", requester: "dept", status: "verified", age: 6, filled: 5 },
    { id: "RB-1063", title: "Participant hotel (3 nights)", cat: "Hotel Accommodation", amount: 120000, dept: "Logistics", requester: "dept", status: "docs_submitted", age: 4, filled: 2 },
    { id: "RB-1069", title: "Welcome-booth beverages", cat: "Beverage Booth", amount: 28500, dept: "Dept. of Pharmacology", requester: "dept", status: "notified", age: 1, filled: 0 },
  ];
  for (const r of reqs) {
    const c = cat(r.cat);
    await prisma.request.create({
      data: {
        id: r.id, title: r.title, categoryId: c.id, amount: r.amount, dept: r.dept,
        requesterId: users[r.requester].id, requesterName: users[r.requester].name,
        status: r.status, docs: mkdocs(c, r.filled),
        driveFolder: "https://drive.google.com/drive/folders/PFMS-" + r.id,
        createdAt: new Date(now - r.age * D),
      },
    });
  }
  await prisma.counter.update({ where: { id: "request" }, data: { value: 1070 } });

  await prisma.audit.createMany({
    data: [
      { user: "K. Ratchanee", role: "Faculty Finance Officer", action: "Disbursed funds for RB-1051 (฿42,000)", ts: new Date(now - 2 * D) },
      { user: "K. Anucha", role: "Faculty Purchasing Officer", action: "Verified documents for RB-1058", ts: new Date(now - 3 * D) },
      { user: "Asst. Prof. Naruemon", role: "Department User", action: "Submitted reimbursement RB-1069", ts: new Date(now - 1 * D) },
    ],
  });
}
