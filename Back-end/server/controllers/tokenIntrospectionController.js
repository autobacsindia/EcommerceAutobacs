import { introspectToken, batchIntrospectTokens, getUserSessions, revokeToken } from '../services/tokenIntrospection.js';

/**
 * @route   POST /admin/token/introspect
 * @desc    Introspect a token and return validation details
 * @access  Admin only
 */
export const introspect = async (req, res) => {
  try {
    const { token, token_type_hint = 'access_token', reason } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }
    
    // Log introspection attempt for audit
    console.log(`[Token Introspection] Admin ${req.user.email} introspecting ${token_type_hint}${reason ? ` - Reason: ${reason}` : ''}`);
    
    const result = await introspectToken(token, token_type_hint);
    
    // Log to audit trail (could be extended to a dedicated audit log)
    if (result.success) {
      console.log(`[Token Introspection] Result: ${result.active ? 'Active' : 'Inactive'} - User: ${result.user_id || 'N/A'}`);
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('Token introspection error:', error);
    res.status(500).json({
      success: false,
      message: 'Error introspecting token',
      error: error.message
    });
  }
};

/**
 * @route   POST /admin/token/introspect/batch
 * @desc    Introspect multiple tokens in a single request
 * @access  Admin only
 */
export const batchIntrospect = async (req, res) => {
  try {
    const { tokens } = req.body;
    
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tokens array is required'
      });
    }
    
    if (tokens.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 tokens can be introspected at once'
      });
    }
    
    console.log(`[Batch Introspection] Admin ${req.user.email} introspecting ${tokens.length} tokens`);
    
    const results = await batchIntrospectTokens(tokens);
    
    res.json({
      success: true,
      count: results.length,
      results
    });
    
  } catch (error) {
    console.error('Batch introspection error:', error);
    res.status(500).json({
      success: false,
      message: 'Error batch introspecting tokens',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/token/sessions/:userId
 * @desc    Get all active sessions for a user
 * @access  Admin only
 */
export const getUserSessionsController = async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`[User Sessions] Admin ${req.user.email} requesting sessions for user ${userId}`);
    
    const result = await getUserSessions(userId);
    
    res.json(result);
    
  } catch (error) {
    console.error('Get user sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving user sessions',
      error: error.message
    });
  }
};

/**
 * @route   POST /admin/token/revoke
 * @desc    Revoke a specific refresh token
 * @access  Admin only
 */
export const revokeTokenController = async (req, res) => {
  try {
    const { token, userId, reason } = req.body;
    
    if (!token || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Token and userId are required'
      });
    }
    
    console.log(`[Token Revocation] Admin ${req.user.email} revoking token for user ${userId}${reason ? ` - Reason: ${reason}` : ''}`);
    
    const result = await revokeToken(token, userId);
    
    if (result.success) {
      console.log(`[Token Revocation] Successfully revoked token for user ${userId}`);
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('Token revocation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error revoking token',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/token/stats
 * @desc    Get token usage statistics
 * @access  Admin only
 */
export const getTokenStats = async (req, res) => {
  try {
    const User = (await import('../models/User.js')).default;
    
    // Aggregate statistics
    const stats = await User.aggregate([
      {
        $project: {
          email: 1,
          role: 1,
          activeSessionCount: {
            $size: {
              $filter: {
                input: '$refreshTokens',
                as: 'token',
                cond: { $gt: ['$$token.expiresAt', new Date()] }
              }
            }
          },
          totalSessionCount: { $size: '$refreshTokens' },
          lastLoginAt: 1
        }
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          totalActiveSessions: { $sum: '$activeSessionCount' },
          avgSessionsPerUser: { $avg: '$activeSessionCount' },
          usersWithMultipleSessions: {
            $sum: { $cond: [{ $gt: ['$activeSessionCount', 1] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      stats: stats[0] || {
        totalUsers: 0,
        totalActiveSessions: 0,
        avgSessionsPerUser: 0,
        usersWithMultipleSessions: 0
      }
    });
    
  } catch (error) {
    console.error('Get token stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving token statistics',
      error: error.message
    });
  }
};

export default {
  introspect,
  batchIntrospect,
  getUserSessionsController,
  revokeTokenController,
  getTokenStats
};
