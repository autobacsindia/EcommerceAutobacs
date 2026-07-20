import express from "express";
import productQuestionRepository from "../repositories/productQuestionRepository.js";
import Product from "../models/Product.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { 
  validateProductQuestion, 
  validateProductQuestionAnswer, 
  validateProductQuestionQuery,
  validateIdParam,
  validateProductIdParam
} from "../middleware/validationMiddleware.js";
import { cleanHTML } from "../utils/htmlSanitizer.js";
import { questionSubmitRateLimit, questionAnswerRateLimit } from "../middleware/rateLimitMiddleware.js";
import { httpCache } from "../middleware/httpCache.js";
import { invalidateCache } from "../middleware/cacheMiddleware.js";
import { revalidateFrontendTags } from "../services/frontendRevalidator.js";

const router = express.Router();

// Clear the public Q&A cache for one product and refresh its PDP (which lists
// answered questions). Answering/deleting are the only writes that change what
// the public GET returns.
const invalidateQuestionCaches = async (productId) => {
  if (!productId) return;
  invalidateCache(`questions:product:${productId}`);
  const product = await Product.findById(productId).select('slug');
  if (product?.slug) revalidateFrontendTags([`product:${product.slug}`]);
};

// @desc    Submit a question
// @route   POST /api/product-questions
// @access  Public
router.post("/", questionSubmitRateLimit, validateProductQuestion, asyncHandler(async (req, res) => {
  const { productId, question, userName, email } = req.body;

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  const productQuestion = await productQuestionRepository.create({
    product: productId,
    user: req.user ? req.user._id : undefined,
    userName: req.user ? req.user.name : userName,
    email: req.user ? req.user.email : email,
    question: cleanHTML(question)
  });

  res.status(201).json({
    success: true,
    data: productQuestion,
    message: "Question submitted successfully. It will be answered shortly."
  });
}));

// @desc    Get questions for a product (Public - only answered/public ones)
// @route   GET /api/product-questions/product/:id
// @access  Public
router.get("/product/:id", validateProductIdParam, httpCache('QA_PRODUCT'), asyncHandler(async (req, res) => {
  const questions = await productQuestionRepository.find({
    product: req.params.id,
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
router.get("/admin", protect, admin, validateProductQuestionQuery, asyncHandler(async (req, res) => {
  const pageSize = 20;
  const page = Number(req.query.pageNumber) || 1;
  const status = req.query.status;

  const filter = {};
  if (status) filter.status = status;

  const count = await productQuestionRepository.countDocuments(filter);
  const questions = await productQuestionRepository.find(filter)
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
router.put("/:id/answer", protect, admin, questionAnswerRateLimit, validateIdParam, validateProductQuestionAnswer, asyncHandler(async (req, res) => {
  const { answer, isPublic } = req.body;
  
  const question = await productQuestionRepository.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found");
  }

  question.answer = cleanHTML(answer);
  question.status = "answered";
  question.isPublic = isPublic !== undefined ? isPublic : true;
  
  await question.save();

  // Q&A lives solely in the ProductQuestion collection. The legacy embedded
  // Product.qna field was removed; questions are read back via this route's GET.
  await invalidateQuestionCaches(question.product);

  res.json({
    success: true,
    data: question
  });
}));

// @desc    Delete a question
// @route   DELETE /api/product-questions/:id
// @access  Private/Admin
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
  const question = await productQuestionRepository.findById(req.params.id);

  if (!question) {
    res.status(404);
    throw new Error("Question not found");
  }

  await productQuestionRepository.deleteOne({ _id: question._id });
  await invalidateQuestionCaches(question.product);

  res.json({
    success: true,
    message: "Question deleted successfully"
  });
}));

export default router;
