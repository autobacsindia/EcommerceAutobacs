import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function diagnose() {
    try {
        await mongoose.connect('mongodb://localhost:27017/autobacs');

        // Fetch a few products from WordPress to see tags and category hierarchy
        console.log('Fetching products from WordPress...');
        const response = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
            auth: {
                username: process.env.WORDPRESS_API_KEY,
                password: process.env.WORDPRESS_API_SECRET
            },
            params: { per_page: 10, status: 'publish' }
        });

        for (const p of response.data) {
            console.log(`\nProduct: ${p.name}`);
            console.log(`Tags: ${JSON.stringify(p.tags.map(t => t.name))}`);
            console.log(`Categories: ${JSON.stringify(p.categories.map(c => ({ id: c.id, name: c.name })))}`);
        }

        // Fetch all categories from WordPress to see their hierarchy
        console.log('\nFetching categories from WordPress...');
        const catResponse = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products/categories`, {
            auth: {
                username: process.env.WORDPRESS_API_KEY,
                password: process.env.WORDPRESS_API_SECRET
            },
            params: { per_page: 100 }
        });

        for (const c of catResponse.data) {
            if (c.parent !== 0) {
                console.log(`Category: ${c.name} (ID: ${c.id}), Parent: ${c.parent}`);
            } else {
                console.log(`Top Level Category: ${c.name} (ID: ${c.id})`);
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
diagnose();
