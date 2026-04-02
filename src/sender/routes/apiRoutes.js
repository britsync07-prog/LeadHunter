import express from 'express';
import { getCampaignAnalytics, getAccountAnalytics, getCampaignHistory } from '../controllers/analyticsController.js';
import { launchCampaign, getCampaignDetails, updateCampaign, deleteCampaign } from '../controllers/campaignController.js';
import { getSmtpAccounts, addSmtpAccount, deleteSmtpAccount } from '../controllers/smtpController.js';

const router = express.Router();

// --- Analytics Endpoints ---
router.get('/analytics/account', getAccountAnalytics);
router.get('/analytics/history', getCampaignHistory);
router.get('/analytics/:campaignId', getCampaignAnalytics);

// --- Campaign Management Endpoints ---
router.post('/campaigns', express.json({ limit: '50mb' }), launchCampaign);
router.get('/campaigns/:id', getCampaignDetails);
router.patch('/campaigns/:id', express.json({ limit: '50mb' }), updateCampaign);
router.delete('/campaigns/:id', deleteCampaign);

// --- Admin Multi-SMTP Endpoints ---
router.get('/smtp', getSmtpAccounts);
router.post('/smtp', express.json(), addSmtpAccount);
router.delete('/smtp/:id', deleteSmtpAccount);

export default router;
