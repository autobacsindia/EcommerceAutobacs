import mongoose from "mongoose";

const ProductQuestionSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  userName: {
    type: String,
    required: true
  },
  email: {
    type: String
  },
  question: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  answer: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ["pending", "answered", "rejected"],
    default: "pending"
  },
  isPublic: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

export default mongoose.model("ProductQuestion", ProductQuestionSchema);
