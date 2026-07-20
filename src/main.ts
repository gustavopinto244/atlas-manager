import { createApp } from "./http/create-app.js";

const host = "127.0.0.1";
const port = 3000;
const app = createApp();

app.listen(port, host, () => {
  console.log(`Atlas Manager is listening on http://${host}:${port}.`);
});
