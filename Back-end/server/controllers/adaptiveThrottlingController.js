import AdaptiveThrottlingProfile from '../models/AdaptiveThrottlingProfile.js';
import adaptiveThrottlingService from '../services/adaptiveThrottlingService.js';

/**
 * @route   GET /admin/adaptive-throttling/profiles
 * @desc    Get all throttling profiles
 * @access  Admin only
 */
export const getAllProfiles = async (req, res) => {
  try {
    const profiles = await AdaptiveThrottlingProfile.find()
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: profiles.length,
      profiles
    });
  } catch (error) {
    console.error('Error getting profiles:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving throttling profiles',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/adaptive-throttling/profiles/:id
 * @desc    Get single throttling profile
 * @access  Admin only
 */
export const getProfile = async (req, res) => {
  try {
    const profile = await AdaptiveThrottlingProfile.findById(req.params.id)
      .populate('createdBy', 'name email');
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }
    
    res.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error('Error getting profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving profile',
      error: error.message
    });
  }
};

/**
 * @route   POST /admin/adaptive-throttling/profiles
 * @desc    Create new throttling profile
 * @access  Admin only
 */
export const createProfile = async (req, res) => {
  try {
    const profileData = {
      ...req.body,
      createdBy: req.user._id
    };
    
    const profile = await AdaptiveThrottlingProfile.create(profileData);
    
    console.log(`✓ Created adaptive throttling profile: ${profile.name} by ${req.user.email}`);
    
    res.status(201).json({
      success: true,
      message: 'Profile created successfully',
      profile
    });
  } catch (error) {
    console.error('Error creating profile:', error);
    res.status(400).json({
      success: false,
      message: 'Error creating profile',
      error: error.message
    });
  }
};

/**
 * @route   PUT /admin/adaptive-throttling/profiles/:id
 * @desc    Update throttling profile
 * @access  Admin only
 */
export const updateProfile = async (req, res) => {
  try {
    const profile = await AdaptiveThrottlingProfile.findById(req.params.id);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }
    
    if (profile.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update active profile. Deactivate it first.'
      });
    }
    
    // Update allowed fields
    const allowedUpdates = ['name', 'description', 'endpointAdjustments', 'activationSchedule', 'safetyChecks'];
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        profile[field] = req.body[field];
      }
    });
    
    await profile.save();
    
    console.log(`✓ Updated adaptive throttling profile: ${profile.name} by ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(400).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
};

/**
 * @route   DELETE /admin/adaptive-throttling/profiles/:id
 * @desc    Delete throttling profile
 * @access  Admin only
 */
export const deleteProfile = async (req, res) => {
  try {
    const profile = await AdaptiveThrottlingProfile.findById(req.params.id);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }
    
    if (profile.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete active profile. Deactivate it first.'
      });
    }
    
    await profile.deleteOne();
    
    console.log(`✓ Deleted adaptive throttling profile: ${profile.name} by ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Profile deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting profile',
      error: error.message
    });
  }
};

/**
 * @route   POST /admin/adaptive-throttling/profiles/:id/activate
 * @desc    Activate a throttling profile
 * @access  Admin only
 */
export const activateProfile = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const profile = await adaptiveThrottlingService.activateProfile(
      req.params.id,
      req.user._id,
      reason || `Activated by ${req.user.email}`
    );
    
    res.json({
      success: true,
      message: `Profile "${profile.name}" activated successfully`,
      profile,
      activeProfileInfo: adaptiveThrottlingService.getActiveProfileInfo()
    });
  } catch (error) {
    console.error('Error activating profile:', error);
    res.status(400).json({
      success: false,
      message: 'Error activating profile',
      error: error.message
    });
  }
};

/**
 * @route   POST /admin/adaptive-throttling/deactivate
 * @desc    Deactivate current throttling profile
 * @access  Admin only
 */
export const deactivateProfile = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const profile = await adaptiveThrottlingService.deactivateProfile(
      req.user._id,
      reason || `Deactivated by ${req.user.email}`
    );
    
    res.json({
      success: true,
      message: `Profile "${profile.name}" deactivated successfully`,
      profile
    });
  } catch (error) {
    console.error('Error deactivating profile:', error);
    res.status(400).json({
      success: false,
      message: 'Error deactivating profile',
      error: error.message
    });
  }
};

/**
 * @route   GET /admin/adaptive-throttling/status
 * @desc    Get current throttling status
 * @access  Admin only
 */
export const getStatus = async (req, res) => {
  try {
    const activeProfileInfo = adaptiveThrottlingService.getActiveProfileInfo();
    
    res.json({
      success: true,
      isActive: adaptiveThrottlingService.isProfileActive(),
      activeProfile: activeProfileInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving throttling status',
      error: error.message
    });
  }
};

/**
 * @route   POST /admin/adaptive-throttling/profiles/presets/flash-sale
 * @desc    Create preset profile for flash sales
 * @access  Admin only
 */
export const createFlashSalePreset = async (req, res) => {
  try {
    const profile = await AdaptiveThrottlingProfile.create({
      name: 'Flash Sale',
      description: 'Optimized limits for flash sale events with increased checkout capacity',
      endpointAdjustments: [
        {
          endpointPattern: '/checkout.*',
          originalLimit: 60,
          multiplier: 2.5,
          absoluteMaxLimit: 150
        },
        {
          endpointPattern: '/orders.*',
          originalLimit: 60,
          multiplier: 2.5,
          absoluteMaxLimit: 150
        },
        {
          endpointPattern: '/payment.*',
          originalLimit: 60,
          multiplier: 2.5,
          absoluteMaxLimit: 150
        },
        {
          endpointPattern: '/cart.*',
          originalLimit: 600,
          multiplier: 1.7,
          absoluteMaxLimit: 1000
        },
        {
          endpointPattern: '/products.*',
          originalLimit: 300,
          multiplier: 1.3,
          absoluteMaxLimit: 400
        }
      ],
      createdBy: req.user._id
    });
    
    res.status(201).json({
      success: true,
      message: 'Flash Sale preset created',
      profile
    });
  } catch (error) {
    console.error('Error creating preset:', error);
    res.status(400).json({
      success: false,
      message: 'Error creating preset',
      error: error.message
    });
  }
};

export default {
  getAllProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile,
  deactivateProfile,
  getStatus,
  createFlashSalePreset
};
