declare module "express-mongo-sanitize" {
  import { RequestHandler } from "express";
  function sanitize(options?: Record<string, unknown>): RequestHandler;
  namespace sanitize {}
  export = sanitize;
}
