import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv.includes("--dist") ? "dist" : "public");
const port = Number(process.env.PORT || 4179);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function resolvePath(urlPath) {
  let pathname = decodeURIComponent(urlPath.split("?")[0]);
  if (!pathname.includes(".") && !pathname.endsWith("/")) pathname += "/";
  if (pathname.endsWith("/")) pathname += "index.html";
  const full = normalize(join(root, pathname));
  if (!full.startsWith(root)) return "";
  if (existsSync(full)) return full;
  return join(root, "404.html");
}

const server = createServer(async (request, response) => {
  try {
    const file = resolvePath(request.url || "/");
    const body = await readFile(file);
    response.writeHead(file.endsWith("404.html") ? 404 : 200, {
      "Content-Type": types[extname(file)] || "application/octet-stream"
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.message);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`War Risk Index local server: http://127.0.0.1:${port}/`);
});
