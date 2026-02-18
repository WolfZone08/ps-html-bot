import http from "http";

export function startServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
  });
  server.listen(port, () => console.log("HTTP server:", port));
}
