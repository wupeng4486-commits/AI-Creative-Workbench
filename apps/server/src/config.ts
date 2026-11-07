import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");

export interface AppConfig {
  dataDir: string;
  projectRoot: string;
  webDistDir: string;
  host: string;
  port: number;
  isProduction: boolean;
}

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.APP_DATA_DIR ?? path.join(projectRoot, "data"));
  return {
    dataDir,
    projectRoot,
    webDistDir: path.join(projectRoot, "apps", "web", "dist"),
    host: env.APP_HOST ?? "127.0.0.1",
    port: Number(env.APP_PORT ?? 4173),
    isProduction: env.NODE_ENV !== "development",
  };
}
