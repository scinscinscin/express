import express, { NextFunction, Request, Response } from "express";
import formidable from "formidable";
import { ERPCError } from "../error";
import { unflatten } from "flat";

const jsonParser = express.json();

/**
 * Custom body-parser that either sends the request to express.json() or formidable
 * depending on the content-type header.
 */
export function bodyParser(req: Request, res: Response, next: NextFunction) {
  if (req.headers["content-type"]?.startsWith("multipart")) {
    const form = formidable({ multiples: true });

    return form.parse(req, (err, fields, files) => {
      if (err) {
        next(new ERPCError({ code: "BAD_REQUEST", message: "Was not able to process multipart/form-data request" }));
      } else {
        const then = { ...fields, ...files };
        req.body = unflatten(then, { object: false, delimiter: ".", overwrite: false });

        next();
      }
    });
  } else {
    return jsonParser(req, res, next);
  }
}
