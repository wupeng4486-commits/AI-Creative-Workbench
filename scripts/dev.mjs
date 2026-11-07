import { spawn } from "node:child_process";

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} exited with ${code}`);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("server", "npm", ["run", "start:local"]);
run("web", "npm", ["run", "dev", "--workspace", "@workbench/web"]);
