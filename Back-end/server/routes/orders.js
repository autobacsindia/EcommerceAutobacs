import express from "express";
import Order from "../models/Order.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

// Protected route: get all orders for logged-in user
router.get("/", authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Protected route: create new order
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { items, totalAmount } = req.body;
    const newOrder = new Order({
      userId: req.user.id,
      items,
      totalAmount
    });
    await newOrder.save();
    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

export default router;
