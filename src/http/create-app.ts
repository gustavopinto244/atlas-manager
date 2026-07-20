import express, { type Express } from "express";

import {
  createErrorHandler,
  type HttpErrorLogger,
} from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";

export function createApp(logger: HttpErrorLogger): Express {
  const app = express();

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
