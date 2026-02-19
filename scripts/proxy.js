import http from "http";
import httpProxy from "http-proxy";
import fs from "fs";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
config.sort((a, b) => b.prefix.length - a.prefix.length);

const port = Number(process.env.PROXY_PORT) || 8080;
const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
  const { url } = req;
  for (const r of config) {
    if (url.startsWith(r.prefix)) {
      return proxy.web(req, res, { target: r.upstream });
    }
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
