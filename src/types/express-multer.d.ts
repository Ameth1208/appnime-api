/* eslint-disable @typescript-eslint/no-empty-interface */
// Workaround: @types/multer@2 augments global.Express.Multer but the
// augmentation fails to merge under TS 7 + nodenext + pnpm hoisting.
// Re-declare the namespace so Express.Multer.File is available everywhere.
declare global {
  namespace Express {
    // Extend the existing Express namespace with a Multer sub-namespace
  }
}

// Use declaration merging to add Multer to the existing Express global
declare global {
  namespace Express {
    namespace Multer {
      interface File {
        fieldname: string;
        originalname: string;
        encoding: string;
        mimetype: string;
        size: number;
        destination?: string;
        filename?: string;
        path?: string;
        buffer: Buffer;
      }
    }
  }
}

export {};
