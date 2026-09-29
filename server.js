const path = require('path');
const express = require('express');
const apiRoutes = require('./routes/api');
require('./database/db');

const app = express();
const port = process.env.PORT || 8000;

app.use(express.json());
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'sqlite' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'indx.html')));

app.listen(port, () => {
  console.log(`Green Valley server running at http://127.0.0.1:${port}`);
});
