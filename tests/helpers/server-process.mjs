import { buildApp } from "../../apps/server/dist/app.js";
import { createConfig } from "../../apps/server/dist/config.js";

const app = await buildApp({ config: createConfig() });
await app.listen({ host: "127.0.0.1", port: 0 });
console.log(`READY ${app.server.address().port}`);
process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
