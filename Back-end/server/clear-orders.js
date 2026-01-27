import mongoose from "mongoose";
import dotenv from "dotenv";
import Order from "./models/Order.js";

dotenv.config();

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

async function clearOrders() {
  try {
    const totalCount = await Order.countDocuments();
    console.log(`Found ${totalCount} total orders in database`);

    if (totalCount > 0) {
      console.log("Clearing all orders...");
      const result = await Order.deleteMany({});
      console.log(`Deleted ${result.deletedCount} orders`);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const newTotalCount = await Order.countDocuments();
      console.log(`Remaining orders: ${newTotalCount}`);
    } else {
      console.log("No orders to delete");
    }

    mongoose.connection.close();
  } catch (error) {
    console.error("Error clearing orders:", error.message);
    mongoose.connection.close();
  }
}

clearOrders();

