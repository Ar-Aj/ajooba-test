import { Router } from 'express';
import { catalogRouter } from './catalog.routes.js';

/**
 * API version 1 router.
 *
 * Every route under /v1 is mounted from its own sub-router so that new
 * resource groups can be added without changing this file's contract.
 */
export const v1Router: Router = Router();

v1Router.use('/catalog', catalogRouter);
