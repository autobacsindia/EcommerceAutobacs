import pymongo

try:
    # Connect to MongoDB
    client = pymongo.MongoClient("mongodb://localhost:27017/")
    
    # Access the autobacs database
    db = client["autobacs"]
    
    # Count products
    product_count = db["products"].count_documents({})
    print(f"Total products in database: {product_count}")
    
    # Show first 5 products
    products = list(db["products"].find().limit(5))
    print("\nFirst 5 products:")
    for i, product in enumerate(products, 1):
        print(f"  {i}. {product.get('name', 'Unnamed')} (SKU: {product.get('sku', 'No SKU')})")
    
    client.close()
except Exception as e:
    print(f"Error: {e}")