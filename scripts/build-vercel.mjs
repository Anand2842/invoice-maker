import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

console.log("==> Building application via vinext...");
const build = spawnSync("node", ["scripts/run-framework.mjs", "build"], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

console.log("==> Packaging for Vercel Build Output API v3...");
const outputDir = resolve(root, ".vercel/output");
const staticDir = resolve(outputDir, "static");
const apiFuncDir = resolve(outputDir, "functions/api.func");

mkdirSync(staticDir, { recursive: true });
mkdirSync(apiFuncDir, { recursive: true });

// 1. Copy client assets to static
cpSync(resolve(root, "dist/client"), staticDir, { recursive: true });

// 2. Copy server bundle into api.func
cpSync(resolve(root, "dist/server"), apiFuncDir, { recursive: true });

// 3. Write api.func metadata
writeFileSync(
  resolve(apiFuncDir, "package.json"),
  JSON.stringify({ type: "module" }, null, 2)
);

writeFileSync(
  resolve(apiFuncDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "entry.js",
      launcherType: "Nodejs",
    },
    null,
    2
  )
);

const entryJs = `import server from "./index.js";

export default async function handler(req, res) {
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const url = \`\${protocol}://\${host}\${req.url}\`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    const hasBody = !["GET", "HEAD"].includes(req.method || "");
    let body = null;
    if (hasBody) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (new URL(url).pathname.replace(/\\/$/, "") === "/mcp" && bytes > 100 * 1024) {
          res.statusCode = 413;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ error: "The MCP request exceeds 100 KB." }));
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      body,
      duplex: hasBody ? "half" : undefined,
    });

    const response = await server.fetch(request, {}, {});

    res.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() !== "set-cookie") {
        res.setHeader(key, value);
      }
    }
    if (typeof response.headers.getSetCookie === "function") {
      const cookies = response.headers.getSetCookie();
      if (cookies && cookies.length > 0) {
        res.setHeader("Set-Cookie", cookies);
      }
    } else {
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        res.setHeader("Set-Cookie", setCookie);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
`;

writeFileSync(resolve(apiFuncDir, "entry.js"), entryJs);

// 4. Global routing config
const config = {
  version: 3,
  routes: [
    {
      src: "^/api(?:/.*)?$",
      dest: "/api",
    },
    {
      src: "^/(?:(.+)/)?index(?:\\.html)?/?$",
      headers: {
        Location: "/$1",
      },
      status: 308,
    },
    // Clean URLs for pages, but not the invoice editor's HTML fragments: invoice-app.js fetches them by their .html
    // name, and nothing serves the extensionless URL a redirect would send it to (the editor 404s).
    {
      src: "^/(?!free-online-invoice-generator/)(.*)\\.html/?$",
      headers: {
        Location: "/$1",
      },
      status: 308,
    },
    {
      handle: "filesystem",
    },
    // Dynamic pages (dashboard, recovery and protected recipient routes) also
    // require the server after the static lookup, not a static 404 fallback.
    {
      src: "^/.*$",
      dest: "/api",
    },
    {
      handle: "error",
    },
    {
      status: 404,
      src: "^(?!/api).*$",
      dest: "/404",
    },
  ],
};

writeFileSync(resolve(outputDir, "config.json"), JSON.stringify(config, null, 2));
console.log("==> Vercel build complete in .vercel/output");

