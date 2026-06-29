import mongoose from "mongoose";
import dotenv from "dotenv";
import Wishlist from "../../models/Wishlist.js";

dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const fixWishlistValidation = async () => {
  try {
    await connectDB();
    
    // Find all wishlists without a name field
    const wishlists = await Wishlist.find({ 
      $or: [
        { name: { $exists: false } },
        { name: null },
        { name: "" }
      ]
    });
    
    console.log(`Found ${wishlists.length} wishlists without valid names`);
    
    // Fix each wishlist by adding a default name
    for (const wishlist of wishlists) {
      console.log(`Fixing wishlist ${wishlist._id}`);
      wishlist.name = `Wishlist ${wishlist._id}`;
      await wishlist.save();
      console.log(`Fixed wishlist ${wishlist._id}`);
    }
    
    console.log('All wishlists fixed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing wishlists:', error);
    process.exit(1);
  }
};

fixWishlistValidation();