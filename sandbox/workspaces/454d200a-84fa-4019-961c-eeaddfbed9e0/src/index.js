import { createApp } from "./server.js";

const PORT = process.env.PORT || 3100;

const app = await createApp();
app.listen(PORT, () => {
  console.log(`School management listening on port ${PORT}`);
});
