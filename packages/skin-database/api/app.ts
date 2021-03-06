import router from "./router";
import fileUpload from "express-fileupload";
import cors, { CorsOptions } from "cors";
import bodyParser from "body-parser";
import Sentry from "@sentry/node";
import expressSitemapXml from "express-sitemap-xml";
import * as Skins from "../data/skins";
import express from "express";
import UserContext from "../data/UserContext";

export type ApiAction =
  | { type: "REVIEW_REQUESTED"; md5: string }
  | { type: "SKIN_UPLOADED"; md5: string }
  | { type: "ERROR_PROCESSING_UPLOAD"; id: string; message: string };

export type EventHandler = (event: ApiAction, ctx: UserContext) => void;

// Add UserContext to req objects globally
declare global {
  namespace Express {
    interface Request {
      ctx: UserContext;
      notify(action: ApiAction): void;
      log(message: string): void;
      logError(message: string): void;
    }
  }
}

export function createApp(eventHandler?: EventHandler) {
  const app = express();
  if (Sentry) {
    app.use(Sentry.Handlers.requestHandler());
  }

  // Add UserContext to request
  app.use((req, res, next) => {
    req.ctx = new UserContext();
    next();
    // TODO: Dispose of context?
  });

  // Attach event handler
  app.use((req, res, next) => {
    req.notify = (action) => {
      if (eventHandler) {
        eventHandler(action, req.ctx);
      }
    };
    next();
  });

  // Attach logger
  app.use((req, res, next) => {
    const context = { url: req.url, params: req.params, query: req.query };
    req.log = (message) => console.log(message, context);
    req.logError = (message) => console.error(message, context);
    next();
  });

  // Configure CORs
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // Configure json output
  app.set("json spaces", 2);

  // parse application/json
  app.use(bodyParser.json());

  // Configure File Uploads
  const limits = { fileSize: 50 * 1024 * 1024 };
  app.use(fileUpload({ limits }));

  // Configure sitemap
  app.use(expressSitemapXml(getSitemapUrls, "https://skins.webamp.org"));

  // Add routes
  app.use("/", router);

  // The error handler must be before any other error middleware and after all controllers
  if (Sentry) {
    app.use(Sentry.Handlers.errorHandler());
  }

  // Optional fallthrough error handler
  app.use(function onError(err, req, res, next) {
    res.statusCode = 500;
    res.json({ errorId: res.sentry, message: err.message });
  });

  return app;
}

async function getSitemapUrls() {
  const md5s = await Skins.getAllClassicSkins();
  const skinUrls = md5s.map(({ md5, fileName }) => `skin/${md5}/${fileName}`);
  return ["/about", "/", "/upload", ...skinUrls];
}

const allowList = [
  /https:\/\/skins\.webamp\.org/,
  /http:\/\/localhost:3000/,
  /netlify.app/,
];

const corsOptions: CorsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowList.some((regex) => regex.test(origin))) {
      callback(null, true);
    } else {
      callback(
        new Error(`Request from origin "${origin}" not allowed by CORS.`)
      );
    }
  },
};
