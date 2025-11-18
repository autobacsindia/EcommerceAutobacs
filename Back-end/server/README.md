# Autobacs India - Backend API

Express.js RESTful API for the Autobacs India e-commerce platform.

## Setup

### Install Dependencies
```bash
npm install
```

### Environment Variables

Create a `.env` file with the following variables:

```env
# MongoDB Configuration
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/autobacs?retryWrites=true&w=majority

# JWT Configuration
JWT_SECRET=your_secret_key_here
JWT_EXPIRE=7d

# Server Configuration
PORT=5000
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000
```

### Run Development Server
```bash
npm run dev
```

### Run Production Server
```bash
npm start
```

## API Documentation

### Base URL
`http://localhost:5000`

### Authentication Routes

#### Register User
- **POST** `/auth/register`
- **Body:**
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "password": "password123"
  }
  ```

#### Login User
- **POST** `/auth/login`
- **Body:**
  ```json
  {
    "email": "john@example.com",
    "password": "password123"
  }
  ```

### Order Routes

(Coming soon)

## Project Structure

```
server/
├── middleware/
│   └── authMiddleware.js    # JWT authentication middleware
├── models/
│   ├── User.js              # User schema
│   ├── Order.js             # Order schema
│   └── ...                  # Additional models
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── orders.js            # Order routes
│   └── ...                  # Additional routes
├── .env                     # Environment variables
├── server.js                # Express app entry point
└── package.json             # Dependencies
```

## Dependencies

### Production
- `express` - Web framework
- `mongoose` - MongoDB ODM
- `bcryptjs` - Password hashing
- `jsonwebtoken` - JWT authentication
- `cors` - Cross-origin resource sharing
- `dotenv` - Environment variables

### Development
- `nodemon` - Auto-restart on file changes

## Security Features

- Password hashing with bcrypt
- JWT-based authentication
- CORS configuration
- Environment variable protection
- Input validation (planned)
- Rate limiting (planned)
