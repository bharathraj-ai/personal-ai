const express = require('express');
const app = express();

// Define the /hello endpoint
app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, world!' });
});

// Start the server only when this file is run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = app;
