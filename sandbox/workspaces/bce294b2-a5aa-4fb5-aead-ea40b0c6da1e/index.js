const express = require('express');

const app = express();

app.use(express.json());

app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, world!' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
