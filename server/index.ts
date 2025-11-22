import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
  
// Optional detailed logging for client (non-API) requests to help debug routing
// Enable by setting DEBUG_CLIENT_REQUESTS=true in the environment.
app.use((req, _res, next) => {
  try {
    if (!process.env.DEBUG_CLIENT_REQUESTS) return next();
    const p = req.path || '';
    // Skip API and vite internal websocket/hmr routes
    if (p.startsWith('/api') || p.startsWith('/__vite') || p.startsWith('/sockjs') || p.startsWith('/hmr')) return next();
    const ua = String(req.headers['user-agent'] || '').replace(/\n/g, ' ');
    const ref = String(req.headers['referer'] || req.headers['referrer'] || '').replace(/\n/g, ' ');
    const accept = String(req.headers['accept'] || '');
    const host = String(req.headers['host'] || '');
    console.log(`[CLIENT-DBG] ${req.method} ${req.originalUrl} host=${host} ip=${req.ip} ua="${ua}" referer="${ref}" accept="${accept}"`);
  } catch (e) {
    // don't block the request flow if logging fails
  }
  return next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
