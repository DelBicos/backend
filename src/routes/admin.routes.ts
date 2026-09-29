import { Router } from 'express';
import { adminLogin, getAdminStats, listDisputes, resolveDispute, listVerifications, reviewVerification } from '../controllers/admin.controller';
import adminAuth from '../middlewares/admin.middleware';

const router = Router();

router.post('/login', adminLogin);
router.get('/stats', adminAuth, getAdminStats);

router.get('/disputes', adminAuth, listDisputes);
router.post('/disputes/:id/resolve', adminAuth, resolveDispute);

router.get('/verifications', adminAuth, listVerifications);
router.post('/verifications/:id/review', adminAuth, reviewVerification);

export default router;
