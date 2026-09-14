import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Router, type Request, type Response } from 'express';
import createError from 'http-errors';
import multer from 'multer';
import { hasSqlState } from '../../../shared/db/has-sql-state.js';
import { SqlState } from '../../../shared/db/sql-state.js';
import type { RegisterImportCommand } from '../commands/register-import-command.js';
import type { ImportStatusQuery } from '../queries/import-status-query.js';

/** Anything but one positive decimal integer names no import, which is a 404. */
const ID_PATTERN = /^[1-9]\d*$/;

/**
 * The vendor intake: a file arrives over HTTP and leaves as a registered import.
 *
 * The bytes go to disk as they arrive rather than through memory — a vendor file
 * is the 500 000-row one, and buffering it would put the whole upload in the heap
 * the worker is capped against.
 */
export function vendorImportRoutes(deps: {
  register: RegisterImportCommand;
  status: ImportStatusQuery;
  uploadDir: string;
  maxBytes: number;
}): Router {
  const router = Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: deps.uploadDir,
      // A name of ours, not the client's: a vendor-supplied filename is a path
      // traversal and a collision waiting to happen, and what is stored is a
      // name inside the upload directory that the worker resolves on its side.
      filename: (_req, file, done) => done(null, `${randomUUID()}${extname(file.originalname)}`),
    }),
    limits: { files: 1, fileSize: deps.maxBytes },
  }).single('file');

  router.post('/', (req: Request, res: Response, next) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          error.code === 'LIMIT_FILE_SIZE'
            ? createError(413, 'Vendor file is larger than this endpoint accepts')
            : createError(400, 'Invalid upload'),
        );
        return;
      }
      if (error !== undefined && error !== null) {
        next(error);
        return;
      }
      void registered(req, res, next, deps);
    });
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const raw = typeof req.params.id === 'string' ? req.params.id : '';
    const id = ID_PATTERN.test(raw) ? Number(raw) : Number.NaN;
    const found = Number.isSafeInteger(id) ? await deps.status.byId(id) : undefined;
    if (found === undefined) throw createError(404, 'No such import');

    res.status(200).json(found);
  });

  return router;
}

/** The registration itself, once multer has the file on disk. */
async function registered(
  req: Request,
  res: Response,
  next: (error?: unknown) => void,
  deps: { register: RegisterImportCommand },
): Promise<void> {
  try {
    if (req.file === undefined) throw createError(400, 'Attach the vendor file as `file`');

    const vendor = typeof req.body?.vendor === 'string' ? req.body.vendor.trim() : '';
    if (vendor === '') throw createError(400, 'Name the vendor in a `vendor` field');

    res.status(202).json(await deps.register.register(vendor, req.file.filename));
  } catch (error) {
    // The same bytes twice is a vendor resending, not a second import, and the
    // unique index on `file_sha256` is what decides it rather than a read first.
    next(
      hasSqlState(error, SqlState.uniqueViolation)
        ? createError(409, 'A file with these contents has already been registered')
        : error,
    );
  }
}
