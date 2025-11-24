import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { validateRegister, validateLogin } from "../middleware/validationMiddleware.js";
import { registerRateLimit, loginRateLimit, failedLoginRateLimit } from "../middleware/rateLimitMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  );
};

// @route   POST /auth/register
// @desc    Register a new user
// @access  Public
router.post("/register", registerRateLimit, validateRegister, asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ 
      success: false,
      message: "User with this email already exists" 
    });
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  // Create user
  const newUser = new User({ 
    name: name.trim(), 
    email: email.toLowerCase(), 
    passwordHash 
  });
  await newUser.save();

  // Generate token
  const token = generateToken(newUser);

  res.status(201).json({ 
    success: true,
    message: "User registered successfully",
    token,
    user: { 
      id: newUser._id, 
      name: newUser.name, 
      email: newUser.email, 
      role: newUser.role 
    }
  });
}));

// @route   POST /auth/login
// @desc    Authenticate user and get token
// @access  Public
router.post("/login", loginRateLimit, validateLogin, asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    // Apply failed login rate limiting
    return failedLoginRateLimit(req, res, async () => {
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    });
  }

  // Compare password
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    // Apply failed login rate limiting
    return failedLoginRateLimit(req, res, async () => {
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    });
  }

  // Generate token
  const token = generateToken(user);

  res.json({
    success: true,
    message: "Login successful",
    token,
    user: { 
      id: user._id, 
      name: user.name, 
      email: user.email, 
      role: user.role 
    }
  });
}));

// @route   GET /auth/me
// @desc    Get current user profile
// @access  Private
router.get("/me", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash');
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    user
  });
}));

export default router;