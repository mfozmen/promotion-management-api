import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import { Router, type Request, type Response } from 'express';
import createError from 'http-errors';
import multer from 'multer';
import { validate } from '../../../shared/http/request-validator.js';
import type { RegisterImportCommand } from '../commands/register-import-command.js';
import { importIdInput, type ImportIdInput } from '../domain/dto/import-id-input.js';
import type { ImportStatusQuery } from '../queries/import-status-query.js';

/** The reason a registration was refused, as a status and a sentence. */
const REFUSED = {
  'duplicate-file': [409, 'A file with these contents has already been registered'],
  'vendor-busy': [409, 'This vendor already has an import running; wait for it to finish'],
} as const;

/** Vendor intake: the bytes land on disk as they arrive, never in memory. */
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
      // A name of ours: a vendor-supplied one is a traversal and a collision.
      filename: (_req, file, done) => done(null, `${randomUUID()}${extname(file.originalname)}`),
    }),
    limits: { files: 1, fileSize: deps.maxBytes },
    // Refused at the door rather than becoming 500 000 rejected rows.
    fileFilter: (_req, file, done) => {
      if (extname(file.originalname).toLowerCase() === '.csv') {
        done(null, true);
        return;
      }
      done(createError(415, 'The vendor file must be a .csv'));
    },
  }).single('file');

  router.post('/', (req: Request, res: Response, next) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        void discard(req);
        next(
          error.code === 'LIMIT_FILE_SIZE'
            ? createError(413, 'Vendor file is larger than this endpoint accepts')
            : createError(400, 'Invalid upload'),
        );
        return;
      }
      if (error !== undefined && error !== null) {
        void discard(req);
        next(error);
        return;
      }
      void registered(req, res, next, deps.register);
    });
  });

  router.get('/:id', validate({ params: importIdInput }), async (req: Request, res: Response) => {
    const { id } = req.params as unknown as ImportIdInput;
    const found = await deps.status.byId(id);
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
  register: RegisterImportCommand,
): Promise<void> {
  try {
    if (req.file === undefined) throw createError(400, 'Attach the vendor file as `file`');

    const vendor = typeof req.body?.vendor === 'string' ? req.body.vendor.trim() : '';
    if (vendor === '') throw createError(400, 'Name the vendor in a `vendor` field');

    const outcome = await register.execute(vendor, req.file.filename);
    if (!outcome.ok) {
      const [status, message] = REFUSED[outcome.reason];
      throw createError(status, message);
    }

    res.status(202).json({ jobId: outcome.jobId, chunksTotal: outcome.chunksTotal });
  } catch (error) {
    await discard(req);
    next(error);
  }
}

/**
 * Nothing references an upload that was not registered, so a file left in the
 * upload directory is one no job, no sweep and no operator can reclaim.
 */
async function discard(req: Request): Promise<void> {
  if (req.file !== undefined) await rm(req.file.path, { force: true });
}
