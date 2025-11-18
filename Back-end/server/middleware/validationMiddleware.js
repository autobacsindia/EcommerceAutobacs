// Input validation middleware using basic validation

export const validateRegister = (req, res, next) => {
  const { name, email, password } = req.body;
  const errors = [];

  // Name validation
  if (!name || name.trim().length < 2) {
    errors.push('Name must be at least 2 characters long');
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    errors.push('Valid email is required');
  }

  // Password validation
  if (!password || password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

export const validateLogin = (req, res, next) => {
  const { email, password } = req.body;
  const errors = [];

  if (!email) {
    errors.push('Email is required');
  }

  if (!password) {
    errors.push('Password is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

export const validateProduct = (req, res, next) => {
  const { name, description, price, category, stock } = req.body;
  const errors = [];

  if (!name || name.trim().length < 3) {
    errors.push('Product name must be at least 3 characters long');
  }

  if (!description || description.trim().length < 10) {
    errors.push('Product description must be at least 10 characters long');
  }

  if (!price || price < 0) {
    errors.push('Valid price is required');
  }

  if (!category) {
    errors.push('Category is required');
  }

  if (stock === undefined || stock < 0) {
    errors.push('Valid stock quantity is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

export const validateOrder = (req, res, next) => {
  const { items, shippingAddress } = req.body;
  const errors = [];

  if (!items || !Array.isArray(items) || items.length === 0) {
    errors.push('Order must contain at least one item');
  }

  if (!shippingAddress) {
    errors.push('Shipping address is required');
  } else {
    const { fullName, phone, addressLine1, city, state, postalCode } = shippingAddress;
    
    if (!fullName) errors.push('Full name is required in shipping address');
    if (!phone) errors.push('Phone number is required');
    if (!addressLine1) errors.push('Address line 1 is required');
    if (!city) errors.push('City is required');
    if (!state) errors.push('State is required');
    if (!postalCode) errors.push('Postal code is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};
