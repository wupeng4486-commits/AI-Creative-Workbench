import { buildApp } from "./app.ts";
import { createConfig } from "./config.ts";

const config = createConfig();
const app = await buildApp({ config });

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.warn(`AI Creative Workbench 已启动：http://${config.host}:${config.port}`);
  app.log.warn(`数据目录：${config.dataDir}`);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    console.error(
      `端口 ${config.port} 已被其他程序占用。请关闭占用该端口的程序，或使用 APP_PORT 指定其他端口。`,
    );
  } else {
    console.error("本机服务启动失败：", error);
  }
  process.exit(1);
}
