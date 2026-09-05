const express = require('express');
const app = express();

app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, world!' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;
