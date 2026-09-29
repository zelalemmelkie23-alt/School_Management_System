const db = require('../database/db');
const users = () => db.table('users');
const students = () => db.table('students');
const attendance = () => db.table('attendance');
const fees = () => db.table('fees');
const results = () => db.table('results');
const publicUser = user => ({ id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role });

exports.login = (req, res) => {
  const identifier = String(req.body.identifier || '').toLowerCase();
  const user = users().find(item => item.username.toLowerCase() === identifier || item.email.toLowerCase() === identifier);
  if (!user || user.password !== req.body.password) return res.status(401).json({ message: 'Invalid username/email or password.' });
  res.json({ user: publicUser(user) });
};
exports.signup = (req, res) => {
  const { fullName, username, email, password, role = 'student' } = req.body;
  if (!fullName || !username || !email || !password) return res.status(400).json({ message: 'Please fill in all required fields.' });
  if (!['admin', 'teacher', 'student'].includes(role)) return res.status(400).json({ message: 'Invalid role.' });
  if (users().some(item => item.username.toLowerCase() === username.toLowerCase() || item.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ message: 'Username or email already exists.' });
  const user = { id: `${role}-${Date.now()}`, fullName: fullName.trim(), username: username.trim(), email: email.trim(), password, role };
  users().push(user); db.save(); res.status(201).json({ user: publicUser(user) });
};
exports.listUsers = (_req, res) => res.json(users().map(publicUser));
exports.listStudents = (_req, res) => res.json(students());
exports.createStudent = (req, res) => {
  const student = { ...req.body, studentId: req.body.studentId || `ST-${Date.now().toString().slice(-6)}`, status: req.body.status || 'Active' };
  if (!student.firstName || !student.lastName || !student.grade) return res.status(400).json({ message: 'Student name and grade are required.' });
  if (students().some(item => item.studentId.toLowerCase() === student.studentId.toLowerCase())) return res.status(409).json({ message: 'Student ID already exists.' });
  students().push(student); db.save(); res.status(201).json(student);
};
exports.updateStudent = (req, res) => {
  const index = students().findIndex(item => item.studentId.toLowerCase() === req.params.studentId.toLowerCase());
  if (index < 0) return res.status(404).json({ message: 'Student not found.' });
  students()[index] = { ...students()[index], ...req.body, studentId: req.params.studentId }; db.save(); res.json(students()[index]);
};
exports.deleteStudent = (req, res) => {
  const index = students().findIndex(item => item.studentId.toLowerCase() === req.params.studentId.toLowerCase());
  if (index < 0) return res.status(404).json({ message: 'Student not found.' });
  students().splice(index, 1); db.save(); res.status(204).end();
};
exports.listAttendance = (_req, res) => res.json(attendance().slice().reverse());
exports.createAttendance = (req, res) => { const item = { ...req.body, id: req.body.id || `A-${Date.now()}` }; attendance().push(item); db.save(); res.status(201).json(item); };
exports.listFees = (_req, res) => res.json(fees().slice().reverse());
exports.createFee = (req, res) => { const item = { ...req.body, id: req.body.id || `F-${Date.now()}` }; fees().push(item); db.save(); res.status(201).json(item); };
exports.listResults = (_req, res) => res.json(results().slice().reverse());
exports.createResult = (req, res) => { const item = { ...req.body, id: db.nextResultId(), date: req.body.date || new Date().toISOString().slice(0, 10) }; results().push(item); db.save(); res.status(201).json(item); };
