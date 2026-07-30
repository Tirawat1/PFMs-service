import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const B = (baht) => BigInt(Math.round(baht * 100)); // store satang

const ROLES = [
  { id: 'admin',              name: 'Administrator',            permissions: ['*'],          isSystem: true },
  { id: 'project_finance',    name: 'Project Finance Officer',  permissions: ['disburse', 'verify'] },
  { id: 'faculty_finance',    name: 'Faculty Finance Officer',  permissions: ['verify'] },
  { id: 'faculty_purchasing', name: 'Faculty Purchasing Officer', permissions: ['verify', 'issue_po'] },
  { id: 'project_manager',    name: 'Project Manager',          permissions: [] },
  { id: 'department',         name: 'Department',               permissions: ['create'] },
  { id: 'data_migration',     name: 'Data Migration',           permissions: ['*'], isSystem: true }
];

const ACCOUNTS = [
  { id: 'faculty', name: 'Faculty Bank Account', nameTh: 'บัญชีธนาคารคณะ', icon: 'ph-buildings' },
  { id: 'project', name: 'Project Bank Account', nameTh: 'บัญชีธนาคารโครงการ', icon: 'ph-wallet' }
];

const STREAMS = [
  { id: 's_advance', name: 'Faculty Advances',    color: '#f0378a', icon: 'ph-hand-coins' },
  { id: 's_sponsor', name: 'Sponsorships',        color: '#a855f7', icon: 'ph-handshake' },
  { id: 's_reg',     name: 'Registration Fees',   color: '#0e7490', icon: 'ph-ticket' },
  { id: 's_donate',  name: 'Donations & Grants',  color: '#0f9d6b', icon: 'ph-gift' }
];

const M = {
  receipt:   'ใบสำคัญรับเงิน (Receipt voucher)',
  project:   'โครงการที่ได้รับอนุมัติ (Approved project)',
  committee: 'บันทึกแต่งตั้งเป็นกรรมการ (Committee appointment)',
  criteria:  'เกณฑ์การตัดสิน (Judging criteria)',
  photo:     'ภาพถ่ายตอนมอบรางวัล (Award ceremony photo)',
  winner:    'ประกาศผู้ชนะ (Winner announcement)',
  memo:      'บันทึกข้อความ (Internal memo)',
  idcard:    'สำเนาบัตรประชาชน (ID card copy)',
  bookbank:  'Bookbank (Bank account copy)',
  vendor:    'ข้อมูลผู้ขาย / Vendor details',
  quote:     'ใบเสนอราคา (Quotation)',
  official:  'ใบเสร็จรับเงิน (Official receipt)'
};
const POST = [M.official, 'หลักฐานการโอนเงิน (Transfer evidence)'];

const CATEGORIES = [
  { id: 'c_prize',    name: 'Prize Money',                  nameTh: 'ค่าเงินรางวัลการแข่งขัน',            icon: 'ph-trophy',        docsPre: [M.receipt, M.project, M.committee, M.criteria, M.photo, M.winner] },
  { id: 'c_judge',    name: 'Judge Compensation',           nameTh: 'ค่าตอบแทนกรรมการตัดสิน',              icon: 'ph-gavel',         docsPre: [M.memo, M.receipt, M.idcard, M.committee, M.criteria, M.bookbank, M.vendor] },
  { id: 'c_hotel',    name: 'Hotel Accommodation',          nameTh: 'ค่าห้องพักโรงแรมสำหรับผู้เข้าร่วม',   icon: 'ph-bed',           docsPre: [M.quote, M.official], defaultAcctId: 'faculty', vendorRequired: true, defaultPaidVia: 'purchasing', approverRole: 'faculty_purchasing', allowDirect: true },
  { id: 'c_catering', name: 'Catering (Food)',              nameTh: 'ค่าจัดเลี้ยง (อาหาร)',               icon: 'ph-fork-knife',    docsPre: [M.quote, M.official], defaultAcctId: 'project', vendorRequired: true },
  { id: 'c_snacks',   name: 'Snacks / Refreshments',        nameTh: 'ค่าอาหารว่าง',                       icon: 'ph-coffee',        docsPre: [M.official], defaultAcctId: 'project', notes: 'ตรวจสอบชื่อลูกค้าและเลขผู้เสียภาษีบนใบเสร็จให้ตรงกับคณะ' },
  { id: 'c_travel',   name: 'Staff Travel',                 nameTh: 'ค่าเดินทางสำหรับผู้ปฏิบัติงาน',      icon: 'ph-airplane-tilt', docsPre: [M.official] },
  { id: 'c_booth',    name: 'Beverage Booth',               nameTh: 'ค่าบูธเครื่องดื่ม',                  icon: 'ph-storefront',    docsPre: [M.quote, M.official], defaultAcctId: 'project', vendorRequired: true, defaultPaidVia: 'purchasing', approverRole: 'faculty_purchasing' },
  { id: 'c_museum',   name: 'Museum Entry Fee',             nameTh: 'ค่าธรรมเนียมเข้าพิพิธภัณฑ์',          icon: 'ph-ticket',        docsPre: [M.official], vendorRequired: true, defaultPaidVia: 'purchasing', approverRole: 'faculty_purchasing' },
  { id: 'c_science',  name: 'Science Officer Compensation', nameTh: 'ค่าตอบแทนเจ้าหน้าที่วิทยาศาสตร์',     icon: 'ph-flask',         docsPre: [M.memo, M.receipt, M.bookbank], allowDirect: true }
];

async function main() {
  console.log('seeding reference data…');

  for (const r of ROLES) {
    await prisma.role.upsert({ where: { id: r.id }, update: { name: r.name, permissions: r.permissions }, create: r });
  }

  for (const a of ACCOUNTS) {
    await prisma.account.upsert({ where: { id: a.id }, update: {}, create: { ...a, balance: 0n } });
  }

  for (const s of STREAMS) {
    await prisma.stream.upsert({ where: { id: s.id }, update: { name: s.name, color: s.color }, create: { ...s, balance: 0n } });
  }

  for (const c of CATEGORIES) {
    const data = { docsPost: POST, ...c };
    await prisma.category.upsert({ where: { id: c.id }, update: data, create: data });
  }

  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    console.warn('! SEED_ADMIN_PASSWORD not set — skipping admin creation.');
  } else {
    if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        name: 'Administrator',
        username,
        passwordHash: await bcrypt.hash(password, 12),
        email: process.env.SEED_ADMIN_EMAIL || null,
        roleId: 'admin'
      }
    });
    console.log(`  admin user "${username}" ready`);
  }

  await prisma.setting.upsert({
    where: { key: 'advanceDashRoles' },
    update: {},
    create: { key: 'advanceDashRoles', value: ['admin', 'project_manager', 'faculty_finance'] }
  });

  console.log('seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
