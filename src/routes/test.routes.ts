import { Router } from 'express';
import { testStorage } from '../controllers/test.controller';

const router = Router();

router.get('/storage', testStorage);

export default router;
