import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    if (process.env.DEBUG_CLIENT_REQUESTS) {
      log(`VITE-SERVE: serving index for ${url} ua="${String(req.headers['user-agent']||'')}" referer="${String(req.headers['referer']||req.headers['referrer']||'')}"`, 'vite');
    }
    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      let page = await vite.transformIndexHtml(url, template);

      // Inject a tiny dev-only client reporter when DEBUG_CLIENT_REQUESTS is enabled.
      // This posts location and any uncaught errors/console.error to the server
      // so developers can see why the SPA route rendered NotFound.
      if (process.env.DEBUG_CLIENT_REQUESTS) {
        // Improved dev reporter:
        // - uses fetch (JSON) for reliable parsing on the server
        // - reports boot, errors, unhandledrejection, console.error
        // - captures SPA navigations by patching history.pushState/replaceState and listening to popstate
        const reporter = `\n<script>(function(){try{const send=(p)=>{try{fetch('/__debug/client-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).catch(()=>{});}catch(e){} };const base=()=>({pathname:location.pathname,href:location.href,ua:navigator.userAgent,lang:navigator.language,ts:new Date().toISOString()});try{send(Object.assign({type:'boot'},base()));}catch(e){};window.addEventListener('error',function(e){try{send(Object.assign({type:'error',message:e.message,stack:e.error?e.error.stack:null},base()));}catch(e){} });window.addEventListener('unhandledrejection',function(e){try{send(Object.assign({type:'unhandledrejection',reason:String(e.reason)},base()));}catch(e){} });const origConsoleError=console.error;console.error=function(){try{const args=Array.from(arguments).map(a=>{try{return typeof a==='string'?a:JSON.stringify(a);}catch(e){return String(a);} });send(Object.assign({type:'console.error',args},base()));}catch(e){};origConsoleError.apply(console,arguments);};(function(){var _push=history.pushState;history.pushState=function(){try{_push.apply(this,arguments);}catch(e){};try{send(Object.assign({type:'navigate',method:'pushState',args:Array.from(arguments)},base()));}catch(e){} };var _replace=history.replaceState;history.replaceState=function(){try{_replace.apply(this,arguments);}catch(e){};try{send(Object.assign({type:'navigate',method:'replaceState',args:Array.from(arguments)},base()));}catch(e){} };window.addEventListener('popstate',function(e){try{send(Object.assign({type:'navigate',method:'popstate',state:e.state||null},base()));}catch(e){};});})();console.debug && console.debug('client-reporter-active');}catch(e){}})();</script>`;
        page = page + reporter;
      }

      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (req, res) => {
    try {
      if (process.env.DEBUG_CLIENT_REQUESTS) {
        log(`STATIC-SERVE: serving index for ${req.originalUrl} ua="${String(req.headers['user-agent']||'')}" referer="${String(req.headers['referer']||req.headers['referrer']||'')}"`);
      }
    } catch (e) {}
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
