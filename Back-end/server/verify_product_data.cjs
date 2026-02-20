const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '.env') });

const productSchema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.model('Product', productSchema);

async function checkProduct() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const productId = '698b1ca5f5c86fd111685dcc';
    const product = await Product.findById(productId);

    if (!product) {
      console.log('Product not found!');
    } else {
      console.log('Product found:');
      console.log('ID:', product._id);
      console.log('Name:', product.name);
      console.log('Categories (Array):', product.categories);
      console.log('Category (Single):', product.category);
      console.log('Tags:', product.tags);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected');
  }
}

checkProduct();
