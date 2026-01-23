import express from "express";
import ProductQuestion from "../models/ProductQuestion.js";
import Product from "../models/Product.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";

const router = express.Router();

// @desc    Submit a question
// @route   POST /api/product-questions
// @access  Public
router.post("/", asyncHandler(async (req, res) => {
  const { productId, question, userName, email } = req.body;

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  const productQuestion = await ProductQuestion.create({
    product: productId,
    user: req.user ? req.user._id : undefined,
    userName: req.user ? req.user.name : userName,
    email: req.user ? req.user.email : email,
    question
  });

  res.status(201).json({
    success: true,
    data: productQuestion,
    message: "Question submitted successfully. It will be answered shortly."
  });
}));

// @desc    Get questions for a product (Public - only answered/public ones)
// @route   GET /api/product-questions/product/:productId
// @access  Public
router.get("/product/:productId", asyncHandler(async (req, res) => {
  const questions = await ProductQuestion.find({
    product: req.params.productId,
    isPublic: true,
    status: "answered"
  }).sort("-createdAt");

  res.json({
    success: true,
    count: questions.length,
    data: questions
  });
}));

// @desc    Get all questions (Admin)
// @route   GET /api/product-questions/admin
// @access  Private/Admin
router.get("/admin", protect, admin, asyncHandler(async (req, res) => {
  const pageSize = 20;
  const page = Number(req.query.pageNumber) || 1;
  const status = req.query.status;

  const filter = {};
  if (status) filter.status = status;

  const count = await ProductQuestion.countDocuments(filter);
  const questions = await ProductQuestion.find(filter)
    .populate("product", "name")
    .sort("-createdAt")
    .limit(pageSize)
    .skip(pageSize * (page - 1));

  res.json({
    success: true,
    data: questions,
    page,
    pages: Math.ceil(count / pageSize)
  });
}));

// @desc    Answer a question
// @route   PUT /api/product-questions/:id/answer
// @access  Private/Admin
router.put("/:id/answer", protect, admin, asyncHandler(async (req, res) => {
  const { answer, isPublic } = req.body;
  
  const question = await ProductQuestion.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found");
  }

  question.answer = answer;
  question.status = "answered";
  question.isPublic = isPublic !== undefined ? isPublic : true;
  
  await question.save();

  // Optionally push to Product.qna for legacy support
  // const product = await Product.findById(question.product);
  // if (product) {
  //   product.qna.push({ question: question.question, answer: question.answer });
  //   await product.save();
  // }

  res.json({
    success: true,
    data: question
  });
}));

// @desc    Delete a question
// @route   DELETE /api/product-questions/:id
// @access  Private/Admin
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
  const question = await ProductQuestion.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found");
  }

  await ProductQuestion.deleteOne({ _id: question._id });

  res.json({
    success: true,
    message: "Question deleted successfully"
  });
}));

export default router;
