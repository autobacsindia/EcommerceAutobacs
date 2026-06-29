import { asyncHandler } from '../middleware/errorMiddleware.js';
import AppError from '../utils/AppError.js';
import loyaltyConfigRepository from '../repositories/loyaltyConfigRepository.js';
import karmaService from '../services/karmaService.js';
import { getLoyaltyConfig, invalidateLoyaltyConfig } from '../services/loyaltyConfigService.js';

// Settings safe to expose to the storefront (redemption-facing only).
function publicConfig(cfg) {
  return {
    enabled: cfg.enabled,
    pointValueInRupees: cfg.pointValueInRupees,
    redeemMaxPercent: cfg.redeemMaxPercent,
    minRedeemPoints: cfg.minRedeemPoints,
    earnRatePercent: cfg.earnRatePercent
  };
}

// @desc    Current user's karma balance + storefront loyalty settings
// @route   GET /loyalty/me
// @access  Private
export const getMyKarma = asyncHandler(async (req, res) => {
  const [balance, cfg] = await Promise.all([
    karmaService.getBalance(req.user.id),
    getLoyaltyConfig()
  ]);
  res.json({ success: true, balance, config: publicConfig(cfg) });
});

// @desc    Current user's karma ledger history (paginated)
// @route   GET /loyalty/history
// @access  Private
export const getMyKarmaHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await karmaService.getHistory(req.user.id, { page: Number(page), limit: Number(limit) });
  res.json({ success: true, ...result });
});

// @desc    Read full loyalty config (admin)
// @route   GET /admin/loyalty/config
// @access  Private/Admin
export const getConfig = asyncHandler(async (req, res) => {
  const cfg = await loyaltyConfigRepository.getSingleton();
  res.json({ success: true, config: cfg });
});

// @desc    Update loyalty config (admin); invalidates the cached snapshot
// @route   PUT /admin/loyalty/config
// @access  Private/Admin
export const updateConfig = asyncHandler(async (req, res) => {
  const FIELDS = ['enabled', 'earnRatePercent', 'pointsExpiryDays',
    'pointValueInRupees', 'redeemMaxPercent', 'minRedeemPoints'];
  const update = {};
  for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];

  const cfg = await loyaltyConfigRepository.update(update);
  invalidateLoyaltyConfig();
  res.json({ success: true, config: cfg });
});

// @desc    Manually adjust a user's karma balance (admin)
// @route   POST /admin/loyalty/users/:userId/adjust
// @access  Private/Admin
export const adjustUserKarma = asyncHandler(async (req, res) => {
  const { points, description } = req.body;
  if (points === undefined) throw new AppError('points is required', 400);
  const result = await karmaService.adjust(req.params.userId, points, description, req.user.id);
  res.json({ success: true, ...result });
});
