const express = require('express');
const controller = require('../controllers/schoolController');
const router = express.Router();

router.post('/auth/login', controller.login);
router.post('/auth/signup', controller.signup);
router.get('/users', controller.listUsers);
router.get('/students', controller.listStudents);
router.post('/students', controller.createStudent);
router.put('/students/:studentId', controller.updateStudent);
router.delete('/students/:studentId', controller.deleteStudent);
router.get('/attendance', controller.listAttendance);
router.post('/attendance', controller.createAttendance);
router.get('/fees', controller.listFees);
router.post('/fees', controller.createFee);
router.get('/results', controller.listResults);
router.post('/results', controller.createResult);

module.exports = router;
