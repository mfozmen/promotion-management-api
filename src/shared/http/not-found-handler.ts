import type { RequestHandler } from 'express';
import createError from 'http-errors';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is withheld while a rejected key is returned: a key is something
  // the caller can fix, a path they already have is not.
  next(createError(404, 'Route not found'));
};
