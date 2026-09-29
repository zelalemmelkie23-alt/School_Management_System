const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, 'school.json');
const emptyDatabase = { users: [], students: [], attendance: [], fees: [], results: [] };

function load() {
  if (!fs.existsSync(databasePath)) return { ...emptyDatabase };
  try { return { ...emptyDatabase, ...JSON.parse(fs.readFileSync(databasePath, 'utf8')) }; }
  catch (error) { return { ...emptyDatabase }; }
}

let data = load();
function save() { fs.writeFileSync(databasePath, JSON.stringify(data, null, 2)); }
function table(name) { return data[name]; }
function nextResultId() { return data.results.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1; }

if (!data.users.length) data.users.push(
  { id: 'admin-001', fullName: 'System Administrator', username: 'adminuser', email: 'admin@greenvalley.edu', password: '123456', role: 'admin' },
  { id: 'teacher-001', fullName: 'Alice Johnson', username: 'teacher', email: 'teacher@greenvalley.edu', password: 'teacher123', role: 'teacher' },
  { id: 'student-001', fullName: 'John Doe', username: 'student', email: 'student@greenvalley.edu', password: 'student123', role: 'student' }
);
if (!data.students.length) data.students.push(
  { studentId: 'ST-1001', firstName: 'Abebe', lastName: 'Kassa', grade: 'Grade 10', status: 'Active', email: 'abebe@gmail.com', phone: '+251900000001', department: 'Science' },
  { studentId: 'ST-1002', firstName: 'Selam', lastName: 'Bekele', grade: 'Grade 11', status: 'Pending', email: 'selam@gmail.com', phone: '+251900000002', department: 'Commerce' },
  { studentId: 'ST-1003', firstName: 'Yonas', lastName: 'Alemu', grade: 'Grade 9', status: 'Active', email: 'yonas@gmail.com', phone: '+251900000003', department: 'Technology' },
  { studentId: 'ST-1004', firstName: 'Lily', lastName: 'Tadesse', grade: 'Grade 12', status: 'Active', email: 'lily@gmail.com', phone: '+251900000004', department: 'Arts' }
);
if (!data.attendance.length) data.attendance.push(
  { id: 'A-001', studentId: 'ST-1001', studentName: 'Abebe Kassa', date: '2026-09-23', status: 'Present' },
  { id: 'A-002', studentId: 'ST-1002', studentName: 'Selam Bekele', date: '2026-09-23', status: 'Absent' },
  { id: 'A-003', studentId: 'ST-1003', studentName: 'Yonas Alemu', date: '2026-09-23', status: 'Present' }
);
if (!data.fees.length) data.fees.push(
  { id: 'F-001', studentId: 'ST-1001', studentName: 'Abebe Kassa', amount: 5000, status: 'Paid', dueDate: '2026-09-30' },
  { id: 'F-002', studentId: 'ST-1002', studentName: 'Selam Bekele', amount: 5000, status: 'Pending', dueDate: '2026-10-05' },
  { id: 'F-003', studentId: 'ST-1003', studentName: 'Yonas Alemu', amount: 5000, status: 'Paid', dueDate: '2026-09-28' }
);
if (!data.results.length) data.results.push(
  { id: 1, studentId: 'ST-1001', studentName: 'Abebe Kassa', subject: 'Mathematics', score: 92, grade: 'A', remarks: 'Very strong performance', date: '2026-09-23' },
  { id: 2, studentId: 'ST-1001', studentName: 'Abebe Kassa', subject: 'Physics', score: 88, grade: 'A', remarks: 'Good understanding', date: '2026-09-23' },
  { id: 3, studentId: 'ST-1002', studentName: 'Selam Bekele', subject: 'English', score: 73, grade: 'B', remarks: 'Needs more practice', date: '2026-09-23' }
);
save();

module.exports = { table, save, nextResultId };
