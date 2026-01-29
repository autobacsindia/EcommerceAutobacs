# Autobacs E-commerce Platform

A modern, full-stack e-commerce web application built with Next.js, Node.js, and MongoDB for automotive parts and accessories.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Git

### Development Setup
```bash
# Clone the repository
git clone <your-repo-url>
cd Autobacs

# Backend setup
cd Back-end/server
npm install
cp .env.example .env
# Update .env with your configuration
npm run dev

# Frontend setup (in new terminal)
cd Front-end/web
npm install
cp .env.local.example .env.local
# Update .env.local with your configuration
npm run dev
```

## 📁 Project Structure

```
Autobacs/
├── Back-end/
│   └── server/           # Node.js/Express API server
│       ├── controllers/  # Request handlers
│       ├── models/       # Database models
│       ├── routes/       # API routes
│       ├── services/     # Business logic
│       └── middleware/   # Express middleware
├── Front-end/
│   └── web/             # Next.js frontend
│       ├── src/
│       │   ├── app/     # App router pages
│       │   ├── components/ # React components
│       │   ├── context/   # React context providers
│       │   └── services/  # API service clients
│       └── public/      # Static assets
└── deployment/          # Deployment configurations
```

## 🛠️ Key Features

### Frontend (Next.js 16+)
- **Modern React** with App Router
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Responsive Design** mobile-first approach
- **Performance Optimized** with image optimization and caching

### Backend (Node.js/Express)
- **RESTful API** architecture
- **JWT Authentication** with role-based access
- **MongoDB** with Mongoose ODM
- **Payment Integration** with Razorpay
- **Email/SMS Notifications** with SendGrid/Twilio
- **Google Maps Integration** for location services
- **Rate Limiting** and security middleware

### Core Functionality
- 🛒 Product catalog with search and filtering
- 👤 User authentication and profiles
- 🛍️ Shopping cart and wishlist
- 💳 Secure checkout with multiple payment options
- 📍 Location-based services and delivery estimation
- 📦 Order management and tracking
- ⭐ Product reviews and ratings
- 🚗 Vehicle-specific product recommendations

## 🚀 Deployment

### Production Deployment Options

1. **Traditional VPS** (Recommended for control)
   - Cost: $10-40/month
   - Full server control
   - Manual configuration

2. **Containerized** (Docker/Container)
   - Cost: $15-50/month
   - Environment consistency
   - Easy scaling

3. **Platform-as-a-Service** (Managed)
   - Cost: $20-100/month
   - Quick deployment
   - Managed services

### Deployment Resources

See detailed deployment documentation:
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Complete step-by-step guide
- **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** - Pre-deployment checklist
- **[DEPLOYMENT_SUMMARY.md](DEPLOYMENT_SUMMARY.md)** - Deployment overview

### Quick Deployment Scripts

**Linux/Unix:**
```bash
chmod +x deploy-quick.sh
./deploy-quick.sh
```

**Windows:**
```cmd
deploy-windows.bat
```

**Docker:**
```bash
docker-compose up -d
```

## ⚙️ Environment Configuration

### Backend Environment Variables
Create `Back-end/server/.env`:
```env
# MongoDB
MONGO_URI=mongodb://localhost:27017/autobacs

# JWT
JWT_SECRET=your_secret_key
JWT_EXPIRE=7d

# Payment
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret

# Google Maps
GOOGLE_MAPS_CLIENT_KEY=your_client_key
GOOGLE_MAPS_SERVER_KEY=your_server_key

# Email
SENDGRID_API_KEY=your_api_key
```

### Frontend Environment Variables
Create `Front-end/web/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_RAZORPAY_KEY_ID=your_key_id
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your_maps_key
```

## 🧪 Testing

### Run Tests
```bash
# Backend tests
cd Back-end/server
npm test

# Frontend tests
cd Front-end/web
npm test

# End-to-end tests
npm run test:e2e
```

### Test Coverage
- Unit tests for components and services
- Integration tests for API endpoints
- End-to-end tests for user flows
- Performance testing with Lighthouse

## 📊 Monitoring and Analytics

### Built-in Monitoring
- Application performance monitoring
- Error tracking and logging
- User behavior analytics
- System resource monitoring

### Third-party Integrations
- Google Analytics for web analytics
- Sentry for error monitoring
- PM2 for process management

## 🔐 Security Features

- **JWT Authentication** with secure token handling
- **Rate Limiting** to prevent abuse
- **Input Validation** and sanitization
- **CORS Configuration** for secure API access
- **HTTPS Enforcement** in production
- **Security Headers** for XSS and CSRF protection

## 📱 Mobile Support

- **Responsive Design** for all device sizes
- **Progressive Web App** capabilities
- **Touch-friendly** interface
- **Mobile-optimized** checkout flow

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow existing code style and conventions
- Write tests for new functionality
- Update documentation when needed
- Ensure all tests pass before submitting PR

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support

### Documentation
- **[API Documentation](Back-end/server/API_DOCUMENTATION.md)**
- **[Deployment Guide](DEPLOYMENT_GUIDE.md)**
- **[Troubleshooting Guide](DEPLOYMENT_SUMMARY.md#troubleshooting)**

### Getting Help
- Check the documentation first
- Review existing issues
- Contact the development team
- Submit bug reports with detailed information

## 🎯 Roadmap

### Current Focus
- [x] Core e-commerce functionality
- [x] Payment integration
- [x] User authentication
- [x] Product management
- [x] Order processing

### Upcoming Features
- [ ] Admin dashboard enhancements
- [ ] Advanced analytics and reporting
- [ ] Mobile app development
- [ ] AI-powered recommendations
- [ ] Multi-language support
- [ ] Advanced inventory management

## 📊 Project Status

**Development Stage**: Production Ready  
**Latest Version**: 1.0.0  
**Last Updated**: January 2026  

### Current Capabilities
✅ Complete e-commerce platform  
✅ Secure payment processing  
✅ User management system  
✅ Product catalog with search  
✅ Order management and tracking  
✅ Location-based services  
✅ Responsive mobile design  
✅ Performance optimized  

---

**Autobacs India - Premium Automotive Parts & Accessories**