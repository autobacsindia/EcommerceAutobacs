module.exports = {
  setProductId: (requestParams, response, context, ee, next) => {
    try {
      const body = JSON.parse(response.body);
      if (body && body.products && body.products.length > 0) {
        // Pick a random product
        const product = body.products[Math.floor(Math.random() * body.products.length)];
        context.vars.productId = product._id;
      }
    } catch (e) {
      console.error('Failed to parse response body', e);
    }
    return next();
  }
};
