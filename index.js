// Entry point on Vercel, which looks for a file that imports express and exports the application.
// The application itself is bundled into dist/ by `npm run build`.
import 'express';
import { app } from './dist/recall-check.mjs';

export default app;
