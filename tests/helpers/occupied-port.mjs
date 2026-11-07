import http from "node:http";
import path from "node:path";

const server = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({
    ok: true,
    app: "AI Creative Workbench",
    pid: process.pid,
    projectRoot: process.cwd(),
    dataDir: path.resolve(process.argv[2]),
  }));
});
server.listen(0, "127.0.0.1", () => console.log(`READY ${server.address().port}`));
